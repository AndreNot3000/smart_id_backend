import { ObjectId } from 'mongodb';

export interface CourseEnrollment {
  _id?: ObjectId;
  courseId: ObjectId;
  studentId: ObjectId;
  institutionId: string;
  enrolledBy: ObjectId; // admin or lecturer who added them
  enrolledByType: 'admin' | 'lecturer';
  status: 'active' | 'withdrawn';
  enrolledAt: Date;
  withdrawnAt?: Date;
}
