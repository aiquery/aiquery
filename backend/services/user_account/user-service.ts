import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDatabasePool } from '../database';
import { createUserRAGDirectory } from '../rag_service/rag.service';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export interface User {
  id: number;
  email: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export class UserService {
  private pool: Pool;

  constructor() {
    this.pool = getDatabasePool();
  }

  async createUser(input: CreateUserInput): Promise<User> {
    // Check if user already exists
    const existingUser = await this.pool.query(
      'SELECT id FROM users WHERE email = $1',
      [input.email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      throw new Error('User with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(input.password, 10);

    // Insert user
    const result = await this.pool.query(
      `INSERT INTO users (email, password_hash, name) 
       VALUES ($1, $2, $3) 
       RETURNING id, email, name, created_at, updated_at`,
      [input.email.toLowerCase(), passwordHash, input.name || null]
    );

    const row = result.rows[0];
    
    // Create user's RAG directory with user name
    try {
      createUserRAGDirectory(row.id, row.name || input.email);
      console.log(`✓ User ${row.id} (${row.name || input.email}) registered successfully with RAG directory`);
    } catch (error) {
      console.error(`⚠ Warning: Failed to create RAG directory for user ${row.id}:`, error);
      // Don't fail user creation if RAG directory creation fails, but log it
      // User can manually create it later via the API endpoint
    }
    
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async login(input: LoginInput): Promise<{ user: User; token: string }> {
    // Find user by email (include status for access control)
    const result = await this.pool.query(
      'SELECT id, email, password_hash, name, created_at, updated_at, status FROM users WHERE email = $1',
      [input.email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid email or password');
    }

    const user = result.rows[0];

    const status = (user.status || 'active').toLowerCase();
    if (status === 'stopped') {
      throw new Error('This account has been stopped. Please contact support.');
    }
    if (status === 'paused') {
      throw new Error('This account is paused. Please contact support.');
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(input.password, user.password_hash);
    if (!isValidPassword) {
      throw new Error('Invalid email or password');
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET as jwt.Secret,
      { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
      token,
    };
  }

  async getUserById(userId: number): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT id, email, name, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT id, email, name, created_at, updated_at FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Update user password by email (used after password reset). */
  async updatePasswordByEmail(email: string, newPassword: string): Promise<boolean> {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    const result = await this.pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE LOWER(email) = LOWER($2)',
      [passwordHash, email]
    );
    return (result.rowCount ?? 0) > 0;
  }

  verifyToken(token: string): { userId: number; email: string } | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; email: string };
      return decoded;
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete a user account and all associated data
   * WARNING: This is a destructive operation
   */
  async deleteUser(userId: number): Promise<boolean> {
    try {
      // Delete user (cascade will delete connection_configs due to ON DELETE CASCADE)
      const result = await this.pool.query(
        'DELETE FROM users WHERE id = $1',
        [userId]
      );

      if (result.rowCount === 0) {
        return false;
      }

      // Note: RAG folder deletion should be handled separately if needed
      // We don't delete it here to avoid file system errors affecting database operations

      return true;
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    }
  }

  /**
   * Get all user IDs (for migration purposes)
   */
  async getAllUserIds(): Promise<number[]> {
    const result = await this.pool.query('SELECT id FROM users ORDER BY id');
    return result.rows.map(row => row.id);
  }

  /**
   * Get all users (for Slack webhook processing)
   */
  async getAllUsers(): Promise<User[]> {
    const result = await this.pool.query(
      'SELECT id, email, name, created_at, updated_at FROM users ORDER BY id'
    );
    return result.rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Update user account status (admin only): active | paused | stopped
   */
  async updateUserStatus(userId: number, status: 'active' | 'paused' | 'stopped'): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE users SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, userId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

export const userService = new UserService();