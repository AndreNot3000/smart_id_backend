import { ObjectId } from 'mongodb';
import type { PaymentType } from './payment.model.js';

export interface PayableItem {
  _id?: ObjectId;
  institutionId: ObjectId;
  slug: string;
  title: string;
  description?: string;
  category: PaymentType;
  icon?: string;
  /** Fixed amount in Naira; omit when allowCustomAmount is true */
  fixedAmount?: number;
  minAmount?: number;
  maxAmount?: number;
  allowCustomAmount: boolean;
  status: 'active' | 'inactive';
  isSystem?: boolean;
  sortOrder?: number;
  createdAt: Date;
  updatedAt: Date;
}
