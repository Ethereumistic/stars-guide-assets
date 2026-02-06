// convex/profiles.ts
import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ============================================================================
// MUTATIONS
// ============================================================================

/**
 * Create a new user profile after signup
 * Called automatically after successful authentication
 */
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

    // Create new profile with defaults
    const profileId = await ctx.db.insert("profiles", {
      userId: args.userId,
      name: args.name,
      email: args.email,
      avatarUrl: args.avatarUrl,
      tier: "free",
      subscriptionStatus: "active",
      role: "user",
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

/**
 * Update user profile information
 */
export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    phone: v.optional(v.string()),
    preferences: v.optional(
      v.object({
        timezone: v.optional(v.string()),
        dailySparkTime: v.optional(v.string()),
        notificationsEnabled: v.optional(v.boolean()),
        language: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) {
      throw new Error("Profile not found");
    }

    // Build update object (only include provided fields)
    const updates: any = {
      updatedAt: Date.now(),
    };

    if (args.name !== undefined) updates.name = args.name;
    if (args.avatarUrl !== undefined) updates.avatarUrl = args.avatarUrl;
    if (args.phone !== undefined) updates.phone = args.phone;
    if (args.preferences !== undefined) {
      updates.preferences = {
        ...profile.preferences,
        ...args.preferences,
      };
    }

    await ctx.db.patch(profile._id, updates);

    return { success: true };
  },
});

/**
 * Update subscription tier and status
 * Called by payment webhook handlers
 */
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
    amount: v.optional(v.number()),
    externalTransactionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) {
      throw new Error("Profile not found");
    }

    // Determine event type based on tier/status changes
    let event: string = "subscription_started";
    if (profile.tier !== args.newTier) {
      event =
        args.newTier > profile.tier
          ? "subscription_upgraded"
          : "subscription_downgraded";
    } else if (args.newStatus === "canceled") {
      event = "subscription_canceled";
    } else if (args.newStatus === "trialing") {
      event = "trial_started";
    }

    // Log to subscription history
    await ctx.db.insert("subscription_history", {
      userId: args.userId,
      profileId: profile._id,
      event: event as any,
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
      subscriptionStartedAt:
        args.newStatus === "active" || args.newStatus === "trialing"
          ? Date.now()
          : profile.subscriptionStartedAt,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Soft delete a user profile
 * Marks profile as deleted but retains data for 30 days (GDPR compliance)
 */
export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) {
      throw new Error("Profile not found");
    }

    await ctx.db.patch(profile._id, {
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

/**
 * Update user role (admin only)
 */
export const updateUserRole = mutation({
  args: {
    targetUserId: v.id("users"),
    newRole: v.union(
      v.literal("user"),
      v.literal("moderator"),
      v.literal("admin")
    ),
  },
  handler: async (ctx, args) => {
    // Get the current user (caller)
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    const callerProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => 
        q.eq("userId", identity.subject as Id<"users">)
      )
      .first();

    // Only admins can change roles
    if (!callerProfile || callerProfile.role !== "admin") {
      throw new Error("Unauthorized: Admin access required");
    }

    // Get target user profile
    const targetProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.targetUserId))
      .first();

    if (!targetProfile) {
      throw new Error("Target user not found");
    }

    // Update role
    await ctx.db.patch(targetProfile._id, {
      role: args.newRole,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// ============================================================================
// QUERIES
// ============================================================================

/**
 * Get current user's profile
 */
export const getCurrentUserProfile = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => 
        q.eq("userId", identity.subject as Id<"users">)
      )
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();

    return profile;
  },
});

/**
 * Get profile by user ID
 */
export const getProfile = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();

    return profile;
  },
});

/**
 * Check if user has specific permission
 * Used for role-based access control
 */
export const hasPermission = query({
  args: {
    userId: v.id("users"),
    requiredRole: v.union(
      v.literal("user"),
      v.literal("moderator"),
      v.literal("admin")
    ),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) return false;

    // Role hierarchy
    const roleHierarchy: Record<string, number> = {
      user: 0,
      moderator: 1,
      admin: 2,
    };

    return roleHierarchy[profile.role] >= roleHierarchy[args.requiredRole];
  },
});

/**
 * Check if user has access to a specific feature
 */
export const hasFeatureAccess = query({
  args: {
    userId: v.id("users"),
    feature: v.union(
      v.literal("oracle_unlimited"),
      v.literal("astral_cards"),
      v.literal("synastry"),
      v.literal("advanced_transits")
    ),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .first();

    if (!profile) return false;

    // Feature matrix
    const featureMatrix: Record<string, string[]> = {
      free: [],
      cosmic_flow: ["oracle_unlimited", "astral_cards", "synastry"],
      cosmic_flow_annual: [
        "oracle_unlimited",
        "astral_cards",
        "synastry",
        "advanced_transits",
      ],
      influencer_custom: [
        "oracle_unlimited",
        "astral_cards",
        "synastry",
        "advanced_transits",
      ],
      lifetime: [
        "oracle_unlimited",
        "astral_cards",
        "synastry",
        "advanced_transits",
      ],
    };

    return featureMatrix[profile.tier]?.includes(args.feature) ?? false;
  },
});

/**
 * Get subscription history for a user
 */
export const getSubscriptionHistory = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const history = await ctx.db
      .query("subscription_history")
      .withIndex("by_user_id", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);

    return history;
  },
});

/**
 * Admin: Get all users with pagination
 */
export const getAllUsers = query({
  args: {
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify admin access
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const callerProfile = await ctx.db
      .query("profiles")
      .withIndex("by_user_id", (q) => 
        q.eq("userId", identity.subject as Id<"users">)
      )
      .first();

    if (!callerProfile || callerProfile.role !== "admin") {
      throw new Error("Unauthorized: Admin access required");
    }

    // Get users
    const users = await ctx.db
      .query("profiles")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .order("desc")
      .take(100);

    return users;
  },
});

// ============================================================================
// INTERNAL MUTATIONS (For Cron Jobs)
// ============================================================================

/**
 * Purge soft-deleted users after 30 days
 * Called by daily cron job
 */
export const purgeDeletedUsers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

    const deletedProfiles = await ctx.db
      .query("profiles")
      .withIndex("by_deleted_at")
      .filter((q) => 
        q.and(
          q.neq(q.field("deletedAt"), undefined),
          q.lt(q.field("deletedAt"), thirtyDaysAgo)
        )
      )
      .collect();

    for (const profile of deletedProfiles) {
      // Hard delete
      await ctx.db.delete(profile._id);
    }

    return { purged: deletedProfiles.length };
  },
});
