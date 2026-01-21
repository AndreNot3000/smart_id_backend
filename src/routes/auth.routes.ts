import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { getInstitutionsCollection, getUsersCollection, getOTPCollection } from '../database/connection.js';
import { AuthService } from '../services/auth.services.js';
import type { UserType } from '../models/user.model.js';

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
auth.post('/admin/register', async (c) => {
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

    // Check if admin email already exists
    const existingUser = await usersCollection.findOne({ email: data.adminEmail });
    if (existingUser) {
      return c.json({ error: 'Email already registered' }, 400);
    }

    // Hash password
    const passwordHash = await AuthService.hashPassword(data.password);

    // Create admin user
    const avatar = `${data.adminFirstName[0]}${data.adminLastName[0]}`.toUpperCase();
    const newAdmin = {
      email: data.adminEmail,
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
    await AuthService.generateOTP(data.adminEmail, 'email_verification');

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
auth.post('/login', async (c) => {
  try {
    console.log('🔍 Login attempt started');
    const body = await c.req.json();
    console.log('📝 Request body:', { email: body.email, userType: body.userType });
    
    const data = loginSchema.parse(body);
    console.log('✅ Validation passed');

    const usersCollection = getUsersCollection();
    console.log('📊 Database connection obtained');

    // Find user by email OR student ID (for students) OR lecturer ID (for lecturers)
    let user;
    
    if (data.userType === 'student') {
      // For students, check both email and studentId
      user = await usersCollection.findOne({ 
        $or: [
          { email: data.email, userType: 'student' },
          { 'profile.studentId': data.email, userType: 'student' }
        ]
      });
    } else if (data.userType === 'lecturer') {
      // For lecturers, check both email and lecturerId
      user = await usersCollection.findOne({ 
        $or: [
          { email: data.email, userType: 'lecturer' },
          { 'profile.lecturerId': data.email, userType: 'lecturer' }
        ]
      });
    } else {
      // For admins, only check email
      console.log('🔍 Searching for admin user:', { email: data.email, userType: data.userType });
      user = await usersCollection.findOne({ 
        email: data.email, 
        userType: data.userType 
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
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Get institution details
    const institutionsCollection = getInstitutionsCollection();
    const institution = await institutionsCollection.findOne({ _id: user.institutionId });
    console.log('🏫 Institution found:', institution ? institution.name : 'No');

    // Verify password
    console.log('🔐 Verifying password...');
    const isValidPassword = await AuthService.verifyPassword(data.password, user.passwordHash);
    console.log('🔐 Password valid:', isValidPassword);
    
    if (!isValidPassword) {
      console.log('❌ Invalid password');
      return c.json({ error: 'Invalid credentials' }, 401);
    }

    // Check if email is verified
    if (!user.emailVerified) {
      console.log('❌ Email not verified');
      return c.json({ 
        error: 'Email not verified', 
        requiresVerification: true,
        email: user.email 
      }, 403);
    }

    // Check if user is active
    if (user.status !== 'active') {
      console.log('❌ User not active, status:', user.status);
      return c.json({ error: 'Account is not active' }, 403);
    }

    // Generate tokens
    console.log('🎫 Generating tokens...');
    const tokens = await AuthService.generateTokens(
      user._id.toString(), 
      user.userType, 
      user.institutionId.toString(), 
      user.email
    );
    console.log('✅ Tokens generated successfully');

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
        role: user.profile.role, // Include lecturer role in response
        institutionId: user.institutionId.toString(),
        universityName: institution?.name || 'Unknown University',
        isFirstLogin: user.isFirstLogin || false // Flag for password change prompt
      },
      ...tokens
    });

  } catch (error) {
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

// Verify email with magic link token (for students)
auth.get('/verify-email', async (c) => {
  try {
    const token = c.req.query('token');
    const email = c.req.query('email');

    if (!token || !email) {
      return c.json({ error: 'Missing token or email' }, 400);
    }

    const usersCollection = getUsersCollection();
    const otpCollection = getOTPCollection();

    // Find the verification token
    const verificationRecord = await otpCollection.findOne({
      email,
      code: token,
      purpose: 'email_verification',
      used: false,
      expiresAt: { $gt: new Date() }
    });

    if (!verificationRecord) {
      return c.json({ 
        error: 'Invalid or expired verification link',
        message: 'This link may have expired or already been used. Please contact your administrator.'
      }, 400);
    }

    // Mark email as verified and activate user
    await usersCollection.updateOne(
      { email },
      { 
        $set: { 
          emailVerified: true, 
          status: 'active',
          updatedAt: new Date()
        } 
      }
    );

    // Mark token as used
    await otpCollection.updateOne(
      { _id: verificationRecord._id },
      { $set: { used: true } }
    );

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

  } catch (error) {
    console.error('Email verification error:', error);
    return c.json({ error: 'Verification failed' }, 500);
  }
});

// Verify OTP endpoint (kept for admin/lecturer registration)
auth.post('/verify-otp', async (c) => {
  try {
    const body = await c.req.json();
    const data = verifyOTPSchema.parse(body);

    const isValid = await AuthService.verifyOTP(data.email, data.code, 'email_verification');
    
    if (!isValid) {
      return c.json({ error: 'Invalid or expired OTP code' }, 400);
    }

    // Mark email as verified and activate user
    const usersCollection = getUsersCollection();
    await usersCollection.updateOne(
      { email: data.email },
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
auth.post('/resend-otp', async (c) => {
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

    await AuthService.generateOTP(email, 'email_verification');
    
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

    const tokens = await AuthService.generateTokens(
      user._id.toString(),
      user.userType,
      user.institutionId.toString(),
      user.email
    );

    return c.json(tokens);

  } catch (error) {
    console.error('Refresh token error:', error);
    return c.json({ error: 'Invalid refresh token' }, 401);
  }
});

// Forgot Password - Request OTP
auth.post('/forgot-password', async (c) => {
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

    // Generate OTP for password reset
    await AuthService.generateOTP(data.email, 'password_reset');

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
auth.post('/reset-password', async (c) => {
  try {
    const body = await c.req.json();
    const data = resetPasswordSchema.parse(body);

    // Verify OTP
    const isValid = await AuthService.verifyOTP(data.email, data.code, 'password_reset');
    
    if (!isValid) {
      return c.json({ error: 'Invalid or expired reset code' }, 400);
    }

    // Get user to check current password and password history
    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({ email: data.email });

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

    // Update user password and history
    const result = await usersCollection.updateOne(
      { email: data.email },
      { 
        $set: { 
          passwordHash: newPasswordHash,
          passwordHistory: updatedPasswordHistory,
          updatedAt: new Date()
        } 
      }
    );

    if (result.matchedCount === 0) {
      return c.json({ error: 'User not found' }, 404);
    }

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
