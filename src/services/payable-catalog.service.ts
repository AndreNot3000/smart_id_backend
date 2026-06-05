import { ObjectId } from 'mongodb';
import { getDatabase } from '../database/connection.js';
import type { PayableItem } from '../models/payable-item.model.js';
import type { PaymentType } from '../models/payment.model.js';

const COLLECTION = 'payable_items';

const SYSTEM_ITEMS: Omit<PayableItem, '_id' | 'institutionId' | 'createdAt' | 'updatedAt'>[] = [
  {
    slug: 'tuition',
    title: 'Tuition / School Fees',
    description: 'Semester tuition or school fees',
    category: 'tuition',
    icon: '🎓',
    allowCustomAmount: true,
    minAmount: 1000,
    maxAmount: 1_000_000,
    status: 'active',
    isSystem: true,
    sortOrder: 1,
  },
  {
    slug: 'departmental-dues',
    title: 'Departmental Dues',
    description: 'Department association or lab dues',
    category: 'departmental_dues',
    icon: '🏛️',
    allowCustomAmount: true,
    minAmount: 500,
    maxAmount: 100_000,
    status: 'active',
    isSystem: true,
    sortOrder: 2,
  },
  {
    slug: 'cafeteria',
    title: 'Cafeteria',
    description: 'Meals and cafeteria services',
    category: 'cafeteria',
    icon: '🍽️',
    allowCustomAmount: true,
    minAmount: 100,
    maxAmount: 50_000,
    status: 'active',
    isSystem: true,
    sortOrder: 3,
  },
  {
    slug: 'library',
    title: 'Library Fine',
    description: 'Library fines and charges',
    category: 'library_fine',
    icon: '📚',
    allowCustomAmount: true,
    minAmount: 100,
    maxAmount: 25_000,
    status: 'active',
    isSystem: true,
    sortOrder: 4,
  },
  {
    slug: 'hostel',
    title: 'Hostel',
    description: 'Hostel accommodation fees',
    category: 'hostel',
    icon: '🏠',
    allowCustomAmount: true,
    minAmount: 1000,
    maxAmount: 500_000,
    status: 'active',
    isSystem: true,
    sortOrder: 5,
  },
  {
    slug: 'transport',
    title: 'Transport',
    description: 'Campus transport passes',
    category: 'transport',
    icon: '🚌',
    allowCustomAmount: true,
    minAmount: 100,
    maxAmount: 50_000,
    status: 'active',
    isSystem: true,
    sortOrder: 6,
  },
];

export async function ensurePayableCatalog(institutionId: ObjectId) {
  const col = getDatabase().collection<PayableItem>(COLLECTION);
  const count = await col.countDocuments({ institutionId });
  if (count > 0) return;

  const now = new Date();
  await col.insertMany(
    SYSTEM_ITEMS.map(item => ({
      ...item,
      institutionId,
      createdAt: now,
      updatedAt: now,
    }))
  );
}

export async function listPayableItems(institutionId: ObjectId) {
  await ensurePayableCatalog(institutionId);
  const col = getDatabase().collection<PayableItem>(COLLECTION);
  return col
    .find({ institutionId, status: 'active' })
    .sort({ sortOrder: 1, title: 1 })
    .toArray();
}

export function resolvePayableAmount(
  item: PayableItem,
  amountInput?: number
): { ok: true; amount: number } | { ok: false; error: string } {
  if (!item.allowCustomAmount && item.fixedAmount != null) {
    return { ok: true, amount: item.fixedAmount };
  }
  const amount = amountInput ?? item.fixedAmount;
  if (amount == null || amount < 1) {
    return { ok: false, error: 'Amount is required' };
  }
  const min = item.minAmount ?? 1;
  const max = item.maxAmount ?? 1_000_000;
  if (amount < min) return { ok: false, error: `Minimum amount is ₦${min.toLocaleString()}` };
  if (amount > max) return { ok: false, error: `Maximum amount is ₦${max.toLocaleString()}` };
  return { ok: true, amount };
}

export function serializePayableItem(item: PayableItem) {
  return {
    id: item._id!.toString(),
    slug: item.slug,
    title: item.title,
    description: item.description || '',
    category: item.category,
    icon: item.icon || '💳',
    fixedAmount: item.fixedAmount ?? null,
    minAmount: item.minAmount ?? null,
    maxAmount: item.maxAmount ?? null,
    allowCustomAmount: item.allowCustomAmount,
    isSystem: !!item.isSystem,
  };
}

export type { PaymentType };
