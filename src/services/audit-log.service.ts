import { ObjectId } from 'mongodb';
import { getDatabase } from '../database/connection.js';
import type { AuditActor, AuditEvent, AuditTarget } from '../models/audit.model.js';

function safeString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed ? trimmed.slice(0, 500) : undefined;
}

export function getRequestIp(req: Request): string | undefined {
  // If you later place this behind a proxy, configure trusted proxy handling
  // properly; for now we record what we see without attempting spoof-proofing.
  const xf = req.headers.get('x-forwarded-for');
  if (xf) return xf.split(',')[0]?.trim();
  return safeString(req.headers.get('x-real-ip')) || undefined;
}

export function getUserAgent(req: Request): string | undefined {
  return safeString(req.headers.get('user-agent')) || undefined;
}

export async function writeAuditEvent(input: Omit<AuditEvent, 'timestamp'> & { timestamp?: Date }) {
  try {
    const db = getDatabase();
    const doc: AuditEvent = {
      ...input,
      timestamp: input.timestamp ?? new Date(),
    };
    await db.collection('audit_logs').insertOne(doc);
  } catch (e) {
    console.error('Failed to write audit event:', e);
  }
}

export function actorFromAuthUser(authUser: any, req: Request): AuditActor {
  return {
    userId: safeString(authUser?.userId),
    email: safeString(authUser?.email),
    userType: safeString(authUser?.userType) as any,
    ip: getRequestIp(req),
    userAgent: getUserAgent(req),
  };
}

export function targetUser(user: { _id?: ObjectId; email?: string; profile?: any; userType?: string }): AuditTarget {
  const labelParts: string[] = [];
  if (user.profile?.firstName || user.profile?.lastName) {
    labelParts.push(`${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim());
  }
  if (user.userType) labelParts.push(String(user.userType));
  return {
    type: 'user',
    id: user._id?.toString(),
    email: user.email,
    label: labelParts.length ? labelParts.join(' — ') : undefined,
  };
}
