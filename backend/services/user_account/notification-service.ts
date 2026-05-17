import { Pool } from 'pg';
import { getDatabasePool } from '../database';

export type NotificationType =
  | 'usage_75'
  | 'usage_90'
  | 'usage_100'
  | 'payment_due'
  | 'payment_failed';

export interface Notification {
  id: number;
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
  readAt: Date | null;
  emailSentAt: Date | null;
  createdAt: Date;
}

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  message: string;
}

export class NotificationService {
  private pool: Pool;

  constructor() {
    this.pool = getDatabasePool();
  }

  async createNotification(input: CreateNotificationInput): Promise<Notification> {
    const result = await this.pool.query(
      `INSERT INTO notifications (user_id, type, title, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, type, title, message, read_at, email_sent_at, created_at`,
      [input.userId, input.type, input.title, input.message]
    );
    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      message: row.message,
      readAt: row.read_at,
      emailSentAt: row.email_sent_at,
      createdAt: row.created_at,
    };
  }

  async listForUser(userId: number, limit: number = 50): Promise<Notification[]> {
    const result = await this.pool.query(
      `SELECT id, user_id, type, title, message, read_at, email_sent_at, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      type: row.type,
      title: row.title,
      message: row.message,
      readAt: row.read_at,
      emailSentAt: row.email_sent_at,
      createdAt: row.created_at,
    }));
  }

  async markRead(notificationId: number, userId: number): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE notifications SET read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
      [notificationId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  /** Returns true if user already has a notification of this type since the given date (e.g. period start). */
  async hasNotificationSince(userId: number, type: NotificationType, since: Date): Promise<boolean> {
    const sinceStr = since.toISOString().split('T')[0];
    const result = await this.pool.query(
      `SELECT 1 FROM notifications
       WHERE user_id = $1 AND type = $2 AND created_at >= $3
       LIMIT 1`,
      [userId, type, sinceStr]
    );
    return result.rows.length > 0;
  }

  async setEmailSent(notificationId: number): Promise<void> {
    await this.pool.query(
      `UPDATE notifications SET email_sent_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [notificationId]
    );
  }
}

export const notificationService = new NotificationService();
