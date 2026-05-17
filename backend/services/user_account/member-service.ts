import { getDatabasePool } from '../database';
import crypto from 'crypto';

export interface TeamMember {
  id: number;
  teamId: number;
  userId: number;
  email: string;
  name: string | null;
  role: 'admin' | 'view';
  invitedBy: number | null;
  invitedAt: Date;
  joinedAt: Date | null;
}

export class MemberService {
  /**
   * Get all team members for a team (including the team owner)
   */
  async getTeamMembers(teamId: number): Promise<TeamMember[]> {
    const pool = getDatabasePool();
    const result = await pool.query(`
      SELECT 
        tm.id,
        tm.team_id as "teamId",
        tm.user_id as "userId",
        u.email,
        u.name,
        tm.role,
        tm.invited_by as "invitedBy",
        tm.invited_at as "invitedAt",
        tm.joined_at as "joinedAt"
      FROM team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = $1
      ORDER BY tm.created_at DESC
    `, [teamId]);

    // Also include the team owner
    const ownerResult = await pool.query(`
      SELECT id, email, name, role, created_at
      FROM users
      WHERE id = $1
    `, [teamId]);

    const members: TeamMember[] = result.rows.map(row => ({
      id: row.id,
      teamId: row.teamId,
      userId: row.userId,
      email: row.email,
      name: row.name,
      role: row.role,
      invitedBy: row.invitedBy,
      invitedAt: row.invitedAt,
      joinedAt: row.joinedAt
    }));

    // Add owner as admin member
    if (ownerResult.rows.length > 0) {
      const owner = ownerResult.rows[0];
      members.unshift({
        id: 0, // Special ID for owner
        teamId: owner.id,
        userId: owner.id,
        email: owner.email,
        name: owner.name,
        role: 'admin',
        invitedBy: null,
        invitedAt: owner.created_at,
        joinedAt: owner.created_at
      });
    }

    return members;
  }

  /**
   * Invite a user to join a team
   */
  async inviteMember(
    teamId: number,
    email: string,
    role: 'admin' | 'view',
    invitedBy: number
  ): Promise<{ success: boolean; message: string; userId?: number }> {
    const pool = getDatabasePool();

    try {
      // Check if user exists
      const userResult = await pool.query(`
        SELECT id FROM users WHERE email = $1
      `, [email]);

      let userId: number;

      if (userResult.rows.length === 0) {
        // User doesn't exist - create invitation record (we'll need to handle this differently)
        // For now, return error asking user to sign up first
        return {
          success: false,
          message: 'User does not exist. Please ask them to sign up first, then invite them.'
        };
      } else {
        userId = userResult.rows[0].id;
      }

      // Check if already a member
      const existingResult = await pool.query(`
        SELECT id FROM team_members 
        WHERE team_id = $1 AND user_id = $2
      `, [teamId, userId]);

      if (existingResult.rows.length > 0) {
        return {
          success: false,
          message: 'User is already a team member'
        };
      }

      // Add member
      await pool.query(`
        INSERT INTO team_members (team_id, user_id, role, invited_by, joined_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (team_id, user_id) DO UPDATE
        SET role = $3, updated_at = CURRENT_TIMESTAMP
      `, [teamId, userId, role, invitedBy]);

      return {
        success: true,
        message: 'Member invited successfully',
        userId
      };
    } catch (error: any) {
      console.error('Error inviting member:', error);
      return {
        success: false,
        message: error.message || 'Failed to invite member'
      };
    }
  }

  /**
   * Update member role
   */
  async updateMemberRole(
    teamId: number,
    userId: number,
    role: 'admin' | 'view',
    updatedBy: number
  ): Promise<{ success: boolean; message: string }> {
    const pool = getDatabasePool();

    try {
      // Check if updater is admin
      const updaterResult = await pool.query(`
        SELECT role FROM users WHERE id = $1
      `, [updatedBy]);

      if (updaterResult.rows.length === 0 || updaterResult.rows[0].role !== 'admin') {
        // Check if updater is team owner
        if (updatedBy !== teamId) {
          // Check if updater is admin member
          const memberResult = await pool.query(`
            SELECT role FROM team_members 
            WHERE team_id = $1 AND user_id = $2 AND role = 'admin'
          `, [teamId, updatedBy]);

          if (memberResult.rows.length === 0) {
            return {
              success: false,
              message: 'Only admins can update member roles'
            };
          }
        }
      }

      // Update role
      await pool.query(`
        UPDATE team_members
        SET role = $1, updated_at = CURRENT_TIMESTAMP
        WHERE team_id = $2 AND user_id = $3
      `, [role, teamId, userId]);

      return {
        success: true,
        message: 'Member role updated successfully'
      };
    } catch (error: any) {
      console.error('Error updating member role:', error);
      return {
        success: false,
        message: error.message || 'Failed to update member role'
      };
    }
  }

  /**
   * Remove member from team
   */
  async removeMember(
    teamId: number,
    userId: number,
    removedBy: number
  ): Promise<{ success: boolean; message: string }> {
    const pool = getDatabasePool();

    try {
      // Cannot remove team owner
      if (userId === teamId) {
        return {
          success: false,
          message: 'Cannot remove team owner'
        };
      }

      // Check if remover is admin
      const removerResult = await pool.query(`
        SELECT role FROM users WHERE id = $1
      `, [removedBy]);

      if (removerResult.rows.length === 0 || removerResult.rows[0].role !== 'admin') {
        // Check if remover is team owner
        if (removedBy !== teamId) {
          // Check if remover is admin member
          const memberResult = await pool.query(`
            SELECT role FROM team_members 
            WHERE team_id = $1 AND user_id = $2 AND role = 'admin'
          `, [teamId, removedBy]);

          if (memberResult.rows.length === 0) {
            return {
              success: false,
              message: 'Only admins can remove members'
            };
          }
        }
      }

      // Remove member
      await pool.query(`
        DELETE FROM team_members
        WHERE team_id = $1 AND user_id = $2
      `, [teamId, userId]);

      return {
        success: true,
        message: 'Member removed successfully'
      };
    } catch (error: any) {
      console.error('Error removing member:', error);
      return {
        success: false,
        message: error.message || 'Failed to remove member'
      };
    }
  }

  /**
   * Check if user has permission for an action
   */
  async hasPermission(
    userId: number,
    teamId: number,
    action: 'configure' | 'query'
  ): Promise<boolean> {
    const pool = getDatabasePool();

    try {
      // Team owner has all permissions
      if (userId === teamId) {
        return true;
      }

      // Check user's global role
      const userResult = await pool.query(`
        SELECT role FROM users WHERE id = $1
      `, [userId]);

      if (userResult.rows.length > 0 && userResult.rows[0].role === 'admin') {
        return true;
      }

      // Check team membership
      const memberResult = await pool.query(`
        SELECT role FROM team_members 
        WHERE team_id = $1 AND user_id = $2
      `, [teamId, userId]);

      if (memberResult.rows.length === 0) {
        return false; // Not a team member
      }

      const role = memberResult.rows[0].role;

      if (action === 'configure') {
        return role === 'admin';
      } else if (action === 'query') {
        return true; // Both admin and view can query
      }

      return false;
    } catch (error) {
      console.error('Error checking permission:', error);
      return false;
    }
  }

  /**
   * Generate an invite token for team invitation
   */
  async generateInviteToken(
    teamId: number,
    role: 'admin' | 'view',
    createdBy: number,
    expiresInDays: number = 30
  ): Promise<{ success: boolean; token?: string; error?: string }> {
    const pool = getDatabasePool();

    try {
      // Generate a secure random token
      const token = crypto.randomBytes(32).toString('hex');
      
      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);

      // Insert token into database
      await pool.query(`
        INSERT INTO invite_tokens (team_id, token, role, created_by, expires_at)
        VALUES ($1, $2, $3, $4, $5)
      `, [teamId, token, role, createdBy, expiresAt]);

      return {
        success: true,
        token
      };
    } catch (error: any) {
      console.error('Error generating invite token:', error);
      return {
        success: false,
        error: error.message || 'Failed to generate invite token'
      };
    }
  }

  /**
   * Validate and use an invite token
   */
  async useInviteToken(
    token: string,
    userId: number
  ): Promise<{ success: boolean; teamId?: number; role?: string; error?: string }> {
    const pool = getDatabasePool();

    try {
      // Find the token
      const tokenResult = await pool.query(`
        SELECT team_id, role, expires_at, used_at
        FROM invite_tokens
        WHERE token = $1
      `, [token]);

      if (tokenResult.rows.length === 0) {
        return {
          success: false,
          error: 'Invalid invite token'
        };
      }

      const invite = tokenResult.rows[0];

      // Check if token is expired
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        return {
          success: false,
          error: 'Invite token has expired'
        };
      }

      // Check if token is already used
      if (invite.used_at) {
        return {
          success: false,
          error: 'Invite token has already been used'
        };
      }

      // Check if user is already a member
      const existingMember = await pool.query(`
        SELECT id FROM team_members
        WHERE team_id = $1 AND user_id = $2
      `, [invite.team_id, userId]);

      if (existingMember.rows.length > 0) {
        return {
          success: false,
          error: 'You are already a member of this team'
        };
      }

      // Add user as team member
      await pool.query(`
        INSERT INTO team_members (team_id, user_id, role, invited_by, joined_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (team_id, user_id) DO UPDATE
        SET role = $3, updated_at = CURRENT_TIMESTAMP
      `, [invite.team_id, userId, invite.role, invite.team_id]);

      // Mark token as used
      await pool.query(`
        UPDATE invite_tokens
        SET used_at = CURRENT_TIMESTAMP, used_by = $1
        WHERE token = $2
      `, [userId, token]);

      return {
        success: true,
        teamId: invite.team_id,
        role: invite.role
      };
    } catch (error: any) {
      console.error('Error using invite token:', error);
      return {
        success: false,
        error: error.message || 'Failed to use invite token'
      };
    }
  }
}

export const memberService = new MemberService();

