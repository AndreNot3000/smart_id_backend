// Test script for Profile APIs
// Run with: node test-profile-apis.js

const BASE_URL = 'https://api.smartunivid.xyz';

// You'll need to replace this with a real token from a logged-in student
const TEST_TOKEN = 'YOUR_JWT_TOKEN_HERE';

async function testAPI(name, method, endpoint, body = null, token = TEST_TOKEN) {
  console.log(`\n🧪 Testing: ${name}`);
  console.log(`   ${method} ${endpoint}`);
  
  try {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    const data = await response.json();
    
    console.log(`   Status: ${response.status}`);
    console.log(`   Response:`, JSON.stringify(data, null, 2));
    
    if (response.ok) {
      console.log(`   ✅ PASSED`);
    } else {
      console.log(`   ❌ FAILED`);
    }
    
    return { success: response.ok, data, status: response.status };
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('🚀 PROFILE API TESTS');
  console.log('='.repeat(60));
  
  // Test 1: Health Check (no auth needed)
  await testAPI(
    'Health Check',
    'GET',
    '/',
    null,
    null
  );
  
  // Test 2: Get Profile (requires auth)
  await testAPI(
    'Get Profile',
    'GET',
    '/api/users/profile'
  );
  
  // Test 3: Check Profile Completion (requires auth)
  await testAPI(
    'Check Profile Completion',
    'GET',
    '/api/users/profile/completion'
  );
  
  // Test 4: Update Profile (requires auth)
  await testAPI(
    'Update Profile',
    'PUT',
    '/api/users/profile',
    {
      firstName: 'Test',
      lastName: 'User',
      phone: '+234 801 234 5678',
      address: 'Test Address, Lagos',
      dateOfBirth: '2000-01-15',
      department: 'Computer Science',
      year: 'Year 2'
    }
  );
  
  // Test 5: Upload Avatar (requires auth)
  // Using a small test base64 image (1x1 red pixel)
  const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  
  await testAPI(
    'Upload Avatar',
    'PUT',
    '/api/users/avatar',
    { avatar: testImage }
  );
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log('\n⚠️  NOTE: Tests requiring authentication will fail without a valid JWT token.');
  console.log('To test with authentication:');
  console.log('1. Login as a student to get a JWT token');
  console.log('2. Replace TEST_TOKEN in this script with the real token');
  console.log('3. Run the script again\n');
}

runTests();
