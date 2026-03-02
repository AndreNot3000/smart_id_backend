# QR Code System API Guide

## 🎯 Overview

The QR code system allows students and lecturers to generate unique QR codes that can be scanned by lecturers and admins for identification and attendance tracking.

## 🔐 Security Features

- **JWT-based tokens** - QR codes contain signed JWT tokens (cannot be forged)
- **5-minute expiration** - Tokens expire quickly to prevent screenshot sharing
- **Institution validation** - Can only scan QR codes from same institution
- **Role-based access** - Students generate, Lecturers/Admins scan

---

## 📱 API Endpoints

### 1. Generate QR Code (Student/Lecturer)

**Endpoint:** `GET /api/qr/generate`

**Authentication:** Required (Student or Lecturer only)

**Headers:**
```
Authorization: Bearer <access_token>
```

**Response:**
```json
{
  "message": "QR code generated successfully",
  "qrData": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "5 minutes",
  "userInfo": {
    "name": "John Doe",
    "userType": "student",
    "id": "HARV-123456789"
  },
  "instructions": "Display this QR code to be scanned by a lecturer or admin"
}
```

**Frontend Integration:**
```typescript
// Fetch QR data
const response = await fetch('http://localhost:8000/api/qr/generate', {
  headers: {
    'Authorization': `Bearer ${accessToken}`
  }
});

const { qrData } = await response.json();

// Display QR code using a library
import QRCode from 'react-qr-code';

<QRCode value={qrData} size={256} />
```

**Recommended QR Libraries:**
- React: `react-qr-code` or `qrcode.react`
- Vue: `qrcode.vue`
- Angular: `angularx-qrcode`
- Vanilla JS: `qrcode` (npm package)

---

### 2. Verify QR Code (Lecturer/Admin)

**Endpoint:** `POST /api/qr/verify`

**Authentication:** Required (Lecturer or Admin only)

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "qrData": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "purpose": "ID Verification",
  "location": "Room 101",
  "notes": "Optional notes"
}
```

**Response (Student):**
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
  "scannedAt": "2026-02-19T10:30:00.000Z"
}
```

**Response (Lecturer):**
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
    "userId": "507f1f77bcf86cd799439012",
    "userType": "admin",
    "email": "admin@university.edu"
  },
  "scannedAt": "2026-02-19T10:30:00.000Z"
}
```

**Frontend Integration:**
```typescript
// Scan QR code using camera
import { Html5QrcodeScanner } from 'html5-qrcode';

const scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: 250 });

scanner.render(async (decodedText) => {
  // Send to backend for verification
  const response = await fetch('http://localhost:8000/api/qr/verify', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${lecturerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      qrData: decodedText,
      purpose: 'ID Verification',
      location: 'Main Hall'
    })
  });

  const result = await response.json();
  
  if (result.verified) {
    // Display student/lecturer information
    console.log('User Info:', result.userInfo);
  }
});
```

**Recommended Scanner Libraries:**
- React: `html5-qrcode-react` or `react-qr-reader`
- Vue: `vue-qrcode-reader`
- Angular: `@zxing/ngx-scanner`
- Vanilla JS: `html5-qrcode`

---

### 3. Scan and Mark Attendance (Lecturer/Admin)

**Endpoint:** `POST /api/qr/scan-attendance`

**Authentication:** Required (Lecturer or Admin only)

**Headers:**
```
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "qrData": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "purpose": "Class Attendance",
  "location": "Room 101",
  "notes": "CS101 - Introduction to Programming"
}
```

**Response:**
```json
{
  "message": "Attendance marked successfully",
  "attendanceId": "507f1f77bcf86cd799439013",
  "student": {
    "studentId": "HARV-123456789",
    "name": "John Doe",
    "department": "Computer Science",
    "year": "3rd Year"
  },
  "scannedBy": {
    "name": "Prof. Jane Smith",
    "userType": "lecturer"
  },
  "purpose": "Class Attendance",
  "location": "Room 101",
  "scannedAt": "2026-02-19T10:30:00.000Z"
}
```

**Error Response (Expired QR):**
```json
{
  "error": "Invalid or expired QR code",
  "message": "This QR code has expired or is invalid. Please ask the student to generate a new one."
}
```

---

### 4. Get Student Attendance History (Lecturer/Admin)

**Endpoint:** `GET /api/qr/attendance/student/:studentId`

**Authentication:** Required (Lecturer or Admin only)

**Headers:**
```
Authorization: Bearer <access_token>
```

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Records per page (default: 20, max: 100)

**Example:**
```
GET /api/qr/attendance/student/HARV-123456789?page=1&limit=20
```

**Response:**
```json
{
  "student": {
    "studentId": "HARV-123456789",
    "name": "John Doe",
    "department": "Computer Science",
    "year": "3rd Year"
  },
  "attendance": [
    {
      "id": "507f1f77bcf86cd799439013",
      "purpose": "Class Attendance",
      "location": "Room 101",
      "notes": "CS101 - Introduction to Programming",
      "scannedBy": {
        "name": "Prof. Jane Smith",
        "userType": "lecturer"
      },
      "scannedAt": "2026-02-19T10:30:00.000Z"
    },
    {
      "id": "507f1f77bcf86cd799439014",
      "purpose": "Event Check-in",
      "location": "Main Hall",
      "notes": "Tech Conference 2026",
      "scannedBy": {
        "name": "Admin User",
        "userType": "admin"
      },
      "scannedAt": "2026-02-18T14:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3,
    "hasMore": true
  }
}
```

---

### 5. Get My Attendance History (Student)

**Endpoint:** `GET /api/qr/attendance/my-history`

**Authentication:** Required (Student only)

**Headers:**
```
Authorization: Bearer <access_token>
```

**Query Parameters:**
- `page` (optional) - Page number (default: 1)
- `limit` (optional) - Records per page (default: 20, max: 100)

**Example:**
```
GET /api/qr/attendance/my-history?page=1&limit=10
```

**Response:**
```json
{
  "attendance": [
    {
      "id": "507f1f77bcf86cd799439013",
      "purpose": "Class Attendance",
      "location": "Room 101",
      "notes": "CS101 - Introduction to Programming",
      "scannedBy": {
        "name": "Prof. Jane Smith",
        "userType": "lecturer"
      },
      "scannedAt": "2026-02-19T10:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "totalPages": 5,
    "hasMore": true
  }
}
```

---

## 🔄 Complete User Flow

### Student Flow:

1. **Login** → `POST /api/auth/login`
2. **Generate QR Code** → `GET /api/qr/generate`
3. **Display QR Code** → Show on screen using QR library
4. **View My Attendance** → `GET /api/qr/attendance/my-history`

### Lecturer/Admin Flow:

1. **Login** → `POST /api/auth/login`
2. **Scan QR Code** → Use camera to scan
3. **Verify QR Code** → `POST /api/qr/verify` (just view info)
   OR
4. **Mark Attendance** → `POST /api/qr/scan-attendance` (record attendance)
5. **View Student History** → `GET /api/qr/attendance/student/:studentId`

---

## 🎨 Frontend Implementation Example

### React Component (Student - Generate QR)

```tsx
import React, { useState, useEffect } from 'react';
import QRCode from 'react-qr-code';

function StudentQRCode() {
  const [qrData, setQrData] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateQR = async () => {
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('http://localhost:8000/api/qr/generate', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`
        }
      });

      if (!response.ok) throw new Error('Failed to generate QR code');

      const data = await response.json();
      setQrData(data.qrData);
      
      // Auto-refresh every 4 minutes (before 5-minute expiry)
      setTimeout(generateQR, 4 * 60 * 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    generateQR();
  }, []);

  if (loading) return <div>Generating QR Code...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div style={{ textAlign: 'center', padding: '20px' }}>
      <h2>My Student ID QR Code</h2>
      <p>Show this to your lecturer or admin</p>
      {qrData && (
        <div style={{ background: 'white', padding: '20px', display: 'inline-block' }}>
          <QRCode value={qrData} size={256} />
        </div>
      )}
      <p style={{ color: '#666', fontSize: '14px', marginTop: '10px' }}>
        QR code refreshes automatically every 4 minutes
      </p>
    </div>
  );
}

export default StudentQRCode;
```

### React Component (Lecturer - Scan QR)

```tsx
import React, { useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

function LecturerScanner() {
  const [scanning, setScanning] = useState(false);
  const [studentInfo, setStudentInfo] = useState(null);
  const [error, setError] = useState('');

  const startScanning = () => {
    setScanning(true);
    setError('');
    
    const scanner = new Html5QrcodeScanner(
      "qr-reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      false
    );

    scanner.render(async (decodedText) => {
      scanner.clear();
      await verifyQRCode(decodedText);
    });
  };

  const verifyQRCode = async (qrData) => {
    try {
      const response = await fetch('http://localhost:8000/api/qr/scan-attendance', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          qrData,
          purpose: 'Class Attendance',
          location: 'Room 101'
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Verification failed');
      }

      const data = await response.json();
      setStudentInfo(data.student);
      setScanning(false);
    } catch (err) {
      setError(err.message);
      setScanning(false);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>Scan Student QR Code</h2>
      
      {!scanning && !studentInfo && (
        <button onClick={startScanning}>Start Scanning</button>
      )}

      {scanning && (
        <div>
          <div id="qr-reader" style={{ width: '100%' }}></div>
          <button onClick={() => setScanning(false)}>Cancel</button>
        </div>
      )}

      {error && (
        <div style={{ color: 'red', padding: '10px', background: '#fee' }}>
          {error}
        </div>
      )}

      {studentInfo && (
        <div style={{ padding: '20px', background: '#f0f0f0', borderRadius: '8px' }}>
          <h3>Attendance Marked ✓</h3>
          <p><strong>Student ID:</strong> {studentInfo.studentId}</p>
          <p><strong>Name:</strong> {studentInfo.name}</p>
          <p><strong>Department:</strong> {studentInfo.department}</p>
          <p><strong>Year:</strong> {studentInfo.year}</p>
          <button onClick={() => { setStudentInfo(null); startScanning(); }}>
            Scan Another
          </button>
        </div>
      )}
    </div>
  );
}

export default LecturerScanner;
```

---

## 🔒 Security Best Practices

1. **Always use HTTPS in production** - QR codes contain sensitive tokens
2. **Implement rate limiting** - Prevent QR code generation spam
3. **Validate institution match** - Already implemented in backend
4. **Auto-refresh QR codes** - Regenerate before expiry (every 4 minutes)
5. **Clear QR data after use** - Don't store QR tokens in localStorage
6. **Use CORS properly** - Configure allowed origins in production

---

## 📊 Database Schema

### Attendance Collection

```typescript
{
  _id: ObjectId,
  studentId: ObjectId,           // Reference to student
  scannedBy: ObjectId,            // Reference to lecturer/admin
  scannedByType: 'lecturer' | 'admin',
  courseId: ObjectId,             // Optional: for future course integration
  location: string,               // e.g., "Room 101", "Main Hall"
  purpose: string,                // e.g., "Class Attendance", "Event Check-in"
  notes: string,                  // Optional notes
  scannedAt: Date,                // When QR was scanned
  createdAt: Date
}
```

---

## 🚀 Testing the API

### Using Postman/Thunder Client:

1. **Login as Student:**
   ```
   POST http://localhost:8000/api/auth/login
   Body: { "email": "student@university.edu", "password": "password123", "userType": "student" }
   ```

2. **Generate QR Code:**
   ```
   GET http://localhost:8000/api/qr/generate
   Headers: Authorization: Bearer <student_access_token>
   ```

3. **Login as Lecturer:**
   ```
   POST http://localhost:8000/api/auth/login
   Body: { "email": "lecturer@university.edu", "password": "password123", "userType": "lecturer" }
   ```

4. **Verify QR Code:**
   ```
   POST http://localhost:8000/api/qr/verify
   Headers: Authorization: Bearer <lecturer_access_token>
   Body: { "qrData": "<qr_token_from_step_2>" }
   ```

---

## 🎉 Summary

Your QR code system is now fully functional with:

✅ Secure JWT-based QR codes
✅ 5-minute expiration for security
✅ Student/Lecturer QR generation
✅ Lecturer/Admin scanning and verification
✅ Automatic attendance tracking
✅ Attendance history for students and lecturers
✅ Institution-based access control
✅ Pagination support
✅ Complete API documentation

**Next Steps:**
1. Test the APIs using Postman
2. Integrate with your frontend using the examples above
3. Choose QR code libraries for your frontend framework
4. Implement the scanner UI for lecturers/admins
