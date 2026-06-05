// Background job: sends email reminders at 6h and 3h before assignment deadlines.
// Runs every 15 minutes. Only emails students who haven't submitted yet.
// Tracks sent reminders per threshold to avoid duplicates.

import { getDatabase } from '../database/connection.js';
import { sendDeadlineReminderEmail } from './email.services.js';

const REMINDER_THRESHOLDS = [6, 3]; // hours before deadline
const CHECK_INTERVAL = 15 * 60 * 1000; // Check every 15 minutes

function yearToLevel(year: string): string {
  if (!year) return '';
  if (/^\d+L$/i.test(year)) return year.toUpperCase();
  const match = year.match(/Year\s*(\d+)/i);
  if (match && match[1]) return `${parseInt(match[1]) * 100}L`;
  const numMatch = year.match(/(\d+)/);
  if (numMatch && numMatch[1]) return `${parseInt(numMatch[1]) * 100}L`;
  return year;
}

async function checkDeadlines() {
  try {
    const db = getDatabase();
    const now = new Date();
    const maxCutoff = new Date(now.getTime() + Math.max(...REMINDER_THRESHOLDS) * 60 * 60 * 1000);

    // Find assignments with deadlines between now and the max threshold
    const assignments = await db.collection('assignments').find({
      deadline: { $gt: now, $lte: maxCutoff }
    }).toArray();

    if (assignments.length === 0) return;

    for (const assignment of assignments) {
      const a = assignment as any;
      const msLeft = new Date(a.deadline).getTime() - now.getTime();
      const hoursLeft = msLeft / (1000 * 60 * 60);

      // Determine which threshold this falls into
      // e.g. if 2.5h left, threshold is 3. If 5h left, threshold is 6.
      let activeThreshold: number | null = null;
      for (const t of REMINDER_THRESHOLDS.sort((a, b) => b - a)) {
        if (hoursLeft <= t) activeThreshold = t;
      }
      if (!activeThreshold) continue;

      const hoursDisplay = Math.max(1, Math.round(hoursLeft));

      // Find eligible students
      const students = await db.collection('users').find({
        institutionId: a.institutionId,
        userType: 'student',
        'profile.department': a.department,
        status: 'active',
        emailVerified: true,
      }).toArray();

      // Get submissions for this assignment
      const submissions = await db.collection('assignment_submissions').find({
        assignmentId: a._id.toString()
      }).project({ studentId: 1 }).toArray();
      const submittedIds = new Set(submissions.map((s: any) => s.studentId));

      // Get already-sent reminders for this assignment + threshold
      const sentReminders = await db.collection('deadline_reminders').find({
        assignmentId: a._id.toString(),
        threshold: activeThreshold
      }).project({ studentId: 1 }).toArray();
      const alreadyReminded = new Set(sentReminders.map((r: any) => r.studentId));

      let sentCount = 0;

      for (const student of students) {
        const s = student as any;
        const studentId = s._id.toString();

        if (submittedIds.has(studentId)) continue;
        if (alreadyReminded.has(studentId)) continue;

        const studentLevel = yearToLevel(s.profile?.year || '');
        if (a.level && studentLevel !== a.level) continue;

        await sendDeadlineReminderEmail(
          s.email,
          `${s.profile?.firstName || ''} ${s.profile?.lastName || ''}`.trim(),
          a.courseCode || '',
          a.courseName || a.title || '',
          a.title || '',
          new Date(a.deadline),
          hoursDisplay
        );

        await db.collection('deadline_reminders').insertOne({
          assignmentId: a._id.toString(),
          studentId,
          studentEmail: s.email,
          threshold: activeThreshold,
          sentAt: new Date(),
        });

        sentCount++;
      }

      if (sentCount > 0) {
        console.log(`📧 [Deadline] Sent ${sentCount} ${activeThreshold}h reminder(s) for "${a.title}" (${hoursDisplay}h left)`);
      }
    }
  } catch (error) {
    console.error('❌ [Deadline Checker] Error:', error);
  }
}

export function startDeadlineReminder() {
  console.log(`⏰ Deadline reminders active — thresholds: ${REMINDER_THRESHOLDS.join('h, ')}h — checking every ${CHECK_INTERVAL / 60000}min`);
  checkDeadlines();
  setInterval(checkDeadlines, CHECK_INTERVAL);
}
