import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { getDatabase } from '../database/connection.js';

const lecturers = new Hono();

// Get students by department and level (for lecturers)
lecturers.get('/students', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    
    // Only lecturers can access this endpoint
    if (user.userType !== 'lecturer') {
      return c.json({ error: 'Unauthorized. Only lecturers can access this endpoint.' }, 403);
    }

    const db = getDatabase();
    const usersCollection = db.collection('users');

    // Get lecturer's profile to find their department
    const lecturer = await usersCollection.findOne({ email: user.email });
    
    if (!lecturer || !lecturer.profile?.department) {
      return c.json({ error: 'Lecturer department not found' }, 404);
    }

    const lecturerDepartment = lecturer.profile.department;
    const level = c.req.query('level'); // Optional level filter
    const search = c.req.query('search'); // Optional search term

    // Build query
    const query: any = {
      userType: 'student',
      'profile.department': lecturerDepartment,
      status: { $in: ['active', 'pending'] }
    };

    // Add level filter if provided
    if (level) {
      query['profile.year'] = level;
    }

    // Add search filter if provided
    if (search) {
      query.$or = [
        { 'profile.firstName': { $regex: search, $options: 'i' } },
        { 'profile.lastName': { $regex: search, $options: 'i' } },
        { 'profile.studentId': { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Fetch students
    const students = await usersCollection
      .find(query)
      .project({
        passwordHash: 0,
        passwordHistory: 0
      })
      .sort({ 'profile.year': 1, 'profile.lastName': 1, 'profile.firstName': 1 })
      .toArray();

    // Group by level if no specific level is requested
    const groupedByLevel: Record<string, any[]> = {};
    
    students.forEach(student => {
      const studentLevel = student.profile?.year || 'Unknown';
      if (!groupedByLevel[studentLevel]) {
        groupedByLevel[studentLevel] = [];
      }
      groupedByLevel[studentLevel].push({
        id: student._id,
        email: student.email,
        status: student.status,
        emailVerified: student.emailVerified,
        profile: student.profile,
        createdAt: student.createdAt,
        updatedAt: student.updatedAt
      });
    });

    return c.json({
      department: lecturerDepartment,
      totalStudents: students.length,
      students: level ? students.map(s => ({
        id: s._id,
        email: s.email,
        status: s.status,
        emailVerified: s.emailVerified,
        profile: s.profile,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      })) : undefined,
      groupedByLevel: !level ? groupedByLevel : undefined,
      levels: Object.keys(groupedByLevel).sort()
    });

  } catch (error: any) {
    console.error('Error fetching students:', error);
    return c.json({ error: 'Failed to fetch students', details: error.message }, 500);
  }
});

// GET /lecturers/stats - Real-time lecturer dashboard stats
lecturers.get('/stats', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    const lecturerId = lecturer._id.toString();
    const institutionId = lecturer.institutionId;
    const department = lecturer.profile?.department || '';

    // Total courses assigned to this lecturer or in their department
    const totalCourses = await db.collection('courses').countDocuments({
      institutionId,
      $or: [{ lecturerIds: lecturerId }, { department }]
    });

    // Total students in lecturer's department
    const totalStudents = await db.collection('users').countDocuments({
      institutionId,
      userType: 'student',
      'profile.department': department,
      status: { $in: ['active', 'pending'] }
    });

    // Total schedule entries this week
    const now = new Date();
    const day = now.getDay();
    const mondayDiff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(mondayDiff);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    const mondayStr = monday.toISOString().split('T')[0];
    const sundayStr = sunday.toISOString().split('T')[0];

    const totalClassesThisWeek = await db.collection('schedules').countDocuments({
      lecturerId: lecturer._id,
      date: { $gte: mondayStr, $lte: sundayStr },
      status: { $ne: 'cancelled' }
    });

    // Today's classes
    const todayStr = now.toISOString().split('T')[0];
    const todayClasses = await db.collection('schedules').countDocuments({
      lecturerId: lecturer._id,
      date: todayStr,
      status: { $ne: 'cancelled' }
    });

    // Total assignments created by this lecturer
    const totalAssignments = await db.collection('assignments').countDocuments({
      lecturerId: lecturerId,
      institutionId
    });

    // Pending submissions to grade (submissions without a score)
    const pendingGrading = await db.collection('assignment_submissions').countDocuments({
      institutionId,
      score: { $exists: false }
    });

    // Total quizzes
    const totalQuizzes = await db.collection('quizzes').countDocuments({
      lecturerId: lecturerId,
      institutionId
    });

    // Total materials uploaded
    const totalMaterials = await db.collection('course_materials').countDocuments({
      uploadedBy: lecturerId,
      institutionId
    });

    return c.json({
      stats: {
        totalCourses,
        totalStudents,
        totalClassesThisWeek,
        todayClasses,
        totalAssignments,
        pendingGrading,
        totalQuizzes,
        totalMaterials,
      }
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to fetch stats', details: error.message }, 500);
  }
});

export default lecturers;
