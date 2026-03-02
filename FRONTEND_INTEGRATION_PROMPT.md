# Frontend Integration Prompt - QR Code Student ID System

## 🎯 Project Overview

Build a React application for a QR code-based student ID system. The backend API is already complete and running at `http://localhost:8000`.

---

## 📱 Required Features

### 1. STUDENT DASHBOARD

**QR Code Display Page:**
- Generate QR code on page load (call API once)
- Display QR code with user's initials/avatar in the center
- QR code is valid for 24 hours (no auto-refresh needed)
- Show student information below QR code:
  - Name
  - Student ID
  - Department
  - Year
  - Institution name
- Add manual "Regenerate QR" button (optional)
- "View My Attendance History" button

**My Attendance History Page:**
- List of all attendance records
- Show: Date, Time, Purpose, Location, Scanned by (lecturer name)
- Pagination (20 records per page)
- Filter by date range (optional)

### 2. LECTURER/ADMIN DASHBOARD

**QR Scanner Page:**
- Camera-based QR code scanner
- "Start Scanning" button to activate camera
- Real-time scanning (no manual capture needed)
- After successful scan, display:
  - Student photo/avatar
  - Student name
  - Student ID
  - Department
  - Year
  - Status (active/pending)
- Form fields:
  - Purpose (dropdown: Class Attendance, Event Check-in, ID Verification)
  - Location (text input)
  - Notes (optional textarea)
- "Mark Attendance" button
- "Scan Another" button after marking
- Success/error messages with animations

**View Student History Page:**
- Search bar (search by student ID)
- Display student info card
- List of attendance records
- Pagination
- Export to CSV button (optional)

---

## 🔧 Technical Requirements

### Libraries to Install:

```bash
npm install react-qr-code          # For generating QR codes
npm install html5-qrcode           # For scanning QR codes
npm install axios                  # For API calls
npm install react-router-dom       # For routing
npm install date-fns               # For date formatting
```

### API Base URL:
```javascript
const API_BASE_URL = 'http://localhost:8000';
```

### Authentication:
All API requests require JWT token in header:
```javascript
headers: {
  'Authorization': `Bearer ${accessToken}`
}
```

Store tokens in `localStorage`:
- `accessToken` - For API authentication
- `refreshToken` - For token refresh

---

## 📡 API Endpoints

### Student Endpoints:

**1. Generate QR Code**
```
GET /api/qr/generate
Headers: Authorization: Bearer <token>

Response:
{
  "qrData": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24 hours",
  "userInfo": {
    "name": "John Doe",
    "firstName": "John",
    "lastName": "Doe",
    "userType": "student",
    "id": "HARV-123456789",
    "avatar": "JD",              // Initials for QR overlay
    "department": "Computer Science",
    "year": "3rd Year",
    "institutionName": "Harvard University"
  }
}
```

**2. Get My Attendance History**
```
GET /api/qr/attendance/my-history?page=1&limit=20
Headers: Authorization: Bearer <token>

Response:
{
  "attendance": [
    {
      "id": "507f1f77bcf86cd799439013",
      "purpose": "Class Attendance",
      "location": "Room 101",
      "notes": "CS101",
      "scannedBy": {
        "name": "Prof. Jane Smith",
        "userType": "lecturer"
      },
      "scannedAt": "2026-02-19T10:30:00.000Z"
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

### Lecturer/Admin Endpoints:

**3. Scan and Mark Attendance**
```
POST /api/qr/scan-attendance
Headers: 
  Authorization: Bearer <token>
  Content-Type: application/json

Body:
{
  "qrData": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "purpose": "Class Attendance",
  "location": "Room 101",
  "notes": "CS101 - Introduction to Programming"
}

Response:
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

**4. View Student Attendance History**
```
GET /api/qr/attendance/student/:studentId?page=1&limit=20
Headers: Authorization: Bearer <token>

Response:
{
  "student": {
    "studentId": "HARV-123456789",
    "name": "John Doe",
    "department": "Computer Science",
    "year": "3rd Year"
  },
  "attendance": [...],
  "pagination": {...}
}
```

---

## 🎨 QR Code with Avatar/Initials Overlay

**IMPORTANT:** The QR code should display the user's initials (avatar) in the center.

### Implementation:

```jsx
import QRCode from 'react-qr-code';

function StudentQRCode({ qrData, avatar, name }) {
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {/* QR Code */}
      <QRCode 
        value={qrData} 
        size={256}
        level="H"  // High error correction (allows logo/avatar overlay)
      />
      
      {/* Avatar/Initials Overlay */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '60px',
        height: '60px',
        backgroundColor: 'white',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px',
        fontWeight: 'bold',
        color: '#007bff',
        border: '3px solid white',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
      }}>
        {avatar}  {/* e.g., "JD" for John Doe */}
      </div>
    </div>
  );
}
```

**Alternative:** If user has a profile picture, use `<img>` instead of text initials.

---

## 🎨 UI/UX Design Guidelines

### Color Scheme:
- Primary: #007bff (Blue)
- Success: #28a745 (Green)
- Error: #dc3545 (Red)
- Background: #f8f9fa (Light Gray)
- Text: #333333 (Dark Gray)

### Layout:

**Student QR Page:**
```
┌─────────────────────────────────┐
│         My Student ID           │
│                                 │
│     ┌─────────────────┐         │
│     │                 │         │
│     │    [QR CODE]    │         │
│     │    with "JD"    │         │
│     │   in center     │         │
│     │                 │         │
│     └─────────────────┘         │
│                                 │
│     John Doe                    │
│     HARV-123456789              │
│     Computer Science            │
│     3rd Year                    │
│     Harvard University          │
│                                 │
│     Valid for 24 hours          │
│                                 │
│  [Regenerate QR] [My History]   │
└─────────────────────────────────┘
```

**Lecturer Scanner Page:**
```
┌─────────────────────────────────┐
│      Scan Student QR Code       │
│                                 │
│     ┌─────────────────┐         │
│     │                 │         │
│     │   [CAMERA       │         │
│     │    VIEWFINDER]  │         │
│     │                 │         │
│     └─────────────────┘         │
│                                 │
│   [Start Scanning]              │
│                                 │
│   After successful scan:        │
│   ┌─────────────────────────┐   │
│   │ ✓ John Doe              │   │
│   │   HARV-123456789        │   │
│   │   CS - 3rd Year         │   │
│   └─────────────────────────┘   │
│                                 │
│   Purpose: [Class Attendance▼]  │
│   Location: [Room 101      ]    │
│   Notes: [Optional...      ]    │
│                                 │
│   [Mark Attendance]             │
│   [Scan Another]                │
└─────────────────────────────────┘
```

---

## 🔄 User Flows

### Student Flow:
1. Login → Dashboard
2. Click "My QR Code"
3. QR code generates and displays (with initials in center)
4. Show QR to lecturer
5. View "My Attendance History" anytime

### Lecturer Flow:
1. Login → Dashboard
2. Click "Scan QR Code"
3. Click "Start Scanning" (camera activates)
4. Point camera at student's QR code
5. Student info appears automatically
6. Fill in Purpose, Location, Notes
7. Click "Mark Attendance"
8. Success message → "Scan Another" or "Done"

---

## ⚠️ Error Handling

### Common Errors:

**1. Expired QR Code:**
```json
{
  "error": "Invalid or expired QR code",
  "message": "This QR code has expired (24 hours). Please generate a new one."
}
```
**Action:** Show error message, prompt to regenerate QR

**2. Camera Permission Denied:**
```
Error: NotAllowedError: Permission denied
```
**Action:** Show instructions to enable camera in browser settings

**3. Network Error:**
```
Error: Network request failed
```
**Action:** Show "Connection lost" message with retry button

**4. Invalid Token:**
```json
{
  "error": "Invalid or expired token"
}
```
**Action:** Redirect to login page

---

## 📱 Responsive Design

- **Mobile First:** Design for mobile screens first
- **Breakpoints:**
  - Mobile: < 768px
  - Tablet: 768px - 1024px
  - Desktop: > 1024px
- **QR Code Size:**
  - Mobile: 200px
  - Tablet: 256px
  - Desktop: 300px
- **Scanner:**
  - Full width on mobile
  - Centered with max-width on desktop

---

## ✨ Additional Features (Optional)

1. **Dark Mode** - Toggle between light/dark themes
2. **Sound Feedback** - Beep on successful scan
3. **Vibration** - Haptic feedback on mobile
4. **Export CSV** - Download attendance history
5. **Date Filter** - Filter attendance by date range
6. **Statistics** - Show attendance percentage/charts
7. **Offline Mode** - Cache QR code for offline display
8. **Print QR** - Print student ID card with QR code

---

## 🧪 Testing Checklist

- [ ] Student can generate QR code
- [ ] QR code displays with initials/avatar in center
- [ ] QR code doesn't auto-refresh
- [ ] Lecturer can scan QR code
- [ ] Student info displays after scan
- [ ] Attendance is marked successfully
- [ ] Student can view their history
- [ ] Lecturer can view any student's history
- [ ] Pagination works correctly
- [ ] Error messages display properly
- [ ] Mobile responsive
- [ ] Camera permissions handled
- [ ] Token expiration handled

---

## 📦 Project Structure

```
src/
├── components/
│   ├── student/
│   │   ├── QRCodeDisplay.jsx
│   │   └── AttendanceHistory.jsx
│   ├── lecturer/
│   │   ├── QRScanner.jsx
│   │   └── StudentHistory.jsx
│   └── shared/
│       ├── Navbar.jsx
│       └── LoadingSpinner.jsx
├── services/
│   ├── api.js              # Axios instance
│   ├── qrService.js        # QR API calls
│   └── authService.js      # Auth API calls
├── contexts/
│   └── AuthContext.jsx     # Auth state management
├── pages/
│   ├── StudentDashboard.jsx
│   ├── LecturerDashboard.jsx
│   └── Login.jsx
└── App.jsx
```

---

## 🚀 Getting Started

1. Install dependencies
2. Set up API base URL
3. Implement authentication
4. Build student QR display component
5. Build lecturer scanner component
6. Test end-to-end flow
7. Add styling and polish

---

## 📝 Notes

- QR codes are valid for **24 hours** (not 5 minutes)
- **No auto-refresh** needed - generate once per day
- **Avatar/initials must be in QR center** for branding
- Use **high error correction level** (H) for QR codes to allow logo overlay
- Handle **camera permissions** gracefully
- Implement **loading states** for all API calls
- Add **success animations** for better UX

---

## 🎯 Priority Order

1. **High Priority:**
   - Student QR display with avatar overlay
   - Lecturer QR scanner
   - Mark attendance functionality
   - Basic error handling

2. **Medium Priority:**
   - Attendance history pages
   - Pagination
   - Responsive design
   - Loading states

3. **Low Priority:**
   - Dark mode
   - Export CSV
   - Statistics
   - Advanced filters

---

Good luck! Build something amazing! 🚀
