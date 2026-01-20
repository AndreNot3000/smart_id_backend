# 👥 Campus ID SAAS - User Guide

## 🎯 Overview

This guide covers how to use the Campus ID system for different user roles: Super Admin, Institution Admin, Students, and Lecturers.

---

## 👑 Super Admin Workflow

### **Role:** System Owner
**Responsibilities:** Create and manage institutions

### 1. **Create Institution**
```bash
# Using Postman or API client
POST http://localhost:8000/api/superadmin/institutions
Headers:
  X-Super-Admin-Key: andrenaline
  Content-Type: application/json

Body:
{
  "name": "Harvard University",
  "code": "HARV",
  "domain": "harvard.edu",
  "address": "Cambridge, MA, USA",
  "phone": "+1-617-495-1000",
  "email": "info@harvard.edu"
}
```

### 2. **View All Institutions**
```bash
GET http://localhost:8000/api/superadmin/institutions
Headers:
  X-Super-Admin-Key: andrenaline
```

**Key Points:**
- ✅ Only super admin can create institutions
- ✅ Institution codes must be unique (e.g., HARV, MIT, UCLA)
- ✅ Domains must be unique (e.g., harvard.edu)
- ✅ Up to 10 admins allowed per institution

---

## 👨‍💼 Institution Admin Workflow

### **Role:** Institution Administrator
**Responsibilities:** Manage students, lecturers, and institution users

### 1. **Admin Registration**
```bash
POST http://localhost:8000/api/auth/admin/register
Content-Type: application/json

Body:
{
  "institutionCode": "HARV",
  "adminFirstName": "John",
  "adminLastName": "Smith",
  "adminEmail": "admin@harvard.edu",
  "password": "securePassword123",
  "confirmPassword": "securePassword123"
}
```

### 2. **Email Verification**
1. Check email for 6-digit OTP code
2. Verify with OTP:
```bash
POST http://localhost:8000/api/auth/verify-otp
{
  "email": "admin@harvard.edu",
  "code": "123456"
}
```

### 3. **Admin Login**
```bash
POST http://localhost:8000/api/auth/login
{
  "email": "admin@harvard.edu",
  "password": "securePassword123",
  "userType": "admin"
}
```

### 4. **Create Student Accounts**
```bash
POST http://localhost:8000/api/admin/students
Headers:
  Authorization: Bearer <admin_token>

Body:
{
  "firstName": "Sarah",
  "lastName": "Johnson",
  "email": "sarah.johnson@harvard.edu",
  "department": "Computer Science",
  "year": "Sophomore (Year 2)"
}
```

**What Happens:**
- ✅ Student ID auto-generated: `HARV-123456789`
- ✅ Default password: `sarah123` (firstName + 123)
- ✅ Magic link email sent to student
- ✅ Account status: `pending` until email verified

### 5. **Create Lecturer Accounts**
```bash
POST http://localhost:8000/api/admin/lecturers
Headers:
  Authorization: Bearer <admin_token>

Body:
{
  "firstName": "John",
  "lastName": "Smith",
  "email": "john.smith@harvard.edu",
  "department": "Computer Science",
  "role": "Dr",
  "specialization": "Machine Learning"
}
```

**Available Roles:** `Prof`, `Dr`, `Mr`, `Mrs`, `Ms`

**What Happens:**
- ✅ Lecturer ID auto-generated: `HARV-LEC-123456789`
- ✅ Default password: `john123` (firstName + 123)
- ✅ Role-specific magic link email sent
- ✅ Account status: `pending` until email verified

### 6. **View Dashboard Statistics**
```bash
GET http://localhost:8000/api/users/dashboard-stats
Headers:
  Authorization: Bearer <admin_token>
```

**Response:**
```json
{
  "stats": {
    "users": {
      "total": 150,
      "students": 120,
      "lecturers": 25,
      "admins": 5
    },
    "status": {
      "active": 140,
      "pending": 8,
      "suspended": 2
    }
  }
}
```

### 7. **Manage Users**
```bash
# Get all students
GET http://localhost:8000/api/admin/students

# Get all lecturers  
GET http://localhost:8000/api/admin/lecturers
```

---

## 🎓 Student Workflow

### **Role:** Student
**Responsibilities:** Activate account, manage profile, access student dashboard

### 1. **Receive Activation Email**
- Admin creates your account
- Check email for activation message
- Email contains:
  - Student ID: `HARV-123456789`
  - Default password: `sarah123`
  - Magic activation link

### 2. **Account Activation**
1. Click "ACTIVATE ACCOUNT" button in email
2. Redirected to success page
3. Auto-redirect to login page after 3 seconds

### 3. **First Login**
```bash
POST http://localhost:8000/api/auth/login
{
  "email": "sarah.johnson@harvard.edu", // or "HARV-123456789"
  "password": "sarah123",
  "userType": "student"
}
```

**Login Options:**
- ✅ Use email: `sarah.johnson@harvard.edu`
- ✅ Use Student ID: `HARV-123456789`

### 4. **Password Change (Required)**
First login response includes `"isFirstLogin": true`

```bash
PUT http://localhost:8000/api/users/change-password
Headers:
  Authorization: Bearer <student_token>

Body:
{
  "currentPassword": "sarah123",
  "newPassword": "MyNewSecurePassword123!",
  "confirmPassword": "MyNewSecurePassword123!"
}
```

**Security Rules:**
- ❌ Cannot reuse current password
- ❌ Cannot reuse last 5 passwords
- ✅ Must be at least 8 characters

### 5. **Access Profile**
```bash
GET http://localhost:8000/api/users/profile
Headers:
  Authorization: Bearer <student_token>
```

### 6. **Update Profile**
```bash
PUT http://localhost:8000/api/users/profile
Headers:
  Authorization: Bearer <student_token>

Body:
{
  "firstName": "Sarah",
  "lastName": "Johnson",
  "phone": "+1234567890",
  "address": "123 Campus Street",
  "department": "Computer Science"
}
```

---

## 👨‍🏫 Lecturer Workflow

### **Role:** Lecturer/Faculty
**Responsibilities:** Activate account, manage profile, access lecturer dashboard

### 1. **Receive Activation Email**
- Admin creates your account
- Check email for role-specific activation message
- Email contains:
  - Lecturer ID: `HARV-LEC-123456789`
  - Role: `Dr` (or Prof, Mr, Mrs, Ms)
  - Default password: `john123`
  - Magic activation link

### 2. **Account Activation**
Same as students - click activation link in email

### 3. **First Login**
```bash
POST http://localhost:8000/api/auth/login
{
  "email": "john.smith@harvard.edu", // or "HARV-LEC-123456789"
  "password": "john123",
  "userType": "lecturer"
}
```

**Login Options:**
- ✅ Use email: `john.smith@harvard.edu`
- ✅ Use Lecturer ID: `HARV-LEC-123456789`

### 4. **Password Change (Required)**
Same process as students - must change password on first login

### 5. **Profile Management**
Same endpoints as students, but with lecturer-specific fields:
- Role (Prof, Dr, Mr, Mrs, Ms)
- Specialization
- Department

---

## 🔄 Common Workflows

### **Password Reset (All Users)**

**Step 1 - Request Reset:**
```bash
POST http://localhost:8000/api/auth/forgot-password
{
  "email": "user@harvard.edu",
  "userType": "student" // or "lecturer", "admin"
}
```

**Step 2 - Check Email for OTP**
- 6-digit code sent to email
- Code expires in 10 minutes

**Step 3 - Reset Password:**
```bash
POST http://localhost:8000/api/auth/reset-password
{
  "email": "user@harvard.edu",
  "code": "123456",
  "newPassword": "NewSecurePassword123!",
  "confirmPassword": "NewSecurePassword123!"
}
```

### **Profile Updates (All Users)**
```bash
# Update basic info
PUT http://localhost:8000/api/users/profile

# Update avatar
PUT http://localhost:8000/api/users/avatar
{
  "avatar": "SJ"
}

# Change password anytime
PUT http://localhost:8000/api/users/change-password
```

### **Logout (All Users)**
```bash
POST http://localhost:8000/api/users/logout
Headers:
  Authorization: Bearer <user_token>
```

---

## 📧 Email System

### **Email Types:**

1. **Admin Registration:** OTP verification code
2. **Student Activation:** Magic link with credentials
3. **Lecturer Activation:** Role-specific magic link
4. **Password Reset:** OTP code for password reset

### **Email Features:**
- ✅ Professional templates with institution branding
- ✅ Magic links expire in 24 hours
- ✅ OTP codes expire in 10 minutes
- ✅ One-time use security
- ✅ Mobile-responsive design

### **Testing with Mailtrap:**
- All emails captured in Mailtrap inbox
- No real emails sent during development
- Perfect for testing all email flows

---

## 🔒 Security Features

### **Authentication:**
- ✅ JWT tokens (24-hour access, 7-day refresh)
- ✅ Role-based access control
- ✅ Email verification required
- ✅ Password history tracking

### **Password Security:**
- ✅ Minimum 8 characters
- ✅ Cannot reuse last 5 passwords
- ✅ First login password change required
- ✅ Secure password reset with OTP

### **Account Security:**
- ✅ Magic link verification (24-hour expiry)
- ✅ One-time use tokens
- ✅ Account status tracking
- ✅ Institution-based isolation

---

## 🎯 User Journey Summary

### **Admin Journey:**
1. Super Admin creates institution
2. Admin registers for institution
3. Admin verifies email with OTP
4. Admin logs in and creates users
5. Admin manages institution dashboard

### **Student/Lecturer Journey:**
1. Admin creates account
2. User receives activation email
3. User clicks magic link (account activated)
4. User logs in with default password
5. User changes password (required)
6. User accesses dashboard and manages profile

### **Ongoing Usage:**
- Login with email or ID
- Manage profile information
- Change passwords as needed
- Reset passwords if forgotten
- Access role-specific dashboards

---

## ✅ **User Guide Complete!**

This covers all user workflows for the Campus ID system. Each role has specific responsibilities and access levels, ensuring secure and organized institution management! 🎉