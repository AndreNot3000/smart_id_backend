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

function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return c.req.header('x-real-ip') || 'unknown';
}

function defaultKey(c: Context): string {
  return `${clientIp(c)}:${c.req.path}`;
}

/** Human-readable retry hint for API responses (e.g. "14m 32s"). */
function formatRetryHint(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s} seconds`;
}

function rateLimitJson(retryAfter: number) {
  return {
    error: 'Too many requests',
    message: `Too many failed attempts. Please try again in ${formatRetryHint(retryAfter)}.`,
    retryAfter,
  };
}

function incrementCounter(key: string, windowMs: number) {
  const now = Date.now();
  const record = rateLimitStore.get(key);
  if (!record || now > record.resetTime) {
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
  } else {
    record.count++;
  }
}

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  /** Build the bucket key. Defaults to IP + route path. */
  keyFn?: (c: Context) => string | Promise<string>;
  /**
   * When true, only failed responses increment the counter (successful logins
   * are not penalised). When false, every request counts.
   */
  countFailuresOnly?: boolean;
  /** HTTP statuses that count as failures when countFailuresOnly is true. */
  failureStatuses?: number[];
}

export function createRateLimiter(options: RateLimitOptions) {
  const {
    maxRequests,
    windowMs,
    keyFn = defaultKey,
    countFailuresOnly = false,
    failureStatuses = [400, 401, 403, 404],
  } = options;

  return async (c: Context, next: Next) => {
    const key = await keyFn(c);
    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (record && now <= record.resetTime && record.count >= maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      return c.json(rateLimitJson(retryAfter), 429);
    }

    await next();

    if (countFailuresOnly && !failureStatuses.includes(c.res.status)) {
      return;
    }

    incrementCounter(key, windowMs);
  };
}

/** Login: IP + email/ID, only failed attempts count (5 per 15 min). */
async function loginKeyFn(c: Context): Promise<string> {
  const ip = clientIp(c);
  let identifier = 'unknown';
  try {
    const cloned = c.req.raw.clone();
    const body = (await cloned.json()) as { email?: string };
    identifier = (body.email || '').toLowerCase().trim() || 'unknown';
  } catch {
    // Body unreadable — fall back to IP-only bucket for this request.
  }
  return `${ip}:${identifier}:${c.req.path}`;
}

export const loginRateLimiter = createRateLimiter({
  maxRequests: APP_CONSTANTS.RATE_LIMIT.LOGIN_MAX_ATTEMPTS,
  windowMs: APP_CONSTANTS.RATE_LIMIT.LOGIN_WINDOW,
  keyFn: loginKeyFn,
  countFailuresOnly: true,
  failureStatuses: [400, 401, 403],
});

/** Other auth endpoints (OTP, forgot-password, …): IP + route, every request counts. */
export const authRateLimiter = createRateLimiter({
  maxRequests: APP_CONSTANTS.RATE_LIMIT.LOGIN_MAX_ATTEMPTS,
  windowMs: APP_CONSTANTS.RATE_LIMIT.LOGIN_WINDOW,
});

// General API rate limiter
export const rateLimitMiddleware = createRateLimiter({
  maxRequests: APP_CONSTANTS.RATE_LIMIT.GENERAL_MAX_REQUESTS,
  windowMs: APP_CONSTANTS.RATE_LIMIT.GENERAL_WINDOW,
});
