import { Pool } from 'pg';
import { getDatabasePool } from '../database';
import { connectionConfigService } from '../connection/connection-config-service';
import { llmSettingsService } from '../connection/llm-settings-service';
import { thirdPartyService } from '../connection/third-party-service';

export interface WorkspaceMember {
  id: number;
  name: string | null;
  email: string;
  role: string;
}

export interface WorkspaceRecord {
  id: number;
  name: string;
  description: string | null;
  ownerId: number;
  config: any | null;
  createdAt: Date;
  updatedAt: Date;
  ownerName?: string | null;
  ownerEmail?: string | null;
}

interface CreateWorkspaceInput {
  ownerId: number;
  name: string;
  description?: string;
  memberIds?: number[];
  memberRoles?: Record<number, 'admin' | 'view'>;
  includeConfig?: boolean;
}

interface UpdateWorkspaceInput {
  workspaceId: number;
  ownerId: number;
  name?: string;
  description?: string | null;
  memberIds?: number[];
  memberRoles?: Record<number, 'admin' | 'view'>;
  includeConfig?: boolean;
}

export class WorkspaceService {
  private pool: Pool;

  constructor() {
    this.pool = getDatabasePool();
  }

  async listWorkspacesForUser(userId: number): Promise<WorkspaceRecord[]> {
    const result = await this.pool.query(
      `
      SELECT DISTINCT w.id, w.name, w.description, w.owner_id, w.config, w.created_at, w.updated_at,
        u.name as owner_name, u.email as owner_email
      FROM workspaces w
      JOIN users u ON w.owner_id = u.id
      LEFT JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE w.owner_id = $1 OR wm.user_id = $1
      ORDER BY w.updated_at DESC
      `,
      [userId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      ownerId: row.owner_id,
      config: row.config,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ownerName: row.owner_name,
      ownerEmail: row.owner_email
    }));
  }

  async getWorkspaceById(workspaceId: number, userId: number): Promise<WorkspaceRecord | null> {
    const result = await this.pool.query(
      `
      SELECT w.id, w.name, w.description, w.owner_id, w.config, w.created_at, w.updated_at
      FROM workspaces w
      LEFT JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE w.id = $1 AND (w.owner_id = $2 OR wm.user_id = $2)
      LIMIT 1
      `,
      [workspaceId, userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerId: row.owner_id,
      config: row.config,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord> {
    const config = input.includeConfig ? await this.buildWorkspaceConfigForUser(input.ownerId) : null;
    const result = await this.pool.query(
      `
      INSERT INTO workspaces (name, description, owner_id, config)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, description, owner_id, config, created_at, updated_at
      `,
      [input.name, input.description || null, input.ownerId, config ? JSON.stringify(config) : null]
    );

    const row = result.rows[0];
    if (input.memberIds && input.memberIds.length > 0) {
      await this.updateWorkspaceMembers(row.id, input.ownerId, input.memberIds, input.memberRoles);
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerId: row.owner_id,
      config: row.config,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async updateWorkspace(input: UpdateWorkspaceInput): Promise<WorkspaceRecord | null> {
    const existing = await this.getWorkspaceById(input.workspaceId, input.ownerId);
    if (!existing || existing.ownerId !== input.ownerId) {
      return null;
    }

    const config = input.includeConfig ? await this.buildWorkspaceConfigForUser(input.ownerId) : existing.config;
    const result = await this.pool.query(
      `
      UPDATE workspaces
      SET name = $1,
          description = $2,
          config = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING id, name, description, owner_id, config, created_at, updated_at
      `,
      [
        input.name ?? existing.name,
        input.description !== undefined ? input.description : existing.description,
        config ? JSON.stringify(config) : null,
        input.workspaceId
      ]
    );

    const row = result.rows[0];
    if (input.memberIds) {
      await this.updateWorkspaceMembers(row.id, input.ownerId, input.memberIds, input.memberRoles);
    }

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      ownerId: row.owner_id,
      config: row.config,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async deleteWorkspace(workspaceId: number, ownerId: number): Promise<boolean> {
    const existing = await this.getWorkspaceById(workspaceId, ownerId);
    if (!existing || existing.ownerId !== ownerId) {
      return false;
    }

    const result = await this.pool.query(
      'DELETE FROM workspaces WHERE id = $1 AND owner_id = $2',
      [workspaceId, ownerId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async getWorkspaceMembers(workspaceId: number): Promise<WorkspaceMember[]> {
    const result = await this.pool.query(
      `
      SELECT u.id, u.name, u.email, COALESCE(wm.role, 'member') as role
      FROM workspace_members wm
      JOIN users u ON wm.user_id = u.id
      WHERE wm.workspace_id = $1
      ORDER BY u.email ASC
      `,
      [workspaceId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role
    }));
  }

  async updateWorkspaceMembers(
    workspaceId: number,
    ownerId: number,
    memberIds: number[],
    memberRoles?: Record<number, 'admin' | 'view'>
  ): Promise<void> {
    const uniqueMemberIds = Array.from(new Set(memberIds)).filter((id) => id !== ownerId);

    await this.pool.query('DELETE FROM workspace_members WHERE workspace_id = $1', [workspaceId]);

    for (const memberId of uniqueMemberIds) {
      const role = memberRoles?.[memberId] === 'admin' ? 'admin' : 'view';
      await this.pool.query(
        `
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES ($1, $2, $3)
        ON CONFLICT (workspace_id, user_id) DO NOTHING
        `,
        [workspaceId, memberId, role]
      );
    }
  }

  async activateWorkspace(userId: number, workspaceId: number): Promise<WorkspaceRecord | null> {
    const workspace = await this.getWorkspaceById(workspaceId, userId);
    if (!workspace) {
      return null;
    }

    const config = workspace.config;
    if (!config) {
      return workspace;
    }

    const connections = Array.isArray(config?.dataSources?.connections)
      ? config.dataSources.connections
      : [];

    await this.pool.query('DELETE FROM connection_configs WHERE user_id = $1', [userId]);

    for (const connection of connections) {
      if (!connection?.sourceId || !connection?.sourceType || !connection?.config) {
        continue;
      }
      await connectionConfigService.saveConnectionConfig({
        userId,
        sourceId: connection.sourceId,
        sourceType: connection.sourceType,
        config: connection.config,
        connectionStatus: connection.connectionStatus
      });
    }

    // LLM / Community: only sync from workspace snapshot when the JSON explicitly includes those keys.
    // Otherwise we must NOT delete live rows — Slack/Teams are often saved via /api/third-party/* and are
    // not mirrored into workspaces.config; "Open workspace" would otherwise wipe third_party_connections.
    if (config && typeof config === 'object' && 'llm' in config) {
      if (config.llm) {
        await llmSettingsService.saveLLMSettings({
          userId,
          provider: config.llm.provider,
          modelType: config.llm.modelType || 'full',
          openaiApiKey: config.llm.openaiApiKey,
          geminiApiKey: config.llm.geminiApiKey,
          openaiModelName: config.llm.openaiModelName || null,
          geminiModelName: config.llm.geminiModelName || null,
          connectionStatus: config.llm.connectionStatus || 'untested'
        });
      } else {
        await llmSettingsService.deleteLLMSettings(userId);
      }
    }

    // Community (Slack/Teams): only APPLY non-empty snapshot data to the DB. Never delete here.
    // Workspace JSON often has community.slack/teams as null (snapshot from buildWorkspaceConfigForUser
    // when secrets aren't embedded); opening a workspace must not wipe rows saved via /api/third-party/*.
    // To remove Slack/Teams credentials, use Disconnect in the UI (DELETE /api/third-party/*).
    const community = config?.community;
    if (community && typeof community === 'object') {
      if (Object.prototype.hasOwnProperty.call(community, 'slack') && community.slack) {
        await thirdPartyService.saveThirdPartyConfig({
          userId,
          serviceType: 'slack',
          config: community.slack
        });
      }
      if (Object.prototype.hasOwnProperty.call(community, 'teams') && community.teams) {
        await thirdPartyService.saveThirdPartyConfig({
          userId,
          serviceType: 'teams',
          config: community.teams
        });
      }
    }

    return workspace;
  }

  private async buildWorkspaceConfigForUser(userId: number) {
    const connectionConfigs = await connectionConfigService.getConnectionConfigs(userId);
    const llmSettings = await llmSettingsService.getLLMSettings(userId);
    const slackConfig = await thirdPartyService.getThirdPartyConfig(userId, 'slack');
    const teamsConfig = await thirdPartyService.getThirdPartyConfig(userId, 'teams');

    return {
      dataSources: {
        connections: connectionConfigs.map((config) => ({
          sourceId: config.sourceId,
          sourceType: config.sourceType,
          config: config.config,
          connectionStatus: config.connectionStatus
        }))
      },
      llm: llmSettings
        ? {
            provider: llmSettings.provider,
            modelType: llmSettings.modelType,
            openaiApiKey: llmSettings.openaiApiKey,
            geminiApiKey: llmSettings.geminiApiKey,
            openaiModelName: llmSettings.openaiModelName,
            geminiModelName: llmSettings.geminiModelName,
            connectionStatus: llmSettings.connectionStatus
          }
        : null,
      community: {
        slack: slackConfig?.config || null,
        teams: teamsConfig?.config || null
      }
    };
  }
}

export const workspaceService = new WorkspaceService();
