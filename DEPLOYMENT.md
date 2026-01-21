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

### ⚠️ **Important: Render Free Tier Behavior**
- Free instances "sleep" after 15 minutes of inactivity
- First request after sleep takes 50+ seconds to wake up
- You may get 502 errors during wake-up - this is normal!

### Testing Steps:
1. **Wake up the server** (may take 50+ seconds):
```bash
curl https://smart-id-exvb.onrender.com
```

2. **Wait 1-2 minutes if you get 502 errors**

3. **Test again** - should work now:
```bash
curl https://smart-id-exvb.onrender.com
```

Expected response:
```json
{
  "message": "Campus ID SAAS API Server",
  "version": "1.0.0",
  "status": "healthy"
}
```

### Keep Service Warm (Optional):
Use services like UptimeRobot or cron-job.org to ping your service every 10-14 minutes to prevent cold starts.

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