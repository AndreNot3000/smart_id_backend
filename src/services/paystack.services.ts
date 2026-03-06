import Paystack from 'paystack-node';

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const paystack = new Paystack(PAYSTACK_SECRET_KEY);

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

export class PaystackService {
  /**
   * Initialize a payment transaction
   * @param params Payment initialization parameters
   * @returns Authorization URL and access code
   */
  static async initializePayment(params: InitializePaymentParams) {
    try {
      const response = await paystack.transaction.initialize({
        email: params.email,
        amount: Math.round(params.amount * 100), // Convert to kobo (smallest unit)
        reference: params.reference,
        callback_url: params.callbackUrl || `${process.env.FRONTEND_URL}/payment/callback`,
        metadata: params.metadata,
        channels: ['card', 'bank', 'ussd', 'mobile_money', 'bank_transfer'],
      });

      if (response.status) {
        return {
          success: true,
          authorizationUrl: response.data.authorization_url,
          accessCode: response.data.access_code,
          reference: response.data.reference,
        };
      }

      return {
        success: false,
        message: response.message || 'Failed to initialize payment',
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
      const response = await paystack.transaction.verify(reference);

      if (response.status && response.data) {
        const data = response.data;
        
        return {
          success: data.status === 'success',
          reference: data.reference,
          amount: data.amount / 100, // Convert from kobo to Naira
          status: data.status,
          paidAt: data.paid_at ? new Date(data.paid_at) : undefined,
          channel: data.channel,
          currency: data.currency,
          metadata: data.metadata,
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
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(body)
      .digest('hex');
    
    return hash === signature;
  }
}
