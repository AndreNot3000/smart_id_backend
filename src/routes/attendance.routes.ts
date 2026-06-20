import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import {
  getDatabase,
  getUsersCollection,
  getEnrollmentsCollection,
  getSessionsCollection,
  getSessionPresenceCollection,
  getAttendanceCollection,
} from '../database/connection.js';
import { sanitizeString } from '../utils/sanitize.js';
import { formatLecturerName } from '../utils/profile.js';
import type {
  AttendanceSession,
  AttendanceSessionType,
  AttendanceSessionStatus,
  AttendancePresence,
} from '../models/session.model.js';

const attendance = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the calling user's Mongo `_id` and useful profile bits. Email is
 * stable on the JWT, so we go by email. We deliberately don't cache because
 * the auth middleware already does that with TTL.
 */
async function loadCallingUser(email: string) {
  const usersCol = getUsersCollection();
  return usersCol.findOne(
    { email },
    {
      projection: {
        email: 1,
        userType: 1,
        institutionId: 1,
        'profile.firstName': 1,
        'profile.lastName': 1,
        'profile.title': 1,
        'profile.role': 1,
        'profile.department': 1,
        'profile.lecturerId': 1,
      },
    }
  );
}

/**
 * Resolve a course (string `_id`) and confirm it lives in the caller's
 * institution. Returns null if not found / not authorised.
 */
async function loadCourse(courseId: string, institutionId: string) {
  if (!ObjectId.isValid(courseId)) return null;
  const db = getDatabase();
  return db.collection('courses').findOne({
    _id: new ObjectId(courseId),
    institutionId,
  });
}

/**
 * Lecturers can act on a course only when they're listed in `lecturerIds`.
 * Admins are unconditionally allowed.
 */
function canManageCourse(
  user: { userType: string },
  course: { lecturerIds?: string[] },
  callerObjectId: string
): boolean {
  if (user.userType === 'admin') return true;
  if (user.userType !== 'lecturer') return false;
  return (course.lecturerIds || []).includes(callerObjectId);
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createSessionSchema = z.object({
  courseId: z.string().min(1),
  type: z.enum(['class', 'test', 'exam']),
  title: z.string().min(1).max(160),
  location: z.string().min(1).max(120),
  scheduledAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  notes: z.string().max(1000).optional(),
  autoStart: z.boolean().optional(),
});

const updateSessionSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  location: z.string().min(1).max(120).optional(),
  scheduledAt: z.string().datetime().optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  notes: z.string().max(1000).optional(),
});

const markSchema = z.object({
  studentId: z.string().min(1),       // Mongo `_id`
  presence: z.enum(['present', 'absent', 'late', 'excused']),
  note: z.string().max(500).optional(),
});

// ===========================================================================
// LOCATIONS  (predefined room names per institution)
// ===========================================================================

/**
 * GET /api/attendance/locations
 * Returns the institution-wide list of room names lecturers can pick from.
 * Falls back to a curated default so a fresh install isn't empty.
 */
attendance.get('/locations', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const db = getDatabase();
    const row = await db.collection('attendance_locations').findOne({
      institutionId: user.institutionId,
    });

    const locations: string[] = Array.isArray(row?.locations) && row!.locations.length
      ? row!.locations
      : [
          'Lecture Theatre 1',
          'Lecture Theatre 2',
          'Auditorium',
          'Lab A',
          'Lab B',
          'Seminar Room 1',
          'Seminar Room 2',
        ];

    return c.json({ locations });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch locations', details: error.message }, 500);
  }
});

/**
 * PUT /api/attendance/locations
 * Admin replaces the institution's room list.
 */
attendance.put('/locations', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'admin') return c.json({ error: 'Only admins' }, 403);

    const body = await c.req.json();
    const raw = Array.isArray(body?.locations) ? body.locations : [];
    const locations = Array.from(
      new Set(
        raw
          .map((s: any) => (typeof s === 'string' ? sanitizeString(s).slice(0, 120) : ''))
          .filter((s: string) => s.length > 0)
      )
    );

    const db = getDatabase();
    await db.collection('attendance_locations').updateOne(
      { institutionId: user.institutionId },
      { $set: { institutionId: user.institutionId, locations, updatedAt: new Date() } },
      { upsert: true }
    );

    return c.json({ message: 'Locations saved', locations });
  } catch (error: any) {
    return c.json({ error: 'Failed to save locations', details: error.message }, 500);
  }
});

// ===========================================================================
// SESSIONS
// ===========================================================================

/**
 * POST /api/attendance/sessions
 * Create a session for a course. Lecturer must own the course; admin always allowed.
 * The roster is snapshotted at create time so adding students afterwards
 * doesn't retroactively mark them absent.
 */
attendance.post('/sessions', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') {
      return c.json({ error: 'Students cannot create attendance sessions' }, 403);
    }

    const body = await c.req.json();
    const parsed = createSessionSchema.parse(body);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);

    const course = await loadCourse(parsed.courseId, user.institutionId);
    if (!course) return c.json({ error: 'Course not found' }, 404);

    if (!canManageCourse(user, course as any, caller._id.toString())) {
      return c.json({ error: 'You are not assigned to this course' }, 403);
    }

    const enrollmentsCol = getEnrollmentsCollection();
    const activeEnrollments = await enrollmentsCol
      .find({ courseId: new ObjectId(parsed.courseId), status: 'active' })
      .project({ studentId: 1 })
      .toArray();
    const rosterSnapshot = activeEnrollments.map(e => (e as any).studentId.toString());

    const now = new Date();
    const scheduledAt = parsed.scheduledAt ? new Date(parsed.scheduledAt) : now;
    const willAutoStart = parsed.autoStart !== false; // default true

    const session: AttendanceSession = {
      courseId: new ObjectId(parsed.courseId),
      courseCode: (course as any).courseCode,
      courseName: (course as any).courseName,
      lecturerId: caller._id,
      institutionId: user.institutionId,
      type: parsed.type as AttendanceSessionType,
      title: sanitizeString(parsed.title),
      location: sanitizeString(parsed.location),
      scheduledAt,
      durationMinutes: parsed.durationMinutes,
      status: willAutoStart ? 'active' : 'scheduled',
      startedAt: willAutoStart ? now : undefined,
      rosterSnapshot,
      expectedCount: rosterSnapshot.length,
      presentCount: 0,
      notes: parsed.notes ? sanitizeString(parsed.notes) : undefined,
      createdAt: now,
      updatedAt: now,
    };

    const sessionsCol = getSessionsCollection();
    const result = await sessionsCol.insertOne(session);

    return c.json(
      {
        message: 'Session created',
        session: { _id: result.insertedId.toString(), ...session },
      },
      201
    );
  } catch (error: any) {
    if (error?.issues) return c.json({ error: 'Validation failed', issues: error.issues }, 400);
    return c.json({ error: 'Failed to create session', details: error.message }, 500);
  }
});

/**
 * GET /api/attendance/sessions
 * List sessions. Lecturers see only their own; admins see institution-wide.
 * Filters: courseId, status, from (ISO), to (ISO), type
 */
attendance.get('/sessions', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') {
      return c.json({ error: 'Students cannot view sessions' }, 403);
    }

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);

    const q: any = { institutionId: user.institutionId };
    if (user.userType === 'lecturer') q.lecturerId = caller._id;

    const courseId = c.req.query('courseId');
    if (courseId && ObjectId.isValid(courseId)) q.courseId = new ObjectId(courseId);

    const status = c.req.query('status') as AttendanceSessionStatus | undefined;
    if (status) q.status = status;

    const type = c.req.query('type');
    if (type) q.type = type;

    const from = c.req.query('from');
    const to = c.req.query('to');
    if (from || to) {
      q.scheduledAt = {};
      if (from) q.scheduledAt.$gte = new Date(from);
      if (to) q.scheduledAt.$lte = new Date(to);
    }

    const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);

    const sessionsCol = getSessionsCollection();
    const sessions = await sessionsCol
      .find(q)
      .sort({ scheduledAt: -1, createdAt: -1 })
      .limit(limit)
      .toArray();

    // Enrich with department (from course) and lecturer name so the admin view
    // can be organised by department without extra round-trips.
    const db = getDatabase();
    const courseIds = Array.from(new Set(sessions.map(s => s.courseId.toString()))).map(id => new ObjectId(id));
    const lecturerIds = Array.from(new Set(sessions.map(s => s.lecturerId.toString()))).map(id => new ObjectId(id));

    const [courseDocs, lecturerDocs] = await Promise.all([
      courseIds.length
        ? db.collection('courses').find({ _id: { $in: courseIds } }).project({ department: 1 }).toArray()
        : Promise.resolve([] as any[]),
      lecturerIds.length
        ? getUsersCollection().find({ _id: { $in: lecturerIds } }, { projection: { 'profile.firstName': 1, 'profile.lastName': 1, 'profile.title': 1, 'profile.role': 1 } }).toArray()
        : Promise.resolve([] as any[]),
    ]);
    const deptByCourse = new Map(courseDocs.map((c: any) => [c._id.toString(), c.department || '']));
    const nameByLecturer = new Map(
      lecturerDocs.map((l: any) => [
        l._id.toString(),
        formatLecturerName(l.profile),
      ])
    );

    return c.json({
      sessions: sessions.map(s => ({
        ...s,
        _id: s._id?.toString(),
        courseId: s.courseId.toString(),
        lecturerId: s.lecturerId.toString(),
        department: deptByCourse.get(s.courseId.toString()) || 'Unassigned',
        lecturerName: nameByLecturer.get(s.lecturerId.toString()) || '',
      })),
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch sessions', details: error.message }, 500);
  }
});

/**
 * GET /api/attendance/sessions/:id
 * Session details with the present/absent breakdown rendered for the UI.
 */
attendance.get('/sessions/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Students cannot view sessions' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid session ID' }, 400);

    const sessionsCol = getSessionsCollection();
    const session = await sessionsCol.findOne({
      _id: new ObjectId(id),
      institutionId: user.institutionId,
    });
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);
    if (user.userType === 'lecturer' && !session.lecturerId.equals(caller._id)) {
      return c.json({ error: 'Not your session' }, 403);
    }

    // Pull the roster students AND existing presence rows in parallel.
    const rosterIds = (session.rosterSnapshot || []).map(s => new ObjectId(s));
    const usersCol = getUsersCollection();
    const presenceCol = getSessionPresenceCollection();

    const [students, presenceRows] = await Promise.all([
      rosterIds.length
        ? usersCol
            .find(
              { _id: { $in: rosterIds } },
              {
                projection: {
                  email: 1,
                  'profile.firstName': 1,
                  'profile.lastName': 1,
                  'profile.studentId': 1,
                  'profile.avatar': 1,
                  'profile.department': 1,
                  'profile.year': 1,
                },
              }
            )
            .toArray()
        : Promise.resolve([] as any[]),
      presenceCol.find({ sessionId: session._id! }).toArray(),
    ]);

    const presenceMap = new Map<string, (typeof presenceRows)[number]>();
    for (const p of presenceRows) presenceMap.set(p.studentId.toString(), p);

    const roster = students
      .map(s => {
        const sid = s._id.toString();
        const rec = presenceMap.get(sid);
        return {
          studentId: sid,
          studentNumber: s.profile?.studentId || '',
          name: `${s.profile?.firstName || ''} ${s.profile?.lastName || ''}`.trim(),
          email: s.email,
          avatar: s.profile?.avatar || null,
          department: s.profile?.department || '',
          year: s.profile?.year || '',
          presence: (rec?.presence || 'absent') as AttendancePresence,
          source: rec?.source || null,
          markedAt: rec?.markedAt || null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return c.json({
      session: {
        ...session,
        _id: session._id?.toString(),
        courseId: session.courseId.toString(),
        lecturerId: session.lecturerId.toString(),
      },
      roster,
      stats: {
        expected: session.expectedCount,
        present: roster.filter(r => r.presence === 'present').length,
        late: roster.filter(r => r.presence === 'late').length,
        absent: roster.filter(r => r.presence === 'absent').length,
        excused: roster.filter(r => r.presence === 'excused').length,
      },
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch session', details: error.message }, 500);
  }
});

/**
 * POST /api/attendance/sessions/:id/start
 * Move a scheduled session into 'active'. Re-snapshots the roster so any
 * enrollments added between scheduling and starting are picked up.
 */
attendance.post('/sessions/:id/start', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid session ID' }, 400);

    const sessionsCol = getSessionsCollection();
    const session = await sessionsCol.findOne({
      _id: new ObjectId(id),
      institutionId: user.institutionId,
    });
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);
    if (user.userType === 'lecturer' && !session.lecturerId.equals(caller._id)) {
      return c.json({ error: 'Not your session' }, 403);
    }

    if (session.status === 'closed' || session.status === 'cancelled') {
      return c.json({ error: 'Session already ended' }, 409);
    }

    const enrollmentsCol = getEnrollmentsCollection();
    const active = await enrollmentsCol
      .find({ courseId: session.courseId, status: 'active' })
      .project({ studentId: 1 })
      .toArray();
    const rosterSnapshot = active.map(e => (e as any).studentId.toString());

    await sessionsCol.updateOne(
      { _id: session._id },
      {
        $set: {
          status: 'active',
          startedAt: session.startedAt ?? new Date(),
          rosterSnapshot,
          expectedCount: rosterSnapshot.length,
          updatedAt: new Date(),
        },
      }
    );

    return c.json({ message: 'Session started', expectedCount: rosterSnapshot.length });
  } catch (error: any) {
    return c.json({ error: 'Failed to start session', details: error.message }, 500);
  }
});

/**
 * POST /api/attendance/sessions/:id/close
 * Ends the scanning window. presentCount is already accurate; we just stamp
 * endedAt and recompute from presence rows for safety.
 */
attendance.post('/sessions/:id/close', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid session ID' }, 400);

    const sessionsCol = getSessionsCollection();
    const session = await sessionsCol.findOne({
      _id: new ObjectId(id),
      institutionId: user.institutionId,
    });
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);
    if (user.userType === 'lecturer' && !session.lecturerId.equals(caller._id)) {
      return c.json({ error: 'Not your session' }, 403);
    }

    const presenceCol = getSessionPresenceCollection();
    const presentCount = await presenceCol.countDocuments({
      sessionId: session._id!,
      presence: { $in: ['present', 'late'] },
    });

    await sessionsCol.updateOne(
      { _id: session._id },
      {
        $set: {
          status: 'closed',
          endedAt: new Date(),
          presentCount,
          updatedAt: new Date(),
        },
      }
    );

    return c.json({ message: 'Session closed', presentCount });
  } catch (error: any) {
    return c.json({ error: 'Failed to close session', details: error.message }, 500);
  }
});

/**
 * PUT /api/attendance/sessions/:id
 * Edit metadata. Only scheduled sessions can be edited (active sessions are
 * locked to prevent confusion mid-attendance).
 */
attendance.put('/sessions/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid session ID' }, 400);

    const body = await c.req.json();
    const parsed = updateSessionSchema.parse(body);

    const sessionsCol = getSessionsCollection();
    const session = await sessionsCol.findOne({
      _id: new ObjectId(id),
      institutionId: user.institutionId,
    });
    if (!session) return c.json({ error: 'Session not found' }, 404);

    if (session.status !== 'scheduled') {
      return c.json({ error: 'Only scheduled sessions can be edited' }, 409);
    }

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);
    if (user.userType === 'lecturer' && !session.lecturerId.equals(caller._id)) {
      return c.json({ error: 'Not your session' }, 403);
    }

    const update: any = { updatedAt: new Date() };
    if (parsed.title) update.title = sanitizeString(parsed.title);
    if (parsed.location) update.location = sanitizeString(parsed.location);
    if (parsed.scheduledAt) update.scheduledAt = new Date(parsed.scheduledAt);
    if (parsed.durationMinutes !== undefined) update.durationMinutes = parsed.durationMinutes;
    if (parsed.notes !== undefined) update.notes = sanitizeString(parsed.notes);

    await sessionsCol.updateOne({ _id: session._id }, { $set: update });
    return c.json({ message: 'Session updated' });
  } catch (error: any) {
    if (error?.issues) return c.json({ error: 'Validation failed', issues: error.issues }, 400);
    return c.json({ error: 'Failed to update session', details: error.message }, 500);
  }
});

/**
 * DELETE /api/attendance/sessions/:id
 * Wipes the session and all linked presence rows. Raw scan logs in the
 * `attendance` collection stay (audit trail), but their sessionId pointers
 * become orphans — acceptable since we filter by session existence anyway.
 */
attendance.delete('/sessions/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid session ID' }, 400);

    const sessionsCol = getSessionsCollection();
    const session = await sessionsCol.findOne({
      _id: new ObjectId(id),
      institutionId: user.institutionId,
    });
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);
    if (user.userType === 'lecturer' && !session.lecturerId.equals(caller._id)) {
      return c.json({ error: 'Not your session' }, 403);
    }

    const presenceCol = getSessionPresenceCollection();
    await Promise.all([
      sessionsCol.deleteOne({ _id: session._id }),
      presenceCol.deleteMany({ sessionId: session._id! }),
    ]);

    return c.json({ message: 'Session deleted' });
  } catch (error: any) {
    return c.json({ error: 'Failed to delete session', details: error.message }, 500);
  }
});

/**
 * POST /api/attendance/sessions/:id/mark
 * Manually mark a single student. Upserts presence; if the student wasn't on
 * the snapshot (i.e. dropped/added after the session started) we still allow
 * it but flag the row so the UI can show "added late".
 */
attendance.post('/sessions/:id/mark', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid session ID' }, 400);

    const body = await c.req.json();
    const parsed = markSchema.parse(body);
    if (!ObjectId.isValid(parsed.studentId)) {
      return c.json({ error: 'Invalid student ID' }, 400);
    }

    const sessionsCol = getSessionsCollection();
    const session = await sessionsCol.findOne({
      _id: new ObjectId(id),
      institutionId: user.institutionId,
    });
    if (!session) return c.json({ error: 'Session not found' }, 404);
    if (session.status === 'cancelled') return c.json({ error: 'Session cancelled' }, 409);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);
    if (user.userType === 'lecturer' && !session.lecturerId.equals(caller._id)) {
      return c.json({ error: 'Not your session' }, 403);
    }

    const studentObjId = new ObjectId(parsed.studentId);
    const presenceCol = getSessionPresenceCollection();
    const now = new Date();

    await presenceCol.updateOne(
      { sessionId: session._id!, studentId: studentObjId },
      {
        $set: {
          presence: parsed.presence as AttendancePresence,
          source: 'manual',
          markedBy: caller._id,
          markedAt: now,
        },
        $setOnInsert: {
          sessionId: session._id!,
          studentId: studentObjId,
          institutionId: user.institutionId,
        },
      },
      { upsert: true }
    );

    // Keep session.presentCount fresh for the dashboard.
    const presentCount = await presenceCol.countDocuments({
      sessionId: session._id!,
      presence: { $in: ['present', 'late'] },
    });
    await sessionsCol.updateOne(
      { _id: session._id },
      { $set: { presentCount, updatedAt: now } }
    );

    return c.json({ message: 'Marked', presence: parsed.presence, presentCount });
  } catch (error: any) {
    if (error?.issues) return c.json({ error: 'Validation failed', issues: error.issues }, 400);
    return c.json({ error: 'Failed to mark', details: error.message }, 500);
  }
});

/**
 * POST /api/attendance/sessions/:id/mark-absent-rest
 * Convenience: mark every roster student without a presence row as absent.
 * Useful at the end of a class for one-tap finalisation.
 */
attendance.post('/sessions/:id/mark-absent-rest', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid session ID' }, 400);

    const sessionsCol = getSessionsCollection();
    const session = await sessionsCol.findOne({
      _id: new ObjectId(id),
      institutionId: user.institutionId,
    });
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);
    if (user.userType === 'lecturer' && !session.lecturerId.equals(caller._id)) {
      return c.json({ error: 'Not your session' }, 403);
    }

    const presenceCol = getSessionPresenceCollection();
    const existing = await presenceCol
      .find({ sessionId: session._id! })
      .project({ studentId: 1 })
      .toArray();
    const markedIds = new Set(existing.map(e => (e as any).studentId.toString()));

    const now = new Date();
    const docs = (session.rosterSnapshot || [])
      .filter(sid => !markedIds.has(sid))
      .map(sid => ({
        sessionId: session._id!,
        studentId: new ObjectId(sid),
        institutionId: user.institutionId,
        presence: 'absent' as AttendancePresence,
        source: 'manual' as const,
        markedBy: caller._id,
        markedAt: now,
      }));

    if (docs.length) await presenceCol.insertMany(docs);

    return c.json({ message: 'Done', markedAbsent: docs.length });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// ===========================================================================
// ANALYTICS  (for charts)
// ===========================================================================

/**
 * GET /api/attendance/analytics
 * Returns enough data to drive the lecturer/admin dashboard charts.
 * Query: courseId? days? (default 30)
 */
attendance.get('/analytics', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);

    const days = Math.min(parseInt(c.req.query('days') || '30'), 365);
    const courseIdQ = c.req.query('courseId');

    const since = new Date();
    since.setDate(since.getDate() - days);

    const match: any = {
      institutionId: user.institutionId,
      scheduledAt: { $gte: since },
      status: { $in: ['active', 'closed'] },
    };
    if (user.userType === 'lecturer') match.lecturerId = caller._id;
    if (courseIdQ && ObjectId.isValid(courseIdQ)) match.courseId = new ObjectId(courseIdQ);

    const sessionsCol = getSessionsCollection();
    const sessions = await sessionsCol
      .find(match)
      .project({
        _id: 1,
        scheduledAt: 1,
        type: 1,
        courseId: 1,
        courseCode: 1,
        courseName: 1,
        expectedCount: 1,
        presentCount: 1,
      })
      .toArray();

    // Daily series: bucket by YYYY-MM-DD
    const byDay = new Map<string, { date: string; sessions: number; expected: number; present: number }>();
    for (let i = 0; i <= days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      byDay.set(key, { date: key, sessions: 0, expected: 0, present: 0 });
    }
    for (const s of sessions) {
      const key = new Date((s as any).scheduledAt).toISOString().slice(0, 10);
      const bucket = byDay.get(key);
      if (!bucket) continue;
      bucket.sessions += 1;
      bucket.expected += (s as any).expectedCount || 0;
      bucket.present += (s as any).presentCount || 0;
    }
    const daily = Array.from(byDay.values()).map(b => ({
      ...b,
      rate: b.expected > 0 ? Math.round((b.present / b.expected) * 100) : 0,
    }));

    // By course
    const byCourse = new Map<string, { courseId: string; courseCode: string; courseName: string; sessions: number; expected: number; present: number }>();
    for (const s of sessions) {
      const cid = (s as any).courseId.toString();
      const existing = byCourse.get(cid) || {
        courseId: cid,
        courseCode: (s as any).courseCode,
        courseName: (s as any).courseName,
        sessions: 0,
        expected: 0,
        present: 0,
      };
      existing.sessions += 1;
      existing.expected += (s as any).expectedCount || 0;
      existing.present += (s as any).presentCount || 0;
      byCourse.set(cid, existing);
    }
    const courses = Array.from(byCourse.values())
      .map(c => ({ ...c, rate: c.expected > 0 ? Math.round((c.present / c.expected) * 100) : 0 }))
      .sort((a, b) => b.sessions - a.sessions);

    // By type
    const byType: Record<string, { type: string; sessions: number; expected: number; present: number }> = {
      class: { type: 'class', sessions: 0, expected: 0, present: 0 },
      test: { type: 'test', sessions: 0, expected: 0, present: 0 },
      exam: { type: 'exam', sessions: 0, expected: 0, present: 0 },
    };
    for (const s of sessions) {
      const t = (s as any).type as string;
      if (!byType[t]) continue;
      byType[t].sessions += 1;
      byType[t].expected += (s as any).expectedCount || 0;
      byType[t].present += (s as any).presentCount || 0;
    }
    const types = Object.values(byType).map(t => ({
      ...t,
      rate: t.expected > 0 ? Math.round((t.present / t.expected) * 100) : 0,
    }));

    // Totals
    const totals = {
      sessions: sessions.length,
      expected: sessions.reduce((acc, s) => acc + ((s as any).expectedCount || 0), 0),
      present: sessions.reduce((acc, s) => acc + ((s as any).presentCount || 0), 0),
    };
    const overallRate = totals.expected ? Math.round((totals.present / totals.expected) * 100) : 0;

    return c.json({
      window: { days, from: since.toISOString() },
      totals: { ...totals, rate: overallRate },
      daily,
      courses,
      types,
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to load analytics', details: error.message }, 500);
  }
});

/**
 * GET /api/attendance/at-risk
 * Students whose attendance rate over the window is below `threshold`%.
 * Lecturers: scoped to their courses. Admins: institution-wide.
 */
attendance.get('/at-risk', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);

    const days = Math.min(parseInt(c.req.query('days') || '30'), 365);
    const threshold = Math.min(Math.max(parseInt(c.req.query('threshold') || '60'), 0), 100);
    const courseIdQ = c.req.query('courseId');
    const since = new Date();
    since.setDate(since.getDate() - days);

    const sessionsCol = getSessionsCollection();
    const sessionMatch: any = {
      institutionId: user.institutionId,
      scheduledAt: { $gte: since },
      status: { $in: ['active', 'closed'] },
    };
    if (user.userType === 'lecturer') sessionMatch.lecturerId = caller._id;
    if (courseIdQ && ObjectId.isValid(courseIdQ)) sessionMatch.courseId = new ObjectId(courseIdQ);

    const sessions = await sessionsCol
      .find(sessionMatch)
      .project({ _id: 1, rosterSnapshot: 1 })
      .toArray();

    if (sessions.length === 0) {
      return c.json({ atRisk: [], threshold, days, totalSessions: 0 });
    }

    // expected per student = number of sessions in which they were on roster
    const expectedByStudent = new Map<string, number>();
    const sessionIds: ObjectId[] = [];
    for (const s of sessions) {
      sessionIds.push((s as any)._id);
      for (const sid of (s as any).rosterSnapshot || []) {
        expectedByStudent.set(sid, (expectedByStudent.get(sid) || 0) + 1);
      }
    }

    const presenceCol = getSessionPresenceCollection();
    const presenceRows = await presenceCol
      .find({ sessionId: { $in: sessionIds }, presence: { $in: ['present', 'late'] } })
      .project({ studentId: 1 })
      .toArray();
    const presentByStudent = new Map<string, number>();
    for (const p of presenceRows) {
      const sid = (p as any).studentId.toString();
      presentByStudent.set(sid, (presentByStudent.get(sid) || 0) + 1);
    }

    const atRiskRaw = [];
    for (const [sid, expected] of expectedByStudent) {
      const present = presentByStudent.get(sid) || 0;
      const rate = Math.round((present / expected) * 100);
      if (rate < threshold) atRiskRaw.push({ studentId: sid, expected, present, rate });
    }

    // Hydrate with names
    const usersCol = getUsersCollection();
    const ids = atRiskRaw.map(r => new ObjectId(r.studentId));
    const students = ids.length
      ? await usersCol
          .find(
            { _id: { $in: ids } },
            {
              projection: {
                email: 1,
                'profile.firstName': 1,
                'profile.lastName': 1,
                'profile.studentId': 1,
                'profile.department': 1,
                'profile.year': 1,
                'profile.avatar': 1,
              },
            }
          )
          .toArray()
      : [];
    const studentMap = new Map(students.map(s => [s._id.toString(), s]));

    const atRisk = atRiskRaw
      .map(r => {
        const s = studentMap.get(r.studentId);
        if (!s) return null;
        return {
          ...r,
          name: `${s.profile?.firstName || ''} ${s.profile?.lastName || ''}`.trim(),
          studentNumber: s.profile?.studentId || '',
          email: s.email,
          department: s.profile?.department || '',
          year: s.profile?.year || '',
          avatar: s.profile?.avatar || null,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => a.rate - b.rate);

    return c.json({ atRisk, threshold, days, totalSessions: sessions.length });
  } catch (error: any) {
    return c.json({ error: 'Failed to load at-risk students', details: error.message }, 500);
  }
});

/**
 * GET /api/attendance/sessions/:id/export
 * CSV download. Roster + presence + timestamps. Useful for grade books and
 * paper trails.
 */
attendance.get('/sessions/:id/export', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid session ID' }, 400);

    const sessionsCol = getSessionsCollection();
    const session = await sessionsCol.findOne({
      _id: new ObjectId(id),
      institutionId: user.institutionId,
    });
    if (!session) return c.json({ error: 'Session not found' }, 404);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);
    if (user.userType === 'lecturer' && !session.lecturerId.equals(caller._id)) {
      return c.json({ error: 'Not your session' }, 403);
    }

    const rosterIds = (session.rosterSnapshot || []).map(s => new ObjectId(s));
    const usersCol = getUsersCollection();
    const presenceCol = getSessionPresenceCollection();
    const [students, rows] = await Promise.all([
      rosterIds.length
        ? usersCol
            .find(
              { _id: { $in: rosterIds } },
              {
                projection: {
                  email: 1,
                  'profile.firstName': 1,
                  'profile.lastName': 1,
                  'profile.studentId': 1,
                },
              }
            )
            .toArray()
        : Promise.resolve([] as any[]),
      presenceCol.find({ sessionId: session._id! }).toArray(),
    ]);

    const presenceMap = new Map<string, (typeof rows)[number]>();
    for (const r of rows) presenceMap.set(r.studentId.toString(), r);

    const lines: string[] = [];
    lines.push('Student ID,Name,Email,Presence,Source,Marked At');
    for (const s of students) {
      const rec = presenceMap.get(s._id.toString());
      const name = `${s.profile?.firstName || ''} ${s.profile?.lastName || ''}`.trim();
      const presence = rec?.presence || 'absent';
      const src = rec?.source || '';
      const markedAt = rec?.markedAt ? new Date(rec.markedAt).toISOString() : '';
      const csv = [
        s.profile?.studentId || '',
        name.replace(/,/g, ' '),
        s.email,
        presence,
        src,
        markedAt,
      ]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
      lines.push(csv);
    }

    const body = lines.join('\n');
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="attendance-${session.courseCode}-${new Date(session.scheduledAt).toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to export', details: error.message }, 500);
  }
});

/**
 * GET /api/attendance/courses/:courseId/export
 * One organized CSV combining EVERY session of a course: a matrix with one row
 * per student and one column per session, plus attended/total/percentage.
 * Admins: all sessions of the course. Lecturers: only sessions they ran.
 */
attendance.get('/courses/:courseId/export', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const courseId = c.req.param('courseId');
    if (!ObjectId.isValid(courseId)) return c.json({ error: 'Invalid course ID' }, 400);

    const caller = await loadCallingUser(user.email);
    if (!caller) return c.json({ error: 'Caller not found' }, 404);

    const course = await loadCourse(courseId, user.institutionId);
    if (!course) return c.json({ error: 'Course not found' }, 404);

    // Lecturers can only export courses assigned to them.
    if (user.userType === 'lecturer' && !canManageCourse(user, course as any, caller._id.toString())) {
      return c.json({ error: 'You are not assigned to this course' }, 403);
    }

    const sessionsCol = getSessionsCollection();
    const sessionMatch: any = {
      institutionId: user.institutionId,
      courseId: new ObjectId(courseId),
      status: { $in: ['active', 'closed'] },
    };
    if (user.userType === 'lecturer') sessionMatch.lecturerId = caller._id;

    const sessions = await sessionsCol.find(sessionMatch).sort({ scheduledAt: 1 }).toArray();

    if (sessions.length === 0) {
      return c.json({ error: 'No attendance sessions to export for this course yet.' }, 404);
    }

    // Union roster across all sessions.
    const rosterIds = new Set<string>();
    for (const s of sessions) for (const sid of (s.rosterSnapshot || [])) rosterIds.add(sid);

    const usersCol = getUsersCollection();
    const presenceCol = getSessionPresenceCollection();
    const ids = Array.from(rosterIds).map(id => new ObjectId(id));
    const [students, presenceRows] = await Promise.all([
      ids.length
        ? usersCol.find(
            { _id: { $in: ids } },
            { projection: { email: 1, 'profile.firstName': 1, 'profile.lastName': 1, 'profile.studentId': 1 } }
          ).toArray()
        : Promise.resolve([] as any[]),
      presenceCol.find({ sessionId: { $in: sessions.map(s => s._id!) } }).toArray(),
    ]);

    // presence[sessionId][studentId] = presence
    const presence = new Map<string, Map<string, string>>();
    for (const r of presenceRows) {
      const sk = r.sessionId.toString();
      if (!presence.has(sk)) presence.set(sk, new Map());
      presence.get(sk)!.set(r.studentId.toString(), r.presence);
    }

    const rosterBySession = new Map<string, Set<string>>();
    for (const s of sessions) rosterBySession.set(s._id!.toString(), new Set(s.rosterSnapshot || []));

    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    // Header
    const header = ['Student ID', 'Name', 'Email'];
    for (const s of sessions) {
      const d = new Date(s.scheduledAt).toISOString().slice(0, 10);
      header.push(`${s.title} (${d})`);
    }
    header.push('Sessions on roster', 'Attended', 'Attendance %');

    const lines: string[] = [];
    // Title block for context, then the table header.
    lines.push(esc(`${(course as any).courseCode} — ${(course as any).courseName} · Attendance report · ${sessions.length} session(s)`));
    lines.push(header.map(esc).join(','));

    const sortedStudents = students.sort((a: any, b: any) => {
      const an = `${a.profile?.lastName || ''} ${a.profile?.firstName || ''}`.trim();
      const bn = `${b.profile?.lastName || ''} ${b.profile?.firstName || ''}`.trim();
      return an.localeCompare(bn);
    });

    for (const stu of sortedStudents) {
      const sid = stu._id.toString();
      const name = `${stu.profile?.firstName || ''} ${stu.profile?.lastName || ''}`.trim();
      const row: string[] = [stu.profile?.studentId || '', name, stu.email];
      let onRoster = 0;
      let attended = 0;
      for (const s of sessions) {
        const sk = s._id!.toString();
        const inRoster = rosterBySession.get(sk)?.has(sid);
        if (!inRoster) {
          row.push('-'); // wasn't on the roster for this session
          continue;
        }
        onRoster += 1;
        const p = presence.get(sk)?.get(sid) || 'absent';
        if (p === 'present' || p === 'late') attended += 1;
        row.push(p);
      }
      const pct = onRoster > 0 ? Math.round((attended / onRoster) * 100) : 0;
      row.push(String(onRoster), String(attended), `${pct}%`);
      lines.push(row.map(esc).join(','));
    }

    const body = lines.join('\n');
    const safeCode = String((course as any).courseCode || 'course').replace(/[^A-Za-z0-9]/g, '');
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="attendance-${safeCode}-all-sessions.csv"`,
      },
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to export course attendance', details: error.message }, 500);
  }
});

export default attendance;
