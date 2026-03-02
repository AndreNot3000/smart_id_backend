# 🚀 Production Deployment Guide

## Issue: Can't Login on Vercel but Works Locally

### **Root Cause**
Your local `.env` file has `CORS_ORIGIN=http://localhost:3000`, which blocks requests from your Vercel frontend. The production backend needs to allow your Vercel URL.

---

## ✅ Solution: Configure Render Environment Variables

### **Step 1: Get Your Vercel Frontend URL**

Your Vercel frontend URL is probably something like:
- `https://your-app-name.vercel.app`
- Or a custom domain you configured

### **Step 2: Configure Render Environment Variables**

Go to your Render dashboard and set these environment variables for your backend service:

#### **Required Environment Variables for Production:**

```bash
# MongoDB Configuration (MongoDB Atlas)
MONGODB_URL=mongodb+srv://andreolumide_db_user:Hackless12345@cluster0.p9ufwqc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
DB_NAME=campus_id_saas

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here-change-this-in-production
JWT_REFRESH_SECRET=your-refresh-secret-here-change-this-in-production

# Super Admin Configuration
SUPER_ADMIN_KEY=andrenaline

# Email Configuration (Mailtrap Sandbox)
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=01c43d3a511a14
SMTP_PASS=a83dcd09a51952

# Server Configuration - IMPORTANT: Update these!
PORT=8000
CORS_ORIGIN=https://your-vercel-app.vercel.app
FRONTEND_URL=https://your-vercel-app.vercel.app
BACKEND_URL=https://smart-id-exvb.onrender.com

# Environment
NODE_ENV=production
```

### **Step 3: Update CORS_ORIGIN**

**CRITICAL:** Replace `https://your-vercel-app.vercel.app` with your actual Vercel URL!

If you have multiple frontend URLs (e.g., preview deployments), you can use comma-separated values:
```bash
CORS_ORIGIN=https://your-app.vercel.app,https://your-app-preview.vercel.app
```

---

## 🔧 How to Set Environment Variables on Render

### **Method 1: Render Dashboard (Recommended)**

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Select your backend service (`smart-id-exvb`)
3. Click **"Environment"** in the left sidebar
4. Click **"Add Environment Variable"**
5. Add each variable one by one:
   - Key: `CORS_ORIGIN`
   - Value: `https://your-vercel-app.vercel.app`
6. Click **"Save Changes"**
7. Render will automatically redeploy your service

### **Method 2: Using render.yaml (Alternative)**

Update your `render.yaml` file:

```yaml
services:
  - type: web
    name: smart-id-backend
    env: node
    buildCommand: npm install
    startCommand: npm start
    envVars:
      - key: MONGODB_URL
        sync: false
      - key: DB_NAME
        value: campus_id_saas
      - key: JWT_SECRET
        sync: false
      - key: JWT_REFRESH_SECRET
        sync: false
      - key: SUPER_ADMIN_KEY
        sync: false
      - key: SMTP_HOST
        value: sandbox.smtp.mailtrap.io
      - key: SMTP_PORT
        value: 2525
      - key: SMTP_USER
        sync: false
      - key: SMTP_PASS
        sync: false
      - key: PORT
        value: 8000
      - key: CORS_ORIGIN
        value: https://your-vercel-app.vercel.app
      - key: FRONTEND_URL
        value: https://your-vercel-app.vercel.app
      - key: BACKEND_URL
        value: https://smart-id-exvb.onrender.com
      - key: NODE_ENV
        value: production
```

---

## 🔍 Verify CORS Configuration

After updating environment variables, test the CORS configuration:

### **Test 1: Check CORS Headers**

```bash
curl -I -X OPTIONS https://smart-id-exvb.onrender.com/api/auth/login \
  -H "Origin: https://your-vercel-app.vercel.app" \
  -H "Access-Control-Request-Method: POST"
```

You should see:
```
Access-Control-Allow-Origin: https://your-vercel-app.vercel.app
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
```

### **Test 2: Try Login from Frontend**

1. Open your Vercel frontend
2. Try to login
3. Check browser console for CORS errors
4. If you see CORS errors, the `CORS_ORIGIN` is not set correctly

---

## 🐛 Common Issues & Solutions

### **Issue 1: CORS Error - "Access-Control-Allow-Origin"**

**Error:**
```
Access to fetch at 'https://smart-id-exvb.onrender.com/api/auth/login' 
from origin 'https://your-app.vercel.app' has been blocked by CORS policy
```

**Solution:**
- Verify `CORS_ORIGIN` on Render matches your Vercel URL exactly
- Make sure there are no trailing slashes
- Check for typos in the URL

### **Issue 2: Environment Variables Not Applied**

**Solution:**
- After changing environment variables on Render, you must **manually redeploy**
- Go to Render dashboard → Your service → Click "Manual Deploy" → "Deploy latest commit"

### **Issue 3: Multiple Frontend URLs**

If you have:
- Production: `https://campus-id.vercel.app`
- Preview: `https://campus-id-preview.vercel.app`
- Custom domain: `https://campus-id.com`

**Solution:**
Update CORS middleware in `main.ts` to accept multiple origins:

```typescript
app.use('*', cors({
  origin: (origin, callback) => {
    const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  allowHeaders: ['Content-Type', 'Authorization', 'X-Super-Admin-Key'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
}));
```

Then set on Render:
```bash
CORS_ORIGIN=https://campus-id.vercel.app,https://campus-id-preview.vercel.app,https://campus-id.com
```

### **Issue 4: Email Verification Links Point to Localhost**

**Problem:** Magic links in emails point to `http://localhost:8000`

**Solution:**
- Ensure `BACKEND_URL=https://smart-id-exvb.onrender.com` on Render
- Redeploy the service

---

## 📋 Checklist for Production Deployment

- [ ] Set `CORS_ORIGIN` to your Vercel URL on Render
- [ ] Set `FRONTEND_URL` to your Vercel URL on Render
- [ ] Set `BACKEND_URL` to your Render URL on Render
- [ ] Set `NODE_ENV=production` on Render
- [ ] Verify all other environment variables are set
- [ ] Manually redeploy on Render after changing env vars
- [ ] Test login from Vercel frontend
- [ ] Check browser console for errors
- [ ] Test email verification links
- [ ] Test QR code generation and scanning

---

## 🔐 Security Recommendations

### **1. Generate Strong JWT Secrets**

Don't use the default secrets in production! Generate strong random secrets:

```bash
# On your local machine, run:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Copy the output and use it for `JWT_SECRET` and `JWT_REFRESH_SECRET` on Render.

### **2. Use Mailtrap Email API for Production**

For production emails, use Mailtrap Email API instead of Sandbox:

```bash
MAILTRAP_API_TOKEN=your_production_api_token
```

Remove or comment out:
```bash
# SMTP_HOST=sandbox.smtp.mailtrap.io
# SMTP_PORT=2525
# SMTP_USER=...
# SMTP_PASS=...
```

### **3. Secure Super Admin Key**

Change the super admin key to something more secure:

```bash
SUPER_ADMIN_KEY=your_very_secure_random_key_here
```

---

## 🧪 Testing Production Setup

### **1. Test Health Check**

```bash
curl https://smart-id-exvb.onrender.com/
```

Expected response:
```json
{
  "message": "Campus ID SAAS API Server",
  "version": "1.0.0",
  "status": "healthy",
  "timestamp": "2026-03-02T..."
}
```

### **2. Test Login Endpoint**

```bash
curl -X POST https://smart-id-exvb.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: https://your-vercel-app.vercel.app" \
  -d '{
    "email": "admin@university.edu",
    "password": "password123",
    "userType": "admin"
  }'
```

### **3. Test from Frontend**

Open your Vercel app and try to login. Check:
- Network tab in browser DevTools
- Console for any errors
- Response status codes

---

## 📞 Need Help?

If you're still having issues:

1. **Check Render Logs:**
   - Go to Render dashboard
   - Click on your service
   - Click "Logs" tab
   - Look for errors

2. **Check Browser Console:**
   - Open DevTools (F12)
   - Go to Console tab
   - Look for CORS or network errors

3. **Verify Environment Variables:**
   - Go to Render dashboard
   - Click "Environment"
   - Verify all variables are set correctly

---

## 🎯 Quick Fix Summary

**The main issue is CORS configuration. Here's the quick fix:**

1. Go to Render dashboard
2. Find your backend service
3. Go to Environment tab
4. Update these variables:
   ```
   CORS_ORIGIN=https://your-actual-vercel-url.vercel.app
   FRONTEND_URL=https://your-actual-vercel-url.vercel.app
   BACKEND_URL=https://smart-id-exvb.onrender.com
   ```
5. Click "Save Changes"
6. Wait for automatic redeploy
7. Test login from Vercel frontend

That should fix the login issue! 🎉
