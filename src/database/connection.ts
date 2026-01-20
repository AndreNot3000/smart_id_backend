import { MongoClient, Db, Collection } from 'mongodb';
import type { Document } from 'mongodb';
import type { Institution } from '../models/institution.model.js';
import type { User, OTPCode } from '../models/user.model.js';

let client: MongoClient;
let db: Db;

export async function initDatabase() {
  const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
  const dbName = process.env.DB_NAME || 'campus_id_saas';
  
  client = new MongoClient(mongoUrl);
  await client.connect();
  db = client.db(dbName);
  
  // Create indexes
  await createIndexes();
  
  console.log('✅ Connected to MongoDB');
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

async function createIndexes() {
  const institutionsCol = getInstitutionsCollection();
  const usersCol = getUsersCollection();
  const otpCol = getOTPCollection();
  
  // Institution indexes
  await institutionsCol.createIndex({ code: 1 }, { unique: true });
  await institutionsCol.createIndex({ domain: 1 });
  
  // User indexes
  await usersCol.createIndex({ email: 1 }, { unique: true });
  await usersCol.createIndex({ institutionId: 1 });
  await usersCol.createIndex({ userType: 1 });
  await usersCol.createIndex({ email: 1, userType: 1 });
  
  // OTP indexes
  await otpCol.createIndex({ email: 1, purpose: 1 });
  await otpCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  
  console.log('✅ Database indexes created');
}

export async function closeDatabase() {
  if (client) {
    await client.close();
  }
}
