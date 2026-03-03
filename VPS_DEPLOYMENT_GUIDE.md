# 🖥️ VPS Deployment Guide - Complete Setup

This guide will walk you through deploying your Campus ID backend to a VPS server with full production setup.

---

## 📋 What You'll Learn

1. ✅ SSH into VPS
2. ✅ Install Bun runtime
3. ✅ Clone your GitHub repository
4. ✅ Set up PM2 (process manager)
5. ✅ Configure Nginx (reverse proxy)
6. ✅ Set up domain name
7. ✅ Get SSL certificate (HTTPS)
8. ✅ Deploy and test

---

## 🎯 Prerequisites

Before starting, make sure you have:
- [ ] VPS IP address (from your friend)
- [ ] VPS password (from your friend)
- [ ] Domain name (e.g., api.yourdomain.com)
- [ ] GitHub repository access
- [ ] Your local computer with terminal/PowerShell

---

## 🔐 Step 1: SSH into VPS

### **On Windows (PowerShell):**

```powershell
# SSH into your VPS
ssh root@YOUR_VPS_IP_ADDRESS

# Enter password when prompted
```

### **On Mac/Linux (Terminal):**

```bash
# SSH into your VPS
ssh root@YOUR_VPS_IP_ADDRESS

# Enter password when prompted
```

**Example:**
```bash
ssh root@192.168.1.100
# Enter password: ********
```

**First time connecting?** You'll see a message like:
```
The authenticity of host '192.168.1.100' can't be established.
Are you sure you want to continue connecting (yes/no)?
```
Type `yes` and press Enter.

---

## 🔧 Step 2: Update System & Install Dependencies

Once connected to VPS, run these commands:

```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install essential tools
sudo apt install -y curl git build-essential

# Install Node.js (if needed as fallback)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installations
node --version
npm --version
git --version
```

---

## 🚀 Step 3: Install Bun Runtime

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Add Bun to PATH (run these commands)
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Make it permanent
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Verify Bun installation
bun --version
```

---

## 🔑 Step 4: Set Up GitHub SSH Key

### **Generate SSH Key on VPS:**

```bash
# Generate new SSH key
ssh-keygen -t ed25519 -C "your_email@example.com"

# Press Enter for all prompts (use default location)

# Display your public key
cat ~/.ssh/id_ed25519.pub
```

### **Add SSH Key to GitHub:**

1. Copy the output from the `cat` command (starts with `ssh-ed25519`)
2. Go to GitHub: https://github.com/settings/keys
3. Click "New SSH key"
4. Title: "VPS Server"
5. Paste the key
6. Click "Add SSH key"

### **Test GitHub Connection:**

```bash
# Test SSH connection to GitHub
ssh -T git@github.com

# You should see: "Hi username! You've successfully authenticated..."
```

---

## 📦 Step 5: Clone Your Repository

```bash
# Create directory for your app
mkdir -p /var/www
cd /var/www

# Clone your repository
git clone git@github.com:AndreNot3000/smart_id_backend.git

# Navigate to project directory
cd smart_id_backend

# Verify files
ls -la
```

---

## 🔐 Step 6: Set Up Environment Variables

```bash
# Create .env file
nano .env
```

**Paste this content (update with your actual values):**

```bash
# MongoDB Configuration
MONGODB_URL=mongodb+srv://andreolumide_db_user:Hackless12345@cluster0.p9ufwqc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
DB_NAME=campus_id_saas

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here-change-this-in-production
JWT_REFRESH_SECRET=your-refresh-secret-here-change-this-in-production

# Super Admin Configuration
SUPER_ADMIN_KEY=andrenaline

# Email Configuration
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=01c43d3a511a14
SMTP_PASS=a83dcd09a51952

# Server Configuration
PORT=8000
NODE_ENV=production

# CORS & URLs - UPDATE WITH YOUR ACTUAL DOMAIN!
CORS_ORIGIN=https://your-vercel-app.vercel.app,http://localhost:3000
FRONTEND_URL=https://your-vercel-app.vercel.app
BACKEND_URL=https://api.yourdomain.com
```

**Save and exit:**
- Press `Ctrl + X`
- Press `Y` to confirm
- Press `Enter` to save

---

## 📦 Step 7: Install Dependencies & Test

```bash
# Install dependencies
bun install

# Test if app runs
bun main.ts

# You should see:
# ✅ Connected to MongoDB successfully
# 🚀 Server running on http://localhost:8000

# Press Ctrl+C to stop
```

---

## 🔄 Step 8: Install & Configure PM2

PM2 keeps your app running 24/7 and restarts it if it crashes.

```bash
# Install PM2 globally
npm install -g pm2

# Start your app with PM2
pm2 start main.ts --name campus-id-backend --interpreter bun

# Check status
pm2 status

# View logs
pm2 logs campus-id-backend

# Make PM2 start on system reboot
pm2 startup
pm2 save
```

**PM2 Commands Reference:**
```bash
pm2 status              # Check app status
pm2 logs                # View logs
pm2 restart campus-id-backend  # Restart app
pm2 stop campus-id-backend     # Stop app
pm2 delete campus-id-backend   # Remove app from PM2
```

---

## 🌐 Step 9: Install & Configure Nginx

Nginx will act as a reverse proxy, forwarding requests to your app.

### **Install Nginx:**

```bash
# Install Nginx
sudo apt install -y nginx

# Check Nginx status
sudo systemctl status nginx

# Start Nginx if not running
sudo systemctl start nginx
sudo systemctl enable nginx
```

### **Configure Nginx:**

```bash
# Create Nginx configuration file
sudo nano /etc/nginx/sites-available/campus-id-backend
```

**Paste this configuration (replace `api.yourdomain.com` with your actual domain):**

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Save and exit** (Ctrl+X, Y, Enter)

### **Enable the Configuration:**

```bash
# Create symbolic link
sudo ln -s /etc/nginx/sites-available/campus-id-backend /etc/nginx/sites-enabled/

# Test Nginx configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

---

## 🌍 Step 10: Configure Domain Name

### **Point Your Domain to VPS:**

1. Go to your domain registrar (Namecheap, GoDaddy, etc.)
2. Find DNS settings
3. Add an A record:
   - **Type:** A
   - **Name:** api (or @ for root domain)
   - **Value:** YOUR_VPS_IP_ADDRESS
   - **TTL:** 300 (or automatic)

**Example:**
```
Type: A
Name: api
Value: 192.168.1.100
TTL: 300
```

This creates: `api.yourdomain.com` → `192.168.1.100`

**Wait 5-15 minutes** for DNS propagation.

### **Test Domain:**

```bash
# Test if domain points to your VPS
ping api.yourdomain.com

# Should show your VPS IP address
```

---

## 🔒 Step 11: Get SSL Certificate (HTTPS)

Use Certbot to get a free SSL certificate from Let's Encrypt.

### **Install Certbot:**

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx
```

### **Get SSL Certificate:**

```bash
# Request SSL certificate
sudo certbot --nginx -d api.yourdomain.com

# Follow the prompts:
# 1. Enter your email address
# 2. Agree to terms (Y)
# 3. Share email with EFF (optional - Y or N)
# 4. Choose redirect option: 2 (Redirect HTTP to HTTPS)
```

**Certbot will automatically:**
- Get SSL certificate
- Update Nginx configuration
- Set up auto-renewal

### **Test Auto-Renewal:**

```bash
# Test certificate renewal
sudo certbot renew --dry-run

# Should show: "Congratulations, all simulated renewals succeeded"
```

---

## ✅ Step 12: Test Your Deployment

### **1. Test Health Check:**

```bash
# From your local machine
curl https://api.yourdomain.com/

# Expected response:
# {
#   "message": "Campus ID SAAS API Server",
#   "version": "1.0.0",
#   "status": "healthy"
# }
```

### **2. Test Login Endpoint:**

```bash
curl -X POST https://api.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@university.edu",
    "password": "password123",
    "userType": "admin"
  }'
```

### **3. Test from Browser:**

Open browser and go to:
```
https://api.yourdomain.com/
```

You should see the health check response.

---

## 🔄 Step 13: Deploy Updates

When you make changes to your code:

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP_ADDRESS

# Navigate to project directory
cd /var/www/smart_id_backend

# Pull latest changes
git pull origin main

# Install any new dependencies
bun install

# Restart app with PM2
pm2 restart campus-id-backend

# Check logs
pm2 logs campus-id-backend
```

---

## 📊 Monitoring & Maintenance

### **Check App Status:**

```bash
# PM2 status
pm2 status

# View logs
pm2 logs campus-id-backend

# View last 100 lines
pm2 logs campus-id-backend --lines 100

# Monitor in real-time
pm2 monit
```

### **Check Nginx Status:**

```bash
# Nginx status
sudo systemctl status nginx

# View Nginx error logs
sudo tail -f /var/log/nginx/error.log

# View Nginx access logs
sudo tail -f /var/log/nginx/access.log
```

### **Check System Resources:**

```bash
# CPU and memory usage
htop

# Or use top
top

# Disk usage
df -h

# Memory usage
free -h
```

---

## 🐛 Troubleshooting

### **Issue 1: App Not Starting**

```bash
# Check PM2 logs
pm2 logs campus-id-backend

# Common issues:
# - MongoDB connection failed
# - Port already in use
# - Missing environment variables
```

### **Issue 2: 502 Bad Gateway**

```bash
# Check if app is running
pm2 status

# Check Nginx error logs
sudo tail -f /var/log/nginx/error.log

# Restart app
pm2 restart campus-id-backend

# Restart Nginx
sudo systemctl restart nginx
```

### **Issue 3: SSL Certificate Issues**

```bash
# Check certificate status
sudo certbot certificates

# Renew certificate manually
sudo certbot renew

# Restart Nginx
sudo systemctl restart nginx
```

### **Issue 4: Can't Connect to VPS**

```bash
# Check if SSH service is running
sudo systemctl status ssh

# Restart SSH service
sudo systemctl restart ssh
```

### **Issue 5: Domain Not Resolving**

```bash
# Check DNS propagation
nslookup api.yourdomain.com

# Or use online tool:
# https://dnschecker.org/
```

---

## 🔒 Security Best Practices

### **1. Change Root Password:**

```bash
# Change root password
passwd
```

### **2. Create Non-Root User:**

```bash
# Create new user
adduser deploy

# Add to sudo group
usermod -aG sudo deploy

# Switch to new user
su - deploy
```

### **3. Set Up Firewall:**

```bash
# Install UFW (Uncomplicated Firewall)
sudo apt install -y ufw

# Allow SSH
sudo ufw allow 22

# Allow HTTP
sudo ufw allow 80

# Allow HTTPS
sudo ufw allow 443

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

### **4. Disable Root SSH Login:**

```bash
# Edit SSH config
sudo nano /etc/ssh/sshd_config

# Find and change:
# PermitRootLogin yes
# to:
# PermitRootLogin no

# Restart SSH
sudo systemctl restart ssh
```

---

## 📱 Update Frontend Team

Once deployed, share this with your frontend team:

**Backend URL:** `https://api.yourdomain.com`

**What they need to do:**
1. Update Vercel environment variable:
   ```bash
   NEXT_PUBLIC_API_URL=https://api.yourdomain.com
   ```
2. Redeploy frontend
3. Test login

---

## ✅ Deployment Checklist

- [ ] SSH into VPS successfully
- [ ] System updated
- [ ] Bun installed
- [ ] GitHub SSH key configured
- [ ] Repository cloned
- [ ] Environment variables set
- [ ] Dependencies installed
- [ ] App runs with `bun main.ts`
- [ ] PM2 installed and configured
- [ ] App running with PM2
- [ ] Nginx installed and configured
- [ ] Domain DNS configured
- [ ] Domain resolves to VPS IP
- [ ] SSL certificate obtained
- [ ] HTTPS working
- [ ] Health check returns 200 OK
- [ ] Login endpoint works
- [ ] Frontend team notified

---

## 🎉 Success!

Your backend is now deployed on a VPS with:
- ✅ 24/7 uptime (no spin-down)
- ✅ HTTPS/SSL encryption
- ✅ Custom domain
- ✅ Process management (PM2)
- ✅ Reverse proxy (Nginx)
- ✅ Auto-restart on crash
- ✅ Production-ready setup

---

## 📞 Quick Reference Commands

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP

# Navigate to project
cd /var/www/smart_id_backend

# Pull updates
git pull origin main

# Restart app
pm2 restart campus-id-backend

# View logs
pm2 logs campus-id-backend

# Check status
pm2 status

# Restart Nginx
sudo systemctl restart nginx

# View Nginx logs
sudo tail -f /var/log/nginx/error.log
```

---

**You're all set! 🚀**
