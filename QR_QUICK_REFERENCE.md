# QR Code System - Quick Reference Card

## 🚀 Quick Start

### Student: Generate QR Code
```bash
GET http://localhost:8000/api/qr/generate
Authorization: Bearer <student_token>

Response: { "qrData": "eyJhbGc..." }
```

### Lecturer: Scan QR Code
```bash
POST http://localhost:8000/api/qr/scan-attendance
Authorization: Bearer <lecturer_token>
Content-Type: application/json

Body: {
  "qrData": "eyJhbGc...",
  "purpose": "Class Attendance",
  "location": "Room 101"
}

Response: { "student": { "name": "John Doe", ... } }
```

---

## 📱 Frontend Libraries

### Generate QR (Student)
```bash
npm install react-qr-code
```

```tsx
import QRCode from 'react-qr-code';
<QRCode value={qrData} size={256} />
```

### Scan QR (Lecturer)
```bash
npm install html5-qrcode
```

```tsx
import { Html5QrcodeScanner } from 'html5-qrcode';
const scanner = new Html5QrcodeScanner("reader", { fps: 10 });
scanner.render(onScanSuccess);
```

---

## 🔐 Security

- ✅ QR codes expire in **5 minutes**
- ✅ JWT signed tokens (cannot be forged)
- ✅ Institution validation (same institution only)
- ✅ Role-based access control

---

## 📊 All Endpoints

| Endpoint | Who | What |
|----------|-----|------|
| `GET /api/qr/generate` | Student/Lecturer | Get QR data |
| `POST /api/qr/verify` | Lecturer/Admin | Verify only |
| `POST /api/qr/scan-attendance` | Lecturer/Admin | Verify + Record |
| `GET /api/qr/attendance/student/:id` | Lecturer/Admin | View history |
| `GET /api/qr/attendance/my-history` | Student | My history |

---

## ✅ Testing Checklist

- [ ] Student can generate QR code
- [ ] QR code displays correctly
- [ ] Lecturer can scan QR code
- [ ] Student info appears after scan
- [ ] Attendance is recorded
- [ ] Student can view their history
- [ ] Lecturer can view student history
- [ ] QR expires after 5 minutes
- [ ] Cross-institution scanning blocked

---

## 🎯 User Flows

**Student:**
Login → Generate QR → Show to Lecturer → View History

**Lecturer:**
Login → Scan QR → See Student Info → Attendance Marked

---

## 📝 Response Examples

### Generate QR
```json
{
  "qrData": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "5 minutes",
  "userInfo": {
    "name": "John Doe",
    "userType": "student",
    "id": "HARV-123456789"
  }
}
```

### Scan Attendance
```json
{
  "message": "Attendance marked successfully",
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
  "scannedAt": "2026-02-19T10:30:00.000Z"
}
```

---

## 🚨 Common Errors

**"Invalid or expired QR code"**
→ QR code expired (5 min limit). Generate new one.

**"Cannot verify QR code from a different institution"**
→ Scanner and student are from different institutions.

**"Students cannot verify QR codes"**
→ Only lecturers/admins can scan.

**"Admins cannot generate QR codes"**
→ Only students/lecturers can generate.

---

## 🎉 That's It!

Simple, secure, and ready to use! 🚀
