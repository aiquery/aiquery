import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Database connection pool
let pool: Pool | null = null;

/**
 * Human-readable, safe DB identity for startup logs.
 * Never includes passwords.
 */
export function getDatabaseConnectionIdentity(): string {
  const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
  if (rawDatabaseUrl) {
    const isLikelyPostgresUrl = /^postgres(ql)?:\/\//i.test(rawDatabaseUrl);
    const looksRedacted = /REDACTED|\*{3,}/i.test(rawDatabaseUrl);
    if (isLikelyPostgresUrl && !looksRedacted) {
      try {
        const u = new URL(rawDatabaseUrl);
        const host = u.hostname || 'localhost';
        const port = u.port || '5432';
        const database = (u.pathname || '/').replace(/^\//, '') || 'postgres';
        const user = u.username ? decodeURIComponent(u.username) : 'unknown';
        return `DATABASE_URL -> ${host}:${port}/${database} (user=${user})`;
      } catch {
        // Fall through to DB_* description.
      }
    }
  }

  const host = process.env.DB_HOST || 'localhost';
  const port = Number(process.env.DB_PORT || '5432');
  const database = process.env.DB_NAME || 'aiquery';
  const user = process.env.DB_USER || 'postgres';
  return `DB_* -> ${host}:${port}/${database} (user=${user})`;
}

export function getDatabasePool(): Pool {
  if (!pool) {
    const rawDatabaseUrl = process.env.DATABASE_URL?.trim();
    let connectionString: string | undefined;
    if (rawDatabaseUrl) {
      const isLikelyPostgresUrl = /^postgres(ql)?:\/\//i.test(rawDatabaseUrl);
      const looksRedacted = /REDACTED|\*{3,}/i.test(rawDatabaseUrl);
      if (!isLikelyPostgresUrl || looksRedacted) {
        console.warn('[DB] DATABASE_URL present but ignored (invalid or redacted). Falling back to DB_* variables.');
      } else {
        try {
          // Validate URL format before passing to pg (prevents runtime crash on invalid URL)
          new URL(rawDatabaseUrl);
          connectionString = rawDatabaseUrl;
          console.log('[DB] Using DATABASE_URL for connection (validated).');
        } catch (error) {
          console.warn('[DB] Invalid DATABASE_URL detected, falling back to DB_* variables.');
          connectionString = undefined;
        }
      }
    }

    const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false;

    if (connectionString) {
      pool = new Pool({
        connectionString,
        ssl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
    } else {
      const host = process.env.DB_HOST || 'localhost';
      const port = Number(process.env.DB_PORT || '5432');
      const database = process.env.DB_NAME || 'aiquery';
      const user = process.env.DB_USER || 'postgres';
      const password = process.env.DB_PASSWORD || 'postgres';

      console.log('[DB] Using DB_* variables for connection.');
      console.log(`[DB] Host: ${host} | Port: ${port} | DB: ${database} | User: ${user}`);

      pool = new Pool({
        host,
        port,
        database,
        user,
        password,
        ssl,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });
    }

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }

  return pool;
}

// Initialize database tables
export async function initializeDatabase(): Promise<void> {
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        role VARCHAR(20) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add role column to existing users table if it doesn't exist
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'role'
        ) THEN
          ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'admin';
        END IF;
      END $$;
    `);

    // Add phone_number column to existing users table if it doesn't exist
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'phone_number'
        ) THEN
          ALTER TABLE users ADD COLUMN phone_number VARCHAR(50);
        END IF;
      END $$;
    `);

    // Add email_verified column to existing users table if it doesn't exist
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'email_verified'
        ) THEN
          ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);

    // Add status column for admin: active | paused | stopped (default active)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'status'
        ) THEN
          ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active';
        END IF;
      END $$;
    `);

    // Create verification_codes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS verification_codes (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        code VARCHAR(10) NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index for verification_codes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_verification_codes_expires_at ON verification_codes(expires_at)
    `);

    // Password reset tokens (for forgot-password flow)
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token VARCHAR(64) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email ON password_reset_tokens(email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at)
    `);

    // Create pending_registrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_registrations (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        phone_number VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      )
    `);

    // Create index for pending_registrations
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_registrations_email ON pending_registrations(email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_registrations_expires_at ON pending_registrations(expires_at)
    `);

    // Create team_members table for team relationships
    await client.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL DEFAULT 'view',
        invited_by INTEGER REFERENCES users(id),
        invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        joined_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(team_id, user_id)
      )
    `);

    // Create indexes for team_members
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id)
    `);

    // Create invite_tokens table for invite links
    await client.query(`
      CREATE TABLE IF NOT EXISTS invite_tokens (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'view',
        created_by INTEGER NOT NULL REFERENCES users(id),
        expires_at TIMESTAMP,
        used_at TIMESTAMP,
        used_by INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for invite_tokens
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invite_tokens_token ON invite_tokens(token)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_invite_tokens_team_id ON invite_tokens(team_id)
    `);

    // Create workspaces table
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        config JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create workspace_members table
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspace_members (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL DEFAULT 'member',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(workspace_id, user_id)
      )
    `);

    // Create indexes for workspaces
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workspaces_owner_id ON workspaces(owner_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace_id ON workspace_members(workspace_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_workspace_members_user_id ON workspace_members(user_id)
    `);

    // Create connection_configs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS connection_configs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_id VARCHAR(50) NOT NULL,
        source_type VARCHAR(50) NOT NULL,
        config JSONB NOT NULL,
        connection_status VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, source_id)
      )
    `);

    // Create third_party_connections table
    await client.query(`
      CREATE TABLE IF NOT EXISTS third_party_connections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        service_type VARCHAR(20) NOT NULL,
        config JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, service_type)
      )
    `);

    // Create llm_settings table for user-specific LLM configurations
    await client.query(`
      CREATE TABLE IF NOT EXISTS llm_settings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(20) NOT NULL,
        model_type VARCHAR(20) NOT NULL,
        openai_api_key VARCHAR(500),
        gemini_api_key VARCHAR(500),
        openai_model_name VARCHAR(100),
        gemini_model_name VARCHAR(100),
        connection_status VARCHAR(20) DEFAULT 'untested',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);
    
    // Add custom model name columns if they don't exist (for existing databases)
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='llm_settings' AND column_name='openai_model_name') THEN
          ALTER TABLE llm_settings ADD COLUMN openai_model_name VARCHAR(100);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='llm_settings' AND column_name='gemini_model_name') THEN
          ALTER TABLE llm_settings ADD COLUMN gemini_model_name VARCHAR(100);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='llm_settings' AND column_name='anthropic_api_key') THEN
          ALTER TABLE llm_settings ADD COLUMN anthropic_api_key VARCHAR(500);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='llm_settings' AND column_name='anthropic_model_name') THEN
          ALTER TABLE llm_settings ADD COLUMN anthropic_model_name VARCHAR(100);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name='llm_settings' AND column_name='env_llm_preference') THEN
          ALTER TABLE llm_settings ADD COLUMN env_llm_preference VARCHAR(20) DEFAULT 'random';
        END IF;
      END $$;
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_connection_configs_user_id ON connection_configs(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_connection_configs_source ON connection_configs(user_id, source_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_third_party_connections_user_id ON third_party_connections(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_third_party_connections_service ON third_party_connections(user_id, service_type)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_llm_settings_user_id ON llm_settings(user_id)
    `);

    // Create subscriptions table for plan management
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_name VARCHAR(50) NOT NULL,
        plan_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        current_period_start TIMESTAMP NOT NULL,
        current_period_end TIMESTAMP NOT NULL,
        cancel_at_period_end BOOLEAN DEFAULT FALSE,
        stripe_subscription_id VARCHAR(255),
        stripe_customer_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )
    `);

    // Add extra_users column to subscriptions if not exists (for add-on user slots)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'subscriptions' AND column_name = 'extra_users') THEN
          ALTER TABLE subscriptions ADD COLUMN extra_users INTEGER NOT NULL DEFAULT 0;
        END IF;
      END $$;
    `);

    // Create payments table for payment history
    await client.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
        amount DECIMAL(10, 2) NOT NULL,
        currency VARCHAR(10) DEFAULT 'USD',
        status VARCHAR(20) NOT NULL,
        payment_method VARCHAR(50),
        stripe_payment_intent_id VARCHAR(255),
        stripe_invoice_id VARCHAR(255),
        plan_name VARCHAR(50) NOT NULL,
        plan_type VARCHAR(20) NOT NULL,
        item_type VARCHAR(50) DEFAULT 'plan',
        billing_period_start TIMESTAMP,
        billing_period_end TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add item_type column to existing payments table if not exists
    await client.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'payments' AND column_name = 'item_type'
        ) THEN
          ALTER TABLE payments ADD COLUMN item_type VARCHAR(50) DEFAULT 'plan';
        END IF;
      END $$;
    `);

    // Create indexes for subscriptions and payments
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_subscription_id ON payments(subscription_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)
    `);

    // Admin: custom plan limits per user (e.g. Enterprise with custom workspace/user/query/table limits)
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_plan_limits (
        user_id INTEGER NOT NULL PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        max_users INTEGER NOT NULL DEFAULT -1,
        max_workspaces INTEGER NOT NULL DEFAULT -1,
        max_queries_per_month INTEGER NOT NULL DEFAULT -1,
        max_tables_per_data_source INTEGER NOT NULL DEFAULT -1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_plan_limits_user_id ON user_plan_limits(user_id)
    `);

    // Notifications: in-app notices + optional email (usage reminders, payment due/failed)
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        read_at TIMESTAMP,
        email_sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC)
    `);

    // Stripe: link app user_id to Stripe customer id (for Checkout & webhooks)
    await client.query(`
      CREATE TABLE IF NOT EXISTS stripe_customers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_customer_id VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id),
        UNIQUE(stripe_customer_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stripe_customers_user_id ON stripe_customers(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_stripe_customers_stripe_id ON stripe_customers(stripe_customer_id)
    `);

    // Idempotency: prevent double-processing of add_users checkout (webhook + verify both fire)
    await client.query(`
      CREATE TABLE IF NOT EXISTS processed_checkout_sessions (
        session_id VARCHAR(255) PRIMARY KEY,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create query_usage table for tracking query counts per user per month
    await client.query(`
      CREATE TABLE IF NOT EXISTS query_usage (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        query_date DATE NOT NULL DEFAULT CURRENT_DATE,
        query_count INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, query_date)
      )
    `);

    // Create indexes for query_usage
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_query_usage_user_id ON query_usage(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_query_usage_date ON query_usage(query_date)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_query_usage_user_date ON query_usage(user_id, query_date)
    `);

    // Create chat_history table for storing user conversations
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id VARCHAR(255) NOT NULL,
        title VARCHAR(500),
        question TEXT NOT NULL,
        response TEXT NOT NULL,
        sql_query TEXT,
        query_results JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create chat_sessions table for grouping conversations
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        title VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for chat history
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON chat_history(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_history_session_id ON chat_history(session_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON chat_history(created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id ON chat_sessions(user_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_session_id ON chat_sessions(session_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC)
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'chat_history' AND column_name = 'execution_steps'
        ) THEN
          ALTER TABLE chat_history ADD COLUMN execution_steps JSONB;
        END IF;
      END $$;
    `);

    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'chat_history' AND column_name = 'follow_up_questions'
        ) THEN
          ALTER TABLE chat_history ADD COLUMN follow_up_questions JSONB;
        END IF;
      END $$;
    `);

    // Support requests (Help → Contact Support)
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        name VARCHAR(255),
        email VARCHAR(255) NOT NULL,
        subject VARCHAR(500),
        message TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'new',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_support_requests_email ON support_requests(email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_support_requests_created_at ON support_requests(created_at DESC)
    `);

    // Contact messages (contact form on /contact and other pages)
    await client.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255),
        email VARCHAR(255) NOT NULL,
        subject VARCHAR(500),
        message TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'new',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_messages_email ON contact_messages(email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_messages_created_at ON contact_messages(created_at DESC)
    `);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contact_messages' AND column_name = 'status') THEN
          ALTER TABLE contact_messages ADD COLUMN status VARCHAR(50) DEFAULT 'new';
        END IF;
      END $$;
    `);

    // Demo requests (Request Demo form on /contact)
    await client.query(`
      CREATE TABLE IF NOT EXISTS demo_requests (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(255) NOT NULL,
        last_name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        company_name VARCHAR(255) NOT NULL,
        job_title VARCHAR(255) NOT NULL,
        phone_number VARCHAR(100) NOT NULL,
        time_zone VARCHAR(255) NOT NULL,
        project_description TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'new',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_demo_requests_email ON demo_requests(email)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_demo_requests_created_at ON demo_requests(created_at DESC)
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Test database connection
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const pool = getDatabasePool();
    const result = await pool.query('SELECT NOW()');
    return result.rows.length > 0;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}

