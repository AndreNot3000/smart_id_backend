import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { getDatabase, getEnrollmentsCollection } from '../database/connection.js';
import { sendNewAssignmentEmail } from '../services/email.services.js';
import { DEFAULT_GRADE_SCALE, isValidScale, percentageToGrade, classifyCgpa, type GradeScale } from '../utils/gpa.js';
import { computeFinalPercentage, validateComponents, type AssessmentComponent } from '../utils/gradebook.js';

const course = new Hono();

// ==================== ACTIVITY LOGGER ====================

async function logActivity(opts: {
  lecturerId: string;
  institutionId: string;
  type: string;
  icon: string;
  title: string;
  description: string;
}) {
  try {
    const db = getDatabase();
    await db.collection('lecturer_activities').insertOne({
      ...opts,
      createdAt: new Date(),
    });
  } catch (e) {
    console.error('Failed to log activity:', e);
  }
}

// Humanize a future date relative to now (e.g. "Due in 3h", "Due tomorrow")
function humanizeDue(d: Date, now: Date): string {
  const diffMs = d.getTime() - now.getTime();
  if (diffMs < 0) return 'Overdue';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `Due in ${Math.max(mins, 1)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Due in ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Due tomorrow';
  if (days < 7) return `Due in ${days} days`;
  return `Due ${d.toLocaleDateString()}`;
}

// GET /course/lecturer/tasks - Real, live "upcoming tasks" for a lecturer.
// Aggregates: (1) ungraded submissions, (2) assignment deadlines approaching,
// (3) upcoming classes within the next 7 days.
course.get('/lecturer/tasks', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    const lecturerId = lecturer._id.toString();
    const now = new Date();
    const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const tasks: any[] = [];

    // ---- 1. Grading tasks: ungraded submissions on this lecturer's assignments ----
    const myAssignments = await db.collection('assignments').find({ lecturerId }).toArray();
    const assignmentById: Record<string, any> = {};
    for (const a of myAssignments) assignmentById[a._id.toString()] = a;
    const assignmentIds = Object.keys(assignmentById);

    if (assignmentIds.length > 0) {
      const ungraded = await db.collection('assignment_submissions')
        .find({ assignmentId: { $in: assignmentIds }, score: { $exists: false } })
        .toArray();
      const counts: Record<string, number> = {};
      for (const s of ungraded) {
        const aid = (s as any).assignmentId;
        counts[aid] = (counts[aid] || 0) + 1;
      }
      for (const [aid, count] of Object.entries(counts)) {
        const a = assignmentById[aid];
        if (!a) continue;
        const deadlinePassed = a.deadline && new Date(a.deadline) < now;
        tasks.push({
          id: `grade-${aid}`,
          type: 'grading',
          icon: '📝',
          task: `Grade ${count} submission${count > 1 ? 's' : ''} — ${`${a.courseCode || ''} ${a.title || ''}`.trim()}`,
          dueAt: a.deadline ? new Date(a.deadline).toISOString() : null,
          deadline: deadlinePassed ? 'Awaiting grading' : 'Grading pending',
          priority: deadlinePassed ? 'high' : 'medium',
          count,
        });
      }
    }

    // ---- 2. Assignment deadlines approaching (open, within 7 days) ----
    for (const a of myAssignments) {
      if (!a.deadline) continue;
      const d = new Date(a.deadline);
      if (d > now && d <= soon) {
        const hours = (d.getTime() - now.getTime()) / 3600000;
        tasks.push({
          id: `deadline-${a._id.toString()}`,
          type: 'deadline',
          icon: '⏰',
          task: `${`${a.courseCode || ''} ${a.title || ''}`.trim()} closes`,
          dueAt: d.toISOString(),
          deadline: humanizeDue(d, now),
          priority: hours <= 24 ? 'high' : hours <= 72 ? 'medium' : 'low',
        });
      }
    }

    // ---- 3. Upcoming classes (next 7 days, not cancelled) ----
    const todayStr = now.toISOString().slice(0, 10);
    const soonStr = soon.toISOString().slice(0, 10);
    const classes = await db.collection('schedules')
      .find({ lecturerId: lecturer._id, status: { $ne: 'cancelled' }, date: { $gte: todayStr, $lte: soonStr } })
      .sort({ date: 1, startTime: 1 })
      .toArray();
    for (const cls of classes) {
      const startStr = (cls as any).startTime || '00:00';
      const endStr = (cls as any).endTime || '23:59';
      const startDt = new Date(`${(cls as any).date}T${startStr}:00`);
      const endDt = new Date(`${(cls as any).date}T${endStr}:00`);
      if (endDt < now) continue; // class already finished
      const hours = (startDt.getTime() - now.getTime()) / 3600000;
      tasks.push({
        id: `class-${cls._id.toString()}`,
        type: 'class',
        icon: '📅',
        task: `Teach ${(cls as any).courseCode || 'class'} @ ${(cls as any).venue || 'TBA'}`,
        dueAt: startDt.toISOString(),
        deadline: hours < 0 ? 'In progress' : humanizeDue(startDt, now),
        priority: hours <= 24 ? 'high' : hours <= 72 ? 'medium' : 'low',
      });
    }

    // Sort by soonest due first; null dueAt goes last
    tasks.sort((a, b) => {
      if (!a.dueAt && !b.dueAt) return 0;
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });

    return c.json({ tasks: tasks.slice(0, 12), serverTime: now.toISOString() });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch tasks', details: error.message }, 500);
  }
});

// GET /course/activities - Lecturer's recent activities
course.get('/activities', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    const limit = parseInt(c.req.query('limit') || '20');
    const activities = await db.collection('lecturer_activities')
      .find({ lecturerId: lecturer._id.toString() })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return c.json({ activities });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch activities', details: error.message }, 500);
  }
});

// ==================== ADMIN: COURSE CRUD ====================

// POST /course - Admin creates a course
course.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'admin') return c.json({ error: 'Only admins can create courses' }, 403);

    const body = await c.req.json();
    const { courseCode, courseName, description, credits, department, level, semester } = body;

    if (!courseCode || !courseName || !department || !level) {
      return c.json({ error: 'Required: courseCode, courseName, department, level' }, 400);
    }

    const db = getDatabase();

    // Check for duplicate course code within the institution
    const existing = await db.collection('courses').findOne({
      courseCode: normalizeCourseCode(courseCode),
      institutionId: user.institutionId
    });
    if (existing) return c.json({ error: 'A course with this code already exists' }, 409);

    const entry = {
      courseCode: normalizeCourseCode(courseCode),
      courseName: courseName.trim(),
      description: (description || '').trim(),
      credits: credits || 0,
      department: department.trim(),
      level,
      semester: semester || '',
      institutionId: user.institutionId,
      lecturerIds: [] as string[],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('courses').insertOne(entry);
    markCourseUpdated(user.institutionId);
    return c.json({ message: 'Course created', course: { _id: result.insertedId, ...entry } }, 201);
  } catch (error: any) {
    console.error('Error creating course:', error);
    return c.json({ error: 'Failed to create course', details: error.message }, 500);
  }
});

// Normalise a course code: strip all whitespace and uppercase.
// e.g. "csc 234" or "CSC  234" -> "CSC234"
function normalizeCourseCode(code: string): string {
  return (code || '').replace(/\s+/g, '').toUpperCase();
}

// Helper to convert year format
function yearToLevel(year: string): string {
  if (!year) return '';
  if (/^\d+L$/i.test(year)) return year.toUpperCase();
  const match = year.match(/Year\s*(\d+)/i);
  if (match && match[1]) return `${parseInt(match[1]) * 100}L`;
  const numMatch = year.match(/(\d+)/);
  if (numMatch && numMatch[1]) return `${parseInt(numMatch[1]) * 100}L`;
  return year;
}

// Change tracker for real-time polling
let courseLastUpdated: Record<string, number> = {};

function markCourseUpdated(institutionId: string) {
  courseLastUpdated[institutionId] = Date.now();
}

// GET /course/updates - Poll for course changes
course.get('/updates', authMiddleware, async (c) => {
  const user = c.get('user');
  const since = parseInt(c.req.query('since') || '0');
  const lastUpdate = courseLastUpdated[user.institutionId] || 0;
  return c.json({ updated: lastUpdate > since, timestamp: lastUpdate });
});

// GET /course - List courses (filtered by role)
course.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const db = getDatabase();
    const query: any = { institutionId: user.institutionId };

    if (user.userType === 'student') {
      const student = await db.collection('users').findOne({ email: user.email });
      if (!student?.profile?.department || !student?.profile?.year) {
        return c.json({ error: 'Student profile incomplete' }, 404);
      }
      query.department = student.profile.department;
      query.level = yearToLevel(student.profile.year);
      query.status = 'active';
    } else if (user.userType === 'lecturer') {
      const lecturer = await db.collection('users').findOne({ email: user.email });
      if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);
      // assignedOnly=true restricts to courses explicitly assigned to this
      // lecturer (used by attendance/grading). Default shows assigned OR
      // department courses.
      if (c.req.query('assignedOnly') === 'true') {
        query.lecturerIds = lecturer._id.toString();
      } else {
        query.$or = [
          { lecturerIds: lecturer._id.toString() },
          { department: lecturer.profile?.department }
        ];
      }
    }

    const courses = await db.collection('courses').find(query).sort({ courseCode: 1 }).toArray();

    // For students: attach pending assignment count per course (single batch query)
    if (user.userType === 'student') {
      const student = await db.collection('users').findOne({ email: user.email });
      if (student) {
        const now = new Date();
        const courseIds = courses.map((c: any) => c._id.toString());

        // One query for all active assignments across all courses
        const allAssignments = await db.collection('assignments').find({
          courseId: { $in: courseIds }, deadline: { $gt: now }
        }).project({ _id: 1, courseId: 1 }).toArray();

        // One query for all student submissions across all courses
        const allSubmissions = await db.collection('assignment_submissions').find({
          studentId: student._id.toString(), courseId: { $in: courseIds }
        }).project({ assignmentId: 1 }).toArray();

        const submittedIds = new Set(allSubmissions.map((s: any) => s.assignmentId));

        // Count per course
        const pendingMap: Record<string, number> = {};
        const totalMap: Record<string, number> = {};
        for (const a of allAssignments) {
          const cid = (a as any).courseId;
          totalMap[cid] = (totalMap[cid] || 0) + 1;
          if (!submittedIds.has((a as any)._id.toString())) {
            pendingMap[cid] = (pendingMap[cid] || 0) + 1;
          }
        }

        for (const course of courses) {
          const cid = (course as any)._id.toString();
          (course as any).pendingAssignments = pendingMap[cid] || 0;
          (course as any).totalAssignments = totalMap[cid] || 0;
        }
      }
    }

    return c.json({ courses });
  } catch (error: any) {
    console.error('Error fetching courses:', error);
    return c.json({ error: 'Failed to fetch courses', details: error.message }, 500);
  }
});

// GET /course/student/assignments - All assignments across a student's courses
// Registered before /:id/assignments so the static "student" segment wins.
course.get('/student/assignments', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'student') {
      return c.json({ error: 'Only students can access this endpoint' }, 403);
    }

    const db = getDatabase();
    const student = await db.collection('users').findOne({ email: user.email });
    if (!student?.profile?.department || !student?.profile?.year) {
      return c.json({ error: 'Student profile incomplete' }, 404);
    }

    // Courses the student is eligible for (same filter as the course list)
    const courses = await db.collection('courses').find({
      institutionId: user.institutionId,
      department: student.profile.department,
      level: yearToLevel(student.profile.year),
      status: 'active',
    }).toArray();

    if (courses.length === 0) {
      return c.json({ assignments: [] });
    }

    const courseIds = courses.map((c: any) => c._id.toString());
    const courseInfo: Record<string, { courseCode: string; courseName: string }> = {};
    for (const co of courses) {
      courseInfo[(co as any)._id.toString()] = {
        courseCode: (co as any).courseCode,
        courseName: (co as any).courseName,
      };
    }

    const assignments = await db.collection('assignments')
      .find({ courseId: { $in: courseIds }, institutionId: user.institutionId })
      .sort({ deadline: 1 })
      .toArray();

    const submissions = await db.collection('assignment_submissions')
      .find({ studentId: student._id.toString(), courseId: { $in: courseIds } })
      .toArray();
    const subMap: Record<string, any> = {};
    for (const s of submissions) subMap[(s as any).assignmentId] = s;

    const enriched = assignments.map((a: any) => {
      const info = courseInfo[a.courseId] || { courseCode: '', courseName: '' };
      return {
        ...a,
        courseCode: info.courseCode,
        courseName: info.courseName,
        mySubmission: subMap[a._id.toString()] || null,
      };
    });

    return c.json({ assignments: enriched });
  } catch (error: any) {
    console.error('Error fetching student assignments:', error);
    return c.json({ error: 'Failed to fetch assignments', details: error.message }, 500);
  }
});

// GET /course/student/feed - Unified "what's new" activity feed for the student
// overview. Combines recently posted materials, assignments and announcements
// across all of the student's courses so they see new items right after login.
// Registered before /:id/* so the static "student" segment wins.
course.get('/student/feed', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'student') {
      return c.json({ error: 'Only students can access this endpoint' }, 403);
    }

    const db = getDatabase();
    const student = await db.collection('users').findOne({ email: user.email });
    if (!student?.profile?.department || !student?.profile?.year) {
      return c.json({ error: 'Student profile incomplete' }, 404);
    }

    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);

    // Same course-eligibility filter the rest of the student endpoints use.
    const courses = await db.collection('courses').find({
      institutionId: user.institutionId,
      department: student.profile.department,
      level: yearToLevel(student.profile.year),
      status: 'active',
    }).toArray();

    if (courses.length === 0) {
      return c.json({ feed: [] });
    }

    const courseIds = courses.map((co: any) => co._id.toString());
    const courseInfo: Record<string, { courseCode: string; courseName: string }> = {};
    for (const co of courses) {
      courseInfo[(co as any)._id.toString()] = {
        courseCode: (co as any).courseCode,
        courseName: (co as any).courseName,
      };
    }

    // Pull the most recent items from each source in parallel.
    const [materials, assignments, announcements, submissions] = await Promise.all([
      db.collection('course_materials')
        .find({ courseId: { $in: courseIds }, institutionId: user.institutionId, status: 'published' })
        .project({ fileData: 0 })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),
      db.collection('assignments')
        .find({ courseId: { $in: courseIds }, institutionId: user.institutionId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),
      db.collection('course_announcements')
        .find({ courseId: { $in: courseIds }, institutionId: user.institutionId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),
      db.collection('assignment_submissions')
        .find({ studentId: student._id.toString(), courseId: { $in: courseIds } })
        .project({ assignmentId: 1 })
        .toArray(),
    ]);

    const submittedIds = new Set(submissions.map((s: any) => s.assignmentId));

    type FeedItem = {
      type: 'material' | 'assignment' | 'announcement';
      id: string;
      courseId: string;
      courseCode: string;
      courseName: string;
      title: string;
      detail: string;
      lecturerName: string;
      createdAt: Date;
      deadline?: Date | null;
      submitted?: boolean;
      category?: string;
    };

    const feed: FeedItem[] = [];

    for (const m of materials as any[]) {
      const info = courseInfo[m.courseId] || { courseCode: m.courseCode || '', courseName: '' };
      feed.push({
        type: 'material',
        id: m._id.toString(),
        courseId: m.courseId,
        courseCode: info.courseCode,
        courseName: info.courseName,
        title: m.title,
        detail: m.description || m.category || 'New material',
        lecturerName: m.lecturerName || '',
        createdAt: m.createdAt,
        category: m.category || 'General',
      });
    }

    for (const a of assignments as any[]) {
      const info = courseInfo[a.courseId] || { courseCode: a.courseCode || '', courseName: '' };
      feed.push({
        type: 'assignment',
        id: a._id.toString(),
        courseId: a.courseId,
        courseCode: info.courseCode,
        courseName: info.courseName,
        title: a.title,
        detail: a.description || 'New assignment',
        lecturerName: a.lecturerName || '',
        createdAt: a.createdAt,
        deadline: a.deadline || null,
        submitted: submittedIds.has(a._id.toString()),
      });
    }

    for (const an of announcements as any[]) {
      const info = courseInfo[an.courseId] || { courseCode: an.courseCode || '', courseName: '' };
      feed.push({
        type: 'announcement',
        id: an._id.toString(),
        courseId: an.courseId,
        courseCode: info.courseCode,
        courseName: info.courseName,
        title: 'Announcement',
        detail: an.message || '',
        lecturerName: an.lecturerName || '',
        createdAt: an.createdAt,
      });
    }

    // Newest first across all three sources, then trim to the limit.
    feed.sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());

    return c.json({ feed: feed.slice(0, limit) });
  } catch (error: any) {
    console.error('Error fetching student feed:', error);
    return c.json({ error: 'Failed to fetch activity feed', details: error.message }, 500);
  }
});

// GET /course/student/gpa - Live, auto-computed CGPA for the logged-in student.
// Derived from graded submissions + course credits. Nobody uploads this value;
// it is recomputed from the current database on every request, so it always
// reflects the latest grading. A course only counts once EVERY assessment in it
// has a graded submission from the student (others are "in progress").
course.get('/student/gpa', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'student') {
      return c.json({ error: 'Only students can access this endpoint' }, 403);
    }

    const db = getDatabase();
    const student = await db.collection('users').findOne({ email: user.email });
    if (!student?.profile?.department || !student?.profile?.year) {
      return c.json({ error: 'Student profile incomplete' }, 404);
    }

    // Grading scale: per-institution override, else the default.
    let scale: GradeScale = DEFAULT_GRADE_SCALE;
    try {
      const inst = await db.collection('institutions').findOne({ _id: student.institutionId });
      if (inst && isValidScale((inst as any).gradeScale)) scale = (inst as any).gradeScale;
    } catch { /* fall back to default */ }

    const courses = await db.collection('courses').find({
      institutionId: user.institutionId,
      department: student.profile.department,
      level: yearToLevel(student.profile.year),
      status: 'active',
    }).toArray();

    if (courses.length === 0) {
      return c.json({ cgpa: null, scaleMax: scale.scaleMax, creditsEarned: 0, totalCredits: 0, label: '', completed: [], inProgress: [], serverTime: new Date().toISOString() });
    }

    const courseIds = courses.map((co: any) => co._id.toString());
    const studentId = student._id.toString();

    // Lecturer-controlled gradebook: a course counts only when its assessment
    // scheme is PUBLISHED. The final score is computed from the scheme's
    // components (manual scores + reused assignment scores; blank = 0).
    const schemes = await db.collection('assessment_schemes').find({ courseId: { $in: courseIds } }).toArray();
    const schemeByCourse: Record<string, any> = {};
    for (const s of schemes) schemeByCourse[(s as any).courseId] = s;

    const manualScores = await db.collection('gradebook_scores').find({ courseId: { $in: courseIds }, studentId }).toArray();
    const manualByCourse: Record<string, Record<string, number>> = {};
    for (const m of manualScores) {
      (manualByCourse[(m as any).courseId] ||= {})[(m as any).componentId] = (m as any).score;
    }

    // Reused-assignment scores for this student.
    const submissions = await db.collection('assignment_submissions')
      .find({ studentId, courseId: { $in: courseIds } })
      .toArray();
    const subByAsg: Record<string, any> = {};
    for (const s of submissions) subByAsg[(s as any).assignmentId] = s;

    const completed: any[] = [];
    const inProgress: any[] = [];
    let qualityPoints = 0;
    let earnedCredits = 0;

    for (const co of courses) {
      const cid = (co as any)._id.toString();
      const credits = (co as any).credits || 0;
      const base = { courseCode: (co as any).courseCode, courseName: (co as any).courseName, credits };
      const scheme = schemeByCourse[cid];

      if (!scheme || !scheme.components?.length) {
        inProgress.push({ ...base, reason: 'Not graded yet' });
        continue;
      }
      if (!scheme.published) {
        inProgress.push({ ...base, reason: 'Results not published' });
        continue;
      }

      // Build this student's score map across the scheme's components.
      const components: any[] = scheme.components;
      const scoreMap: Record<string, number> = {};
      for (const comp of components) {
        if (comp.type === 'assignment' && comp.assignmentId) {
          const sub = subByAsg[comp.assignmentId];
          if (sub && typeof sub.score === 'number') scoreMap[comp.id] = sub.score;
        } else {
          const v = manualByCourse[cid]?.[comp.id];
          if (typeof v === 'number') scoreMap[comp.id] = v;
        }
      }

      const pct = computeFinalPercentage(components, scoreMap);
      const { letter, point } = percentageToGrade(pct, scale);

      qualityPoints += point * credits;
      earnedCredits += credits;
      completed.push({ ...base, percentage: Math.round(pct * 10) / 10, letter, point });
    }

    const cgpa = earnedCredits > 0 ? Math.round((qualityPoints / earnedCredits) * 100) / 100 : null;

    return c.json({
      cgpa,
      scaleMax: scale.scaleMax,
      creditsEarned: earnedCredits,
      totalCredits: courses.reduce((sum: number, co: any) => sum + (co.credits || 0), 0),
      label: cgpa != null ? classifyCgpa(cgpa, scale.scaleMax) : '',
      completed,
      inProgress,
      serverTime: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error computing GPA:', error);
    return c.json({ error: 'Failed to compute GPA', details: error.message }, 500);
  }
});

// ==================== GRADEBOOK (lecturer-controlled grading) ====================

// Returns the students who belong to a course (active students whose department
// and level match the course). This mirrors how students see courses + receive
// assignments, so the gradebook roster is automatic.
async function getCourseRoster(course: any) {
  const db = getDatabase();
  const candidates = await db.collection('users').find({
    institutionId: new ObjectId(course.institutionId),
    userType: 'student',
    'profile.department': course.department,
    status: { $in: ['active', 'pending'] },
  }).project({ email: 1, status: 1, 'profile.firstName': 1, 'profile.lastName': 1, 'profile.studentId': 1, 'profile.year': 1 }).toArray();

  return candidates
    .filter((s: any) => yearToLevel(s.profile?.year || '') === course.level)
    .map((s: any) => ({
      studentId: s._id.toString(),
      name: `${s.profile?.firstName || ''} ${s.profile?.lastName || ''}`.trim() || s.email,
      studentNumber: s.profile?.studentId || '',
    }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
}

// GET /course/gradebook/courses - courses this lecturer is assigned to (for the picker)
course.get('/gradebook/courses', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    const courses = await db.collection('courses')
      .find({ institutionId: user.institutionId, lecturerIds: lecturer._id.toString() })
      .sort({ courseCode: 1 })
      .toArray();

    const schemes = await db.collection('assessment_schemes')
      .find({ courseId: { $in: courses.map((co: any) => co._id.toString()) } })
      .toArray();
    const schemeByCourse: Record<string, any> = {};
    for (const s of schemes) schemeByCourse[(s as any).courseId] = s;

    return c.json({
      courses: courses.map((co: any) => {
        const scheme = schemeByCourse[co._id.toString()];
        return {
          _id: co._id.toString(),
          courseCode: co.courseCode,
          courseName: co.courseName,
          credits: co.credits || 0,
          department: co.department,
          level: co.level,
          hasScheme: !!scheme,
          published: !!scheme?.published,
        };
      }),
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch courses', details: error.message }, 500);
  }
});

// GET /course/:id/gradebook - full gradebook for a course (scheme + roster + scores)
course.get('/:id/gradebook', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can manage grades' }, 403);
    const courseId = c.req.param('id');
    const check = await assertCanManageCourse(user, courseId);
    if ('error' in check) return c.json({ error: check.error }, check.status);
    const course = check.course as any;

    const db = getDatabase();

    // Grading scale (institution override or default)
    let scale: GradeScale = DEFAULT_GRADE_SCALE;
    try {
      const inst = await db.collection('institutions').findOne({ _id: new ObjectId(course.institutionId) });
      if (inst && isValidScale((inst as any).gradeScale)) scale = (inst as any).gradeScale;
    } catch { /* default */ }

    const scheme = await db.collection('assessment_schemes').findOne({ courseId });
    const components: AssessmentComponent[] = (scheme as any)?.components || [];

    const roster = await getCourseRoster(course);
    const rosterIds = new Set(roster.map((r) => r.studentId));

    // Manual scores entered by the lecturer.
    const manualScores = await db.collection('gradebook_scores').find({ courseId }).toArray();

    // Pulled scores from reused assignments.
    const assignmentComponentIds = components.filter((c) => c.type === 'assignment' && c.assignmentId);
    const assignmentSubs = assignmentComponentIds.length
      ? await db.collection('assignment_submissions').find({
          assignmentId: { $in: assignmentComponentIds.map((c) => c.assignmentId!) },
          studentId: { $in: Array.from(rosterIds) },
        }).toArray()
      : [];

    // scores[studentId][componentId] = number
    const scores: Record<string, Record<string, number>> = {};
    for (const m of manualScores) {
      const sid = (m as any).studentId;
      if (!rosterIds.has(sid)) continue;
      (scores[sid] ||= {})[(m as any).componentId] = (m as any).score;
    }
    for (const comp of assignmentComponentIds) {
      for (const sub of assignmentSubs) {
        if ((sub as any).assignmentId !== comp.assignmentId) continue;
        const sid = (sub as any).studentId;
        if (typeof (sub as any).score === 'number') {
          (scores[sid] ||= {})[comp.id] = (sub as any).score;
        }
      }
    }

    // Assignments available for reuse as components.
    const assignments = await db.collection('assignments')
      .find({ courseId })
      .project({ title: 1, maxScore: 1, deadline: 1 })
      .sort({ deadline: -1 })
      .toArray();

    return c.json({
      course: {
        _id: course._id.toString(),
        courseCode: course.courseCode,
        courseName: course.courseName,
        credits: course.credits || 0,
        department: course.department,
        level: course.level,
      },
      scheme: {
        components,
        published: !!(scheme as any)?.published,
        publishedAt: (scheme as any)?.publishedAt || null,
        updatedAt: (scheme as any)?.updatedAt || null,
      },
      assignments: assignments.map((a: any) => ({ _id: a._id.toString(), title: a.title, maxScore: a.maxScore || 100 })),
      roster,
      scores,
      scale,
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to load gradebook', details: error.message }, 500);
  }
});

// PUT /course/:id/gradebook/scheme - save the assessment components/weights
course.put('/:id/gradebook/scheme', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can manage grades' }, 403);
    const courseId = c.req.param('id');
    const check = await assertCanManageCourse(user, courseId);
    if ('error' in check) return c.json({ error: check.error }, check.status);

    const body = await c.req.json();
    const result = validateComponents(body?.components);
    if (!result.ok) return c.json({ error: result.error }, 400);

    const db = getDatabase();
    await db.collection('assessment_schemes').updateOne(
      { courseId },
      {
        $set: {
          courseId,
          institutionId: (check.course as any).institutionId,
          components: result.clean,
          updatedBy: user.email,
          updatedAt: new Date(),
        },
        $setOnInsert: { published: false },
      },
      { upsert: true }
    );

    // Drop manual scores for components that no longer exist.
    const validIds = result.clean.filter((c) => c.type === 'manual').map((c) => c.id);
    await db.collection('gradebook_scores').deleteMany({ courseId, componentId: { $nin: validIds } });

    return c.json({ message: 'Assessment scheme saved', components: result.clean });
  } catch (error: any) {
    return c.json({ error: 'Failed to save scheme', details: error.message }, 500);
  }
});

// PUT /course/:id/gradebook/scores - save manual scores (batch)
course.put('/:id/gradebook/scores', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can manage grades' }, 403);
    const courseId = c.req.param('id');
    const check = await assertCanManageCourse(user, courseId);
    if ('error' in check) return c.json({ error: check.error }, check.status);

    const db = getDatabase();
    const scheme = await db.collection('assessment_schemes').findOne({ courseId });
    const components: AssessmentComponent[] = (scheme as any)?.components || [];
    const manualIds = new Set(components.filter((c) => c.type === 'manual').map((c) => c.id));

    const body = await c.req.json();
    const entries: Array<{ studentId: string; componentId: string; score: number | null }> = body?.scores || [];
    if (!Array.isArray(entries)) return c.json({ error: 'scores must be an array' }, 400);

    const ops: any[] = [];
    for (const e of entries) {
      if (!e.studentId || !e.componentId) continue;
      if (!manualIds.has(e.componentId)) continue; // only manual components are editable
      if (e.score === null || e.score === undefined || (e.score as any) === '') {
        ops.push({ deleteOne: { filter: { courseId, componentId: e.componentId, studentId: e.studentId } } });
      } else {
        const num = Number(e.score);
        if (isNaN(num) || num < 0) continue;
        ops.push({
          updateOne: {
            filter: { courseId, componentId: e.componentId, studentId: e.studentId },
            update: { $set: { courseId, componentId: e.componentId, studentId: e.studentId, score: num, updatedAt: new Date() } },
            upsert: true,
          },
        });
      }
    }

    if (ops.length) await db.collection('gradebook_scores').bulkWrite(ops);
    return c.json({ message: 'Scores saved', count: ops.length });
  } catch (error: any) {
    return c.json({ error: 'Failed to save scores', details: error.message }, 500);
  }
});

// POST /course/:id/gradebook/publish - publish or unpublish results
course.post('/:id/gradebook/publish', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can manage grades' }, 403);
    const courseId = c.req.param('id');
    const check = await assertCanManageCourse(user, courseId);
    if ('error' in check) return c.json({ error: check.error }, check.status);

    const body = await c.req.json().catch(() => ({}));
    const publish = body?.published !== false; // default true

    const db = getDatabase();
    const scheme = await db.collection('assessment_schemes').findOne({ courseId });
    if (!scheme || !((scheme as any).components?.length)) {
      return c.json({ error: 'Set up an assessment scheme before publishing.' }, 400);
    }

    await db.collection('assessment_schemes').updateOne(
      { courseId },
      { $set: { published: publish, publishedAt: publish ? new Date() : null, updatedAt: new Date() } }
    );
    markCourseUpdated(user.institutionId);

    logActivity({
      lecturerId: user.userId || '',
      institutionId: user.institutionId,
      type: publish ? 'grades_published' : 'grades_unpublished',
      icon: publish ? '🎓' : '📕',
      title: publish ? 'Results Published' : 'Results Unpublished',
      description: `${(check.course as any).courseCode}`,
    });

    return c.json({ message: publish ? 'Results published' : 'Results unpublished', published: publish });
  } catch (error: any) {
    return c.json({ error: 'Failed to update publish state', details: error.message }, 500);
  }
});

// PUT /course/submission/:id/grade - Lecturer grades a submission
course.put('/submission/:submissionId/grade', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can grade' }, 403);
    const submissionId = c.req.param('submissionId');
    if (!ObjectId.isValid(submissionId)) return c.json({ error: 'Invalid ID' }, 400);

    const { score, feedback } = await c.req.json();
    if (score === undefined || score === null) {
      return c.json({ error: 'score is required' }, 400);
    }

    const db = getDatabase();
    const submission = await db.collection('assignment_submissions').findOne({
      _id: new ObjectId(submissionId), institutionId: user.institutionId
    });
    if (!submission) return c.json({ error: 'Submission not found' }, 404);

    // Get maxScore from the assignment
    const assignment = await db.collection('assignments').findOne({ _id: new ObjectId((submission as any).assignmentId) });
    const maxScore = (assignment as any)?.maxScore || 100;

    if (typeof score !== 'number' || score < 0 || score > maxScore) {
      return c.json({ error: `Score must be between 0 and ${maxScore}` }, 400);
    }

    await db.collection('assignment_submissions').updateOne(
      { _id: new ObjectId(submissionId) },
      { $set: { score, maxScore, feedback: (feedback || '').trim(), gradedAt: new Date(), gradedBy: user.email } }
    );

    markCourseUpdated(user.institutionId);
    logActivity({ lecturerId: user.userId || '', institutionId: user.institutionId, type: 'grade_posted', icon: '⭐', title: 'Grade Posted', description: `${(submission as any).studentName} — ${score}/${maxScore}` });
    return c.json({ message: 'Graded successfully' });
  } catch (error: any) {
    return c.json({ error: 'Failed to grade', details: error.message }, 500);
  }
});

// PUT /course/assignment/:id/maxscore - Set max score for an assignment
course.put('/assignment/:assignmentId/maxscore', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const id = c.req.param('assignmentId');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid ID' }, 400);

    const { maxScore } = await c.req.json();
    if (!maxScore || typeof maxScore !== 'number' || maxScore <= 0) {
      return c.json({ error: 'maxScore must be a positive number' }, 400);
    }

    const db = getDatabase();
    const assignment = await db.collection('assignments').findOne({ _id: new ObjectId(id), institutionId: user.institutionId });
    if (!assignment) return c.json({ error: 'Assignment not found' }, 404);

    await db.collection('assignments').updateOne(
      { _id: new ObjectId(id) },
      { $set: { maxScore, updatedAt: new Date() } }
    );

    // Also update maxScore on all existing graded submissions for consistency
    await db.collection('assignment_submissions').updateMany(
      { assignmentId: id, score: { $exists: true } },
      { $set: { maxScore } }
    );

    markCourseUpdated(user.institutionId);
    return c.json({ message: 'Max score updated' });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// PUT /course/:id - Admin updates a course
course.put('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'admin') return c.json({ error: 'Only admins can update courses' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid course ID' }, 400);

    const body = await c.req.json();
    const { courseCode, courseName, description, credits, department, level, semester, status, lecturerIds } = body;

    const db = getDatabase();
    const existing = await db.collection('courses').findOne({ _id: new ObjectId(id), institutionId: user.institutionId });
    if (!existing) return c.json({ error: 'Course not found' }, 404);

    const update: any = { updatedAt: new Date() };
    if (courseCode) update.courseCode = normalizeCourseCode(courseCode);
    if (courseName) update.courseName = courseName.trim();
    if (description !== undefined) update.description = description.trim();
    if (credits !== undefined) update.credits = credits;
    if (department) update.department = department.trim();
    if (level) update.level = level;
    if (semester !== undefined) update.semester = semester;
    if (status) update.status = status;
    if (lecturerIds) update.lecturerIds = lecturerIds;

    await db.collection('courses').updateOne({ _id: new ObjectId(id) }, { $set: update });
    markCourseUpdated(user.institutionId);
    return c.json({ message: 'Course updated' });
  } catch (error: any) {
    console.error('Error updating course:', error);
    return c.json({ error: 'Failed to update course', details: error.message }, 500);
  }
});

// DELETE /course/:id - Admin deletes a course
course.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'admin') return c.json({ error: 'Only admins can delete courses' }, 403);

    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid course ID' }, 400);

    const db = getDatabase();
    const result = await db.collection('courses').deleteOne({ _id: new ObjectId(id), institutionId: user.institutionId });
    if (result.deletedCount === 0) return c.json({ error: 'Course not found' }, 404);

    // Also delete associated materials
    await db.collection('course_materials').deleteMany({ courseId: id });

    markCourseUpdated(user.institutionId);
    return c.json({ message: 'Course and materials deleted' });
  } catch (error: any) {
    console.error('Error deleting course:', error);
    return c.json({ error: 'Failed to delete course', details: error.message }, 500);
  }
});

// ==================== LECTURER: COURSE MATERIALS ====================

// POST /course/:id/material - Lecturer uploads material (base64)
course.post('/:id/material', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers can upload materials' }, 403);

    const courseId = c.req.param('id');
    if (!ObjectId.isValid(courseId)) return c.json({ error: 'Invalid course ID' }, 400);

    const body = await c.req.json();
    const { title, category, description, fileName, fileData, fileType, fileSize } = body;

    if (!title || !fileName || !fileData) {
      return c.json({ error: 'Required: title, fileName, fileData' }, 400);
    }

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    // Verify lecturer is assigned to this course
    const courseDoc = await db.collection('courses').findOne({ _id: new ObjectId(courseId), institutionId: user.institutionId });
    if (!courseDoc) return c.json({ error: 'Course not found' }, 404);

    const lecturerName = `${lecturer.profile?.role || ''} ${lecturer.profile?.firstName} ${lecturer.profile?.lastName}`.trim();

    const material = {
      courseId,
      courseCode: (courseDoc as any).courseCode,
      title: title.trim(),
      category: category || 'General',
      description: (description || '').trim(),
      fileName, fileData, fileType: fileType || 'application/pdf',
      fileSize: fileSize || 0,
      uploadedBy: lecturer._id.toString(),
      lecturerName,
      institutionId: user.institutionId,
      department: (courseDoc as any).department,
      level: (courseDoc as any).level,
      status: 'published',
      downloads: 0,
      createdAt: new Date()
    };

    const result = await db.collection('course_materials').insertOne(material);
    markCourseUpdated(user.institutionId);
    logActivity({ lecturerId: lecturer._id.toString(), institutionId: user.institutionId, type: 'material_upload', icon: '📁', title: 'Material Uploaded', description: `${(courseDoc as any).courseCode} — ${title.trim()}` });
    return c.json({ message: 'Material uploaded', materialId: result.insertedId }, 201);
  } catch (error: any) {
    console.error('Error uploading material:', error);
    return c.json({ error: 'Failed to upload material', details: error.message }, 500);
  }
});

// GET /course/:id/materials - Get materials for a course
course.get('/:id/materials', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const courseId = c.req.param('id');
    if (!ObjectId.isValid(courseId)) return c.json({ error: 'Invalid course ID' }, 400);

    const db = getDatabase();
    // Return materials without fileData (too large for listing)
    const materials = await db.collection('course_materials')
      .find({ courseId, institutionId: user.institutionId, status: 'published' })
      .project({ fileData: 0 })
      .sort({ createdAt: -1 })
      .toArray();

    return c.json({ materials });
  } catch (error: any) {
    console.error('Error fetching materials:', error);
    return c.json({ error: 'Failed to fetch materials', details: error.message }, 500);
  }
});

// GET /course/material/:materialId/download - Download a material file
course.get('/material/:materialId/download', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const materialId = c.req.param('materialId');
    if (!ObjectId.isValid(materialId)) return c.json({ error: 'Invalid material ID' }, 400);

    const db = getDatabase();
    const material = await db.collection('course_materials').findOne({
      _id: new ObjectId(materialId), institutionId: user.institutionId
    });
    if (!material) return c.json({ error: 'Material not found' }, 404);

    // Increment download count
    await db.collection('course_materials').updateOne(
      { _id: new ObjectId(materialId) },
      { $inc: { downloads: 1 } }
    );

    return c.json({ fileName: material.fileName, fileData: material.fileData, fileType: material.fileType });
  } catch (error: any) {
    console.error('Error downloading material:', error);
    return c.json({ error: 'Failed to download', details: error.message }, 500);
  }
});

// DELETE /course/material/:materialId - Lecturer deletes a material
course.delete('/material/:materialId', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer' && user.userType !== 'admin') {
      return c.json({ error: 'Only lecturers and admins can delete materials' }, 403);
    }

    const materialId = c.req.param('materialId');
    if (!ObjectId.isValid(materialId)) return c.json({ error: 'Invalid material ID' }, 400);

    const db = getDatabase();
    const result = await db.collection('course_materials').deleteOne({
      _id: new ObjectId(materialId), institutionId: user.institutionId
    });
    if (result.deletedCount === 0) return c.json({ error: 'Material not found' }, 404);

    markCourseUpdated(user.institutionId);
    return c.json({ message: 'Material deleted' });
  } catch (error: any) {
    console.error('Error deleting material:', error);
    return c.json({ error: 'Failed to delete', details: error.message }, 500);
  }
});

// ==================== COURSE ANNOUNCEMENTS ====================

// POST /course/:id/announcement
course.post('/:id/announcement', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const courseId = c.req.param('id');
    if (!ObjectId.isValid(courseId)) return c.json({ error: 'Invalid course ID' }, 400);
    const { message } = await c.req.json();
    if (!message?.trim()) return c.json({ error: 'Message is required' }, 400);

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);
    const courseDoc = await db.collection('courses').findOne({ _id: new ObjectId(courseId), institutionId: user.institutionId });
    if (!courseDoc) return c.json({ error: 'Course not found' }, 404);

    const entry = {
      courseId, courseCode: (courseDoc as any).courseCode,
      message: message.trim(),
      lecturerName: `${lecturer.profile?.role || ''} ${lecturer.profile?.firstName} ${lecturer.profile?.lastName}`.trim(),
      lecturerId: lecturer._id.toString(),
      institutionId: user.institutionId,
      createdAt: new Date()
    };
    await db.collection('course_announcements').insertOne(entry);
    markCourseUpdated(user.institutionId);
    logActivity({ lecturerId: lecturer._id.toString(), institutionId: user.institutionId, type: 'announcement', icon: '📢', title: 'Announcement Posted', description: `${(courseDoc as any).courseCode} — ${message.trim().slice(0, 60)}` });
    return c.json({ message: 'Announcement posted' }, 201);
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// GET /course/:id/announcements
course.get('/:id/announcements', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const courseId = c.req.param('id');
    const db = getDatabase();
    const announcements = await db.collection('course_announcements')
      .find({ courseId, institutionId: user.institutionId })
      .sort({ createdAt: -1 }).limit(20).toArray();
    return c.json({ announcements });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// DELETE /course/announcement/:id
course.delete('/announcement/:announcementId', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer' && user.userType !== 'admin') return c.json({ error: 'Not allowed' }, 403);
    const id = c.req.param('announcementId');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid ID' }, 400);
    const db = getDatabase();
    await db.collection('course_announcements').deleteOne({ _id: new ObjectId(id), institutionId: user.institutionId });
    return c.json({ message: 'Deleted' });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// ==================== ASSIGNMENTS ====================

// POST /course/:id/assignment - Lecturer creates assignment
course.post('/:id/assignment', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const courseId = c.req.param('id');
    if (!ObjectId.isValid(courseId)) return c.json({ error: 'Invalid course ID' }, 400);
    const { title, description, deadline } = await c.req.json();
    if (!title?.trim() || !deadline) return c.json({ error: 'Title and deadline are required' }, 400);

    // Reject past deadlines
    const deadlineDate = new Date(deadline);
    if (deadlineDate <= new Date()) {
      return c.json({ error: 'Deadline must be in the future. Please select a later date and time.' }, 400);
    }

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);
    const courseDoc = await db.collection('courses').findOne({ _id: new ObjectId(courseId), institutionId: user.institutionId });
    if (!courseDoc) return c.json({ error: 'Course not found' }, 404);

    const entry = {
      courseId, courseCode: (courseDoc as any).courseCode,
      title: title.trim(), description: (description || '').trim(),
      deadline: new Date(deadline),
      lecturerId: lecturer._id.toString(),
      lecturerName: `${lecturer.profile?.role || ''} ${lecturer.profile?.firstName} ${lecturer.profile?.lastName}`.trim(),
      institutionId: user.institutionId,
      department: (courseDoc as any).department,
      level: (courseDoc as any).level,
      submissions: 0,
      createdAt: new Date()
    };
    const result = await db.collection('assignments').insertOne(entry);
    markCourseUpdated(user.institutionId);
    logActivity({ lecturerId: lecturer._id.toString(), institutionId: user.institutionId, type: 'assignment_created', icon: '📝', title: 'Assignment Created', description: `${(courseDoc as any).courseCode} — ${title.trim()}` });

    // Notify students in this course via email (async, don't block response)
    (async () => {
      try {
        // Debug: check what institutionId looks like
        const debugStudents = await db.collection('users').find({
          userType: 'student',
          'profile.department': (courseDoc as any).department,
        }).limit(3).toArray();
        console.log(`📧 DEBUG: institutionId from JWT = "${user.institutionId}" (type: ${typeof user.institutionId})`);
        for (const ds of debugStudents) {
          console.log(`📧 DEBUG: student ${(ds as any).email} institutionId = "${(ds as any).institutionId}" (type: ${typeof (ds as any).institutionId}), status = ${(ds as any).status}`);
        }

        const students = await db.collection('users').find({
          institutionId: new ObjectId(user.institutionId),
          userType: 'student',
          'profile.department': (courseDoc as any).department,
          status: { $in: ['active', 'pending'] },
        }).toArray();

        const lecName = entry.lecturerName;
        let count = 0;
        console.log(`📧 Found ${students.length} student(s) in dept ${(courseDoc as any).department}. Filtering by level ${(courseDoc as any).level}...`);
        for (const s of students) {
          const st = s as any;
          const studentLevel = yearToLevel(st.profile?.year || '');
          if ((courseDoc as any).level && studentLevel !== (courseDoc as any).level) {
            console.log(`  ⏭ Skipping ${st.email} — level ${st.profile?.year} (${studentLevel}) ≠ ${(courseDoc as any).level}`);
            continue;
          }
          console.log(`📧 Sending new assignment email to ${st.email}...`);
          await sendNewAssignmentEmail(
            st.email,
            `${st.profile?.firstName || ''} ${st.profile?.lastName || ''}`.trim(),
            (courseDoc as any).courseCode,
            (courseDoc as any).courseName,
            title.trim(),
            (description || '').trim(),
            new Date(deadline),
            lecName
          );
          count++;
          // Small delay to avoid Mailtrap rate limits
          if (count < students.length) await new Promise(r => setTimeout(r, 1500));
        }
        if (count > 0) console.log(`📧 New assignment email sent to ${count} student(s)`);
        else console.log(`📧 No eligible students found for assignment notification (dept: ${(courseDoc as any).department}, level: ${(courseDoc as any).level})`);
      } catch (e) { console.error('Failed to send new assignment emails:', e); }
    })();

    return c.json({ message: 'Assignment created', assignmentId: result.insertedId }, 201);
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// GET /course/:id/assignments
course.get('/:id/assignments', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const courseId = c.req.param('id');
    const db = getDatabase();
    const assignments = await db.collection('assignments')
      .find({ courseId, institutionId: user.institutionId })
      .sort({ deadline: 1 }).toArray();

    // If student, attach their submission status
    if (user.userType === 'student') {
      const student = await db.collection('users').findOne({ email: user.email });
      if (student) {
        const submissions = await db.collection('assignment_submissions')
          .find({ studentId: student._id.toString(), courseId }).toArray();
        const subMap: Record<string, any> = {};
        for (const s of submissions) subMap[(s as any).assignmentId] = s;
        for (const a of assignments) {
          (a as any).mySubmission = subMap[(a as any)._id.toString()] || null;
        }
      }
    }

    return c.json({ assignments });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// DELETE /course/assignment/:id
course.delete('/assignment/:assignmentId', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const id = c.req.param('assignmentId');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid ID' }, 400);
    const db = getDatabase();
    await db.collection('assignments').deleteOne({ _id: new ObjectId(id), institutionId: user.institutionId });
    await db.collection('assignment_submissions').deleteMany({ assignmentId: id });
    return c.json({ message: 'Assignment deleted' });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// POST /course/assignment/:id/submit - Student submits assignment
course.post('/assignment/:assignmentId/submit', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'student') return c.json({ error: 'Only students' }, 403);
    const assignmentId = c.req.param('assignmentId');
    if (!ObjectId.isValid(assignmentId)) return c.json({ error: 'Invalid ID' }, 400);

    const { fileName, fileData, fileType, fileSize, comment } = await c.req.json();
    if (!fileName || !fileData) return c.json({ error: 'File is required' }, 400);

    const db = getDatabase();
    const student = await db.collection('users').findOne({ email: user.email });
    if (!student) return c.json({ error: 'Student not found' }, 404);

    const assignment = await db.collection('assignments').findOne({ _id: new ObjectId(assignmentId) });
    if (!assignment) return c.json({ error: 'Assignment not found' }, 404);

    // Check deadline
    if (new Date() > new Date((assignment as any).deadline)) {
      return c.json({ error: 'Deadline has passed' }, 400);
    }

    // Check for existing submission (allow resubmit)
    await db.collection('assignment_submissions').deleteMany({ assignmentId, studentId: student._id.toString() });

    const submission = {
      assignmentId, courseId: (assignment as any).courseId,
      studentId: student._id.toString(),
      studentName: `${student.profile?.firstName} ${student.profile?.lastName}`,
      studentEmail: student.email,
      fileName, fileData, fileType: fileType || 'application/pdf', fileSize: fileSize || 0,
      comment: (comment || '').trim(),
      institutionId: user.institutionId,
      submittedAt: new Date()
    };
    await db.collection('assignment_submissions').insertOne(submission);

    // Increment submission count
    await db.collection('assignments').updateOne({ _id: new ObjectId(assignmentId) }, { $inc: { submissions: 1 } });

    markCourseUpdated(user.institutionId);
    return c.json({ message: 'Assignment submitted' }, 201);
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// GET /course/assignment/:id/submissions - Lecturer views submissions
course.get('/assignment/:assignmentId/submissions', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const assignmentId = c.req.param('assignmentId');
    const db = getDatabase();
    const submissions = await db.collection('assignment_submissions')
      .find({ assignmentId, institutionId: user.institutionId })
      .project({ fileData: 0 })
      .sort({ submittedAt: -1 }).toArray();
    return c.json({ submissions });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// GET /course/submission/:id/download - Lecturer downloads a submission file
course.get('/submission/:submissionId/download', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const submissionId = c.req.param('submissionId');
    if (!ObjectId.isValid(submissionId)) return c.json({ error: 'Invalid ID' }, 400);
    const db = getDatabase();
    const submission = await db.collection('assignment_submissions').findOne({
      _id: new ObjectId(submissionId), institutionId: user.institutionId
    });
    if (!submission) return c.json({ error: 'Submission not found' }, 404);
    return c.json({ fileName: submission.fileName, fileData: submission.fileData, fileType: submission.fileType });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});


// GET /course/assignment/:id/plagiarism
course.get('/assignment/:assignmentId/plagiarism', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const assignmentId = c.req.param('assignmentId');
    const db = getDatabase();
    const submissions = await db.collection('assignment_submissions')
      .find({ assignmentId, institutionId: user.institutionId })
      .toArray();
    if (submissions.length < 2) {
      return c.json({ message: 'Need at least 2 submissions to check', results: [] });
    }
    const { detectPlagiarism } = await import('../utils/plagiarism.js');
    const results = detectPlagiarism(
      submissions.map((s: any) => ({ _id: s._id.toString(), studentName: s.studentName, fileData: s.fileData || '' }))
    );
    return c.json({ results, totalSubmissions: submissions.length, flaggedPairs: results.length });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});


// ==================== COURSE ENROLLMENTS (ROSTER) ====================

// Tiny helper used only by enrollment endpoints below.
async function assertCanManageCourse(
  user: { userType: string; email: string; institutionId: string },
  courseId: string
) {
  if (!ObjectId.isValid(courseId)) {
    return { error: 'Invalid course ID', status: 400 as const };
  }
  const db = getDatabase();
  const courseDoc = await db.collection('courses').findOne({
    _id: new ObjectId(courseId),
    institutionId: user.institutionId,
  });
  if (!courseDoc) return { error: 'Course not found', status: 404 as const };

  if (user.userType === 'admin') return { course: courseDoc };
  if (user.userType !== 'lecturer') return { error: 'Forbidden', status: 403 as const };

  const caller = await db.collection('users').findOne({ email: user.email });
  if (!caller) return { error: 'Caller not found', status: 404 as const };
  const lecturerIds: string[] = (courseDoc as any).lecturerIds || [];
  if (!lecturerIds.includes(caller._id.toString())) {
    return { error: 'You are not assigned to this course', status: 403 as const };
  }
  return { course: courseDoc, caller };
}

// GET /course/:id/roster — list enrolled students with presence summary
course.get('/:id/roster', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') {
      return c.json({ error: 'Students cannot view rosters' }, 403);
    }

    const courseId = c.req.param('id');
    const check = await assertCanManageCourse(user, courseId);
    if ('error' in check) return c.json({ error: check.error }, check.status);

    const enrollmentsCol = getEnrollmentsCollection();
    const enrollments = await enrollmentsCol
      .find({ courseId: new ObjectId(courseId), status: 'active' })
      .toArray();

    const studentIds = enrollments.map(e => e.studentId);
    const db = getDatabase();
    const students = studentIds.length
      ? await db.collection('users')
          .find(
            { _id: { $in: studentIds } },
            {
              projection: {
                email: 1,
                status: 1,
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

    const enrollmentMap = new Map(
      enrollments.map(e => [e.studentId.toString(), e])
    );

    const roster = students
      .map(s => {
        const enr = enrollmentMap.get(s._id.toString());
        return {
          studentId: s._id.toString(),
          studentNumber: s.profile?.studentId || '',
          firstName: s.profile?.firstName || '',
          lastName: s.profile?.lastName || '',
          name: `${s.profile?.firstName || ''} ${s.profile?.lastName || ''}`.trim(),
          email: s.email,
          department: s.profile?.department || '',
          year: s.profile?.year || '',
          avatar: s.profile?.avatar || null,
          status: s.status,
          enrolledAt: enr?.enrolledAt || null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return c.json({
      course: {
        _id: (check.course as any)._id.toString(),
        courseCode: (check.course as any).courseCode,
        courseName: (check.course as any).courseName,
        department: (check.course as any).department,
        level: (check.course as any).level,
      },
      roster,
      total: roster.length,
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch roster', details: error.message }, 500);
  }
});

// POST /course/:id/roster — enroll one or many students by Mongo _id
course.post('/:id/roster', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const courseId = c.req.param('id');
    const check = await assertCanManageCourse(user, courseId);
    if ('error' in check) return c.json({ error: check.error }, check.status);

    const body = await c.req.json();
    const rawIds: string[] = Array.isArray(body?.studentIds)
      ? body.studentIds
      : body?.studentId
        ? [body.studentId]
        : [];

    const validIds = rawIds.filter((id): id is string => typeof id === 'string' && ObjectId.isValid(id));
    if (validIds.length === 0) {
      return c.json({ error: 'Provide studentIds[] or studentId' }, 400);
    }

    const db = getDatabase();
    const usersCol = db.collection('users');

    // Confirm they're real students from the same institution before enrolling.
    const objectIds = validIds.map(id => new ObjectId(id));
    const validStudents = await usersCol
      .find(
        {
          _id: { $in: objectIds },
          userType: 'student',
          institutionId: new ObjectId(user.institutionId),
        },
        { projection: { _id: 1 } }
      )
      .toArray();
    const validStudentSet = new Set(validStudents.map(s => s._id.toString()));

    const callerObj = check.caller
      ? check.caller._id
      : (await usersCol.findOne({ email: user.email }))?._id;
    if (!callerObj) return c.json({ error: 'Caller not found' }, 404);

    const enrollmentsCol = getEnrollmentsCollection();
    const now = new Date();
    let added = 0;
    let skipped = 0;

    for (const studentId of validStudentSet) {
      const studentObj = new ObjectId(studentId);
      const result = await enrollmentsCol.updateOne(
        { courseId: new ObjectId(courseId), studentId: studentObj },
        {
          $setOnInsert: {
            courseId: new ObjectId(courseId),
            studentId: studentObj,
            institutionId: user.institutionId,
            enrolledBy: callerObj,
            enrolledByType: (user.userType === 'admin' ? 'admin' : 'lecturer') as 'admin' | 'lecturer',
            status: 'active',
            enrolledAt: now,
          },
        },
        { upsert: true }
      );
      if (result.upsertedCount > 0) added += 1;
      else {
        // Re-activate withdrawn students if they're re-added
        const reactivated = await enrollmentsCol.updateOne(
          {
            courseId: new ObjectId(courseId),
            studentId: studentObj,
            status: 'withdrawn',
          },
          { $set: { status: 'active', enrolledAt: now, withdrawnAt: null } }
        );
        if (reactivated.modifiedCount > 0) added += 1;
        else skipped += 1;
      }
    }

    const notFound = validIds.length - validStudentSet.size;
    return c.json({
      message: 'Enrollment processed',
      added,
      alreadyEnrolled: skipped,
      notFound,
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to enroll students', details: error.message }, 500);
  }
});

// POST /course/:id/roster/bulk-by-criteria — auto-enroll all matching students
//   Body: { department?, level? } — defaults to the course's department/level
course.post('/:id/roster/bulk-by-criteria', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const courseId = c.req.param('id');
    const check = await assertCanManageCourse(user, courseId);
    if ('error' in check) return c.json({ error: check.error }, check.status);

    const body = await c.req.json().catch(() => ({}));
    const department = body?.department || (check.course as any).department;
    const level = body?.level || (check.course as any).level;

    if (!department || !level) {
      return c.json({ error: 'department and level required' }, 400);
    }

    const db = getDatabase();
    const callerObj = check.caller
      ? check.caller._id
      : (await db.collection('users').findOne({ email: user.email }))?._id;
    if (!callerObj) return c.json({ error: 'Caller not found' }, 404);

    // Match the same year-format helper used elsewhere in this file.
    const matchingStudents = await db.collection('users').find({
      institutionId: new ObjectId(user.institutionId),
      userType: 'student',
      'profile.department': department,
      status: { $in: ['active', 'pending'] },
    }).project({ _id: 1, 'profile.year': 1 }).toArray();

    const matched = matchingStudents.filter(s => {
      const y = (s as any).profile?.year || '';
      return yearToLevel(y) === level;
    });

    if (matched.length === 0) return c.json({ message: 'No matching students', added: 0 });

    const enrollmentsCol = getEnrollmentsCollection();
    const now = new Date();
    const bulk = matched.map(s => ({
      updateOne: {
        filter: {
          courseId: new ObjectId(courseId),
          studentId: (s as any)._id,
        },
        update: {
          $setOnInsert: {
            courseId: new ObjectId(courseId),
            studentId: (s as any)._id,
            institutionId: user.institutionId,
            enrolledBy: callerObj,
            enrolledByType: (user.userType === 'admin' ? 'admin' : 'lecturer') as 'admin' | 'lecturer',
            status: 'active',
            enrolledAt: now,
          },
        },
        upsert: true,
      },
    }));

    const result = await enrollmentsCol.bulkWrite(bulk);
    return c.json({
      message: 'Bulk enroll complete',
      candidates: matched.length,
      added: result.upsertedCount,
      alreadyEnrolled: matched.length - result.upsertedCount,
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to bulk enroll', details: error.message }, 500);
  }
});

// DELETE /course/:id/roster/:studentId — withdraw a student (soft-delete)
course.delete('/:id/roster/:studentId', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const courseId = c.req.param('id');
    const studentId = c.req.param('studentId');
    if (!ObjectId.isValid(studentId)) return c.json({ error: 'Invalid student ID' }, 400);

    const check = await assertCanManageCourse(user, courseId);
    if ('error' in check) return c.json({ error: check.error }, check.status);

    const enrollmentsCol = getEnrollmentsCollection();
    const result = await enrollmentsCol.updateOne(
      {
        courseId: new ObjectId(courseId),
        studentId: new ObjectId(studentId),
        status: 'active',
      },
      { $set: { status: 'withdrawn', withdrawnAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return c.json({ error: 'Student is not in this roster' }, 404);
    }
    return c.json({ message: 'Student removed from roster' });
  } catch (error: any) {
    return c.json({ error: 'Failed to remove student', details: error.message }, 500);
  }
});

// GET /course/:id/roster/candidates — students NOT yet enrolled, scoped to dept/level
course.get('/:id/roster/candidates', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType === 'student') return c.json({ error: 'Forbidden' }, 403);

    const courseId = c.req.param('id');
    const check = await assertCanManageCourse(user, courseId);
    if ('error' in check) return c.json({ error: check.error }, check.status);

    const search = (c.req.query('search') || '').trim().toLowerCase();
    const restrictDept = c.req.query('restrict') !== 'false'; // default true

    const enrollmentsCol = getEnrollmentsCollection();
    const enrolled = await enrollmentsCol
      .find({ courseId: new ObjectId(courseId), status: 'active' })
      .project({ studentId: 1 })
      .toArray();
    const enrolledSet = new Set(enrolled.map(e => (e as any).studentId.toString()));

    const db = getDatabase();
    const q: any = {
      institutionId: new ObjectId(user.institutionId),
      userType: 'student',
      status: { $in: ['active', 'pending'] },
    };
    if (restrictDept) {
      q['profile.department'] = (check.course as any).department;
    }

    const candidatesRaw = await db.collection('users').find(q, {
      projection: {
        email: 1,
        'profile.firstName': 1,
        'profile.lastName': 1,
        'profile.studentId': 1,
        'profile.department': 1,
        'profile.year': 1,
        'profile.avatar': 1,
      },
    }).limit(500).toArray();

    const filtered = candidatesRaw
      .filter(s => !enrolledSet.has(s._id.toString()))
      .filter(s => {
        if (!search) return true;
        const haystack = [
          (s as any).profile?.firstName,
          (s as any).profile?.lastName,
          (s as any).profile?.studentId,
          (s as any).email,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(search);
      })
      .map(s => ({
        studentId: s._id.toString(),
        studentNumber: (s as any).profile?.studentId || '',
        name: `${(s as any).profile?.firstName || ''} ${(s as any).profile?.lastName || ''}`.trim(),
        email: (s as any).email,
        department: (s as any).profile?.department || '',
        year: (s as any).profile?.year || '',
        avatar: (s as any).profile?.avatar || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 200);

    return c.json({ candidates: filtered, total: filtered.length });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch candidates', details: error.message }, 500);
  }
});

export default course;
