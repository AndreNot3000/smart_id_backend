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

export default lecturers;
