import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { getUsersCollection, getOTPCollection } from '../database/connection.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { AuthService } from '../services/auth.services.js';
import { sendStudentActivationEmail, sendLecturerActivationEmail } from '../services/email.services.js';
import { APP_CONSTANTS, getConfig } from '../config/constants.js';
import { sanitizeEmail, sanitizeString } from '../utils/sanitize.js';
import { getInstitutionsCollection } from '../database/connection.js';
import { DEFAULT_GRADE_SCALE, isValidScale, type GradeScale } from '../utils/gpa.js';

const admin = new Hono();

// ---- Grading scale (admin-configurable per institution) ----

// GET /admin/grade-scale - returns this institution's grading scale (or the default).
admin.get('/grade-scale', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }
    const institutions = getInstitutionsCollection();
    const institution = await institutions.findOne({ _id: new ObjectId(authUser.institutionId) });
    if (!institution) return c.json({ error: 'Institution not found' }, 404);

    const custom = (institution as any).gradeScale;
    const scale = isValidScale(custom) ? custom : DEFAULT_GRADE_SCALE;
    return c.json({ gradeScale: scale, isCustom: isValidScale(custom), default: DEFAULT_GRADE_SCALE });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch grade scale', details: error.message }, 500);
  }
});

// PUT /admin/grade-scale - saves a custom grading scale for this institution.
admin.put('/grade-scale', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const body = await c.req.json();
    const scale = body?.gradeScale as GradeScale;

    if (!isValidScale(scale)) {
      return c.json({ error: 'Invalid grade scale. Provide scaleMax and at least one band with min, max, letter, and point.' }, 400);
    }
    if (scale.bands.length > 20) {
      return c.json({ error: 'Too many grade bands (max 20).' }, 400);
    }
    for (const b of scale.bands) {
      if (b.min < 0 || b.max > 100 || b.min > b.max) {
        return c.json({ error: `Invalid band "${b.letter}": min/max must be within 0–100 and min ≤ max.` }, 400);
      }
      if (b.point < 0 || b.point > scale.scaleMax) {
        return c.json({ error: `Invalid band "${b.letter}": grade point must be between 0 and ${scale.scaleMax}.` }, 400);
      }
    }

    // Normalise: keep only the recognised fields, sort bands high → low.
    const clean: GradeScale = {
      scaleMax: scale.scaleMax,
      bands: scale.bands
        .map((b) => ({ min: b.min, max: b.max, letter: b.letter.trim().slice(0, 4), point: b.point }))
        .sort((a, b) => b.min - a.min),
    };

    const institutions = getInstitutionsCollection();
    const result = await institutions.updateOne(
      { _id: new ObjectId(authUser.institutionId) },
      { $set: { gradeScale: clean, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0) return c.json({ error: 'Institution not found' }, 404);

    return c.json({ message: 'Grading scale saved', gradeScale: clean });
  } catch (error: any) {
    return c.json({ error: 'Failed to save grade scale', details: error.message }, 500);
  }
});

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Normalise a "year" value (e.g. "Year 1", "100L", "1") to a level label "100L".
function yearToLevel(year: string): string {
  if (!year) return 'Unspecified';
  if (/^\d+L$/i.test(year)) return year.toUpperCase();
  const m = year.match(/(\d+)/);
  if (m && m[1]) return `${parseInt(m[1]) * 100}L`;
  return year;
}

// GET /admin/reports/overview - institution-wide headcount, status, growth, and
// department/level breakdowns. All scoped to the admin's institution.
admin.get('/reports/overview', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }
    const months = Math.min(Math.max(parseInt(c.req.query('months') || '6'), 1), 24);
    const institutionId = new ObjectId(authUser.institutionId);
    const usersCollection = getUsersCollection();

    // 1. Counts by userType + status (single pass)
    const grouped = await usersCollection.aggregate([
      { $match: { institutionId } },
      { $group: { _id: { userType: '$userType', status: '$status' }, count: { $sum: 1 } } },
    ]).toArray();

    const counts = { student: 0, lecturer: 0, admin: 0, total: 0 };
    const status = { active: 0, pending: 0, suspended: 0 };
    for (const g of grouped) {
      const t = (g._id as any).userType as string;
      const s = (g._id as any).status as string;
      const n = g.count as number;
      if (t in counts) (counts as any)[t] += n;
      counts.total += n;
      if (s in status) (status as any)[s] += n;
    }

    // 2. Growth: new accounts per month over the window (students vs lecturers)
    const since = new Date();
    since.setMonth(since.getMonth() - (months - 1));
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const growthRaw = await usersCollection.aggregate([
      { $match: { institutionId, userType: { $in: ['student', 'lecturer'] }, createdAt: { $gte: since } } },
      {
        $group: {
          _id: { y: { $year: '$createdAt' }, m: { $month: '$createdAt' }, type: '$userType' },
          count: { $sum: 1 },
        },
      },
    ]).toArray();

    const growthMap: Record<string, { month: string; students: number; lecturers: number }> = {};
    for (let i = 0; i < months; i++) {
      const d = new Date(since);
      d.setMonth(since.getMonth() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      growthMap[key] = {
        month: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }),
        students: 0,
        lecturers: 0,
      };
    }
    for (const g of growthRaw) {
      const id = g._id as any;
      const key = `${id.y}-${String(id.m).padStart(2, '0')}`;
      if (!growthMap[key]) continue;
      if (id.type === 'student') growthMap[key].students += g.count;
      else if (id.type === 'lecturer') growthMap[key].lecturers += g.count;
    }
    const growth = Object.values(growthMap);

    // 3. Students by department
    const deptRaw = await usersCollection.aggregate([
      { $match: { institutionId, userType: 'student' } },
      { $group: { _id: '$profile.department', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray();
    const byDepartment = deptRaw.map((d) => ({
      department: (d._id as string) || 'Unspecified',
      count: d.count as number,
    }));

    // 4. Students by level (normalised)
    const levelRaw = await usersCollection.aggregate([
      { $match: { institutionId, userType: 'student' } },
      { $group: { _id: '$profile.year', count: { $sum: 1 } } },
    ]).toArray();
    const levelMap: Record<string, number> = {};
    for (const l of levelRaw) {
      const lvl = yearToLevel((l._id as string) || '');
      levelMap[lvl] = (levelMap[lvl] || 0) + (l.count as number);
    }
    const byLevel = Object.entries(levelMap)
      .map(([level, count]) => ({ level, count }))
      .sort((a, b) => a.level.localeCompare(b.level));

    return c.json({
      counts,
      status,
      growth,
      byDepartment,
      byLevel,
      months,
      serverTime: new Date().toISOString(),
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to load overview', details: error.message }, 500);
  }
});

function emailExistsResponse(
  existingUser: { institutionId?: unknown },
  adminInstitutionId: string,
  accountType: 'student' | 'lecturer',
) {
  const sameInstitution = existingUser.institutionId?.toString() === adminInstitutionId;
  const label = accountType === 'student' ? 'student' : 'lecturer';
  return {
    body: {
      error: sameInstitution
        ? `This email is already registered as a ${label} at your institution.`
        : `This email is already registered with another institution. The same email cannot be used for a ${label} account at your university — please use a different email address.`,
      code: sameInstitution ? 'EMAIL_EXISTS_SAME_INSTITUTION' : 'EMAIL_EXISTS_OTHER_INSTITUTION',
      emailInUseElsewhere: !sameInstitution,
      accountType,
    },
    status: sameInstitution ? 400 as const : 409 as const,
  };
}

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
    message: 'Role must be one of: Prof, Dr, Mr, Mrs, Ms'
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
    const config = getConfig();
    const authUser = c.get('user');
    
    // Only admins can create students
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const body = await c.req.json();
    const data = createStudentSchema.parse(body);

    // Sanitize inputs
    const sanitizedData = {
      firstName: sanitizeString(data.firstName),
      lastName: sanitizeString(data.lastName),
      email: sanitizeEmail(data.email),
      department: sanitizeString(data.department),
      year: sanitizeString(data.year),
    };

    const usersCollection = getUsersCollection();
    const otpCollection = getOTPCollection();

    // Check if email already exists (case-insensitive) and tell the admin
    // whether the clash is at their own institution or another one.
    const existingUser = await usersCollection.findOne({
      email: { $regex: new RegExp(`^${escapeRegex(sanitizedData.email)}$`, 'i') },
    });
    if (existingUser) {
      const { body, status } = emailExistsResponse(existingUser, authUser.institutionId, 'student');
      return c.json(body, status);
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
    const defaultPassword = `${sanitizedData.firstName.toLowerCase()}123`;
    const passwordHash = await AuthService.hashPassword(defaultPassword);

    // Generate verification token (cryptographically secure)
    const verificationToken = AuthService.generateToken();
    const tokenExpiresAt = new Date(Date.now() + APP_CONSTANTS.TOKEN.VERIFICATION_TOKEN_EXPIRY);

    // Create student user
    const newStudent = {
      email: sanitizedData.email,
      passwordHash,
      passwordHistory: [],
      userType: 'student' as const,
      institutionId: adminUser.institutionId,
      status: 'pending' as const,
      emailVerified: false,
      isFirstLogin: true,
      profile: {
        firstName: sanitizedData.firstName,
        lastName: sanitizedData.lastName,
        studentId,
        department: sanitizedData.department,
        year: sanitizedData.year,
        avatar: `${sanitizedData.firstName.charAt(0)}${sanitizedData.lastName.charAt(0)}`.toUpperCase(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(newStudent);

    // Store verification token
    await otpCollection.insertOne({
      email: sanitizedData.email,
      code: verificationToken,
      purpose: 'email_verification',
      expiresAt: tokenExpiresAt,
      used: false,
      createdAt: new Date(),
    });

    // Send activation email (throw error if fails)
    try {
      await sendStudentActivationEmail(
        sanitizedData.email,
        sanitizedData.firstName,
        sanitizedData.lastName,
        studentId,
        defaultPassword,
        verificationToken,
        institution.name
      );
    } catch (emailError: any) {
      console.error('❌ Failed to send activation email:', emailError.message);
      // Rollback: Delete the created user and token
      await usersCollection.deleteOne({ _id: result.insertedId });
      await otpCollection.deleteOne({ email: sanitizedData.email, code: verificationToken });
      
      return c.json({ 
        error: 'Failed to send activation email. Please try again or contact support.',
        details: config.isDevelopment ? emailError.message : undefined
      }, 500);
    }

    // Prepare response
    const response: any = {
      message: 'Student account created successfully. Activation email sent.',
      student: {
        id: result.insertedId,
        email: sanitizedData.email,
        studentId,
        firstName: sanitizedData.firstName,
        lastName: sanitizedData.lastName,
        department: sanitizedData.department,
        year: sanitizedData.year,
        status: 'pending',
      },
    };

    // Only include default password in development
    if (config.security.returnPasswordInResponse) {
      response.student.defaultPassword = defaultPassword;
    }

    return c.json(response, 201);

  } catch (error: any) {
    console.error('Create student error:', error.message);
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
    const config = getConfig();
    const authUser = c.get('user');
    
    // Only admins can create lecturers
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const body = await c.req.json();
    const data = createLecturerSchema.parse(body);

    // Sanitize inputs
    const sanitizedData = {
      firstName: sanitizeString(data.firstName),
      lastName: sanitizeString(data.lastName),
      email: sanitizeEmail(data.email),
      department: sanitizeString(data.department),
      role: data.role,
      specialization: data.specialization ? sanitizeString(data.specialization) : '',
    };

    const usersCollection = getUsersCollection();
    const otpCollection = getOTPCollection();

    // Check if email already exists (case-insensitive) and tell the admin
    // whether the clash is at their own institution or another one.
    const existingUser = await usersCollection.findOne({
      email: { $regex: new RegExp(`^${escapeRegex(sanitizedData.email)}$`, 'i') },
    });
    if (existingUser) {
      const { body, status } = emailExistsResponse(existingUser, authUser.institutionId, 'lecturer');
      return c.json(body, status);
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
    const defaultPassword = `${sanitizedData.firstName.toLowerCase()}123`;
    const passwordHash = await AuthService.hashPassword(defaultPassword);

    // Generate verification token (cryptographically secure)
    const verificationToken = AuthService.generateToken();
    const tokenExpiresAt = new Date(Date.now() + APP_CONSTANTS.TOKEN.VERIFICATION_TOKEN_EXPIRY);

    // Create lecturer user
    const newLecturer = {
      email: sanitizedData.email,
      passwordHash,
      passwordHistory: [],
      userType: 'lecturer' as const,
      institutionId: adminUser.institutionId,
      status: 'pending' as const,
      emailVerified: false,
      isFirstLogin: true,
      profile: {
        firstName: sanitizedData.firstName,
        lastName: sanitizedData.lastName,
        lecturerId,
        department: sanitizedData.department,
        role: sanitizedData.role,
        specialization: sanitizedData.specialization,
        avatar: `${sanitizedData.firstName.charAt(0)}${sanitizedData.lastName.charAt(0)}`.toUpperCase(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(newLecturer);

    // Store verification token
    await otpCollection.insertOne({
      email: sanitizedData.email,
      code: verificationToken,
      purpose: 'email_verification',
      expiresAt: tokenExpiresAt,
      used: false,
      createdAt: new Date(),
    });

    // Send activation email (throw error if fails)
    try {
      await sendLecturerActivationEmail(
        sanitizedData.email,
        sanitizedData.firstName,
        sanitizedData.lastName,
        lecturerId,
        defaultPassword,
        verificationToken,
        institution.name,
        sanitizedData.role,
        sanitizedData.department
      );
    } catch (emailError: any) {
      console.error('❌ Failed to send lecturer activation email:', emailError.message);
      // Rollback: Delete the created user and token
      await usersCollection.deleteOne({ _id: result.insertedId });
      await otpCollection.deleteOne({ email: sanitizedData.email, code: verificationToken });
      
      return c.json({ 
        error: 'Failed to send activation email. Please try again or contact support.',
        details: config.isDevelopment ? emailError.message : undefined
      }, 500);
    }

    // Prepare response
    const response: any = {
      message: 'Lecturer account created successfully. Activation email sent.',
      lecturer: {
        id: result.insertedId,
        email: sanitizedData.email,
        lecturerId,
        firstName: sanitizedData.firstName,
        lastName: sanitizedData.lastName,
        department: sanitizedData.department,
        role: sanitizedData.role,
        specialization: sanitizedData.specialization,
        status: 'pending',
      },
    };

    // Only include default password in development
    if (config.security.returnPasswordInResponse) {
      response.lecturer.defaultPassword = defaultPassword;
    }

    return c.json(response, 201);

  } catch (error: any) {
    console.error('Create lecturer error:', error.message);
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

// Get all students for admin's institution (with pagination)
admin.get('/students', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    
    // Only admins can view students
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    // Pagination parameters
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(
      parseInt(c.req.query('limit') || String(APP_CONSTANTS.PAGINATION.DEFAULT_PAGE_SIZE)),
      APP_CONSTANTS.PAGINATION.MAX_PAGE_SIZE
    );
    const skip = (page - 1) * limit;

    const usersCollection = getUsersCollection();
    const institutionId = new ObjectId(authUser.institutionId);

    const [students, total] = await Promise.all([
      usersCollection
        .find(
          { institutionId, userType: 'student' },
          { projection: { passwordHash: 0, passwordHistory: 0 } }
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      usersCollection.countDocuments({ institutionId, userType: 'student' })
    ]);

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
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + students.length < total,
      },
    });

  } catch (error: any) {
    console.error('Get students error:', error.message);
    return c.json({ error: 'Failed to fetch students' }, 500);
  }
});

// Get all lecturers for admin's institution (with pagination)
admin.get('/lecturers', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    
    // Only admins can view lecturers
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    // Pagination parameters
    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(
      parseInt(c.req.query('limit') || String(APP_CONSTANTS.PAGINATION.DEFAULT_PAGE_SIZE)),
      APP_CONSTANTS.PAGINATION.MAX_PAGE_SIZE
    );
    const skip = (page - 1) * limit;

    const usersCollection = getUsersCollection();
    const institutionId = new ObjectId(authUser.institutionId);

    const [lecturers, total] = await Promise.all([
      usersCollection
        .find(
          { institutionId, userType: 'lecturer' },
          { projection: { passwordHash: 0, passwordHistory: 0 } }
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      usersCollection.countDocuments({ institutionId, userType: 'lecturer' })
    ]);

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
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + lecturers.length < total,
      },
    });

  } catch (error: any) {
    console.error('Get lecturers error:', error.message);
    return c.json({ error: 'Failed to fetch lecturers' }, 500);
  }
});

export default admin;
