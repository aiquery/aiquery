import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16',
} as any);

/**
 * Pricing Configuration – use Stripe Price IDs from Dashboard (Products → [Product] → Pricing).
 * Env vars: STRIPE_PRICE_START_PRO_MONTHLY, STRIPE_PRICE_START_PRO_YEARLY, etc.
 * StartPro: $40/month or $388/year
 * SmartPro: $68/month or $668/year
 * Additional User: $10/month or $96/year (20% off)
 */
export const PRICING_CONFIG = {
  MONTHLY: {
    START_PRO: {
      priceId: process.env.STRIPE_PRICE_START_PRO_MONTHLY || '',
      amount: 4000,
      gst: 200,
      total: 4200,
    },
    SMART_PRO: {
      priceId: process.env.STRIPE_PRICE_SMART_PRO_MONTHLY || '',
      amount: 6800,
      gst: 340,
      total: 7140,
    },
  },
  YEARLY: {
    START_PRO: {
      priceId: process.env.STRIPE_PRICE_START_PRO_YEARLY || '',
      amount: 38800,
      gst: 1940,
      total: 40740,
    },
    SMART_PRO: {
      priceId: process.env.STRIPE_PRICE_SMART_PRO_YEARLY || '',
      amount: 66800,
      gst: 3340,
      total: 70140,
    },
  },
  ADDITIONAL_USER_MONTHLY: {
    priceId: process.env.STRIPE_PRICE_ADDITIONAL_USER_MONTHLY || '',
    amount: 1000,
    gst: 50,
    total: 1050,
  },
  ADDITIONAL_USER_YEARLY: {
    priceId: process.env.STRIPE_PRICE_ADDITIONAL_USER_YEARLY || '',
    amount: 9600, // $96/year
    gst: 480,
    total: 10080,
  },
};

/**
 * Map a Stripe price id to our plan name and type (for webhook sync).
 */
export function getPlanFromStripePriceId(priceId: string): {
  planName: 'startpro' | 'smartpro';
  planType: 'monthly' | 'annual';
} | null {
  const c = PRICING_CONFIG;
  if (priceId === c.MONTHLY.START_PRO.priceId) return { planName: 'startpro', planType: 'monthly' };
  if (priceId === c.YEARLY.START_PRO.priceId) return { planName: 'startpro', planType: 'annual' };
  if (priceId === c.MONTHLY.SMART_PRO.priceId) return { planName: 'smartpro', planType: 'monthly' };
  if (priceId === c.YEARLY.SMART_PRO.priceId) return { planName: 'smartpro', planType: 'annual' };
  return null;
}

/**
 * Create a Stripe customer
 */
export async function createCustomer(email: string, name: string) {
  try {
    const customer = await stripe.customers.create({
      email,
      name,
    });
    return customer;
  } catch (error) {
    console.error('Error creating customer:', error);
    throw error;
  }
}

/**
 * Create checkout session for subscription.
 * clientReferenceId: optional app user id (string) so webhook can sync to our DB.
 */
export async function createCheckoutSession(
  customerId: string,
  plan: 'START_PRO' | 'SMART_PRO',
  billingPeriod: 'monthly' | 'yearly',
  additionalMembers: number = 0,
  successUrl: string,
  cancelUrl: string,
  clientReferenceId?: string
) {
  try {
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];

    // Add main plan
    const planKey = billingPeriod.toUpperCase() as 'MONTHLY' | 'YEARLY';
    const planConfig = PRICING_CONFIG[planKey][plan];
    if (!planConfig.priceId) {
      throw new Error(`Stripe price not configured for ${plan} ${billingPeriod}. Set STRIPE_PRICE_* env vars.`);
    }
    lineItems.push({
      price: planConfig.priceId,
      quantity: 1,
    });

    // Add additional users if any (use monthly or yearly price per billing period)
    if (additionalMembers > 0) {
      const addUserPrice =
        billingPeriod === 'yearly'
          ? PRICING_CONFIG.ADDITIONAL_USER_YEARLY.priceId
          : PRICING_CONFIG.ADDITIONAL_USER_MONTHLY.priceId;
      if (addUserPrice) {
        lineItems.push({
          price: addUserPrice,
          quantity: additionalMembers,
        });
      }
    }

    const params: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      line_items: lineItems,
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      billing_address_collection: 'required',
    };
    if (clientReferenceId) params.client_reference_id = clientReferenceId;

    const session = await stripe.checkout.sessions.create(params);
    return session;
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
}

/**
 * Create checkout session for adding additional users to existing subscription.
 */
export async function createCheckoutSessionForAdditionalUsers(
  customerId: string,
  addUserPriceId: string,
  quantity: number,
  successUrl: string,
  cancelUrl: string,
  clientReferenceId?: string,
  existingSubscriptionId?: string
) {
  try {
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price: addUserPriceId,
        quantity: quantity,
      },
    ];

    const params: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      line_items: lineItems,
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      billing_address_collection: 'required',
      metadata: {
        type: 'add_users',
        quantity: String(quantity),
        existing_subscription_id: existingSubscriptionId || '',
      },
    };
    if (clientReferenceId) params.client_reference_id = clientReferenceId;

    const session = await stripe.checkout.sessions.create(params);
    return session;
  } catch (error) {
    console.error('Error creating checkout session for additional users:', error);
    throw error;
  }
}

/**
 * Get customer subscriptions
 */
export async function getCustomerSubscriptions(customerId: string) {
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 100,
    });
    return subscriptions.data;
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    throw error;
  }
}

/**
 * Retrieve a subscription by id (for webhook sync).
 */
export async function getCheckoutSessionById(sessionId: string): Promise<Stripe.Checkout.Session | null> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return session;
  } catch (error) {
    console.error('Error retrieving checkout session:', error);
    return null;
  }
}

export async function getSubscriptionById(subscriptionId: string): Promise<Stripe.Subscription> {
  return stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * Update subscription items (for adding users to existing subscription)
 */
export async function updateSubscriptionItems(
  subscriptionId: string,
  items: Stripe.SubscriptionUpdateParams.Item[]
): Promise<Stripe.Subscription> {
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      items: items,
      proration_behavior: 'create_prorations', // Prorate charges for mid-cycle changes
    });
    return subscription;
  } catch (error) {
    console.error('Error updating subscription items:', error);
    throw error;
  }
}

/**
 * Cancel subscription (immediately).
 * Stripe Node SDK uses .cancel() for subscriptions (not .del()).
 */
export async function cancelSubscription(subscriptionId: string) {
  try {
    const subscription = await stripe.subscriptions.cancel(subscriptionId);
    return subscription;
  } catch (error) {
    console.error('Error canceling subscription:', error);
    throw error;
  }
}

/**
 * Set whether a subscription cancels at period end (undo "cancel at period end" by passing false).
 */
export async function setSubscriptionCancelAtPeriodEnd(
  subscriptionId: string,
  cancelAtPeriodEnd: boolean
): Promise<Stripe.Subscription> {
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: cancelAtPeriodEnd,
    });
    return subscription;
  } catch (error) {
    console.error('Error updating subscription cancel_at_period_end:', error);
    throw error;
  }
}

/**
 * Update subscription
 */
export async function updateSubscription(
  subscriptionId: string,
  plan: 'START_PRO' | 'SMART_PRO',
  billingPeriod: 'monthly' | 'yearly',
  additionalMembers: number = 0
) {
  try {
    const planKey = billingPeriod.toUpperCase() as 'MONTHLY' | 'YEARLY';
    const planConfig = PRICING_CONFIG[planKey][plan];

    // Get current subscription
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Update subscription items
    const items = [];

    // Keep existing items and update them
    for (const item of subscription.items.data) {
      if (item.price.id === planConfig.priceId) {
        // Already on this plan
        items.push({
          id: item.id,
          price: planConfig.priceId,
          quantity: 1,
        });
      } else if (
        item.price.id === PRICING_CONFIG.ADDITIONAL_USER_MONTHLY.priceId ||
        item.price.id === PRICING_CONFIG.ADDITIONAL_USER_YEARLY.priceId
      ) {
        // Update additional members
        if (additionalMembers > 0) {
          items.push({
            id: item.id,
            quantity: additionalMembers,
          });
        } else {
          // Remove additional members
          items.push({
            id: item.id,
            deleted: true,
          });
        }
      } else {
        // Different plan - remove old one
        items.push({
          id: item.id,
          deleted: true,
        });
      }
    }

    // Add new plan if not already in subscription
    const hasNewPlan = subscription.items.data.some(
      (item) => item.price.id === planConfig.priceId
    );
    if (!hasNewPlan) {
      items.push({
        price: planConfig.priceId,
        quantity: 1,
      });
    }

    // Add additional members if not already in subscription
    const addUserPriceId =
      billingPeriod === 'yearly'
        ? PRICING_CONFIG.ADDITIONAL_USER_YEARLY.priceId
        : PRICING_CONFIG.ADDITIONAL_USER_MONTHLY.priceId;
    const hasAdditionalMembers = subscription.items.data.some(
      (item) =>
        item.price.id === PRICING_CONFIG.ADDITIONAL_USER_MONTHLY.priceId ||
        item.price.id === PRICING_CONFIG.ADDITIONAL_USER_YEARLY.priceId
    );
    if (additionalMembers > 0 && !hasAdditionalMembers && addUserPriceId) {
      items.push({
        price: addUserPriceId,
        quantity: additionalMembers,
      });
    }

    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      items,
      proration_behavior: 'create_prorations',
    });

    return updatedSubscription;
  } catch (error) {
    console.error('Error updating subscription:', error);
    throw error;
  }
}

/**
 * Get customer invoices
 */
export async function getCustomerInvoices(customerId: string) {
  try {
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 100,
    });
    return invoices.data;
  } catch (error) {
    console.error('Error fetching invoices:', error);
    throw error;
  }
}

/**
 * Create billing portal session
 */
export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string
) {
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session;
  } catch (error) {
    console.error('Error creating billing portal session:', error);
    throw error;
  }
}

/**
 * Verify webhook signature
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): any {
  try {
    const event = stripe.webhooks.constructEvent(body, signature, secret);
    return event;
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    throw error;
  }
}

/**
 * Handle checkout.session.completed
 */
export async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  try {
    const customerId = session.customer as string;
    const subscriptionId = session.subscription as string;

    // Get subscription details
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Update your database with subscription info
    return {
      customerId,
      subscriptionId,
      status: subscription.status,
      items: subscription.items.data,
    };
  } catch (error) {
    console.error('Error handling checkout session completed:', error);
    throw error;
  }
}

/**
 * Handle customer.subscription.updated
 */
export async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  try {
    // Update your database with new subscription info
    return {
      subscriptionId: subscription.id,
      status: subscription.status,
      items: subscription.items.data,
      currentPeriodEnd: new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000),
    };
  } catch (error) {
    console.error('Error handling subscription updated:', error);
    throw error;
  }
}

/**
 * Handle customer.subscription.deleted
 */
export async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  try {
    // Update your database to mark subscription as canceled
    return {
      subscriptionId: subscription.id,
      status: 'canceled',
      canceledAt: new Date(subscription.canceled_at ? subscription.canceled_at * 1000 : Date.now()),
    };
  } catch (error) {
    console.error('Error handling subscription deleted:', error);
    throw error;
  }
}

/**
 * Handle invoice.payment_succeeded
 */
export async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
  try {
    // Update your database with payment info
    return {
      invoiceId: invoice.id,
      customerId: invoice.customer,
      amount: invoice.amount_paid,
      status: 'paid',
      paidAt: new Date((invoice as unknown as { paid?: number }).paid ? (invoice as unknown as { paid: number }).paid * 1000 : Date.now()),
    };
  } catch (error) {
    console.error('Error handling invoice payment succeeded:', error);
    throw error;
  }
}

/**
 * Handle invoice.payment_failed
 */
export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  try {
    // Update your database with failed payment info
    return {
      invoiceId: invoice.id,
      customerId: invoice.customer,
      amount: invoice.amount_due,
      status: 'failed',
      failedAt: new Date(),
    };
  } catch (error) {
    console.error('Error handling invoice payment failed:', error);
    throw error;
  }
}

export default stripe;
