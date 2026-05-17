import { Pool } from 'pg';
import { getDatabasePool } from '../database';
import { v4 as uuidv4 } from 'uuid';

/** `chat_sessions.title` and `chat_history.title` are VARCHAR(500) in schema. */
const CHAT_SESSION_TITLE_MAX_LEN = 500;

function truncateChatSessionTitle(s: string): string {
  const t = (s ?? '').trim();
  if (t.length <= CHAT_SESSION_TITLE_MAX_LEN) return t;
  return `${t.slice(0, CHAT_SESSION_TITLE_MAX_LEN - 1)}…`;
}

/** Persisted live execution progress for a data-query turn (matches backend/lib/execution-steps). */
export interface ExecutionStepRow {
  id: string;
  title: string;
  detail: string;
}

export interface ChatMessage {
  id: number;
  userId: number;
  sessionId: string;
  title?: string | null;
  question: string;
  response: string;
  sqlQuery?: string | null;
  queryResults?: any;
  executionSteps?: ExecutionStepRow[] | null;
  followUpQuestions?: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatSession {
  id: number;
  userId: number;
  sessionId: string;
  title?: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount?: number;
}

export interface ChatHistoryQuestionItem {
  id: number;
  sessionId: string;
  question: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateChatMessageInput {
  userId: number;
  sessionId?: string;
  question: string;
  response: string;
  sqlQuery?: string;
  queryResults?: any;
  executionSteps?: ExecutionStepRow[];
  followUpQuestions?: string[];
}

export class ChatHistoryService {
  private pool: Pool;

  constructor() {
    this.pool = getDatabasePool();
  }

  /**
   * Generate a new session ID
   */
  generateSessionId(): string {
    return uuidv4();
  }

  /**
   * Create or get a chat session
   */
  async getOrCreateSession(userId: number, sessionId?: string): Promise<string> {
    if (sessionId) {
      // Check if session exists
      const result = await this.pool.query(
        'SELECT session_id FROM chat_sessions WHERE session_id = $1 AND user_id = $2',
        [sessionId, userId]
      );
      
      if (result.rows.length > 0) {
        return sessionId;
      }
    }

    // Create new session
    const newSessionId = this.generateSessionId();
    await this.pool.query(
      `INSERT INTO chat_sessions (user_id, session_id, title)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO NOTHING`,
      [userId, newSessionId, null]
    );

    return newSessionId;
  }

  /**
   * Save a chat message
   */
  async saveChatMessage(input: CreateChatMessageInput): Promise<ChatMessage> {
    const sessionId = await this.getOrCreateSession(input.userId, input.sessionId);

    // Generate title from first question if session is new
    const sessionResult = await this.pool.query(
      'SELECT title FROM chat_sessions WHERE session_id = $1',
      [sessionId]
    );

    let title = sessionResult.rows[0]?.title;
    if (!title) {
      // Sidebar label only — never store merged upload blobs (Slack can send multi-KB `question`)
      title = truncateChatSessionTitle(input.question);

      // Update session title
      await this.pool.query(
        'UPDATE chat_sessions SET title = $1, updated_at = CURRENT_TIMESTAMP WHERE session_id = $2',
        [title, sessionId]
      );
    }

    // Save chat message
    // Handle queryResults - ensure it's properly stringified
    let queryResultsJson = null;
    if (input.queryResults) {
      // If it's already a string, check if it's valid JSON
      if (typeof input.queryResults === 'string') {
        try {
          // Try to parse it to validate it's valid JSON
          JSON.parse(input.queryResults);
          queryResultsJson = input.queryResults; // Already valid JSON string
        } catch (e) {
          // If it's not valid JSON (like "[object Object]"), stringify it properly
          queryResultsJson = JSON.stringify(input.queryResults);
        }
      } else {
        // It's an object, stringify it
        queryResultsJson = JSON.stringify(input.queryResults);
      }
    }
    
    let executionStepsJson: string | null = null;
    if (input.executionSteps && input.executionSteps.length > 0) {
      executionStepsJson = JSON.stringify(input.executionSteps);
    }

    let followUpQuestionsJson: string | null = null;
    if (input.followUpQuestions && input.followUpQuestions.length > 0) {
      followUpQuestionsJson = JSON.stringify(input.followUpQuestions);
    }

    const result = await this.pool.query(
      `INSERT INTO chat_history 
       (user_id, session_id, title, question, response, sql_query, query_results, execution_steps, follow_up_questions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
       RETURNING *`,
      [
        input.userId,
        sessionId,
        truncateChatSessionTitle(title ?? ''),
        input.question,
        input.response,
        input.sqlQuery || null,
        queryResultsJson,
        executionStepsJson,
        followUpQuestionsJson
      ]
    );

    // Update session updated_at
    await this.pool.query(
      'UPDATE chat_sessions SET updated_at = CURRENT_TIMESTAMP WHERE session_id = $1',
      [sessionId]
    );

    const row = result.rows[0];
    // PostgreSQL JSONB returns as object, not string, so we don't need to parse
    let queryResults = null;
    if (row.query_results) {
      if (typeof row.query_results === 'string') {
        queryResults = JSON.parse(row.query_results);
      } else {
        queryResults = row.query_results; // Already an object
      }
    }

    let executionSteps: ExecutionStepRow[] | null = null;
    if (row.execution_steps) {
      if (typeof row.execution_steps === 'string') {
        executionSteps = JSON.parse(row.execution_steps);
      } else if (Array.isArray(row.execution_steps)) {
        executionSteps = row.execution_steps;
      }
    }

    let followUpQuestions: string[] | null = null;
    if (row.follow_up_questions) {
      if (typeof row.follow_up_questions === 'string') {
        followUpQuestions = JSON.parse(row.follow_up_questions);
      } else if (Array.isArray(row.follow_up_questions)) {
        followUpQuestions = row.follow_up_questions;
      }
    }
    
    return {
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      title: row.title,
      question: row.question,
      response: row.response,
      sqlQuery: row.sql_query,
      queryResults: queryResults,
      executionSteps,
      followUpQuestions,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Get all chat sessions for a user
   */
  async getUserSessions(userId: number, limit: number = 50): Promise<ChatSession[]> {
    const result = await this.pool.query(
      `SELECT 
         cs.id,
         cs.user_id,
         cs.session_id,
         cs.title,
         cs.created_at,
         cs.updated_at,
         COUNT(ch.id) as message_count
       FROM chat_sessions cs
       LEFT JOIN chat_history ch ON cs.session_id = ch.session_id
       WHERE cs.user_id = $1
       GROUP BY cs.id, cs.user_id, cs.session_id, cs.title, cs.created_at, cs.updated_at
       ORDER BY cs.updated_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: parseInt(row.message_count || '0', 10)
    }));
  }

  /**
   * Get all messages in a session
   */
  async getSessionMessages(userId: number, sessionId: string): Promise<ChatMessage[]> {
    const result = await this.pool.query(
      `SELECT * FROM chat_history
       WHERE user_id = $1 AND session_id = $2
       ORDER BY created_at ASC`,
      [userId, sessionId]
    );

    return result.rows.map(row => {
      // PostgreSQL JSONB returns as object, not string, so we don't need to parse
      let queryResults = null;
      if (row.query_results) {
        if (typeof row.query_results === 'string') {
          queryResults = JSON.parse(row.query_results);
        } else {
          queryResults = row.query_results; // Already an object
        }
      }

      let executionSteps: ExecutionStepRow[] | null = null;
      if (row.execution_steps) {
        if (typeof row.execution_steps === 'string') {
          executionSteps = JSON.parse(row.execution_steps);
        } else if (Array.isArray(row.execution_steps)) {
          executionSteps = row.execution_steps;
        }
      }

      let followUpQuestions: string[] | null = null;
      if (row.follow_up_questions) {
        if (typeof row.follow_up_questions === 'string') {
          followUpQuestions = JSON.parse(row.follow_up_questions);
        } else if (Array.isArray(row.follow_up_questions)) {
          followUpQuestions = row.follow_up_questions;
        }
      }
      
      return {
        id: row.id,
        userId: row.user_id,
        sessionId: row.session_id,
        title: row.title,
        question: row.question,
        response: row.response,
        sqlQuery: row.sql_query,
        queryResults: queryResults,
        executionSteps,
        followUpQuestions,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });
  }

  /**
   * Get recent chat questions for a user (one row per question/message).
   */
  async getUserQuestionItems(userId: number, limit: number = 200): Promise<ChatHistoryQuestionItem[]> {
    const result = await this.pool.query(
      `SELECT id, session_id, question, created_at, updated_at
       FROM chat_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      question: row.question,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Update session title
   */
  async updateSessionTitle(userId: number, sessionId: string, title: string): Promise<boolean> {
    const safeTitle = truncateChatSessionTitle(title);
    const result = await this.pool.query(
      `UPDATE chat_sessions 
       SET title = $1, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $2 AND user_id = $3`,
      [safeTitle, sessionId, userId]
    );

    // Also update all messages in the session
    await this.pool.query(
      `UPDATE chat_history 
       SET title = $1, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $2 AND user_id = $3`,
      [safeTitle, sessionId, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete a chat session and all its messages
   */
  async deleteSession(userId: number, sessionId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM chat_sessions WHERE session_id = $1 AND user_id = $2',
      [sessionId, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete a specific chat message
   */
  async deleteMessage(userId: number, messageId: number): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM chat_history WHERE id = $1 AND user_id = $2',
      [messageId, userId]
    );

    return (result.rowCount ?? 0) > 0;
  }
}

export const chatHistoryService = new ChatHistoryService();
