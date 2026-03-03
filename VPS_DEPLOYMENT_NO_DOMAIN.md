# 🖥️ VPS Deployment Without Domain Name

Deploy your backend using just the VPS IP address - no domain required!

---

## ✅ What You Can Use Instead of a Domain

### **Option 1: Use IP Address Directly (Simplest)**

Your backend will be accessible at:
```
http://YOUR_VPS_IP:8000
```

Example: `http://192.168.1.100:8000`

**Pros:**
- ✅ No domain needed
- ✅ Works immediately
- ✅ Free
- ✅ Simple setup

**Cons:**
- ❌ No HTTPS (unless you set up self-signed certificate)
- ❌ Hard to remember IP address
- ❌ Looks unprofessional

### **Option 2: Free Subdomain Services**

Use free services that give you a subdomain:

1. **DuckDNS** (https://www.duckdns.org/)
   - Free subdomain: `yourapp.duckdns.org`
   - Free SSL certificate support
   - Easy to set up

2. **FreeDNS** (https://freedns.afraid.org/)
   - Free subdomain: `yourapp.mooo.com`
   - Multiple domain options
   - Free

3. **No-IP** (https://www.noip.com/)
   - Free subdomain: `yourapp.ddns.net`
   - Free tier available

### **Option 3: Use Cloudflare Tunnel (Advanced)**

Cloudflare offers free tunnels that give you a subdomain without exposing your IP.

---

## 🚀 Quick Deployment Without Domain

Follow these steps to deploy using just the IP address:

### **Step 1: SSH into VPS**

```bash
ssh root@YOUR_VPS_IP_ADDRESS
# Enter password when prompted
```

### **Step 2: Update System**

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

### **Step 3: Install Bun**

```bash
curl -fsSL https://bun.sh/install | bash
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
bun --version
```

### **Step 4: Set Up GitHub SSH Key**

```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
# Press Enter for all prompts
cat ~/.ssh/id_ed25519.pub
# Copy the output and add to GitHub: https://github.com/settings/keys
```

### **Step 5: Clone Repository**

```bash
mkdir -p /var/www
cd /var/www
git clone git@github.com:AndreNot3000/smart_id_backend.git
cd smart_id_backend
```

### **Step 6: Create .env File**

```bash
nano .env
```

Paste this (update with your Vercel URL):

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

# CORS & URLs - UPDATE WITH YOUR VERCEL URL AND VPS IP!
CORS_ORIGIN=https://your-vercel-app.vercel.app,http://localhost:3000
FRONTEND_URL=https://your-vercel-app.vercel.app
BACKEND_URL=http://YOUR_VPS_IP:8000
```

Save: `Ctrl+X`, `Y`, `Enter`

### **Step 7: Install Dependencies**

```bash
bun install
```

### **Step 8: Test App**

```bash
bun main.ts
# Should see: ✅ Connected to MongoDB successfully
# Press Ctrl+C to stop
```

### **Step 9: Install PM2**

```bash
npm install -g pm2
pm2 start main.ts --name campus-id-backend --interpreter bun
pm2 startup
pm2 save
```

### **Step 10: Configure Firewall**

```bash
# Allow port 8000
sudo ufw allow 8000

# Allow SSH
sudo ufw allow 22

# Enable firewall
sudo ufw enable
```

---

## ✅ Test Your Deployment

### **From Your Local Machine:**

```bash
# Test health check
curl http://YOUR_VPS_IP:8000/

# Expected response:
# {
#   "message": "Campus ID SAAS API Server",
#   "version": "1.0.0",
#   "status": "healthy"
# }
```

### **From Browser:**

Open browser and go to:
```
http://YOUR_VPS_IP:8000/
```

---

## 📱 Update Frontend Team

**Backend URL:** `http://YOUR_VPS_IP:8000`

**What they need to do:**

1. Update Vercel environment variable:
   ```bash
   NEXT_PUBLIC_API_URL=http://YOUR_VPS_IP:8000
   ```

2. Redeploy frontend

3. Test login

**⚠️ Important:** Using HTTP (not HTTPS) means:
- Data is not encrypted
- Some browsers may show warnings
- Not recommended for production with sensitive data

---

## 🔒 Adding HTTPS Without Domain (Optional)

If you want HTTPS without a domain, you can use a self-signed certificate:

### **Generate Self-Signed Certificate:**

```bash
# Install OpenSSL
sudo apt install -y openssl

# Generate certificate
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/private/selfsigned.key \
  -out /etc/ssl/certs/selfsigned.crt

# Follow prompts (you can press Enter for most)
```

### **Update Your App to Use HTTPS:**

This requires modifying your `main.ts` to use HTTPS. However, browsers will show "Not Secure" warnings because it's self-signed.

**Better Option:** Use a free subdomain service (DuckDNS) to get proper SSL.

---

## 🌐 Using DuckDNS (Free Subdomain + SSL)

### **Step 1: Sign Up for DuckDNS**

1. Go to https://www.duckdns.org/
2. Sign in with GitHub/Google
3. Create a subdomain: `yourapp.duckdns.org`
4. Point it to your VPS IP address

### **Step 2: Install DuckDNS Client on VPS**

```bash
# Create directory
mkdir ~/duckdns
cd ~/duckdns

# Create update script
nano duck.sh
```

Paste this (replace TOKEN and DOMAIN):

```bash
echo url="https://www.duckdns.org/update?domains=YOURDOMAIN&token=YOURTOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -
```

Save and make executable:

```bash
chmod 700 duck.sh

# Test it
./duck.sh

# Should show: OK
```

### **Step 3: Set Up Auto-Update**

```bash
# Add to crontab
crontab -e

# Add this line (updates every 5 minutes):
*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1
```

### **Step 4: Install Nginx**

```bash
sudo apt install -y nginx
```

### **Step 5: Configure Nginx**

```bash
sudo nano /etc/nginx/sites-available/campus-id-backend
```

Paste this (replace `yourapp.duckdns.org`):

```nginx
server {
    listen 80;
    server_name yourapp.duckdns.org;

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

Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/campus-id-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### **Step 6: Get SSL Certificate**

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourapp.duckdns.org
```

Now your backend is accessible at:
```
https://yourapp.duckdns.org
```

---

## 📊 Comparison of Options

| Option | URL Format | HTTPS | Cost | Setup Time |
|--------|-----------|-------|------|------------|
| IP Address | `http://192.168.1.100:8000` | ❌ No | Free | 5 min |
| IP + Self-Signed | `https://192.168.1.100:8000` | ⚠️ Warning | Free | 15 min |
| DuckDNS | `https://yourapp.duckdns.org` | ✅ Yes | Free | 30 min |
| Paid Domain | `https://api.yourdomain.com` | ✅ Yes | ~$10/year | 45 min |

---

## 🎯 Recommendation

### **For Testing/Development:**
Use IP address directly: `http://YOUR_VPS_IP:8000`
- Fastest to set up
- Works immediately
- Good enough for testing

### **For Production:**
Use DuckDNS: `https://yourapp.duckdns.org`
- Free
- Proper HTTPS
- Professional
- Easy to remember

### **For Serious Production:**
Buy a domain: `https://api.yourdomain.com`
- Most professional
- Custom branding
- Better for business

---

## 🔄 Deploy Updates

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP

# Navigate to project
cd /var/www/smart_id_backend

# Pull updates
git pull origin main

# Install dependencies
bun install

# Restart app
pm2 restart campus-id-backend
```

---

## ✅ Quick Start Checklist (No Domain)

- [ ] SSH into VPS
- [ ] Install Bun
- [ ] Set up GitHub SSH key
- [ ] Clone repository
- [ ] Create .env file
- [ ] Install dependencies
- [ ] Test app runs
- [ ] Install PM2
- [ ] Start app with PM2
- [ ] Allow port 8000 in firewall
- [ ] Test from browser: `http://YOUR_VPS_IP:8000`
- [ ] Update frontend with backend URL
- [ ] Test login from frontend

---

## 🎉 You're Done!

Your backend is now running at:
```
http://YOUR_VPS_IP:8000
```

Share this URL with your frontend team and you're good to go! 🚀

**Want HTTPS?** Follow the DuckDNS section above for free SSL certificate.
