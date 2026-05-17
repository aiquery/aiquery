-- AIQuery Payment Database Schema
-- Supports: StartPro, SmartPro plans with monthly/yearly billing
-- Additional members at $10/month each

-- Create stripe_customers table
CREATE TABLE IF NOT EXISTS stripe_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  stripe_customer_id VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_stripe_customers_user_id ON stripe_customers(user_id);
CREATE INDEX idx_stripe_customers_stripe_id ON stripe_customers(stripe_customer_id);

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stripe_subscription_id VARCHAR(255) NOT NULL UNIQUE,
  stripe_customer_id VARCHAR(255) NOT NULL,
  plan VARCHAR(50) NOT NULL, -- 'START_PRO' or 'SMART_PRO'
  billing_period VARCHAR(20) NOT NULL, -- 'monthly' or 'yearly'
  status VARCHAR(50) NOT NULL, -- 'active', 'past_due', 'canceled', etc.
  additional_members INT DEFAULT 0,
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  cancel_at_period_end BOOLEAN DEFAULT FALSE,
  canceled_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stripe_invoice_id VARCHAR(255) NOT NULL UNIQUE,
  stripe_customer_id VARCHAR(255) NOT NULL,
  subscription_id UUID,
  amount_subtotal DECIMAL(10, 2) NOT NULL,
  amount_tax DECIMAL(10, 2) NOT NULL,
  amount_total DECIMAL(10, 2) NOT NULL,
  amount_paid DECIMAL(10, 2) DEFAULT 0,
  amount_due DECIMAL(10, 2),
  status VARCHAR(50) NOT NULL, -- 'draft', 'open', 'paid', 'uncollectible', 'void'
  paid_at TIMESTAMP,
  due_date TIMESTAMP,
  pdf_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_id FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
);

CREATE INDEX idx_invoices_user_id ON invoices(user_id);
CREATE INDEX idx_invoices_stripe_id ON invoices(stripe_invoice_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_paid_at ON invoices(paid_at);

-- Create payment_methods table
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  stripe_payment_method_id VARCHAR(255) NOT NULL UNIQUE,
  stripe_customer_id VARCHAR(255) NOT NULL,
  brand VARCHAR(50), -- 'visa', 'mastercard', 'amex', etc.
  last4 VARCHAR(4),
  exp_month INT,
  exp_year INT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_payment_methods_user_id ON payment_methods(user_id);
CREATE INDEX idx_payment_methods_stripe_id ON payment_methods(stripe_payment_method_id);

-- Create usage_tracking table
CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  subscription_id UUID,
  metric_name VARCHAR(100) NOT NULL, -- 'queries', 'data_sources', 'api_calls', etc.
  quantity INT NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_id FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
);

CREATE INDEX idx_usage_tracking_user_id ON usage_tracking(user_id);
CREATE INDEX idx_usage_tracking_metric ON usage_tracking(metric_name);
CREATE INDEX idx_usage_tracking_period ON usage_tracking(period_start, period_end);

-- Create billing_history table
CREATE TABLE IF NOT EXISTS billing_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  subscription_id UUID,
  event_type VARCHAR(100) NOT NULL, -- 'subscription_created', 'subscription_updated', 'payment_succeeded', etc.
  amount DECIMAL(10, 2),
  description TEXT,
  stripe_event_id VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_id FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
);

CREATE INDEX idx_billing_history_user_id ON billing_history(user_id);
CREATE INDEX idx_billing_history_event_type ON billing_history(event_type);
CREATE INDEX idx_billing_history_created_at ON billing_history(created_at);

-- Create user_plans table (to track current plan per user)
CREATE TABLE IF NOT EXISTS user_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  plan VARCHAR(50) NOT NULL, -- 'FREE', 'START_PRO', 'SMART_PRO'
  billing_period VARCHAR(20), -- 'monthly', 'yearly', NULL for free
  additional_members INT DEFAULT 0,
  subscription_id UUID,
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'inactive', 'suspended'
  features JSONB, -- JSON object with plan features
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_subscription_id FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL
);

CREATE INDEX idx_user_plans_user_id ON user_plans(user_id);
CREATE INDEX idx_user_plans_plan ON user_plans(plan);

-- Create plan_features table (reference table)
CREATE TABLE IF NOT EXISTS plan_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan VARCHAR(50) NOT NULL, -- 'FREE', 'START_PRO', 'SMART_PRO'
  feature_name VARCHAR(100) NOT NULL,
  feature_value VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_plan_features_unique ON plan_features(plan, feature_name);

-- Insert plan features
INSERT INTO plan_features (plan, feature_name, feature_value) VALUES
-- FREE plan
('FREE', 'max_team_members', '1'),
('FREE', 'queries_per_day', '10'),
('FREE', 'data_sources', '1'),
('FREE', 'analytics', 'basic'),
('FREE', 'support', 'community'),
('FREE', 'api_access', 'standard'),

-- START_PRO plan
('START_PRO', 'max_team_members', '5'),
('START_PRO', 'queries_per_day', '100'),
('START_PRO', 'data_sources', '3'),
('START_PRO', 'analytics', 'basic'),
('START_PRO', 'support', 'email'),
('START_PRO', 'api_access', 'standard'),
('START_PRO', 'monthly_price', '40'),
('START_PRO', 'yearly_price', '388'),

-- SMART_PRO plan
('SMART_PRO', 'max_team_members', 'unlimited'),
('SMART_PRO', 'queries_per_day', 'unlimited'),
('SMART_PRO', 'data_sources', 'unlimited'),
('SMART_PRO', 'analytics', 'advanced'),
('SMART_PRO', 'support', 'priority'),
('SMART_PRO', 'api_access', 'advanced'),
('SMART_PRO', 'custom_integrations', 'yes'),
('SMART_PRO', 'dedicated_account_manager', 'yes'),
('SMART_PRO', 'monthly_price', '68'),
('SMART_PRO', 'yearly_price', '668'),

-- Additional members
('ADDITIONAL_MEMBER', 'monthly_price', '10'),
('ADDITIONAL_MEMBER', 'yearly_price', '120');

-- Create views for easier querying

-- View: User subscription details
CREATE OR REPLACE VIEW v_user_subscriptions AS
SELECT 
  u.id as user_id,
  u.email,
  s.id as subscription_id,
  s.plan,
  s.billing_period,
  s.status,
  s.additional_members,
  s.current_period_start,
  s.current_period_end,
  s.canceled_at,
  up.features
FROM users u
LEFT JOIN subscriptions s ON u.id = s.user_id
LEFT JOIN user_plans up ON u.id = up.user_id;

-- View: User billing summary
CREATE OR REPLACE VIEW v_user_billing_summary AS
SELECT 
  u.id as user_id,
  u.email,
  COUNT(DISTINCT i.id) as total_invoices,
  SUM(CASE WHEN i.status = 'paid' THEN i.amount_paid ELSE 0 END) as total_paid,
  SUM(CASE WHEN i.status = 'open' THEN i.amount_due ELSE 0 END) as amount_due,
  MAX(i.created_at) as last_invoice_date
FROM users u
LEFT JOIN invoices i ON u.id = i.user_id
GROUP BY u.id, u.email;

-- Create function to update user_plans when subscription changes
CREATE OR REPLACE FUNCTION update_user_plan()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_plans (user_id, plan, billing_period, additional_members, subscription_id, status)
  VALUES (NEW.user_id, NEW.plan, NEW.billing_period, NEW.additional_members, NEW.id, NEW.status)
  ON CONFLICT (user_id) DO UPDATE SET
    plan = NEW.plan,
    billing_period = NEW.billing_period,
    additional_members = NEW.additional_members,
    subscription_id = NEW.id,
    status = CASE WHEN NEW.status = 'canceled' THEN 'inactive' ELSE 'active' END,
    updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for subscriptions table
DROP TRIGGER IF EXISTS trg_update_user_plan ON subscriptions;
CREATE TRIGGER trg_update_user_plan
AFTER INSERT OR UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION update_user_plan();

-- Create function to log billing events
CREATE OR REPLACE FUNCTION log_billing_event()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO billing_history (user_id, subscription_id, event_type, amount, description, created_at)
  VALUES (
    NEW.user_id,
    NEW.id,
    CASE 
      WHEN TG_OP = 'INSERT' THEN 'subscription_created'
      WHEN TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN 'subscription_' || NEW.status
      ELSE 'subscription_updated'
    END,
    NULL,
    'Subscription ' || NEW.plan || ' (' || NEW.billing_period || ')',
    CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for billing history
DROP TRIGGER IF EXISTS trg_log_billing_event ON subscriptions;
CREATE TRIGGER trg_log_billing_event
AFTER INSERT OR UPDATE ON subscriptions
FOR EACH ROW
EXECUTE FUNCTION log_billing_event();

-- Pricing Summary
-- Monthly Plans:
--   StartPro: $40 + $2 GST = $42/month
--   SmartPro: $68 + $3.40 GST = $71.40/month
--   Additional Member: $10 + $0.50 GST = $10.50/month
--
-- Yearly Plans:
--   StartPro: $388 + $19.40 GST = $407.40/year
--   SmartPro: $668 + $33.40 GST = $701.40/year
--   Additional Member: $120 + $6 GST = $126/year
