# 📱 Frontend Team - Backend API Information

## 🌐 Backend URL

```
https://smart-id-exvb.onrender.com
```

**Status:** ✅ Deployed and ready to use

---

## 🔧 Frontend Configuration

### **Environment Variables**

Add this to your Vercel project:

#### **For Next.js:**
```bash
NEXT_PUBLIC_API_URL=https://smart-id-exvb.onrender.com
```

#### **For Vite/React:**
```bash
VITE_API_URL=https://smart-id-exvb.onrender.com
```

#### **For Create React App:**
```bash
REACT_APP_API_URL=https://smart-id-exvb.onrender.com
```

### **How to Set on Vercel:**

1. Go to Vercel Dashboard
2. Select your project
3. Go to **Settings** → **Environment Variables**
4. Add the variable above
5. Select **Production** environment
6. Click **Save**
7. **Redeploy** your frontend

---

## 📡 API Endpoints

### **Base URL:**
```
https://smart-id-exvb.onrender.com
```

### **Authentication Endpoints:**

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/auth/institutions` | Get all institutions | No |
| POST | `/api/auth/admin/register` | Register admin | No |
| POST | `/api/auth/login` | Login | No |
| GET | `/api/auth/verify-email` | Verify email (magic link) | No |
| POST | `/api/auth/forgot-password` | Request password reset | No |
| POST | `/api/auth/reset-password` | Reset password with OTP | No |
| POST | `/api/auth/refresh-token` | Refresh access token | No |

### **User Management Endpoints:**

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/users/profile` | Get user profile | Yes |
| PUT | `/api/users/profile` | Update profile | Yes |
| POST | `/api/users/avatar` | Upload avatar | Yes |
| POST | `/api/users/change-password` | Change password | Yes |
| POST | `/api/users/logout` | Logout | Yes |
| GET | `/api/users/dashboard/stats` | Get dashboard stats | Yes (Admin) |

### **Admin Endpoints:**

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/admin/students` | Create student account | Yes (Admin) |
| GET | `/api/admin/students` | Get all students | Yes (Admin) |
| POST | `/api/admin/lecturers` | Create lecturer account | Yes (Admin) |
| GET | `/api/admin/lecturers` | Get all lecturers | Yes (Admin) |

### **QR Code Endpoints:**

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/qr/generate` | Generate QR code | Yes (Student/Lecturer) |
| POST | `/api/qr/verify` | Verify QR & get info | Yes (Lecturer/Admin) |
| POST | `/api/qr/scan-attendance` | Scan QR & mark attendance | Yes (Lecturer/Admin) |
| GET | `/api/qr/attendance/my-history` | Get my attendance | Yes (Student) |
| GET | `/api/qr/attendance/student/:id` | Get student attendance | Yes (Lecturer/Admin) |

### **Super Admin Endpoints:**

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/superadmin/institutions` | Create institution | Yes (Super Admin Key) |
| GET | `/api/superadmin/institutions` | Get all institutions | Yes (Super Admin Key) |

---

## 🔐 Authentication

### **Login Request:**

```typescript
const response = await fetch('https://smart-id-exvb.onrender.com/api/auth/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'user@university.edu',
    password: 'password123',
    userType: 'admin' // or 'student' or 'lecturer'
  })
});

const data = await response.json();
// data.accessToken - Use for subsequent requests
// data.refreshToken - Use to refresh access token
```

### **Authenticated Requests:**

```typescript
const response = await fetch('https://smart-id-exvb.onrender.com/api/users/profile', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  }
});
```

### **Token Storage:**

```typescript
// Store tokens securely
localStorage.setItem('accessToken', data.accessToken);
localStorage.setItem('refreshToken', data.refreshToken);

// Retrieve for requests
const token = localStorage.getItem('accessToken');
```

---

## 🎨 Example API Client Setup

### **Axios Setup:**

```typescript
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle token refresh on 401
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Redirect to login or refresh token
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default apiClient;
```

### **Fetch Setup:**

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export const apiClient = {
  async request(endpoint: string, options: RequestInit = {}) {
    const token = localStorage.getItem('accessToken');
    
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Redirect to login
        window.location.href = '/login';
      }
      throw new Error(`API Error: ${response.statusText}`);
    }

    return response.json();
  },

  get(endpoint: string) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint: string, data: any) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  put(endpoint: string, data: any) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  delete(endpoint: string) {
    return this.request(endpoint, { method: 'DELETE' });
  },
};
```

---

## 🧪 Testing Endpoints

### **Test Health Check:**

```bash
curl https://smart-id-exvb.onrender.com/
```

### **Test Login:**

```bash
curl -X POST https://smart-id-exvb.onrender.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@university.edu",
    "password": "password123",
    "userType": "admin"
  }'
```

### **Test Protected Endpoint:**

```bash
curl https://smart-id-exvb.onrender.com/api/users/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## ⚠️ Important Notes

### **1. First Request May Be Slow**

Render free tier spins down after 15 minutes of inactivity. The first request after inactivity may take 30-60 seconds to wake up the service.

**Solution:** Show a loading indicator for the first request.

### **2. CORS is Configured**

The backend accepts requests from:
- Your Vercel production URL
- Vercel preview deployments
- localhost:3000 (for local development)

### **3. HTTPS Only**

All requests must use HTTPS in production. HTTP requests will fail.

### **4. Rate Limiting**

The backend may have rate limiting enabled. Handle 429 (Too Many Requests) errors gracefully.

### **5. Error Handling**

Always handle these status codes:
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (invalid/expired token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

---

## 📊 Response Formats

### **Success Response:**

```json
{
  "message": "Operation successful",
  "data": { ... }
}
```

### **Error Response:**

```json
{
  "error": "Error message",
  "details": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### **Validation Error:**

```json
{
  "error": "Validation error",
  "details": [
    {
      "field": "password",
      "message": "Password must be at least 8 characters"
    }
  ]
}
```

---

## 🔍 Debugging

### **Check Network Tab:**

1. Open DevTools (F12)
2. Go to Network tab
3. Try the request
4. Check:
   - Request URL (should be https://smart-id-exvb.onrender.com/...)
   - Request headers (Authorization header present?)
   - Response status code
   - Response body

### **Common Issues:**

| Issue | Cause | Solution |
|-------|-------|----------|
| CORS error | Wrong origin | Check Vercel URL matches backend CORS config |
| 401 Unauthorized | Missing/invalid token | Check token is stored and sent correctly |
| 404 Not Found | Wrong endpoint | Verify endpoint URL is correct |
| Network error | Backend down | Check backend is deployed and running |
| Slow first request | Cold start | Normal for free tier, show loading state |

---

## 📞 Support

If you encounter issues:

1. Check this documentation first
2. Test endpoints with curl/Postman
3. Check browser console for errors
4. Verify environment variables are set
5. Contact backend team with:
   - Error message
   - Request URL
   - Request payload
   - Response received

---

## ✅ Deployment Checklist

Before deploying frontend to production:

- [ ] Set `NEXT_PUBLIC_API_URL` (or equivalent) on Vercel
- [ ] Test login from Vercel preview deployment
- [ ] Verify no CORS errors in console
- [ ] Test all critical user flows
- [ ] Handle loading states for cold starts
- [ ] Implement proper error handling
- [ ] Test on mobile devices
- [ ] Verify HTTPS is used for all requests

---

## 🎉 You're All Set!

Your backend is deployed and ready to use. Start building your frontend with confidence! 🚀
