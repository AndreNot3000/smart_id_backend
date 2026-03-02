import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { getOTPCollection } from '../database/connection.js';
import { sendOTPEmail } from './email.services.js';
import { APP_CONSTANTS } from '../config/constants.js';

export class AuthService {
  static async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, APP_CONSTANTS.PASSWORD.BCRYPT_ROUNDS);
  }

  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }

  static async generateTokens(userId: string, userType: string, institutionId: string, email: string) {
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
    };

    const accessToken = jwt.sign(payload, secret, { 
      expiresIn: APP_CONSTANTS.TOKEN.ACCESS_TOKEN_EXPIRY 
    });
    const refreshToken = jwt.sign({ userId }, refreshSecret, { 
      expiresIn: APP_CONSTANTS.TOKEN.REFRESH_TOKEN_EXPIRY 
    });

    return { accessToken, refreshToken };
  }

  static async generateOTP(email: string, purpose: string): Promise<string> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + APP_CONSTANTS.OTP.EXPIRY);

    const otpCollection = getOTPCollection();
    
    // Invalidate any existing OTPs for this email and purpose
    await otpCollection.updateMany(
      { email, purpose, used: false },
      { $set: { used: true } }
    );

    // Create new OTP
    await otpCollection.insertOne({
      email,
      code,
      purpose,
      expiresAt,
      used: false,
      createdAt: new Date()
    });

    // Send OTP email
    await sendOTPEmail(email, code, purpose);

    return code;
  }

  static async verifyOTP(email: string, code: string, purpose: string): Promise<boolean> {
    const otpCollection = getOTPCollection();
    
    const otpDoc = await otpCollection.findOne({
      email,
      code,
      purpose,
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!otpDoc) {
      return false;
    }

    // Mark OTP as used
    await otpCollection.updateOne(
      { _id: otpDoc._id },
      { $set: { used: true } }
    );

    return true;
  }

  static verifyToken(token: string): any {
    try {
      const secret = process.env.JWT_SECRET!;
      return jwt.verify(token, secret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  static verifyRefreshToken(token: string): any {
    try {
      const refreshSecret = process.env.JWT_REFRESH_SECRET!;
      return jwt.verify(token, refreshSecret);
    } catch (error) {
      throw new Error('Invalid refresh token');
    }
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
