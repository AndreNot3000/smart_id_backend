# Payment System - Frontend Implementation Prompt

## Overview
Implement student wallet system for campus services (cafeteria, library fines, hostel, transport) using Paystack.

---

## Required Pages/Components

### 1. Wallet Dashboard Page
**Route:** `/wallet` or `/dashboard/wallet`

**Features:**
- Display current wallet balance
- Top-up button
- Recent transactions list
- Quick service payment buttons

**API Calls:**
- `GET /api/payments/wallet` - Get balance
- `GET /api/payments/history` - Get transactions

---

### 2. Wallet Top-Up Flow

**Step 1: Top-Up Form**
- Input field for amount (₦100 - ₦1,000,000)
- Validation for min/max amounts
- "Top Up" button

**Step 2: Initialize Payment**
- Call `POST /api/payments/wallet/topup`
- Get `authorizationUrl` from response
- Redirect user to Paystack payment page

**Step 3: Payment Callback**
- Create callback page at `/payment/callback`
- Get `reference` from URL query params
- Call `GET /api/payments/verify/:reference`
- Show success/failure message
- Redirect to wallet page

---

### 3. Service Payment Components

**Cafeteria Payment:**
- Menu items with prices
- "Pay from Wallet" button
- Calls `POST /api/payments/service/pay`

**Library Fine Payment:**
- Display fine amount
- "Pay Fine" button
- Deducts from wallet

**Other Services:**
- Hostel fees
- Transport fees
- Custom services

---

## API Integration

### Base URL
```javascript
const API_BASE_URL = 'https://api.smartunivid.xyz/api/payments';
```

### Authentication
```javascript
const token = localStorage.getItem('accessToken');
const headers = {
  'Authorization': `Bearer ${token}`,
  'Content-Type': 'application/json'
};
```

---

## Code Examples

### 1. Wallet Dashboard Component

```jsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function WalletDashboard() {
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchWalletData();
  }, []);

  const fetchWalletData = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      };

      // Fetch wallet balance
      const walletRes = await fetch('https://api.smartunivid.xyz/api/payments/wallet', { headers });
      const walletData = await walletRes.json();

      // Fetch transaction history
      const historyRes = await fetch('https://api.smartunivid.xyz/api/payments/history?page=1&limit=10', { headers });
      const historyData = await historyRes.json();

      setWallet(walletData.wallet);
      setTransactions(historyData.transactions);
    } catch (error) {
      console.error('Error fetching wallet data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* Balance Card */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-xl p-6 text-white mb-6">
        <p className="text-sm opacity-80">Wallet Balance</p>
        <h1 className="text-4xl font-bold mt-2">₦{wallet?.balance.toLocaleString()}</h1>
        <button
          onClick={() => router.push('/wallet/topup')}
          className="mt-4 bg-white text-blue-600 px-6 py-2 rounded-lg font-medium hover:bg-gray-100"
        >
          Top Up Wallet
        </button>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <ServiceButton icon="🍔" label="Cafeteria" onClick={() => router.push('/services/cafeteria')} />
        <ServiceButton icon="📚" label="Library" onClick={() => router.push('/services/library')} />
        <ServiceButton icon="🏠" label="Hostel" onClick={() => router.push('/services/hostel')} />
        <ServiceButton icon="🚌" label="Transport" onClick={() => router.push('/services/transport')} />
      </div>

      {/* Transaction History */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-bold mb-4">Recent Transactions</h2>
        {transactions.length === 0 ? (
          <p className="text-gray-500">No transactions yet</p>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => (
              <TransactionItem key={tx.id} transaction={tx} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ServiceButton({ icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-lg shadow p-4 hover:shadow-lg transition-shadow text-center"
    >
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-sm font-medium">{label}</div>
    </button>
  );
}

function TransactionItem({ transaction }) {
  const isCredit = transaction.transactionType === 'credit';
  
  return (
    <div className="flex items-center justify-between p-3 border rounded-lg">
      <div className="flex items-center space-x-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
          isCredit ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
        }`}>
          {isCredit ? '↓' : '↑'}
        </div>
        <div>
          <p className="font-medium">{transaction.type.replace('_', ' ')}</p>
          <p className="text-sm text-gray-500">{transaction.description || transaction.reference}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`font-bold ${isCredit ? 'text-green-600' : 'text-red-600'}`}>
          {isCredit ? '+' : '-'}₦{transaction.amount.toLocaleString()}
        </p>
        <p className="text-xs text-gray-500">
          {new Date(transaction.createdAt).toLocaleDateString()}
        </p>
      </div>
    </div>
  );
}
```

---

### 2. Wallet Top-Up Page

```jsx
'use client';

import { useState } from 'react';

export default function WalletTopUp() {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleTopUp = async () => {
    const amountNum = parseFloat(amount);

    // Validation
    if (!amount || isNaN(amountNum)) {
      setError('Please enter a valid amount');
      return;
    }

    if (amountNum < 100) {
      setError('Minimum top-up is ₦100');
      return;
    }

    if (amountNum > 1000000) {
      setError('Maximum top-up is ₦1,000,000');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch('https://api.smartunivid.xyz/api/payments/wallet/topup', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ amount: amountNum })
      });

      const data = await response.json();

      if (response.ok) {
        // Redirect to Paystack
        window.location.href = data.authorizationUrl;
      } else {
        setError(data.error || 'Failed to initialize payment');
      }
    } catch (err) {
      setError('Error initializing payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto p-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold mb-6">Top Up Wallet</h1>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Amount (₦)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter amount"
            className="w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500"
            min="100"
            max="1000000"
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleTopUp}
          disabled={loading}
          className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Processing...' : 'Continue to Payment'}
        </button>

        <p className="text-sm text-gray-500 mt-4 text-center">
          Min: ₦100 | Max: ₦1,000,000
        </p>
      </div>
    </div>
  );
}
```

---

### 3. Payment Callback Page

```jsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

export default function PaymentCallback() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState('verifying');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const reference = searchParams.get('reference');
    
    if (!reference) {
      setStatus('error');
      setMessage('No payment reference found');
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
        setMessage(`₦${data.amount.toLocaleString()} added to your wallet`);
        setTimeout(() => router.push('/wallet'), 3000);
      } else {
        setStatus('failed');
        setMessage(data.message || 'Payment verification failed');
      }
    } catch (error) {
      setStatus('error');
      setMessage('Error verifying payment');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
        {status === 'verifying' && (
          <>
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <h2 className="text-xl font-bold mb-2">Verifying Payment</h2>
            <p className="text-gray-600">Please wait...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-2xl font-bold text-green-600 mb-2">Payment Successful!</h2>
            <p className="text-gray-600 mb-4">{message}</p>
            <p className="text-sm text-gray-500">Redirecting to wallet...</p>
          </>
        )}

        {status === 'failed' && (
          <>
            <div className="text-6xl mb-4">❌</div>
            <h2 className="text-2xl font-bold text-red-600 mb-2">Payment Failed</h2>
            <p className="text-gray-600 mb-4">{message}</p>
            <button
              onClick={() => router.push('/wallet')}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
            >
              Back to Wallet
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="text-6xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold text-orange-600 mb-2">Error</h2>
            <p className="text-gray-600 mb-4">{message}</p>
            <button
              onClick={() => router.push('/wallet')}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
            >
              Back to Wallet
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

---

### 4. Service Payment Component

```jsx
export default function ServicePayment({ serviceType, amount, description, onSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePayment = async () => {
    setLoading(true);
    setError('');

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
        onSuccess?.(data);
        alert(`Payment successful! New balance: ₦${data.newBalance.toLocaleString()}`);
      } else {
        setError(data.error || 'Payment failed');
      }
    } catch (err) {
      setError('Error processing payment');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handlePayment}
        disabled={loading}
        className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:opacity-50"
      >
        {loading ? 'Processing...' : `Pay ₦${amount.toLocaleString()}`}
      </button>
      {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
    </div>
  );
}
```

---

## Testing

### Test Cards (Paystack Test Mode)
- **Success:** 4084084084084081
- **Insufficient Funds:** 5060666666666666666
- **CVV:** 408
- **Expiry:** Any future date (e.g., 12/30)
- **PIN:** 0000

---

## Implementation Checklist

- [ ] Create wallet dashboard page
- [ ] Create wallet top-up page
- [ ] Create payment callback page
- [ ] Add service payment components
- [ ] Test wallet top-up flow
- [ ] Test service payments
- [ ] Add transaction history
- [ ] Add loading states
- [ ] Add error handling
- [ ] Test with Paystack test cards

---

## API Documentation
See `PAYMENT_SYSTEM_GUIDE.md` for complete API reference.
