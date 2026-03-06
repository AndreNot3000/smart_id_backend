import { Hono } from 'hono';
import { z } from 'zod';
import { ObjectId } from 'mongodb';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { PaystackService } from '../services/paystack.services.js';
import { 
  getWalletsCollection, 
  getPaymentsCollection, 
  getServicePaymentsCollection,
  getUsersCollection 
} from '../database/connection.js';
import type { PaymentType } from '../models/payment.model.js';

const payment = new Hono();

// Validation schemas
const topupWalletSchema = z.object({
  amount: z.number().min(100, 'Minimum top-up amount is ₦100').max(1000000, 'Maximum top-up amount is ₦1,000,000'),
});

const servicePaymentSchema = z.object({
  serviceType: z.enum(['cafeteria', 'library_fine', 'hostel', 'transport', 'other']),
  amount: z.number().min(1, 'Amount must be greater than 0'),
  description: z.string().min(1, 'Description is required'),
});

/**
 * Get or Create Wallet for Current User
 * GET /api/payments/wallet
 */
payment.get('/wallet', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const userId = new ObjectId(authUser.userId);
    const walletsCollection = getWalletsCollection();

    // Only students can have wallets
    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students can have wallets' }, 403);
    }

    // Get or create wallet
    let wallet = await walletsCollection.findOne({ userId });

    if (!wallet) {
      // Create new wallet
      const newWallet = {
        userId,
        balance: 0,
        currency: 'NGN',
        institutionId: new ObjectId(authUser.institutionId),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await walletsCollection.insertOne(newWallet);
      wallet = { ...newWallet, _id: result.insertedId };
    }

    return c.json({
      wallet: {
        id: wallet._id,
        balance: wallet.balance,
        currency: wallet.currency,
        isActive: wallet.isActive,
      },
    });
  } catch (error) {
    console.error('Get wallet error:', error);
    return c.json({ error: 'Failed to fetch wallet' }, 500);
  }
});

/**
 * Initialize Wallet Top-up
 * POST /api/payments/wallet/topup
 */
payment.post('/wallet/topup', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const body = await c.req.json();
    const data = topupWalletSchema.parse(body);

    // Only students can top up wallets
    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students can top up wallets' }, 403);
    }

    const userId = new ObjectId(authUser.userId);
    const walletsCollection = getWalletsCollection();
    const paymentsCollection = getPaymentsCollection();
    const usersCollection = getUsersCollection();

    // Get or create wallet
    let wallet = await walletsCollection.findOne({ userId });
    if (!wallet) {
      const newWallet = {
        userId,
        balance: 0,
        currency: 'NGN',
        institutionId: new ObjectId(authUser.institutionId),
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const result = await walletsCollection.insertOne(newWallet);
      wallet = { ...newWallet, _id: result.insertedId };
    }

    // Get user email
    const user = await usersCollection.findOne({ _id: userId });
    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Generate payment reference
    const reference = PaystackService.generateReference('TOPUP');

    // Create pending payment record
    const paymentRecord = {
      userId,
      institutionId: new ObjectId(authUser.institutionId),
      reference,
      amount: data.amount,
      currency: 'NGN',
      paymentType: 'wallet_topup' as PaymentType,
      transactionType: 'credit' as const,
      status: 'pending' as const,
      paymentGateway: 'paystack' as const,
      balanceBefore: wallet.balance,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await paymentsCollection.insertOne(paymentRecord);

    // Initialize Paystack payment
    const paystackResponse = await PaystackService.initializePayment({
      email: user.email,
      amount: data.amount,
      reference,
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
 * Verify Payment
 * GET /api/payments/verify/:reference
 */
payment.get('/verify/:reference', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const reference = c.req.param('reference');
    const userId = new ObjectId(authUser.userId);

    const paymentsCollection = getPaymentsCollection();
    const walletsCollection = getWalletsCollection();

    // Get payment record
    const paymentRecord = await paymentsCollection.findOne({ reference, userId });
    if (!paymentRecord) {
      return c.json({ error: 'Payment not found' }, 404);
    }

    // If already verified, return status
    if (paymentRecord.status === 'success') {
      return c.json({
        message: 'Payment already verified',
        status: 'success',
        amount: paymentRecord.amount,
        reference,
      });
    }

    // Verify with Paystack
    const verification = await PaystackService.verifyPayment(reference);

    if (verification.success && verification.status === 'success') {
      // Update payment record
      await paymentsCollection.updateOne(
        { reference },
        {
          $set: {
            status: 'success',
            paidAt: verification.paidAt || new Date(),
            paystackResponse: verification,
            updatedAt: new Date(),
          },
        }
      );

      // Credit wallet
      const wallet = await walletsCollection.findOneAndUpdate(
        { userId },
        {
          $inc: { balance: paymentRecord.amount },
          $set: { updatedAt: new Date() },
        },
        { returnDocument: 'after' }
      );

      // Update balanceAfter in payment record
      await paymentsCollection.updateOne(
        { reference },
        { $set: { balanceAfter: wallet?.balance || 0 } }
      );

      return c.json({
        message: 'Payment verified successfully',
        status: 'success',
        amount: paymentRecord.amount,
        reference,
        newBalance: wallet?.balance || 0,
      });
    } else {
      // Update payment as failed
      await paymentsCollection.updateOne(
        { reference },
        {
          $set: {
            status: 'failed',
            paystackResponse: verification,
            updatedAt: new Date(),
          },
        }
      );

      return c.json({
        message: 'Payment verification failed',
        status: 'failed',
        reference,
      }, 400);
    }
  } catch (error) {
    console.error('Verify payment error:', error);
    return c.json({ error: 'Failed to verify payment' }, 500);
  }
});

/**
 * Pay for Service (Cafeteria, Library, etc.)
 * POST /api/payments/service/pay
 */
payment.post('/service/pay', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const body = await c.req.json();
    const data = servicePaymentSchema.parse(body);

    // Only students can pay for services
    if (authUser.userType !== 'student') {
      return c.json({ error: 'Only students can pay for services' }, 403);
    }

    const userId = new ObjectId(authUser.userId);
    const walletsCollection = getWalletsCollection();
    const paymentsCollection = getPaymentsCollection();
    const servicePaymentsCollection = getServicePaymentsCollection();

    // Get wallet
    const wallet = await walletsCollection.findOne({ userId });
    if (!wallet) {
      return c.json({ error: 'Wallet not found. Please create a wallet first.' }, 404);
    }

    // Check balance
    if (wallet.balance < data.amount) {
      return c.json({ 
        error: 'Insufficient balance', 
        currentBalance: wallet.balance,
        required: data.amount 
      }, 400);
    }

    // Generate reference
    const reference = PaystackService.generateReference(data.serviceType.toUpperCase());

    // Deduct from wallet
    const updatedWallet = await walletsCollection.findOneAndUpdate(
      { userId },
      {
        $inc: { balance: -data.amount },
        $set: { updatedAt: new Date() },
      },
      { returnDocument: 'after' }
    );

    // Create payment record
    const paymentRecord = {
      userId,
      institutionId: new ObjectId(authUser.institutionId),
      reference,
      amount: data.amount,
      currency: 'NGN',
      paymentType: data.serviceType as PaymentType,
      transactionType: 'debit' as const,
      status: 'success' as const,
      paymentGateway: 'paystack' as const,
      description: data.description,
      balanceBefore: wallet.balance,
      balanceAfter: updatedWallet?.balance || 0,
      paidAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await paymentsCollection.insertOne(paymentRecord);

    // Create service payment record
    const servicePaymentRecord = {
      userId,
      institutionId: new ObjectId(authUser.institutionId),
      serviceType: data.serviceType as PaymentType,
      amount: data.amount,
      description: data.description,
      reference,
      status: 'success' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await servicePaymentsCollection.insertOne(servicePaymentRecord);

    return c.json({
      message: 'Payment successful',
      reference,
      amount: data.amount,
      serviceType: data.serviceType,
      newBalance: updatedWallet?.balance || 0,
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
 * Get Transaction History
 * GET /api/payments/history
 */
payment.get('/history', authMiddleware, async (c) => {
  try {
    const authUser = c.get('user');
    const userId = new ObjectId(authUser.userId);
    const paymentsCollection = getPaymentsCollection();

    // Pagination
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      paymentsCollection
        .find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      paymentsCollection.countDocuments({ userId }),
    ]);

    return c.json({
      transactions: transactions.map(t => ({
        id: t._id,
        reference: t.reference,
        amount: t.amount,
        type: t.paymentType,
        transactionType: t.transactionType,
        status: t.status,
        description: t.description,
        balanceBefore: t.balanceBefore,
        balanceAfter: t.balanceAfter,
        createdAt: t.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Get history error:', error);
    return c.json({ error: 'Failed to fetch transaction history' }, 500);
  }
});

export default payment;
