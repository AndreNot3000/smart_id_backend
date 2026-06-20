import { ObjectId } from 'mongodb';

export type UserType = 'student' | 'lecturer' | 'admin';
export type UserStatus = 'active' | 'pending' | 'suspended';

export interface User {
  _id?: ObjectId;
  email: string;
  passwordHash: string;
  passwordHistory?: string[];  // Store last 5 password hashes
  userType: UserType;
  institutionId: ObjectId;
  status: UserStatus;
  emailVerified: boolean;
  isFirstLogin?: boolean;  // Track if user needs to change password
  // Bumped on logout, password change, and password reset. Embedded in issued
  // JWTs and checked on every request so old tokens are invalidated server-side.
  // Treated as 0 when absent (legacy users / tokens issued before this field).
  tokenVersion?: number;
  // Latest refresh-token jti. Rotated on login/refresh; cleared on logout/reset.
  refreshTokenId?: string;
  // MFA (TOTP) — enabled primarily for admins.
  mfaEnabled?: boolean;
  mfaSecretEnc?: string; // encrypted TOTP secret
  mfaBackupCodesHash?: string[]; // hashed backup codes (one-time use)
  mfaPendingSecretEnc?: string; // encrypted TOTP secret pending confirmation
  mfaPendingCreatedAt?: Date;
  profile: UserProfile;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserProfile {
  firstName: string;
  lastName: string;
  studentId?: string;        // For students
  lecturerId?: string;       // For lecturers
  facultyId?: string;
  employeeId?: string;
  department?: string;
  year?: string;             // For students
  title?: string;            // Honorific (Mr, Dr, Prof, …) for lecturers and admins
  role?: string;             // @deprecated legacy lecturer honorific — use title
  specialization?: string;   // For lecturers
  avatar?: string;
  phone?: string;
  address?: string;
  dateOfBirth?: Date;
}

export type UserDocument = Required<User> & { _id: ObjectId };

export interface OTPCode {
  _id?: ObjectId;
  email: string;
  // Scopes the code to one institution. Emails are unique only per-institution,
  // so the same address can exist at several universities; without this, a
  // verification could update the wrong user's record. Optional for legacy rows.
  institutionId?: ObjectId;
  code: string;
  purpose: string;
  expiresAt: Date;
  used: boolean;
  attempts?: number;
  lockedUntil?: Date;
  createdAt?: Date;
}

export type OtpVerifyResult =
  | { ok: true; institutionId?: ObjectId }
  | {
      ok: false;
      reason: 'invalid' | 'locked' | 'expired' | 'none';
      attemptsRemaining?: number;
      retryAfter?: number;
    };