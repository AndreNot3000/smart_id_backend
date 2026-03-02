import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { QRService } from '../services/qr.services.js';
import { getUsersCollection, getAttendanceCollection } from '../database/connection.js';
import { sanitizeString } from '../utils/sanitize.js';
import { APP_CONSTANTS } from '../config/constants.js';

const qr = new Hono();

// Validation schema for QR verification
const verifyQRSchema = z.object({
  qrData: z.string().min(1, 'QR code data is required'),
  purpose: z.string().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Generate QR Code Data for Current User (Student or Lecturer)
 * GET /api/qr/generate
 * 
 * Returns a JWT token that can be encoded into a QR code
 * Token is PERMANENT and does not expire (for student/lecturer ID cards)
 * Also returns user avatar/initials for QR code overlay
 */
qr.get('/generate', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    
    // Only students and lecturers can generate QR codes
    if (authUser.userType === 'admin') {
      return c.json({ 
        error: 'Admins cannot generate QR codes. Only students and lecturers.' 
      }, 403);
    }

    // Generate QR token
    const qrToken = QRService.generateQRToken(
      authUser.userId,
      authUser.userType as 'student' | 'lecturer',
      authUser.institutionId
    );

    // Get user details for display
    const usersCollection = getUsersCollection();
    const user = await usersCollection.findOne({ 
      _id: new ObjectId(authUser.userId) 
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Get institution name
    const institutionsCollection = await import('../database/connection.js').then(m => m.getInstitutionsCollection());
    const institution = await institutionsCollection.findOne({ _id: user.institutionId });

    return c.json({
      message: 'QR code generated successfully',
      qrData: qrToken,
      expiresIn: 'never',
      isPermanent: true,
      userInfo: {
        name: `${user.profile.firstName} ${user.profile.lastName}`,
        firstName: user.profile.firstName,
        lastName: user.profile.lastName,
        userType: authUser.userType,
        id: authUser.userType === 'student' 
          ? user.profile.studentId 
          : user.profile.lecturerId,
        avatar: user.profile.avatar, // Initials like "JD"
        department: user.profile.department || '',
        year: user.profile.year || '',
        role: user.profile.role || '',
        institutionName: institution?.name || 'Unknown Institution',
      },
      instructions: 'This is your permanent ID QR code. Display it to be scanned by a lecturer or admin. Save this QR code - it never expires.',
    });

  } catch (error: any) {
    console.error('Generate QR error:', error.message);
    return c.json({ error: 'Failed to generate QR code' }, 500);
  }
});

/**
 * Verify QR Code and Get User Information
 * POST /api/qr/verify
 * 
 * Lecturers and Admins can scan and verify QR codes
 * Returns student/lecturer information
 */
qr.post('/verify', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    
    // Only lecturers and admins can verify QR codes
    if (authUser.userType === 'student') {
      return c.json({ 
        error: 'Students cannot verify QR codes. Only lecturers and admins.' 
      }, 403);
    }

    const body = await c.req.json();
    const data = verifyQRSchema.parse(body);

    // Sanitize inputs
    const sanitizedData = {
      qrData: data.qrData,
      purpose: data.purpose ? sanitizeString(data.purpose) : undefined,
      location: data.location ? sanitizeString(data.location) : undefined,
      notes: data.notes ? sanitizeString(data.notes) : undefined,
    };

    // Verify QR code and get user info
    const userInfo = await QRService.getUserInfoFromQR(sanitizedData.qrData);

    // Check if scanner and scanned user are from same institution
    const decoded = QRService.verifyQRToken(sanitizedData.qrData);
    if (decoded.institutionId !== authUser.institutionId) {
      return c.json({ 
        error: 'Cannot verify QR code from a different institution' 
      }, 403);
    }

    return c.json({
      message: 'QR code verified successfully',
      verified: true,
      userType: decoded.userType,
      userInfo,
      scannedBy: {
        userId: authUser.userId,
        userType: authUser.userType,
        email: authUser.email,
      },
      scannedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Verify QR error:', error.message);
    
    if (error.message.includes('Invalid')) {
      return c.json({ 
        error: 'Invalid QR code',
        message: 'This QR code is invalid or corrupted.',
      }, 400);
    }
    
    return c.json({ error: 'Failed to verify QR code' }, 500);
  }
});

/**
 * Verify QR Code and Mark Attendance
 * POST /api/qr/scan-attendance
 * 
 * Scan QR code and automatically record attendance
 * Only works for students
 */
qr.post('/scan-attendance', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    
    // Only lecturers and admins can scan for attendance
    if (authUser.userType === 'student') {
      return c.json({ 
        error: 'Students cannot scan for attendance. Only lecturers and admins.' 
      }, 403);
    }

    const body = await c.req.json();
    const data = verifyQRSchema.parse(body);

    // Sanitize inputs
    const sanitizedData = {
      qrData: data.qrData,
      purpose: data.purpose ? sanitizeString(data.purpose) : 'Attendance',
      location: data.location ? sanitizeString(data.location) : undefined,
      notes: data.notes ? sanitizeString(data.notes) : undefined,
    };

    // Verify QR code
    const decoded = QRService.verifyQRToken(sanitizedData.qrData);
    
    // Check institution match
    if (decoded.institutionId !== authUser.institutionId) {
      return c.json({ 
        error: 'Cannot scan QR code from a different institution' 
      }, 403);
    }

    // Only students can have attendance marked
    if (decoded.userType !== 'student') {
      return c.json({ 
        error: 'Attendance can only be marked for students' 
      }, 400);
    }

    // Get student info
    const studentInfo = await QRService.getStudentInfoFromQR(sanitizedData.qrData);

    // Record attendance
    const attendanceCollection = getAttendanceCollection();
    const attendanceRecord = {
      studentId: new ObjectId(decoded.userId),
      scannedBy: new ObjectId(authUser.userId),
      scannedByType: authUser.userType as 'lecturer' | 'admin',
      purpose: sanitizedData.purpose,
      location: sanitizedData.location,
      notes: sanitizedData.notes,
      scannedAt: new Date(),
      createdAt: new Date(),
    };

    const result = await attendanceCollection.insertOne(attendanceRecord);

    // Get scanner info
    const usersCollection = getUsersCollection();
    const scanner = await usersCollection.findOne({ 
      _id: new ObjectId(authUser.userId) 
    });

    return c.json({
      message: 'Attendance marked successfully',
      attendanceId: result.insertedId.toString(),
      student: {
        studentId: studentInfo.studentId,
        name: `${studentInfo.firstName} ${studentInfo.lastName}`,
        department: studentInfo.department,
        year: studentInfo.year,
      },
      scannedBy: {
        name: scanner ? `${scanner.profile.firstName} ${scanner.profile.lastName}` : 'Unknown',
        userType: authUser.userType,
      },
      purpose: sanitizedData.purpose,
      location: sanitizedData.location,
      scannedAt: attendanceRecord.scannedAt.toISOString(),
    }, 201);

  } catch (error: any) {
    console.error('Scan attendance error:', error.message);
    
    if (error.message.includes('Invalid')) {
      return c.json({ 
        error: 'Invalid QR code',
        message: 'This QR code is invalid or corrupted.',
      }, 400);
    }
    
    return c.json({ error: 'Failed to mark attendance' }, 500);
  }
});

/**
 * Get Attendance History for a Student
 * GET /api/qr/attendance/student/:studentId
 * 
 * Lecturers and Admins can view student attendance history
 */
qr.get('/attendance/student/:studentId', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const studentIdParam = c.req.param('studentId');
    
    // Only lecturers and admins can view attendance
    if (authUser.userType === 'student') {
      return c.json({ 
        error: 'Students cannot view attendance records. Only lecturers and admins.' 
      }, 403);
    }

    // Pagination
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(
      parseInt(c.req.query('limit') || String(APP_CONSTANTS.PAGINATION.DEFAULT_PAGE_SIZE)),
      APP_CONSTANTS.PAGINATION.MAX_PAGE_SIZE
    );
    const skip = (page - 1) * limit;

    // Find student by studentId
    const usersCollection = getUsersCollection();
    const student = await usersCollection.findOne({ 
      'profile.studentId': studentIdParam,
      userType: 'student',
      institutionId: new ObjectId(authUser.institutionId)
    });

    if (!student) {
      return c.json({ error: 'Student not found' }, 404);
    }

    // Get attendance records
    const attendanceCollection = getAttendanceCollection();
    const [records, total] = await Promise.all([
      attendanceCollection
        .find({ studentId: student._id })
        .sort({ scannedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      attendanceCollection.countDocuments({ studentId: student._id })
    ]);

    // Enrich records with scanner names
    const enrichedRecords = await Promise.all(
      records.map(async (record) => {
        const scanner = await usersCollection.findOne({ _id: record.scannedBy });
        return {
          id: record._id?.toString(),
          purpose: record.purpose,
          location: record.location,
          notes: record.notes,
          scannedBy: {
            name: scanner ? `${scanner.profile.firstName} ${scanner.profile.lastName}` : 'Unknown',
            userType: record.scannedByType,
          },
          scannedAt: record.scannedAt,
        };
      })
    );

    return c.json({
      student: {
        studentId: student.profile.studentId,
        name: `${student.profile.firstName} ${student.profile.lastName}`,
        department: student.profile.department,
        year: student.profile.year,
      },
      attendance: enrichedRecords,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + records.length < total,
      },
    });

  } catch (error: any) {
    console.error('Get attendance history error:', error.message);
    return c.json({ error: 'Failed to fetch attendance history' }, 500);
  }
});

/**
 * Get My Attendance History (Student)
 * GET /api/qr/attendance/my-history
 * 
 * Students can view their own attendance history
 */
qr.get('/attendance/my-history', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    
    // Only students can view their own attendance
    if (authUser.userType !== 'student') {
      return c.json({ 
        error: 'Only students can view their own attendance history' 
      }, 403);
    }

    // Pagination
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(
      parseInt(c.req.query('limit') || String(APP_CONSTANTS.PAGINATION.DEFAULT_PAGE_SIZE)),
      APP_CONSTANTS.PAGINATION.MAX_PAGE_SIZE
    );
    const skip = (page - 1) * limit;

    // Get attendance records
    const attendanceCollection = getAttendanceCollection();
    const studentId = new ObjectId(authUser.userId);
    
    const [records, total] = await Promise.all([
      attendanceCollection
        .find({ studentId })
        .sort({ scannedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      attendanceCollection.countDocuments({ studentId })
    ]);

    // Enrich records with scanner names
    const usersCollection = getUsersCollection();
    const enrichedRecords = await Promise.all(
      records.map(async (record) => {
        const scanner = await usersCollection.findOne({ _id: record.scannedBy });
        return {
          id: record._id?.toString(),
          purpose: record.purpose,
          location: record.location,
          notes: record.notes,
          scannedBy: {
            name: scanner ? `${scanner.profile.firstName} ${scanner.profile.lastName}` : 'Unknown',
            userType: record.scannedByType,
          },
          scannedAt: record.scannedAt,
        };
      })
    );

    return c.json({
      attendance: enrichedRecords,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + records.length < total,
      },
    });

  } catch (error: any) {
    console.error('Get my attendance history error:', error.message);
    return c.json({ error: 'Failed to fetch attendance history' }, 500);
  }
});

export default qr;
