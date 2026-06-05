import { Hono } from 'hono';
import { ObjectId } from 'mongodb';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { getDatabase } from '../database/connection.js';

const quiz = new Hono();

// Change tracker for real-time polling
let quizLastUpdated: Record<string, number> = {};

function markQuizUpdated(institutionId: string) {
  quizLastUpdated[institutionId] = Date.now();
}

// GET /quiz/updates - Poll for quiz changes
quiz.get('/updates', authMiddleware, async (c) => {
  const user = c.get('user');
  const since = parseInt(c.req.query('since') || '0');
  const lastUpdate = quizLastUpdated[user.institutionId] || 0;
  return c.json({ updated: lastUpdate > since, timestamp: lastUpdate });
});

// ==================== HELPERS ====================

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

function yearToLevel(year: string): string {
  if (!year) return '';
  if (/^\d+L$/i.test(year)) return year.toUpperCase();
  const match = year.match(/Year\s*(\d+)/i);
  if (match?.[1]) return `${parseInt(match[1]) * 100}L`;
  const numMatch = year.match(/(\d+)/);
  if (numMatch?.[1]) return `${parseInt(numMatch[1]) * 100}L`;
  return year;
}

// ==================== LECTURER: CREATE QUIZ ====================

quiz.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);

    const body = await c.req.json();
    const { courseId, title, description, timeLimit, startDate, endDate, questions, settings } = body;

    if (!courseId || !title?.trim() || !questions?.length) {
      return c.json({ error: 'courseId, title, and questions are required' }, 400);
    }
    if (!timeLimit || timeLimit < 1) return c.json({ error: 'timeLimit (minutes) is required' }, 400);

    const db = getDatabase();
    const lecturer = await db.collection('users').findOne({ email: user.email });
    if (!lecturer) return c.json({ error: 'Lecturer not found' }, 404);

    const courseDoc = await db.collection('courses').findOne({ _id: new ObjectId(courseId), institutionId: user.institutionId });
    if (!courseDoc) return c.json({ error: 'Course not found' }, 404);

    // Validate questions
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.text?.trim()) return c.json({ error: `Question ${i + 1} text is required` }, 400);
      if (!['mcq', 'true_false', 'short_answer'].includes(q.type)) {
        return c.json({ error: `Question ${i + 1}: type must be mcq, true_false, or short_answer` }, 400);
      }
      if (q.type === 'mcq') {
        if (!q.options?.length || q.options.length < 2) return c.json({ error: `Question ${i + 1}: MCQ needs at least 2 options` }, 400);
        if (q.correctAnswer === undefined || q.correctAnswer === null) return c.json({ error: `Question ${i + 1}: correctAnswer index required` }, 400);
      }
      if (q.type === 'true_false' && q.correctAnswer === undefined) {
        return c.json({ error: `Question ${i + 1}: correctAnswer (true/false) required` }, 400);
      }
      q.points = q.points || 1;
    }

    const entry = {
      courseId,
      courseCode: (courseDoc as any).courseCode,
      courseName: (courseDoc as any).courseName,
      title: title.trim(),
      description: (description || '').trim(),
      timeLimit, // minutes
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      questions, // stored with correct answers
      totalPoints: questions.reduce((sum: number, q: any) => sum + (q.points || 1), 0),
      settings: {
        randomizeQuestions: settings?.randomizeQuestions ?? true,
        randomizeOptions: settings?.randomizeOptions ?? true,
        showOneAtATime: settings?.showOneAtATime ?? false,
        allowBacktrack: settings?.allowBacktrack ?? true,
        releaseResults: settings?.releaseResults ?? false,
      },
      lecturerId: lecturer._id.toString(),
      lecturerName: `${lecturer.profile?.role || ''} ${lecturer.profile?.firstName} ${lecturer.profile?.lastName}`.trim(),
      institutionId: user.institutionId,
      department: (courseDoc as any).department,
      level: (courseDoc as any).level,
      status: 'active',
      createdAt: new Date(),
    };

    const result = await db.collection('quizzes').insertOne(entry);
    markQuizUpdated(user.institutionId);
    return c.json({ message: 'Quiz created', quizId: result.insertedId }, 201);
  } catch (error: any) {
    return c.json({ error: 'Failed to create quiz', details: error.message }, 500);
  }
});

// ==================== LECTURER: LIST QUIZZES FOR A COURSE ====================

quiz.get('/course/:courseId', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const courseId = c.req.param('courseId');
    const db = getDatabase();

    const quizzes = await db.collection('quizzes')
      .find({ courseId, institutionId: user.institutionId })
      .sort({ createdAt: -1 }).toArray();

    // For students: don't expose correct answers, attach their attempt
    if (user.userType === 'student') {
      const student = await db.collection('users').findOne({ email: user.email });
      const attempts = student ? await db.collection('quiz_attempts')
        .find({ studentId: student._id.toString(), courseId }).toArray() : [];
      const attemptMap: Record<string, any> = {};
      for (const a of attempts) attemptMap[(a as any).quizId] = a;

      return c.json({
        quizzes: quizzes.map((q: any) => ({
          _id: q._id,
          title: q.title,
          description: q.description,
          timeLimit: q.timeLimit,
          startDate: q.startDate,
          endDate: q.endDate,
          totalPoints: q.totalPoints,
          questionCount: q.questions.length,
          settings: q.settings,
          status: q.status,
          createdAt: q.createdAt,
          myAttempt: attemptMap[q._id.toString()] || null,
        }))
      });
    }

    // For lecturers: include submission count
    for (const q of quizzes) {
      const count = await db.collection('quiz_attempts').countDocuments({ quizId: (q as any)._id.toString() });
      (q as any).attemptCount = count;
    }

    return c.json({ quizzes });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});


// ==================== LECTURER: DELETE QUIZ ====================

quiz.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const id = c.req.param('id');
    if (!ObjectId.isValid(id)) return c.json({ error: 'Invalid ID' }, 400);
    const db = getDatabase();
    await db.collection('quizzes').deleteOne({ _id: new ObjectId(id), institutionId: user.institutionId });
    await db.collection('quiz_attempts').deleteMany({ quizId: id });
    markQuizUpdated(user.institutionId);
    return c.json({ message: 'Quiz deleted' });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// ==================== LECTURER: TOGGLE RESULTS RELEASE ====================

quiz.put('/:id/release', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const id = c.req.param('id');
    const db = getDatabase();
    const q = await db.collection('quizzes').findOne({ _id: new ObjectId(id), institutionId: user.institutionId });
    if (!q) return c.json({ error: 'Quiz not found' }, 404);
    const newVal = !(q as any).settings?.releaseResults;
    await db.collection('quizzes').updateOne({ _id: new ObjectId(id) }, { $set: { 'settings.releaseResults': newVal } });
    markQuizUpdated(user.institutionId);
    return c.json({ message: newVal ? 'Results released' : 'Results hidden', released: newVal });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// ==================== LECTURER: VIEW ATTEMPTS ====================

quiz.get('/:id/attempts', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const quizId = c.req.param('id');
    const db = getDatabase();
    const attempts = await db.collection('quiz_attempts')
      .find({ quizId, institutionId: user.institutionId })
      .sort({ submittedAt: -1 }).toArray();
    return c.json({ attempts });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// ==================== STUDENT: START QUIZ ====================

quiz.post('/:id/start', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'student') return c.json({ error: 'Only students' }, 403);
    const quizId = c.req.param('id');
    if (!ObjectId.isValid(quizId)) return c.json({ error: 'Invalid ID' }, 400);

    const db = getDatabase();
    const student = await db.collection('users').findOne({ email: user.email });
    if (!student) return c.json({ error: 'Student not found' }, 404);

    const quizDoc = await db.collection('quizzes').findOne({ _id: new ObjectId(quizId) });
    if (!quizDoc) return c.json({ error: 'Quiz not found' }, 404);
    const q = quizDoc as any;

    // Check availability window
    const now = new Date();
    if (q.startDate && now < new Date(q.startDate)) return c.json({ error: 'Quiz has not started yet' }, 400);
    if (q.endDate && now > new Date(q.endDate)) return c.json({ error: 'Quiz has ended' }, 400);

    // Check if already attempted
    const existing = await db.collection('quiz_attempts').findOne({ quizId, studentId: student._id.toString() });
    if (existing && (existing as any).submittedAt) return c.json({ error: 'You have already completed this quiz' }, 400);

    // If there's an in-progress attempt, return it
    if (existing && !(existing as any).submittedAt) {
      const elapsed = (now.getTime() - new Date((existing as any).startedAt).getTime()) / 60000;
      if (elapsed > q.timeLimit) {
        // Time expired — auto-submit with whatever they had
        await autoGradeAndSubmit(db, existing as any, q);
        return c.json({ error: 'Time expired. Quiz auto-submitted.' }, 400);
      }
      // Return existing in-progress attempt
      return c.json({ attempt: existing, quiz: sanitizeQuizForStudent(q, (existing as any).questionOrder) });
    }

    // Create new attempt
    let questionOrder = q.questions.map((_: any, i: number) => i);
    if (q.settings?.randomizeQuestions) questionOrder = shuffleArray(questionOrder);

    // Generate randomized option orders for MCQs
    const optionOrders: Record<number, number[]> = {};
    for (const idx of questionOrder) {
      const question = q.questions[idx];
      if (question.type === 'mcq' && q.settings?.randomizeOptions) {
        optionOrders[idx] = shuffleArray(question.options.map((_: any, i: number) => i));
      }
    }

    const attempt = {
      quizId,
      courseId: q.courseId,
      studentId: student._id.toString(),
      studentName: `${student.profile?.firstName || ''} ${student.profile?.lastName || ''}`.trim(),
      studentEmail: student.email,
      institutionId: user.institutionId,
      questionOrder,
      optionOrders,
      answers: {},
      tabSwitches: 0,
      startedAt: now,
      submittedAt: null,
      score: null,
      totalPoints: q.totalPoints,
    };

    const result = await db.collection('quiz_attempts').insertOne(attempt);
    return c.json({
      attempt: { ...attempt, _id: result.insertedId },
      quiz: sanitizeQuizForStudent(q, questionOrder, optionOrders)
    });
  } catch (error: any) {
    return c.json({ error: 'Failed to start quiz', details: error.message }, 500);
  }
});

// ==================== STUDENT: SAVE ANSWER ====================

quiz.put('/:id/answer', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'student') return c.json({ error: 'Only students' }, 403);
    const quizId = c.req.param('id');
    const { questionIndex, answer } = await c.req.json();

    const db = getDatabase();
    const student = await db.collection('users').findOne({ email: user.email });
    if (!student) return c.json({ error: 'Student not found' }, 404);

    const attempt = await db.collection('quiz_attempts').findOne({ quizId, studentId: student._id.toString(), submittedAt: null });
    if (!attempt) return c.json({ error: 'No active attempt' }, 400);

    await db.collection('quiz_attempts').updateOne(
      { _id: attempt._id },
      { $set: { [`answers.${questionIndex}`]: answer } }
    );

    return c.json({ message: 'Answer saved' });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// ==================== STUDENT: LOG TAB SWITCH ====================

quiz.put('/:id/tabswitch', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'student') return c.json({ error: 'Only students' }, 403);
    const quizId = c.req.param('id');
    const db = getDatabase();
    const student = await db.collection('users').findOne({ email: user.email });
    if (!student) return c.json({ error: 'Student not found' }, 404);

    await db.collection('quiz_attempts').updateOne(
      { quizId, studentId: student._id.toString(), submittedAt: null },
      { $inc: { tabSwitches: 1 } }
    );
    return c.json({ message: 'Logged' });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// ==================== STUDENT: SUBMIT QUIZ ====================

quiz.post('/:id/submit', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'student') return c.json({ error: 'Only students' }, 403);
    const quizId = c.req.param('id');

    const db = getDatabase();
    const student = await db.collection('users').findOne({ email: user.email });
    if (!student) return c.json({ error: 'Student not found' }, 404);

    const attempt = await db.collection('quiz_attempts').findOne({ quizId, studentId: student._id.toString(), submittedAt: null });
    if (!attempt) return c.json({ error: 'No active attempt found' }, 400);

    const quizDoc = await db.collection('quizzes').findOne({ _id: new ObjectId(quizId) });
    if (!quizDoc) return c.json({ error: 'Quiz not found' }, 404);

    const result = await autoGradeAndSubmit(db, attempt as any, quizDoc as any);
    return c.json({ message: 'Quiz submitted', score: result.score, totalPoints: result.totalPoints, percentage: result.percentage });
  } catch (error: any) {
    return c.json({ error: 'Failed to submit', details: error.message }, 500);
  }
});

// ==================== AUTO-GRADE HELPER ====================

async function autoGradeAndSubmit(db: any, attempt: any, quiz: any) {
  let score = 0;
  const graded: Record<string, { correct: boolean; points: number }> = {};

  for (const [qIdx, answer] of Object.entries(attempt.answers || {})) {
    const questionIndex = parseInt(qIdx);
    const question = quiz.questions[questionIndex];
    if (!question) continue;

    let isCorrect = false;
    if (question.type === 'mcq') {
      // Answer is the displayed option index — need to map back through optionOrders
      const optionOrder = attempt.optionOrders?.[questionIndex];
      const actualAnswer = optionOrder ? optionOrder[answer as number] : answer;
      isCorrect = actualAnswer === question.correctAnswer;
    } else if (question.type === 'true_false') {
      isCorrect = answer === question.correctAnswer;
    }
    // short_answer: not auto-graded

    if (isCorrect) score += question.points || 1;
    graded[qIdx] = { correct: isCorrect, points: isCorrect ? (question.points || 1) : 0 };
  }

  const totalPoints = quiz.totalPoints || quiz.questions.reduce((s: number, q: any) => s + (q.points || 1), 0);
  const percentage = totalPoints > 0 ? Math.round((score / totalPoints) * 100) : 0;

  await db.collection('quiz_attempts').updateOne(
    { _id: attempt._id },
    { $set: { submittedAt: new Date(), score, totalPoints, percentage, graded } }
  );

  return { score, totalPoints, percentage };
}

// ==================== SANITIZE QUIZ FOR STUDENT ====================
// Removes correct answers, applies randomization

function sanitizeQuizForStudent(quiz: any, questionOrder: number[], optionOrders?: Record<number, number[]>) {
  return {
    _id: quiz._id,
    title: quiz.title,
    description: quiz.description,
    timeLimit: quiz.timeLimit,
    totalPoints: quiz.totalPoints,
    settings: quiz.settings,
    questions: questionOrder.map((origIdx: number) => {
      const q = quiz.questions[origIdx];
      const sanitized: any = {
        originalIndex: origIdx,
        text: q.text,
        type: q.type,
        points: q.points || 1,
      };
      if (q.type === 'mcq') {
        const optOrder = optionOrders?.[origIdx] || q.options.map((_: any, i: number) => i);
        sanitized.options = optOrder.map((oi: number) => q.options[oi]);
      }
      return sanitized;
    }),
  };
}

// ==================== FUZZY TEXT SIMILARITY ====================

const STOP_WORDS = new Set(['the','a','an','and','or','but','in','on','at','to','for','of','with','by','from','is','was','are','were','be','been','have','has','had','do','does','did','will','would','could','should','this','that','it','its','i','you','he','she','we','they','as','if','so','not','no']);

function textSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wordsA = a.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const wordsB = b.toLowerCase().split(/\W+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  let shared = 0;
  for (const w of setA) if (setB.has(w)) shared++;
  // Jaccard similarity
  const union = new Set([...wordsA, ...wordsB]).size;
  return union === 0 ? 0 : shared / union;
}

// ==================== LECTURER: GET ATTEMPT DETAIL (for grading) ====================

quiz.get('/attempt/:attemptId', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const attemptId = c.req.param('attemptId');
    if (!ObjectId.isValid(attemptId)) return c.json({ error: 'Invalid ID' }, 400);

    const db = getDatabase();
    const attempt = await db.collection('quiz_attempts').findOne({ _id: new ObjectId(attemptId), institutionId: user.institutionId });
    if (!attempt) return c.json({ error: 'Attempt not found' }, 404);

    const quizDoc = await db.collection('quizzes').findOne({ _id: new ObjectId((attempt as any).quizId) });
    if (!quizDoc) return c.json({ error: 'Quiz not found' }, 404);

    const q = quizDoc as any;
    const a = attempt as any;

    // Build detailed view with questions, student answers, correct answers, and similarity scores
    const details = q.questions.map((question: any, idx: number) => {
      const studentAnswer = a.answers?.[idx.toString()];
      const gradeInfo = a.graded?.[idx.toString()];
      const detail: any = {
        index: idx,
        text: question.text,
        type: question.type,
        points: question.points || 1,
        studentAnswer,
        isGraded: !!gradeInfo,
        awardedPoints: gradeInfo?.points || 0,
        correct: gradeInfo?.correct || false,
      };

      if (question.type === 'mcq') {
        // Map back through option orders
        const optOrder = a.optionOrders?.[idx];
        detail.options = question.options;
        detail.correctAnswer = question.correctAnswer;
        detail.studentOriginalAnswer = optOrder ? optOrder[studentAnswer] : studentAnswer;
      } else if (question.type === 'true_false') {
        detail.correctAnswer = question.correctAnswer;
      } else if (question.type === 'short_answer') {
        detail.modelAnswer = question.modelAnswer || '';
        if (typeof studentAnswer === 'string' && question.modelAnswer) {
          detail.similarity = Math.round(textSimilarity(studentAnswer, question.modelAnswer) * 100);
          detail.suggestedPoints = detail.similarity >= 70 ? question.points || 1 : detail.similarity >= 40 ? Math.round((question.points || 1) * 0.5) : 0;
        }
      }

      return detail;
    });

    return c.json({ attempt: a, quiz: { title: q.title, totalPoints: q.totalPoints }, details });
  } catch (error: any) {
    return c.json({ error: 'Failed', details: error.message }, 500);
  }
});

// ==================== LECTURER: GRADE SHORT ANSWER ====================

quiz.put('/attempt/:attemptId/grade-question', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (user.userType !== 'lecturer') return c.json({ error: 'Only lecturers' }, 403);
    const attemptId = c.req.param('attemptId');
    if (!ObjectId.isValid(attemptId)) return c.json({ error: 'Invalid ID' }, 400);

    const { questionIndex, points } = await c.req.json();
    if (questionIndex === undefined || points === undefined) return c.json({ error: 'questionIndex and points required' }, 400);

    const db = getDatabase();
    const attempt = await db.collection('quiz_attempts').findOne({ _id: new ObjectId(attemptId), institutionId: user.institutionId });
    if (!attempt) return c.json({ error: 'Attempt not found' }, 404);

    const quizDoc = await db.collection('quizzes').findOne({ _id: new ObjectId((attempt as any).quizId) });
    if (!quizDoc) return c.json({ error: 'Quiz not found' }, 404);

    const question = (quizDoc as any).questions[questionIndex];
    if (!question) return c.json({ error: 'Question not found' }, 400);

    const maxPoints = question.points || 1;
    const awardedPoints = Math.min(Math.max(0, points), maxPoints);

    // Update the graded field for this question
    await db.collection('quiz_attempts').updateOne(
      { _id: new ObjectId(attemptId) },
      { $set: { [`graded.${questionIndex}`]: { correct: awardedPoints > 0, points: awardedPoints, manuallyGraded: true } } }
    );

    // Recalculate total score
    const updatedAttempt = await db.collection('quiz_attempts').findOne({ _id: new ObjectId(attemptId) });
    const graded = (updatedAttempt as any).graded || {};
    let totalScore = 0;
    for (const g of Object.values(graded) as any[]) {
      totalScore += g.points || 0;
    }
    const totalPoints = (quizDoc as any).totalPoints || 1;
    const percentage = Math.round((totalScore / totalPoints) * 100);

    await db.collection('quiz_attempts').updateOne(
      { _id: new ObjectId(attemptId) },
      { $set: { score: totalScore, percentage } }
    );

    markQuizUpdated(user.institutionId);
    return c.json({ message: 'Question graded', score: totalScore, totalPoints, percentage });
  } catch (error: any) {
    return c.json({ error: 'Failed to grade', details: error.message }, 500);
  }
});

export default quiz;
