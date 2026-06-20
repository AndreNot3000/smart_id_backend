import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { getUsersCollection, getOTPCollection, getDatabase, getEnrollmentsCollection, getAttendanceCollection } from '../database/connection.js';
import { authMiddleware, invalidateAuthCache } from '../middleware/auth.middleware.js';
import { AuthService } from '../services/auth.services.js';
import { sendStudentActivationEmail, sendLecturerActivationEmail } from '../services/email.services.js';
import { APP_CONSTANTS, getConfig } from '../config/constants.js';
import { sanitizeEmail, sanitizeString } from '../utils/sanitize.js';
import { getInstitutionsCollection } from '../database/connection.js';
import { DEFAULT_GRADE_SCALE, isValidScale, type GradeScale } from '../utils/gpa.js';
import { getLecturerTitle } from '../utils/profile.js';
import { actorFromAuthUser, targetUser, writeAuditEvent } from '../services/audit-log.service.js';

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

    writeAuditEvent({
      institutionId: new ObjectId(authUser.institutionId),
      action: 'institution.grade_scale.updated',
      actor: actorFromAuthUser(authUser, c.req.raw),
      target: { type: 'institution', id: String(authUser.institutionId) },
      outcome: 'success',
      metadata: { gradeScale: clean },
    });

    return c.json({ message: 'Grading scale saved', gradeScale: clean });
  } catch (error: any) {
    try {
      const authUser = c.get('user');
      writeAuditEvent({
        institutionId: authUser?.institutionId ? new ObjectId(authUser.institutionId) : undefined,
        action: 'institution.grade_scale.updated',
        actor: actorFromAuthUser(authUser, c.req.raw),
        outcome: 'failure',
        errorMessage: error?.message || 'unknown error',
      });
    } catch {}
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

// Emails are unique PER INSTITUTION and across all roles within it. Because the
// duplicate check is scoped to the admin's own institution, any clash is, by
// definition, a clash inside their university — so we tell them exactly that
// and (when known) which role already owns the address.
function emailExistsResponse(
  existingUser: { userType?: string },
  accountType: 'student' | 'lecturer',
) {
  const existingRole = existingUser.userType ?? 'user';
  return {
    body: {
      error: `This email is already in use by ${
        existingRole === accountType ? `another ${existingRole}` : `a ${existingRole}`
      } at your institution. Each email can only be used once per institution — please use a different email address.`,
      code: 'EMAIL_EXISTS_SAME_INSTITUTION',
      field: 'email',
      accountType,
    },
    status: 400 as const,
  };
}

/** Pending account that never finished email activation — safe to re-issue credentials. */
function canReissuePendingActivation(
  existingUser: { userType?: string; status?: string; emailVerified?: boolean },
  accountType: 'student' | 'lecturer',
): boolean {
  return (
    existingUser.userType === accountType &&
    existingUser.status === 'pending' &&
    existingUser.emailVerified !== true
  );
}

async function storeActivationOtp(
  otpCollection: ReturnType<typeof getOTPCollection>,
  email: string,
  institutionId: ObjectId,
  verificationToken: string,
) {
  const tokenExpiresAt = new Date(Date.now() + APP_CONSTANTS.TOKEN.VERIFICATION_TOKEN_EXPIRY);
  // Drop stale / used codes so a fresh link is the only active one.
  await otpCollection.updateMany(
    { email, institutionId, purpose: 'email_verification' },
    { $set: { used: true } },
  );
  await otpCollection.insertOne({
    email,
    institutionId,
    code: verificationToken,
    purpose: 'email_verification',
    expiresAt: tokenExpiresAt,
    used: false,
    createdAt: new Date(),
  });
  return tokenExpiresAt;
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
  title: z.enum(['Prof', 'Dr', 'Mr', 'Mrs', 'Ms'], {
    message: 'Title must be one of: Prof, Dr, Mr, Mrs, Ms'
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

// Live email-availability check (Admin only) — lets the create-user form warn
// before submit. Scoped to the admin's institution, since emails are unique
// per-institution and across all roles within it.
admin.get('/check-email', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const raw = (c.req.query('email') || '').trim();
    const forRole = (c.req.query('userType') || '').trim();
    const email = sanitizeEmail(raw);
    // Basic shape check; the form does full validation, this is just a guard.
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ available: false, valid: false });
    }

    const usersCollection = getUsersCollection();
    const existing = await usersCollection.findOne({
      institutionId: new ObjectId(authUser.institutionId),
      email: { $regex: new RegExp(`^${escapeRegex(email)}$`, 'i') },
    });

    if (existing) {
      const role =
        forRole === 'student' || forRole === 'lecturer' ? forRole : (existing.userType as 'student' | 'lecturer');
      if (canReissuePendingActivation(existing, role)) {
        return c.json({
          available: true,
          valid: true,
          reissue: true,
          existingRole: existing.userType,
          message:
            'A pending account exists for this email (activation not completed). Submitting the form will resend activation credentials.',
        });
      }
      return c.json({
        available: false,
        valid: true,
        existingRole: existing.userType,
        message: `Already in use by ${
          existing.userType ? `a ${existing.userType}` : 'another account'
        } at your institution.`,
      });
    }

    return c.json({ available: true, valid: true });
  } catch (error: any) {
    console.error('Check email error:', error.message);
    return c.json({ error: 'Failed to check email' }, 500);
  }
});

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

    // Check if email already exists WITHIN this institution (case-insensitive,
    // across every role). Emails are unique per-institution, so the same
    // address can still belong to a different university.
    const existingUser = await usersCollection.findOne({
      institutionId: new ObjectId(authUser.institutionId),
      email: { $regex: new RegExp(`^${escapeRegex(sanitizedData.email)}$`, 'i') },
    });
    if (existingUser && !canReissuePendingActivation(existingUser, 'student')) {
      const { body, status } = emailExistsResponse(existingUser, 'student');
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

    const defaultPassword = AuthService.generateTemporaryPassword();
    const passwordHash = await AuthService.hashPassword(defaultPassword);
    const verificationToken = AuthService.generateToken();

    // Re-issue activation for a pending student whose link expired / was never used.
    if (existingUser && canReissuePendingActivation(existingUser, 'student')) {
      const studentId = existingUser.profile?.studentId || generateStudentId(institution.code);

      await usersCollection.updateOne(
        { _id: existingUser._id },
        {
          $set: {
            passwordHash,
            passwordHistory: [],
            status: 'pending',
            emailVerified: false,
            isFirstLogin: true,
            'profile.firstName': sanitizedData.firstName,
            'profile.lastName': sanitizedData.lastName,
            'profile.studentId': studentId,
            'profile.department': sanitizedData.department,
            'profile.year': sanitizedData.year,
            'profile.avatar': `${sanitizedData.firstName.charAt(0)}${sanitizedData.lastName.charAt(0)}`.toUpperCase(),
            updatedAt: new Date(),
          },
        },
      );

      await storeActivationOtp(
        otpCollection,
        sanitizedData.email,
        adminUser.institutionId,
        verificationToken,
      );

      try {
        await sendStudentActivationEmail(
          sanitizedData.email,
          sanitizedData.firstName,
          sanitizedData.lastName,
          studentId,
          defaultPassword,
          verificationToken,
          institution.name,
        );
      } catch (emailError: any) {
        console.error('❌ Failed to resend student activation email:', emailError.message);
        return c.json({
          error: 'Failed to send activation email. Please try again or contact support.',
          details: config.isDevelopment ? emailError.message : undefined,
        }, 500);
      }

      writeAuditEvent({
        institutionId: adminUser.institutionId,
        action: 'user.student.activation_reissued',
        actor: actorFromAuthUser(authUser, c.req.raw),
        target: targetUser(existingUser),
        outcome: 'success',
        metadata: { studentId, reason: 'pending_unverified_recreate' },
      });

      const response: any = {
        message: 'Activation email resent. The previous link is no longer valid.',
        reissued: true,
        student: {
          id: existingUser._id,
          email: sanitizedData.email,
          studentId,
          firstName: sanitizedData.firstName,
          lastName: sanitizedData.lastName,
          department: sanitizedData.department,
          year: sanitizedData.year,
          status: 'pending',
        },
      };
      if (config.security.returnPasswordInResponse) {
        response.student.defaultPassword = defaultPassword;
      }
      return c.json(response, 200);
    }

    const studentId = generateStudentId(institution.code);

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

    writeAuditEvent({
      institutionId: adminUser.institutionId,
      action: 'user.student.created',
      actor: actorFromAuthUser(authUser, c.req.raw),
      target: targetUser({ ...newStudent, _id: result.insertedId }),
      outcome: 'success',
      metadata: {
        studentId,
        department: sanitizedData.department,
        year: sanitizedData.year,
      },
    });

    // Store verification token
    await storeActivationOtp(
      otpCollection,
      sanitizedData.email,
      adminUser.institutionId,
      verificationToken,
    );

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
    try {
      const authUser = c.get('user');
      writeAuditEvent({
        institutionId: authUser?.institutionId ? new ObjectId(authUser.institutionId) : undefined,
        action: 'user.student.created',
        actor: actorFromAuthUser(authUser, c.req.raw),
        outcome: 'failure',
        errorMessage: error?.message || 'unknown error',
      });
    } catch {}
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
      title: data.title,
      specialization: data.specialization ? sanitizeString(data.specialization) : '',
    };

    const usersCollection = getUsersCollection();
    const otpCollection = getOTPCollection();

    // Check if email already exists WITHIN this institution (case-insensitive,
    // across every role). Emails are unique per-institution, so the same
    // address can still belong to a different university.
    const existingUser = await usersCollection.findOne({
      institutionId: new ObjectId(authUser.institutionId),
      email: { $regex: new RegExp(`^${escapeRegex(sanitizedData.email)}$`, 'i') },
    });
    if (existingUser && !canReissuePendingActivation(existingUser, 'lecturer')) {
      const { body, status } = emailExistsResponse(existingUser, 'lecturer');
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

    const defaultPassword = AuthService.generateTemporaryPassword();
    const passwordHash = await AuthService.hashPassword(defaultPassword);
    const verificationToken = AuthService.generateToken();

    if (existingUser && canReissuePendingActivation(existingUser, 'lecturer')) {
      const lecturerId = existingUser.profile?.lecturerId || generateLecturerId(institution.code);

      await usersCollection.updateOne(
        { _id: existingUser._id },
        {
          $set: {
            passwordHash,
            passwordHistory: [],
            status: 'pending',
            emailVerified: false,
            isFirstLogin: true,
            'profile.firstName': sanitizedData.firstName,
            'profile.lastName': sanitizedData.lastName,
            'profile.lecturerId': lecturerId,
            'profile.department': sanitizedData.department,
            'profile.title': sanitizedData.title,
            'profile.specialization': sanitizedData.specialization,
            'profile.avatar': `${sanitizedData.firstName.charAt(0)}${sanitizedData.lastName.charAt(0)}`.toUpperCase(),
            updatedAt: new Date(),
          },
          $unset: { 'profile.role': '' },
        },
      );

      await storeActivationOtp(
        otpCollection,
        sanitizedData.email,
        adminUser.institutionId,
        verificationToken,
      );

      try {
        await sendLecturerActivationEmail(
          sanitizedData.email,
          sanitizedData.firstName,
          sanitizedData.lastName,
          lecturerId,
          defaultPassword,
          verificationToken,
          institution.name,
          sanitizedData.title,
          sanitizedData.department,
        );
      } catch (emailError: any) {
        console.error('❌ Failed to resend lecturer activation email:', emailError.message);
        return c.json({
          error: 'Failed to send activation email. Please try again or contact support.',
          details: config.isDevelopment ? emailError.message : undefined,
        }, 500);
      }

      writeAuditEvent({
        institutionId: adminUser.institutionId,
        action: 'user.lecturer.activation_reissued',
        actor: actorFromAuthUser(authUser, c.req.raw),
        target: targetUser(existingUser),
        outcome: 'success',
        metadata: { lecturerId, reason: 'pending_unverified_recreate' },
      });

      const response: any = {
        message: 'Activation email resent. The previous link is no longer valid.',
        reissued: true,
        lecturer: {
          id: existingUser._id,
          email: sanitizedData.email,
          lecturerId,
          firstName: sanitizedData.firstName,
          lastName: sanitizedData.lastName,
          department: sanitizedData.department,
          title: sanitizedData.title,
          specialization: sanitizedData.specialization,
          status: 'pending',
        },
      };
      if (config.security.returnPasswordInResponse) {
        response.lecturer.defaultPassword = defaultPassword;
      }
      return c.json(response, 200);
    }

    const lecturerId = generateLecturerId(institution.code);

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
        title: sanitizedData.title,
        specialization: sanitizedData.specialization,
        avatar: `${sanitizedData.firstName.charAt(0)}${sanitizedData.lastName.charAt(0)}`.toUpperCase(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await usersCollection.insertOne(newLecturer);

    writeAuditEvent({
      institutionId: adminUser.institutionId,
      action: 'user.lecturer.created',
      actor: actorFromAuthUser(authUser, c.req.raw),
      target: targetUser({ ...newLecturer, _id: result.insertedId }),
      outcome: 'success',
      metadata: {
        lecturerId,
        department: sanitizedData.department,
        title: sanitizedData.title,
      },
    });

    // Store verification token
    await storeActivationOtp(
      otpCollection,
      sanitizedData.email,
      adminUser.institutionId,
      verificationToken,
    );

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
        sanitizedData.title,
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
        title: sanitizedData.title,
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
    try {
      const authUser = c.get('user');
      writeAuditEvent({
        institutionId: authUser?.institutionId ? new ObjectId(authUser.institutionId) : undefined,
        action: 'user.lecturer.created',
        actor: actorFromAuthUser(authUser, c.req.raw),
        outcome: 'failure',
        errorMessage: error?.message || 'unknown error',
      });
    } catch {}
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
        title: getLecturerTitle(lecturer.profile),
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

/** Remove a student or lecturer and their institution-scoped related records. */
async function deleteInstitutionUser(
  c: Context,
  userType: 'student' | 'lecturer',
  userIdParam: string,
) {
  const authUser = c.get('user');
  if (authUser.userType !== 'admin') {
    return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
  }

  if (!ObjectId.isValid(userIdParam)) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  const userId = new ObjectId(userIdParam);
  const institutionId = new ObjectId(authUser.institutionId);
  const usersCollection = getUsersCollection();

  const target = await usersCollection.findOne({
    _id: userId,
    institutionId,
    userType,
  });

  if (!target) {
    const label = userType === 'student' ? 'Student' : 'Lecturer';
    return c.json({ error: `${label} not found` }, 404);
  }

  const userIdStr = target._id!.toString();
  const db = getDatabase();

  const cleanup: Promise<unknown>[] = [
    usersCollection.deleteOne({ _id: userId }),
    getOTPCollection().deleteMany({ email: target.email }),
    invalidateAuthCache(userIdStr),
  ];

  if (userType === 'student') {
    cleanup.push(
      getEnrollmentsCollection().deleteMany({ studentId: userId }),
      getAttendanceCollection().deleteMany({ studentId: userId }),
      db.collection('session_presence').deleteMany({ studentId: userId }),
      db.collection('assignment_submissions').deleteMany({ studentId: userIdStr }),
      db.collection('quiz_attempts').deleteMany({ studentId: userIdStr }),
    );
  } else {
    cleanup.push(
      db.collection('courses').updateMany(
        { institutionId, lecturerIds: userIdStr },
        { $pull: { lecturerIds: userIdStr } },
      ),
      db.collection('schedules').deleteMany({ lecturerId: userIdStr }),
    );
  }

  await Promise.all(cleanup);

  writeAuditEvent({
    institutionId,
    action: userType === 'student' ? 'user.student.deleted' : 'user.lecturer.deleted',
    actor: actorFromAuthUser(authUser, c.req.raw),
    target: targetUser(target),
    outcome: 'success',
  });

  const label = userType === 'student' ? 'Student' : 'Lecturer';
  return c.json({ message: `${label} deleted successfully` });
}

// Delete student account (admin only, same institution)
admin.delete('/students/:id', authMiddleware, async (c) => {
  try {
    return await deleteInstitutionUser(c, 'student', c.req.param('id'));
  } catch (error: any) {
    console.error('Delete student error:', error.message);
    return c.json({ error: 'Failed to delete student' }, 500);
  }
});

// Delete lecturer account (admin only, same institution)
admin.delete('/lecturers/:id', authMiddleware, async (c) => {
  try {
    return await deleteInstitutionUser(c, 'lecturer', c.req.param('id'));
  } catch (error: any) {
    console.error('Delete lecturer error:', error.message);
    return c.json({ error: 'Failed to delete lecturer' }, 500);
  }
});

// Audit logs (admin only) — paginated, institution-scoped.
admin.get('/audit-logs', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Access denied. Admin privileges required.' }, 403);
    }

    const page = Math.max(1, Number(c.req.query('page') || 1));
    const limit = Math.min(100, Math.max(10, Number(c.req.query('limit') || 25)));
    const skip = (page - 1) * limit;

    const action = (c.req.query('action') || '').trim();
    const actorUserId = (c.req.query('actorUserId') || '').trim();

    const institutionId = new ObjectId(authUser.institutionId);
    const filter: Record<string, unknown> = { institutionId };
    if (action) filter.action = action;
    if (actorUserId) filter['actor.userId'] = actorUserId;

    const db = getDatabase();
    const col = db.collection('audit_logs');
    const [items, total] = await Promise.all([
      col.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).toArray(),
      col.countDocuments(filter),
    ]);

    return c.json({
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: skip + items.length < total,
      },
    });
  } catch (error: any) {
    console.error('Get audit logs error:', error.message);
    return c.json({ error: 'Failed to fetch audit logs' }, 500);
  }
});

export default admin;
