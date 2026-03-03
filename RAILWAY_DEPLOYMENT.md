# 🚂 Deploy to Railway (Better Alternative to Render)

Railway offers a better free tier than Render with $5 free credit per month and more stable uptime.

---

## 🎯 Why Railway?

✅ $5 free credit per month (enough for small projects)
✅ No automatic spin-down (stays awake)
✅ Faster cold starts
✅ Better performance
✅ Automatic HTTPS
✅ Easy GitHub integration

---

## 📋 Step-by-Step Deployment

### **Step 1: Sign Up for Railway**

1. Go to https://railway.app/
2. Click "Login" → "Login with GitHub"
3. Authorize Railway to access your GitHub

### **Step 2: Create New Project**

1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. Choose `AndreNot3000/smart_id_backend`
4. Railway will automatically detect your project

### **Step 3: Configure Environment Variables**

Click on your service → Variables tab → Add these:

```bash
# MongoDB Configuration
MONGODB_URL=mongodb+srv://andreolumide_db_user:Hackless12345@cluster0.p9ufwqc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
DB_NAME=campus_id_saas

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here-change-this-in-production
JWT_REFRESH_SECRET=your-refresh-secret-here-change-this-in-production

# Super Admin Configuration
SUPER_ADMIN_KEY=andrenaline

# Email Configuration (Mailtrap)
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=01c43d3a511a14
SMTP_PASS=a83dcd09a51952

# Server Configuration - UPDATE WITH YOUR VERCEL URL!
PORT=8000
CORS_ORIGIN=https://YOUR-VERCEL-APP.vercel.app,http://localhost:3000
FRONTEND_URL=https://YOUR-VERCEL-APP.vercel.app
BACKEND_URL=${{RAILWAY_PUBLIC_DOMAIN}}

# Environment
NODE_ENV=production
```

**Note:** Railway automatically provides `RAILWAY_PUBLIC_DOMAIN` variable with your deployment URL.

### **Step 4: Configure Build Settings**

Railway should auto-detect Bun. If not:

1. Click Settings tab
2. Set:
   - **Build Command:** `bun install`
   - **Start Command:** `bun main.ts`
   - **Runtime:** Bun (or Node if Bun not available)

### **Step 5: Generate Domain**

1. Click Settings tab
2. Scroll to "Networking"
3. Click "Generate Domain"
4. You'll get a URL like: `https://your-app.up.railway.app`

### **Step 6: Update BACKEND_URL**

1. Go back to Variables tab
2. Update `BACKEND_URL` with your Railway domain:
   ```bash
   BACKEND_URL=https://your-app.up.railway.app
   ```

### **Step 7: Deploy**

Railway will automatically deploy. Watch the logs for:
```
✅ Connected to MongoDB successfully
🚀 Server running on http://localhost:8000
```

---

## 🧪 Test Deployment

```bash
curl https://your-app.up.railway.app/
```

Expected response:
```json
{
  "message": "Campus ID SAAS API Server",
  "version": "1.0.0",
  "status": "healthy"
}
```

---

## 💰 Free Tier Limits

Railway free tier includes:
- **$5 credit per month**
- **500 hours of usage** (enough for 24/7 uptime)
- **100 GB bandwidth**
- **No automatic spin-down**

Your backend should use approximately:
- **~$3-4 per month** for 24/7 uptime
- Well within free tier limits

---

## 📊 Monitor Usage

1. Go to Railway Dashboard
2. Click on your project
3. View "Usage" tab
4. Monitor credit consumption

---

## 🔄 Auto-Deploy on Git Push

Railway automatically deploys when you push to GitHub:

1. Make changes to your code
2. Commit and push to GitHub
3. Railway automatically detects and deploys
4. Check deployment logs in Railway dashboard

---

## 🆚 Railway vs Render Comparison

| Feature | Railway | Render |
|---------|---------|--------|
| Free Tier | $5/month credit | Free with spin-down |
| Spin Down | No | Yes (after 15 min) |
| Cold Start | Fast (~5s) | Slow (~30-60s) |
| Uptime | 24/7 | Intermittent |
| Build Speed | Fast | Moderate |
| Ease of Use | Very Easy | Easy |
| Best For | Production | Testing |

---

## 🎯 Recommendation

**Use Railway for production** - Better uptime and performance
**Keep Render as backup** - Free fallback option

---

## 📞 Update Frontend Team

Once deployed to Railway, update your frontend team:

**New Backend URL:** `https://your-app.up.railway.app`

They need to update Vercel environment variable:
```bash
NEXT_PUBLIC_API_URL=https://your-app.up.railway.app
```

---

## 🔒 Security Tips

1. **Regenerate JWT secrets** for production
2. **Use strong SUPER_ADMIN_KEY**
3. **Limit CORS_ORIGIN** to only your domains
4. **Enable MongoDB IP whitelist** (optional)
5. **Monitor Railway logs** regularly

---

## 🐛 Troubleshooting

### **Issue: Build Failed**

Check logs for errors:
- Missing dependencies
- Environment variables not set
- Build command incorrect

### **Issue: Service Not Starting**

Check:
- PORT environment variable (Railway provides this automatically)
- MongoDB connection string
- All required environment variables set

### **Issue: Out of Credits**

Monitor usage in Railway dashboard. If you exceed $5/month:
- Optimize your backend
- Upgrade to paid plan ($5/month for $5 credit + usage-based)
- Use Render as fallback

---

## ✅ Success Checklist

- [ ] Railway account created
- [ ] GitHub repo connected
- [ ] All environment variables set
- [ ] Domain generated
- [ ] Backend deployed successfully
- [ ] Health check returns 200 OK
- [ ] CORS configured correctly
- [ ] Frontend team notified of new URL
- [ ] Test login from Vercel frontend

---

## 🎉 You're Done!

Your backend is now deployed on Railway with better uptime and performance! 🚀
