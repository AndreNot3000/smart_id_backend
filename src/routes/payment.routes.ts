import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { PaystackService } from '../services/paystack.services.js';
import {
  completeWalletTopUp,
  completeDedicatedNubanInflow,
  ensureStudentWallet,
  serviceLabel,
} from '../services/payment-wallet.service.js';
import {
  provisionDedicatedAccount,
  simulateMockBankTransfer,
  syncDedicatedAccountFromWebhook,
} from '../services/dedicated-account.service.js';
import {
  ensurePayableCatalog,
  listPayableItems,
  resolvePayableAmount,
  serializePayableItem,
} from '../services/payable-catalog.service.js';
import {
  getDatabase,
  getWalletsCollection,
  getPaymentsCollection,
  getServicePaymentsCollection,
  getUsersCollection,
} from '../database/connection.js';
import type { PaymentType } from '../models/payment.model.js';
import type { PayableItem } from '../models/payable-item.model.js';

const payment = new Hono();

const SERVICE_TYPES = [
  'tuition',
  'school_fees',
  'departmental_dues',
  'cafeteria',
  'library_fine',
  'hostel',
  'transport',
  'other',
] as const;

const topupWalletSchema = z.object({
  amount: z.number().min(100, 'Minimum top-up amount is ₦100').max(1000000, 'Maximum top-up amount is ₦1,000,000'),
});

const servicePaymentSchema = z.object({
  serviceType: z.enum(SERVICE_TYPES),
  amount: z.number().min(1, 'Amount must be greater than 0'),
  description: z.string().max(500).optional(),
});

const catalogPaySchema = z.object({
  amount: z.number().min(1).optional(),
  note: z.string().max(500).optional(),
});

const mockTransferSchema = z.object({
  amount: z.number().min(100, 'Minimum ₦100').max(500000, 'Maximum ₦500,000'),
});

const provisionAccountSchema = z.object({
  bvn: z.string().regex(/^\d{11}$/, 'BVN must be 11 digits').optional(),
  accountNumber: z.string().min(10).max(10).optional(),
  bankCode: z.string().min(3).max(6).optional(),
  phone: z.string().min(10).max(15).optional(),
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
});

const adminCatalogSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  category: z.enum(SERVICE_TYPES).optional(),
  icon: z.string().max(8).optional(),
  fixedAmount: z.number().min(1).optional(),
  minAmount: z.number().min(1).optional(),
  maxAmount: z.number().min(1).optional(),
  allowCustomAmount: z.boolean().optional(),
});

function walletResponse(wallet: {
  _id?: ObjectId;
  balance: number;
  currency: string;
  isActive: boolean;
  dedicatedAccount?: {
    accountNumber: string;
    accountName: string;
    bankName: string;
    bankSlug?: string;
    status: string;
    assignedAt?: Date;
    isMock?: boolean;
  };
}) {
  return {
    id: wallet._id?.toString() ?? '',
    balance: wallet.balance,
    currency: wallet.currency,
    isActive: wallet.isActive,
    dedicatedAccount: wallet.dedicatedAccount
      ? {
          accountNumber: wallet.dedicatedAccount.accountNumber,
          accountName: wallet.dedicatedAccount.accountName,
          bankName: wallet.dedicatedAccount.bankName,
          bankSlug: wallet.dedicatedAccount.bankSlug ?? null,
          status: wallet.dedicatedAccount.status,
          assignedAt: wallet.dedicatedAccount.assignedAt ?? null,
          isMock: wallet.dedicatedAccount.isMock ?? false,
        }
      : null,
  };
}

function serializeTransaction(t: {
  _id?: ObjectId;
  reference: string;
  amount: number;
  paymentType: PaymentType;
  transactionType: 'credit' | 'debit';
  status: string;
  description?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  createdAt?: Date;
}) {
  return {
    id: t._id?.toString() ?? '',
    reference: t.reference,
    amount: t.amount,
    type: t.paymentType,
    transactionType: t.transactionType,
    status: t.status,
    description: t.description ?? null,
    balanceBefore: t.balanceBefore,
    balanceAfter: t.balanceAfter,
    createdAt: t.createdAt,
  };
}

async function debitWalletForService(opts: {
  userId: ObjectId;
  institutionId: ObjectId;
  amount: number;
  paymentType: PaymentType;
  description: string;
  referencePrefix: string;
}) {
  const walletsCollection = getWalletsCollection();
  const paymentsCollection = getPaymentsCollection();
  const servicePaymentsCollection = getServicePaymentsCollection();

  const wallet = await ensureStudentWallet(opts.userId, opts.institutionId);

  if (wallet.balance < opts.amount) {
    return {
      ok: false as const,
      error: 'Insufficient balance',
      currentBalance: wallet.balance,
      required: opts.amount,
      shortfall: opts.amount - wallet.balance,
    };
  }

  const reference = PaystackService.generateReference(opts.referencePrefix);

  const updatedWallet = await walletsCollection.findOneAndUpdate(
    { userId: opts.userId },
    { $inc: { balance: -opts.amount }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' }
  );

  const paymentRecord = {
    userId: opts.userId,
    institutionId: opts.institutionId,
    reference,
    amount: opts.amount,
    currency: 'NGN',
    paymentType: opts.paymentType,
    transactionType: 'debit' as const,
    status: 'success' as const,
    paymentGateway: 'wallet' as const,
    description: opts.description,
    balanceBefore: wallet.balance,
    balanceAfter: updatedWallet?.balance ?? 0,
    paidAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await paymentsCollection.insertOne(paymentRecord);
  await servicePaymentsCollection.insertOne({
    userId: opts.userId,
    institutionId: opts.institutionId,
    serviceType: opts.paymentType,
    amount: opts.amount,
    description: opts.description,
    reference,
    status: 'success',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return {
    ok: true as const,
    reference,
    amount: opts.amount,
    serviceType: opts.paymentType,
    newBalance: updatedWallet?.balance ?? 0,
    description: opts.description,
  };
}

/**
 * Paystack webhook — no auth; signature verified
 * POST /api/payments/webhook/paystack
 */
payment.post('/webhook/paystack', async (c) => {
  try {
    const signature = c.req.header('x-paystack-signature') || '';
    const rawBody = await c.req.text();

    if (!PaystackService.verifyWebhookSignature(signature, rawBody)) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const event = JSON.parse(rawBody);

    if (event.event === 'charge.success' && event.data) {
      const data = event.data;
      const channel = data.channel as string | undefined;
      const reference = data.reference as string | undefined;

      if (channel === 'dedicated_nuban' && reference) {
        const accountNumber =
          data.authorization?.receiver_bank_account_number ||
          data.authorization?.account_number ||
          data.metadata?.receiver_account_number ||
          data.metadata?.account_number;

        const amountNaira = typeof data.amount === 'number' ? data.amount / 100 : 0;

        if (accountNumber && amountNaira > 0) {
          await completeDedicatedNubanInflow({
            reference,
            amount: amountNaira,
            accountNumber: String(accountNumber),
            paystackResponse: data,
          });
        }
      } else if (reference) {
        await completeWalletTopUp(reference);
      }
    }

    if (
      event.event === 'dedicatedaccount.assign.success' ||
      event.event === 'dedicatedaccount.assign.failed'
    ) {
      await syncDedicatedAccountFromWebhook(event.data || {});
    }

    return c.json({ received: true });
  } catch (error) {
    console.error('Paystack webhook error:', error);
    return c.json({ received: true });
  }
});

/**
 * GET /api/payments/wallet
 */
payment.get('/wallet', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students can have wallets' }, 403);
    }

    const userId = new ObjectId(authUser.userId);
    const wallet = await ensureStudentWallet(userId, new ObjectId(authUser.institutionId));
    return c.json({ wallet: walletResponse(wallet) });
  } catch (error) {
    console.error('Get wallet error:', error);
    return c.json({ error: 'Failed to fetch wallet' }, 500);
  }
});

/**
 * GET /api/payments/pending — pending top-ups
 */
payment.get('/pending', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students' }, 403);
    }

    const userId = new ObjectId(authUser.userId);
    const paymentsCollection = getPaymentsCollection();
    const pending = await paymentsCollection
      .find({ userId, status: 'pending', paymentType: 'wallet_topup' })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    return c.json({
      pending: pending.map(p => ({
        reference: p.reference,
        amount: p.amount,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    return c.json({ error: 'Failed to fetch pending payments' }, 500);
  }
});

/**
 * GET /api/payments/catalog — institution fee / service catalog
 */
payment.get('/catalog', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students' }, 403);
    }

    const institutionId = new ObjectId(authUser.institutionId);
    const items = await listPayableItems(institutionId);
    return c.json({ items: items.map(serializePayableItem) });
  } catch (error) {
    console.error('Catalog error:', error);
    return c.json({ error: 'Failed to load payment catalog' }, 500);
  }
});

/**
 * POST /api/payments/catalog — admin adds a payable item
 */
payment.post('/catalog', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'admin') {
      return c.json({ error: 'Only admins can manage the catalog' }, 403);
    }

    const body = await c.req.json();
    const data = adminCatalogSchema.parse(body);
    const institutionId = new ObjectId(authUser.institutionId);
    const col = getDatabase().collection<PayableItem>('payable_items');
    const now = new Date();
    const slug = data.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48);

    const doc: PayableItem = {
      institutionId,
      slug: `${slug}-${Date.now().toString(36)}`,
      title: data.title.trim(),
      description: data.description?.trim(),
      category: (data.category || 'other') as PaymentType,
      icon: data.icon || '💳',
      fixedAmount: data.fixedAmount,
      minAmount: data.minAmount ?? 100,
      maxAmount: data.maxAmount ?? 1_000_000,
      allowCustomAmount: data.allowCustomAmount ?? !data.fixedAmount,
      status: 'active',
      isSystem: false,
      sortOrder: 99,
      createdAt: now,
      updatedAt: now,
    };

    const result = await col.insertOne(doc);
    return c.json({ message: 'Payable item created', item: serializePayableItem({ ...doc, _id: result.insertedId }) }, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    return c.json({ error: 'Failed to create catalog item' }, 500);
  }
});

/**
 * POST /api/payments/catalog/:itemId/pay
 */
payment.post('/catalog/:itemId/pay', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students can pay' }, 403);
    }

    const itemId = c.req.param('itemId');
    if (!ObjectId.isValid(itemId)) {
      return c.json({ error: 'Invalid item' }, 400);
    }

    const body = await c.req.json().catch(() => ({}));
    const parsed = catalogPaySchema.parse(body);

    const institutionId = new ObjectId(authUser.institutionId);
    await ensurePayableCatalog(institutionId);

    const col = getDatabase().collection<PayableItem>('payable_items');
    const item = await col.findOne({
      _id: new ObjectId(itemId),
      institutionId,
      status: 'active',
    });
    if (!item) return c.json({ error: 'Payment item not found' }, 404);

    const amountResult = resolvePayableAmount(item, parsed.amount);
    if (!amountResult.ok) {
      return c.json({ error: amountResult.error }, 400);
    }

    const description =
      parsed.note?.trim() ||
      `${item.title}${parsed.note ? ` — ${parsed.note}` : ''}`;

    const result = await debitWalletForService({
      userId: new ObjectId(authUser.userId),
      institutionId,
      amount: amountResult.amount,
      paymentType: item.category,
      description,
      referencePrefix: item.slug.toUpperCase().replace(/-/g, '_'),
    });

    if (!result.ok) {
      return c.json(result, 400);
    }

    return c.json({
      message: 'Payment successful',
      item: serializePayableItem(item),
      ...result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    console.error('Catalog pay error:', error);
    return c.json({ error: 'Failed to process payment' }, 500);
  }
});

/**
 * POST /api/payments/wallet/account — provision dedicated virtual account (NUBAN)
 */
payment.post('/wallet/account', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students can have wallet accounts' }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const data = provisionAccountSchema.parse(body);

    const userId = new ObjectId(authUser.userId);
    const institutionId = new ObjectId(authUser.institutionId);

    const result = await provisionDedicatedAccount({
      userId,
      institutionId,
      bvn: data.bvn,
      accountNumber: data.accountNumber,
      bankCode: data.bankCode,
      phone: data.phone,
      firstName: data.firstName,
      lastName: data.lastName,
    });

    if (!result.ok) {
      return c.json(
        {
          error: result.error,
          requiresBvn: result.requiresBvn ?? false,
          requiresProfile: result.requiresProfile ?? false,
        },
        400
      );
    }

    const walletsCollection = getWalletsCollection();
    const wallet = await walletsCollection.findOne({ userId });
    if (!wallet) {
      return c.json({ error: 'Wallet not found' }, 500);
    }

    return c.json({
      message: result.pending
        ? 'Account is being set up. You will receive your account number shortly.'
        : 'Dedicated account number ready',
      dedicatedAccount: result.dedicatedAccount,
      wallet: walletResponse(wallet),
      pending: result.pending ?? false,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    console.error('Provision wallet account error:', error);
    return c.json({ error: 'Failed to provision account number' }, 500);
  }
});

/**
 * POST /api/payments/wallet/mock-transfer — simulate bank transfer (demo accounts only)
 */
payment.post('/wallet/mock-transfer', authMiddleware, async (c) => {
  try {
    if (process.env.NODE_ENV === 'production' && process.env.PAYSTACK_DVA_MOCK !== 'true') {
      return c.json({ error: 'Not available in production' }, 403);
    }

    const authUser = c.get('user');
    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students' }, 403);
    }

    const body = await c.req.json();
    const data = mockTransferSchema.parse(body);
    const userId = new ObjectId(authUser.userId);

    const result = await simulateMockBankTransfer(userId, data.amount);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({
      message: 'Demo transfer credited to wallet',
      amount: data.amount,
      reference: result.reference,
      newBalance: result.newBalance,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    return c.json({ error: 'Failed to simulate transfer' }, 500);
  }
});

/**
 * POST /api/payments/wallet/topup
 */
payment.post('/wallet/topup', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const body = await c.req.json();
    const data = topupWalletSchema.parse(body);

    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students can top up wallets' }, 403);
    }

    const userId = new ObjectId(authUser.userId);
    const institutionId = new ObjectId(authUser.institutionId);
    const paymentsCollection = getPaymentsCollection();
    const usersCollection = getUsersCollection();

    const wallet = await ensureStudentWallet(userId, institutionId);
    const user = await usersCollection.findOne({ _id: userId });
    if (!user) return c.json({ error: 'User not found' }, 404);

    const reference = PaystackService.generateReference('TOPUP');

    await paymentsCollection.insertOne({
      userId,
      institutionId,
      reference,
      amount: data.amount,
      currency: 'NGN',
      paymentType: 'wallet_topup',
      transactionType: 'credit',
      status: 'pending',
      paymentGateway: 'paystack',
      balanceBefore: wallet.balance,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const callbackUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/payment/callback`;
    const paystackResponse = await PaystackService.initializePayment({
      email: user.email,
      amount: data.amount,
      reference,
      callbackUrl,
      metadata: {
        userId: userId.toString(),
        userType: authUser.userType,
        paymentType: 'wallet_topup',
      },
    });

    if (!paystackResponse.success) {
      return c.json({ error: paystackResponse.message || 'Failed to initialize payment' }, 400);
    }

    return c.json({
      message: 'Payment initialized successfully',
      reference,
      authorizationUrl: paystackResponse.authorizationUrl,
      accessCode: paystackResponse.accessCode,
    });
  } catch (error) {
    console.error('Wallet topup error:', error);
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    return c.json({ error: 'Failed to initialize payment' }, 500);
  }
});

/**
 * GET /api/payments/verify/:reference
 */
payment.get('/verify/:reference', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const reference = c.req.param('reference');
    const userId = new ObjectId(authUser.userId);
    const paymentsCollection = getPaymentsCollection();

    const paymentRecord = await paymentsCollection.findOne({ reference, userId });
    if (!paymentRecord) {
      return c.json({ error: 'Payment not found' }, 404);
    }

    const result = await completeWalletTopUp(reference);

    if (!result.ok) {
      return c.json({
        message: 'Payment verification failed',
        status: 'failed',
        reference,
      }, 400);
    }

    return c.json({
      message: result.alreadyCompleted
        ? 'Payment already verified'
        : 'Payment verified successfully',
      status: 'success',
      amount: result.amount,
      reference,
      newBalance: result.newBalance,
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    return c.json({ error: 'Failed to verify payment' }, 500);
  }
});

/**
 * POST /api/payments/service/pay
 */
payment.post('/service/pay', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const body = await c.req.json();
    const data = servicePaymentSchema.parse(body);

    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students can pay for services' }, 403);
    }

    const description =
      data.description?.trim() || serviceLabel(data.serviceType);

    const result = await debitWalletForService({
      userId: new ObjectId(authUser.userId),
      institutionId: new ObjectId(authUser.institutionId),
      amount: data.amount,
      paymentType: data.serviceType,
      description,
      referencePrefix: data.serviceType.toUpperCase(),
    });

    if (!result.ok) {
      return c.json(result, 400);
    }

    return c.json({
      message: 'Payment successful',
      reference: result.reference,
      amount: result.amount,
      serviceType: result.serviceType,
      newBalance: result.newBalance,
    });
  } catch (error) {
    console.error('Service payment error:', error);
    if (error instanceof z.ZodError) {
      return c.json({ error: 'Validation error', details: error.issues }, 400);
    }
    return c.json({ error: 'Failed to process payment' }, 500);
  }
});

/**
 * GET /api/payments/history
 */
payment.get('/history', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const userId = new ObjectId(authUser.userId);
    const paymentsCollection = getPaymentsCollection();

    const page = parseInt(c.req.query('page') || '1');
    const limit = Math.min(parseInt(c.req.query('limit') || '20'), 50);
    const skip = (page - 1) * limit;
    const filter = c.req.query('filter'); // all | credit | debit | pending

    const query: Record<string, unknown> = { userId };
    if (filter === 'credit') query.transactionType = 'credit';
    if (filter === 'debit') query.transactionType = 'debit';
    if (filter === 'pending') query.status = 'pending';

    const [transactions, total] = await Promise.all([
      paymentsCollection.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      paymentsCollection.countDocuments(query),
    ]);

    return c.json({
      transactions: transactions.map(serializeTransaction),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error('Get history error:', error);
    return c.json({ error: 'Failed to fetch transaction history' }, 500);
  }
});

export default payment;
