# 🚀 Campus ID SAAS - Setup Guide

## 📋 Prerequisites

- **Node.js** (v18 or higher)
- **MongoDB Atlas** account
- **Mailtrap** account (for email testing)
- **Git**

---

## ⚡ Quick Setup

### 1. **Clone & Install**
```bash
git clone <your-repo-url>
cd campus-id-backend
npm install
```

### 2. **Environment Configuration**
Create `.env` file:
```env
# MongoDB Configuration (MongoDB Atlas)
MONGODB_URL=mongodb+srv://username:password@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
DB_NAME=campus_id_saas

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here-change-this-in-production
JWT_REFRESH_SECRET=your-refresh-secret-here-change-this-in-production

# Super Admin Configuration
SUPER_ADMIN_KEY=andrenaline

# Email Configuration (Mailtrap)
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your-mailtrap-username
SMTP_PASS=your-mailtrap-password

# Server Configuration
PORT=8000
CORS_ORIGIN=http://localhost:3000
FRONTEND_URL=http://localhost:3000
BACKEND_URL=http://localhost:8000

# Environment
NODE_ENV=development
```

### 3. **Start Server**
```bash
npm run dev
# or
bun run dev
# or
node main.ts
```

**Expected Output:**
```
✅ Database connected successfully
✅ Database indexes created
🚀 Server running on http://localhost:8000
```

---

## 🗄️ MongoDB Atlas Setup

### 1. **Create Account**
1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Sign up for free account
3. Create new project

### 2. **Create Cluster**
1. Click "Build a Database"
2. Choose **FREE** tier (M0 Sandbox)
3. Select region closest to you
4. Name your cluster (e.g., "Cluster0")

### 3. **Configure Access**
1. **Database Access:**
   - Create database user
   - Username: `your_username`
   - Password: `your_password`
   - Database User Privileges: **Read and write to any database**

2. **Network Access:**
   - Add IP Address: `0.0.0.0/0` (Allow access from anywhere)
   - Or add your specific IP for security

### 4. **Get Connection String**
1. Click "Connect" on your cluster
2. Choose "Connect your application"
3. Copy connection string
4. Replace `<password>` with your actual password
5. Add to `.env` as `MONGODB_URL`

---

## 📧 Mailtrap Setup

### 1. **Create Account**
1. Go to [Mailtrap.io](https://mailtrap.io/)
2. Sign up for free account
3. Verify your email

### 2. **Get SMTP Credentials**
1. Go to **Email Testing → Inboxes**
2. Click on your inbox (or create new one)
3. Click **SMTP Settings**
4. Select **Nodemailer** from integrations

### 3. **Copy Credentials**
You'll see something like:
```javascript
{
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: "1a2b3c4d5e6f7g",
    pass: "9h8i7j6k5l4m3n"
  }
}
```

### 4. **Update .env**
```env
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=1a2b3c4d5e6f7g
SMTP_PASS=9h8i7j6k5l4m3n
```

---

## 🧪 Testing Setup

### 1. **Test Server**
```bash
curl http://localhost:8000
```
**Expected Response:**
```json
{
  "message": "Campus ID SAAS API Server",
  "version": "1.0.0",
  "status": "healthy"
}
```

### 2. **Test Database Connection**
Check server logs for:
```
✅ Database connected successfully
✅ Database indexes created
```

### 3. **Test Email (Optional)**
```bash
node -e "
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.log('❌ Email connection failed:', error);
  } else {
    console.log('✅ Email server ready');
  }
});
"
```

---

## 🔧 Development Scripts

```bash
# Start development server
npm run dev

# Start production server
npm start

# Build TypeScript
npm run build

# Run tests
npm test
```

---

## 📁 Project Structure

```
campus-id-backend/
├── src/
│   ├── database/
│   │   └── connection.ts          # MongoDB connection
│   ├── middleware/
│   │   ├── auth.middleware.ts     # JWT authentication
│   │   └── validation.middleware.ts
│   ├── models/
│   │   ├── user.model.ts          # User types & interfaces
│   │   └── institution.model.ts   # Institution model
│   ├── routes/
│   │   ├── auth.routes.ts         # Authentication endpoints
│   │   ├── admin.routes.ts        # Admin management
│   │   ├── user.routes.ts         # User management
│   │   └── superadmin.routes.ts   # Super admin endpoints
│   ├── services/
│   │   ├── auth.services.ts       # Authentication logic
│   │   └── email.services.ts      # Email sending
│   └── utils/
├── .env                           # Environment variables
├── main.ts                        # Server entry point
├── package.json                   # Dependencies
└── tsconfig.json                  # TypeScript config
```

---

## 🔒 Security Configuration

### 1. **JWT Secrets**
Generate strong secrets:
```bash
# Generate random JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 2. **Super Admin Key**
Change default super admin key in `.env`:
```env
SUPER_ADMIN_KEY=your-secure-super-admin-key-here
```

### 3. **CORS Configuration**
Update allowed origins in `.env`:
```env
CORS_ORIGIN=http://localhost:3000,https://yourdomain.com
```

---

## 🚨 Troubleshooting

### **Server Won't Start**
1. Check if port 8000 is available
2. Verify MongoDB connection string
3. Ensure all environment variables are set

### **Database Connection Failed**
1. Check MongoDB Atlas network access
2. Verify database user credentials
3. Ensure connection string is correct

### **Email Not Sending**
1. Verify Mailtrap credentials
2. Check SMTP settings in `.env`
3. Test connection with verification script

### **Route Not Found**
1. Restart server after code changes
2. Check if routes are properly imported in `main.ts`
3. Verify endpoint URLs match documentation

---

## 🌐 Production Deployment

### 1. **Environment Variables**
Update for production:
```env
NODE_ENV=production
JWT_SECRET=production-jwt-secret-64-chars-long
CORS_ORIGIN=https://yourdomain.com
FRONTEND_URL=https://yourdomain.com
BACKEND_URL=https://api.yourdomain.com
```

### 2. **Database Security**
1. Use specific IP whitelist instead of `0.0.0.0/0`
2. Create production database user with limited permissions
3. Enable MongoDB Atlas backup

### 3. **Email Service**
Switch from Mailtrap to production email service:
- SendGrid
- AWS SES
- Mailgun
- Postmark

---

## ✅ Setup Complete!

Your Campus ID SAAS backend is now ready for development! 🎉

**Next Steps:**
1. Create your first institution (Super Admin)
2. Register admin accounts
3. Start creating student/lecturer accounts
4. Build your frontend application

**Need Help?** Check the API_REFERENCE.md for complete endpoint documentation.