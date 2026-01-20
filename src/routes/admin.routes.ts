import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { getUsersCollection, getOTPCollection } from '../database/connection.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { AuthService } from '../services/auth.services.js';
import { sendStudentActivationEmail, sendLecturerActivationEmail } from '../services/email.services.js';

const admin = new Hono();

// Validation schema for creating student
const createStudentSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  department: z.string().min(1, 'Department is required'),
  year: z.string().min(1, 'Academic year is required'),
});

// Validation schema for creating lecturer
const createLecturerSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  department: z.string().min(1, 'Department is required'),
  role: z.enum(['Prof', 'Dr', 'Mr', 'Mrs', 'Ms'], {
    errorMap: () => ({ message: 'Role must be one of: Prof, Dr, Mr, Mrs, Ms' })
  }),
  specialization: z.string().optional(),
});

// Generate unique student ID
function generateStudentId(institutionCode: string): string {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${institutionCode}-${timestamp}${random}`;
}

// Generate unique lecturer ID
function generateLecturerId(institutionCode: string): string {
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${institutionCode}-LEC-${timestamp}${random}`;
}

// Create student account (Admin only)
admin.post('/students', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    
    // Only admins can create students
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const body = await c.req.json();
    const data = createStudentSchema.parse(body);

    const usersCollection = getUsersCollection();
    const otpCollection = getOTPCollection();

    // Check if email already exists
    const existingUser = await usersCollection.findOne({ email: data.email });
    if (existingUser) {
      return c.json({ error: 'Email already registered' }, 400);
    }

    // Get admin's institution details
    const adminUser = await usersCollection.findOne({ _id: new ObjectId(authUser.userId) });
    if (!adminUser) {
      return c.json({ error: 'Admin user not found' }, 404);
    }

    // Generate student ID (using institution code)
    const { getInstitutionsCollection } = await import('../database/connection.js');
    const institutionsCollection = getInstitutionsCollection();
    const institution = await institutionsCollection.findOne({ _id: adminUser.institutionId });
    
    if (!institution) {
      return c.json({ error: 'Institution not found' }, 404);
    }

    const studentId = generateStudentId(institution.code);
    
    // Generate default password: firstName123 (lowercase)
    const defaultPassword = `${data.firstName.toLowerCase()}123`;
    const passwordHash = await AuthService.hashPassword(defaultPassword);

    // Generate verification token (secure random string)
    const verificationToken = AuthService.generateToken(32); // 32 character random token
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create student user
    const newStudent = {
      email: data.email,
      passwordHash,
      passwordHistory: [],
      userType: 'student' as const,
      institutionId: adminUser.institutionId,
      status: 'pending' as const,
      emailVerified: false,
      isFirstLogin: true, // Flag for password change requirement
      profile: {
        firstName: data.firstName,
        lastName: data.lastName,
        studentId,
        department: data.department,
        year: data.year,
        avatar: `${data.firstName.charAt(0)}${data.lastName.charAt(0)}`.toUpperCase(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(newStudent);

    // Store verification token
    await otpCollection.insertOne({
      email: data.email,
      code: verificationToken,
      purpose: 'email_verification',
      expiresAt: tokenExpiresAt,
      used: false,
      createdAt: new Date(),
    });

    // Send activation email
    console.log('📧 About to send activation email...');
    try {
      await sendStudentActivationEmail(
        data.email,
        data.firstName,
        data.lastName,
        studentId,
        defaultPassword,
        verificationToken,
        institution.name
      );
      console.log('✅ Activation email sent successfully');
    } catch (emailError) {
      console.error('❌ Failed to send activation email:', emailError);
      // Don't fail the student creation if email fails
    }

    return c.json({
      message: 'Student account created successfully. Activation email sent.',
      student: {
        id: result.insertedId,
        email: data.email,
        studentId,
        firstName: data.firstName,
        lastName: data.lastName,
        department: data.department,
        year: data.year,
        status: 'pending',
        defaultPassword, // Return for admin reference (remove in production)
      },
    }, 201);

  } catch (error) {
    console.error('Create student error:', error);
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation error',
        details: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      }, 400);
    }
    return c.json({ error: 'Failed to create student account' }, 500);
  }
});

// Create lecturer account (Admin only)
admin.post('/lecturers', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    
    // Only admins can create lecturers
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const body = await c.req.json();
    const data = createLecturerSchema.parse(body);

    const usersCollection = getUsersCollection();
    const otpCollection = getOTPCollection();

    // Check if email already exists
    const existingUser = await usersCollection.findOne({ email: data.email });
    if (existingUser) {
      return c.json({ error: 'Email already registered' }, 400);
    }

    // Get admin's institution details
    const adminUser = await usersCollection.findOne({ _id: new ObjectId(authUser.userId) });
    if (!adminUser) {
      return c.json({ error: 'Admin user not found' }, 404);
    }

    // Generate lecturer ID (using institution code)
    const { getInstitutionsCollection } = await import('../database/connection.js');
    const institutionsCollection = getInstitutionsCollection();
    const institution = await institutionsCollection.findOne({ _id: adminUser.institutionId });
    
    if (!institution) {
      return c.json({ error: 'Institution not found' }, 404);
    }

    const lecturerId = generateLecturerId(institution.code);
    
    // Generate default password: firstName123 (lowercase)
    const defaultPassword = `${data.firstName.toLowerCase()}123`;
    const passwordHash = await AuthService.hashPassword(defaultPassword);

    // Generate verification token (secure random string)
    const verificationToken = AuthService.generateToken(32); // 32 character random token
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Create lecturer user
    const newLecturer = {
      email: data.email,
      passwordHash,
      passwordHistory: [],
      userType: 'lecturer' as const,
      institutionId: adminUser.institutionId,
      status: 'pending' as const,
      emailVerified: false,
      isFirstLogin: true, // Flag for password change requirement
      profile: {
        firstName: data.firstName,
        lastName: data.lastName,
        lecturerId,
        department: data.department,
        role: data.role,
        specialization: data.specialization || '',
        avatar: `${data.firstName.charAt(0)}${data.lastName.charAt(0)}`.toUpperCase(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(newLecturer);

    // Store verification token
    await otpCollection.insertOne({
      email: data.email,
      code: verificationToken,
      purpose: 'email_verification',
      expiresAt: tokenExpiresAt,
      used: false,
      createdAt: new Date(),
    });

    // Send activation email
    console.log('📧 About to send lecturer activation email...');
    try {
      await sendLecturerActivationEmail(
        data.email,
        data.firstName,
        data.lastName,
        lecturerId,
        defaultPassword,
        verificationToken,
        institution.name,
        data.role,
        data.department
      );
      console.log('✅ Lecturer activation email sent successfully');
    } catch (emailError) {
      console.error('❌ Failed to send lecturer activation email:', emailError);
      // Don't fail the lecturer creation if email fails
    }

    return c.json({
      message: 'Lecturer account created successfully. Activation email sent.',
      lecturer: {
        id: result.insertedId,
        email: data.email,
        lecturerId,
        firstName: data.firstName,
        lastName: data.lastName,
        department: data.department,
        role: data.role,
        specialization: data.specialization,
        status: 'pending',
        defaultPassword, // Return for admin reference (remove in production)
      },
    }, 201);

  } catch (error) {
    console.error('Create lecturer error:', error);
    if (error instanceof z.ZodError) {
      return c.json({
        error: 'Validation error',
        details: error.issues.map(issue => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      }, 400);
    }
    return c.json({ error: 'Failed to create lecturer account' }, 500);
  }
});

// Get all students for admin's institution
admin.get('/students', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    
    // Only admins can view students
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const usersCollection = getUsersCollection();
    const institutionId = new ObjectId(authUser.institutionId);

    const students = await usersCollection
      .find(
        { institutionId, userType: 'student' },
        { projection: { passwordHash: 0, passwordHistory: 0 } }
      )
      .toArray();

    return c.json({
      students: students.map(student => ({
        id: student._id,
        email: student.email,
        studentId: student.profile.studentId,
        firstName: student.profile.firstName,
        lastName: student.profile.lastName,
        department: student.profile.department,
        year: student.profile.year,
        status: student.status,
        emailVerified: student.emailVerified,
        createdAt: student.createdAt,
      })),
      total: students.length,
    });

  } catch (error) {
    console.error('Get students error:', error);
    return c.json({ error: 'Failed to fetch students' }, 500);
  }
});

// Get all lecturers for admin's institution
admin.get('/lecturers', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    
    // Only admins can view lecturers
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const usersCollection = getUsersCollection();
    const institutionId = new ObjectId(authUser.institutionId);

    const lecturers = await usersCollection
      .find(
        { institutionId, userType: 'lecturer' },
        { projection: { passwordHash: 0, passwordHistory: 0 } }
      )
      .toArray();

    return c.json({
      lecturers: lecturers.map(lecturer => ({
        id: lecturer._id,
        email: lecturer.email,
        lecturerId: lecturer.profile.lecturerId,
        firstName: lecturer.profile.firstName,
        lastName: lecturer.profile.lastName,
        department: lecturer.profile.department,
        role: lecturer.profile.role,
        specialization: lecturer.profile.specialization,
        status: lecturer.status,
        emailVerified: lecturer.emailVerified,
        createdAt: lecturer.createdAt,
      })),
      total: lecturers.length,
    });

  } catch (error) {
    console.error('Get lecturers error:', error);
    return c.json({ error: 'Failed to fetch lecturers' }, 500);
  }
});

export default admin;
