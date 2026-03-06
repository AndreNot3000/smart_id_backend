import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { getUsersCollection, getInstitutionsCollection } from '../database/connection.js';

export interface QRCodeData {
  userId: string;
  userType: 'student' | 'lecturer';
  institutionId: string;
  timestamp: number;
}

export interface StudentQRInfo {
  studentId: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  year: string;
  avatar: string | null;
  institutionName: string;
  status: string;
  emailVerified: boolean;
}

export interface LecturerQRInfo {
  lecturerId: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  role: string;
  specialization: string;
  avatar: string | null;
  institutionName: string;
  status: string;
  emailVerified: boolean;
}

export class QRService {
  /**
   * Generate QR code data (JWT token) for a user
   * Token is PERMANENT and does not expire (for student/lecturer ID cards)
   */
  static generateQRToken(userId: string, userType: 'student' | 'lecturer', institutionId: string): string {
    const secret = process.env.JWT_SECRET!;
    
    const payload: QRCodeData = {
      userId,
      userType,
      institutionId,
      timestamp: Date.now(),
    };

    // No expiration - permanent QR code for student/lecturer ID
    const token = jwt.sign(payload, secret);
    
    return token;
  }

  /**
   * Verify and decode QR code token
   */
  static verifyQRToken(token: string): QRCodeData {
    try {
      const secret = process.env.JWT_SECRET!;
      const decoded = jwt.verify(token, secret) as QRCodeData;
      
      return decoded;
    } catch (error) {
      throw new Error('Invalid QR code');
    }
  }

  /**
   * Get student information from QR code token
   */
  static async getStudentInfoFromQR(token: string): Promise<StudentQRInfo> {
    // Verify token
    const decoded = this.verifyQRToken(token);
    
    if (decoded.userType !== 'student') {
      throw new Error('QR code is not for a student');
    }

    // Get student from database
    const usersCollection = getUsersCollection();
    const student = await usersCollection.findOne({ 
      _id: new ObjectId(decoded.userId),
      userType: 'student'
    });

    if (!student) {
      throw new Error('Student not found');
    }

    // Get institution name
    const institutionsCollection = getInstitutionsCollection();
    const institution = await institutionsCollection.findOne({ 
      _id: student.institutionId 
    });

    return {
      studentId: student.profile.studentId || '',
      firstName: student.profile.firstName,
      lastName: student.profile.lastName,
      email: student.email,
      department: student.profile.department || '',
      year: student.profile.year || '',
      avatar: student.profile.avatar || null,
      institutionName: institution?.name || 'Unknown Institution',
      status: student.status,
      emailVerified: student.emailVerified,
    };
  }

  /**
   * Get lecturer information from QR code token
   */
  static async getLecturerInfoFromQR(token: string): Promise<LecturerQRInfo> {
    // Verify token
    const decoded = this.verifyQRToken(token);
    
    if (decoded.userType !== 'lecturer') {
      throw new Error('QR code is not for a lecturer');
    }

    // Get lecturer from database
    const usersCollection = getUsersCollection();
    const lecturer = await usersCollection.findOne({ 
      _id: new ObjectId(decoded.userId),
      userType: 'lecturer'
    });

    if (!lecturer) {
      throw new Error('Lecturer not found');
    }

    // Get institution name
    const institutionsCollection = getInstitutionsCollection();
    const institution = await institutionsCollection.findOne({ 
      _id: lecturer.institutionId 
    });

    return {
      lecturerId: lecturer.profile.lecturerId || '',
      firstName: lecturer.profile.firstName,
      lastName: lecturer.profile.lastName,
      email: lecturer.email,
      department: lecturer.profile.department || '',
      role: lecturer.profile.role || '',
      specialization: lecturer.profile.specialization || '',
      avatar: lecturer.profile.avatar || null,
      institutionName: institution?.name || 'Unknown Institution',
      status: lecturer.status,
      emailVerified: lecturer.emailVerified,
    };
  }

  /**
   * Get user information from QR code (works for both students and lecturers)
   */
  static async getUserInfoFromQR(token: string): Promise<StudentQRInfo | LecturerQRInfo> {
    const decoded = this.verifyQRToken(token);
    
    if (decoded.userType === 'student') {
      return await this.getStudentInfoFromQR(token);
    } else {
      return await this.getLecturerInfoFromQR(token);
    }
  }
}
