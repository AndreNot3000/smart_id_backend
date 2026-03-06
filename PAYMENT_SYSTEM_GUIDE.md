# Payment System Guide - Campus Services

## Overview
Student wallet system for campus services (cafeteria, library fines, hostel, transport, etc.) using Paystack.

## System Flow

```
1. Student tops up wallet via Paystack
2. Paystack processes payment
3. Wallet balance credited
4. Student uses wallet for campus services
5. Services deduct from wallet balance
```

---

## Setup

### 1. Get Paystack API Keys

1. Go to https://paystack.com
2. Sign up / Login
3. Go to Settings → API Keys & Webhooks
4. Copy your keys:
   - Test Secret Key: `sk_test_...`
   - Test Public Key: `pk_test_...`
   - Live Secret Key: `sk_live_...` (for production)
   - Live Public Key: `pk_live_...` (for production)

### 2. Update .env File

```env
# Paystack Configuration
PAYSTACK_SECRET_KEY=sk_test_your_secret_key_here
PAYSTACK_PUBLIC_KEY=pk_test_your_public_key_here
```

**IMPORTANT:** Never commit real API keys to GitHub!

---

## API Endpoints

### Base URL
```
Production: https://api.smartunivid.xyz/api/payments
Development: http://localhost:8000/api/payments
```

### Authentication
All endpoints require JWT token:
```javascript
headers: {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
}
```

---

## 1. Get Wallet Balance

**GET** `/api/payments/wallet`

**Response:**
```json
{
  "wallet": {
    "id": "...",
    "balance": 5000,
    "currency": "NGN",
    "isActive": true
  }
}
```

---

## 2. Top Up Wallet

**POST** `/api/payments/wallet/topup`

**Request Body:**
```json
{
  "amount": 5000
}
```

**Response:**
```json
{
  "message": "Payment initialized successfully",
  "reference": "TOPUP_1234567890_123456",
  "authorizationUrl": "https://checkout.paystack.com/...",
  "accessCode": "..."
}
```

**Frontend Flow:**
1. Call this endpoint
2. Redirect user to `authorizationUrl`
3. User completes payment on Paystack
4. Paystack redirects back to your callback URL
5. Verify payment using reference

**Minimum:** ₦100  
**Maximum:** ₦1,000,000

---

## 3. Verify Payment

**GET** `/api/payments/verify/:reference`

**Response (Success):**
```json
{
  "message": "Payment verified successfully",
  "status": "success",
  "amount": 5000,
  "reference": "TOPUP_1234567890_123456",
  "newBalance": 5000
}
```

**Response (Failed):**
```json
{
  "message": "Payment verification failed",
  "status": "failed",
  "reference": "TOPUP_1234567890_123456"
}
```

---

## 4. Pay for Service

**POST** `/api/payments/service/pay`

**Request Body:**
```json
{
  "serviceType": "cafeteria",
  "amount": 500,
  "description": "Lunch - Rice and Chicken"
}
```

**Service Types:**
- `cafeteria` - Food purchases
- `library_fine` - Library fines
- `hostel` - Hostel fees
- `transport` - Transport fees
- `other` - Other services

**Response:**
```json
{
  "message": "Payment successful",
  "reference": "CAFETERIA_1234567890_123456",
  "amount": 500,
  "serviceType": "cafeteria",
  "newBalance": 4500
}
```

**Error (Insufficient Balance):**
```json
{
  "error": "Insufficient balance",
  "currentBalance": 100,
  "required": 500
}
```

---

## 5. Get Transaction History

**GET** `/api/payments/history?page=1&limit=20`

**Response:**
```json
{
  "transactions": [
    {
      "id": "...",
      "reference": "TOPUP_1234567890_123456",
      "amount": 5000,
      "type": "wallet_topup",
      "transactionType": "credit",
      "status": "success",
      "description": null,
      "balanceBefore": 0,
      "balanceAfter": 5000,
      "createdAt": "2026-03-06T10:00:00.000Z"
    },
    {
      "id": "...",
      "reference": "CAFETERIA_1234567890_123456",
      "amount": 500,
      "type": "cafeteria",
      "transactionType": "debit",
      "status": "success",
      "description": "Lunch - Rice and Chicken",
      "balanceBefore": 5000,
      "balanceAfter": 4500,
      "createdAt": "2026-03-06T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 2,
    "totalPages": 1
  }
}
```

---

## Frontend Implementation

### 1. Wallet Top-Up Component

```jsx
'use client';

import { useState } from 'react';

export default function WalletTopUp() {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);

  const handleTopUp = async () => {
    if (!amount || parseFloat(amount) < 100) {
      alert('Minimum top-up is ₦100');
      return;
    }

    setLoading(true);

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch('https://api.smartunivid.xyz/api/payments/wallet/topup', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: parseFloat(amount)
        })
      });

      const data = await response.json();

      if (response.ok) {
        // Redirect to Paystack payment page
        window.location.href = data.authorizationUrl;
      } else {
        alert(data.error || 'Failed to initialize payment');
      }
    } catch (error) {
      alert('Error initializing payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h2 className="text-xl font-bold mb-4">Top Up Wallet</h2>
      
      <input
        type="number"
        placeholder="Enter amount (₦)"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-full p-3 border rounded mb-4"
        min="100"
      />

      <button
        onClick={handleTopUp}
        disabled={loading}
        className="w-full bg-blue-600 text-white py-3 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Processing...' : 'Top Up Wallet'}
      </button>

      <p className="text-sm text-gray-500 mt-2">
        Minimum: ₦100 | Maximum: ₦1,000,000
      </p>
    </div>
  );
}
```

### 2. Payment Callback Page

```jsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function PaymentCallback() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('verifying');

  useEffect(() => {
    const reference = searchParams.get('reference');
    
    if (!reference) {
      setStatus('error');
      return;
    }

    verifyPayment(reference);
  }, [searchParams]);

  const verifyPayment = async (reference) => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(
        `https://api.smartunivid.xyz/api/payments/verify/${reference}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        setStatus('success');
        setTimeout(() => router.push('/wallet'), 3000);
      } else {
        setStatus('failed');
      }
    } catch (error) {
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      {status === 'verifying' && <p>Verifying payment...</p>}
      {status === 'success' && (
        <div className="text-center">
          <h1 className="text-2xl font-bold text-green-600 mb-2">
            Payment Successful!
          </h1>
          <p>Your wallet has been credited.</p>
          <p className="text-sm text-gray-500 mt-2">
            Redirecting to wallet...
          </p>
        </div>
      )}
      {status === 'failed' && (
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-2">
            Payment Failed
          </h1>
          <p>Please try again.</p>
        </div>
      )}
    </div>
  );
}
```

### 3. Service Payment Component

```jsx
export default function ServicePayment({ serviceType, amount, description }) {
  const [loading, setLoading] = useState(false);

  const handlePayment = async () => {
    setLoading(true);

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch('https://api.smartunivid.xyz/api/payments/service/pay', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          serviceType,
          amount,
          description
        })
      });

      const data = await response.json();

      if (response.ok) {
        alert(`Payment successful! New balance: ₦${data.newBalance}`);
      } else {
        alert(data.error || 'Payment failed');
      }
    } catch (error) {
      alert('Error processing payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handlePayment}
      disabled={loading}
      className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
    >
      {loading ? 'Processing...' : `Pay ₦${amount}`}
    </button>
  );
}
```

---

## Testing

### Test Mode (Development)
1. Use test API keys from Paystack
2. Use test cards:
   - **Success:** 4084084084084081
   - **Insufficient Funds:** 5060666666666666666
   - **Declined:** 5060666666666666666
   - CVV: 408
   - Expiry: Any future date
   - PIN: 0000

### Live Mode (Production)
1. Switch to live API keys
2. Real payments will be processed
3. Funds will be settled to your bank account

---

## Deployment

```bash
cd ~/smart_id_backend
git pull origin main
bun install
pm2 restart campus-id-backend
```

---

## Security Notes

1. ✅ Never expose secret keys in frontend
2. ✅ Always verify payments on backend
3. ✅ Use HTTPS in production
4. ✅ Validate all amounts server-side
5. ✅ Log all transactions
6. ✅ Implement rate limiting

---

## Next Steps

1. Sign up for Paystack
2. Get API keys
3. Update .env file
4. Deploy to production
5. Test with test cards
6. Switch to live mode when ready

---

## Support

- Paystack Docs: https://paystack.com/docs
- Paystack Support: support@paystack.com
- Test Cards: https://paystack.com/docs/payments/test-payments
