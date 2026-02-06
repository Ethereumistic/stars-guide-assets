# stars.guide Convex Database Architecture
## Authentication & User Management System

---

## Overview

This architecture uses **Convex Auth** (100% free, built-in) for authentication with support for:
- Email/Password authentication
- OAuth providers (Google, Apple, GitHub, etc.)
- Email verification
- Role-based access control (RBAC)
- Subscription tier management
- Future scalability to 50K+ users

**No paid dependencies. Ever.**

---

## Core Schema Design

### Philosophy
1. **Separation of Concerns:** Auth data (emails, passwords) separate from profile data (names, avatars)
2. **Denormalization Where Needed:** Cache frequently accessed data to reduce joins
3. **Indexes for Performance:** Query optimization from day one
4. **Soft Deletes:** Never hard-delete users (compliance, data integrity)
5. **Audit Trail:** Track key state changes (subscription upgrades, role changes)

---

## Table Schemas

### 1. `users` Table (Convex Auth Internal)
**Purpose:** Managed automatically by Convex Auth. Stores authentication credentials.

**Fields (Auto-managed by Convex Auth):**
```typescript
// You don't define this table directly - Convex Auth creates it
// But here's what it contains:
{
  _id: Id<"users">,
  _creationTime: number,
  email?: string,                    // For email/password auth
  emailVerificationTime?: number,    // Timestamp of email verification
  phone?: string,                    // For phone auth (we won't use initially)
  phoneVerificationTime?: number,
  isAnonymous?: boolean,             // For anonymous sessions
  // OAuth fields (added automatically when user signs in with OAuth)
  // e.g., googleId, appleId, etc.
}
```

**Notes:**
- This table is **managed by Convex Auth** - you don't create it manually
- Each authentication method (email, Google, Apple) creates a user entry
- Password hashes are stored securely by Convex (not in this table)

---

### 2. `profiles` Table (User-Facing Data)
**Purpose:** User profile information visible to the user and app logic.

**Schema:**
```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  profiles: defineTable({
    // Link to Convex Auth user
    userId: v.id("users"),
    
    // Basic Profile (MUST HAVE 100%)
    name: v.string(),                    // Full name or display name
    email: v.string(),                   // Denormalized from users table for quick access
    avatarUrl: v.optional(v.string()),   // URL to uploaded avatar (Convex file storage)
    
    // Anti-Bot / Security (Optional but recommended)
    phone: v.optional(v.string()),       // E.164 format: +15551234567
    phoneVerified: v.optional(v.boolean()),
    
    // Subscription Management
    tier: v.union(
      v.literal("free"),
      v.literal("cosmic_flow"),          // $9.99/month tier
      v.literal("cosmic_flow_annual"),   // Annual tier (if offered)
      v.literal("influencer_custom"),    // Custom OTC deals
      v.literal("lifetime")              // One-time purchase tier (future)
    ),
    subscriptionStatus: v.union(
      v.literal("active"),
      v.literal("trialing"),             // 7-day free trial
      v.literal("past_due"),             // Payment failed
      v.literal("canceled"),             // User canceled
      v.literal("paused")                // Temporary pause (future feature)
    ),
    subscriptionStartedAt: v.optional(v.number()),  // Timestamp
    subscriptionEndsAt: v.optional(v.number()),     // Timestamp (for trials, cancellations)
    
    // Role-Based Access Control
    role: v.union(
      v.literal("user"),                 // Default
      v.literal("moderator"),            // Can flag content
      v.literal("admin")                 // Full access
    ),
    
    // Metadata
    createdAt: v.number(),               // Unix timestamp (ms)
    updatedAt: v.number(),               // Last profile update
    deletedAt: v.optional(v.number()),   // Soft delete timestamp
    
    // Feature Flags (For gradual rollout)
    featureFlags: v.optional(v.object({
      earlyAccessOracle: v.optional(v.boolean()),
      betaFeatures: v.optional(v.boolean()),
    })),
    
    // User Preferences (Not critical for MVP, but plan ahead)
    preferences: v.optional(v.object({
      timezone: v.optional(v.string()),           // e.g., "America/New_York"
      dailySparkTime: v.optional(v.string()),     // e.g., "07:00" (user's ritual hour)
      notificationsEnabled: v.optional(v.boolean()),
      language: v.optional(v.string()),           // e.g., "en", "es" (i18n future)
    })),
    
  })
    // INDEXES FOR PERFORMANCE
    .index("by_user_id", ["userId"])           // Primary lookup: userId → profile
    .index("by_email", ["email"])              // Find profile by email
    .index("by_tier", ["tier"])                // Query all users in a tier
    .index("by_subscription_status", ["subscriptionStatus"])
    .index("by_role", ["role"])                // Admin queries
    .index("by_created_at", ["createdAt"])     // Chronological queries
    .index("by_deleted_at", ["deletedAt"])     // Filter out soft-deleted users
    // Compound index for active paid users
    .index("by_tier_and_status", ["tier", "subscriptionStatus"]),
});
```

**Key Design Decisions:**

1. **`userId` as Foreign Key:**
   - Links to Convex Auth's `users` table
   - One-to-one relationship (each auth user has exactly one profile)
   
2. **Email Denormalization:**
   - We duplicate email in `profiles` table for fast queries
   - Alternative: Join `users` + `profiles` on every query (slower)
   
3. **Tier vs. Subscription Status:**
   - `tier`: WHAT they purchased ("cosmic_flow")
   - `subscriptionStatus`: STATE of that purchase ("active", "canceled")
   
4. **Timestamps as Numbers (Unix ms):**
   - Convex uses JS Date as numbers (milliseconds since epoch)
   - Easy math: `Date.now() - subscriptionStartedAt` = subscription age
   
5. **Soft Deletes:**
   - `deletedAt` field instead of hard delete
   - Allows GDPR compliance (retain data for X days before purge)
   - Index excludes deleted users from normal queries

---

### 3. `subscription_history` Table (Audit Trail)
**Purpose:** Track all subscription changes for analytics and support.

**Schema:**
```typescript
subscription_history: defineTable({
  userId: v.id("users"),
  profileId: v.id("profiles"),
  
  // What changed
  event: v.union(
    v.literal("subscription_started"),
    v.literal("subscription_upgraded"),     // free → cosmic_flow
    v.literal("subscription_downgraded"),
    v.literal("subscription_canceled"),
    v.literal("subscription_renewed"),
    v.literal("trial_started"),
    v.literal("trial_converted"),           // trial → paid
    v.literal("trial_expired"),
    v.literal("payment_failed"),
    v.literal("payment_succeeded")
  ),
  
  // State before/after (for debugging)
  previousTier: v.optional(v.string()),
  newTier: v.string(),
  previousStatus: v.optional(v.string()),
  newStatus: v.string(),
  
  // Revenue tracking
  amount: v.optional(v.number()),           // USD cents (999 = $9.99)
  currency: v.optional(v.string()),         // "USD"
  
  // External payment reference (Stripe, RevenueCat, etc.)
  paymentProviderId: v.optional(v.string()),
  externalTransactionId: v.optional(v.string()),
  
  // Metadata
  createdAt: v.number(),
  metadata: v.optional(v.object({
    source: v.optional(v.string()),         // "web", "ios", "android"
    couponCode: v.optional(v.string()),
  })),
})
  .index("by_user_id", ["userId"])
  .index("by_profile_id", ["profileId"])
  .index("by_event", ["event"])
  .index("by_created_at", ["createdAt"]),
```

**Why This Table Exists:**
- **Analytics:** How many trials convert to paid?
- **Customer Support:** "When did this user cancel?"
- **Fraud Detection:** Unusual subscription patterns
- **Revenue Reporting:** MRR, churn rate calculations

---

### 4. `email_verification_tokens` Table (Custom Email Verification)
**Purpose:** If using custom email verification instead of Convex Auth's built-in.

**Schema:**
```typescript
email_verification_tokens: defineTable({
  userId: v.id("users"),
  email: v.string(),
  token: v.string(),                        // Random UUID or crypto hash
  expiresAt: v.number(),                    // Unix timestamp
  verifiedAt: v.optional(v.number()),       // Set when user clicks link
  createdAt: v.number(),
})
  .index("by_token", ["token"])             // Fast lookup when user clicks email link
  .index("by_user_id", ["userId"])
  .index("by_expires_at", ["expiresAt"]),   // Clean up expired tokens via cron
```

**Note:** Convex Auth handles email verification by default. Only create this if you need custom email templates or logic.

---

## Convex Auth Setup

### Installation
```bash
npm install @convex-dev/auth
```

### Configuration: `convex/auth.config.ts`
```typescript
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store } = convexAuth({
  providers: [
    // Email/Password
    {
      id: "password",
      type: "credentials",
      async authorize(credentials: { email: string; password: string }) {
        // Convex Auth handles password hashing automatically
        return credentials;
      },
    },
    
    // Google OAuth
    {
      id: "google",
      type: "oauth",
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    
    // Apple OAuth (for iOS)
    {
      id: "apple",
      type: "oauth",
      clientId: process.env.APPLE_CLIENT_ID!,
      clientSecret: process.env.APPLE_CLIENT_SECRET!,
    },
    
    // GitHub OAuth (optional, for developers)
    {
      id: "github",
      type: "oauth",
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  ],
});
```

### Environment Variables (`.env.local`)
```bash
# Google OAuth (Get from Google Cloud Console)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Apple OAuth (Get from Apple Developer)
APPLE_CLIENT_ID=your_apple_client_id
APPLE_CLIENT_SECRET=your_apple_client_secret

# GitHub OAuth (Optional)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Convex (Auto-generated)
CONVEX_DEPLOYMENT=your_deployment_name
NEXT_PUBLIC_CONVEX_URL=https://your-deployment.convex.cloud
```

---

## Core Mutations & Queries

### Mutation: Create Profile (After Signup)
```typescript
// convex/profiles.ts
import { v } from "convex/values";
import { mutation } from "./_generated/server";

export const createProfile = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    email: v.string(),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if profile already exists
    const existingProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();
      
    if (existingProfile) {
      throw new Error("Profile already exists for this user");
    }
    
    // Create new profile
    const profileId = await ctx.db.insert("profiles", {
      userId: args.userId,
      name: args.name,
      email: args.email,
      avatarUrl: args.avatarUrl,
      tier: "free",                        // Default tier
      subscriptionStatus: "active",        // Free tier is always active
      role: "user",                        // Default role
      createdAt: Date.now(),
      updatedAt: Date.now(),
      preferences: {
        timezone: "UTC",
        dailySparkTime: "07:00",
        notificationsEnabled: true,
        language: "en",
      },
    });
    
    return profileId;
  },
});
```

### Query: Get User Profile
```typescript
export const getProfile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined)) // Exclude deleted
      .first();
      
    return profile;
  },
});
```

### Mutation: Update Subscription Tier
```typescript
export const updateSubscriptionTier = mutation({
  args: {
    userId: v.id("users"),
    newTier: v.union(
      v.literal("free"),
      v.literal("cosmic_flow"),
      v.literal("cosmic_flow_annual"),
      v.literal("influencer_custom"),
      v.literal("lifetime")
    ),
    newStatus: v.union(
      v.literal("active"),
      v.literal("trialing"),
      v.literal("past_due"),
      v.literal("canceled"),
      v.literal("paused")
    ),
    amount: v.optional(v.number()),        // Payment amount in cents
    externalTransactionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get current profile
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();
      
    if (!profile) {
      throw new Error("Profile not found");
    }
    
    // Log to subscription history
    await ctx.db.insert("subscription_history", {
      userId: args.userId,
      profileId: profile._id,
      event: "subscription_upgraded",      // Or determine dynamically
      previousTier: profile.tier,
      newTier: args.newTier,
      previousStatus: profile.subscriptionStatus,
      newStatus: args.newStatus,
      amount: args.amount,
      currency: "USD",
      externalTransactionId: args.externalTransactionId,
      createdAt: Date.now(),
    });
    
    // Update profile
    await ctx.db.patch(profile._id, {
      tier: args.newTier,
      subscriptionStatus: args.newStatus,
      subscriptionStartedAt: Date.now(),
      subscriptionEndsAt: undefined,       // Clear end date for active subscriptions
      updatedAt: Date.now(),
    });
    
    return { success: true };
  },
});
```

### Query: Check User Permissions (RBAC)
```typescript
export const hasPermission = query({
  args: {
    userId: v.id("users"),
    requiredRole: v.union(v.literal("user"), v.literal("moderator"), v.literal("admin")),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();
      
    if (!profile) return false;
    
    // Role hierarchy: admin > moderator > user
    const roleHierarchy = { user: 0, moderator: 1, admin: 2 };
    
    return roleHierarchy[profile.role] >= roleHierarchy[args.requiredRole];
  },
});
```

---

## Anti-Bot Strategy (Phone Number)

### When to Collect Phone
**Recommendation:** DON'T collect phone during signup (friction).

**Alternative Approaches:**
1. **Captcha Integration:**
   - Use Cloudflare Turnstile (free, privacy-friendly)
   - Add to signup form before Convex mutation

2. **Rate Limiting:**
   - Convex has built-in rate limiting per IP
   - Limit signups to 5 per hour per IP

3. **Email Domain Validation:**
   - Block disposable email domains (temp-mail.org, etc.)
   - Maintain blocklist in Convex table

4. **Phone as Optional Upgrade:**
   - Offer phone verification for "Verified Account" badge
   - Required for high-tier features (e.g., influencer_custom tier)

### If You Must Collect Phone
```typescript
// Add to profiles table (already included above)
phone: v.optional(v.string()),       // E.164 format
phoneVerified: v.optional(v.boolean()),

// Mutation to verify phone via SMS (use Twilio Verify API - free tier)
export const verifyPhone = mutation({
  args: {
    userId: v.id("users"),
    phoneNumber: v.string(),
    verificationCode: v.string(),
  },
  handler: async (ctx, args) => {
    // Call Twilio Verify API to check code
    // If valid, update profile:
    await ctx.db.patch(profileId, {
      phone: args.phoneNumber,
      phoneVerified: true,
      updatedAt: Date.now(),
    });
  },
});
```

---

## Subscription Tier Feature Gates

### Helper Function: Check Feature Access
```typescript
// convex/lib/featureGates.ts
export function hasFeatureAccess(
  tier: string,
  feature: "oracle_unlimited" | "astral_cards" | "synastry" | "advanced_transits"
): boolean {
  const featureMatrix = {
    free: ["oracle_limited"],                                    // 3 questions/day
    cosmic_flow: ["oracle_unlimited", "astral_cards", "synastry"],
    cosmic_flow_annual: ["oracle_unlimited", "astral_cards", "synastry", "advanced_transits"],
    influencer_custom: ["oracle_unlimited", "astral_cards", "synastry", "advanced_transits"],
    lifetime: ["oracle_unlimited", "astral_cards", "synastry", "advanced_transits"],
  };
  
  return featureMatrix[tier as keyof typeof featureMatrix]?.includes(feature) ?? false;
}

// Usage in queries/mutations:
export const askOracle = mutation({
  args: {
    userId: v.id("users"),
    question: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await getProfileByUserId(ctx, args.userId);
    
    if (!hasFeatureAccess(profile.tier, "oracle_unlimited")) {
      // Check daily question limit for free tier
      const questionsToday = await ctx.db
        .query("oracle_conversations")
        .withIndex("by_user_and_date", (q) => 
          q.eq("userId", args.userId).eq("date", getTodayDateString())
        )
        .collect();
        
      if (questionsToday.length >= 3) {
        throw new Error("Daily question limit reached. Upgrade to Cosmic Flow for unlimited questions.");
      }
    }
    
    // Process oracle question...
  },
});
```

---

## Payment Integration (Future: RevenueCat or Stripe)

### Webhook Handler Pattern
```typescript
// convex/http.ts (for receiving payment webhooks)
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

// Stripe webhook endpoint
http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");
    
    // Verify Stripe signature (security)
    // Parse event (subscription.created, invoice.paid, etc.)
    
    // Call mutation to update subscription
    await ctx.runMutation(api.profiles.updateSubscriptionTier, {
      userId: event.data.object.metadata.userId,
      newTier: "cosmic_flow",
      newStatus: "active",
      amount: event.data.object.amount_total,
      externalTransactionId: event.id,
    });
    
    return new Response("OK", { status: 200 });
  }),
});

export default http;
```

---

## Data Retention & GDPR Compliance

### Mutation: Soft Delete User
```typescript
export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();
      
    if (!profile) throw new Error("Profile not found");
    
    // Soft delete (retain for 30 days for compliance)
    await ctx.db.patch(profile._id, {
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    // Schedule hard delete via cron job (after 30 days)
    // Or anonymize data (replace email/name with hashes)
  },
});
```

### Cron Job: Purge Old Deleted Users
```typescript
// convex/crons.ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "purge_deleted_users",
  { hours: 24 },  // Run daily
  internal.profiles.purgeDeletedUsers,
);

export default crons;

// convex/profiles.ts (internal mutation)
export const purgeDeletedUsers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    
    const deletedProfiles = await ctx.db
      .query("profiles")
      .withIndex("by_deleted_at")
      .filter((q) => q.lt(q.field("deletedAt"), thirtyDaysAgo))
      .collect();
      
    for (const profile of deletedProfiles) {
      // Hard delete or anonymize
      await ctx.db.delete(profile._id);
    }
  },
});
```

---

## Performance Optimization

### 1. Denormalization Strategy
**Problem:** Joining `users` + `profiles` on every query is slow.

**Solution:** Cache frequently accessed fields in `profiles`:
- Email (from `users.email`)
- Last login time
- Subscription tier

### 2. Index Optimization
**Always index fields you query frequently:**
- `by_user_id` (most common lookup)
- `by_email` (login, forgot password)
- `by_tier_and_status` (admin dashboards, analytics)

### 3. Pagination for Large Queries
```typescript
export const getAllUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("profiles")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
```

---

## Migration Strategy (Adding Fields Later)

Convex allows **schema evolution** without downtime:

```typescript
// Initial schema
tier: v.union(v.literal("free"), v.literal("cosmic_flow")),

// Later, add new tier
tier: v.union(
  v.literal("free"),
  v.literal("cosmic_flow"),
  v.literal("cosmic_flow_annual"),  // NEW
),

// No migration needed - existing docs remain valid
// New signups can use the new tier immediately
```

---

## Checklist: MVP Implementation

### Phase 1: Auth Foundation
- [ ] Install `@convex-dev/auth`
- [ ] Configure email/password provider
- [ ] Create `profiles` table schema
- [ ] Implement `createProfile` mutation
- [ ] Test signup flow: email → profile creation

### Phase 2: OAuth Integration
- [ ] Get Google OAuth credentials
- [ ] Get Apple OAuth credentials (for iOS)
- [ ] Add OAuth providers to `auth.config.ts`
- [ ] Test OAuth flow: Google login → profile creation

### Phase 3: Subscription Management
- [ ] Create `subscription_history` table
- [ ] Implement tier upgrade/downgrade mutations
- [ ] Test free → cosmic_flow transition
- [ ] Add feature gates (oracle question limits)

### Phase 4: RBAC & Security
- [ ] Implement role-based queries
- [ ] Add admin dashboard queries (getAllUsers, etc.)
- [ ] Test permission checks

### Phase 5: Compliance
- [ ] Implement soft delete
- [ ] Create cron job for hard delete (30-day retention)
- [ ] Add GDPR data export query

---

## Cost Projections (Convex Free Tier)

**Convex Free Tier Limits:**
- 1GB database storage
- 1GB file storage
- 1 million function calls/month

**Estimated Capacity at 10K Users:**
- Profiles table: ~10MB (1KB per profile × 10K)
- Subscription history: ~5MB (500 events)
- Function calls: ~500K/month (50 calls/user/month)

**You're safe until 50K users before hitting limits.**

---

## Final Schema File

Here's your complete `convex/schema.ts`:

```typescript
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  profiles: defineTable({
    userId: v.id("users"),
    name: v.string(),
    email: v.string(),
    avatarUrl: v.optional(v.string()),
    phone: v.optional(v.string()),
    phoneVerified: v.optional(v.boolean()),
    
    tier: v.union(
      v.literal("free"),
      v.literal("cosmic_flow"),
      v.literal("cosmic_flow_annual"),
      v.literal("influencer_custom"),
      v.literal("lifetime")
    ),
    subscriptionStatus: v.union(
      v.literal("active"),
      v.literal("trialing"),
      v.literal("past_due"),
      v.literal("canceled"),
      v.literal("paused")
    ),
    subscriptionStartedAt: v.optional(v.number()),
    subscriptionEndsAt: v.optional(v.number()),
    
    role: v.union(
      v.literal("user"),
      v.literal("moderator"),
      v.literal("admin")
    ),
    
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()),
    
    featureFlags: v.optional(v.object({
      earlyAccessOracle: v.optional(v.boolean()),
      betaFeatures: v.optional(v.boolean()),
    })),
    
    preferences: v.optional(v.object({
      timezone: v.optional(v.string()),
      dailySparkTime: v.optional(v.string()),
      notificationsEnabled: v.optional(v.boolean()),
      language: v.optional(v.string()),
    })),
  })
    .index("by_user_id", ["userId"])
    .index("by_email", ["email"])
    .index("by_tier", ["tier"])
    .index("by_subscription_status", ["subscriptionStatus"])
    .index("by_role", ["role"])
    .index("by_created_at", ["createdAt"])
    .index("by_deleted_at", ["deletedAt"])
    .index("by_tier_and_status", ["tier", "subscriptionStatus"]),
    
  subscription_history: defineTable({
    userId: v.id("users"),
    profileId: v.id("profiles"),
    event: v.union(
      v.literal("subscription_started"),
      v.literal("subscription_upgraded"),
      v.literal("subscription_downgraded"),
      v.literal("subscription_canceled"),
      v.literal("subscription_renewed"),
      v.literal("trial_started"),
      v.literal("trial_converted"),
      v.literal("trial_expired"),
      v.literal("payment_failed"),
      v.literal("payment_succeeded")
    ),
    previousTier: v.optional(v.string()),
    newTier: v.string(),
    previousStatus: v.optional(v.string()),
    newStatus: v.string(),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    paymentProviderId: v.optional(v.string()),
    externalTransactionId: v.optional(v.string()),
    createdAt: v.number(),
    metadata: v.optional(v.object({
      source: v.optional(v.string()),
      couponCode: v.optional(v.string()),
    })),
  })
    .index("by_user_id", ["userId"])
    .index("by_profile_id", ["profileId"])
    .index("by_event", ["event"])
    .index("by_created_at", ["createdAt"]),
});
```

---

**Next Steps:**
1. Copy this schema to `convex/schema.ts`
2. Run `npx convex dev` to deploy
3. Implement signup flow with profile creation
4. Test with email/password auth
5. Add OAuth providers
6. Build payment webhook handler

You now have a production-ready, scalable auth system with zero ongoing costs!
