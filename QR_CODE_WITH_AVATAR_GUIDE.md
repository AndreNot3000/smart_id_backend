# QR Code with Avatar - Frontend Guide

## API Response

### GET /api/qr/generate

**Response:**
```json
{
  "message": "QR code generated successfully",
  "qrData": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "never",
  "isPermanent": true,
  "userInfo": {
    "name": "Olumide Andre",
    "firstName": "Olumide",
    "lastName": "Andre",
    "userType": "student",
    "id": "STU-2024-001",
    "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..." or null,
    "department": "Computer Science",
    "year": "Year 2",
    "role": "",
    "institutionName": "University of Lagos"
  },
  "instructions": "This is your permanent ID QR code..."
}
```

---

## Frontend Implementation

### 1. Display Avatar on QR Code Overlay

```jsx
function QRCodeWithAvatar({ userInfo, qrData }) {
  const getInitials = (firstName, lastName) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  return (
    <div className="relative w-full max-w-sm mx-auto">
      {/* QR Code */}
      <div className="bg-white p-6 rounded-lg shadow-lg">
        {/* Header with Avatar */}
        <div className="flex items-center space-x-4 mb-4">
          {/* Avatar or Initials */}
          <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-gray-300">
            {userInfo.avatar ? (
              <img 
                src={userInfo.avatar} 
                alt={userInfo.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-blue-500 text-white text-xl font-bold">
                {getInitials(userInfo.firstName, userInfo.lastName)}
              </div>
            )}
          </div>

          {/* User Info */}
          <div className="flex-1">
            <h3 className="font-bold text-lg">{userInfo.name}</h3>
            <p className="text-sm text-gray-600">{userInfo.id}</p>
            <p className="text-xs text-gray-500">{userInfo.department}</p>
          </div>
        </div>

        {/* QR Code Image */}
        <div className="flex justify-center">
          <QRCodeSVG 
            value={qrData} 
            size={200}
            level="H"
            includeMargin={true}
          />
        </div>

        {/* Footer */}
        <div className="mt-4 text-center">
          <p className="text-xs text-gray-500">{userInfo.institutionName}</p>
          <p className="text-xs text-gray-400 mt-1">
            {userInfo.userType === 'student' ? userInfo.year : userInfo.role}
          </p>
        </div>
      </div>
    </div>
  );
}
```

---

### 2. Digital ID Card Component

```jsx
'use client';

import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function DigitalIDCard() {
  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchQRCode();
  }, []);

  const fetchQRCode = async () => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch('https://api.smartunivid.xyz/api/qr/generate', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (response.ok) {
        setQrData(data);
      } else {
        setError(data.error || 'Failed to generate QR code');
      }
    } catch (err) {
      setError('Failed to load QR code');
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (firstName, lastName) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  if (loading) {
    return <div className="text-center py-8">Loading your ID card...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-red-600">{error}</div>;
  }

  if (!qrData) {
    return null;
  }

  const { userInfo, qrData: qrToken } = qrData;

  return (
    <div className="max-w-md mx-auto">
      {/* ID Card */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-sm px-6 py-4">
          <h2 className="text-white text-center font-bold text-lg">
            {userInfo.institutionName}
          </h2>
          <p className="text-white/80 text-center text-sm">
            {userInfo.userType === 'student' ? 'Student ID Card' : 'Lecturer ID Card'}
          </p>
        </div>

        {/* Main Content */}
        <div className="p-6">
          {/* Profile Section */}
          <div className="flex items-center space-x-4 mb-6">
            {/* Avatar */}
            <div className="w-20 h-20 rounded-lg overflow-hidden border-4 border-white/20 bg-white/10">
              {userInfo.avatar ? (
                <img 
                  src={userInfo.avatar} 
                  alt={userInfo.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-white text-2xl font-bold">
                  {getInitials(userInfo.firstName, userInfo.lastName)}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1">
              <h3 className="text-white font-bold text-xl">{userInfo.name}</h3>
              <p className="text-white/90 text-sm font-mono">{userInfo.id}</p>
              <p className="text-white/70 text-sm">{userInfo.department}</p>
              {userInfo.year && (
                <p className="text-white/70 text-xs">{userInfo.year}</p>
              )}
            </div>
          </div>

          {/* QR Code */}
          <div className="bg-white rounded-lg p-4 flex justify-center">
            <QRCodeSVG 
              value={qrToken} 
              size={180}
              level="H"
              includeMargin={true}
            />
          </div>

          {/* Footer */}
          <div className="mt-4 text-center">
            <p className="text-white/60 text-xs">
              Scan this QR code for verification
            </p>
            <p className="text-white/40 text-xs mt-1">
              Valid permanently • Do not share
            </p>
          </div>
        </div>
      </div>

      {/* Download Button */}
      <div className="mt-4 text-center">
        <button 
          onClick={() => {
            // Implement download functionality
            console.log('Download QR code');
          }}
          className="bg-white text-blue-600 px-6 py-2 rounded-lg font-medium hover:bg-gray-100 transition-colors"
        >
          Download ID Card
        </button>
      </div>
    </div>
  );
}
```

---

### 3. Simple QR Display (Minimal)

```jsx
function SimpleQRCard({ userInfo, qrData }) {
  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-sm mx-auto">
      {/* Avatar */}
      <div className="flex justify-center mb-4">
        {userInfo.avatar ? (
          <img 
            src={userInfo.avatar} 
            alt={userInfo.name}
            className="w-24 h-24 rounded-full object-cover border-4 border-blue-500"
          />
        ) : (
          <div className="w-24 h-24 rounded-full bg-blue-500 text-white flex items-center justify-center text-3xl font-bold">
            {userInfo.firstName[0]}{userInfo.lastName[0]}
          </div>
        )}
      </div>

      {/* Name & ID */}
      <div className="text-center mb-4">
        <h3 className="font-bold text-xl">{userInfo.name}</h3>
        <p className="text-gray-600">{userInfo.id}</p>
      </div>

      {/* QR Code */}
      <div className="flex justify-center">
        <QRCodeSVG value={qrData} size={200} />
      </div>
    </div>
  );
}
```

---

## Key Points

### Avatar Handling:
- ✅ If `avatar` exists and starts with `data:image/` → Display the photo
- ✅ If `avatar` is `null` or empty → Display initials
- ✅ Avatar is full base64 string with data URI prefix

### Initials Calculation:
```javascript
const getInitials = (firstName, lastName) => {
  return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
};
```

### QR Code Library:
Install: `npm install qrcode.react`

Usage:
```jsx
import { QRCodeSVG } from 'qrcode.react';

<QRCodeSVG 
  value={qrToken} 
  size={200}
  level="H"
  includeMargin={true}
/>
```

---

## Testing

1. ✅ User with avatar → Photo displays on ID card
2. ✅ User without avatar → Initials display on ID card
3. ✅ QR code generates correctly
4. ✅ Avatar updates after profile photo upload
5. ✅ ID card displays on mobile devices

---

## API Endpoints

**Generate QR:**
```
GET /api/qr/generate
Authorization: Bearer {token}
```

**Verify QR:**
```
POST /api/qr/verify
Authorization: Bearer {token}
Body: { "qrData": "..." }
```

---

## Notes

- Avatar is included in QR generate response
- Avatar is also included in QR verify response
- QR codes are permanent (never expire)
- Avatar updates automatically when user uploads new photo
