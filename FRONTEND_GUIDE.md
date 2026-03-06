# Frontend Integration Guide

## API Base URL
```
Production: https://api.smartunivid.xyz
Development: http://localhost:8000
```

## Authentication
All requests need JWT token:
```javascript
headers: {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
}
```

---

## Profile APIs

### 1. Check Profile Completion
**GET** `/api/users/profile/completion`

**Response:**
```json
{
  "isComplete": false,
  "completionPercentage": 62,
  "missingFields": ["phone", "dateOfBirth"],
  "message": "Please complete your profile to access all features."
}
```

### 2. Get Profile
**GET** `/api/users/profile`

**Response:**
```json
{
  "id": "...",
  "email": "student@example.com",
  "userType": "student",
  "profile": {
    "firstName": "John",
    "lastName": "Doe",
    "studentId": "STU-2024-001",
    "department": "Computer Science",
    "year": "Year 2",
    "phone": "+234 801 234 5678",
    "avatar": "data:image/jpeg;base64,...",
    "universityName": "University of Lagos"
  }
}
```

### 3. Update Profile
**PUT** `/api/users/profile`

**Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+234 801 234 5678",
  "address": "Lagos, Nigeria",
  "dateOfBirth": "2000-01-15",
  "department": "Computer Science",
  "year": "Year 2"
}
```

### 4. Upload Avatar
**PUT** `/api/users/avatar`

**Body:**
```json
{
  "avatar": "data:image/jpeg;base64,..."
}
```

**Image to Base64:**
```javascript
function convertToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
```

---

## QR Code APIs

### Generate QR Code
**GET** `/api/qr/generate`

**Response:**
```json
{
  "qrCode": "data:image/png;base64,...",
  "studentId": "STU-2024-001",
  "message": "QR code generated successfully"
}
```

### Scan QR Code
**POST** `/api/qr/scan`

**Body:**
```json
{
  "qrData": "encrypted-qr-data-string"
}
```

**Response:**
```json
{
  "success": true,
  "student": {
    "studentId": "STU-2024-001",
    "name": "John Doe",
    "department": "Computer Science",
    "year": "Year 2",
    "email": "student@example.com",
    "avatar": "data:image/jpeg;base64,...",
    "universityName": "University of Lagos"
  }
}
```

---

## Required Fields

### For Students:
- firstName, lastName
- phone, dateOfBirth, address
- department, year

### Read-Only:
- studentId, email, universityName, status

---

## Error Responses

**401 Unauthorized:**
```json
{ "error": "Invalid or expired token" }
```

**404 Not Found:**
```json
{ "message": "User not found" }
```

**500 Server Error:**
```json
{ "message": "Failed to..." }
```

---

## Complete API Reference
See `API_REFERENCE.md` for all endpoints.
