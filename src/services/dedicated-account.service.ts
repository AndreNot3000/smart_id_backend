import { ObjectId } from 'mongodb';
import { PaystackService } from './paystack.services.js';
import { ensureStudentWallet } from './payment-wallet.service.js';
import { getWalletsCollection, getUsersCollection } from '../database/connection.js';
import type { WalletDedicatedAccount } from '../models/payment.model.js';

export type ProvisionDedicatedAccountInput = {
  userId: ObjectId;
  institutionId: ObjectId;
  bvn?: string;
  accountNumber?: string;
  bankCode?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
};

export type ProvisionDedicatedAccountResult =
  | { ok: true; dedicatedAccount: WalletDedicatedAccount; pending?: boolean }
  | { ok: false; error: string; requiresBvn?: boolean; requiresProfile?: boolean };

function serializeDedicatedAccount(
  dva: {
    account_number: string;
    account_name: string;
    bank: { name: string; slug: string };
    id?: number;
    customer: { customer_code: string };
    active?: boolean;
    assigned?: boolean;
  },
  customerCode: string
): WalletDedicatedAccount {
  return {
    accountNumber: dva.account_number,
    accountName: dva.account_name,
    bankName: dva.bank.name,
    bankSlug: dva.bank.slug,
    paystackDedicatedId: dva.id,
    paystackCustomerCode: customerCode,
    status: dva.active !== false && dva.assigned !== false ? 'active' : 'pending',
    assignedAt: new Date(),
  };
}

function isMockDvaEnabled(): boolean {
  return process.env.PAYSTACK_DVA_MOCK === 'true' || process.env.PAYSTACK_DVA_MOCK === '1';
}

function shouldFallbackToMock(paystackMessage?: string): boolean {
  if (isMockDvaEnabled()) return true;
  if (process.env.NODE_ENV === 'production') return false;
  const msg = (paystackMessage || '').toLowerCase();
  return (
    msg.includes('not available') ||
    msg.includes('dedicated nuban') ||
    msg.includes('dedicated virtual') ||
    msg.includes('not enabled')
  );
}

function createMockDedicatedAccount(
  userId: ObjectId,
  firstName: string,
  lastName: string
): WalletDedicatedAccount {
  const suffix = userId.toString().slice(-9).padStart(9, '0');
  return {
    accountNumber: `88${suffix}`,
    accountName: `${firstName} ${lastName}`.toUpperCase(),
    bankName: 'Test Bank (Demo)',
    bankSlug: 'test-bank',
    paystackCustomerCode: `MOCK_${userId.toString()}`,
    status: 'active',
    assignedAt: new Date(),
    isMock: true,
  };
}

export async function getDedicatedAccountForUser(userId: ObjectId) {
  const walletsCollection = getWalletsCollection();
  const wallet = await walletsCollection.findOne({ userId });
  return wallet?.dedicatedAccount ?? null;
}

export async function provisionDedicatedAccount(
  input: ProvisionDedicatedAccountInput
): Promise<ProvisionDedicatedAccountResult> {
  const usersCollection = getUsersCollection();
  const walletsCollection = getWalletsCollection();

  const user = await usersCollection.findOne({ _id: input.userId });
  if (!user) return { ok: false, error: 'User not found' };

  const wallet = await ensureStudentWallet(input.userId, input.institutionId);

  if (wallet.dedicatedAccount?.accountNumber && wallet.dedicatedAccount.status === 'active') {
    return { ok: true, dedicatedAccount: wallet.dedicatedAccount };
  }

  const firstName = input.firstName?.trim() || user.profile?.firstName?.trim();
  const lastName = input.lastName?.trim() || user.profile?.lastName?.trim();
  const phone = input.phone?.trim() || user.profile?.phone?.trim();

  if (!firstName || !lastName) {
    return {
      ok: false,
      error: 'First and last name are required. Update your profile or provide them when requesting an account.',
      requiresProfile: true,
    };
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const hasBvn = Boolean(input.bvn?.trim());

  if (isProduction && !hasBvn) {
    return {
      ok: false,
      error: 'BVN is required to generate a dedicated account number in production.',
      requiresBvn: true,
    };
  }

  if (hasBvn && (!input.accountNumber?.trim() || !input.bankCode?.trim())) {
    return {
      ok: false,
      error: 'Your personal bank account number and bank are required with BVN for verification.',
    };
  }

  if (!phone && hasBvn) {
    return {
      ok: false,
      error: 'Phone number is required. Update your profile or enter it below.',
      requiresProfile: true,
    };
  }

  if (isMockDvaEnabled() && !hasBvn) {
    const dedicatedAccount = createMockDedicatedAccount(input.userId, firstName, lastName);
    await walletsCollection.updateOne(
      { userId: input.userId },
      {
        $set: {
          paystackCustomerCode: dedicatedAccount.paystackCustomerCode,
          dedicatedAccount,
          updatedAt: new Date(),
        },
      }
    );
    return { ok: true, dedicatedAccount, pending: false };
  }

  let customerCode = wallet.paystackCustomerCode;

  if (!customerCode) {
    const created = await PaystackService.createCustomer({
      email: user.email,
      first_name: firstName,
      last_name: lastName,
      phone: phone || undefined,
    });

    if (!created.ok || !created.data) {
      return { ok: false, error: created.message || 'Failed to create Paystack customer' };
    }

    customerCode = created.data.customer_code;
    await walletsCollection.updateOne(
      { userId: input.userId },
      { $set: { paystackCustomerCode: customerCode, updatedAt: new Date() } }
    );
  } else if (phone) {
    await PaystackService.updateCustomer(customerCode, {
      first_name: firstName,
      last_name: lastName,
      phone,
    });
  }

  let dvaResult: { ok: boolean; data?: any; message?: string };

  if (hasBvn && input.bvn && input.accountNumber && input.bankCode) {
    dvaResult = await PaystackService.assignDedicatedAccount({
      email: user.email,
      first_name: firstName,
      last_name: lastName,
      phone: phone!,
      bvn: input.bvn.replace(/\D/g, ''),
      account_number: input.accountNumber.replace(/\D/g, ''),
      bank_code: input.bankCode,
    });
  } else {
    dvaResult = await PaystackService.createDedicatedAccount({
      customer: customerCode,
      first_name: firstName,
      last_name: lastName,
      phone: phone || undefined,
    });
  }

  if (!dvaResult.ok || !dvaResult.data) {
    const msg = dvaResult.message || 'Failed to assign dedicated account';

    if (shouldFallbackToMock(msg)) {
      const dedicatedAccount = createMockDedicatedAccount(input.userId, firstName, lastName);
      await walletsCollection.updateOne(
        { userId: input.userId },
        {
          $set: {
            paystackCustomerCode: dedicatedAccount.paystackCustomerCode,
            dedicatedAccount,
            updatedAt: new Date(),
          },
        }
      );
      return { ok: true, dedicatedAccount, pending: false };
    }

    if (/bvn|identification|validate/i.test(msg)) {
      return { ok: false, error: msg, requiresBvn: true };
    }
    return { ok: false, error: msg };
  }

  const payload = dvaResult.data.dedicated_account ?? dvaResult.data;
  const dedicatedAccount = serializeDedicatedAccount(
    {
      account_number: payload.account_number,
      account_name: payload.account_name,
      bank: payload.bank,
      id: payload.id,
      customer: { customer_code: customerCode },
      active: payload.active,
      assigned: payload.assigned,
    },
    customerCode
  );

  await walletsCollection.updateOne(
    { userId: input.userId },
    {
      $set: {
        paystackCustomerCode: customerCode,
        dedicatedAccount,
        updatedAt: new Date(),
      },
    }
  );

  return {
    ok: true,
    dedicatedAccount,
    pending: dedicatedAccount.status === 'pending',
  };
}

export async function syncDedicatedAccountFromWebhook(data: {
  customer?: { customer_code?: string; email?: string };
  dedicated_account?: {
    account_number: string;
    account_name: string;
    bank: { name: string; slug: string };
    id?: number;
    active?: boolean;
    assigned?: boolean;
  };
}) {
  const customerCode = data.customer?.customer_code;
  const dva = data.dedicated_account;
  if (!customerCode || !dva?.account_number) return;

  const walletsCollection = getWalletsCollection();
  const dedicatedAccount = serializeDedicatedAccount(
    {
      ...dva,
      customer: { customer_code: customerCode },
    },
    customerCode
  );

  await walletsCollection.updateOne(
    { paystackCustomerCode: customerCode },
    { $set: { dedicatedAccount, updatedAt: new Date() } }
  );
}

/**
 * Dev/demo: simulate an incoming bank transfer to a mock dedicated account.
 */
export async function simulateMockBankTransfer(
  userId: ObjectId,
  amount: number
): Promise<{ ok: true; newBalance: number; reference: string } | { ok: false; error: string }> {
  if (process.env.NODE_ENV === 'production' && !isMockDvaEnabled()) {
    return { ok: false, error: 'Mock transfers are disabled in production' };
  }

  const walletsCollection = getWalletsCollection();
  const wallet = await walletsCollection.findOne({ userId });

  if (!wallet?.dedicatedAccount?.isMock) {
    return { ok: false, error: 'No demo account found. Get an account number first.' };
  }

  const { completeDedicatedNubanInflow } = await import('./payment-wallet.service.js');
  const reference = `MOCK_DVA_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  const result = await completeDedicatedNubanInflow({
    reference,
    amount,
    accountNumber: wallet.dedicatedAccount.accountNumber,
    paystackResponse: { channel: 'dedicated_nuban', mock: true },
  });

  if (!result.ok) {
    return { ok: false, error: 'Failed to credit wallet' };
  }

  return { ok: true, newBalance: result.newBalance, reference };
}
