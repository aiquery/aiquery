import { getDatabasePool } from '../database';

/**
 * Get Stripe customer id for an app user. Returns null if not linked.
 */
export async function getStripeCustomerIdByUserId(userId: number): Promise<string | null> {
  const pool = getDatabasePool();
  const r = await pool.query(
    'SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1',
    [userId]
  );
  if (r.rows.length === 0) return null;
  return r.rows[0].stripe_customer_id;
}

/**
 * Link a Stripe customer id to an app user. Upserts by user_id.
 */
export async function linkStripeCustomer(userId: number, stripeCustomerId: string): Promise<void> {
  const pool = getDatabasePool();
  await pool.query(
    `INSERT INTO stripe_customers (user_id, stripe_customer_id, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id)
     DO UPDATE SET stripe_customer_id = $2, updated_at = CURRENT_TIMESTAMP`,
    [userId, stripeCustomerId]
  );
}

/**
 * Get app user_id for a Stripe customer id. Returns null if not found.
 */
export async function getUserIdByStripeCustomerId(stripeCustomerId: string): Promise<number | null> {
  const pool = getDatabasePool();
  const r = await pool.query(
    'SELECT user_id FROM stripe_customers WHERE stripe_customer_id = $1',
    [stripeCustomerId]
  );
  if (r.rows.length === 0) return null;
  return r.rows[0].user_id;
}
