import type { Context, Next } from 'hono';
import { APP_CONSTANTS } from '../config/constants.js';

// In-memory store for rate limiting (use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export const rateLimitMiddleware = (
  maxRequests: number = APP_CONSTANTS.RATE_LIMIT.GENERAL_MAX_REQUESTS,
  windowMs: number = APP_CONSTANTS.RATE_LIMIT.GENERAL_WINDOW
) => {
  return async (c: Context, next: Next) => {
    // Get client identifier (IP address or user ID)
    const clientId = c.req.header('x-forwarded-for') || 
                     c.req.header('x-real-ip') || 
                     'unknown';
    
    const key = `${clientId}:${c.req.path}`;
    const now = Date.now();
    
    const record = rateLimitStore.get(key);
    
    if (!record || now > record.resetTime) {
      // Create new record
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + windowMs,
      });
      await next();
    } else if (record.count < maxRequests) {
      // Increment count
      record.count++;
      await next();
    } else {
      // Rate limit exceeded
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      return c.json(
        {
          error: 'Too many requests',
          message: `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
          retryAfter,
        },
        429
      );
    }
  };
};

// Specific rate limiter for login attempts
export const loginRateLimiter = rateLimitMiddleware(
  APP_CONSTANTS.RATE_LIMIT.LOGIN_MAX_ATTEMPTS,
  APP_CONSTANTS.RATE_LIMIT.LOGIN_WINDOW
);
