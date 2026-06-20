import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { getUsersCollection, getInstitutionsCollection } from '../database/connection.js';
import { authMiddleware, invalidateAuthCache } from '../middleware/auth.middleware.js';
import { AuthService } from '../services/auth.services.js';
import { writeAuditEvent, actorFromAuthUser } from '../services/audit-log.service.js';

const user = new Hono();

// Validation schemas
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
  confirmPassword: z.string().min(8, 'Confirm password must be at least 8 characters'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

// Check profile completion status
user.get('/profile/completion', authMiddleware, async (c) => {
  try {
    const usersCollection = getUsersCollection();
    const authUser = c.get('user');
    const userId = new ObjectId(authUser.userId);

    const userDoc = await usersCollection.findOne({ _id: userId });

    if (!userDoc) {
      return c.json({ message: 'User not found' }, 404);
    }

    const profile = userDoc.profile;
    const missingFields: string[] = [];
    
    // Required fields for all users
    if (!profile.firstName) missingFields.push('firstName');
    if (!profile.lastName) missingFields.push('lastName');
    if (!profile.phone) missingFields.push('phone');
    if (!profile.dateOfBirth) missingFields.push('dateOfBirth');
    if (!profile.address) missingFields.push('address');
    
    // Required fields for students
    if (userDoc.userType === 'student') {
      if (!profile.department) missingFields.push('department');
      if (!profile.year) missingFields.push('year');
    }
    
    // Required fields for lecturers
    if (userDoc.userType === 'lecturer') {
      if (!profile.department) missingFields.push('department');
      if (!profile.specialization) missingFields.push('specialization');
    }

    const isComplete = missingFields.length === 0;
    const completionPercentage = Math.round(
      ((profile.firstName ? 1 : 0) +
       (profile.lastName ? 1 : 0) +
       (profile.phone ? 1 : 0) +
       (profile.dateOfBirth ? 1 : 0) +
       (profile.address ? 1 : 0) +
       (profile.department ? 1 : 0) +
       (profile.year || profile.specialization ? 1 : 0) +
       (profile.avatar ? 1 : 0)) / 8 * 100
    );

    return c.json({
      isComplete,
      completionPercentage,
      missingFields,
      message: isComplete 
        ? 'Your profile is complete!' 
        : 'Please complete your profile to access all features.'
    });
  } catch (error) {
    console.error('Profile completion check error:', error);
    return c.json({ message: 'Failed to check profile completion' }, 500);
  }
});

// Get current user profile (for dashboard)
user.get('/profile', authMiddleware, async (c) => {
  try {
    const usersCollection = getUsersCollection();
    const institutionsCollection = getInstitutionsCollection();
    const authUser = c.get('user');
    const userId = new ObjectId(authUser.userId);

    const userDoc = await usersCollection.findOne(
      { _id: userId },
      { projection: { passwordHash: 0, passwordHistory: 0 } }
    );

    if (!userDoc) {
      return c.json({ message: 'User not found' }, 404);
    }

    // Get institution details
    const institution = await institutionsCollection.findOne({ _id: userDoc.institutionId });

    return c.json({
      id: userDoc._id,
      email: userDoc.email,
      userType: userDoc.userType,
      status: userDoc.status,
      mfaEnabled: userDoc.userType === 'admin' ? Boolean((userDoc as any).mfaEnabled) : undefined,
      profile: {
        ...userDoc.profile,
        universityName: institution?.name || 'Unknown University'
      },
      institutionId: userDoc.institutionId
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return c.json({ message: 'Failed to fetch profile' }, 500);
  }
});

// Update user profile
user.put('/profile', authMiddleware, async (c) => {
  try {
    const usersCollection = getUsersCollection();
    const authUser = c.get('user');
    const userId = new ObjectId(authUser.userId);
    const body = await c.req.json();
    const { firstName, lastName, phone, address, dateOfBirth, department, year, title, specialization } = body;

    const updateData: Record<string, unknown> = {
      updatedAt: new Date()
    };
    const unsetFields: Record<string, ''> = {};

    // Build profile update object
    if (firstName) updateData['profile.firstName'] = firstName;
    if (lastName) updateData['profile.lastName'] = lastName;
    if (phone !== undefined) updateData['profile.phone'] = phone;
    if (address !== undefined) updateData['profile.address'] = address;
    if (dateOfBirth) updateData['profile.dateOfBirth'] = new Date(dateOfBirth);
    if (department !== undefined) updateData['profile.department'] = department;
    if (year !== undefined) updateData['profile.year'] = year;
    if (title !== undefined) {
      updateData['profile.title'] = title;
      unsetFields['profile.role'] = '';
    }
    if (specialization !== undefined) updateData['profile.specialization'] = specialization;

    const result = await usersCollection.findOneAndUpdate(
      { _id: userId },
      {
        $set: updateData,
        ...(Object.keys(unsetFields).length ? { $unset: unsetFields } : {}),
      },
      { returnDocument: 'after', projection: { passwordHash: 0, passwordHistory: 0 } }
    );

    if (!result) {
      return c.json({ message: 'User not found' }, 404);
    }

    return c.json({
      message: 'Profile updated successfully',
      profile: result.profile
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return c.json({ message: 'Failed to update profile' }, 500);
  }
});

// Update avatar (base64 or URL)
user.put('/avatar', authMiddleware, async (c) => {
  try {
    const usersCollection = getUsersCollection();
    const authUser = c.get('user');
    const userId = new ObjectId(authUser.userId);
    const body = await c.req.json();
    const { avatar } = body;

    if (!avatar) {
      return c.json({ error: 'Avatar data is required' }, 400);
    }

    // Validate base64 format
    if (!avatar.startsWith('data:image/')) {
      return c.json({ error: 'Invalid image format. Must be a base64 data URI' }, 400);
    }

    // Check size (base64 string length, roughly 5MB limit)
    const sizeInBytes = (avatar.length * 3) / 4;
    const maxSize = 5 * 1024 * 1024; // 5MB
    
    if (sizeInBytes > maxSize) {
      return c.json({ error: 'Image too large. Maximum size is 5MB' }, 400);
    }

    console.log(`📸 Uploading avatar for user ${authUser.email}, size: ${(sizeInBytes / 1024).toFixed(2)}KB`);

    const result = await usersCollection.findOneAndUpdate(
      { _id: userId },
      { 
        $set: { 
          'profile.avatar': avatar,
          updatedAt: new Date()
        } 
      },
      { returnDocument: 'after', projection: { 'profile.avatar': 1 } }
    );

    if (!result) {
      return c.json({ error: 'User not found' }, 404);
    }

    console.log(`✅ Avatar uploaded successfully for user ${authUser.email}`);

    return c.json({
      message: 'Avatar updated successfully',
      avatar: result.profile?.avatar
    });
  } catch (error) {
    console.error('Update avatar error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to update avatar', details: errorMessage }, 500);
  }
});

// Change password
user.put('/change-password', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const body = await c.req.json();
    const data = changePasswordSchema.parse(body);

    const usersCollection = getUsersCollection();

    // Get current user
    const userData = await usersCollection.findOne({ 
      _id: new ObjectId(authUser.userId) 
    });

    if (!userData) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Verify current password
    const isCurrentPasswordValid = await AuthService.verifyPassword(
      data.currentPassword, 
      userData.passwordHash
    );

    if (!isCurrentPasswordValid) {
      return c.json({ 
        error: 'The current password you entered is incorrect. Please check and try again.',
        field: 'currentPassword'
      }, 400);
    }

    // Check if new password is same as current
    const isSameAsCurrent = await AuthService.verifyPassword(
      data.newPassword, 
      userData.passwordHash
    );

    if (isSameAsCurrent) {
      return c.json({ 
        error: 'Your new password cannot be the same as your current password. Please choose a different password.',
        field: 'newPassword'
      }, 400);
    }

    // Check against password history
    if (userData.passwordHistory && userData.passwordHistory.length > 0) {
      for (const oldPasswordHash of userData.passwordHistory) {
        const isSameAsOld = await AuthService.verifyPassword(data.newPassword, oldPasswordHash);
        if (isSameAsOld) {
          return c.json({ 
            error: 'You cannot reuse a recent password. Please choose a different password that you haven\'t used before.',
            field: 'newPassword'
          }, 400);
        }
      }
    }

    // Hash new password
    const newPasswordHash = await AuthService.hashPassword(data.newPassword);

    // Update password history
    const updatedPasswordHistory = [
      userData.passwordHash,
      ...(userData.passwordHistory || [])
    ].slice(0, 5);

    // Update password and bump tokenVersion to invalidate all *other* existing
    // sessions (other devices/tabs). We then re-issue tokens for THIS request so
    // the current session continues seamlessly.
    const nextVersion = (userData.tokenVersion ?? 0) + 1;
    await usersCollection.updateOne(
      { _id: new ObjectId(authUser.userId) },
      { 
        $set: { 
          passwordHash: newPasswordHash,
          passwordHistory: updatedPasswordHistory,
          isFirstLogin: false, // Clear first login flag
          tokenVersion: nextVersion,
          updatedAt: new Date()
        },
        $unset: { refreshTokenId: '' },
      }
    );

    // Drop the cached entry so the new version takes effect immediately.
    invalidateAuthCache(authUser.userId);

    const tokens = await AuthService.issueSessionTokens(
      userData._id.toString(),
      userData.userType,
      userData.institutionId.toString(),
      userData.email,
      nextVersion
    );

    return c.json({ message: 'Password changed successfully', ...tokens });

  } catch (error) {
    console.error('Change password error:', error);
    if (error instanceof z.ZodError) {
      return c.json({ 
        error: 'Validation error', 
        details: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message
        }))
      }, 400);
    }
    return c.json({ error: 'Failed to change password' }, 500);
  }
});

// Logout — bumps tokenVersion so the issued access/refresh tokens are rejected
// server-side from now on (across every device/tab), not just cleared client-side.
user.post('/logout', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const usersCollection = getUsersCollection();

    await usersCollection.updateOne(
      { _id: new ObjectId(authUser.userId) },
      {
        $inc: { tokenVersion: 1 },
        $unset: { refreshTokenId: '' },
        $set: { updatedAt: new Date() },
      }
    );
    invalidateAuthCache(authUser.userId);

    console.log(`User ${authUser.email} (${authUser.userType}) logged out at ${new Date().toISOString()}`);

    return c.json({ 
      message: 'Logged out successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Logout error:', error);
    return c.json({ error: 'Logout failed' }, 500);
  }
});

// ---- MFA (admins) ----

user.post('/mfa/setup', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const usersCollection = getUsersCollection();
    const userDoc = await usersCollection.findOne({ _id: new ObjectId(authUser.userId) });
    if (!userDoc) return c.json({ error: 'User not found' }, 404);

    const secret = AuthService.generateMfaSecret();
    const enc = AuthService.encryptMfaSecret(secret);

    await usersCollection.updateOne(
      { _id: userDoc._id },
      { $set: { mfaPendingSecretEnc: enc, mfaPendingCreatedAt: new Date(), updatedAt: new Date() } },
    );

    const issuer = 'Campus ID';
    const label = encodeURIComponent(`${issuer}:${userDoc.email}`);
    const params = new URLSearchParams({
      secret,
      issuer,
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
    const otpauthUrl = `otpauth://totp/${label}?${params.toString()}`;

    writeAuditEvent({
      institutionId: userDoc.institutionId,
      action: 'mfa.setup.started',
      actor: actorFromAuthUser(authUser, c.req.raw),
      target: { type: 'user', id: userDoc._id.toString(), email: userDoc.email },
      outcome: 'success',
    });

    return c.json({ otpauthUrl, secret });
  } catch (error: any) {
    console.error('MFA setup error:', error);
    return c.json({ error: 'Failed to start MFA setup' }, 500);
  }
});

user.post('/mfa/confirm', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const body = await c.req.json();
    const code = String(body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) return c.json({ error: 'Invalid code' }, 400);

    const usersCollection = getUsersCollection();
    const userDoc = await usersCollection.findOne({ _id: new ObjectId(authUser.userId) });
    if (!userDoc) return c.json({ error: 'User not found' }, 404);
    if (!(userDoc as any).mfaPendingSecretEnc) return c.json({ error: 'No MFA setup in progress' }, 400);

    const secret = AuthService.decryptMfaSecret((userDoc as any).mfaPendingSecretEnc);
    const ok = AuthService.verifyTotp(secret, code);
    if (!ok) return c.json({ error: 'Invalid authentication code' }, 401);

    const backupCodes = AuthService.generateBackupCodes(10);
    const hashed = await AuthService.hashBackupCodes(backupCodes);

    await usersCollection.updateOne(
      { _id: userDoc._id },
      {
        $set: {
          mfaEnabled: true,
          mfaSecretEnc: AuthService.encryptMfaSecret(secret),
          mfaBackupCodesHash: hashed,
          updatedAt: new Date(),
        },
        $unset: { mfaPendingSecretEnc: '', mfaPendingCreatedAt: '' },
      },
    );

    writeAuditEvent({
      institutionId: userDoc.institutionId,
      action: 'mfa.enabled',
      actor: actorFromAuthUser(authUser, c.req.raw),
      target: { type: 'user', id: userDoc._id.toString(), email: userDoc.email },
      outcome: 'success',
    });

    return c.json({ message: 'MFA enabled', backupCodes });
  } catch (error: any) {
    console.error('MFA confirm error:', error);
    return c.json({ error: 'Failed to confirm MFA' }, 500);
  }
});

user.post('/mfa/disable', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const body = await c.req.json();
    const code = String(body?.code || '').trim();
    const currentPassword = String(body?.password || '');

    const usersCollection = getUsersCollection();
    const userDoc = await usersCollection.findOne({ _id: new ObjectId(authUser.userId) });
    if (!userDoc) return c.json({ error: 'User not found' }, 404);

    const pwOk = await AuthService.verifyPassword(currentPassword, userDoc.passwordHash);
    if (!pwOk) return c.json({ error: 'Invalid password' }, 401);

    if (!(userDoc as any).mfaEnabled) return c.json({ error: 'MFA is not enabled' }, 400);

    const secretEnc = (userDoc as any).mfaSecretEnc as string | undefined;
    const secret = secretEnc ? AuthService.decryptMfaSecret(secretEnc) : '';
    const isTotp = secret ? AuthService.verifyTotp(secret, code) : false;

    let usedBackup = false;
    if (!isTotp && Array.isArray((userDoc as any).mfaBackupCodesHash)) {
      for (const h of (userDoc as any).mfaBackupCodesHash as string[]) {
        const ok = await AuthService.verifyPassword(code, h);
        if (ok) {
          usedBackup = true;
          break;
        }
      }
    }

    if (!isTotp && !usedBackup) return c.json({ error: 'Invalid authentication code' }, 401);

    await usersCollection.updateOne(
      { _id: userDoc._id },
      {
        $set: { mfaEnabled: false, updatedAt: new Date() },
        $unset: { mfaSecretEnc: '', mfaBackupCodesHash: '' },
      },
    );

    writeAuditEvent({
      institutionId: userDoc.institutionId,
      action: 'mfa.disabled',
      actor: actorFromAuthUser(authUser, c.req.raw),
      target: { type: 'user', id: userDoc._id.toString(), email: userDoc.email },
      outcome: 'success',
    });

    return c.json({ message: 'MFA disabled' });
  } catch (error: any) {
    console.error('MFA disable error:', error);
    return c.json({ error: 'Failed to disable MFA' }, 500);
  }
});

// Get dashboard stats (for admin dashboard)
user.get('/dashboard-stats', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const usersCollection = getUsersCollection();

    // Only admins can see dashboard stats
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    // Get stats for the admin's institution
    const institutionId = new ObjectId(authUser.institutionId);

    const [
      totalStudents,
      totalLecturers,
      totalAdmins,
      activeUsers,
      pendingUsers,
      suspendedUsers
    ] = await Promise.all([
      usersCollection.countDocuments({ 
        institutionId, 
        userType: 'student' 
      }),
      usersCollection.countDocuments({ 
        institutionId, 
        userType: 'lecturer' 
      }),
      usersCollection.countDocuments({ 
        institutionId, 
        userType: 'admin' 
      }),
      usersCollection.countDocuments({ 
        institutionId, 
        status: 'active' 
      }),
      usersCollection.countDocuments({ 
        institutionId, 
        status: 'pending' 
      }),
      usersCollection.countDocuments({ 
        institutionId, 
        status: 'suspended' 
      })
    ]);

    return c.json({
      stats: {
        users: {
          total: totalStudents + totalLecturers + totalAdmins,
          students: totalStudents,
          lecturers: totalLecturers,
          admins: totalAdmins,
        },
        status: {
          active: activeUsers,
          pending: pendingUsers,
          suspended: suspendedUsers,
        },
        institution: {
          id: authUser.institutionId,
          totalUsers: totalStudents + totalLecturers + totalAdmins
        }
      },
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    return c.json({ error: 'Failed to get dashboard stats' }, 500);
  }
});

export default user;
