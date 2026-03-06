# Student Profile - Frontend Integration Guide

## Overview
This guide covers implementing the student profile section with profile completion prompts and photo upload functionality.

---

## 🎯 Feature Requirements

### 1. Profile Completion Prompt
- Check if student has completed required profile fields
- Show a prompt/banner if profile is incomplete
- Display completion percentage
- Guide user to complete missing fields

### 2. Profile Photo Upload
- Allow students to upload profile photos
- Display photo in navbar, profile page, and ID card
- Support image upload with preview
- Store as base64 string in backend

---

## 📡 API Endpoints

### Base URL
```
Production: https://api.smartunivid.xyz
Development: http://localhost:8000
```

### Authentication
All endpoints require JWT token in Authorization header:
```javascript
headers: {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
}
```

---

## 1️⃣ Check Profile Completion

### Endpoint
```
GET /api/users/profile/completion
```

### Request
```javascript
const response = await fetch('https://api.smartunivid.xyz/api/users/profile/completion', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
```

### Response (Success - 200)
```json
{
  "isComplete": false,
  "completionPercentage": 62,
  "missingFields": [
    "phone",
    "dateOfBirth",
    "department"
  ],
  "message": "Please complete your profile to access all features."
}
```

### Response (Complete Profile - 200)
```json
{
  "isComplete": true,
  "completionPercentage": 100,
  "missingFields": [],
  "message": "Your profile is complete!"
}
```

### When to Call This API
- After user logs in (on dashboard load)
- After user updates their profile
- Before allowing access to certain features (QR code generation, etc.)

---

## 2️⃣ Get User Profile

### Endpoint
```
GET /api/users/profile
```

### Request
```javascript
const response = await fetch('https://api.smartunivid.xyz/api/users/profile', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  }
});

const data = await response.json();
```

### Response (Success - 200)
```json
{
  "id": "507f1f77bcf86cd799439011",
  "email": "student@example.com",
  "userType": "student",
  "status": "active",
  "profile": {
    "firstName": "John",
    "lastName": "Doe",
    "studentId": "STU-2024-001",
    "department": "Computer Science",
    "year": "Year 2",
    "phone": "+234 801 234 5678",
    "address": "Lagos, Nigeria",
    "dateOfBirth": "2000-01-15T00:00:00.000Z",
    "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
    "universityName": "University of Lagos"
  },
  "institutionId": "507f1f77bcf86cd799439012"
}
```

---

## 3️⃣ Update User Profile

### Endpoint
```
PUT /api/users/profile
```

### Request Body
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "phone": "+234 801 234 5678",
  "address": "123 Main Street, Lagos",
  "dateOfBirth": "2000-01-15",
  "department": "Computer Science",
  "year": "Year 2"
}
```

### Request Example
```javascript
const response = await fetch('https://api.smartunivid.xyz/api/users/profile', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    firstName: "John",
    lastName: "Doe",
    phone: "+234 801 234 5678",
    address: "123 Main Street, Lagos",
    dateOfBirth: "2000-01-15",
    department: "Computer Science",
    year: "Year 2"
  })
});

const data = await response.json();
```

### Response (Success - 200)
```json
{
  "message": "Profile updated successfully",
  "profile": {
    "firstName": "John",
    "lastName": "Doe",
    "studentId": "STU-2024-001",
    "department": "Computer Science",
    "year": "Year 2",
    "phone": "+234 801 234 5678",
    "address": "123 Main Street, Lagos",
    "dateOfBirth": "2000-01-15T00:00:00.000Z"
  }
}
```

### Editable Fields
- `firstName` - Student's first name
- `lastName` - Student's last name
- `phone` - Phone number
- `address` - Home address
- `dateOfBirth` - Date of birth (YYYY-MM-DD format)
- `department` - Academic department
- `year` - Year of study (Year 1, Year 2, Year 3, Year 4)

### Read-Only Fields (Cannot be edited)
- `studentId` - Auto-generated
- `email` - Set during registration
- `universityName` - From institution
- `status` - Managed by admin

---

## 4️⃣ Upload Profile Photo

### Endpoint
```
PUT /api/users/avatar
```

### How to Upload Photo

#### Step 1: Convert Image to Base64
```javascript
function convertImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Usage in file input handler
const handleFileChange = async (event) => {
  const file = event.target.files[0];
  
  if (!file) return;
  
  // Validate file type
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file');
    return;
  }
  
  // Validate file size (max 2MB)
  if (file.size > 2 * 1024 * 1024) {
    alert('Image size should be less than 2MB');
    return;
  }
  
  try {
    const base64Image = await convertImageToBase64(file);
    await uploadAvatar(base64Image);
  } catch (error) {
    console.error('Error uploading image:', error);
  }
};
```

#### Step 2: Send to Backend
```javascript
async function uploadAvatar(base64Image) {
  const response = await fetch('https://api.smartunivid.xyz/api/users/avatar', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      avatar: base64Image
    })
  });
  
  const data = await response.json();
  
  if (response.ok) {
    console.log('Avatar updated successfully');
    // Update UI with new avatar
  } else {
    console.error('Failed to update avatar:', data.message);
  }
}
```

### Request Body
```json
{
  "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD..."
}
```

### Response (Success - 200)
```json
{
  "message": "Avatar updated successfully",
  "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
```

### Image Requirements
- **Format**: JPG, PNG, GIF, WebP
- **Max Size**: 2MB recommended
- **Encoding**: Base64 string with data URI prefix
- **Example**: `data:image/jpeg;base64,/9j/4AAQSkZJRg...`

---

## 🎨 UI Implementation Guide

### 1. Profile Completion Banner

Show this banner when `isComplete === false`:

```jsx
// Example React Component
function ProfileCompletionBanner({ completionData }) {
  if (completionData.isComplete) return null;
  
  return (
    <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <svg className="h-6 w-6 text-yellow-400 mr-3" /* warning icon */>
          <div>
            <p className="text-sm font-medium text-yellow-800">
              Your profile is {completionData.completionPercentage}% complete
            </p>
            <p className="text-sm text-yellow-700 mt-1">
              {completionData.message}
            </p>
          </div>
        </div>
        <button 
          onClick={() => router.push('/profile/edit')}
          className="bg-yellow-400 text-yellow-900 px-4 py-2 rounded-md text-sm font-medium hover:bg-yellow-500"
        >
          Complete Profile
        </button>
      </div>
    </div>
  );
}
```

### 2. Profile Photo Upload Component

```jsx
function ProfilePhotoUpload({ currentAvatar, onUploadSuccess }) {
  const [preview, setPreview] = useState(currentAvatar);
  const [uploading, setUploading] = useState(false);
  
  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    // Validate
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    
    if (file.size > 2 * 1024 * 1024) {
      alert('Image size should be less than 2MB');
      return;
    }
    
    // Preview
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target.result);
    reader.readAsDataURL(file);
    
    // Upload
    setUploading(true);
    try {
      const base64 = await convertToBase64(file);
      const response = await fetch('https://api.smartunivid.xyz/api/users/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ avatar: base64 })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        onUploadSuccess(data.avatar);
        alert('Profile photo updated successfully!');
      } else {
        alert('Failed to upload photo');
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Error uploading photo');
    } finally {
      setUploading(false);
    }
  };
  
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <img 
          src={preview || '/default-avatar.png'} 
          alt="Profile" 
          className="w-32 h-32 rounded-full object-cover border-4 border-gray-200"
        />
        <label 
          htmlFor="avatar-upload" 
          className="absolute bottom-0 right-0 bg-blue-600 text-white p-2 rounded-full cursor-pointer hover:bg-blue-700"
        >
          <svg className="w-5 h-5" /* camera icon */>
          <input 
            id="avatar-upload"
            type="file" 
            accept="image/*" 
            onChange={handleFileChange}
            className="hidden"
            disabled={uploading}
          />
        </label>
      </div>
      {uploading && <p className="mt-2 text-sm text-gray-600">Uploading...</p>}
    </div>
  );
}
```

### 3. Display Avatar Throughout App

```jsx
// In Navbar
<img 
  src={user.profile.avatar || '/default-avatar.png'} 
  alt={`${user.profile.firstName} ${user.profile.lastName}`}
  className="w-10 h-10 rounded-full object-cover"
/>

// In Profile Page
<img 
  src={user.profile.avatar || '/default-avatar.png'} 
  alt="Profile"
  className="w-32 h-32 rounded-full object-cover"
/>

// In ID Card
<img 
  src={user.profile.avatar || '/default-avatar.png'} 
  alt="Student Photo"
  className="w-24 h-24 rounded-lg object-cover"
/>
```

---

## 🔄 Recommended User Flow

### On Login/Dashboard Load:
1. Call `GET /api/users/profile` to get user data
2. Call `GET /api/users/profile/completion` to check completion status
3. If `isComplete === false`, show completion banner
4. Display avatar in navbar using `profile.avatar`

### On Profile Page:
1. Display all profile information
2. Show editable form for incomplete fields
3. Allow photo upload
4. Show completion percentage

### On Profile Update:
1. Submit form to `PUT /api/users/profile`
2. Re-check completion status
3. Update UI with new data
4. Hide banner if profile is now complete

---

## 📋 Required Fields by User Type

### For Students:
- ✅ First Name
- ✅ Last Name
- ✅ Phone Number
- ✅ Date of Birth
- ✅ Address
- ✅ Department
- ✅ Year (Year 1, Year 2, Year 3, Year 4)
- 📸 Profile Photo (recommended but not required)

### For Lecturers:
- ✅ First Name
- ✅ Last Name
- ✅ Phone Number
- ✅ Date of Birth
- ✅ Address
- ✅ Department
- ✅ Specialization
- 📸 Profile Photo (recommended but not required)

---

## 🚨 Error Handling

### Common Errors

**401 Unauthorized**
```json
{
  "error": "Unauthorized"
}
```
Action: Redirect to login page

**404 Not Found**
```json
{
  "message": "User not found"
}
```
Action: Show error message, logout user

**400 Bad Request** (Avatar upload)
```json
{
  "message": "Avatar data is required"
}
```
Action: Show validation error to user

**500 Internal Server Error**
```json
{
  "message": "Failed to update profile"
}
```
Action: Show generic error message, allow retry

---

## 💡 Best Practices

1. **Cache Profile Data**: Store profile in state/context to avoid repeated API calls
2. **Optimistic Updates**: Update UI immediately, rollback on error
3. **Image Optimization**: Compress images before upload to reduce size
4. **Loading States**: Show spinners during API calls
5. **Validation**: Validate form fields before submission
6. **Error Messages**: Show clear, user-friendly error messages
7. **Auto-save**: Consider auto-saving profile changes
8. **Completion Tracking**: Update completion status after each profile update

---

## 🧪 Testing Checklist

- [ ] Profile completion check works on login
- [ ] Banner shows when profile is incomplete
- [ ] Banner hides when profile is complete
- [ ] Photo upload works with JPG, PNG
- [ ] Photo preview shows before upload
- [ ] Large images (>2MB) are rejected
- [ ] Avatar displays in navbar
- [ ] Avatar displays in profile page
- [ ] Avatar displays in ID card
- [ ] Profile update saves all fields correctly
- [ ] Completion percentage updates after profile edit
- [ ] Error messages display correctly
- [ ] Loading states work properly

---

## 📞 Support

If you encounter any issues or need clarification:
- Check the API response in browser DevTools (Network tab)
- Verify JWT token is being sent correctly
- Ensure base64 image format is correct
- Test with Postman first before implementing in frontend

Backend API: `https://api.smartunivid.xyz`
