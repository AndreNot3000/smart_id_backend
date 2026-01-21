# 📧 Mailtrap Email API Setup Guide

## 🚀 Upgrade from Sandbox to Real Email Sending

Now that you have a live Render URL, you can upgrade from Mailtrap's sandbox (testing) to their Email API (production) to send real emails!

## 📋 **Step-by-Step Setup**

### **1. Access Mailtrap Email API**
1. **Go to [Mailtrap.io](https://mailtrap.io)**
2. **Login to your account**
3. **Click "Email API" in the left sidebar** (not "Email Testing")
4. **Click "Sending Domains"**

### **2. Set Up Sending Domain**

**Option A: Use Your Own Domain (Recommended)**
1. **Click "Add Domain"**
2. **Enter your domain** (e.g., `yourdomain.com`)
3. **Follow DNS verification steps**
4. **Wait for verification** (can take up to 24 hours)

**Option B: Use Mailtrap's Shared Domain (Quick Start)**
1. **Use the default shared domain** provided by Mailtrap
2. **No DNS setup required**
3. **Ready to use immediately**

### **3. Get API Credentials**
1. **Go to "API Tokens" section**
2. **Click "Create Token"**
3. **Copy your API token** (looks like: `1a2b3c4d5e6f7g8h9i0j`)
4. **Save it securely** - you'll need it for environment variables

### **4. Update Environment Variables**

**Add to your Render environment variables:**
```env
# Mailtrap Email API (Production)
MAILTRAP_API_TOKEN=your-api-token-here
MAILTRAP_DOMAIN=yourdomain.com

# Keep sandbox credentials as fallback
SMTP_HOST=sandbox.smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=01c43d3a511a14
SMTP_PASS=a83dcd09a51952
```

### **5. How It Works**

**With API Token Set:**
- ✅ **Uses Email API** (`live.smtp.mailtrap.io`)
- ✅ **Sends real emails** to actual inboxes
- ✅ **Production-ready** delivery

**Without API Token:**
- 🧪 **Uses Sandbox** (`sandbox.smtp.mailtrap.io`)
- 🧪 **Testing mode** - emails captured in dashboard
- 🧪 **Safe for development**

## 🎯 **Quick Setup (Shared Domain)**

If you want to start immediately without domain setup:

### **1. Get API Token**
1. Go to Mailtrap → Email API → API Tokens
2. Create new token
3. Copy the token

### **2. Add to Render**
```env
MAILTRAP_API_TOKEN=your-token-here
```

### **3. Test Email**
Try creating a new admin account - emails will now be sent to real inboxes!

## 📊 **Email API Benefits**

### **Free Tier Includes:**
- ✅ **1,000 emails/month** free
- ✅ **Real email delivery**
- ✅ **Delivery analytics**
- ✅ **Bounce handling**
- ✅ **Spam score checking**

### **Paid Plans:**
- 📈 **Higher volume** (10K+ emails/month)
- 📊 **Advanced analytics**
- 🔧 **Dedicated IP**
- 📞 **Priority support**

## 🧪 **Testing Strategy**

### **Development:**
```env
# No MAILTRAP_API_TOKEN = Sandbox mode
SMTP_USER=01c43d3a511a14
SMTP_PASS=a83dcd09a51952
```

### **Production:**
```env
# With MAILTRAP_API_TOKEN = Email API mode
MAILTRAP_API_TOKEN=your-token
MAILTRAP_DOMAIN=yourdomain.com
```

## 🔧 **Troubleshooting**

### **Emails Not Sending:**
1. **Check API token** is correct
2. **Verify domain** is validated (if using custom domain)
3. **Check Render logs** for error messages
4. **Ensure from address** matches verified domain

### **Emails Going to Spam:**
1. **Set up SPF/DKIM records** (for custom domain)
2. **Use proper from address**
3. **Check spam score** in Mailtrap dashboard
4. **Warm up your domain** gradually

### **Domain Verification Issues:**
1. **Check DNS records** are correctly set
2. **Wait up to 24 hours** for propagation
3. **Use DNS checker tools** to verify
4. **Contact Mailtrap support** if needed

## ✅ **Verification Steps**

### **1. Check Logs**
After setting up, check Render logs for:
- `🚀 Using Mailtrap Email API (Production)`
- `✅ email sent successfully`

### **2. Test Email**
Create a test admin account with your real email address and verify you receive the email.

### **3. Monitor Dashboard**
Check Mailtrap Email API dashboard for:
- Email delivery status
- Bounce rates
- Spam scores

## 🎉 **You're Ready!**

Once set up, your Campus ID system will send professional emails directly to users' inboxes, providing a much better user experience than the sandbox testing mode!

**Pro Tip:** Start with the shared domain for immediate setup, then add your custom domain later for better branding.