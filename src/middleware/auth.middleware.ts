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

export const authMiddleware = async (c: Context, next: Next) => {
  try {
    const authHeader = c.req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Authorization token required' }, 401);
    }

    const token = authHeader.substring(7);
    const decoded = AuthService.verifyToken(token);
    
    // Verify user still exists and is active
    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({ 
      _id: new ObjectId(decoded.userId),
      status: 'active',
      emailVerified: true
    });

    if (!user) {
      return c.json({ error: 'User not found or inactive' }, 401);
    }

    // Set user in context
    c.set('user', {
      userId: decoded.userId,
      userType: decoded.userType,
      institutionId: decoded.institutionId,
      email: decoded.email
    });

    await next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
};

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
