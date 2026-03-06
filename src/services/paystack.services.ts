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

export class PaystackService {
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
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('sha512', PAYSTACK_SECRET_KEY)
      .update(body)
      .digest('hex');
    
    return hash === signature;
  }
}
