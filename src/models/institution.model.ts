import { ObjectId } from 'mongodb';

export type InstitutionStatus = 'active' | 'inactive' | 'suspended';

export interface Institution {
  _id?: ObjectId;
  name: string;
  code: string;        // Unique institution code (e.g., "MIT", "HARV", "STAN")
  domain?: string;     // Email domain (optional)
  status: InstitutionStatus;  // Institution status
  settings?: {
    allowStudentSelfRegistration?: boolean;
    requireEmailVerification?: boolean;
    [key: string]: any;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

export type InstitutionDocument = Required<Institution> & { _id: ObjectId };