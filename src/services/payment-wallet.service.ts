import { ObjectId } from 'mongodb';
import { PaystackService } from './paystack.services.js';
import { getWalletsCollection, getPaymentsCollection } from '../database/connection.js';

export type CompleteTopUpResult =
  | { ok: true; alreadyCompleted: boolean; amount: number; newBalance: number; reference: string }
  | { ok: false; reason: 'not_found' | 'not_topup' | 'failed' | 'pending' };

/**
 * Idempotently credit a wallet from a pending wallet_topup payment.
 * Used by GET /verify and Paystack webhooks.
 */
export async function completeWalletTopUp(reference: string): Promise<CompleteTopUpResult> {
  const paymentsCollection = getPaymentsCollection();
  const walletsCollection = getWalletsCollection();

  const paymentRecord = await paymentsCollection.findOne({ reference });
  if (!paymentRecord) {
    return { ok: false, reason: 'not_found' };
  }

  if (paymentRecord.paymentType !== 'wallet_topup') {
    return { ok: false, reason: 'not_topup' };
  }

  if (paymentRecord.status === 'success') {
    const wallet = await walletsCollection.findOne({ userId: paymentRecord.userId });
    return {
      ok: true,
      alreadyCompleted: true,
      amount: paymentRecord.amount,
      newBalance: wallet?.balance ?? paymentRecord.balanceAfter ?? 0,
      reference,
    };
  }

  const verification = await PaystackService.verifyPayment(reference);

  if (!verification.success || verification.status !== 'success') {
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
    return { ok: false, reason: 'failed' };
  }

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

  const wallet = await walletsCollection.findOneAndUpdate(
    { userId: paymentRecord.userId },
    {
      $inc: { balance: paymentRecord.amount },
      $set: { updatedAt: new Date() },
    },
    { returnDocument: 'after' }
  );

  const newBalance = wallet?.balance ?? 0;

  await paymentsCollection.updateOne(
    { reference },
    { $set: { balanceAfter: newBalance } }
  );

  return {
    ok: true,
    alreadyCompleted: false,
    amount: paymentRecord.amount,
    newBalance,
    reference,
  };
}

export async function ensureStudentWallet(
  userId: ObjectId,
  institutionId: ObjectId
) {
  const walletsCollection = getWalletsCollection();
  let wallet = await walletsCollection.findOne({ userId });
  if (!wallet) {
    const newWallet = {
      userId,
      balance: 0,
      currency: 'NGN',
      institutionId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await walletsCollection.insertOne(newWallet);
    wallet = { ...newWallet, _id: result.insertedId };
  }
  return wallet;
}

/**
 * Credit wallet from a bank transfer to a dedicated virtual account (no prior pending payment).
 */
export async function completeDedicatedNubanInflow(params: {
  reference: string;
  amount: number;
  accountNumber: string;
  paystackResponse?: unknown;
}): Promise<CompleteTopUpResult> {
  const paymentsCollection = getPaymentsCollection();
  const walletsCollection = getWalletsCollection();

  const normalizedAccount = params.accountNumber.replace(/\D/g, '');
  const wallet = await walletsCollection.findOne({
    $or: [
      { 'dedicatedAccount.accountNumber': normalizedAccount },
      { 'dedicatedAccount.accountNumber': params.accountNumber },
    ],
  });

  if (!wallet) {
    return { ok: false, reason: 'not_found' };
  }

  const existing = await paymentsCollection.findOne({ reference: params.reference });
  if (existing?.status === 'success') {
    return {
      ok: true,
      alreadyCompleted: true,
      amount: existing.amount,
      newBalance: wallet.balance,
      reference: params.reference,
    };
  }

  if (!existing) {
    await paymentsCollection.insertOne({
      userId: wallet.userId,
      institutionId: wallet.institutionId,
      reference: params.reference,
      amount: params.amount,
      currency: 'NGN',
      paymentType: 'wallet_topup',
      transactionType: 'credit',
      status: 'pending',
      paymentGateway: 'paystack',
      description: 'Bank transfer to wallet',
      balanceBefore: wallet.balance,
      metadata: { channel: 'dedicated_nuban', accountNumber: normalizedAccount },
      paystackResponse: params.paystackResponse,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  await paymentsCollection.updateOne(
    { reference: params.reference },
    {
      $set: {
        status: 'success',
        paidAt: new Date(),
        paystackResponse: params.paystackResponse,
        updatedAt: new Date(),
      },
    }
  );

  const updatedWallet = await walletsCollection.findOneAndUpdate(
    { userId: wallet.userId },
    { $inc: { balance: params.amount }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' }
  );

  const newBalance = updatedWallet?.balance ?? wallet.balance + params.amount;

  await paymentsCollection.updateOne(
    { reference: params.reference },
    { $set: { balanceAfter: newBalance } }
  );

  return {
    ok: true,
    alreadyCompleted: false,
    amount: params.amount,
    newBalance,
    reference: params.reference,
  };
}

export function serviceLabel(serviceType: string): string {
  const labels: Record<string, string> = {
    wallet_topup: 'Wallet top-up',
    tuition: 'Tuition / school fees',
    school_fees: 'School fees',
    departmental_dues: 'Departmental dues',
    cafeteria: 'Cafeteria',
    library_fine: 'Library fine',
    hostel: 'Hostel',
    transport: 'Transport',
    other: 'Campus payment',
  };
  return labels[serviceType] || 'Campus payment';
}
