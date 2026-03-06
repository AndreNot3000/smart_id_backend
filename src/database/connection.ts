import { MongoClient, Db, Collection } from 'mongodb';
import type { Document } from 'mongodb';
import type { Institution } from '../models/institution.model.js';
import type { User, OTPCode } from '../models/user.model.js';
import type { Attendance } from '../models/attendance.model.js';
import type { Wallet, Payment, ServicePayment } from '../models/payment.model.js';

let client: MongoClient;
let db: Db;

export async function initDatabase() {
  try {
    const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
    const dbName = process.env.DB_NAME || 'campus_id_saas';
    
    console.log('🔄 Connecting to MongoDB...');
    console.log('📍 Database name:', dbName);
    // Don't log full URL for security, just check if it's Atlas
    console.log('🌐 Connection type:', mongoUrl.includes('mongodb+srv') ? 'MongoDB Atlas' : 'Local MongoDB');
    
    // MongoDB connection options for better reliability
    const options = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000, // Increased timeout
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      family: 4, // Use IPv4, skip trying IPv6
      retryWrites: true,
      w: 'majority'
    };
    
    client = new MongoClient(mongoUrl, options);
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
  
  await paymentsCol.createIndex({ userId: 1 });
  await paymentsCol.createIndex({ reference: 1 }, { unique: true });
  await paymentsCol.createIndex({ status: 1 });
  await paymentsCol.createIndex({ createdAt: -1 });
  await paymentsCol.createIndex({ userId: 1, createdAt: -1 });
  
  await servicePaymentsCol.createIndex({ userId: 1 });
  await servicePaymentsCol.createIndex({ reference: 1 });
  await servicePaymentsCol.createIndex({ status: 1 });
  await servicePaymentsCol.createIndex({ createdAt: -1 });
  
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
