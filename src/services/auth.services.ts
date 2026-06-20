import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { getOTPCollection, getUsersCollection } from '../database/connection.js';
import { sendOTPEmail } from './email.services.js';
import { APP_CONSTANTS } from '../config/constants.js';
import type { OtpVerifyResult } from '../models/user.model.js';
import { decryptString, encryptString } from '../utils/crypto-box.js';
import { generateTotpSecret, verifyTotpCode } from '../utils/totp.js';

export class AuthService {
  static async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, APP_CONSTANTS.PASSWORD.BCRYPT_ROUNDS);
  }

  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }

  static createRefreshTokenId(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  static generateMfaChallengeToken(userId: string, institutionId: string, email: string): string {
    const secret = process.env.JWT_SECRET!;
    if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters long');
    return jwt.sign(
      { purpose: 'mfa', userId, institutionId, email },
      secret,
      { expiresIn: '5m', algorithm: 'HS256' },
    );
  }

  static verifyMfaChallengeToken(token: string): { userId: string; institutionId: string; email: string } {
    const secret = process.env.JWT_SECRET!;
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
    if (decoded?.purpose !== 'mfa' || !decoded?.userId) throw new Error('Invalid MFA token');
    return { userId: decoded.userId, institutionId: decoded.institutionId, email: decoded.email };
  }

  static generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      codes.push(crypto.randomBytes(6).toString('base64url').slice(0, 10));
    }
    return codes;
  }

  static async hashBackupCodes(codes: string[]): Promise<string[]> {
    const rounds = Math.max(10, Math.min(14, APP_CONSTANTS.PASSWORD.BCRYPT_ROUNDS));
    const hashed: string[] = [];
    for (const c of codes) {
      hashed.push(await bcrypt.hash(c, rounds));
    }
    return hashed;
  }

  static encryptMfaSecret(secretBase32: string): string {
    return encryptString(secretBase32);
  }

  static decryptMfaSecret(packed: string): string {
    return decryptString(packed);
  }

  static generateMfaSecret(): string {
    return generateTotpSecret();
  }

  static verifyTotp(secretBase32: string, code: string): boolean {
    return verifyTotpCode(secretBase32, code, 1);
  }

  static async generateTokens(
    userId: string,
    userType: string,
    institutionId: string,
    email: string,
    tokenVersion: number = 0,
  ) {
    const secret = process.env.JWT_SECRET!;
    const refreshSecret = process.env.JWT_REFRESH_SECRET!;

    // Validate secrets exist and are strong enough
    if (!secret || secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long');
    }
    if (!refreshSecret || refreshSecret.length < 32) {
      throw new Error('JWT_REFRESH_SECRET must be at least 32 characters long');
    }

    const payload = {
      userId,
      userType,
      institutionId,
      email,
      tokenVersion,
    };

    const refreshTokenId = this.createRefreshTokenId();

    const accessToken = jwt.sign(payload, secret, {
      expiresIn: APP_CONSTANTS.TOKEN.ACCESS_TOKEN_EXPIRY,
      algorithm: 'HS256',
    });
    // tokenVersion + refreshTokenId travel with the refresh token so logout,
    // password change, and reuse detection can invalidate it server-side.
    const refreshToken = jwt.sign({ userId, tokenVersion, refreshTokenId }, refreshSecret, {
      expiresIn: APP_CONSTANTS.TOKEN.REFRESH_TOKEN_EXPIRY,
      algorithm: 'HS256',
    });

    return { accessToken, refreshToken, refreshTokenId };
  }

  /** Mint tokens and persist the refresh jti so rotation/reuse checks work. */
  static async issueSessionTokens(
    userId: string,
    userType: string,
    institutionId: string,
    email: string,
    tokenVersion: number = 0,
  ) {
    const tokens = await this.generateTokens(
      userId,
      userType,
      institutionId,
      email,
      tokenVersion,
    );

    await getUsersCollection().updateOne(
      { _id: new ObjectId(userId) },
      { $set: { refreshTokenId: tokens.refreshTokenId, updatedAt: new Date() } },
    );

    const { refreshTokenId: _jti, ...publicTokens } = tokens;
    return publicTokens;
  }

  static async generateOTP(email: string, purpose: string, institutionId?: ObjectId): Promise<string> {
    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + APP_CONSTANTS.OTP.EXPIRY);

    const otpCollection = getOTPCollection();

    // Invalidate any existing OTPs for this email and purpose (scoped to the
    // institution when known, so we don't disturb a same-email user elsewhere).
    await otpCollection.updateMany(
      { email, purpose, used: false, ...(institutionId ? { institutionId } : {}) },
      { $set: { used: true } },
    );

    // Create new OTP (attempt counter resets with each fresh code)
    await otpCollection.insertOne({
      email,
      ...(institutionId ? { institutionId } : {}),
      code,
      purpose,
      expiresAt,
      used: false,
      attempts: 0,
      createdAt: new Date(),
    });

    // Send OTP email
    await sendOTPEmail(email, code, purpose);

    return code;
  }

  /**
   * Verify an OTP with per-code attempt tracking and lockout after too many
   * wrong guesses. Finds the latest active code for email+purpose.
   */
  static async verifyOTPAttempt(
    email: string,
    code: string,
    purpose: string,
    institutionId?: ObjectId,
  ): Promise<OtpVerifyResult> {
    const otpCollection = getOTPCollection();
    const now = new Date();

    const filter: Record<string, unknown> = {
      email,
      purpose,
      used: false,
      expiresAt: { $gt: now },
      ...(institutionId ? { institutionId } : {}),
    };

    const otpDoc = await otpCollection.findOne(filter, { sort: { createdAt: -1 } });

    if (!otpDoc) {
      return { ok: false, reason: 'none' };
    }

    if (otpDoc.lockedUntil && otpDoc.lockedUntil > now) {
      const retryAfter = Math.ceil((otpDoc.lockedUntil.getTime() - now.getTime()) / 1000);
      return { ok: false, reason: 'locked', retryAfter };
    }

    if (otpDoc.code === code) {
      await otpCollection.updateOne({ _id: otpDoc._id }, { $set: { used: true } });
      return { ok: true, institutionId: otpDoc.institutionId };
    }

    const attempts = (otpDoc.attempts ?? 0) + 1;
    const maxAttempts = APP_CONSTANTS.OTP.MAX_ATTEMPTS;

    if (attempts >= maxAttempts) {
      const lockedUntil = new Date(now.getTime() + APP_CONSTANTS.OTP.LOCKOUT_MS);
      await otpCollection.updateOne(
        { _id: otpDoc._id },
        { $set: { attempts, lockedUntil } },
      );
      const retryAfter = Math.ceil(APP_CONSTANTS.OTP.LOCKOUT_MS / 1000);
      return { ok: false, reason: 'locked', retryAfter };
    }

    await otpCollection.updateOne({ _id: otpDoc._id }, { $set: { attempts } });

    return {
      ok: false,
      reason: 'invalid',
      attemptsRemaining: maxAttempts - attempts,
    };
  }

  /** @deprecated Use verifyOTPAttempt for attempt tracking and lockout. */
  static async verifyOTP(email: string, code: string, purpose: string): Promise<boolean> {
    const result = await this.verifyOTPAttempt(email, code, purpose);
    return result.ok;
  }

  static verifyToken(token: string): any {
    try {
      const secret = process.env.JWT_SECRET!;
      return jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  static verifyRefreshToken(token: string): any {
    try {
      const refreshSecret = process.env.JWT_REFRESH_SECRET!;
      return jwt.verify(token, refreshSecret, { algorithms: ['HS256'] });
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
  }

  /**
   * Generate a random temporary password for newly created accounts.
   * Users are forced to change it on first login (isFirstLogin flag).
   */
  static generateTemporaryPassword(length: number = 12): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
    const bytes = crypto.randomBytes(length);
    let password = '';
    for (let i = 0; i < length; i++) {
      password += alphabet[bytes[i]! % alphabet.length];
    }
    // Guarantee at least one letter, digit, and symbol for policy compliance.
    if (!/[a-zA-Z]/.test(password)) password += 'a';
    if (!/\d/.test(password)) password += '7';
    if (!/[!@#$]/.test(password)) password += '!';
    return password;
  }

  /**
   * Generate cryptographically secure random token for email verification links
   * Uses crypto.randomBytes for better security than Math.random()
   */
  static generateToken(length: number = APP_CONSTANTS.TOKEN.VERIFICATION_TOKEN_LENGTH): string {
    return crypto.randomBytes(length).toString('base64url').slice(0, length);
  }

  /**
   * Validate password strength
   */
  static validatePasswordStrength(password: string): { valid: boolean; message?: string } {
    if (password.length < APP_CONSTANTS.PASSWORD.MIN_LENGTH) {
      return {
        valid: false,
        message: `Password must be at least ${APP_CONSTANTS.PASSWORD.MIN_LENGTH} characters long`,
      };
    }

    // Check for at least one number
    if (!/\d/.test(password)) {
      return {
        valid: false,
        message: 'Password must contain at least one number',
      };
    }

    // Check for at least one letter
    if (!/[a-zA-Z]/.test(password)) {
      return {
        valid: false,
        message: 'Password must contain at least one letter',
      };
    }

    return { valid: true };
  }
}
