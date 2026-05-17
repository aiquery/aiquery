import { Pool } from 'pg';
import { getDatabasePool } from '../database';

export interface ThirdPartyConfig {
  id: number;
  userId: number;
  serviceType: 'slack' | 'teams';
  config: {
    // Slack fields
    apiToken?: string;
    verificationToken?: string;
    signingSecret?: string;
    teamId?: string;
    // Teams fields
    appId?: string;
    clientSecret?: string;
    botTokenEndpoint?: string;
    tenantId?: string;
    // Common fields
    webhookUrl?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

/** Passed to deleteThirdPartyConfig so server logs show *how* the row was removed. */
export interface DeleteThirdPartyContext {
  /** e.g. "api:DELETE /api/third-party/slack", "workspace.activateWorkspace" */
  source: string;
  /** Extra context (workspace id, reason, etc.) */
  detail?: string;
}

export interface SaveThirdPartyConfigInput {
  userId: number;
  serviceType: 'slack' | 'teams';
  config: {
    // Slack fields
    apiToken?: string;
    verificationToken?: string;
    signingSecret?: string;
    teamId?: string;
    // Teams fields
    appId?: string;
    clientSecret?: string;
    botTokenEndpoint?: string;
    tenantId?: string;
    // Common fields
    webhookUrl?: string;
  };
}

export class ThirdPartyService {
  private pool: Pool;

  constructor() {
    this.pool = getDatabasePool();
  }

  private normalizeConfig(raw: unknown): Record<string, unknown> {
    if (!raw) return {};
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      } catch {
        return {};
      }
    }
    return typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  }

  private async getLegacyThirdPartyConfigFromConnectionConfigs(
    userId: number,
    serviceType: 'slack' | 'teams'
  ): Promise<Record<string, unknown> | null> {
    const sourceId = serviceType;
    const result = await this.pool.query(
      `SELECT config
       FROM connection_configs
       WHERE user_id = $1 AND source_id = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, sourceId]
    );
    if (result.rows.length === 0) return null;
    const cfg = this.normalizeConfig(result.rows[0].config);
    if (Object.keys(cfg).length === 0) return null;
    return cfg;
  }

  async saveThirdPartyConfig(input: SaveThirdPartyConfigInput): Promise<ThirdPartyConfig> {
    // Check if config already exists
    const existing = await this.pool.query(
      'SELECT id FROM public.third_party_connections WHERE user_id = $1 AND service_type = $2',
      [input.userId, input.serviceType]
    );

    if (existing.rows.length > 0) {
      // Update existing
      const result = await this.pool.query(
        `UPDATE public.third_party_connections 
         SET config = $1, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $2 AND service_type = $3
         RETURNING id, user_id, service_type, config, created_at, updated_at`,
        [
          JSON.stringify(input.config),
          input.userId,
          input.serviceType,
        ]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        serviceType: row.service_type,
        config: row.config,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } else {
      // Insert new
      const result = await this.pool.query(
        `INSERT INTO public.third_party_connections (user_id, service_type, config)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, service_type, config, created_at, updated_at`,
        [
          input.userId,
          input.serviceType,
          JSON.stringify(input.config),
        ]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        serviceType: row.service_type,
        config: row.config,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
  }

  async getThirdPartyConfig(userId: number, serviceType: 'slack' | 'teams'): Promise<ThirdPartyConfig | null> {
    const result = await this.pool.query(
      `SELECT id, user_id, service_type, config, created_at, updated_at
       FROM public.third_party_connections
       WHERE user_id = $1 AND service_type = $2`,
      [userId, serviceType]
    );

    if (result.rows.length === 0) {
      // Backward-compatibility: older builds could store Slack/Teams config in connection_configs.
      // Auto-migrate on read so users do not lose their saved third-party settings after upgrades.
      const legacy = await this.getLegacyThirdPartyConfigFromConnectionConfigs(userId, serviceType);
      if (!legacy) return null;

      const migrated = await this.saveThirdPartyConfig({
        userId,
        serviceType,
        config: {
          apiToken: typeof legacy.apiToken === 'string' ? legacy.apiToken : undefined,
          verificationToken: typeof legacy.verificationToken === 'string' ? legacy.verificationToken : undefined,
          signingSecret: typeof legacy.signingSecret === 'string' ? legacy.signingSecret : undefined,
          teamId: typeof legacy.teamId === 'string' ? legacy.teamId : undefined,
          appId: typeof legacy.appId === 'string' ? legacy.appId : undefined,
          clientSecret: typeof legacy.clientSecret === 'string' ? legacy.clientSecret : undefined,
          botTokenEndpoint: typeof legacy.botTokenEndpoint === 'string' ? legacy.botTokenEndpoint : undefined,
          tenantId: typeof legacy.tenantId === 'string' ? legacy.tenantId : undefined,
          webhookUrl: typeof legacy.webhookUrl === 'string' ? legacy.webhookUrl : undefined,
        },
      });
      return migrated;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      serviceType: row.service_type,
      config: row.config,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Deletes one row from public.third_party_connections.
   * All paths log when/why — check logs for `third_party_connections.DELETE`.
   */
  async deleteThirdPartyConfig(
    userId: number,
    serviceType: 'slack' | 'teams',
    context?: DeleteThirdPartyContext
  ): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM public.third_party_connections WHERE user_id = $1 AND service_type = $2',
      [userId, serviceType]
    );

    const rowCount = result.rowCount ?? 0;
    const deleted = rowCount > 0;

    const logPayload: Record<string, unknown> = {
      event: 'third_party_connections.DELETE',
      table: 'public.third_party_connections',
      at: new Date().toISOString(),
      userId,
      serviceType,
      rowsDeleted: rowCount,
      source: context?.source ?? 'unknown',
      detail: context?.detail,
    };

    if (!context?.source) {
      logPayload.callStackHint = new Error('deleteThirdPartyConfig caller').stack
        ?.split('\n')
        .slice(1, 12)
        .join('\n');
    }

    if (deleted) {
      console.warn('[third_party_connections]', JSON.stringify(logPayload));
    } else {
      console.info('[third_party_connections]', JSON.stringify(logPayload));
    }

    return deleted;
  }
}

export const thirdPartyService = new ThirdPartyService();

