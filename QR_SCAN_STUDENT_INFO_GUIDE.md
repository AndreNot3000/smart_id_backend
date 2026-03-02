# QR Code Scanning - Get Student Information

This guide explains how lecturers can scan student QR codes to view their information (without marking attendance).

---

## 📋 Overview

Lecturers and admins can scan student/lecturer QR codes to instantly view their profile information. This is useful for:
- Verifying student identity
- Checking student details during office hours
- Quick profile lookup without marking attendance
- Verifying lecturer credentials

---

## 🔧 API Endpoint

### **Verify QR Code and Get User Information**

**Endpoint:** `POST /api/qr/verify`

**Authentication:** Required (JWT token in Authorization header)

**Permissions:** Only lecturers and admins (students cannot use this endpoint)

---

## 📤 Request Format

### Headers
```
Authorization: Bearer <lecturer_or_admin_jwt_token>
Content-Type: application/json
```

### Request Body
```json
{
  "qrData": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "purpose": "Identity Verification",
  "location": "Office 301",
  "notes": "Optional notes"
}
```

### Parameters
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `qrData` | string | ✅ Yes | The JWT token from the scanned QR code |
| `purpose` | string | ❌ No | Purpose of scanning (e.g., "Identity Check") |
| `location` | string | ❌ No | Location where scan occurred |
| `notes` | string | ❌ No | Additional notes |

---

## 📥 Response Format

### Success Response (200 OK)

#### For Student QR Code:
```json
{
  "message": "QR code verified successfully",
  "verified": true,
  "userType": "student",
  "userInfo": {
    "studentId": "HARV-123456789",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@university.edu",
    "department": "Computer Science",
    "year": "3rd Year",
    "avatar": "JD",
    "institutionName": "Harvard University",
    "status": "active",
    "emailVerified": true
  },
  "scannedBy": {
    "userId": "507f1f77bcf86cd799439011",
    "userType": "lecturer",
    "email": "prof.smith@university.edu"
  },
  "scannedAt": "2026-03-02T10:30:00.000Z"
}
```

#### For Lecturer QR Code:
```json
{
  "message": "QR code verified successfully",
  "verified": true,
  "userType": "lecturer",
  "userInfo": {
    "lecturerId": "HARV-LEC-987654321",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "jane.smith@university.edu",
    "department": "Mathematics",
    "role": "Dr",
    "specialization": "Applied Mathematics",
    "avatar": "JS",
    "institutionName": "Harvard University",
    "status": "active",
    "emailVerified": true
  },
  "scannedBy": {
    "userId": "507f1f77bcf86cd799439011",
    "userType": "admin",
    "email": "admin@university.edu"
  },
  "scannedAt": "2026-03-02T10:30:00.000Z"
}
```

---

## ❌ Error Responses

### 1. Student Trying to Scan (403 Forbidden)
```json
{
  "error": "Students cannot verify QR codes. Only lecturers and admins."
}
```

### 2. Invalid QR Code (400 Bad Request)
```json
{
  "error": "Invalid QR code",
  "message": "This QR code is invalid or corrupted."
}
```

### 3. Different Institution (403 Forbidden)
```json
{
  "error": "Cannot verify QR code from a different institution"
}
```

### 4. Missing Authentication (401 Unauthorized)
```json
{
  "error": "Unauthorized"
}
```

### 5. Validation Error (400 Bad Request)
```json
{
  "error": "Validation error",
  "details": [
    {
      "field": "qrData",
      "message": "QR code data is required"
    }
  ]
}
```

---

## 🎨 Frontend Implementation Guide

### Step 1: QR Code Scanner Component

```typescript
import { useState } from 'react';
import { QrReader } from 'react-qr-reader'; // or any QR scanner library

interface StudentInfo {
  studentId: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  year: string;
  avatar: string;
  institutionName: string;
  status: string;
  emailVerified: boolean;
}

interface LecturerInfo {
  lecturerId: string;
  firstName: string;
  lastName: string;
  email: string;
  department: string;
  role: string;
  specialization: string;
  avatar: string;
  institutionName: string;
  status: string;
  emailVerified: boolean;
}

const QRScanner = () => {
  const [scanning, setScanning] = useState(false);
  const [userInfo, setUserInfo] = useState<StudentInfo | LecturerInfo | null>(null);
  const [userType, setUserType] = useState<'student' | 'lecturer' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleScan = async (qrData: string) => {
    if (!qrData || loading) return;

    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('accessToken'); // Get JWT token

      const response = await fetch('http://localhost:8000/api/qr/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          qrData: qrData,
          purpose: 'Identity Verification',
          location: 'Office', // Optional
          notes: '' // Optional
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify QR code');
      }

      // Success - display user information
      setUserInfo(data.userInfo);
      setUserType(data.userType);
      setScanning(false);

    } catch (err: any) {
      setError(err.message);
      console.error('QR Scan Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleError = (err: any) => {
    console.error('QR Scanner Error:', err);
    setError('Failed to access camera. Please check permissions.');
  };

  return (
    <div className="qr-scanner-container">
      {!scanning && !userInfo && (
        <button onClick={() => setScanning(true)}>
          Scan Student QR Code
        </button>
      )}

      {scanning && (
        <div className="scanner-view">
          <QrReader
            onResult={(result, error) => {
              if (result) {
                handleScan(result.getText());
              }
              if (error) {
                handleError(error);
              }
            }}
            constraints={{ facingMode: 'environment' }}
            className="qr-reader"
          />
          <button onClick={() => setScanning(false)}>Cancel</button>
        </div>
      )}

      {loading && <div className="loading">Verifying QR code...</div>}

      {error && (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {userInfo && (
        <div className="user-info-card">
          {userType === 'student' ? (
            <StudentInfoDisplay info={userInfo as StudentInfo} />
          ) : (
            <LecturerInfoDisplay info={userInfo as LecturerInfo} />
          )}
          <button onClick={() => {
            setUserInfo(null);
            setUserType(null);
            setScanning(true);
          }}>
            Scan Another
          </button>
        </div>
      )}
    </div>
  );
};
```

### Step 2: Student Info Display Component

```typescript
const StudentInfoDisplay = ({ info }: { info: StudentInfo }) => {
  return (
    <div className="student-card">
      <div className="card-header">
        <div className="avatar">{info.avatar}</div>
        <h2>{info.firstName} {info.lastName}</h2>
        <span className={`status-badge ${info.status}`}>{info.status}</span>
      </div>

      <div className="card-body">
        <div className="info-row">
          <span className="label">Student ID:</span>
          <span className="value">{info.studentId}</span>
        </div>

        <div className="info-row">
          <span className="label">Email:</span>
          <span className="value">{info.email}</span>
        </div>

        <div className="info-row">
          <span className="label">Department:</span>
          <span className="value">{info.department}</span>
        </div>

        <div className="info-row">
          <span className="label">Year:</span>
          <span className="value">{info.year}</span>
        </div>

        <div className="info-row">
          <span className="label">Institution:</span>
          <span className="value">{info.institutionName}</span>
        </div>

        <div className="info-row">
          <span className="label">Email Verified:</span>
          <span className={`badge ${info.emailVerified ? 'verified' : 'unverified'}`}>
            {info.emailVerified ? '✓ Verified' : '✗ Not Verified'}
          </span>
        </div>
      </div>
    </div>
  );
};
```

### Step 3: Lecturer Info Display Component

```typescript
const LecturerInfoDisplay = ({ info }: { info: LecturerInfo }) => {
  return (
    <div className="lecturer-card">
      <div className="card-header">
        <div className="avatar">{info.avatar}</div>
        <h2>{info.role} {info.firstName} {info.lastName}</h2>
        <span className={`status-badge ${info.status}`}>{info.status}</span>
      </div>

      <div className="card-body">
        <div className="info-row">
          <span className="label">Lecturer ID:</span>
          <span className="value">{info.lecturerId}</span>
        </div>

        <div className="info-row">
          <span className="label">Email:</span>
          <span className="value">{info.email}</span>
        </div>

        <div className="info-row">
          <span className="label">Department:</span>
          <span className="value">{info.department}</span>
        </div>

        <div className="info-row">
          <span className="label">Role:</span>
          <span className="value">{info.role}</span>
        </div>

        <div className="info-row">
          <span className="label">Specialization:</span>
          <span className="value">{info.specialization || 'N/A'}</span>
        </div>

        <div className="info-row">
          <span className="label">Institution:</span>
          <span className="value">{info.institutionName}</span>
        </div>

        <div className="info-row">
          <span className="label">Email Verified:</span>
          <span className={`badge ${info.emailVerified ? 'verified' : 'unverified'}`}>
            {info.emailVerified ? '✓ Verified' : '✗ Not Verified'}
          </span>
        </div>
      </div>
    </div>
  );
};
```

---

## 🎯 Key Features

1. **Instant Verification**: Get student/lecturer info immediately after scanning
2. **Institution Security**: Can only scan QR codes from the same institution
3. **No Attendance**: This endpoint does NOT mark attendance (use `/api/qr/scan-attendance` for that)
4. **Permanent QR Codes**: QR codes never expire, so they work indefinitely
5. **Role-Based Access**: Only lecturers and admins can scan (students cannot)

---

## 🔒 Security Notes

- QR codes are institution-specific (cannot scan codes from other institutions)
- JWT authentication required for all requests
- Students cannot use this endpoint (403 error)
- QR codes are permanent but can be invalidated if user account is deactivated

---

## 📱 Recommended QR Scanner Libraries

### React
- `react-qr-reader` - Simple and reliable
- `html5-qrcode` - Feature-rich with fallback options
- `react-qr-scanner` - Lightweight alternative

### Installation
```bash
npm install react-qr-reader
# or
npm install html5-qrcode
```

---

## 🧪 Testing

### Test with Postman/Thunder Client

1. **Login as lecturer** to get JWT token
2. **Generate student QR code** (login as student, call `/api/qr/generate`)
3. **Copy the qrData** from the generate response
4. **Call verify endpoint** with the qrData

```bash
POST http://localhost:8000/api/qr/verify
Authorization: Bearer <lecturer_token>
Content-Type: application/json

{
  "qrData": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

## 💡 Use Cases

1. **Office Hours**: Verify student identity during consultations
2. **Lab Access**: Check student credentials before granting access
3. **Event Check-in**: Verify attendees without marking formal attendance
4. **ID Verification**: Quick lookup of student/lecturer information
5. **Security Checks**: Verify institutional affiliation

---

## 🆚 Difference from Attendance Scanning

| Feature | `/api/qr/verify` | `/api/qr/scan-attendance` |
|---------|------------------|---------------------------|
| Purpose | Get information only | Mark attendance + get info |
| Database Record | No record created | Creates attendance record |
| Use Case | Identity verification | Class/event attendance |
| Response | User info only | User info + attendance ID |

---

## 📞 Support

For issues or questions, contact the backend team or check the main API documentation.
