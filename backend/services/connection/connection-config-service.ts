import { Pool } from 'pg';
import { getDatabasePool } from '../database';

export interface ConnectionConfig {
  id: number;
  userId: number;
  sourceId: string;
  sourceType: string;
  config: any;
  connectionStatus?: 'connected' | 'failed' | 'untested';
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveConnectionConfigInput {
  userId: number;
  sourceId: string;
  sourceType: string;
  config: any;
  connectionStatus?: 'connected' | 'failed' | 'untested';
}

export class ConnectionConfigService {
  private pool: Pool;

  constructor() {
    this.pool = getDatabasePool();
  }

  async saveConnectionConfig(input: SaveConnectionConfigInput): Promise<ConnectionConfig> {
    // Check if connection config already exists
    const existing = await this.pool.query(
      'SELECT id FROM connection_configs WHERE user_id = $1 AND source_id = $2',
      [input.userId, input.sourceId]
    );

    if (existing.rows.length > 0) {
      // Update existing
      const result = await this.pool.query(
        `UPDATE connection_configs 
         SET config = $1, source_type = $2, connection_status = $3, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $4 AND source_id = $5
         RETURNING id, user_id, source_id, source_type, config, connection_status, created_at, updated_at`,
        [
          JSON.stringify(input.config),
          input.sourceType,
          input.connectionStatus || null,
          input.userId,
          input.sourceId,
        ]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        sourceId: row.source_id,
        sourceType: row.source_type,
        config: row.config,
        connectionStatus: row.connection_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    } else {
      // Insert new
      const result = await this.pool.query(
        `INSERT INTO connection_configs (user_id, source_id, source_type, config, connection_status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, source_id, source_type, config, connection_status, created_at, updated_at`,
        [
          input.userId,
          input.sourceId,
          input.sourceType,
          JSON.stringify(input.config),
          input.connectionStatus || null,
        ]
      );

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        sourceId: row.source_id,
        sourceType: row.source_type,
        config: row.config,
        connectionStatus: row.connection_status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
  }

  async getConnectionConfigs(userId: number): Promise<ConnectionConfig[]> {
    const result = await this.pool.query(
      `SELECT id, user_id, source_id, source_type, config, connection_status, created_at, updated_at
       FROM connection_configs
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      sourceId: row.source_id,
      sourceType: row.source_type,
      config: row.config,
      connectionStatus: row.connection_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getConnectionConfig(userId: number, sourceId: string): Promise<ConnectionConfig | null> {
    const result = await this.pool.query(
      `SELECT id, user_id, source_id, source_type, config, connection_status, created_at, updated_at
       FROM connection_configs
       WHERE user_id = $1 AND source_id = $2`,
      [userId, sourceId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      sourceId: row.source_id,
      sourceType: row.source_type,
      config: row.config,
      connectionStatus: row.connection_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async deleteConnectionConfig(userId: number, sourceId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM connection_configs WHERE user_id = $1 AND source_id = $2',
      [userId, sourceId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async updateConnectionStatus(
    userId: number,
    sourceId: string,
    status: 'connected' | 'failed' | 'untested'
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE connection_configs 
       SET connection_status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2 AND source_id = $3`,
      [status, userId, sourceId]
    );

    return (result.rowCount ?? 0) > 0;
  }
}

export const connectionConfigService = new ConnectionConfigService();

