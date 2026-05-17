import { Pool } from 'pg';
import { getDatabasePool } from '../database';

export type PlanName = 'free' | 'startpro' | 'smartpro' | 'enterprise';
export type PlanType = 'monthly' | 'annual';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing' | 'incomplete';

export interface Subscription {
  id: number;
  userId: number;
  planName: PlanName;
  planType: PlanType;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  extraUsers: number;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlanLimits {
  maxUsers: number;
  maxWorkspaces: number;
  maxQueriesPerMonth: number;
  maxTablesPerDataSource: number;
  hasDataSourceCustomization: boolean;
  hasBusinessCustomization: boolean;
  hasAccountPermissions: boolean;
  supportLevel: 'none' | 'standard' | 'priority' | 'dedicated';
}

export interface CreateSubscriptionInput {
  userId: number;
  planName: PlanName;
  planType: PlanType;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
}

export class SubscriptionService {
  private pool: Pool;

  constructor() {
    this.pool = getDatabasePool();
  }

  // Plan limits configuration
  private getPlanLimits(planName: PlanName): PlanLimits {
    const limits: Record<PlanName, PlanLimits> = {
      free: {
        maxUsers: 1,
        maxWorkspaces: 1,
        maxQueriesPerMonth: 200,
        maxTablesPerDataSource: 2,
        hasDataSourceCustomization: false,
        hasBusinessCustomization: false,
        hasAccountPermissions: false,
        supportLevel: 'none'
      },
      startpro: {
        maxUsers: 3,
        maxWorkspaces: 3,
        maxQueriesPerMonth: 300,
        maxTablesPerDataSource: 5,
        hasDataSourceCustomization: true,
        hasBusinessCustomization: true,
        hasAccountPermissions: true,
        supportLevel: 'standard'
      },
      smartpro: {
        maxUsers: 6,
        maxWorkspaces: 6,
        maxQueriesPerMonth: 800,
        maxTablesPerDataSource: 10,
        hasDataSourceCustomization: true,
        hasBusinessCustomization: true,
        hasAccountPermissions: true,
        supportLevel: 'priority'
      },
      enterprise: {
        maxUsers: -1, // Unlimited
        maxWorkspaces: -1, // Unlimited
        maxQueriesPerMonth: -1, // Unlimited
        maxTablesPerDataSource: -1, // Unlimited
        hasDataSourceCustomization: true,
        hasBusinessCustomization: true,
        hasAccountPermissions: true,
        supportLevel: 'dedicated'
      }
    };

    return limits[planName];
  }

  async getSubscription(userId: number): Promise<Subscription | null> {
    const result = await this.pool.query(
      'SELECT * FROM subscriptions WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      planName: row.plan_name,
      planType: row.plan_type,
      status: row.status,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      extraUsers: row.extra_users != null ? Number(row.extra_users) : 0,
      stripeSubscriptionId: row.stripe_subscription_id,
      stripeCustomerId: row.stripe_customer_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getPlanLimitsForUser(userId: number): Promise<PlanLimits> {
    const subscription = await this.getSubscription(userId);
    
    // Allow both 'active' and 'trialing' status for plan limits
    if (!subscription || (subscription.status !== 'active' && subscription.status !== 'trialing')) {
      // Default to free plan if no active/trialing subscription
      return this.getPlanLimits('free');
    }

    let planLimits = this.getPlanLimits(subscription.planName);

    // Enterprise: use admin-defined custom limits if present
    if (subscription.planName === 'enterprise') {
      const custom = await this.getCustomLimitsForUser(userId);
      if (custom) {
        planLimits = {
          maxUsers: custom.maxUsers,
          maxWorkspaces: custom.maxWorkspaces,
          maxQueriesPerMonth: custom.maxQueriesPerMonth,
          maxTablesPerDataSource: custom.maxTablesPerDataSource,
          hasDataSourceCustomization: true,
          hasBusinessCustomization: true,
          hasAccountPermissions: true,
          supportLevel: 'dedicated'
        };
      }
    }

    const extraUsers = subscription.extraUsers ?? 0;
    return {
      ...planLimits,
      maxUsers: planLimits.maxUsers === -1 ? -1 : planLimits.maxUsers + extraUsers
    };
  }

  /** Get admin-set custom limits for a user (used for Enterprise/custom plans). */
  async getCustomLimitsForUser(userId: number): Promise<{
    maxUsers: number;
    maxWorkspaces: number;
    maxQueriesPerMonth: number;
    maxTablesPerDataSource: number;
  } | null> {
    const result = await this.pool.query(
      'SELECT max_users, max_workspaces, max_queries_per_month, max_tables_per_data_source FROM user_plan_limits WHERE user_id = $1',
      [userId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      maxUsers: row.max_users != null ? Number(row.max_users) : -1,
      maxWorkspaces: row.max_workspaces != null ? Number(row.max_workspaces) : -1,
      maxQueriesPerMonth: row.max_queries_per_month != null ? Number(row.max_queries_per_month) : -1,
      maxTablesPerDataSource: row.max_tables_per_data_source != null ? Number(row.max_tables_per_data_source) : -1
    };
  }

  /** Set or update admin-defined custom limits for a user (Enterprise/custom plan). */
  async setCustomLimitsForUser(
    userId: number,
    limits: {
      maxUsers: number;
      maxWorkspaces: number;
      maxQueriesPerMonth: number;
      maxTablesPerDataSource: number;
    }
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_plan_limits (user_id, max_users, max_workspaces, max_queries_per_month, max_tables_per_data_source, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE SET
         max_users = EXCLUDED.max_users,
         max_workspaces = EXCLUDED.max_workspaces,
         max_queries_per_month = EXCLUDED.max_queries_per_month,
         max_tables_per_data_source = EXCLUDED.max_tables_per_data_source,
         updated_at = CURRENT_TIMESTAMP`,
      [
        userId,
        limits.maxUsers,
        limits.maxWorkspaces,
        limits.maxQueriesPerMonth,
        limits.maxTablesPerDataSource
      ]
    );
  }

  /** Add extra user slots to the account. Increments extra_users for the subscription. */
  async addExtraUsers(userId: number, count: number): Promise<{ success: boolean; extraUsers: number }> {
    const sub = await this.getSubscription(userId);
    if (!sub) {
      return { success: false, extraUsers: 0 };
    }
    const result = await this.pool.query(
      `UPDATE subscriptions SET extra_users = COALESCE(extra_users, 0) + $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 RETURNING extra_users`,
      [count, userId]
    );
    if (result.rowCount === 0) return { success: false, extraUsers: sub.extraUsers };
    const extraUsers = Number(result.rows[0].extra_users);
    return { success: true, extraUsers };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<Subscription> {
    // Check if user already has a subscription
    const existing = await this.getSubscription(input.userId);
    
    if (existing) {
      // Update existing subscription
      const result = await this.pool.query(
        `UPDATE subscriptions 
         SET plan_name = $1, plan_type = $2, status = $3, 
             current_period_start = $4, current_period_end = $5,
             stripe_subscription_id = $6, stripe_customer_id = $7,
             cancel_at_period_end = FALSE, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $8
         RETURNING *`,
        [
          input.planName,
          input.planType,
          'active',
          input.currentPeriodStart,
          input.currentPeriodEnd,
          input.stripeSubscriptionId || null,
          input.stripeCustomerId || null,
          input.userId
        ]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        planName: row.plan_name,
        planType: row.plan_type,
        status: row.status,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        extraUsers: row.extra_users != null ? Number(row.extra_users) : 0,
        stripeSubscriptionId: row.stripe_subscription_id,
        stripeCustomerId: row.stripe_customer_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } else {
      // Create new subscription
      const result = await this.pool.query(
        `INSERT INTO subscriptions 
         (user_id, plan_name, plan_type, status, current_period_start, current_period_end, 
          stripe_subscription_id, stripe_customer_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          input.userId,
          input.planName,
          input.planType,
          'active',
          input.currentPeriodStart,
          input.currentPeriodEnd,
          input.stripeSubscriptionId || null,
          input.stripeCustomerId || null
        ]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        planName: row.plan_name,
        planType: row.plan_type,
        status: row.status,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        extraUsers: row.extra_users != null ? Number(row.extra_users) : 0,
        stripeSubscriptionId: row.stripe_subscription_id,
        stripeCustomerId: row.stripe_customer_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    }
  }

  async updateSubscriptionStatus(
    userId: number,
    status: SubscriptionStatus
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE subscriptions 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [status, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async cancelSubscription(userId: number, cancelAtPeriodEnd: boolean = true): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE subscriptions 
       SET cancel_at_period_end = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [cancelAtPeriodEnd, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async deleteSubscription(userId: number): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM subscriptions WHERE user_id = $1',
      [userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  // Check if user has exceeded plan limits
  async checkQueryLimit(userId: number, currentMonthQueryCount: number): Promise<{ allowed: boolean; limit: number }> {
    const limits = await this.getPlanLimitsForUser(userId);
    
    if (limits.maxQueriesPerMonth === -1) {
      return { allowed: true, limit: -1 }; // Unlimited
    }

    return {
      allowed: currentMonthQueryCount < limits.maxQueriesPerMonth,
      limit: limits.maxQueriesPerMonth
    };
  }

  async checkUserLimit(userId: number, currentUserCount: number): Promise<{ allowed: boolean; limit: number }> {
    const limits = await this.getPlanLimitsForUser(userId);
    
    if (limits.maxUsers === -1) {
      return { allowed: true, limit: -1 }; // Unlimited
    }

    return {
      allowed: currentUserCount < limits.maxUsers,
      limit: limits.maxUsers
    };
  }

  async checkWorkspaceLimit(userId: number, currentWorkspaceCount: number): Promise<{ allowed: boolean; limit: number }> {
    const limits = await this.getPlanLimitsForUser(userId);
    
    if (limits.maxWorkspaces === -1) {
      return { allowed: true, limit: -1 }; // Unlimited
    }

    return {
      allowed: currentWorkspaceCount < limits.maxWorkspaces,
      limit: limits.maxWorkspaces
    };
  }

  async checkTableLimit(userId: number, currentTableCount: number): Promise<{ allowed: boolean; limit: number }> {
    const limits = await this.getPlanLimitsForUser(userId);
    
    if (limits.maxTablesPerDataSource === -1) {
      return { allowed: true, limit: -1 }; // Unlimited
    }

    return {
      allowed: currentTableCount < limits.maxTablesPerDataSource,
      limit: limits.maxTablesPerDataSource
    };
  }
}

export const subscriptionService = new SubscriptionService();
