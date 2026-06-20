import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { getDatabase } from '../database/connection.js';
import {
  timeToMinutes,
  validateScheduleNotInPast,
  validateScheduleTimeRange,
} from '../utils/schedule-time.js';
import { formatLecturerName } from '../utils/profile.js';

const schedule = new Hono();

const VALID_LEVELS = ['100L', '200L', '300L', '400L', '500L', '600L'] as const;

async function logActivity(opts: { lecturerId: string; institutionId: string; type: string; icon: string; title: string; description: string }) {
  try {
    const db = getDatabase();
    await db.collection('lecturer_activities').insertOne({ ...opts, createdAt: new Date() });
  } catch (e) { console.error('Failed to log activity:', e); }
}
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ==================== CHANGE TRACKER ====================
// Tracks last update timestamp and details per institution+department+level
interface UpdateInfo {
  timestamp: number;
  action: string;
  courseCode?: string;
  courseName?: string;
  reason?: string;
  count?: number;
}

const lastUpdateMap: Map<string, UpdateInfo> = new Map();

function markUpdated(institutionId: string, department: string, level: string, action: string = 'updated', details: { courseCode?: string; courseName?: string; reason?: string; count?: number } = {}) {
  const key = `${institutionId}:${department}:${level}`;
  lastUpdateMap.set(key, { timestamp: Date.now(), action, ...details });
}

function getLastUpdate(institutionId: string, department: string, level: string): UpdateInfo {
  const key = `${institutionId}:${department}:${level}`;
  return lastUpdateMap.get(key) || { timestamp: 0, action: '' };
}

// ==================== HELPERS ====================

function yearToLevel(year: string): string {
  if (!year) return '';
  if (/^\d+L$/i.test(year)) return year.toUpperCase();
  const match = year.match(/Year\s*(\d+)/i);
  if (match && match[1]) return `${parseInt(match[1]) * 100}L`;
  const numMatch = year.match(/(\d+)/);
  if (numMatch && numMatch[1]) return `${parseInt(numMatch[1]) * 100}L`;
  return year;
}

function normalizeCourseCode(code: string): string {
  return (code || '').replace(/\s+/g, '').toUpperCase();
}

// Returns the course matching the given courseId/courseCode ONLY if it is
// assigned to this lecturer (their id is in the course's lecturerIds). Returns
// null when the course doesn't exist in the institution or isn't assigned to
// them — used to stop lecturers scheduling classes for courses they don't own.
async function findAssignedCourse(opts: {
  institutionId: string;
  lecturerId: string;
  courseId?: string;
  courseCode?: string;
}) {
  const db = getDatabase();
  const query: any = { institutionId: opts.institutionId };
  if (opts.courseId && ObjectId.isValid(opts.courseId)) {
    query._id = new ObjectId(opts.courseId);
  } else if (opts.courseCode) {
    query.courseCode = normalizeCourseCode(opts.courseCode);
  } else {
    return null;
  }
  const course = await db.collection('courses').findOne(query);
  if (!course) return null;
  const assigned = ((course as any).lecturerIds || []).includes(opts.lecturerId);
  return assigned ? course : null;
}

function hasTimeConflict(a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }): boolean {
  const aStart = timeToMinutes(a.startTime);
  let aEnd = timeToMinutes(a.endTime);
  if (aEnd <= aStart) aEnd += 1440; // overnight: wrap to next day

  const bStart = timeToMinutes(b.startTime);
  let bEnd = timeToMinutes(b.endTime);
  if (bEnd <= bStart) bEnd += 1440;

  return bStart < aEnd && bEnd > aStart;
}

function getWeekRange(dateStr?: string) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const start = new Date(d);
  start.setDate(diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function getMonthRange(dateStr?: string) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

// ==================== POLLING ENDPOINT ====================

// Students poll this to check if schedule has been updated
schedule.get('/student/updates', authMiddleware, async (c) => {
  const user = c.get('user');
  if (user.userType !== 'student') return c.json({ error: 'Only students' }, 403);

  const since = parseInt(c.req.query('since') || '0');

  const db = getDatabase();
  const student = await db.collection('users').findOne({ email: user.email });
  if (!student?.profile?.department || !student?.profile?.year) {
    return c.json({ error: 'Student profile incomplete' }, 404);
  }

  const lastUpdate = getLastUpdate(
    student.institutionId?.toString() || '',
    student.profile.department,
    yearToLevel(student.profile.year)
  );

  return c.json({
    updated: lastUpdate.timestamp > since,
    timestamp: lastUpdate.timestamp,
    action: lastUpdate.action,
    courseCode: lastUpdate.courseCode,
    courseName: lastUpdate.courseName,
    reason: lastUpdate.reason,
    count: lastUpdate.count
  });
});

// ==================== LECTURER ENDPOINTS ====================

schedule.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can create schedule entries' }, 403);

    const body = await c.req.json();
    const { courseCode, courseName, startTime, endTime, venue, level, date, dates, recurring } = body;

    if (!courseCode || !courseName || !startTime || !endTime || !venue || !level) {
      return c.json({ error: 'Required: courseCode, courseName, startTime, endTime, venue, level' }, 400);
    }
    if (!TIME_REGEX.test(startTime) || !TIME_REGEX.test(endTime)) return c.json({ error: 'Time must be in HH:MM 24-hour format' }, 400);

    const rangeError = validateScheduleTimeRange(startTime, endTime);
    if (rangeError) return c.json({ error: rangeError }, 400);

    if (!VALID_LEVELS.includes(level as any)) return c.json({ error: `Level must be one of: ${VALID_LEVELS.join(', ')}` }, 400);

    const db = getDatabase();
    const usersCollection = db.collection('users');
    const schedulesCollection = db.collection('schedules');

    const lecturer = await usersCollection.findOne({ email: user.email });
    if (!lecturer?.profile?.department) return c.json({ error: 'Lecturer profile or department not found' }, 404);

    const lecturerName = formatLecturerName(lecturer.profile);

    // Lecturers may only schedule classes for courses assigned to them.
    const assignedCourse = await findAssignedCourse({
      institutionId: user.institutionId,
      lecturerId: lecturer._id.toString(),
      courseId: body.courseId,
      courseCode,
    });
    if (!assignedCourse) {
      return c.json({ error: 'You can only schedule classes for courses assigned to you.' }, 403);
    }
    // Use the course's own details so the schedule always matches the course.
    const finalCourseCode = (assignedCourse as any).courseCode;
    const finalCourseName = (assignedCourse as any).courseName || courseName.trim();
    const finalLevel = (assignedCourse as any).level || level;
    const finalDepartment = (assignedCourse as any).department || lecturer.profile.department;

    let scheduleDates: string[] = [];

    if (recurring) {
      const { dayOfWeek, startDate, endDate } = recurring;
      if (!dayOfWeek || !startDate || !endDate) return c.json({ error: 'Recurring requires: dayOfWeek, startDate, endDate' }, 400);
      const dayMap: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
      const targetDay = dayMap[dayOfWeek];
      if (targetDay === undefined) return c.json({ error: 'Invalid dayOfWeek' }, 400);
      const cur = new Date(startDate);
      const last = new Date(endDate);
      while (cur.getDay() !== targetDay && cur <= last) cur.setDate(cur.getDate() + 1);
      while (cur <= last) {
        scheduleDates.push(cur.toISOString().split('T')[0] as string);
        cur.setDate(cur.getDate() + 7);
      }
    } else if (dates && Array.isArray(dates)) {
      scheduleDates = dates;
    } else if (date) {
      scheduleDates = [date];
    } else {
      return c.json({ error: 'Provide date, dates[], or recurring object' }, 400);
    }

    if (scheduleDates.length === 0) return c.json({ error: 'No valid dates generated' }, 400);

    // Filter out past dates / today with past start time
    const now = new Date();

    // For single-date requests, reject outright. For multi-date (recurring/dates[]), filter silently.
    const isSingleDate = !recurring && (!dates || !Array.isArray(dates));

    if (isSingleDate) {
      const d = scheduleDates[0]!;
      const pastError = validateScheduleNotInPast(d, startTime, now);
      if (pastError) return c.json({ error: pastError }, 400);
    } else {
      // For recurring / multi-date: silently skip past dates
      scheduleDates = scheduleDates.filter(d => !validateScheduleNotInPast(d, startTime, now));
      if (scheduleDates.length === 0) {
        return c.json({ error: 'All dates are in the past — no classes to schedule' }, 400);
      }
    }

    const created: any[] = [];
    const conflicts: any[] = [];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    for (const d of scheduleDates) {
      const dateObj = new Date(d);
      const dayOfWeek = dayNames[dateObj.getDay()];

      const existingOnDate = await schedulesCollection.find({ lecturerId: lecturer._id, date: d }).toArray();
      let conflict = false;
      for (const existing of existingOnDate) {
        if (hasTimeConflict(existing as any, { startTime, endTime })) {
          conflicts.push({ date: d, conflictWith: { courseCode: (existing as any).courseCode, startTime: (existing as any).startTime, endTime: (existing as any).endTime } });
          conflict = true;
          break;
        }
      }

      if (!conflict) {
        const entry = {
          courseId: (assignedCourse as any)._id.toString(),
          courseCode: finalCourseCode, courseName: finalCourseName,
          date: d, dayOfWeek, startTime, endTime, venue: venue.trim(), level: finalLevel,
          department: finalDepartment, lecturerId: lecturer._id,
          lecturerName, institutionId: lecturer.institutionId,
          createdAt: new Date(), updatedAt: new Date()
        };
        const result = await schedulesCollection.insertOne(entry);
        created.push({ _id: result.insertedId, ...entry });
      }
    }

    // Mark schedule as updated for real-time polling
    if (created.length > 0) {
      markUpdated(
        lecturer.institutionId?.toString() || '',
        finalDepartment,
        finalLevel,
        'created',
        { courseCode: finalCourseCode, courseName: finalCourseName, count: created.length }
      );
      logActivity({ lecturerId: lecturer._id.toString(), institutionId: lecturer.institutionId?.toString() || '', type: 'schedule_created', icon: '📅', title: 'Class Scheduled', description: `${finalCourseCode} — ${created.length} class${created.length > 1 ? 'es' : ''}` });
    }

    return c.json({
      message: `Created ${created.length} schedule entries${conflicts.length ? `, ${conflicts.length} skipped due to conflicts` : ''}`,
      created, conflicts
    }, 201);
  } catch (error: any) {
    console.error('Error creating schedule:', error);
    return c.json({ error: 'Failed to create schedule', details: error.message }, 500);
  }
});

// GET /schedule - Lecturer's schedule
schedule.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can access this endpoint' }, 403);

    const view = c.req.query('view') || 'week';
    const dateParam = c.req.query('date');

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    const range = view === 'month' ? getMonthRange(dateParam) : getWeekRange(dateParam);
    const startStr = range.start.toISOString().split('T')[0];
    const endStr = range.end.toISOString().split('T')[0];

    const entries = await db.collection('schedules')
      .find({ lecturerId: lecturer._id, date: { $gte: startStr, $lte: endStr } })
      .sort({ date: 1, startTime: 1 })
      .toArray();

    const groupedByDate: Record<string, any[]> = {};
    for (const entry of entries) {
      const key = (entry as any).date;
      if (!groupedByDate[key]) groupedByDate[key] = [];
      groupedByDate[key]!.push(entry);
    }

    const today = new Date().toISOString().split('T')[0];
    const todayClasses = entries.filter((e: any) => e.date === today);

    return c.json({ view, startDate: startStr, endDate: endStr, schedule: entries, groupedByDate, todayClasses });
  } catch (error: any) {
    console.error('Error fetching schedule:', error);
    return c.json({ error: 'Failed to fetch schedule', details: error.message }, 500);
  }
});

// PUT /schedule/:id/cancel - Cancel a class with a reason
schedule.put('/:id/cancel', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can cancel schedule entries' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid schedule ID' }, 400);

    const body = await c.req.json();
    const { reason } = body;
    if (!reason || !reason.trim()) return c.json({ error: 'Cancellation reason is required' }, 400);

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    const entry = await db.collection('schedules').findOne({ _id: new ObjectId(id), lecturerId: lecturer._id });
    if (!entry) return c.json({ error: 'Schedule entry not found' }, 404);

    await db.collection('schedules').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'cancelled', cancelReason: reason.trim(), cancelledAt: new Date(), updatedAt: new Date() } }
    );

    markUpdated(
      lecturer.institutionId?.toString() || '',
      (entry as any).department || '',
      (entry as any).level || '',
      'cancelled',
      { courseCode: (entry as any).courseCode, courseName: (entry as any).courseName, reason: reason.trim() }
    );

    logActivity({ lecturerId: lecturer._id.toString(), institutionId: lecturer.institutionId?.toString() || '', type: 'class_cancelled', icon: '🚫', title: 'Class Cancelled', description: `${(entry as any).courseCode} — ${(entry as any).date}` });
    return c.json({ message: 'Class cancelled' });
  } catch (error: any) {
    console.error('Error cancelling schedule:', error);
    return c.json({ error: 'Failed to cancel', details: error.message }, 500);
  }
});

// PUT /schedule/:id/restore - Restore a cancelled class
schedule.put('/:id/restore', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can restore schedule entries' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid schedule ID' }, 400);

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    const entry = await db.collection('schedules').findOne({ _id: new ObjectId(id), lecturerId: lecturer._id });
    if (!entry) return c.json({ error: 'Schedule entry not found' }, 404);

    // Prevent restoring a class whose time has already passed
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0]!;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const entryDate = (entry as any).date;
    const entryEndMinutes = timeToMinutes((entry as any).endTime);

    if (entryDate < todayStr || (entryDate === todayStr && entryEndMinutes <= currentMinutes)) {
      return c.json({ error: 'Cannot restore a class whose time has already passed' }, 400);
    }

    await db.collection('schedules').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'active', updatedAt: new Date() }, $unset: { cancelReason: '', cancelledAt: '' } }
    );

    markUpdated(
      lecturer.institutionId?.toString() || '',
      (entry as any).department || '',
      (entry as any).level || '',
      'restored',
      { courseCode: (entry as any).courseCode, courseName: (entry as any).courseName }
    );

    logActivity({ lecturerId: lecturer._id.toString(), institutionId: lecturer.institutionId?.toString() || '', type: 'class_restored', icon: '✅', title: 'Class Restored', description: `${(entry as any).courseCode} — ${(entry as any).date}` });
    return c.json({ message: 'Class restored' });
  } catch (error: any) {
    console.error('Error restoring schedule:', error);
    return c.json({ error: 'Failed to restore', details: error.message }, 500);
  }
});

// PUT /schedule/:id/announcement - Add or update an announcement on a class
schedule.put('/:id/announcement', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can add announcements' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid schedule ID' }, 400);

    const body = await c.req.json();
    const { announcement } = body;

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    const entry = await db.collection('schedules').findOne({ _id: new ObjectId(id), lecturerId: lecturer._id });
    if (!entry) return c.json({ error: 'Schedule entry not found' }, 404);

    if (!announcement || !announcement.trim()) {
      // Remove announcement
      await db.collection('schedules').updateOne(
        { _id: new ObjectId(id) },
        { $unset: { announcement: '' }, $set: { updatedAt: new Date() } }
      );
    } else {
      // Set announcement
      await db.collection('schedules').updateOne(
        { _id: new ObjectId(id) },
        { $set: { announcement: announcement.trim(), updatedAt: new Date() } }
      );
    }

    markUpdated(
      lecturer.institutionId?.toString() || '',
      (entry as any).department || '',
      (entry as any).level || '',
      'announcement',
      { courseCode: (entry as any).courseCode, courseName: (entry as any).courseName }
    );

    return c.json({ message: announcement?.trim() ? 'Announcement added' : 'Announcement removed' });
  } catch (error: any) {
    console.error('Error updating announcement:', error);
    return c.json({ error: 'Failed to update announcement', details: error.message }, 500);
  }
});

// PUT /schedule/:id
schedule.put('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can update schedule entries' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid schedule ID' }, 400);

    const body = await c.req.json();
    const { courseCode, courseName, date, startTime, endTime, venue, level } = body;

    if (!courseCode || !courseName || !date || !startTime || !endTime || !venue || !level) {
      return c.json({ error: 'All fields are required' }, 400);
    }
    if (!TIME_REGEX.test(startTime) || !TIME_REGEX.test(endTime)) return c.json({ error: 'Invalid time format' }, 400);

    const rangeError = validateScheduleTimeRange(startTime, endTime);
    if (rangeError) return c.json({ error: rangeError }, 400);

    const pastError = validateScheduleNotInPast(date, startTime);
    if (pastError) return c.json({ error: pastError }, 400);

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    const existing = await db.collection('schedules').findOne({ _id: new ObjectId(id), lecturerId: lecturer._id });
    if (!existing) return c.json({ error: 'Schedule entry not found' }, 404);

    // Lecturers may only (re)assign a class to a course assigned to them.
    const assignedCourse = await findAssignedCourse({
      institutionId: user.institutionId,
      lecturerId: lecturer._id.toString(),
      courseId: body.courseId,
      courseCode,
    });
    if (!assignedCourse) {
      return c.json({ error: 'You can only schedule classes for courses assigned to you.' }, 403);
    }
    const finalCourseCode = (assignedCourse as any).courseCode;
    const finalCourseName = (assignedCourse as any).courseName || courseName.trim();
    const finalLevel = (assignedCourse as any).level || level;
    const finalDepartment = (assignedCourse as any).department || lecturer.profile?.department || '';

    const othersOnDate = await db.collection('schedules').find({
      lecturerId: lecturer._id, date, _id: { $ne: new ObjectId(id) }
    }).toArray();

    for (const other of othersOnDate) {
      if (hasTimeConflict(other as any, { startTime, endTime })) {
        return c.json({ error: 'Time conflict', conflictWith: { courseCode: (other as any).courseCode, startTime: (other as any).startTime, endTime: (other as any).endTime } }, 409);
      }
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = dayNames[new Date(date).getDay()];

    await db.collection('schedules').updateOne(
      { _id: new ObjectId(id) },
      { $set: { courseId: (assignedCourse as any)._id.toString(), courseCode: finalCourseCode, courseName: finalCourseName, date, dayOfWeek, startTime, endTime, venue: venue.trim(), level: finalLevel, department: finalDepartment, updatedAt: new Date() } }
    );

    // Mark schedule as updated for real-time polling
    markUpdated(
      lecturer.institutionId?.toString() || '',
      (existing as any).department || lecturer.profile?.department || '',
      (existing as any).level || finalLevel,
      'updated',
      { courseCode: finalCourseCode, courseName: finalCourseName }
    );
    if ((existing as any).level !== finalLevel) {
      markUpdated(
        lecturer.institutionId?.toString() || '',
        finalDepartment,
        finalLevel,
        'updated',
        { courseCode: finalCourseCode, courseName: finalCourseName }
      );
    }

    return c.json({ message: 'Schedule entry updated' });
  } catch (error: any) {
    console.error('Error updating schedule:', error);
    return c.json({ error: 'Failed to update', details: error.message }, 500);
  }
});

// DELETE /schedule/:id
schedule.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can delete schedule entries' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid schedule ID' }, 400);

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    // Get entry before deleting so we can broadcast
    const entry = await db.collection('schedules').findOne({ _id: new ObjectId(id), lecturerId: lecturer._id });
    if (!entry) return c.json({ error: 'Schedule entry not found' }, 404);

    await db.collection('schedules').deleteOne({ _id: new ObjectId(id) });

    // Mark schedule as updated for real-time polling
    markUpdated(
      lecturer.institutionId?.toString() || '',
      (entry as any).department || '',
      (entry as any).level || '',
      'deleted',
      { courseCode: (entry as any).courseCode, courseName: (entry as any).courseName }
    );

    return c.json({ message: 'Schedule entry deleted' });
  } catch (error: any) {
    console.error('Error deleting schedule:', error);
    return c.json({ error: 'Failed to delete', details: error.message }, 500);
  }
});

// ==================== STUDENT ENDPOINT ====================

schedule.get('/student', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'student') return c.json({ error: 'Only students can access this endpoint' }, 403);

    const view = c.req.query('view') || 'week';
    const dateParam = c.req.query('date');

    const db = getDatabase();
    const student = await db.collection('users').findOne({ email: user.email });
    if (!student?.profile?.department || !student?.profile?.year) {
      return c.json({ error: 'Student profile, department, or level not found' }, 404);
    }

    const range = view === 'month' ? getMonthRange(dateParam) : getWeekRange(dateParam);
    const startStr = range.start.toISOString().split('T')[0];
    const endStr = range.end.toISOString().split('T')[0];

    const entries = await db.collection('schedules')
      .find({
        institutionId: student.institutionId,
        department: student.profile.department,
        level: yearToLevel(student.profile.year),
        date: { $gte: startStr, $lte: endStr }
      })
      .sort({ date: 1, startTime: 1 })
      .toArray();

    const groupedByDate: Record<string, any[]> = {};
    for (const entry of entries) {
      const key = (entry as any).date;
      if (!groupedByDate[key]) groupedByDate[key] = [];
      groupedByDate[key]!.push(entry);
    }

    const today = new Date().toISOString().split('T')[0];
    const todayClasses = entries.filter((e: any) => e.date === today);

    return c.json({
      department: student.profile.department,
      level: student.profile.year,
      view, startDate: startStr, endDate: endStr,
      schedule: entries, groupedByDate, todayClasses
    });
  } catch (error: any) {
    console.error('Error fetching student schedule:', error);
    return c.json({ error: 'Failed to fetch schedule', details: error.message }, 500);
  }
});

export default schedule;
