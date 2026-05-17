import { Pool } from 'pg';
import { getDatabasePool } from '../database';
import { subscriptionService } from './subscription-service';

export class UsageTrackingService {
  private pool: Pool;

  constructor() {
    this.pool = getDatabasePool();
  }

  /**
   * Increment query count for a user on a specific date
   */
  async incrementQueryCount(userId: number, date: Date = new Date()): Promise<void> {
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD format

    await this.pool.query(
      `INSERT INTO query_usage (user_id, query_date, query_count)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id, query_date)
       DO UPDATE SET query_count = query_usage.query_count + 1, updated_at = CURRENT_TIMESTAMP`,
      [userId, dateStr]
    );
  }

  /**
   * Get query count for a user in the current subscription period
   * Uses subscription period dates instead of calendar month
   */
  async getCurrentMonthQueryCount(userId: number): Promise<number> {
    const now = new Date();
    let periodStart: Date;
    let periodEnd: Date;

    // Get user's subscription to determine period
    const subscription = await subscriptionService.getSubscription(userId);
    
    if (subscription && (subscription.status === 'active' || subscription.status === 'trialing')) {
      // Use subscription period dates (both active and trialing subscriptions)
      periodStart = new Date(subscription.currentPeriodStart);
      periodEnd = new Date(subscription.currentPeriodEnd);
    } else {
      // No active/trialing subscription - use calendar month as fallback
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    const result = await this.pool.query(
      `SELECT SUM(query_count) as total
       FROM query_usage
       WHERE user_id = $1 
       AND query_date >= $2 
       AND query_date <= $3`,
      [
        userId,
        periodStart.toISOString().split('T')[0],
        periodEnd.toISOString().split('T')[0]
      ]
    );

    return parseInt(result.rows[0]?.total || '0', 10);
  }

  /**
   * Get query count for a user in a specific month
   */
  async getMonthQueryCount(userId: number, year: number, month: number): Promise<number> {
    const firstDayOfMonth = new Date(year, month - 1, 1);
    const lastDayOfMonth = new Date(year, month, 0);

    const result = await this.pool.query(
      `SELECT SUM(query_count) as total
       FROM query_usage
       WHERE user_id = $1 
       AND query_date >= $2 
       AND query_date <= $3`,
      [
        userId,
        firstDayOfMonth.toISOString().split('T')[0],
        lastDayOfMonth.toISOString().split('T')[0]
      ]
    );

    return parseInt(result.rows[0]?.total || '0', 10);
  }

  /**
   * Get query usage statistics for a user
   * Uses subscription periods instead of calendar months
   */
  async getUserUsageStats(userId: number): Promise<{
    currentMonth: number;
    lastMonth: number;
    total: number;
  }> {
    const currentMonth = await this.getCurrentMonthQueryCount(userId);
    
    // For last month, calculate previous subscription period
    const subscription = await subscriptionService.getSubscription(userId);
    let lastMonth = 0;
    
    if (subscription && (subscription.status === 'active' || subscription.status === 'trialing')) {
      // Calculate previous period based on subscription period length
      const periodStart = new Date(subscription.currentPeriodStart);
      const periodEnd = new Date(subscription.currentPeriodEnd);
      const periodLength = periodEnd.getTime() - periodStart.getTime();
      
      // Previous period dates
      const prevPeriodEnd = new Date(periodStart);
      prevPeriodEnd.setTime(prevPeriodEnd.getTime() - 1); // Day before current period
      const prevPeriodStart = new Date(prevPeriodEnd);
      prevPeriodStart.setTime(prevPeriodStart.getTime() - periodLength);
      
      const result = await this.pool.query(
        `SELECT SUM(query_count) as total
         FROM query_usage
         WHERE user_id = $1 
         AND query_date >= $2 
         AND query_date <= $3`,
        [
          userId,
          prevPeriodStart.toISOString().split('T')[0],
          prevPeriodEnd.toISOString().split('T')[0]
        ]
      );
      
      lastMonth = parseInt(result.rows[0]?.total || '0', 10);
    } else {
      // Fallback to calendar month
      const now = new Date();
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      lastMonth = await this.getMonthQueryCount(
        userId,
        lastMonthDate.getFullYear(),
        lastMonthDate.getMonth() + 1
      );
    }

    const totalResult = await this.pool.query(
      `SELECT SUM(query_count) as total
       FROM query_usage
       WHERE user_id = $1`,
      [userId]
    );

    const total = parseInt(totalResult.rows[0]?.total || '0', 10);

    return {
      currentMonth,
      lastMonth,
      total
    };
  }
}

export const usageTrackingService = new UsageTrackingService();
