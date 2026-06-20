import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { getInstitutionsCollection, getUsersCollection, getOTPCollection } from '../database/connection.js';
import { AuthService } from '../services/auth.services.js';
import type { UserType } from '../models/user.model.js';
import { loginRateLimiter, authRateLimiter } from '../middleware/rateLimit.middleware.js';
import { getLecturerTitle } from '../utils/profile.js';
import { invalidateAuthCache } from '../middleware/auth.middleware.js';
import { actorFromAuthUser, writeAuditEvent } from '../services/audit-log.service.js';

const auth = new Hono();

// Validation schemas
const adminRegisterSchema = z.object({
  institutionCode: z.string().min(3, 'Institution code is required').max(20),
  adminFirstName: z.string().min(2, 'First name must be at least 2 characters'),
  adminLastName: z.string().min(2, 'Last name must be at least 2 characters'),
  adminEmail: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Confirm password must be at least 8 characters'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const loginSchema = z.object({
  email: z.string().min(1, 'Email or Student ID is required'), // Changed to accept both
  password: z.string().min(1, 'Password is required'),
  userType: z.enum(['student', 'lecturer', 'admin']),
  // Required when signing in with an email, because emails are unique only
  // within an institution. Optional for ID logins (student/lecturer IDs embed
  // the institution and are globally unique).
  institutionCode: z.string().min(3).max(20).optional(),
});

const verifyOTPSchema = z.object({
  email: z.string().email('Invalid email format'),
  code: z.string().length(6, 'OTP code must be 6 digits'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
  userType: z.enum(['student', 'lecturer', 'admin']),
});

const resetPasswordSchema = z.object({
  email: z.string().email('Invalid email format'),
  code: z.string().length(6, 'OTP code must be 6 digits'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Confirm password must be at least 8 characters'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const verifyMfaSchema = z.object({
  mfaToken: z.string().min(10),
  code: z.string().min(6).max(16),
});

// Get available institutions (for signup dropdown)
auth.get('/institutions', async (c) => {
  try {
    const institutionsCollection = getInstitutionsCollection();
    
    // Get all active institutions
    const institutions = await institutionsCollection
      .find({ status: 'active' })
      .project({ _id: 1, name: 1, code: 1 })
      .toArray();

    return c.json({
      institutions: institutions.map(inst => ({
        id: inst._id?.toString(),
        name: inst.name,
        code: inst.code
      }))
    });
  } catch (error) {
    console.error('Get institutions error:', error);
    return c.json({ error: 'Failed to fetch institutions' }, 500);
  }
});

// Admin Registration endpoint (Admin account creation for existing institution)
auth.post('/admin/register', authRateLimiter, async (c) => {
  try {
    const body = await c.req.json();
    const data = adminRegisterSchema.parse(body);

    const usersCollection = getUsersCollection();
    const institutionsCollection = getInstitutionsCollection();

    // Check if institution exists and is active
    const institution = await institutionsCollection.findOne({ 
      code: data.institutionCode.toUpperCase(),
      status: 'active'
    });
    
    if (!institution) {
      return c.json({ 
        error: 'Institution not found or inactive. Please contact system administrator.' 
      }, 404);
    }

    // Check if this institution already has maximum admins (10)
    const adminCount = await usersCollection.countDocuments({ 
      institutionId: institution._id,
      userType: 'admin'
    });
    
    if (adminCount >= 10) {
      return c.json({ 
        error: 'This institution has reached the maximum number of admins (10). Please contact your institution administrator.' 
      }, 400);
    }

    // Check if this email is already used WITHIN this institution (any role).
    // Emails are unique per-institution, so the same address can still be
    // registered at a different university.
    const escapedEmail = data.adminEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const existingUser = await usersCollection.findOne({ 
      institutionId: institution._id,
      email: { $regex: new RegExp(`^${escapedEmail}$`, 'i') }
    });
    if (existingUser) {
      return c.json({ error: 'This email is already registered at this institution.' }, 400);
    }

    // Hash password
    const passwordHash = await AuthService.hashPassword(data.password);

    // Create admin user (normalize email to lowercase)
    const avatar = `${data.adminFirstName[0]}${data.adminLastName[0]}`.toUpperCase();
    const newAdmin = {
      email: data.adminEmail.toLowerCase().trim(),
      passwordHash,
      userType: 'admin' as const,
      institutionId: institution._id!,
      status: 'pending' as const,
      emailVerified: false,
      profile: {
        firstName: data.adminFirstName,
        lastName: data.adminLastName,
        title: 'Institution Administrator',
        avatar
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const adminResult = await usersCollection.insertOne(newAdmin);

    // Generate OTP for email verification
    await AuthService.generateOTP(data.adminEmail, 'email_verification', institution._id!);

    return c.json({
      message: 'Admin account created successfully. Please check your email for verification code.',
      institutionName: institution.name,
      institutionCode: institution.code,
      adminId: adminResult.insertedId.toString(),
      email: data.adminEmail
    }, 201);

  } catch (error) {
    console.error('Admin registration error:', error);
    if (error instanceof z.ZodError) {
      return c.json({ 
        error: 'Validation error', 
        details: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      }, 400);
    }
    return c.json({ error: 'Registration failed' }, 500);
  }
});

// Login endpoint
auth.post('/login', loginRateLimiter, async (c) => {
  try {
    console.log('🔍 Login attempt started');
    const body = await c.req.json();
    console.log('📝 Request body:', { email: body.email, userType: body.userType });
    
    const data = loginSchema.parse(body);
    console.log('✅ Validation passed');

    const usersCollection = getUsersCollection();
    const institutionsCollection = getInstitutionsCollection();
    console.log('📊 Database connection obtained');

    // Normalize email for search (trim and lowercase)
    const normalizedEmail = data.email.toLowerCase().trim();
    const isEmailLogin = normalizedEmail.includes('@');

    // Resolve the institution when a code is supplied. Emails are unique only
    // within an institution, so an email login MUST be scoped to one. ID logins
    // (student/lecturer IDs) are globally unique, so the code is optional there.
    let institutionId: ObjectId | undefined;
    if (data.institutionCode) {
      const inst = await institutionsCollection.findOne({
        code: data.institutionCode.toUpperCase(),
      });
      if (!inst) {
        return c.json({ error: 'Institution not found. Please check your selection.' }, 404);
      }
      institutionId = inst._id;
    }

    if (isEmailLogin && !institutionId) {
      return c.json(
        { error: 'Please select your institution to sign in with an email address.' },
        400,
      );
    }

    // Find user by email OR student ID (for students) OR lecturer ID (for lecturers)
    let user;
    
    if (data.userType === 'student') {
      // For students, check both email (scoped to institution) and studentId.
      user = await usersCollection.findOne({ 
        $or: [
          { email: normalizedEmail, userType: 'student', institutionId },
          { 'profile.studentId': data.email, userType: 'student' }
        ]
      });
    } else if (data.userType === 'lecturer') {
      // For lecturers, check both email (scoped) and lecturerId.
      user = await usersCollection.findOne({ 
        $or: [
          { email: normalizedEmail, userType: 'lecturer', institutionId },
          { 'profile.lecturerId': data.email, userType: 'lecturer' }
        ]
      });
    } else {
      // For admins, only check email (case-insensitive), scoped to institution.
      console.log('🔍 Searching for admin user:', { email: normalizedEmail, userType: data.userType });
      user = await usersCollection.findOne({ 
        email: normalizedEmail,
        userType: data.userType,
        institutionId,
      });
    }

    console.log('👤 User found:', user ? 'Yes' : 'No');
    if (user) {
      console.log('📋 User details:', {
        id: user._id,
        email: user.email,
        userType: user.userType,
        status: user.status,
        emailVerified: user.emailVerified
      });
    }

    if (!user) {
      console.log('❌ User not found');
      writeAuditEvent({
        institutionId: institutionId,
        action: 'auth.login',
        actor: {
          userType: data.userType,
          ip: actorFromAuthUser(undefined, c.req.raw).ip,
          userAgent: actorFromAuthUser(undefined, c.req.raw).userAgent,
        },
        target: { type: 'auth', email: normalizedEmail },
        outcome: 'failure',
        errorMessage: 'user not found',
      });
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Get institution details (for the response payload)
    const institution = await institutionsCollection.findOne({ _id: user.institutionId });
    console.log('🏫 Institution found:', institution ? institution.name : 'No');

    // Verify password
    console.log('🔐 Verifying password...');
    const isValidPassword = await AuthService.verifyPassword(data.password, user.passwordHash);
    console.log('🔐 Password valid:', isValidPassword);
    
    if (!isValidPassword) {
      console.log('❌ Invalid password');
      writeAuditEvent({
        institutionId: user.institutionId,
        action: 'auth.login',
        actor: {
          userType: data.userType,
          ip: actorFromAuthUser(undefined, c.req.raw).ip,
          userAgent: actorFromAuthUser(undefined, c.req.raw).userAgent,
        },
        target: { type: 'auth', id: user._id?.toString(), email: user.email },
        outcome: 'failure',
        errorMessage: 'invalid password',
      });
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Check if email is verified
    if (!user.emailVerified) {
      console.log('❌ Email not verified');
      writeAuditEvent({
        institutionId: user.institutionId,
        action: 'auth.login',
        actor: {
          userType: data.userType,
          ip: actorFromAuthUser(undefined, c.req.raw).ip,
          userAgent: actorFromAuthUser(undefined, c.req.raw).userAgent,
        },
        target: { type: 'auth', id: user._id?.toString(), email: user.email },
        outcome: 'failure',
        errorMessage: 'email not verified',
      });
      return c.json({ 
        error: 'Email not verified', 
        requiresVerification: true,
        email: user.email 
      }, 403);
    }

    // Check if user is active
    if (user.status !== 'active') {
      console.log('❌ User not active, status:', user.status);
      writeAuditEvent({
        institutionId: user.institutionId,
        action: 'auth.login',
        actor: {
          userType: data.userType,
          ip: actorFromAuthUser(undefined, c.req.raw).ip,
          userAgent: actorFromAuthUser(undefined, c.req.raw).userAgent,
        },
        target: { type: 'auth', id: user._id?.toString(), email: user.email },
        outcome: 'failure',
        errorMessage: `status: ${user.status}`,
      });
      return c.json({ error: 'Account is not active' }, 403);
    }

    // Admin MFA: optional second step — only enforced when MFA_ENFORCE=true.
    // This keeps production login working if the live frontend hasn't picked up
    // the MFA UI yet (shared Atlas DB may already have mfaEnabled on admins).
    const mfaEnforce = process.env.MFA_ENFORCE === 'true';
    if (
      mfaEnforce &&
      user.userType === 'admin' &&
      (user as any).mfaEnabled &&
      (user as any).mfaSecretEnc
    ) {
      const mfaToken = AuthService.generateMfaChallengeToken(
        user._id.toString(),
        user.institutionId.toString(),
        user.email,
      );
      writeAuditEvent({
        institutionId: user.institutionId,
        action: 'auth.login.mfa_challenge_issued',
        actor: {
          userId: user._id?.toString(),
          email: user.email,
          userType: 'admin',
          ip: actorFromAuthUser(undefined, c.req.raw).ip,
          userAgent: actorFromAuthUser(undefined, c.req.raw).userAgent,
        },
        target: { type: 'auth', id: user._id?.toString(), email: user.email },
        outcome: 'success',
      });
      return c.json({
        message: 'MFA required',
        requiresMfa: true,
        mfaToken,
      });
    }

    // Generate tokens and persist refresh jti for rotation
    console.log('🎫 Generating tokens...');
    const tokens = await AuthService.issueSessionTokens(
      user._id.toString(), 
      user.userType, 
      user.institutionId.toString(), 
      user.email,
      user.tokenVersion ?? 0
    );
    console.log('✅ Tokens generated successfully');

    writeAuditEvent({
      institutionId: user.institutionId,
      action: 'auth.login',
      actor: {
        userId: user._id?.toString(),
        email: user.email,
        userType: user.userType,
        ip: actorFromAuthUser(undefined, c.req.raw).ip,
        userAgent: actorFromAuthUser(undefined, c.req.raw).userAgent,
      },
      target: { type: 'auth', id: user._id?.toString(), email: user.email },
      outcome: 'success',
    });

    console.log('🎉 Login successful');
    return c.json({
      message: 'Login successful',
      user: {
        id: user._id.toString(),
        email: user.email,
        userType: user.userType,
        name: `${user.profile.firstName} ${user.profile.lastName}`,
        avatar: user.profile.avatar,
        studentId: user.profile.studentId, // Include student ID in response
        lecturerId: user.profile.lecturerId, // Include lecturer ID in response
        title: getLecturerTitle(user.profile),
        institutionId: user.institutionId.toString(),
        universityName: institution?.name || 'Unknown University',
        isFirstLogin: user.isFirstLogin || false // Flag for password change prompt
      },
      ...tokens
    });

  } catch (error: any) {
    console.error('❌ Login error:', error);
    console.error('🔍 Error stack:', error.stack);
    if (error instanceof z.ZodError) {
      console.log('📝 Validation error details:', error.issues);
      return c.json({ 
        error: 'Validation error', 
        details: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      }, 400);
    }
    return c.json({ error: 'Login failed' }, 500);
  }
});

// Verify email with magic link token (for students and lecturers)
auth.get('/verify-email', async (c) => {
  try {
    console.log('🔍 Email verification attempt started');
    const token = c.req.query('token');
    const email = c.req.query('email');

    console.log('📝 Verification parameters:', { 
      token: token ? `${token.substring(0, 10)}...` : 'missing',
      email: email || 'missing'
    });

    if (!token || !email) {
      console.log('❌ Missing token or email');
      return c.json({ error: 'Missing token or email' }, 400);
    }

    const usersCollection = getUsersCollection();
    const otpCollection = getOTPCollection();

    console.log('🔍 Searching for verification record...');
    
    // Find the verification token in otp_codes collection
    const verificationRecord = await otpCollection.findOne({
      email: decodeURIComponent(email),
      code: token,
      purpose: 'email_verification',
      used: false,
      expiresAt: { $gt: new Date() }
    });

    console.log('📋 Verification record found:', verificationRecord ? 'Yes' : 'No');
    
    if (verificationRecord) {
      console.log('📊 Record details:', {
        email: verificationRecord.email,
        purpose: verificationRecord.purpose,
        used: verificationRecord.used,
        expiresAt: verificationRecord.expiresAt,
        isExpired: verificationRecord.expiresAt <= new Date()
      });
    }

    if (!verificationRecord) {
      console.log('❌ Invalid or expired verification record');
      
      // Check if there's any record for this email (for debugging)
      const anyRecord = await otpCollection.findOne({ email: decodeURIComponent(email) });
      console.log('🔍 Any record for email exists:', anyRecord ? 'Yes' : 'No');
      
      if (anyRecord) {
        console.log('📊 Found record details:', {
          code: anyRecord.code,
          purpose: anyRecord.purpose,
          used: anyRecord.used,
          expiresAt: anyRecord.expiresAt,
          isExpired: anyRecord.expiresAt <= new Date()
        });
      }
      
      return c.json({ 
        error: 'Invalid or expired verification link',
        message: 'This link may have expired or already been used. Please contact your administrator.'
      }, 400);
    }

    console.log('✅ Valid verification record found, updating user...');

    // Mark email as verified and activate user. Scope by institution when the
    // record carries it, so the right account is verified even when the same
    // email exists at multiple institutions. (Legacy records fall back to email.)
    const verifyFilter: Record<string, unknown> = { email: decodeURIComponent(email) };
    if (verificationRecord.institutionId) {
      verifyFilter.institutionId = verificationRecord.institutionId;
    }
    const updateResult = await usersCollection.updateOne(
      verifyFilter,
      { 
        $set: { 
          emailVerified: true, 
          status: 'active',
          updatedAt: new Date()
        } 
      }
    );

    console.log('📊 User update result:', {
      matchedCount: updateResult.matchedCount,
      modifiedCount: updateResult.modifiedCount
    });

    // Mark token as used
    await otpCollection.updateOne(
      { _id: verificationRecord._id },
      { $set: { used: true } }
    );

    console.log('✅ Token marked as used');
    console.log('🎉 Email verification completed successfully');

    // Return HTML redirect to login page
    return c.html(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Email Verified</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 400px;
          }
          .success-icon {
            font-size: 60px;
            color: #4CAF50;
            margin-bottom: 20px;
          }
          h1 {
            color: #333;
            margin-bottom: 10px;
          }
          p {
            color: #666;
            margin-bottom: 30px;
          }
          .redirect-message {
            color: #999;
            font-size: 14px;
          }
        </style>
        <script>
          // Redirect to login page after 3 seconds
          setTimeout(() => {
            window.location.href = '${process.env.FRONTEND_URL || 'http://localhost:3000'}/login';
          }, 3000);
        </script>
      </head>
      <body>
        <div class="container">
          <div class="success-icon">✓</div>
          <h1>Email Verified!</h1>
          <p>Your account has been activated successfully.</p>
          <p class="redirect-message">Redirecting to login page in 3 seconds...</p>
        </div>
      </body>
      </html>
    `);

  } catch (error: any) {
    console.error('❌ Email verification error:', error);
    console.error('🔍 Error stack:', error.stack);
    return c.json({ 
      error: 'Verification failed',
      message: 'An unexpected error occurred during verification. Please try again or contact support.'
    }, 500);
  }
});

// Verify OTP endpoint (kept for admin/lecturer registration)
auth.post('/verify-otp', authRateLimiter, async (c) => {
  try {
    const body = await c.req.json();
    const data = verifyOTPSchema.parse(body);

    const result = await AuthService.verifyOTPAttempt(
      data.email,
      data.code,
      'email_verification',
    );

    if (!result.ok) {
      if (result.reason === 'locked') {
        return c.json(
          {
            error: 'Too many incorrect attempts. Please try again later or request a new code.',
            retryAfter: result.retryAfter,
          },
          429,
        );
      }
      if (result.reason === 'invalid' && result.attemptsRemaining !== undefined) {
        return c.json(
          {
            error: `Invalid OTP code. ${result.attemptsRemaining} attempt(s) remaining.`,
            attemptsRemaining: result.attemptsRemaining,
          },
          400,
        );
      }
      return c.json({ error: 'Invalid or expired OTP code' }, 400);
    }

    // Mark email as verified and activate user (scoped to institution when known)
    const usersCollection = getUsersCollection();
    const otpFilter: Record<string, unknown> = { email: data.email };
    if (result.institutionId) {
      otpFilter.institutionId = result.institutionId;
    }
    await usersCollection.updateOne(
      otpFilter,
      { 
        $set: { 
          emailVerified: true, 
          status: 'active',
          updatedAt: new Date()
        } 
      }
    );

    return c.json({ message: 'Email verified successfully' });

  } catch (error) {
    console.error('OTP verification error:', error);
    if (error instanceof z.ZodError) {
      return c.json({ 
        error: 'Validation error', 
        details: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      }, 400);
    }
    return c.json({ error: 'OTP verification failed' }, 500);
  }
});

// Resend OTP endpoint
auth.post('/resend-otp', authRateLimiter, async (c) => {
  try {
    const { email } = await c.req.json();
    
    if (!email) {
      return c.json({ error: 'Email is required' }, 400);
    }

    // Check if user exists
    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({ email });
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    await AuthService.generateOTP(email, 'email_verification', user.institutionId);
    
    return c.json({ message: 'OTP sent successfully' });

  } catch (error) {
    console.error('Resend OTP error:', error);
    return c.json({ error: 'Failed to send OTP' }, 500);
  }
});

// Refresh token endpoint
auth.post('/refresh-token', async (c) => {
  try {
    const { refreshToken } = await c.req.json();
    
    if (!refreshToken) {
      return c.json({ error: 'Refresh token is required' }, 400);
    }

    const decoded = AuthService.verifyRefreshToken(refreshToken);
    const usersCollection = getUsersCollection();
    
    const user = await usersCollection.findOne({ _id: ObjectId.createFromHexString(decoded.userId) });
    
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Reject refresh tokens that predate a logout / password change / reset.
    const currentVersion = user.tokenVersion ?? 0;
    if ((decoded.tokenVersion ?? 0) !== currentVersion) {
      return c.json({ error: 'Session expired. Please log in again.' }, 401);
    }

    const storedId = user.refreshTokenId;
    const tokenId = decoded.refreshTokenId as string | undefined;

    if (storedId) {
      if (!tokenId || tokenId !== storedId) {
        // Reuse of an old refresh token — invalidate every session.
        await usersCollection.updateOne(
          { _id: user._id },
          {
            $inc: { tokenVersion: 1 },
            $unset: { refreshTokenId: '' },
            $set: { updatedAt: new Date() },
          },
        );
        invalidateAuthCache(user._id.toString());
        console.warn(`Refresh token reuse detected for user ${user.email}`);
        return c.json({ error: 'Session expired. Please log in again.' }, 401);
      }
    } else if (tokenId) {
      return c.json({ error: 'Session expired. Please log in again.' }, 401);
    }
    // Legacy refresh tokens without a jti are accepted once, then rotated below.

    const tokens = await AuthService.issueSessionTokens(
      user._id.toString(),
      user.userType,
      user.institutionId.toString(),
      user.email,
      currentVersion
    );

    return c.json(tokens);

  } catch (error) {
    console.error('Refresh token error:', error);
    return c.json({ error: 'Invalid refresh token' }, 401);
  }
});

// Verify admin MFA and complete login (issue tokens)
auth.post('/verify-mfa', authRateLimiter, async (c) => {
  try {
    const body = await c.req.json();
    const data = verifyMfaSchema.parse(body);

    const decoded = AuthService.verifyMfaChallengeToken(data.mfaToken);
    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({ _id: ObjectId.createFromHexString(decoded.userId) });
    if (!user || user.userType !== 'admin') {
      return c.json({ error: 'Invalid MFA session. Please log in again.' }, 401);
    }
    if (!(user as any).mfaEnabled || !(user as any).mfaSecretEnc) {
      return c.json({ error: 'MFA is not enabled for this account.' }, 400);
    }

    const secret = AuthService.decryptMfaSecret((user as any).mfaSecretEnc);
    const isTotp = AuthService.verifyTotp(secret, data.code);

    // Backup codes (one-time): accept and remove when matched.
    let usedBackup = false;
    if (!isTotp && Array.isArray((user as any).mfaBackupCodesHash) && (user as any).mfaBackupCodesHash.length) {
      const hashes: string[] = (user as any).mfaBackupCodesHash;
      for (const h of hashes) {
        // reuse bcrypt compare from password lib
        const ok = await AuthService.verifyPassword(data.code, h);
        if (ok) {
          usedBackup = true;
          await usersCollection.updateOne(
            { _id: user._id },
            { $pull: { mfaBackupCodesHash: h }, $set: { updatedAt: new Date() } },
          );
          break;
        }
      }
    }

    if (!isTotp && !usedBackup) {
      writeAuditEvent({
        institutionId: user.institutionId,
        action: 'auth.mfa.verify',
        actor: {
          userId: user._id?.toString(),
          email: user.email,
          userType: 'admin',
          ip: actorFromAuthUser(undefined, c.req.raw).ip,
          userAgent: actorFromAuthUser(undefined, c.req.raw).userAgent,
        },
        target: { type: 'auth', id: user._id?.toString(), email: user.email },
        outcome: 'failure',
        errorMessage: 'invalid mfa code',
      });
      return c.json({ error: 'Invalid authentication code' }, 401);
    }

    const tokens = await AuthService.issueSessionTokens(
      user._id.toString(),
      user.userType,
      user.institutionId.toString(),
      user.email,
      user.tokenVersion ?? 0,
    );

    writeAuditEvent({
      institutionId: user.institutionId,
      action: 'auth.mfa.verify',
      actor: {
        userId: user._id?.toString(),
        email: user.email,
        userType: 'admin',
        ip: actorFromAuthUser(undefined, c.req.raw).ip,
        userAgent: actorFromAuthUser(undefined, c.req.raw).userAgent,
      },
      target: { type: 'auth', id: user._id?.toString(), email: user.email },
      outcome: 'success',
      metadata: { method: isTotp ? 'totp' : 'backup' },
    });

    return c.json({
      message: 'Login successful',
      user: {
        id: user._id.toString(),
        email: user.email,
        userType: user.userType,
        name: `${user.profile.firstName} ${user.profile.lastName}`,
        avatar: user.profile.avatar,
        title: getLecturerTitle(user.profile),
        institutionId: user.institutionId.toString(),
        universityName: (await getInstitutionsCollection().findOne({ _id: user.institutionId }))?.name || 'Unknown University',
        isFirstLogin: user.isFirstLogin || false,
      },
      ...tokens,
    });
  } catch (error: any) {
    console.error('Verify MFA error:', error);
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    return c.json({ error: 'Failed to verify MFA' }, 500);
  }
});

// Forgot Password - Request OTP
auth.post('/forgot-password', authRateLimiter, async (c) => {
  try {
    const body = await c.req.json();
    const data = forgotPasswordSchema.parse(body);

    const usersCollection = getUsersCollection();
    
    // Check if user exists with this email and userType
    const user = await usersCollection.findOne({ 
      email: data.email,
      userType: data.userType
    });
    
    if (!user) {
      // Don't reveal if user exists or not (security best practice)
      return c.json({ 
        message: 'If an account exists with this email, you will receive a password reset code.' 
      });
    }

    // Generate OTP for password reset (scoped to institution)
    await AuthService.generateOTP(data.email, 'password_reset', user.institutionId);

    return c.json({ 
      message: 'Password reset code sent to your email.',
      email: data.email
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    if (error instanceof z.ZodError) {
      return c.json({ 
        error: 'Validation error', 
        details: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      }, 400);
    }
    return c.json({ error: 'Failed to process request' }, 500);
  }
});

// Reset Password - Verify OTP and Set New Password
auth.post('/reset-password', authRateLimiter, async (c) => {
  try {
    const body = await c.req.json();
    const data = resetPasswordSchema.parse(body);

    // Verify OTP with attempt tracking
    const otpResult = await AuthService.verifyOTPAttempt(
      data.email,
      data.code,
      'password_reset',
    );

    if (!otpResult.ok) {
      if (otpResult.reason === 'locked') {
        return c.json(
          {
            error: 'Too many incorrect attempts. Please try again later or request a new code.',
            retryAfter: otpResult.retryAfter,
          },
          429,
        );
      }
      if (otpResult.reason === 'invalid' && otpResult.attemptsRemaining !== undefined) {
        return c.json(
          {
            error: `Invalid reset code. ${otpResult.attemptsRemaining} attempt(s) remaining.`,
            attemptsRemaining: otpResult.attemptsRemaining,
          },
          400,
        );
      }
      return c.json({ error: 'Invalid or expired reset code' }, 400);
    }

    // Get user to check current password and password history
    const usersCollection = getUsersCollection();
    const userFilter: Record<string, unknown> = { email: data.email };
    if (otpResult.institutionId) {
      userFilter.institutionId = otpResult.institutionId;
    }
    const user = await usersCollection.findOne(userFilter);

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Check if new password is same as current password
    const isSameAsCurrent = await AuthService.verifyPassword(data.newPassword, user.passwordHash);
    
    if (isSameAsCurrent) {
      return c.json({ 
        error: 'New password cannot be the same as your current password. Please choose a different password.' 
      }, 400);
    }

    // Check against password history (last 5 passwords)
    if (user.passwordHistory && user.passwordHistory.length > 0) {
      for (const oldPasswordHash of user.passwordHistory) {
        const isSameAsOld = await AuthService.verifyPassword(data.newPassword, oldPasswordHash);
        if (isSameAsOld) {
          return c.json({ 
            error: 'You cannot reuse a recent password. Please choose a different password.' 
          }, 400);
        }
      }
    }

    // Hash new password
    const newPasswordHash = await AuthService.hashPassword(data.newPassword);

    // Update password history (keep last 5 passwords)
    const updatedPasswordHistory = [
      user.passwordHash,
      ...(user.passwordHistory || [])
    ].slice(0, 5); // Keep only last 5 passwords

    // Update user password and history, and bump tokenVersion so every existing
    // session (any device/tab) is invalidated after a reset — the user must log
    // in again with the new password.
    const result = await usersCollection.updateOne(
      { _id: user._id },
      { 
        $set: { 
          passwordHash: newPasswordHash,
          passwordHistory: updatedPasswordHistory,
          updatedAt: new Date()
        },
        $inc: { tokenVersion: 1 },
        $unset: { refreshTokenId: '' },
      }
    );

    if (result.matchedCount === 0) {
      return c.json({ error: 'User not found' }, 404);
    }

    invalidateAuthCache(user._id.toString());

    return c.json({ 
      message: 'Password reset successfully. You can now login with your new password.' 
    });

  } catch (error) {
    console.error('Reset password error:', error);
    if (error instanceof z.ZodError) {
      return c.json({ 
        error: 'Validation error', 
        details: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      }, 400);
    }
    return c.json({ error: 'Failed to reset password' }, 500);
  }
});

export default auth;
