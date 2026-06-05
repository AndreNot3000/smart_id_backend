import { ObjectId } from 'mongodb';

export type AttendanceSessionType = 'class' | 'test' | 'exam';
export type AttendanceSessionStatus = 'scheduled' | 'active' | 'closed' | 'cancelled';

export interface AttendanceSession {
  _id?: ObjectId;
  courseId: ObjectId;
  courseCode: string;       // denormalised for fast list rendering
  courseName: string;
  lecturerId: ObjectId;
  institutionId: string;
  type: AttendanceSessionType;
  title: string;
  location?: string;        // required when type is 'test' or 'exam'
  scheduledAt: Date;        // when the session is supposed to happen
  startedAt?: Date;         // when scanning actually opened
  endedAt?: Date;
  durationMinutes?: number;
  status: AttendanceSessionStatus;

  // Frozen roster at the time scanning starts. Locks the roster so adding a
  // student after the fact doesn't retroactively flag them absent for past
  // sessions. Stored as plain string ObjectIds for cheap diffing.
  rosterSnapshot: string[];
  expectedCount: number;
  presentCount: number;     // updated on each scan / manual mark

  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type AttendancePresence = 'present' | 'absent' | 'late' | 'excused';

// Per-session, per-student presence record. One row per (session, student).
// We keep this separate from the raw scan log in `attendance` because:
//   - Manual overrides (e.g. "marked absent by hand") don't have a scan
//   - We want O(1) lookup of "is student X present in session Y"
export interface SessionPresenceRecord {
  _id?: ObjectId;
  sessionId: ObjectId;
  studentId: ObjectId;
  institutionId: string;
  presence: AttendancePresence;
  source: 'qr' | 'manual';
  markedBy?: ObjectId;
  markedAt: Date;
  scanAttendanceId?: ObjectId; // FK to attendance collection when source='qr'
}
