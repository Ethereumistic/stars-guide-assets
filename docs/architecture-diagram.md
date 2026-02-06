# stars.guide Database Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          stars.guide System                              │
│                    Convex-Powered Authentication                         │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                         AUTHENTICATION LAYER                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────┐   ┌──────────────────┐   ┌──────────────────┐  │
│  │  Email/Password     │   │  Google OAuth    │   │   Apple OAuth    │  │
│  │   (Convex Auth)     │   │  (Convex Auth)   │   │  (Convex Auth)   │  │
│  └─────────┬───────────┘   └────────┬─────────┘   └────────┬─────────┘  │
│            │                        │                       │            │
│            └────────────────────────┼───────────────────────┘            │
│                                     ▼                                    │
│                      ┌──────────────────────────┐                        │
│                      │   Convex Auth (users)    │                        │
│                      │  - Stores credentials    │                        │
│                      │  - Manages sessions      │                        │
│                      │  - Handles verification  │                        │
│                      └──────────┬───────────────┘                        │
└─────────────────────────────────┼────────────────────────────────────────┘
                                  │
                                  │ userId (FK)
                                  │
┌─────────────────────────────────▼────────────────────────────────────────┐
│                           APPLICATION LAYER                               │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                       PROFILES TABLE                              │  │
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │  Core Fields:                                                      │  │
│  │  • userId (Link to Convex Auth)                                   │  │
│  │  • name, email, avatarUrl                                         │  │
│  │  • phone (optional)                                               │  │
│  │                                                                    │  │
│  │  Subscription Management:                                          │  │
│  │  • tier (free | cosmic_flow | cosmic_flow_annual | ...)          │  │
│  │  • subscriptionStatus (active | trialing | canceled | ...)       │  │
│  │  • subscriptionStartedAt, subscriptionEndsAt                      │  │
│  │                                                                    │  │
│  │  Access Control:                                                   │  │
│  │  • role (user | moderator | admin)                               │  │
│  │  • featureFlags                                                   │  │
│  │                                                                    │  │
│  │  Preferences:                                                      │  │
│  │  • timezone, dailySparkTime, notificationsEnabled                │  │
│  │                                                                    │  │
│  │  Indexes:                                                          │  │
│  │  ✓ by_user_id     ✓ by_email      ✓ by_tier                     │  │
│  │  ✓ by_role        ✓ by_tier_and_status                          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                  SUBSCRIPTION_HISTORY TABLE                        │  │
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │  Audit Trail:                                                      │  │
│  │  • userId, profileId                                              │  │
│  │  • event (subscription_started | upgraded | canceled | ...)      │  │
│  │  • previousTier → newTier                                         │  │
│  │  • previousStatus → newStatus                                     │  │
│  │                                                                    │  │
│  │  Revenue Tracking:                                                 │  │
│  │  • amount (USD cents)                                             │  │
│  │  • currency                                                        │  │
│  │  • externalTransactionId (Stripe/RevenueCat)                     │  │
│  │                                                                    │  │
│  │  Indexes:                                                          │  │
│  │  ✓ by_user_id     ✓ by_profile_id    ✓ by_event                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW: USER SIGNUP                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. User submits signup form                                             │
│     └─> Email/Password OR OAuth (Google/Apple)                           │
│                                                                           │
│  2. Convex Auth creates user record                                      │
│     └─> users table: { _id, email, emailVerificationTime, ... }         │
│                                                                           │
│  3. Frontend calls createProfile mutation                                │
│     └─> profiles table: { userId (FK), name, email, tier: "free", ... } │
│                                                                           │
│  4. User receives welcome email (optional)                               │
│                                                                           │
│  5. Redirect to /onboarding                                              │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                    DATA FLOW: SUBSCRIPTION UPGRADE                        │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. User clicks "Upgrade to Cosmic Flow"                                 │
│                                                                           │
│  2. Payment processed (Stripe/RevenueCat)                                │
│     └─> Webhook sent to /api/stripe-webhook                             │
│                                                                           │
│  3. Webhook handler calls updateSubscriptionTier mutation                │
│     ├─> profiles: { tier: "cosmic_flow", status: "active" }            │
│     └─> subscription_history: { event: "subscription_upgraded", ... }   │
│                                                                           │
│  4. User gains access to premium features                                │
│     └─> hasFeatureAccess("oracle_unlimited") → true                     │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                      FEATURE ACCESS MATRIX                                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌─────────────────────┬──────────┬──────────┬──────────┬──────────┐    │
│  │ Feature             │   Free   │ Cosmic   │  Annual  │ Lifetime │    │
│  │                     │          │   Flow   │   Flow   │          │    │
│  ├─────────────────────┼──────────┼──────────┼──────────┼──────────┤    │
│  │ Daily Spark         │    ✓     │    ✓     │    ✓     │    ✓     │    │
│  │ Natal Chart         │    ✓     │    ✓     │    ✓     │    ✓     │    │
│  │ Oracle (3q/day)     │    ✓     │    -     │    -     │    -     │    │
│  │ Oracle (unlimited)  │    -     │    ✓     │    ✓     │    ✓     │    │
│  │ Astral Cards        │    -     │    ✓     │    ✓     │    ✓     │    │
│  │ Synastry            │    -     │    ✓     │    ✓     │    ✓     │    │
│  │ Advanced Transits   │    -     │    -     │    ✓     │    ✓     │    │
│  └─────────────────────┴──────────┴──────────┴──────────┴──────────┘    │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                        ROLE HIERARCHY (RBAC)                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│                         ┌───────────┐                                    │
│                         │   ADMIN   │  ← Full system access              │
│                         └─────┬─────┘                                    │
│                               │                                          │
│                               ▼                                          │
│                       ┌───────────────┐                                  │
│                       │   MODERATOR   │  ← Can flag content              │
│                       └───────┬───────┘                                  │
│                               │                                          │
│                               ▼                                          │
│                         ┌───────────┐                                    │
│                         │    USER   │  ← Standard permissions            │
│                         └───────────┘                                    │
│                                                                           │
│  Permissions Checked Via: hasPermission(userId, requiredRole)            │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                      SCALABILITY STRATEGY                                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Current Capacity (Convex Free Tier):                                    │
│  • 1GB Database Storage        → ~100K user profiles                     │
│  • 1M Function Calls/Month     → ~50K active users                       │
│  • Unlimited Bandwidth                                                   │
│                                                                           │
│  Optimization Strategies:                                                │
│  1. Denormalize email in profiles (avoid joins)                          │
│  2. Index frequently queried fields                                      │
│  3. Soft delete (retain 30 days, then purge)                             │
│  4. Paginate large queries                                               │
│  5. Cache subscription status in profiles                                │
│                                                                           │
│  Future Migration Path:                                                  │
│  • 50K+ users → Convex Pro ($25/mo)                                      │
│  • 100K+ users → Convex Enterprise (custom pricing)                      │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                         SECURITY LAYERS                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Layer 1: Authentication                                                 │
│  • Convex Auth handles password hashing (bcrypt)                         │
│  • OAuth tokens managed securely                                         │
│  • Email verification via Resend (optional)                              │
│                                                                           │
│  Layer 2: Authorization                                                  │
│  • Role-based access control (RBAC)                                      │
│  • Feature gates based on subscription tier                              │
│  • Mutations check user identity before execution                        │
│                                                                           │
│  Layer 3: Data Protection                                                │
│  • Soft deletes (retain 30 days for compliance)                          │
│  • GDPR-compliant data export/deletion                                   │
│  • No plaintext passwords stored                                         │
│                                                                           │
│  Layer 4: Rate Limiting                                                  │
│  • Convex built-in rate limiting per IP                                  │
│  • Custom limits: 3 Oracle questions/day (free tier)                     │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                    KEY CONVEX MUTATIONS & QUERIES                         │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  MUTATIONS (Write Operations):                                           │
│  • createProfile(userId, name, email)                                    │
│  • updateProfile(userId, { name, avatarUrl, preferences })               │
│  • updateSubscriptionTier(userId, newTier, newStatus)                    │
│  • deleteUser(userId)  [soft delete]                                     │
│  • updateUserRole(targetUserId, newRole)  [admin only]                   │
│                                                                           │
│  QUERIES (Read Operations):                                              │
│  • getCurrentUserProfile()                                               │
│  • getProfile(userId)                                                    │
│  • hasPermission(userId, requiredRole)                                   │
│  • hasFeatureAccess(userId, feature)                                     │
│  • getSubscriptionHistory(userId)                                        │
│  • getAllUsers(cursor)  [admin only, paginated]                          │
│                                                                           │
│  INTERNAL MUTATIONS (Cron Jobs):                                         │
│  • purgeDeletedUsers()  [runs daily via cron]                            │
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
```

## Quick Reference: Table Relationships

```
users (Convex Auth)
  │
  │ 1:1
  │
  ├──> profiles
  │       │
  │       │ 1:N
  │       │
  │       └──> subscription_history
  │
  └──> (future tables)
          • birth_charts
          • journal_entries
          • oracle_conversations
          • astral_cards
```

## Data Lifecycle

```
NEW USER SIGNUP
    ↓
Create Auth User (users table)
    ↓
Create Profile (profiles table)
    ↓
ACTIVE USER (tier: free, status: active)
    ↓
[User upgrades]
    ↓
Update Profile (tier: cosmic_flow)
    ↓
Log to subscription_history
    ↓
[30+ days of inactivity OR user requests deletion]
    ↓
Soft Delete (deletedAt: timestamp)
    ↓
[30 days retention]
    ↓
Hard Delete via Cron (GDPR compliance)
```

## Cost Breakdown (Per User)

```
Storage per user profile: ~1KB
  • Basic fields: 200 bytes
  • Preferences JSON: 300 bytes
  • Metadata: 500 bytes

Storage per subscription event: ~500 bytes

Total for 10K users:
  • Profiles: 10MB
  • Subscription history (avg 5 events/user): 25MB
  • Total: 35MB (well under 1GB limit)

Function calls per user per month:
  • Profile queries: 10 calls
  • Subscription checks: 5 calls
  • Feature gates: 15 calls
  • Total: 30 calls/user

For 10K users: 300K calls/month (under 1M limit)
```

**Result: You can scale to 50K users on Convex free tier.**
