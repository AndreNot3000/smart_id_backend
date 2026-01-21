# 🚀 Deployment Guide - Render

## Quick Fix for Current Issue

The deployment was failing because the start script was pointing to the wrong file. This has been fixed:

**Before:** `"start": "bun src/index.ts"` ❌
**After:** `"start": "bun main.ts"` ✅

## Environment Variables to Set in Render

Go to your Render service dashboard and add these environment variables:

### Required Variables:
```
NODE_ENV=production
PORT=10000
DB_NAME=campus_id_saas
MONGODB_URL=mongodb+srv://andreolumide_db_user:mf0YB4OPjKGLA64g@cluster0.p9ufwqc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=your-super-secret-jwt-key-here-change-this-in-production
JWT_REFRESH_SECRET=your-refresh-secret-here-change-this-in-production
SUPER_ADMIN_KEY=andrenaline
```

### Email Configuration (Mailtrap):
```
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=01c43d3a511a14
SMTP_PASS=a83dcd09a51952
```

### URLs (Update with your actual domain):
```
CORS_ORIGIN=https://your-frontend-domain.com
FRONTEND_URL=https://your-frontend-domain.com
BACKEND_URL=https://your-backend-domain.onrender.com
```

## Deployment Steps:

1. **Push the fixed code** (already done ✅)
2. **Redeploy on Render** - Go to your service and click "Manual Deploy"
3. **Add environment variables** in Render dashboard
4. **Test the deployment** with a simple API call

## Test Your Deployment:

Once deployed, test with:
```bash
curl https://your-app-name.onrender.com
```

Expected response:
```json
{
  "message": "Campus ID SAAS API Server",
  "version": "1.0.0",
  "status": "healthy"
}
```

## Common Issues:

- **Build fails**: Make sure all dependencies are in package.json
- **App crashes**: Check environment variables are set correctly
- **Database connection fails**: Verify MongoDB Atlas allows connections from 0.0.0.0/0
- **CORS errors**: Update CORS_ORIGIN with your frontend domain

## Production Security:

⚠️ **Important**: Change these before going live:
- Generate new JWT secrets (64+ characters)
- Use production email service (not Mailtrap)
- Restrict MongoDB Atlas IP access
- Use HTTPS for all URLs