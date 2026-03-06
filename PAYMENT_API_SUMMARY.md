# Payment System - Complete API Summary

## All Available APIs

### Base URL
```
https://api.smartunivid.xyz/api/payments
```

---

## 1. Wallet APIs

### ✅ Get Wallet Balance
**GET** `/wallet`

**Description:** Get current wallet balance and details

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

### ✅ Top Up Wallet (Pay In)
**POST** `/wallet/topup`

**Description:** Add money to wallet via Paystack

**Request Body:**
```json
{
  "amount": 1000
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

**Flow:**
1. Call this endpoint
2. Redirect user to `authorizationUrl`
3. User completes payment on Paystack
4. Paystack redirects to callback URL
5. Verify payment using reference

---

### ✅ Verify Payment
**GET** `/verify/:reference`

**Description:** Verify Paystack payment and credit wallet

**Response (Success):**
```json
{
  "message": "Payment verified successfully",
  "status": "success",
  "amount": 1000,
  "reference": "TOPUP_1234567890_123456",
  "newBalance": 6000
}
```

---

## 2. Service Payment APIs

### ✅ Pay for Service (Pay Out)
**POST** `/service/pay`

**Description:** Pay for campus services using wallet balance

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
  "newBalance": 5500
}
```

---

## 3. Transaction History API

### ✅ Get Transaction List
**GET** `/history?page=1&limit=20`

**Description:** Get all wallet transactions (credits and debits)

**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 20)

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

## Summary of What You Have

### ✅ Wallet
- Get balance
- Top up (receive money via Paystack)
- View wallet details

### ✅ Pay
- Pay for services from wallet
- Multiple service types supported
- Instant deduction from balance

### ✅ Receive
- Receive money via Paystack payment
- Automatic wallet credit after verification
- Support for all Paystack payment methods

### ✅ Transaction List
- View all transactions
- Filter by page
- Shows credits (top-ups) and debits (payments)
- Balance tracking (before/after)

---

## Complete Flow Example

### Scenario: Student buys lunch

**Step 1: Check Wallet Balance**
```
GET /api/payments/wallet
Response: { "wallet": { "balance": 100 } }
```

**Step 2: Insufficient Balance - Top Up**
```
POST /api/payments/wallet/topup
Body: { "amount": 5000 }
Response: { "authorizationUrl": "https://checkout.paystack.com/..." }
```

**Step 3: User Pays on Paystack**
- User redirected to Paystack
- Completes payment with card
- Redirected back to app

**Step 4: Verify Payment**
```
GET /api/payments/verify/TOPUP_1234567890_123456
Response: { "status": "success", "newBalance": 5100 }
```

**Step 5: Pay for Lunch**
```
POST /api/payments/service/pay
Body: {
  "serviceType": "cafeteria",
  "amount": 500,
  "description": "Lunch"
}
Response: { "message": "Payment successful", "newBalance": 4600 }
```

**Step 6: View Transaction History**
```
GET /api/payments/history
Response: { "transactions": [...] }
```

---

## Authentication

All endpoints require JWT token:
```javascript
headers: {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
}
```

---

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Invalid or expired token"
}
```

### 403 Forbidden
```json
{
  "error": "Only students can have wallets"
}
```

### 400 Bad Request (Insufficient Balance)
```json
{
  "error": "Insufficient balance",
  "currentBalance": 100,
  "required": 500
}
```

### 400 Bad Request (Validation)
```json
{
  "error": "Validation error",
  "details": [
    {
      "field": "amount",
      "message": "Minimum top-up amount is ₦100"
    }
  ]
}
```

---

## What's NOT Included (Future Features)

### Transfer Between Students
Not implemented yet. Would need:
- `POST /api/payments/transfer`
- Recipient validation
- Transfer limits

### Withdrawal to Bank
Not implemented yet. Would need:
- Bank account verification
- Paystack transfer API
- Withdrawal limits

### Payment Requests
Not implemented yet. Would need:
- Request creation
- Request approval/rejection
- Notifications

---

## Testing

### Test Cards (Paystack Test Mode)
- **Success:** 4084084084084081
- **Insufficient Funds:** 5060666666666666666
- **CVV:** 408
- **Expiry:** 12/30
- **PIN:** 0000

---

## Deployment

```bash
# Update production
ssh root@64.111.93.87
cd ~/smart_id_backend
git pull origin main
pm2 restart campus-id-backend
```

---

## Next Steps

1. ✅ Deploy latest code (fixes Paystack error)
2. ✅ Test wallet top-up
3. ✅ Test service payments
4. ✅ Implement frontend
5. ⏳ Switch to live mode when ready

---

## Support

- Backend API: `https://api.smartunivid.xyz/api/payments`
- Paystack Docs: https://paystack.com/docs
- Test Cards: https://paystack.com/docs/payments/test-payments
