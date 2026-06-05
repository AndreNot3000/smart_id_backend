import { MongoClient, Db, Collection } from 'mongodb';
import type { Document, MongoClientOptions } from 'mongodb';
import type { Institution } from '../models/institution.model.js';
import type { User, OTPCode } from '../models/user.model.js';
import type { Attendance } from '../models/attendance.model.js';
import type { Wallet, Payment, ServicePayment } from '../models/payment.model.js';
import type { CourseEnrollment } from '../models/enrollment.model.js';
import type { AttendanceSession, SessionPresenceRecord } from '../models/session.model.js';

let client: MongoClient;
let db: Db;

function isAtlasUrl(url: string): boolean {
  return url.includes('mongodb+srv') || url.includes('mongodb.net');
}

function buildMongoOptions(url: string): MongoClientOptions {
  const options: MongoClientOptions = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 10000,
    family: 4,
    retryWrites: true,
    w: 'majority',
  };

  // Atlas over TLS often fails certificate verification on Windows dev machines
  // (UNABLE_TO_VERIFY_LEAF_SIGNATURE). Relax verification in development unless
  // MONGODB_TLS_STRICT=true is set. Always enforce verification in production.
  if (isAtlasUrl(url)) {
    const isProduction = process.env.NODE_ENV === 'production';
    const strictTls = process.env.MONGODB_TLS_STRICT === 'true';
    if (!isProduction && !strictTls) {
      options.tlsAllowInvalidCertificates = true;
      console.warn(
        '⚠️  MongoDB TLS verification relaxed for local Atlas dev. ' +
          'Use mongodb+srv:// from Atlas if possible, or set MONGODB_TLS_STRICT=true to enforce.'
      );
    }
  }

  return options;
}

export async function initDatabase() {
  try {
    const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
    const dbName = process.env.DB_NAME || 'campus_id_saas';
    
    console.log('🔄 Connecting to MongoDB...');
    console.log('📍 Database name:', dbName);
    console.log('🌐 Connection type:', isAtlasUrl(mongoUrl) ? 'MongoDB Atlas' : 'Local MongoDB');
    
    client = new MongoClient(mongoUrl, buildMongoOptions(mongoUrl));
    await client.connect();
    
    // Test the connection
    await client.db(dbName).admin().ping();
    console.log('🏓 MongoDB ping successful');
    
    db = client.db(dbName);
    
    // Create indexes
    await createIndexes();
    
    console.log('✅ Connected to MongoDB successfully');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    console.error('🔍 Error details:', {
      name: error.name,
      code: error.code,
      codeName: error.codeName
    });
    throw error;
  }
}

export function getDatabase(): Db {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}

export function getCollection<T extends Document = Document>(name: string): Collection<T> {
  return getDatabase().collection<T>(name);
}

// Collection getters
export const getInstitutionsCollection = () => getCollection<Institution>('institutions');
export const getUsersCollection = () => getCollection<User>('users');
export const getOTPCollection = () => getCollection<OTPCode>('otp_codes');
export const getAttendanceCollection = () => getCollection<Attendance>('attendance');
export const getEnrollmentsCollection = () => getCollection<CourseEnrollment>('course_enrollments');
export const getSessionsCollection = () => getCollection<AttendanceSession>('attendance_sessions');
export const getSessionPresenceCollection = () =>
  getCollection<SessionPresenceRecord>('session_presence');

async function createIndexes() {
  const institutionsCol = getInstitutionsCollection();
  const usersCol = getUsersCollection();
  const otpCol = getOTPCollection();
  const attendanceCol = getAttendanceCollection();
  
  // Institution indexes
  await institutionsCol.createIndex({ code: 1 }, { unique: true });
  await institutionsCol.createIndex({ domain: 1 });
  
  // User indexes
  await usersCol.createIndex({ email: 1 }, { unique: true });
  await usersCol.createIndex({ institutionId: 1 });
  await usersCol.createIndex({ userType: 1 });
  await usersCol.createIndex({ email: 1, userType: 1 });
  
  // Add unique indexes for student and lecturer IDs
  await usersCol.createIndex(
    { 'profile.studentId': 1 }, 
    { unique: true, sparse: true } // sparse: true allows null values
  );
  await usersCol.createIndex(
    { 'profile.lecturerId': 1 }, 
    { unique: true, sparse: true }
  );
  
  // OTP indexes
  await otpCol.createIndex({ email: 1, purpose: 1 });
  await otpCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-cleanup
  await otpCol.createIndex({ email: 1, code: 1, purpose: 1 }); // Compound index for faster lookups
  
  // Attendance indexes
  await attendanceCol.createIndex({ studentId: 1 });
  await attendanceCol.createIndex({ scannedBy: 1 });
  await attendanceCol.createIndex({ scannedAt: -1 }); // Sort by date descending
  await attendanceCol.createIndex({ studentId: 1, scannedAt: -1 }); // Compound for student history
  
  // Payment indexes
  const walletsCol = db.collection('wallets');
  const paymentsCol = db.collection('payments');
  const servicePaymentsCol = db.collection('service_payments');
  
  await walletsCol.createIndex({ userId: 1 }, { unique: true });
  await walletsCol.createIndex({ institutionId: 1 });
  await walletsCol.createIndex({ 'dedicatedAccount.accountNumber': 1 }, { sparse: true });
  await walletsCol.createIndex({ paystackCustomerCode: 1 }, { sparse: true });
  
  await paymentsCol.createIndex({ userId: 1 });
  await paymentsCol.createIndex({ reference: 1 }, { unique: true });
  await paymentsCol.createIndex({ status: 1 });
  await paymentsCol.createIndex({ createdAt: -1 });
  await paymentsCol.createIndex({ userId: 1, createdAt: -1 });
  
  await servicePaymentsCol.createIndex({ userId: 1 });
  await servicePaymentsCol.createIndex({ reference: 1 });
  await servicePaymentsCol.createIndex({ status: 1 });
  await servicePaymentsCol.createIndex({ createdAt: -1 });

  const payableItemsCol = db.collection('payable_items');
  await payableItemsCol.createIndex({ institutionId: 1, status: 1, sortOrder: 1 });
  await payableItemsCol.createIndex({ institutionId: 1, slug: 1 }, { unique: true });
  
  // Schedule indexes
  const schedulesCol = db.collection('schedules');
  await schedulesCol.createIndex({ institutionId: 1, department: 1, level: 1 });
  await schedulesCol.createIndex({ lecturerId: 1 });
  await schedulesCol.createIndex({ institutionId: 1, lecturerId: 1, dayOfWeek: 1 });

  // Course enrollment indexes — one (courseId, studentId) pair can exist only once
  const enrollmentsCol = getEnrollmentsCollection();
  await enrollmentsCol.createIndex(
    { courseId: 1, studentId: 1 },
    { unique: true }
  );
  await enrollmentsCol.createIndex({ studentId: 1, status: 1 });
  await enrollmentsCol.createIndex({ courseId: 1, status: 1 });
  await enrollmentsCol.createIndex({ institutionId: 1 });

  // Attendance session indexes
  const sessionsCol = getSessionsCollection();
  await sessionsCol.createIndex({ institutionId: 1, scheduledAt: -1 });
  await sessionsCol.createIndex({ courseId: 1, scheduledAt: -1 });
  await sessionsCol.createIndex({ lecturerId: 1, status: 1, scheduledAt: -1 });
  await sessionsCol.createIndex({ status: 1 });

  // Session presence — one record per (session, student)
  const presenceCol = getSessionPresenceCollection();
  await presenceCol.createIndex(
    { sessionId: 1, studentId: 1 },
    { unique: true }
  );
  await presenceCol.createIndex({ sessionId: 1 });
  await presenceCol.createIndex({ studentId: 1, markedAt: -1 });

  // Backfill: link attendance records to sessions for fast lookup
  await attendanceCol.createIndex({ sessionId: 1 }, { sparse: true });

  // Gradebook: one assessment scheme per course; one manual score per (course, component, student)
  const schemesCol = getDatabase().collection('assessment_schemes');
  await schemesCol.createIndex({ courseId: 1 }, { unique: true });
  const gradebookScoresCol = getDatabase().collection('gradebook_scores');
  await gradebookScoresCol.createIndex({ courseId: 1, componentId: 1, studentId: 1 }, { unique: true });
  await gradebookScoresCol.createIndex({ courseId: 1, studentId: 1 });

  console.log('✅ Database indexes created');
}

export async function closeDatabase() {
  if (client) {
    await client.close();
  }
}

// Payment collections
export function getWalletsCollection(): Collection<Wallet> {
  return db.collection<Wallet>('wallets');
}

export function getPaymentsCollection(): Collection<Payment> {
  return db.collection<Payment>('payments');
}

export function getServicePaymentsCollection(): Collection<ServicePayment> {
  return db.collection<ServicePayment>('service_payments');
}
