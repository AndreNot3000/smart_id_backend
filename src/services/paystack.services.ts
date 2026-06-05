import crypto from 'node:crypto';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export interface InitializePaymentParams {
  email: string;
  amount: number; // In Naira
  reference: string;
  callbackUrl?: string;
  metadata?: any;
}

export interface VerifyPaymentResponse {
  success: boolean;
  reference: string;
  amount: number;
  status: string;
  paidAt?: Date;
  channel?: string;
  currency?: string;
  metadata?: any;
}

export interface PaystackCustomer {
  id: number;
  customer_code: string;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
}

export interface PaystackDedicatedAccount {
  id: number;
  account_number: string;
  account_name: string;
  bank: { name: string; slug: string; id?: number };
  customer: { id: number; customer_code: string };
  active: boolean;
  assigned: boolean;
}

export class PaystackService {
  private static async request<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>
  ): Promise<{ ok: boolean; data?: T; message?: string }> {
    try {
      const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json: any = await response.json();
      if (json.status && json.data !== undefined) {
        return { ok: true, data: json.data as T };
      }
      return { ok: false, message: json.message || 'Paystack request failed' };
    } catch (error: any) {
      console.error(`Paystack ${method} ${path} error:`, error);
      return { ok: false, message: error.message || 'Paystack request failed' };
    }
  }

  static async createCustomer(params: {
    email: string;
    first_name: string;
    last_name: string;
    phone?: string;
  }) {
    return this.request<PaystackCustomer>('POST', '/customer', {
      email: params.email,
      first_name: params.first_name,
      last_name: params.last_name,
      ...(params.phone ? { phone: params.phone } : {}),
    });
  }

  static async updateCustomer(
    customerCode: string,
    params: { first_name?: string; last_name?: string; phone?: string }
  ) {
    return this.request<PaystackCustomer>('PUT', `/customer/${customerCode}`, params);
  }

  static async createDedicatedAccount(params: {
    customer: string;
    preferred_bank?: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  }) {
    const preferred =
      params.preferred_bank ||
      process.env.PAYSTACK_DVA_PREFERRED_BANK ||
      (process.env.NODE_ENV === 'production' ? 'wema-bank' : 'test-bank');

    return this.request<PaystackDedicatedAccount>('POST', '/dedicated_account', {
      customer: params.customer,
      preferred_bank: preferred,
      ...(params.first_name ? { first_name: params.first_name } : {}),
      ...(params.last_name ? { last_name: params.last_name } : {}),
      ...(params.phone ? { phone: params.phone } : {}),
    });
  }

  static async assignDedicatedAccount(params: {
    email: string;
    first_name: string;
    last_name: string;
    phone: string;
    bvn: string;
    account_number: string;
    bank_code: string;
    preferred_bank?: string;
    country?: string;
  }) {
    const preferred =
      params.preferred_bank ||
      process.env.PAYSTACK_DVA_PREFERRED_BANK ||
      'wema-bank';

    return this.request<PaystackDedicatedAccount>('POST', '/dedicated_account/assign', {
      email: params.email,
      first_name: params.first_name,
      last_name: params.last_name,
      phone: params.phone,
      bvn: params.bvn,
      account_number: params.account_number,
      bank_code: params.bank_code,
      preferred_bank: preferred,
      country: params.country || 'NG',
    });
  }

  static async fetchDedicatedAccounts(customerCode: string) {
    return this.request<PaystackDedicatedAccount[]>(
      'GET',
      `/dedicated_account?customer=${encodeURIComponent(customerCode)}`
    );
  }

  /**
   * Initialize a payment transaction
   * @param params Payment initialization parameters
   * @returns Authorization URL and access code
   */
  static async initializePayment(params: InitializePaymentParams) {
    try {
      const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: params.email,
          amount: Math.round(params.amount * 100), // Convert to kobo
          reference: params.reference,
          callback_url: params.callbackUrl || `${process.env.FRONTEND_URL}/payment/callback`,
          metadata: params.metadata,
          channels: ['card', 'bank', 'ussd', 'mobile_money', 'bank_transfer'],
        }),
      });

      const data: any = await response.json();

      if (data.status && data.data) {
        return {
          success: true,
          authorizationUrl: data.data.authorization_url,
          accessCode: data.data.access_code,
          reference: data.data.reference,
        };
      }

      return {
        success: false,
        message: data.message || 'Failed to initialize payment',
      };
    } catch (error: any) {
      console.error('Paystack initialization error:', error);
      return {
        success: false,
        message: error.message || 'Payment initialization failed',
      };
    }
  }

  /**
   * Verify a payment transaction
   * @param reference Payment reference
   * @returns Payment verification details
   */
  static async verifyPayment(reference: string): Promise<VerifyPaymentResponse> {
    try {
      const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      const data: any = await response.json();

      if (data.status && data.data) {
        const txData = data.data;
        
        return {
          success: txData.status === 'success',
          reference: txData.reference,
          amount: txData.amount / 100, // Convert from kobo to Naira
          status: txData.status,
          paidAt: txData.paid_at ? new Date(txData.paid_at) : undefined,
          channel: txData.channel,
          currency: txData.currency,
          metadata: txData.metadata,
        };
      }

      return {
        success: false,
        reference,
        amount: 0,
        status: 'failed',
      };
    } catch (error: any) {
      console.error('Paystack verification error:', error);
      return {
        success: false,
        reference,
        amount: 0,
        status: 'failed',
      };
    }
  }

  /**
   * Generate a unique payment reference
   * @param prefix Optional prefix for the reference
   * @returns Unique reference string
   */
  static generateReference(prefix: string = 'PAY'): string {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000000);
    return `${prefix}_${timestamp}_${random}`;
  }

  /**
   * Verify webhook signature
   * @param signature Signature from webhook header
   * @param body Request body
   * @returns Boolean indicating if signature is valid
   */
  static verifyWebhookSignature(signature: string, body: string): boolean {
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(body)
      .digest('hex');
    
    return hash === signature;
  }
}
