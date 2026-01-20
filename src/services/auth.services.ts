import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getOTPCollection } from '../database/connection.js';
import { sendOTPEmail } from './email.services.js';

export class AuthService {
  static async hashPassword(password: string): Promise<string> {
    return await bcrypt.hash(password, 12);
  }

  static async verifyPassword(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }

  static async generateTokens(userId: string, userType: string, institutionId: string, email: string) {
    const secret = process.env.JWT_SECRET!;
    const refreshSecret = process.env.JWT_REFRESH_SECRET!;

    const payload = {
      userId,
      userType,
      institutionId,
      email,
    };

    const accessToken = jwt.sign(payload, secret, { expiresIn: '24h' });
    const refreshToken = jwt.sign({ userId }, refreshSecret, { expiresIn: '7d' });

    return { accessToken, refreshToken };
  }

  static async generateOTP(email: string, purpose: string): Promise<string> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

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

  // Generate random token for email verification links
  static generateToken(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    for (let i = 0; i < length; i++) {
      token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return token;
  }
}
