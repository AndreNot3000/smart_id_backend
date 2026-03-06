# Payment System Troubleshooting Guide

## Common 400 Bad Request Errors

### 1. Check if Production Server Has Latest Code

```bash
# SSH into VPS
ssh root@64.111.93.87

# Check current commit
cd ~/smart_id_backend
git log --oneline -1

# Should show: "feat: Add Paystack payment system..."
# If not, pull latest:
git pull origin main
bun install
pm2 restart campus-id-backend
```

### 2. Check PM2 Logs for Errors

```bash
# View logs
pm2 logs campus-id-backend --lines 50

# Look for errors like:
# - "Cannot find module"
# - "PAYSTACK_SECRET_KEY is not defined"
# - Any other errors
```

### 3. Verify Environment Variables

```bash
# Check .env file
cat .env | grep PAYSTACK

# Should show:
# PAYSTACK_SECRET_KEY=sk_test_de4d79458f68a6e0f237d437dc88863355f0b6b8
# PAYSTACK_PUBLIC_KEY=pk_test_fc6d4b166199ffc1db1b444ea36d82d0a4da3ac0
```

---

## Testing Each Endpoint

### Test 1: Health Check (No Auth)

```bash
curl https://api.smartunivid.xyz/
```

**Expected:** 200 OK with server info

---

### Test 2: Get Wallet (Requires Auth)

**Using curl:**
```bash
curl -X GET https://api.smartunivid.xyz/api/payments/wallet \
  -H "Authorization: Bearer YOUR_STUDENT_TOKEN" \
  -H "Content-Type: application/json"
```

**Using Postman:**
1. Method: GET
2. URL: `https://api.smartunivid.xyz/api/payments/wallet`
3. Headers:
   - `Authorization: Bearer YOUR_STUDENT_TOKEN`
   - `Content-Type: application/json`

**Expected Response (200):**
```json
{
  "wallet": {
    "id": "...",
    "balance": 0,
    "currency": "NGN",
    "isActive": true
  }
}
```

**Possible Errors:**

**401 Unauthorized:**
```json
{
  "error": "Invalid or expired token"
}
```
**Solution:** Login first to get a valid token

**403 Forbidden:**
```json
{
  "error": "Only students can have wallets"
}
```
**Solution:** Use a student account, not admin/lecturer

---

### Test 3: Initialize Top-Up

**Using curl:**
```bash
curl -X POST https://api.smartunivid.xyz/api/payments/wallet/topup \
  -H "Authorization: Bearer YOUR_STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount": 1000}'
```

**Using Postman:**
1. Method: POST
2. URL: `https://api.smartunivid.xyz/api/payments/wallet/topup`
3. Headers:
   - `Authorization: Bearer YOUR_STUDENT_TOKEN`
   - `Content-Type: application/json`
4. Body (raw JSON):
```json
{
  "amount": 1000
}
```

**Expected Response (200):**
```json
{
  "message": "Payment initialized successfully",
  "reference": "TOPUP_1234567890_123456",
  "authorizationUrl": "https://checkout.paystack.com/...",
  "accessCode": "..."
}
```

**Possible Errors:**

**400 Bad Request (Validation):**
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
**Solution:** Check amount is between ₦100 and ₦1,000,000

**400 Bad Request (Paystack):**
```json
{
  "error": "Failed to initialize payment"
}
```
**Solution:** Check Paystack API keys in .env

---

### Test 4: Service Payment

**Using curl:**
```bash
curl -X POST https://api.smartunivid.xyz/api/payments/service/pay \
  -H "Authorization: Bearer YOUR_STUDENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "serviceType": "cafeteria",
    "amount": 500,
    "description": "Lunch"
  }'
```

**Using Postman:**
1. Method: POST
2. URL: `https://api.smartunivid.xyz/api/payments/service/pay`
3. Headers:
   - `Authorization: Bearer YOUR_STUDENT_TOKEN`
   - `Content-Type: application/json`
4. Body (raw JSON):
```json
{
  "serviceType": "cafeteria",
  "amount": 500,
  "description": "Lunch"
}
```

**Expected Response (200):**
```json
{
  "message": "Payment successful",
  "reference": "CAFETERIA_1234567890_123456",
  "amount": 500,
  "serviceType": "cafeteria",
  "newBalance": 500
}
```

**Possible Errors:**

**400 Bad Request (Insufficient Balance):**
```json
{
  "error": "Insufficient balance",
  "currentBalance": 0,
  "required": 500
}
```
**Solution:** Top up wallet first

**400 Bad Request (Invalid Service Type):**
```json
{
  "error": "Validation error",
  "details": [...]
}
```
**Solution:** Use valid service type: cafeteria, library_fine, hostel, transport, other

---

## Common Issues & Solutions

### Issue 1: "Cannot find module 'paystack-node'"

**Cause:** Dependencies not installed on server

**Solution:**
```bash
cd ~/smart_id_backend
bun install
pm2 restart campus-id-backend
```

---

### Issue 2: "PAYSTACK_SECRET_KEY is not defined"

**Cause:** Environment variables not set

**Solution:**
```bash
nano .env
# Add:
PAYSTACK_SECRET_KEY=sk_test_de4d79458f68a6e0f237d437dc88863355f0b6b8
PAYSTACK_PUBLIC_KEY=pk_test_fc6d4b166199ffc1db1b444ea36d82d0a4da3ac0

# Save and restart
pm2 restart campus-id-backend
```

---

### Issue 3: "Invalid or expired token"

**Cause:** Not logged in or token expired

**Solution:**
1. Login first:
```bash
curl -X POST https://api.smartunivid.xyz/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student@example.com",
    "password": "your-password"
  }'
```

2. Copy the `accessToken` from response
3. Use it in subsequent requests

---

### Issue 4: "Only students can have wallets"

**Cause:** Trying to access wallet with admin/lecturer account

**Solution:** Login with a student account

---

### Issue 5: Routes not found (404)

**Cause:** Payment routes not registered in main.ts

**Solution:**
```bash
# Check if payment routes are imported
cat main.ts | grep payment

# Should show:
# import paymentRoutes from './src/routes/payment.routes.js';
# app.route('/api/payments', paymentRoutes);

# If not, pull latest code:
git pull origin main
pm2 restart campus-id-backend
```

---

## Debugging Steps

### Step 1: Check Server Status
```bash
pm2 status
# Should show "online"
```

### Step 2: Check Server Logs
```bash
pm2 logs campus-id-backend --lines 100
# Look for errors
```

### Step 3: Test Health Endpoint
```bash
curl https://api.smartunivid.xyz/
# Should return 200 OK
```

### Step 4: Test Auth Endpoint
```bash
curl -X POST https://api.smartunivid.xyz/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
# Should return token or error
```

### Step 5: Test Payment Endpoint
```bash
curl https://api.smartunivid.xyz/api/payments/wallet \
  -H "Authorization: Bearer YOUR_TOKEN"
# Should return wallet or auth error
```

---

## Quick Fix Checklist

- [ ] Latest code deployed (`git pull origin main`)
- [ ] Dependencies installed (`bun install`)
- [ ] Environment variables set (check `.env`)
- [ ] Server restarted (`pm2 restart campus-id-backend`)
- [ ] No errors in logs (`pm2 logs`)
- [ ] Using valid student token
- [ ] Request body format is correct (JSON)
- [ ] Content-Type header is set

---

## Get Help

If still having issues, provide:
1. Exact endpoint you're testing
2. Request body (if POST)
3. Full error response
4. Server logs (`pm2 logs campus-id-backend --lines 50`)
