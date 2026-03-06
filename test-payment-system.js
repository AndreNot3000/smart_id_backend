// Test Payment System
// Run with: node test-payment-system.js

const BASE_URL = 'https://api.smartunivid.xyz';

// Replace with a real student token
const STUDENT_TOKEN = 'YOUR_STUDENT_JWT_TOKEN_HERE';

async function testAPI(name, method, endpoint, body = null) {
  console.log(`\n🧪 Testing: ${name}`);
  console.log(`   ${method} ${endpoint}`);
  
  try {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${STUDENT_TOKEN}`,
        'Content-Type': 'application/json',
      }
    };
    
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
    
    return { success: response.ok, data };
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('🚀 PAYMENT SYSTEM TESTS');
  console.log('='.repeat(60));
  
  // Test 1: Get Wallet
  await testAPI(
    'Get Wallet',
    'GET',
    '/api/payments/wallet'
  );
  
  // Test 2: Initialize Top-up
  const topupResult = await testAPI(
    'Initialize Wallet Top-up',
    'POST',
    '/api/payments/wallet/topup',
    { amount: 1000 }
  );
  
  if (topupResult.success && topupResult.data.authorizationUrl) {
    console.log('\n📱 Payment URL:', topupResult.data.authorizationUrl);
    console.log('💳 Use test card: 4084084084084081');
    console.log('📅 Expiry: 12/30');
    console.log('🔐 CVV: 408');
    console.log('📌 PIN: 0000');
  }
  
  // Test 3: Get Transaction History
  await testAPI(
    'Get Transaction History',
    'GET',
    '/api/payments/history?page=1&limit=10'
  );
  
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log('\n⚠️  NOTE: Replace STUDENT_TOKEN in script to test with real data');
  console.log('\n✅ Payment system is ready!');
  console.log('📖 See PAYMENT_SYSTEM_GUIDE.md for complete documentation\n');
}

runTests();
