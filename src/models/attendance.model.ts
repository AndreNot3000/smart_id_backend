import { ObjectId } from 'mongodb';

export interface Attendance {
  _id?: ObjectId;
  studentId: ObjectId;
  scannedBy: ObjectId; // Lecturer or Admin who scanned
  scannedByType: 'lecturer' | 'admin';
  courseId?: ObjectId; // Optional: if you add courses later
  location?: string; // Optional: GPS coordinates or room number
  purpose?: string; // e.g., "Class Attendance", "Event Check-in", "ID Verification"
  notes?: string;
  scannedAt: Date;
  createdAt: Date;
}

export interface AttendanceRecord {
  id: string;
  studentId: string;
  studentName: string;
  scannedBy: string;
  scannedByName: string;
  scannedByType: 'lecturer' | 'admin';
  purpose?: string;
  location?: string;
  notes?: string;
  scannedAt: Date;
}
