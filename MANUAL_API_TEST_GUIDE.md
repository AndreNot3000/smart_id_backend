# Manual API Testing Guide

## How to Test Profile APIs

### Step 1: Get a JWT Token

First, you need to login to get a valid JWT token.

**Login API:**
```bash
curl -X POST https://api.smartunivid.xyz/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student@example.com",
    "password": "your-password"
  }'
```

**Response:**
```json
{
  "message": "Login successful",
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { ... }
}
```

Copy the `accessToken` value.

---

### Step 2: Test Profile APIs

Replace `YOUR_TOKEN_HERE` with the actual token from Step 1.

#### Test 1: Get Profile
```bash
curl -X GET https://api.smartunivid.xyz/api/users/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

**Expected Response (200):**
```json
{
  "id": "...",
  "email": "student@example.com",
  "userType": "student",
  "status": "active",
  "profile": {
    "firstName": "John",
    "lastName": "Doe",
    ...
  }
}
```

---

#### Test 2: Check Profile Completion (NEW API)
```bash
curl -X GET https://api.smartunivid.xyz/api/users/profile/completion \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

**Expected Response (200):**
```json
{
  "isComplete": false,
  "completionPercentage": 62,
  "missingFields": ["phone", "dateOfBirth", "department"],
  "message": "Please complete your profile to access all features."
}
```

---

#### Test 3: Update Profile
```bash
curl -X PUT https://api.smartunivid.xyz/api/users/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "phone": "+234 801 234 5678",
    "address": "123 Main Street, Lagos",
    "dateOfBirth": "2000-01-15",
    "department": "Computer Science",
    "year": "Year 2"
  }'
```

**Expected Response (200):**
```json
{
  "message": "Profile updated successfully",
  "profile": {
    "firstName": "John",
    "lastName": "Doe",
    ...
  }
}
```

---

#### Test 4: Upload Avatar
```bash
curl -X PUT https://api.smartunivid.xyz/api/users/avatar \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "avatar": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
  }'
```

**Expected Response (200):**
```json
{
  "message": "Avatar updated successfully",
  "avatar": "data:image/png;base64,..."
}
```

---

## Using Postman (Easier Method)

### Import Collection
1. Open Postman
2. Import the file: `Campus-ID-API.postman_collection.json`
3. Create an environment variable: `accessToken`
4. Login first to get token
5. Set the token in environment
6. Test all profile endpoints

### Quick Postman Setup
1. **Login Request:**
   - Method: POST
   - URL: `https://api.smartunivid.xyz/api/auth/login`
   - Body (JSON):
     ```json
     {
       "email": "student@example.com",
       "password": "your-password"
     }
     ```
   - Copy `accessToken` from response

2. **Profile Requests:**
   - Add header: `Authorization: Bearer {{accessToken}}`
   - Test each endpoint

---

## Test Results Summary

✅ **Health Check** - Working (no auth needed)
✅ **Get Profile** - Working (requires auth)
✅ **Profile Completion Check** - Working (requires auth)
✅ **Update Profile** - Working (requires auth)
✅ **Upload Avatar** - Working (requires auth)

All endpoints return proper error messages when:
- Token is missing: `401 - Invalid or expired token`
- User not found: `404 - User not found`
- Server error: `500 - Failed to...`

---

## Common Errors

### 401 Unauthorized
```json
{
  "error": "Invalid or expired token"
}
```
**Solution:** Login again to get a fresh token

### 404 Not Found
```json
{
  "message": "User not found"
}
```
**Solution:** Check if user exists in database

### 400 Bad Request (Avatar)
```json
{
  "message": "Avatar data is required"
}
```
**Solution:** Ensure avatar field is included in request body

---

## Next Steps

1. ✅ APIs are created and deployed
2. ✅ Error handling is working
3. ✅ Authentication is working
4. 🔄 Test with real student account
5. 🔄 Integrate in frontend

---

## Notes for Future API Development

✅ Always test APIs after creation
✅ Test both success and error cases
✅ Verify authentication works
✅ Check error messages are clear
✅ Test on production server after deployment
