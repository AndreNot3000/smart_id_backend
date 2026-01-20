# 📚 Campus ID SAAS - Complete API Reference

## 🎯 Base URL
```
http://localhost:8000
```

---

## 🔐 Authentication Endpoints

### 1. **Get Available Institutions**
**Endpoint:** `GET /api/auth/institutions`

**Request:**
```
GET /api/auth/institutions
```

**Success Response (200):**
```json
{
  "institutions": [
    {
      "id": "507f1f77bcf86cd799439011",
      "name": "Harvard University",
      "code": "HARV"
    }
  ]
}
```

---

### 2. **Admin Registration**
**Endpoint:** `POST /api/auth/admin/register`

**Request Body:**
```json
{
  "institutionCode": "HARV",
  "adminFirstName": "John",
  "adminLastName": "Smith",
  "adminEmail": "admin@harvard.edu",
  "password": "securePassword123",
  "confirmPassword": "securePassword123"
}
```

**Success Response (201):**
```json
{
  "message": "Admin account created successfully. Please check your email for verification code.",
  "institutionName": "Harvard University",
  "institutionCode": "HARV",
  "adminId": "507f1f77bcf86cd799439011",
  "email": "admin@harvard.edu"
}
```

**Error Responses:**
```json
// Institution not found (404)
{
  "error": "Institution not found or inactive. Please contact system administrator."
}

// Maximum admins reached (400)
{
  "error": "This institution has reached the maximum number of admins (10). Please contact your institution administrator."
}

// Email already exists (400)
{
  "error": "Email already registered"
}
```

---

### 3. **Login (All User Types)**
**Endpoint:** `POST /api/auth/login`

**Request Body Examples:**
```json
// Admin Login
{
  "email": "admin@harvard.edu",
  "password": "securePassword123",
  "userType": "admin"
}

// Student Login (Email or Student ID)
{
  "email": "student@harvard.edu", // or "HARV-123456789"
  "password": "student123",
  "userType": "student"
}

// Lecturer Login (Email or Lecturer ID)
{
  "email": "lecturer@harvard.edu", // or "HARV-LEC-123456789"
  "password": "lecturer123",
  "userType": "lecturer"
}
```

**Success Response (200):**
```json
{
  "message": "Login successful",
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "admin@harvard.edu",
    "userType": "admin",
    "name": "John Smith",
    "avatar": "JS",
    "studentId": "HARV-123456789", // Only for students
    "lecturerId": "HARV-LEC-123456789", // Only for lecturers
    "role": "Dr", // Only for lecturers
    "institutionId": "507f1f77bcf86cd799439012",
    "universityName": "Harvard University",
    "isFirstLogin": false
  },
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

### 4. **Email Verification (Magic Link)**
**Endpoint:** `GET /api/auth/verify-email`

**Query Parameters:**
- `token` - Verification token
- `email` - User email

**Request:**
```
GET /api/auth/verify-email?token=ABC123XYZ&email=student@harvard.edu
```

**Success Response:** Returns HTML page with success message and auto-redirect.

---

### 5. **OTP Verification**
**Endpoint:** `POST /api/auth/verify-otp`

**Request Body:**
```json
{
  "email": "admin@harvard.edu",
  "code": "123456"
}
```

**Success Response (200):**
```json
{
  "message": "Email verified successfully"
}
```

---

### 6. **Password Reset Flow**

**Step 1 - Request Reset:**
```
POST /api/auth/forgot-password
{
  "email": "admin@harvard.edu",
  "userType": "admin"
}
```

**Step 2 - Reset with OTP:**
```
POST /api/auth/reset-password
{
  "email": "admin@harvard.edu",
  "code": "123456",
  "newPassword": "newSecurePassword123",
  "confirmPassword": "newSecurePassword123"
}
```

---

## 👑 Super Admin Endpoints

### 1. **Create Institution**
**Endpoint:** `POST /api/superadmin/institutions`

**Headers:**
```
X-Super-Admin-Key: andrenaline
Content-Type: application/json
```

**Request Body:**
```json
{
  "name": "Harvard University",
  "code": "HARV",
  "domain": "harvard.edu",
  "address": "Cambridge, MA, USA",
  "phone": "+1-617-495-1000",
  "email": "info@harvard.edu"
}
```

**Success Response (201):**
```json
{
  "message": "Institution created successfully",
  "institution": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Harvard University",
    "code": "HARV",
    "domain": "harvard.edu",
    "status": "active"
  }
}
```

---

### 2. **Get All Institutions**
**Endpoint:** `GET /api/superadmin/institutions`

**Headers:**
```
X-Super-Admin-Key: andrenaline
```

**Success Response (200):**
```json
{
  "institutions": [
    {
      "id": "507f1f77bcf86cd799439011",
      "name": "Harvard University",
      "code": "HARV",
      "domain": "harvard.edu",
      "status": "active",
      "adminCount": 3,
      "studentCount": 150,
      "lecturerCount": 25,
      "createdAt": "2026-01-17T10:30:00.000Z"
    }
  ],
  "total": 1
}
```

---

## 👨‍💼 Admin Endpoints

### 1. **Create Student Account**
**Endpoint:** `POST /api/admin/students`

**Headers:**
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "firstName": "Sarah",
  "lastName": "Johnson",
  "email": "sarah.johnson@harvard.edu",
  "department": "Computer Science",
  "year": "Sophomore (Year 2)"
}
```

**Success Response (201):**
```json
{
  "message": "Student account created successfully. Activation email sent.",
  "student": {
    "id": "507f1f77bcf86cd799439011",
    "email": "sarah.johnson@harvard.edu",
    "studentId": "HARV-123456789",
    "firstName": "Sarah",
    "lastName": "Johnson",
    "department": "Computer Science",
    "year": "Sophomore (Year 2)",
    "status": "pending",
    "defaultPassword": "sarah123"
  }
}
```

---

### 2. **Create Lecturer Account**
**Endpoint:** `POST /api/admin/lecturers`

**Headers:**
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body:**
```json
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

**Success Response (201):**
```json
{
  "message": "Lecturer account created successfully. Activation email sent.",
  "lecturer": {
    "id": "507f1f77bcf86cd799439011",
    "email": "john.smith@harvard.edu",
    "lecturerId": "HARV-LEC-123456789",
    "firstName": "John",
    "lastName": "Smith",
    "department": "Computer Science",
    "role": "Dr",
    "specialization": "Machine Learning",
    "status": "pending",
    "defaultPassword": "john123"
  }
}
```

---

### 3. **Get Students/Lecturers**
```
GET /api/admin/students
GET /api/admin/lecturers
Authorization: Bearer <admin_token>
```

**Response:** List of students/lecturers for the admin's institution.

---

## � User Management Endpoints

### 1. **Get User Profile**
**Endpoint:** `GET /api/users/profile`

**Headers:**
```
Authorization: Bearer <user_token>
```

**Success Response (200):**
```json
{
  "id": "507f1f77bcf86cd799439011",
  "email": "sarah.johnson@harvard.edu",
  "userType": "student",
  "status": "active",
  "profile": {
    "firstName": "Sarah",
    "lastName": "Johnson",
    "studentId": "HARV-123456789",
    "department": "Computer Science",
    "year": "Sophomore (Year 2)",
    "avatar": "SJ",
    "phone": "+1234567890",
    "universityName": "Harvard University"
  }
}
```

---

### 2. **Update Profile**
**Endpoint:** `PUT /api/users/profile`

**Headers:**
```
Authorization: Bearer <user_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "firstName": "Sarah",
  "lastName": "Johnson",
  "phone": "+1234567890",
  "address": "123 New Address",
  "department": "Computer Science"
}
```

---

### 3. **Change Password**
**Endpoint:** `PUT /api/users/change-password`

**Headers:**
```
Authorization: Bearer <user_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "currentPassword": "oldPassword123",
  "newPassword": "newSecurePassword456!",
  "confirmPassword": "newSecurePassword456!"
}
```

**Success Response (200):**
```json
{
  "message": "Password changed successfully"
}
```

**Error Responses:**
```json
// Wrong current password (400)
{
  "error": "The current password you entered is incorrect. Please check and try again.",
  "field": "currentPassword"
}

// Password reuse (400)
{
  "error": "You cannot reuse a recent password. Please choose a different password that you haven't used before.",
  "field": "newPassword"
}
```

---

### 4. **Dashboard Statistics** (Admin Only)
**Endpoint:** `GET /api/users/dashboard-stats`

**Headers:**
```
Authorization: Bearer <admin_token>
```

**Success Response (200):**
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
  },
  "generatedAt": "2026-01-17T19:30:00.000Z"
}
```

---

### 5. **Other User Endpoints**
```
PUT /api/users/avatar          # Update avatar
POST /api/users/logout         # Logout user
POST /api/auth/refresh-token   # Refresh JWT token
POST /api/auth/resend-otp      # Resend OTP code
```

---

## 🚨 Common Error Responses

### Authentication Errors
```json
// Missing token (401)
{
  "error": "Access token required"
}

// Invalid token (401)
{
  "error": "Invalid or expired token"
}

// Insufficient permissions (403)
{
  "error": "Access denied. Admin privileges required."
}
```

### Validation Errors
```json
// Field validation (400)
{
  "error": "Validation error",
  "details": [
    {
      "field": "email",
      "message": "Invalid email format"
    },
    {
      "field": "password",
      "message": "Password must be at least 8 characters"
    }
  ]
}
```

---

## 🔑 Authentication Flow

1. **Super Admin** creates institution → `POST /api/superadmin/institutions`
2. **Admin Registration** → `POST /api/auth/admin/register` → OTP verification
3. **Admin Login** → `POST /api/auth/login` → Get JWT tokens
4. **Create Users** → `POST /api/admin/students` or `/api/admin/lecturers`
5. **Email Verification** → Users click magic link → Account activated
6. **User Login** → `POST /api/auth/login` → First login requires password change
7. **Normal Usage** → Use JWT tokens for all protected endpoints

---

## 📋 Quick Reference

### User Types & Login Options:
- **Admin:** Email only
- **Student:** Email OR Student ID (`HARV-123456789`)
- **Lecturer:** Email OR Lecturer ID (`HARV-LEC-123456789`)

### Default Passwords:
- **Format:** `firstName123` (lowercase)
- **Example:** John Smith → `john123`

### Security Features:
- ✅ Magic link email verification (24-hour expiry)
- ✅ Password history tracking (last 5 passwords)
- ✅ First login password change requirement
- ✅ JWT token authentication
- ✅ Role-based access control

### ID Formats:
- **Student:** `{INSTITUTION}-{TIMESTAMP}{RANDOM}` → `HARV-123456789`
- **Lecturer:** `{INSTITUTION}-LEC-{TIMESTAMP}{RANDOM}` → `HARV-LEC-123456789`

---

## ✅ Complete API Reference

This covers all **27 endpoints** with request/response examples. Use this as your comprehensive API reference for development and testing! 🚀