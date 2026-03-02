# ✅ Render Backend Deployment Checklist

## 🎯 Goal
Deploy backend to: `https://smart-id-exvb.onrender.com`

---

## 📋 Step-by-Step Deployment Guide

### **Step 1: Go to Render Dashboard**

1. Visit: https://dashboard.render.com/
2. Login with your account
3. Look for existing service named `campus-id-backend` or `smart-id-exvb`

---

### **Step 2: Create/Connect Service (If Not Exists)**

If you don't have a service yet:

1. Click **"New +"** → **"Web Service"**
2. Click **"Connect a repository"**
3. Select: `AndreNot3000/smart_id_backend`
4. Configure:
   - **Name:** `campus-id-backend`
   - **Region:** Choose closest to your users
   - **Branch:** `main`
   - **Runtime:** `Bun` (or `Node` if Bun not available)
   - **Build Command:** `bun install` (or `npm install`)
   - **Start Command:** `bun main.ts` (or `npm start`)
   - **Plan:** Free

---

### **Step 3: Set Environment Variables**

Go to your service → **Environment** tab → Add these variables:

#### **Required Environment Variables:**

```bash
# MongoDB Configuration
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

# Server Configuration - REPLACE WITH YOUR ACTUAL VERCEL URL!
PORT=10000
CORS_ORIGIN=https://YOUR-VERCEL-APP.vercel.app,http://localhost:3000
FRONTEND_URL=https://YOUR-VERCEL-APP.vercel.app
BACKEND_URL=https://smart-id-exvb.onrender.com

# Environment
NODE_ENV=production
```

#### **⚠️ CRITICAL: Update CORS_ORIGIN**

Replace `https://YOUR-VERCEL-APP.vercel.app` with your actual Vercel URL!

Example:
```bash
CORS_ORIGIN=https://campus-id-frontend.vercel.app,http://localhost:3000
```

If you have multiple Vercel URLs (production + preview):
```bash
CORS_ORIGIN=https://campus-id-frontend.vercel.app,https://campus-id-preview.vercel.app,http://localhost:3000
```

---

### **Step 4: Deploy**

1. After setting all environment variables, click **"Save Changes"**
2. Render will automatically start deploying
3. Or click **"Manual Deploy"** → **"Deploy latest commit"**
4. Wait 3-5 minutes for deployment to complete

---

### **Step 5: Monitor Deployment**

1. Go to **"Logs"** tab
2. Watch for:
   ```
   ✅ Connected to MongoDB successfully
   🚀 Server running on http://localhost:10000
   ```
3. If you see errors, check:
   - Environment variables are set correctly
   - MongoDB connection string is valid
   - No typos in configuration

---

### **Step 6: Test Backend Endpoints**

Once deployed, test these endpoints:

#### **1. Health Check**
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

#### **2. Get Institutions**
```bash
curl https://smart-id-exvb.onrender.com/api/auth/institutions
```

Expected response:
```json
{
  "institutions": [...]
}
```

#### **3. Test Login (with existing user)**
```bash
curl -X POST https://smart-id-exvb.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@university.edu",
    "password": "your_password",
    "userType": "admin"
  }'
```

#### **4. Test CORS (from Vercel domain)**
```bash
curl -I -X OPTIONS https://smart-id-exvb.onrender.com/api/auth/login \
  -H "Origin: https://YOUR-VERCEL-APP.vercel.app" \
  -H "Access-Control-Request-Method: POST"
```

Should see:
```
Access-Control-Allow-Origin: https://YOUR-VERCEL-APP.vercel.app
```

---

## 📝 Information for Frontend Team

Once deployed, provide this information to your frontend team:

### **Backend URL:**
```
https://smart-id-exvb.onrender.com
```

### **API Endpoints:**

All endpoints are prefixed with the backend URL:

#### **Authentication:**
- `POST /api/auth/login` - Login
- `POST /api/auth/admin/register` - Admin registration
- `GET /api/auth/institutions` - Get institutions
- `GET /api/auth/verify-email` - Email verification
- `POST /api/auth/forgot-password` - Password reset request
- `POST /api/auth/reset-password` - Reset password

#### **User Management:**
- `GET /api/users/profile` - Get user profile
- `PUT /api/users/profile` - Update profile
- `POST /api/users/change-password` - Change password
- `POST /api/users/logout` - Logout

#### **Admin:**
- `POST /api/admin/students` - Create student
- `GET /api/admin/students` - Get all students
- `POST /api/admin/lecturers` - Create lecturer
- `GET /api/admin/lecturers` - Get all lecturers

#### **QR Code:**
- `GET /api/qr/generate` - Generate QR code
- `POST /api/qr/verify` - Verify QR code (get info)
- `POST /api/qr/scan-attendance` - Scan for attendance
- `GET /api/qr/attendance/my-history` - Get my attendance

#### **Super Admin:**
- `POST /api/superadmin/institutions` - Create institution

### **CORS Configuration:**
✅ Backend is configured to accept requests from:
- Your Vercel production URL
- Vercel preview deployments
- localhost:3000 (for local development)

### **Authentication:**
All protected endpoints require:
```
Authorization: Bearer <jwt_token>
```

### **HTTPS:**
✅ All endpoints use HTTPS automatically

---

## 🐛 Troubleshooting

### **Issue 1: Service Won't Start**

**Check Logs for:**
- MongoDB connection errors → Verify MONGODB_URL
- Port binding errors → Render uses PORT env var automatically
- Missing dependencies → Check package.json

**Solution:**
- Go to Logs tab
- Look for error messages
- Fix environment variables
- Redeploy

### **Issue 2: CORS Errors**

**Error:**
```
Access to fetch at 'https://smart-id-exvb.onrender.com/api/auth/login' 
from origin 'https://your-app.vercel.app' has been blocked by CORS policy
```

**Solution:**
1. Check `CORS_ORIGIN` environment variable on Render
2. Make sure it includes your Vercel URL exactly
3. No trailing slashes
4. Redeploy after changing

### **Issue 3: 503 Service Unavailable**

**Cause:** Render free tier spins down after 15 minutes of inactivity

**Solution:**
- First request after inactivity takes 30-60 seconds to wake up
- This is normal for free tier
- Upgrade to paid plan for always-on service
- Or use a service like UptimeRobot to ping every 14 minutes

### **Issue 4: Environment Variables Not Applied**

**Solution:**
- After changing environment variables, you MUST redeploy
- Go to service → Click "Manual Deploy" → "Deploy latest commit"
- Wait for deployment to complete

### **Issue 5: Database Connection Failed**

**Check:**
- MongoDB Atlas allows connections from anywhere (0.0.0.0/0)
- Or add Render's IP addresses to whitelist
- MONGODB_URL is correct and includes credentials

---

## 🔒 Security Checklist

Before going live:

- [ ] Change JWT_SECRET to a strong random value
- [ ] Change JWT_REFRESH_SECRET to a strong random value
- [ ] Change SUPER_ADMIN_KEY to something secure
- [ ] Verify CORS_ORIGIN only includes your domains
- [ ] Enable MongoDB Atlas IP whitelist (optional)
- [ ] Set up Mailtrap Email API for production emails
- [ ] Review all environment variables

---

## 📊 Monitoring

### **Check Service Health:**
- Render Dashboard → Your Service → Metrics
- Monitor CPU, Memory, Request count
- Check error rates

### **View Logs:**
- Render Dashboard → Your Service → Logs
- Real-time log streaming
- Filter by error level

### **Set Up Alerts:**
- Render Dashboard → Your Service → Settings → Notifications
- Get notified of deployment failures
- Monitor service health

---

## 🎉 Success Criteria

Your backend is successfully deployed when:

✅ Health check returns 200 OK
✅ Can login from Vercel frontend
✅ No CORS errors in browser console
✅ QR code generation works
✅ Email verification links work
✅ All API endpoints respond correctly

---

## 📞 Next Steps

After successful deployment:

1. **Test all endpoints** from Postman/Thunder Client
2. **Share backend URL** with frontend team
3. **Test login** from Vercel frontend
4. **Monitor logs** for any errors
5. **Set up monitoring** (optional)

---

## 🆘 Need Help?

If you encounter issues:

1. Check Render logs first
2. Verify all environment variables
3. Test endpoints with curl
4. Check MongoDB Atlas connection
5. Review CORS configuration

Common issues are usually:
- Missing/incorrect environment variables
- CORS misconfiguration
- MongoDB connection issues
- Service not deployed/running
