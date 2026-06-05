import type { Context, Next } from 'hono';
import { AuthService } from '../services/auth.services.js';
import { getUsersCollection } from '../database/connection.js';
import { ObjectId } from 'mongodb';

export interface AuthUser {
  userId: string;
  userType: 'student' | 'lecturer' | 'admin';
  institutionId: string;
  email: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

// In-memory cache for active-user verification.
// Skips the per-request MongoDB round-trip on hot paths (e.g. rapid QR
// scanning). Entries expire after 60s, so suspending or deactivating a
// user takes effect within a minute without restarting the server.
type CacheEntry = { valid: boolean; expiresAt: number };
const userCache = new Map<string, CacheEntry>();
const USER_CACHE_TTL_MS = 60_000;
const USER_CACHE_MAX = 5000;

function pruneCache() {
  if (userCache.size <= USER_CACHE_MAX) return;
  const now = Date.now();
  for (const [key, value] of userCache) {
    if (value.expiresAt <= now) userCache.delete(key);
    if (userCache.size <= USER_CACHE_MAX) break;
  }
  if (userCache.size > USER_CACHE_MAX) {
    const overflow = userCache.size - USER_CACHE_MAX;
    let i = 0;
    for (const key of userCache.keys()) {
      if (i++ >= overflow) break;
      userCache.delete(key);
    }
  }
}

export const authMiddleware = async (c: Context, next: Next) => {
  try {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Authorization token required' }, 401);
    }

    const token = authHeader.substring(7);
    const decoded = AuthService.verifyToken(token);
    const userId: string = decoded.userId;

    const cached = userCache.get(userId);
    const now = Date.now();

    if (!cached || cached.expiresAt <= now) {
      const usersCollection = getUsersCollection();
      const user = await usersCollection.findOne(
        { _id: new ObjectId(userId), status: 'active', emailVerified: true },
        { projection: { _id: 1 } }
      );

      if (!user) {
        userCache.set(userId, { valid: false, expiresAt: now + USER_CACHE_TTL_MS });
        return c.json({ error: 'User not found or inactive' }, 401);
      }

      userCache.set(userId, { valid: true, expiresAt: now + USER_CACHE_TTL_MS });
      pruneCache();
    } else if (!cached.valid) {
      return c.json({ error: 'User not found or inactive' }, 401);
    }

    c.set('user', {
      userId,
      userType: decoded.userType,
      institutionId: decoded.institutionId,
      email: decoded.email,
    });

    await next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
};

// Allow other code paths (e.g. password change, user suspension) to invalidate
// a cached entry so the change takes effect immediately rather than after TTL.
export function invalidateAuthCache(userId: string) {
  userCache.delete(userId);
}

// Role-based middleware
export const requireRole = (roles: string[]) => {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    
    if (!user || !roles.includes(user.userType)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    await next();
  };
};

// Institution-based middleware (ensures users can only access their institution's data)
export const requireSameInstitution = async (c: Context, next: Next) => {
  const user = c.get('user');
  const institutionId = c.req.param('institutionId') || c.req.query('institutionId');
  
  if (institutionId && institutionId !== user.institutionId) {
    return c.json({ error: 'Access denied to this institution' }, 403);
  }

  await next();
};
