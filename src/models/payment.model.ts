import { ObjectId } from 'mongodb';

export type PaymentStatus = 'pending' | 'success' | 'failed' | 'cancelled';
export type PaymentType =
  | 'wallet_topup'
  | 'tuition'
  | 'school_fees'
  | 'departmental_dues'
  | 'cafeteria'
  | 'library_fine'
  | 'hostel'
  | 'transport'
  | 'other';

export type PaymentGateway = 'paystack' | 'wallet';
export type TransactionType = 'credit' | 'debit';

export interface WalletDedicatedAccount {
  accountNumber: string;
  accountName: string;
  bankName: string;
  bankSlug?: string;
  paystackDedicatedId?: number;
  paystackCustomerCode: string;
  status: 'active' | 'pending';
  assignedAt?: Date;
  /** Demo account when Paystack DVA is unavailable (no real transfers) */
  isMock?: boolean;
}

// Wallet model
export interface Wallet {
  _id?: ObjectId;
  userId: ObjectId;
  balance: number; // Current balance in Naira
  currency: string; // NGN
  institutionId: ObjectId;
  isActive: boolean;
  paystackCustomerCode?: string;
  dedicatedAccount?: WalletDedicatedAccount;
  createdAt?: Date;
  updatedAt?: Date;
}

// Payment transaction model
export interface Payment {
  _id?: ObjectId;
  userId: ObjectId;
  institutionId: ObjectId;
  reference: string; // Paystack reference
  amount: number; // Amount in Naira
  currency: string; // NGN
  paymentType: PaymentType;
  transactionType: TransactionType; // credit or debit
  status: PaymentStatus;
  paymentGateway: PaymentGateway;
  paystackResponse?: any; // Store Paystack response
  description?: string;
  metadata?: any;
  balanceBefore?: number;
  balanceAfter?: number;
  paidAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

// Service payment request (for cafeteria, library, etc.)
export interface ServicePayment {
  _id?: ObjectId;
  userId: ObjectId;
  institutionId: ObjectId;
  serviceType: PaymentType;
  amount: number;
  description: string;
  reference: string;
  status: PaymentStatus;
  processedBy?: ObjectId; // Admin/staff who processed
  metadata?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

export type WalletDocument = Required<Wallet> & { _id: ObjectId };
export type PaymentDocument = Required<Payment> & { _id: ObjectId };
export type ServicePaymentDocument = Required<ServicePayment> & { _id: ObjectId };
