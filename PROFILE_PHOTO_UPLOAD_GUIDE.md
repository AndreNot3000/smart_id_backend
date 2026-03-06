# Profile Photo Upload - Frontend Implementation

## API Endpoint
```
PUT https://api.smartunivid.xyz/api/users/avatar
```

## Requirements
- Image formats: JPG, PNG, GIF, WebP
- Max size: 5MB
- Encoding: Base64 with data URI prefix
- Authentication: JWT token required

---

## Complete Working Code

### 1. Image Upload Component (React/Next.js)

```jsx
'use client'; // For Next.js 13+

import { useState } from 'react';

export default function ProfilePhotoUpload({ currentAvatar, onUploadSuccess }) {
  const [preview, setPreview] = useState(currentAvatar);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Convert file to base64
  const convertToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  };

  // Compress image before upload (optional but recommended)
  const compressImage = (file, maxWidth = 800, maxHeight = 800, quality = 0.8) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Calculate new dimensions
          if (width > height) {
            if (width > maxWidth) {
              height = (height * maxWidth) / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = (width * maxHeight) / height;
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to base64
          const base64 = canvas.toDataURL(file.type, quality);
          resolve(base64);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError('');

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPG, PNG, GIF, WebP)');
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image size must be less than 5MB');
      return;
    }

    try {
      setUploading(true);

      // Compress image (recommended)
      const compressedBase64 = await compressImage(file);
      
      // Or use without compression:
      // const base64 = await convertToBase64(file);

      // Show preview
      setPreview(compressedBase64);

      // Upload to backend
      const token = localStorage.getItem('accessToken'); // or however you store token
      
      const response = await fetch('https://api.smartunivid.xyz/api/users/avatar', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          avatar: compressedBase64
        })
      });

      const data = await response.json();

      if (response.ok) {
        console.log('✅ Avatar uploaded successfully');
        onUploadSuccess?.(data.avatar);
        setError('');
      } else {
        console.error('❌ Upload failed:', data);
        setError(data.error || data.message || 'Upload failed');
        setPreview(currentAvatar); // Revert preview
      }
    } catch (err) {
      console.error('❌ Upload error:', err);
      setError('Failed to upload image. Please try again.');
      setPreview(currentAvatar); // Revert preview
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col items-center space-y-4">
      {/* Avatar Display */}
      <div className="relative">
        <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-gray-200 bg-gray-100">
          {preview ? (
            <img 
              src={preview} 
              alt="Profile" 
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-blue-500 text-white text-3xl font-bold">
              {/* Show initials if no avatar */}
              JD
            </div>
          )}
        </div>

        {/* Upload Button */}
        <label 
          htmlFor="avatar-upload" 
          className={`absolute bottom-0 right-0 bg-blue-600 text-white p-3 rounded-full cursor-pointer hover:bg-blue-700 transition-colors ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
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

      {/* Status Messages */}
      {uploading && (
        <p className="text-sm text-blue-600 font-medium">
          Uploading...
        </p>
      )}

      {error && (
        <p className="text-sm text-red-600 font-medium">
          {error}
        </p>
      )}

      <p className="text-xs text-gray-500 text-center">
        JPG, PNG, GIF or WebP. Max 5MB.
      </p>
    </div>
  );
}
```

---

### 2. Display Avatar Throughout App

#### In Navbar
```jsx
function Navbar({ user }) {
  const getInitials = (firstName, lastName) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  return (
    <nav>
      {/* Avatar in navbar */}
      <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-gray-300">
        {user.profile.avatar ? (
          <img 
            src={user.profile.avatar} 
            alt={`${user.profile.firstName} ${user.profile.lastName}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-blue-500 text-white text-sm font-bold">
            {getInitials(user.profile.firstName, user.profile.lastName)}
          </div>
        )}
      </div>
    </nav>
  );
}
```

#### In Profile Page
```jsx
function ProfilePage({ user, onAvatarUpdate }) {
  return (
    <div>
      <ProfilePhotoUpload 
        currentAvatar={user.profile.avatar}
        onUploadSuccess={(newAvatar) => {
          // Update user state
          onAvatarUpdate(newAvatar);
          // Or refetch user profile
        }}
      />
    </div>
  );
}
```

#### In ID Card
```jsx
function IDCard({ student }) {
  return (
    <div className="id-card">
      <div className="w-24 h-24 rounded-lg overflow-hidden">
        {student.profile.avatar ? (
          <img 
            src={student.profile.avatar} 
            alt="Student Photo"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-300 text-gray-600 text-2xl font-bold">
            {student.profile.firstName?.[0]}{student.profile.lastName?.[0]}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

### 3. Simpler Version (Without Compression)

```jsx
'use client';

import { useState } from 'react';

export default function SimplePhotoUpload({ currentAvatar, onSuccess }) {
  const [preview, setPreview] = useState(currentAvatar);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }

    setUploading(true);
    setError('');

    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64 = e.target.result;
        setPreview(base64);

        // Upload
        const token = localStorage.getItem('accessToken');
        const response = await fetch('https://api.smartunivid.xyz/api/users/avatar', {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ avatar: base64 })
        });

        const data = await response.json();

        if (response.ok) {
          onSuccess?.(data.avatar);
        } else {
          setError(data.error || 'Upload failed');
          setPreview(currentAvatar);
        }
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setError('Upload failed');
      setPreview(currentAvatar);
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="w-32 h-32 rounded-full overflow-hidden">
        {preview ? (
          <img src={preview} alt="Profile" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gray-300" />
        )}
      </div>
      
      <input 
        type="file" 
        accept="image/*" 
        onChange={handleUpload}
        disabled={uploading}
      />
      
      {uploading && <p>Uploading...</p>}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
```

---

## Common Issues & Solutions

### Issue 1: "Load Failed" Error
**Cause:** Image too large or network timeout
**Solution:** 
- Compress image before upload (see compression code above)
- Reduce max dimensions to 800x800
- Reduce quality to 0.7-0.8

### Issue 2: Avatar Not Displaying
**Cause:** Base64 string not properly formatted
**Solution:**
- Ensure base64 starts with `data:image/...`
- Check browser console for errors
- Verify image loads: `<img src={avatar} onError={() => console.log('Image load error')} />`

### Issue 3: Upload Succeeds But Doesn't Show
**Cause:** State not updating
**Solution:**
- Refetch user profile after upload
- Update local state with new avatar
- Force re-render

---

## Testing Checklist

- [ ] Upload JPG image
- [ ] Upload PNG image
- [ ] Upload image > 5MB (should fail with error)
- [ ] Upload non-image file (should fail with error)
- [ ] Avatar displays in navbar after upload
- [ ] Avatar displays in profile page
- [ ] Avatar displays in ID card
- [ ] Initials show when no avatar
- [ ] Error messages display correctly
- [ ] Loading state shows during upload

---

## API Response Examples

### Success (200)
```json
{
  "message": "Avatar updated successfully",
  "avatar": "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
}
```

### Error (400)
```json
{
  "error": "Image too large. Maximum size is 5MB"
}
```

### Error (401)
```json
{
  "error": "Invalid or expired token"
}
```

### Error (500)
```json
{
  "error": "Failed to update avatar",
  "details": "..."
}
```
