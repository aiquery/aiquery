import { Pool } from 'pg';
import { getDatabasePool } from '../database';

export type LLMProviderId = 'openai' | 'gemini' | 'anthropic';

/** When falling back to server env keys (no user API keys saved). */
export type EnvLLMPreference = 'random' | 'openai' | 'gemini' | 'anthropic';

export interface LLMSettings {
  id: number;
  userId: number;
  provider: LLMProviderId;
  modelType: 'full' | 'light';
  openaiApiKey?: string | null;
  geminiApiKey?: string | null;
  anthropicApiKey?: string | null;
  openaiModelName?: string | null;
  geminiModelName?: string | null;
  anthropicModelName?: string | null;
  envLlmPreference: EnvLLMPreference;
  connectionStatus: 'connected' | 'failed' | 'untested';
  createdAt: Date;
  updatedAt: Date;
}

export interface SaveLLMSettingsInput {
  userId: number;
  provider: LLMProviderId;
  modelType: 'full' | 'light';
  openaiApiKey?: string;
  geminiApiKey?: string;
  anthropicApiKey?: string;
  openaiModelName?: string | null;
  geminiModelName?: string | null;
  anthropicModelName?: string | null;
  envLlmPreference?: EnvLLMPreference;
  connectionStatus?: 'connected' | 'failed' | 'untested';
}

export class LLMSettingsService {
  private pool: Pool;

  constructor() {
    this.pool = getDatabasePool();
  }

  async getLLMSettings(userId: number): Promise<LLMSettings | null> {
    const result = await this.pool.query(
      'SELECT * FROM llm_settings WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      modelType: row.model_type,
      openaiApiKey: row.openai_api_key,
      geminiApiKey: row.gemini_api_key,
      anthropicApiKey: row.anthropic_api_key ?? null,
      openaiModelName: row.openai_model_name || null,
      geminiModelName: row.gemini_model_name || null,
      anthropicModelName: row.anthropic_model_name || null,
      envLlmPreference: (row.env_llm_preference as EnvLLMPreference) || 'random',
      connectionStatus: row.connection_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async saveLLMSettings(input: SaveLLMSettingsInput): Promise<LLMSettings> {
    const existing = await this.pool.query(
      'SELECT id FROM llm_settings WHERE user_id = $1',
      [input.userId]
    );

    const normalizedOpenaiKey = (input.openaiApiKey && input.openaiApiKey.trim()) || null;
    const normalizedGeminiKey = (input.geminiApiKey && input.geminiApiKey.trim()) || null;
    const normalizedAnthropicKey = (input.anthropicApiKey && input.anthropicApiKey.trim()) || null;
    const envPref = input.envLlmPreference || 'random';

    if (existing.rows.length > 0) {
      const result = await this.pool.query(
        `UPDATE llm_settings 
         SET provider = $1, model_type = $2, openai_api_key = $3, gemini_api_key = $4, anthropic_api_key = $5,
             openai_model_name = $6, gemini_model_name = $7, anthropic_model_name = $8,
             env_llm_preference = $9,
             connection_status = $10, updated_at = CURRENT_TIMESTAMP
         WHERE user_id = $11
         RETURNING *`,
        [
          input.provider,
          input.modelType,
          normalizedOpenaiKey,
          normalizedGeminiKey,
          normalizedAnthropicKey,
          input.openaiModelName || null,
          input.geminiModelName || null,
          input.anthropicModelName || null,
          envPref,
          input.connectionStatus || 'untested',
          input.userId,
        ]
      );

      const row = result.rows[0];
      return this.rowToSettings(row);
    }

    const result = await this.pool.query(
      `INSERT INTO llm_settings (user_id, provider, model_type, openai_api_key, gemini_api_key, anthropic_api_key, openai_model_name, gemini_model_name, anthropic_model_name, env_llm_preference, connection_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.userId,
        input.provider,
        input.modelType,
        normalizedOpenaiKey,
        normalizedGeminiKey,
        normalizedAnthropicKey,
        input.openaiModelName || null,
        input.geminiModelName || null,
        input.anthropicModelName || null,
        envPref,
        input.connectionStatus || 'untested',
      ]
    );

    return this.rowToSettings(result.rows[0]);
  }

  private rowToSettings(row: Record<string, unknown>): LLMSettings {
    return {
      id: row.id as number,
      userId: row.user_id as number,
      provider: row.provider as LLMProviderId,
      modelType: row.model_type as 'full' | 'light',
      openaiApiKey: row.openai_api_key as string | null,
      geminiApiKey: row.gemini_api_key as string | null,
      anthropicApiKey: (row.anthropic_api_key as string | null) ?? null,
      openaiModelName: (row.openai_model_name as string | null) || null,
      geminiModelName: (row.gemini_model_name as string | null) || null,
      anthropicModelName: (row.anthropic_model_name as string | null) || null,
      envLlmPreference: ((row.env_llm_preference as EnvLLMPreference) || 'random'),
      connectionStatus: row.connection_status as 'connected' | 'failed' | 'untested',
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    };
  }

  async updateConnectionStatus(
    userId: number,
    status: 'connected' | 'failed' | 'untested'
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE llm_settings 
       SET connection_status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [status, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  async deleteLLMSettings(userId: number): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM llm_settings WHERE user_id = $1',
      [userId]
    );

    return (result.rowCount ?? 0) > 0;
  }
}

export const llmSettingsService = new LLMSettingsService();
