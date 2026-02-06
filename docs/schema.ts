// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // User profiles table (linked to Convex Auth users)
  profiles: defineTable({
    // Link to Convex Auth user
    userId: v.id("users"),
    
    // Basic Profile Information
    name: v.string(),
    email: v.string(), // Denormalized for quick access
    avatarUrl: v.optional(v.string()),
    
    // Optional Anti-Bot / Security
    phone: v.optional(v.string()), // E.164 format: +15551234567
    phoneVerified: v.optional(v.boolean()),
    
    // Subscription Management
    tier: v.union(
      v.literal("free"),
      v.literal("cosmic_flow"), // $9.99/month tier
      v.literal("cosmic_flow_annual"),
      v.literal("influencer_custom"), // Custom OTC deals
      v.literal("lifetime")
    ),
    subscriptionStatus: v.union(
      v.literal("active"),
      v.literal("trialing"), // 7-day free trial
      v.literal("past_due"), // Payment failed
      v.literal("canceled"),
      v.literal("paused") // Future feature
    ),
    subscriptionStartedAt: v.optional(v.number()),
    subscriptionEndsAt: v.optional(v.number()),
    
    // Role-Based Access Control
    role: v.union(
      v.literal("user"), // Default
      v.literal("moderator"),
      v.literal("admin")
    ),
    
    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
    deletedAt: v.optional(v.number()), // Soft delete
    
    // Feature Flags
    featureFlags: v.optional(
      v.object({
        earlyAccessOracle: v.optional(v.boolean()),
        betaFeatures: v.optional(v.boolean()),
      })
    ),
    
    // User Preferences
    preferences: v.optional(
      v.object({
        timezone: v.optional(v.string()),
        dailySparkTime: v.optional(v.string()), // "07:00"
        notificationsEnabled: v.optional(v.boolean()),
        language: v.optional(v.string()),
      })
    ),
  })
    // Indexes for performance
    .index("by_user_id", ["userId"])
    .index("by_email", ["email"])
    .index("by_tier", ["tier"])
    .index("by_subscription_status", ["subscriptionStatus"])
    .index("by_role", ["role"])
    .index("by_created_at", ["createdAt"])
    .index("by_deleted_at", ["deletedAt"])
    .index("by_tier_and_status", ["tier", "subscriptionStatus"]),

  // Subscription history for analytics and audit trail
  subscription_history: defineTable({
    userId: v.id("users"),
    profileId: v.id("profiles"),
    
    // Event type
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
    
    // State tracking
    previousTier: v.optional(v.string()),
    newTier: v.string(),
    previousStatus: v.optional(v.string()),
    newStatus: v.string(),
    
    // Revenue tracking
    amount: v.optional(v.number()), // USD cents
    currency: v.optional(v.string()),
    
    // External payment provider data
    paymentProviderId: v.optional(v.string()),
    externalTransactionId: v.optional(v.string()),
    
    createdAt: v.number(),
    
    metadata: v.optional(
      v.object({
        source: v.optional(v.string()), // "web", "ios", "android"
        couponCode: v.optional(v.string()),
      })
    ),
  })
    .index("by_user_id", ["userId"])
    .index("by_profile_id", ["profileId"])
    .index("by_event", ["event"])
    .index("by_created_at", ["createdAt"]),
});
