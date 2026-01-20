import { ObjectId } from 'mongodb';

export type UserType = 'student' | 'lecturer' | 'admin';
export type UserStatus = 'active' | 'pending' | 'suspended';

export interface User {
  _id?: ObjectId;
  email: string;
  passwordHash: string;
  passwordHistory?: string[];  // Store last 5 password hashes
  userType: UserType;
  institutionId: ObjectId;
  status: UserStatus;
  emailVerified: boolean;
  isFirstLogin?: boolean;  // Track if user needs to change password
  profile: UserProfile;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserProfile {
  firstName: string;
  lastName: string;
  studentId?: string;        // For students
  lecturerId?: string;       // For lecturers
  facultyId?: string;
  employeeId?: string;
  department?: string;
  year?: string;             // For students
  role?: string;             // For lecturers (Prof, Dr, Mr, Mrs, Ms)
  specialization?: string;   // For lecturers
  title?: string;            // For admins
  avatar?: string;
  phone?: string;
  address?: string;
  dateOfBirth?: Date;
}

export type UserDocument = Required<User> & { _id: ObjectId };

export interface OTPCode {
  _id?: ObjectId;
  email: string;
  code: string;
  purpose: string;
  expiresAt: Date;
  used: boolean;
  createdAt?: Date;
}