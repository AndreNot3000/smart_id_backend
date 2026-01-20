import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { getUsersCollection, getInstitutionsCollection } from '../database/connection.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { AuthService } from '../services/auth.services.js';

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
    const { firstName, lastName, phone, address, dateOfBirth, department, year, title } = body;

    const updateData: any = {
      updatedAt: new Date()
    };

    // Build profile update object
    if (firstName) updateData['profile.firstName'] = firstName;
    if (lastName) updateData['profile.lastName'] = lastName;
    if (phone !== undefined) updateData['profile.phone'] = phone;
    if (address !== undefined) updateData['profile.address'] = address;
    if (dateOfBirth) updateData['profile.dateOfBirth'] = new Date(dateOfBirth);
    if (department !== undefined) updateData['profile.department'] = department;
    if (year !== undefined) updateData['profile.year'] = year;
    if (title !== undefined) updateData['profile.title'] = title;

    const result = await usersCollection.findOneAndUpdate(
      { _id: userId },
      { $set: updateData },
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
      return c.json({ message: 'Avatar data is required' }, 400);
    }

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
      return c.json({ message: 'User not found' }, 404);
    }

    return c.json({
      message: 'Avatar updated successfully',
      avatar: result.profile?.avatar
    });
  } catch (error) {
    console.error('Update avatar error:', error);
    return c.json({ message: 'Failed to update avatar' }, 500);
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

    // Update password
    await usersCollection.updateOne(
      { _id: new ObjectId(authUser.userId) },
      { 
        $set: { 
          passwordHash: newPasswordHash,
          passwordHistory: updatedPasswordHistory,
          isFirstLogin: false, // Clear first login flag
          updatedAt: new Date()
        } 
      }
    );

    return c.json({ message: 'Password changed successfully' });

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

// Logout (invalidate token - client-side mainly)
user.post('/logout', authMiddleware, async (c) => {
  try {
    // In a JWT system, logout is mainly handled client-side by removing tokens
    // But we can log the logout event for security/audit purposes
    
    const authUser = c.get('user');
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
