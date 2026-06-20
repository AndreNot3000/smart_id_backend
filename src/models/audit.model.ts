import { ObjectId } from 'mongodb';

export type AuditOutcome = 'success' | 'failure';

export interface AuditActor {
  userId?: string;
  email?: string;
  userType?: 'student' | 'lecturer' | 'admin' | 'system';
  ip?: string;
  userAgent?: string;
}

export interface AuditTarget {
  type: 'user' | 'institution' | 'course' | 'auth' | 'system';
  id?: string;
  email?: string;
  label?: string;
}

export interface AuditEvent {
  _id?: ObjectId;
  institutionId?: ObjectId;
  timestamp: Date;
  action: string;
  actor: AuditActor;
  target?: AuditTarget;
  outcome: AuditOutcome;
  metadata?: Record<string, unknown>;
  errorMessage?: string;
}

export type AuditEventDocument = Required<AuditEvent> & { _id: ObjectId };
