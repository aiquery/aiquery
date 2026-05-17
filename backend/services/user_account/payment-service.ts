import { Pool } from 'pg';
import { getDatabasePool } from '../database';
import { subscriptionService, PlanName, PlanType } from './subscription-service';

export type PaymentItemType = 'plan' | 'add_users';

export interface Payment {
  id: number;
  userId: number;
  subscriptionId?: number | null;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  paymentMethod?: string | null;
  stripePaymentIntentId?: string | null;
  stripeInvoiceId?: string | null;
  planName: PlanName;
  planType: PlanType;
  itemType: PaymentItemType;
  billingPeriodStart?: Date | null;
  billingPeriodEnd?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePaymentInput {
  userId: number;
  subscriptionId?: number;
  amount: number;
  currency?: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  paymentMethod?: string;
  stripePaymentIntentId?: string;
  stripeInvoiceId?: string;
  planName: PlanName;
  planType: PlanType;
  itemType?: PaymentItemType;
  billingPeriodStart?: Date;
  billingPeriodEnd?: Date;
}

export class PaymentService {
  private pool: Pool;

  constructor() {
    this.pool = getDatabasePool();
  }

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    const itemType = input.itemType ?? 'plan';
    const result = await this.pool.query(
      `INSERT INTO payments 
       (user_id, subscription_id, amount, currency, status, payment_method,
        stripe_payment_intent_id, stripe_invoice_id, plan_name, plan_type, item_type,
        billing_period_start, billing_period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        input.userId,
        input.subscriptionId || null,
        input.amount,
        input.currency || 'USD',
        input.status,
        input.paymentMethod || null,
        input.stripePaymentIntentId || null,
        input.stripeInvoiceId || null,
        input.planName,
        input.planType,
        itemType,
        input.billingPeriodStart || null,
        input.billingPeriodEnd || null
      ]
    );

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      subscriptionId: row.subscription_id,
      amount: parseFloat(row.amount),
      currency: row.currency,
      status: row.status,
      paymentMethod: row.payment_method,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      stripeInvoiceId: row.stripe_invoice_id,
      planName: row.plan_name,
      planType: row.plan_type,
      itemType: (row.item_type || itemType) as PaymentItemType,
      billingPeriodStart: row.billing_period_start,
      billingPeriodEnd: row.billing_period_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getPaymentsByUser(userId: number, limit: number = 50): Promise<Payment[]> {
    const result = await this.pool.query(
      `SELECT * FROM payments 
       WHERE user_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      subscriptionId: row.subscription_id,
      amount: parseFloat(row.amount),
      currency: row.currency,
      status: row.status,
      paymentMethod: row.payment_method,
      stripePaymentIntentId: row.stripe_payment_intent_id,
      stripeInvoiceId: row.stripe_invoice_id,
      planName: row.plan_name,
      planType: row.plan_type,
      itemType: (row.item_type || 'plan') as PaymentItemType,
      billingPeriodStart: row.billing_period_start,
      billingPeriodEnd: row.billing_period_end,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async updatePaymentStatus(
    paymentId: number,
    status: 'pending' | 'succeeded' | 'failed' | 'refunded'
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE payments 
       SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [status, paymentId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  // Plan pricing configuration
  getPlanPrice(planName: PlanName, planType: PlanType): number {
    const prices: Record<PlanName, { monthly: number; annual: number }> = {
      free: { monthly: 0, annual: 0 },
      startpro: { monthly: 40, annual: 388 }, // $40/month or $388/year (20% off)
      smartpro: { monthly: 68, annual: 668 }, // $68/month or $668/year (20% off)
      enterprise: { monthly: 0, annual: 0 } // Custom pricing
    };

    return planType === 'annual' ? prices[planName].annual : prices[planName].monthly;
  }
}

export const paymentService = new PaymentService();
