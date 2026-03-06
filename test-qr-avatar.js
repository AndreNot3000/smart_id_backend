// Test QR endpoints to verify avatar is included
// Run with: node test-qr-avatar.js

const BASE_URL = 'https://api.smartunivid.xyz';

// Replace with a real student token
const STUDENT_TOKEN = 'YOUR_STUDENT_JWT_TOKEN_HERE';
const LECTURER_TOKEN = 'YOUR_LECTURER_JWT_TOKEN_HERE';

async function testQRGenerate(token, userType) {
  console.log(`\n🧪 Testing QR Generate (${userType})`);
  console.log('   GET /api/qr/generate');
  
  try {
    const response = await fetch(`${BASE_URL}/api/qr/generate`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    console.log(`   Status: ${response.status}`);
    
    if (response.ok) {
      console.log(`   ✅ PASSED`);
      console.log(`   User: ${data.userInfo.name}`);
      console.log(`   ID: ${data.userInfo.id}`);
      console.log(`   Avatar: ${data.userInfo.avatar ? 'Present (base64)' : 'null'}`);
      
      if (data.userInfo.avatar) {
        const isBase64 = data.userInfo.avatar.startsWith('data:image/');
        console.log(`   Avatar format: ${isBase64 ? '✅ Valid base64' : '❌ Invalid format'}`);
        console.log(`   Avatar length: ${data.userInfo.avatar.length} chars`);
      }
      
      return data.qrData;
    } else {
      console.log(`   ❌ FAILED: ${data.error || data.message}`);
      return null;
    }
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    return null;
  }
}

async function testQRVerify(qrData, lecturerToken) {
  console.log(`\n🧪 Testing QR Verify`);
  console.log('   POST /api/qr/verify');
  
  try {
    const response = await fetch(`${BASE_URL}/api/qr/verify`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lecturerToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ qrData })
    });
    
    const data = await response.json();
    
    console.log(`   Status: ${response.status}`);
    
    if (response.ok) {
      console.log(`   ✅ PASSED`);
      console.log(`   User: ${data.userInfo.firstName} ${data.userInfo.lastName}`);
      console.log(`   Student ID: ${data.userInfo.studentId}`);
      console.log(`   Avatar: ${data.userInfo.avatar ? 'Present (base64)' : 'null'}`);
      
      if (data.userInfo.avatar) {
        const isBase64 = data.userInfo.avatar.startsWith('data:image/');
        console.log(`   Avatar format: ${isBase64 ? '✅ Valid base64' : '❌ Invalid format'}`);
        console.log(`   Avatar length: ${data.userInfo.avatar.length} chars`);
        
        // Check if it's the wrong value
        if (data.userInfo.avatar === 'Pf647' || data.userInfo.avatar.length < 100) {
          console.log(`   ❌ WRONG VALUE: Avatar is "${data.userInfo.avatar}"`);
        }
      }
    } else {
      console.log(`   ❌ FAILED: ${data.error || data.message}`);
    }
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('🚀 QR AVATAR TESTS');
  console.log('='.repeat(60));
  
  // Test 1: Generate QR for student
  const qrData = await testQRGenerate(STUDENT_TOKEN, 'student');
  
  // Test 2: Verify QR (if we have lecturer token and qrData)
  if (qrData && LECTURER_TOKEN !== 'YOUR_LECTURER_JWT_TOKEN_HERE') {
    await testQRVerify(qrData, LECTURER_TOKEN);
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log('\n⚠️  NOTE: Replace tokens in script to test with real data');
  console.log('Expected avatar format: "data:image/jpeg;base64,/9j/4AAQ..."');
  console.log('If avatar is null, user has not uploaded a photo yet\n');
}

runTests();
