import { Request, Response, NextFunction } from 'express';
import { userService } from '../services/user_account/user-service';

export interface AuthenticatedRequest extends Request {
  userId?: number;
  userEmail?: string;
  // Express 5 can infer params as string | string[]; this app uses named params only.
  params: Record<string, string>;
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = userService.verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  req.userId = decoded.userId;
  req.userEmail = decoded.email;
  next();
}

// Optional authentication - doesn't fail if no token, but sets user if token is valid
export function optionalAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    const decoded = userService.verifyToken(token);
    if (decoded) {
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
    }
  }

  next();
}

/** Admin user IDs from env (comma-separated). E.g. ADMIN_USER_IDS=1,2,3 */
function getAdminUserIds(): Set<number> {
  const raw = (process.env.ADMIN_USER_IDS || '').trim();
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n)));
}

/** Require site admin. Use after authenticateToken. Returns 403 if user is not in ADMIN_USER_IDS. */
export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const adminIds = getAdminUserIds();
  if (adminIds.size === 0) {
    return res.status(403).json({ error: 'Admin access not configured. Set ADMIN_USER_IDS in .env.' });
  }
  if (!req.userId || !adminIds.has(req.userId)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}
