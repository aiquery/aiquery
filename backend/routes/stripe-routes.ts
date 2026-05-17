import express, { Response, Router } from 'express';
import * as stripeService from '../services/payment/stripe-service';
import {
  getStripeCustomerIdByUserId,
  linkStripeCustomer,
  getUserIdByStripeCustomerId,
} from '../services/payment/stripe-customer-db';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth';
import { subscriptionService } from '../services/user_account/subscription-service';
import { paymentService } from '../services/user_account/payment-service';
import { getDatabasePool } from '../services/database';
import Stripe from 'stripe';

/** Stripe SDK types can vary by apiVersion; these are the shapes we use at runtime. */
interface StripeSubscriptionWithPeriod {
  current_period_start: number;
  current_period_end: number;
}
interface StripeInvoiceWithPayment {
  id: string;
  status: string;
  amount_paid: number;
  subscription?: string | { id: string };
  payment_intent?: string | { id: string };
  paid?: number;
  pdf?: string;
  due_date?: number;
}

function getInvSubscriptionId(inv: StripeInvoiceWithPayment): string | undefined {
  const s = inv.subscription;
  return typeof s === 'string' ? s : s?.id;
}
function getInvPaymentIntentId(inv: StripeInvoiceWithPayment): string | undefined {
  const p = inv.payment_intent;
  return typeof p === 'string' ? p : p?.id;
}

const router: Router = express.Router();

/** Idempotency: claim a checkout session for processing. Returns true if first to process, false if already processed. */
async function claimCheckoutSessionForProcessing(sessionId: string): Promise<boolean> {
  const pool = getDatabasePool();
  const result = await pool.query(
    `INSERT INTO processed_checkout_sessions (session_id) VALUES ($1) ON CONFLICT (session_id) DO NOTHING`,
    [sessionId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * POST /api/stripe/create-customer
 * Create a Stripe customer for the authenticated user and link to DB.
 */
router.post('/create-customer', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const email = (req.body?.email || req.userEmail || '').toString().trim();
    const name = (req.body?.name || email.split('@')[0] || 'User').toString().trim();

    if (!userId || !email) {
      return res.status(400).json({ error: 'User email is required' });
    }

    const customer = await stripeService.createCustomer(email, name);
    await linkStripeCustomer(userId, customer.id);

    res.json({
      success: true,
      customerId: customer.id,
    });
  } catch (error) {
    console.error('Error creating customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

/**
 * POST /api/stripe/create-checkout-session
 * Create a Stripe Checkout session for a plan. Uses linked Stripe customer or creates one.
 * Body: { plan, billingPeriod, additionalMembers? }
 */
router.post('/create-checkout-session', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { plan, billingPeriod, additionalMembers = 0 } = req.body;

    if (!plan || !billingPeriod) {
      return res.status(400).json({ error: 'plan and billingPeriod are required' });
    }
    if (!['START_PRO', 'SMART_PRO'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan' });
    }
    if (!['monthly', 'yearly'].includes(billingPeriod)) {
      return res.status(400).json({ error: 'Invalid billing period' });
    }

    let stripeCustomerId = await getStripeCustomerIdByUserId(userId);
    if (!stripeCustomerId) {
      const email = req.userEmail || '';
      const name = (req.body?.name || email.split('@')[0] || 'User').toString().trim();
      if (!email) {
        return res.status(400).json({ error: 'User email not found. Call create-customer or ensure token has email.' });
      }
      const customer = await stripeService.createCustomer(email, name);
      await linkStripeCustomer(userId, customer.id);
      stripeCustomerId = customer.id;
    }

    const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const successUrl = `${baseUrl}/pricing/welcome?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/app_admin?open=currentPlan`;

    console.log(`[Stripe Checkout] Creating session with successUrl: ${successUrl}, cancelUrl: ${cancelUrl}, FRONTEND_URL: ${process.env.FRONTEND_URL || 'not set'}`);

    const session = await stripeService.createCheckoutSession(
      stripeCustomerId,
      plan as 'START_PRO' | 'SMART_PRO',
      billingPeriod as 'monthly' | 'yearly',
      Number(additionalMembers) || 0,
      successUrl,
      cancelUrl,
      String(userId)
    );

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error: any) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({
      error: error?.message || 'Failed to create checkout session',
    });
  }
});

/**
 * GET /api/stripe/subscriptions
 * Query: stripeCustomerId, or use linked customer for req.userId.
 */
router.get('/subscriptions', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let stripeCustomerId = (req.query.stripeCustomerId as string) || null;
    if (!stripeCustomerId && req.userId) {
      stripeCustomerId = await getStripeCustomerIdByUserId(req.userId);
    }
    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'stripeCustomerId required or link customer via create-customer' });
    }

    const subscriptions = await stripeService.getCustomerSubscriptions(stripeCustomerId);
    res.json({
      success: true,
      subscriptions: subscriptions.map((sub) => ({
        id: sub.id,
        status: sub.status,
        items: sub.items.data.map((item) => ({
          priceId: item.price.id,
          quantity: item.quantity,
          amount: item.price.unit_amount,
        })),
        currentPeriodStart: new Date((sub as unknown as StripeSubscriptionWithPeriod).current_period_start * 1000),
        currentPeriodEnd: new Date((sub as unknown as StripeSubscriptionWithPeriod).current_period_end * 1000),
        canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      })),
    });
  } catch (error) {
    console.error('Error fetching subscriptions:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

/**
 * POST /api/stripe/cancel-subscription
 * Body: { subscriptionId }
 */
router.post('/cancel-subscription', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subscriptionId } = req.body;
    if (!subscriptionId) {
      return res.status(400).json({ error: 'subscriptionId is required' });
    }
    const subscription = await stripeService.cancelSubscription(subscriptionId);
    res.json({
      success: true,
      message: 'Subscription canceled successfully',
      subscription: { id: subscription.id, status: subscription.status },
    });
  } catch (error) {
    console.error('Error canceling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * POST /api/stripe/update-subscription
 * Body: { subscriptionId, plan, billingPeriod, additionalMembers? }
 */
router.post('/update-subscription', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { subscriptionId, plan, billingPeriod, additionalMembers = 0 } = req.body;
    if (!subscriptionId || !plan || !billingPeriod) {
      return res.status(400).json({ error: 'subscriptionId, plan, and billingPeriod are required' });
    }
    const subscription = await stripeService.updateSubscription(
      subscriptionId,
      plan as 'START_PRO' | 'SMART_PRO',
      billingPeriod as 'monthly' | 'yearly',
      Number(additionalMembers) || 0
    );
    res.json({
      success: true,
      message: 'Subscription updated successfully',
      subscription: {
        id: subscription.id,
        status: subscription.status,
        items: subscription.items.data.map((item) => ({
          priceId: item.price.id,
          quantity: item.quantity,
        })),
      },
    });
  } catch (error) {
    console.error('Error updating subscription:', error);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

/**
 * GET /api/stripe/invoices
 * Query: stripeCustomerId or use linked customer.
 */
router.get('/invoices', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let stripeCustomerId = (req.query.stripeCustomerId as string) || null;
    if (!stripeCustomerId && req.userId) {
      stripeCustomerId = await getStripeCustomerIdByUserId(req.userId);
    }
    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'stripeCustomerId required or link customer first' });
    }
    const invoices = await stripeService.getCustomerInvoices(stripeCustomerId);
    res.json({
      success: true,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        number: inv.number,
        amount: inv.amount_paid,
        amountDue: inv.amount_due,
        status: inv.status,
        paidAt: (inv as StripeInvoiceWithPayment).paid ? new Date((inv as StripeInvoiceWithPayment).paid! * 1000) : null,
        dueDate: (inv as StripeInvoiceWithPayment).due_date ? new Date((inv as StripeInvoiceWithPayment).due_date! * 1000) : null,
        pdfUrl: (inv as StripeInvoiceWithPayment).pdf,
      })),
    });
  } catch (error) {
    console.error('Error fetching invoices:', error);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

/**
 * POST /api/stripe/verify-checkout-session
 * Verify a checkout session and create/update subscription if needed.
 * Body: { sessionId }
 */
router.post('/verify-checkout-session', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }
    
    console.log(`[Verify Checkout] Verifying session ${sessionId} for userId=${userId}`);
    
    // Retrieve the checkout session from Stripe
    const session = await stripeService.getCheckoutSessionById(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Checkout session not found' });
    }
    
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }
    
    const customerId = (session.customer as string) || '';
    const subscriptionId = (session.subscription as string) || '';
    
    if (!subscriptionId) {
      return res.status(400).json({ error: 'No subscription found in checkout session' });
    }
    
    // Verify the session belongs to this user
    const userIdFromRef = session.client_reference_id
      ? parseInt(session.client_reference_id, 10)
      : null;
    
    if (userIdFromRef !== userId) {
      const linkedUserId = await getUserIdByStripeCustomerId(customerId);
      if (linkedUserId !== userId) {
        return res.status(403).json({ error: 'Checkout session does not belong to this user' });
      }
    }
    
    // Check if this is for adding users
    const isAddUsers = session.metadata?.type === 'add_users';
    const addUsersQuantity = session.metadata?.quantity ? parseInt(session.metadata.quantity, 10) : 0;
    const existingSubscriptionId = session.metadata?.existing_subscription_id;
    
    if (isAddUsers && addUsersQuantity > 0 && existingSubscriptionId) {
      // Idempotency: prevent double-processing (webhook and verify both fire for same checkout)
      const claimed = await claimCheckoutSessionForProcessing(sessionId);
      if (!claimed) {
        console.log(`[Verify Checkout] Session ${sessionId} already processed, skipping (idempotent)`);
        const existingSub = await subscriptionService.getSubscription(userId);
        return res.json({
          success: true,
          message: `User slot(s) already added`,
          subscription: existingSub,
        });
      }
      // Handle add users checkout
      console.log(`[Verify Checkout] Processing add users checkout: quantity=${addUsersQuantity}, existingSubscriptionId=${existingSubscriptionId}, sessionId=${sessionId}`);
      
      const existingSub = await subscriptionService.getSubscription(userId);
      if (!existingSub) {
        console.error(`[Verify Checkout] No subscription found for userId=${userId}`);
        return res.status(400).json({ error: 'No subscription found. Please upgrade to a plan first.' });
      }
      
      if (existingSub.stripeSubscriptionId !== existingSubscriptionId) {
        console.error(`[Verify Checkout] Subscription mismatch: expected=${existingSubscriptionId}, actual=${existingSub.stripeSubscriptionId}`);
        return res.status(400).json({ error: 'Subscription mismatch. Please contact support.' });
      }
      
      const stripeSub = await stripeService.getSubscriptionById(subscriptionId);
      const addUserPriceId = stripeSub.items.data[0]?.price?.id;
      
      if (!addUserPriceId) {
        return res.status(400).json({ error: 'Could not determine additional user price' });
      }
      
      // Update existing subscription to add users
      const existingStripeSub = await stripeService.getSubscriptionById(existingSubscriptionId);
      
      // Check for existing additional user items (could be monthly or yearly)
      const additionalUserPriceIds = [
        process.env.STRIPE_PRICE_ADDITIONAL_USER_MONTHLY,
        process.env.STRIPE_PRICE_ADDITIONAL_USER_YEARLY,
      ].filter(Boolean) as string[];
      
      const existingAddUserItem = existingStripeSub.items.data.find(
        item => additionalUserPriceIds.includes(item.price.id)
      );
      
      console.log(`[Verify Checkout] Existing add user item: ${existingAddUserItem ? `found (id=${existingAddUserItem.id}, qty=${existingAddUserItem.quantity})` : 'not found'}`);
      
      const itemsToUpdate: Stripe.SubscriptionUpdateParams.Item[] = [];
      
      // Keep all existing items EXCEPT any existing additional user items
      for (const item of existingStripeSub.items.data) {
        if (!additionalUserPriceIds.includes(item.price.id)) {
          // Keep this item as-is
          itemsToUpdate.push({
            id: item.id,
            price: item.price.id,
            quantity: item.quantity || 1,
          });
        }
      }
      
      // Add/update additional user item
      if (existingAddUserItem) {
        // Update existing item quantity
        itemsToUpdate.push({
          id: existingAddUserItem.id,
          quantity: (existingAddUserItem.quantity || 0) + addUsersQuantity,
        });
        console.log(`[Verify Checkout] Updating existing item ${existingAddUserItem.id}: ${existingAddUserItem.quantity} + ${addUsersQuantity} = ${(existingAddUserItem.quantity || 0) + addUsersQuantity}`);
      } else {
        // Add new item
        itemsToUpdate.push({
          price: addUserPriceId,
          quantity: addUsersQuantity,
        });
        console.log(`[Verify Checkout] Adding new item with price ${addUserPriceId}, quantity ${addUsersQuantity}`);
      }
      
      // Get invoice BEFORE canceling subscription (so we can create payment record)
      let invoiceId: string | null = (session.invoice as string) || null;
      let paymentAmount = 0;
      let paymentIntentId: string | null = null;
      
      try {
        const invoices = await stripeService.getCustomerInvoices(customerId);
        const latestInvoice = invoices.find(inv => 
          getInvSubscriptionId(inv as StripeInvoiceWithPayment) === subscriptionId && inv.status === 'paid'
        ) ?? (invoiceId ? invoices.find(inv => inv.id === invoiceId) : null);
        
        if (latestInvoice) {
          invoiceId = latestInvoice.id;
          paymentAmount = latestInvoice.amount_paid / 100;
          paymentIntentId = getInvPaymentIntentId(latestInvoice as StripeInvoiceWithPayment) ?? null;
          console.log(`[Verify Checkout] Found invoice: ${invoiceId}, amount: $${paymentAmount}`);
        } else {
          // Calculate from subscription items if invoice not found
          for (const item of stripeSub.items.data) {
            const unitAmount = item.price.unit_amount || 0;
            const quantity = item.quantity || 1;
            paymentAmount += (unitAmount * quantity) / 100;
          }
          console.log(`[Verify Checkout] No invoice found, calculated amount: $${paymentAmount}`);
        }
      } catch (invoiceError) {
        console.warn(`[Verify Checkout] Could not fetch invoice, calculating from items:`, invoiceError);
        // Calculate from subscription items
        for (const item of stripeSub.items.data) {
          const unitAmount = item.price.unit_amount || 0;
          const quantity = item.quantity || 1;
          paymentAmount += (unitAmount * quantity) / 100;
        }
      }
      
      await stripeService.updateSubscriptionItems(existingSubscriptionId, itemsToUpdate);
      console.log(`[Verify Checkout] ✅ Updated Stripe subscription items`);
      
      // Update database
      const result = await subscriptionService.addExtraUsers(userId, addUsersQuantity);
      if (!result.success) {
        console.error(`[Verify Checkout] Failed to add users to database:`, result);
        return res.status(500).json({ error: 'Failed to update user count in database' });
      }
      console.log(`[Verify Checkout] ✅ Added ${addUsersQuantity} users. New extra_users: ${result.extraUsers}`);
      
      // Cancel the temporary subscription
      try {
        await stripeService.cancelSubscription(subscriptionId);
        console.log(`[Verify Checkout] ✅ Cancelled temporary subscription ${subscriptionId}`);
      } catch (cancelError) {
        console.warn(`[Verify Checkout] Could not cancel temporary subscription:`, cancelError);
      }
      
      // Create payment record
      try {
        // Check if payment already exists
        const existingPayments = await paymentService.getPaymentsByUser(userId, 100);
        const paymentExists = existingPayments.some(p => 
          invoiceId ? p.stripeInvoiceId === invoiceId : false
        );
        
        if (!paymentExists && paymentAmount > 0) {
          await paymentService.createPayment({
            userId,
            subscriptionId: existingSub.id,
            amount: paymentAmount,
            currency: 'USD',
            status: 'succeeded',
            paymentMethod: 'stripe',
            stripePaymentIntentId: paymentIntentId ?? undefined,
            stripeInvoiceId: invoiceId ?? undefined,
            planName: existingSub.planName,
            planType: existingSub.planType,
            itemType: 'add_users',
            billingPeriodStart: existingSub.currentPeriodStart,
            billingPeriodEnd: existingSub.currentPeriodEnd,
          });
          console.log(`[Verify Checkout] ✅ Payment record created for additional users: $${paymentAmount}, invoiceId=${invoiceId}`);
        } else if (paymentExists) {
          console.log(`[Verify Checkout] Payment record already exists for invoice ${invoiceId}`);
        } else {
          console.warn(`[Verify Checkout] Payment amount is 0, skipping payment record`);
        }
      } catch (paymentError: any) {
        console.error(`[Verify Checkout] Error creating payment record:`, paymentError);
        // Don't fail the request, but log the error
      }
      
      return res.json({
        success: true,
        message: `Successfully added ${addUsersQuantity} user slot(s)`,
        subscription: existingSub,
      });
    }
    
    // Regular subscription checkout flow
    // Check if subscription already exists
    const existingSub = await subscriptionService.getSubscription(userId);
    if (existingSub && existingSub.stripeSubscriptionId === subscriptionId) {
      console.log(`[Verify Checkout] Subscription already exists for userId=${userId}`);
      return res.json({
        success: true,
        message: 'Subscription already active',
        subscription: existingSub,
      });
    }
    
    // Create/update subscription from Stripe subscription
    const stripeSub = await stripeService.getSubscriptionById(subscriptionId);
    const periodStart = new Date((stripeSub as unknown as StripeSubscriptionWithPeriod).current_period_start * 1000);
    const periodEnd = new Date((stripeSub as unknown as StripeSubscriptionWithPeriod).current_period_end * 1000);
    
    // Get invoice/payment details
    let invoiceId: string | null = null;
    let paymentAmount = 0;
    let paymentIntentId: string | null = null;
    
    try {
      const invoices = await stripeService.getCustomerInvoices(customerId);
      const latestInvoice = invoices.find(inv =>
        getInvSubscriptionId(inv as StripeInvoiceWithPayment) === subscriptionId && inv.status === 'paid'
      );
      if (latestInvoice) {
        invoiceId = latestInvoice.id;
        paymentAmount = latestInvoice.amount_paid / 100; // Convert from cents to dollars
        paymentIntentId = getInvPaymentIntentId(latestInvoice as StripeInvoiceWithPayment) ?? null;
      }
    } catch (invoiceError) {
      console.warn(`[Verify Checkout] Could not fetch invoice:`, invoiceError);
    }
    
    // If no invoice found, calculate from subscription items
    if (paymentAmount === 0) {
      for (const item of stripeSub.items.data) {
        const unitAmount = item.price.unit_amount || 0;
        const quantity = item.quantity || 1;
        paymentAmount += (unitAmount * quantity) / 100; // Convert from cents
      }
    }
    
    let subscriptionCreated = false;
    for (const item of stripeSub.items.data) {
      const mapped = stripeService.getPlanFromStripePriceId(item.price.id);
      if (mapped) {
        const result = await subscriptionService.createSubscription({
          userId,
          planName: mapped.planName,
          planType: mapped.planType,
          stripeSubscriptionId: subscriptionId,
          stripeCustomerId: customerId,
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        });
        console.log(`[Verify Checkout] ✅ Subscription created/updated for userId=${userId}, plan=${mapped.planName}`);
        
        // Create payment record if it doesn't exist
        try {
          // Check if payment already exists for this subscription
          const existingPayments = await paymentService.getPaymentsByUser(userId, 100);
          const paymentExists = existingPayments.some(p => 
            p.stripeInvoiceId === invoiceId || 
            (p.subscriptionId === result.id && p.billingPeriodStart?.getTime() === periodStart.getTime())
          );
          
          if (!paymentExists) {
            await paymentService.createPayment({
              userId,
              subscriptionId: result.id,
              amount: paymentAmount,
              currency: 'USD',
              status: 'succeeded',
              paymentMethod: 'stripe',
              stripePaymentIntentId: paymentIntentId ?? undefined,
              stripeInvoiceId: invoiceId ?? undefined,
              planName: mapped.planName,
              planType: mapped.planType,
              itemType: 'plan',
              billingPeriodStart: periodStart,
              billingPeriodEnd: periodEnd,
            });
            console.log(`[Verify Checkout] ✅ Payment record created: $${paymentAmount} for plan ${mapped.planName}`);
          } else {
            console.log(`[Verify Checkout] Payment record already exists for this subscription`);
          }
        } catch (paymentError: any) {
          console.error(`[Verify Checkout] Error creating payment record:`, paymentError);
          // Don't fail the request if payment record creation fails
        }
        
        subscriptionCreated = true;
        return res.json({
          success: true,
          message: 'Subscription activated successfully',
          subscription: result,
        });
      }
    }
    
    if (!subscriptionCreated) {
      return res.status(400).json({ error: 'Could not map subscription plan from Stripe price IDs' });
    }
  } catch (error: any) {
    console.error('[Verify Checkout] Error:', error);
    res.status(500).json({ error: error?.message || 'Failed to verify checkout session' });
  }
});

/**
 * POST /api/stripe/create-checkout-session-add-users
 * Create a Stripe Checkout session for adding additional users to existing subscription.
 * Body: { count, billingPeriod }
 */
router.post('/create-checkout-session-add-users', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { count, billingPeriod } = req.body;
    
    const numUsers = typeof count === 'number' ? count : parseInt(String(count), 10);
    if (!Number.isInteger(numUsers) || numUsers < 1) {
      return res.status(400).json({ error: 'Valid count (integer >= 1) is required' });
    }
    
    if (!['monthly', 'yearly'].includes(billingPeriod)) {
      return res.status(400).json({ error: 'Invalid billing period' });
    }
    
    // Check if user has an active subscription
    const subscription = await subscriptionService.getSubscription(userId);
    if (!subscription || subscription.status !== 'active') {
      return res.status(400).json({ error: 'No active subscription. Please upgrade to a plan first.' });
    }
    
    // Get Stripe customer ID
    const stripeCustomerId = await getStripeCustomerIdByUserId(userId);
    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer linked. Please contact support.' });
    }
    
    const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const successUrl = `${baseUrl}/app_admin?add_users_success=true&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}/app_admin?open=currentPlan`;
    
    console.log(`[Stripe Add Users] Creating checkout session: userId=${userId}, count=${numUsers}, billingPeriod=${billingPeriod}`);
    
    // Create checkout session with only additional user line items
    const addUserPriceId = billingPeriod === 'yearly'
      ? process.env.STRIPE_PRICE_ADDITIONAL_USER_YEARLY
      : process.env.STRIPE_PRICE_ADDITIONAL_USER_MONTHLY;
    
    if (!addUserPriceId) {
      return res.status(500).json({ error: 'Additional user pricing not configured' });
    }
    
    const session = await stripeService.createCheckoutSessionForAdditionalUsers(
      stripeCustomerId,
      addUserPriceId,
      numUsers,
      successUrl,
      cancelUrl,
      String(userId),
      subscription.stripeSubscriptionId || undefined
    );
    
    res.json({
      success: true,
      sessionId: session.id,
      url: session.url,
    });
  } catch (error: any) {
    console.error('Error creating checkout session for additional users:', error);
    res.status(500).json({
      error: error?.message || 'Failed to create checkout session',
    });
  }
});

/**
 * POST /api/stripe/billing-portal
 * Body: { returnUrl? }; uses linked Stripe customer for req.userId.
 */
router.post('/billing-portal', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const stripeCustomerId = await getStripeCustomerIdByUserId(userId);
    if (!stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer linked. Create a subscription first.' });
    }
    const baseUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const returnUrl = req.body?.returnUrl || `${baseUrl}/app_admin`;
    const session = await stripeService.createBillingPortalSession(stripeCustomerId, returnUrl);
    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('Error creating billing portal session:', error);
    res.status(500).json({ error: 'Failed to create billing portal session' });
  }
});

/**
 * Webhook handler – must be mounted with express.raw({ type: 'application/json' }) BEFORE express.json().
 * Syncs Stripe events to our subscriptions table.
 */
export async function stripeWebhookHandler(
  req: express.Request,
  res: Response
): Promise<void> {
  const sig = (req.headers['stripe-signature'] as string) || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret || webhookSecret === 'whsec_xxxxx') {
    console.error('STRIPE_WEBHOOK_SECRET not configured or still placeholder');
    res.status(500).json({ error: 'Webhook secret not configured' });
    return;
  }

  // req.body is raw Buffer when using express.raw()
  const rawBody = (req as any).body;
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : (rawBody && String(rawBody)) || '';

  try {
    const event = stripeService.verifyWebhookSignature(payload, sig, webhookSecret);
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = (session.customer as string) || '';
        const subscriptionId = (session.subscription as string) || '';
        const userIdFromRef = session.client_reference_id
          ? parseInt(session.client_reference_id, 10)
          : null;
        let userId = userIdFromRef;
        if (userId == null) {
          const fromDb = await getUserIdByStripeCustomerId(customerId);
          userId = fromDb != null ? fromDb : null;
        }
        
        console.log(`[Stripe Webhook] checkout.session.completed: sessionId=${session.id}, customerId=${customerId}, subscriptionId=${subscriptionId}, userIdFromRef=${userIdFromRef}, userId=${userId}`);
        
        if (!userId) {
          console.error(`[Stripe Webhook] No userId found for checkout session ${session.id}`);
          break;
        }
        
        if (!subscriptionId) {
          console.error(`[Stripe Webhook] No subscriptionId in checkout session ${session.id}`);
          break;
        }
        
        try {
          const stripeSub = await stripeService.getSubscriptionById(subscriptionId);
          const periodStart = new Date((stripeSub as unknown as StripeSubscriptionWithPeriod).current_period_start * 1000);
          const periodEnd = new Date((stripeSub as unknown as StripeSubscriptionWithPeriod).current_period_end * 1000);
          
          console.log(`[Stripe Webhook] Subscription details: status=${stripeSub.status}, items=${stripeSub.items.data.length}, metadata=${JSON.stringify(session.metadata)}`);
          
          // Check if this is for adding users to existing subscription
          const isAddUsers = session.metadata?.type === 'add_users';
          const addUsersQuantity = session.metadata?.quantity ? parseInt(session.metadata.quantity, 10) : 0;
          const existingSubscriptionId = session.metadata?.existing_subscription_id;
          
          if (isAddUsers && addUsersQuantity > 0 && existingSubscriptionId) {
            // Idempotency: prevent double-processing (webhook and verify both fire for same checkout)
            const claimed = await claimCheckoutSessionForProcessing(session.id);
            if (!claimed) {
              console.log(`[Stripe Webhook] Session ${session.id} already processed, skipping (idempotent)`);
              break;
            }
            // This is for adding users - update existing subscription
            console.log(`[Stripe Webhook] Adding ${addUsersQuantity} users to existing subscription ${existingSubscriptionId}`);
            
            try {
              const existingSub = await subscriptionService.getSubscription(userId);
              if (existingSub && existingSub.stripeSubscriptionId === existingSubscriptionId) {
                // Add users to existing subscription via Stripe API
                const existingStripeSub = await stripeService.getSubscriptionById(existingSubscriptionId);
                const addUserPriceId = stripeSub.items.data[0]?.price?.id; // Get the price ID from the new subscription
                
                if (addUserPriceId) {
                  // Check for existing additional user items (could be monthly or yearly)
                  const additionalUserPriceIds = [
                    process.env.STRIPE_PRICE_ADDITIONAL_USER_MONTHLY,
                    process.env.STRIPE_PRICE_ADDITIONAL_USER_YEARLY,
                  ].filter(Boolean) as string[];
                  
                  const existingAddUserItem = existingStripeSub.items.data.find(
                    item => additionalUserPriceIds.includes(item.price.id)
                  );
                  
                  console.log(`[Stripe Webhook] Existing add user item: ${existingAddUserItem ? `found (id=${existingAddUserItem.id}, qty=${existingAddUserItem.quantity})` : 'not found'}`);
                  
                  // Prepare items array - keep all existing items and update/add additional users
                  const itemsToUpdate: Stripe.SubscriptionUpdateParams.Item[] = [];
                  
                  // Keep all existing items EXCEPT any existing additional user items
                  for (const item of existingStripeSub.items.data) {
                    if (!additionalUserPriceIds.includes(item.price.id)) {
                      // Keep this item as-is
                      itemsToUpdate.push({
                        id: item.id,
                        price: item.price.id,
                        quantity: item.quantity || 1,
                      });
                    }
                  }
                  
                  // Add/update additional user item
                  if (existingAddUserItem) {
                    // Update existing item quantity
                    itemsToUpdate.push({
                      id: existingAddUserItem.id,
                      quantity: (existingAddUserItem.quantity || 0) + addUsersQuantity,
                    });
                    console.log(`[Stripe Webhook] Updating existing item ${existingAddUserItem.id}: ${existingAddUserItem.quantity} + ${addUsersQuantity} = ${(existingAddUserItem.quantity || 0) + addUsersQuantity}`);
                  } else {
                    // Add new item
                    itemsToUpdate.push({
                      price: addUserPriceId,
                      quantity: addUsersQuantity,
                    });
                    console.log(`[Stripe Webhook] Adding new item with price ${addUserPriceId}, quantity ${addUsersQuantity}`);
                  }
                  
                  // Get invoice BEFORE canceling subscription
                  const sessionInvoiceId = (session as any).invoice as string | null;
                  let invoiceId: string | null = sessionInvoiceId || null;
                  let paymentAmount = 0;
                  let paymentIntentId: string | null = null;
                  
                  try {
                    const invoices = await stripeService.getCustomerInvoices(customerId);
                    const latestInvoice = invoices.find(inv => 
                      getInvSubscriptionId(inv as StripeInvoiceWithPayment) === subscriptionId && inv.status === 'paid'
                    ) ?? (invoiceId ? invoices.find(inv => inv.id === invoiceId) : null);
                    if (latestInvoice) {
                      invoiceId = latestInvoice.id;
                      paymentAmount = latestInvoice.amount_paid / 100;
                      paymentIntentId = getInvPaymentIntentId(latestInvoice as StripeInvoiceWithPayment) ?? null;
                      console.log(`[Stripe Webhook] Found invoice: ${invoiceId}, amount: $${paymentAmount}`);
                    } else {
                      // Calculate from subscription items
                      for (const item of stripeSub.items.data) {
                        const unitAmount = item.price.unit_amount || 0;
                        const quantity = item.quantity || 1;
                        paymentAmount += (unitAmount * quantity) / 100;
                      }
                      console.log(`[Stripe Webhook] No invoice found, calculated amount: $${paymentAmount}`);
                    }
                  } catch (invoiceError) {
                    console.warn(`[Stripe Webhook] Could not fetch invoice, calculating from items:`, invoiceError);
                    // Calculate from subscription items
                    for (const item of stripeSub.items.data) {
                      const unitAmount = item.price.unit_amount || 0;
                      const quantity = item.quantity || 1;
                      paymentAmount += (unitAmount * quantity) / 100;
                    }
                  }
                  
                  await stripeService.updateSubscriptionItems(existingSubscriptionId, itemsToUpdate);
                  console.log(`[Stripe Webhook] ✅ Updated Stripe subscription items`);
                  
                  // Update our database
                  const result = await subscriptionService.addExtraUsers(userId, addUsersQuantity);
                  if (!result.success) {
                    console.error(`[Stripe Webhook] ❌ Failed to add users to database:`, result);
                  } else {
                    console.log(`[Stripe Webhook] ✅ Added ${addUsersQuantity} users to subscription. New extra_users: ${result.extraUsers}`);
                  }
                  
                  // Cancel the new subscription created by checkout (we've merged it into existing)
                  try {
                    await stripeService.cancelSubscription(subscriptionId);
                    console.log(`[Stripe Webhook] ✅ Cancelled temporary subscription ${subscriptionId}`);
                  } catch (cancelError) {
                    console.warn(`[Stripe Webhook] Could not cancel temporary subscription:`, cancelError);
                  }
                  
                  // Create payment record
                  try {
                    // Check if payment already exists
                    const existingPayments = await paymentService.getPaymentsByUser(userId, 100);
                    const paymentExists = existingPayments.some(p => 
                      invoiceId ? p.stripeInvoiceId === invoiceId : false
                    );
                    
                    if (!paymentExists && paymentAmount > 0) {
                      await paymentService.createPayment({
                        userId,
                        subscriptionId: existingSub.id,
                        amount: paymentAmount,
                        currency: 'USD',
                        status: 'succeeded',
                        paymentMethod: 'stripe',
                        stripePaymentIntentId: paymentIntentId ?? undefined,
                        stripeInvoiceId: invoiceId ?? undefined,
                        planName: existingSub.planName,
                        planType: existingSub.planType,
                        itemType: 'add_users',
                        billingPeriodStart: existingSub.currentPeriodStart,
                        billingPeriodEnd: existingSub.currentPeriodEnd,
                      });
                      console.log(`[Stripe Webhook] ✅ Payment record created for additional users: $${paymentAmount}, invoiceId=${invoiceId}`);
                    } else if (paymentExists) {
                      console.log(`[Stripe Webhook] Payment record already exists for invoice ${invoiceId}`);
                    } else {
                      console.warn(`[Stripe Webhook] Payment amount is 0, skipping payment record creation`);
                    }
                  } catch (paymentError: any) {
                    console.error(`[Stripe Webhook] Error creating payment record:`, paymentError);
                  }
                }
              }
            } catch (addUsersError: any) {
              console.error(`[Stripe Webhook] Error adding users to subscription:`, addUsersError);
            }
            break; // Exit early - this was handled as add users
          }
          
          // Regular subscription creation/update flow
          // Get the latest invoice for this subscription to get payment details
          let invoiceId: string | null = null;
          let paymentAmount = 0;
          let paymentIntentId: string | null = null;
          
          try {
            const invoices = await stripeService.getCustomerInvoices(customerId);
            const latestInvoice = invoices.find(inv =>
              getInvSubscriptionId(inv as StripeInvoiceWithPayment) === subscriptionId && inv.status === 'paid'
            );
            if (latestInvoice) {
              invoiceId = latestInvoice.id;
              paymentAmount = latestInvoice.amount_paid / 100; // Convert from cents to dollars
              const pi = (latestInvoice as StripeInvoiceWithPayment).payment_intent;
              paymentIntentId = (typeof pi === 'string' ? pi : pi?.id) ?? null;
            }
          } catch (invoiceError) {
            console.warn(`[Stripe Webhook] Could not fetch invoice:`, invoiceError);
          }
          
          // If no invoice found, calculate from subscription items
          if (paymentAmount === 0) {
            for (const item of stripeSub.items.data) {
              const unitAmount = item.price.unit_amount || 0;
              const quantity = item.quantity || 1;
              paymentAmount += (unitAmount * quantity) / 100; // Convert from cents
            }
          }
          
          let subscriptionCreated = false;
          let createdSubscription = null;
          
          for (const item of stripeSub.items.data) {
            const mapped = stripeService.getPlanFromStripePriceId(item.price.id);
            console.log(`[Stripe Webhook] Checking priceId=${item.price.id}, mapped=${mapped ? JSON.stringify(mapped) : 'null'}`);
            if (mapped) {
              createdSubscription = await subscriptionService.createSubscription({
                userId,
                planName: mapped.planName,
                planType: mapped.planType,
                stripeSubscriptionId: subscriptionId,
                stripeCustomerId: customerId,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
              });
              console.log(`[Stripe Webhook] ✅ Subscription created/updated for userId=${userId}, plan=${mapped.planName}, type=${mapped.planType}`);
              
              // Create payment record
              try {
                await paymentService.createPayment({
                  userId,
                  subscriptionId: createdSubscription.id,
                  amount: paymentAmount,
                  currency: 'USD',
                  status: 'succeeded',
                  paymentMethod: 'stripe',
                  stripePaymentIntentId: paymentIntentId ?? undefined,
                  stripeInvoiceId: invoiceId ?? undefined,
                  planName: mapped.planName,
                  planType: mapped.planType,
                  itemType: 'plan',
                  billingPeriodStart: periodStart,
                  billingPeriodEnd: periodEnd,
                });
                console.log(`[Stripe Webhook] ✅ Payment record created: $${paymentAmount} for plan ${mapped.planName}`);
              } catch (paymentError: any) {
                console.error(`[Stripe Webhook] Error creating payment record:`, paymentError);
              }
              
              subscriptionCreated = true;
              break;
            }
          }
          
          if (!subscriptionCreated) {
            console.error(`[Stripe Webhook] ⚠️ No plan mapping found for subscription ${subscriptionId} items`);
          }
        } catch (error: any) {
          console.error(`[Stripe Webhook] Error processing checkout.session.completed:`, error);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = (sub.customer as string) || '';
        const userId = await getUserIdByStripeCustomerId(customerId);
        if (userId) {
          const periodStart = new Date((sub as unknown as StripeSubscriptionWithPeriod).current_period_start * 1000);
          const periodEnd = new Date((sub as unknown as StripeSubscriptionWithPeriod).current_period_end * 1000);
          for (const item of sub.items.data) {
            const mapped = stripeService.getPlanFromStripePriceId(item.price.id);
            if (mapped) {
              await subscriptionService.createSubscription({
                userId,
                planName: mapped.planName,
                planType: mapped.planType,
                stripeSubscriptionId: sub.id,
                stripeCustomerId: customerId,
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
              });
              break;
            }
          }
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = (sub.customer as string) || '';
        const userId = await getUserIdByStripeCustomerId(customerId);
        if (userId) {
          await subscriptionService.deleteSubscription(userId);
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const invPayload = invoice as StripeInvoiceWithPayment;
        const customerId = (invoice.customer as string) || '';
        const subscriptionId = getInvSubscriptionId(invPayload) || '';
        const paymentIntentId = getInvPaymentIntentId(invPayload) || '';
        const amountPaid = invoice.amount_paid / 100; // Convert from cents to dollars
        
        console.log(`[Stripe Webhook] invoice.payment_succeeded: invoiceId=${invoice.id}, customerId=${customerId}, subscriptionId=${subscriptionId}, amount=${amountPaid}`);
        
        if (!subscriptionId) {
          console.log(`[Stripe Webhook] No subscription ID in invoice, skipping payment record`);
          break;
        }
        
        const userId = await getUserIdByStripeCustomerId(customerId);
        if (!userId) {
          console.error(`[Stripe Webhook] No userId found for customer ${customerId}`);
          break;
        }
        
        try {
          const subscription = await subscriptionService.getSubscription(userId);
          if (!subscription) {
            console.warn(`[Stripe Webhook] No subscription found for userId=${userId}, skipping payment record`);
            break;
          }
          
          // Skip creating payment if this invoice is for a different subscription than the user's main one.
          // Add-users checkout creates a temporary subscription; its invoice would have a different subscriptionId.
          // That payment is created by checkout.session.completed with itemType: 'add_users'. If we create here
          // we'd use itemType: 'plan' and overwrite the correct item type.
          const userMainSubId = subscription.stripeSubscriptionId || '';
          if (subscriptionId !== userMainSubId) {
            console.log(`[Stripe Webhook] Invoice ${invoice.id} is for subscription ${subscriptionId}, user's main is ${userMainSubId} – skipping (likely add_users temp subscription)`);
            break;
          }
          
          // Check if payment already exists
          const existingPayments = await paymentService.getPaymentsByUser(userId, 100);
          const paymentExists = existingPayments.some(p => 
            p.stripeInvoiceId === invoice.id
          );
          
          if (!paymentExists) {
            const periodStart = invoice.period_start ? new Date(invoice.period_start * 1000) : subscription.currentPeriodStart;
            const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000) : subscription.currentPeriodEnd;
            
            await paymentService.createPayment({
              userId,
              subscriptionId: subscription.id,
              amount: amountPaid,
              currency: invoice.currency || 'USD',
              status: 'succeeded',
              paymentMethod: 'stripe',
              stripePaymentIntentId: paymentIntentId,
              stripeInvoiceId: invoice.id,
              planName: subscription.planName,
              planType: subscription.planType,
              itemType: 'plan',
              billingPeriodStart: periodStart,
              billingPeriodEnd: periodEnd,
            });
            console.log(`[Stripe Webhook] ✅ Payment record created for recurring payment: $${amountPaid} for userId=${userId}`);
          } else {
            console.log(`[Stripe Webhook] Payment record already exists for invoice ${invoice.id}`);
          }
        } catch (error: any) {
          console.error(`[Stripe Webhook] Error creating payment record for invoice:`, error);
        }
        break;
      }
      case 'invoice.payment_failed':
        // Optional: log or update payments table
        break;
      default:
        console.log(`Unhandled Stripe event type: ${event.type}`);
    }
    res.json({ received: true });
  } catch (err: any) {
    console.error('Stripe webhook error:', err);
    res.status(400).json({ error: 'Webhook failed' });
  }
}

export default router;
