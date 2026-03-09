// Test login credentials
// Usage: node test-login.js <email> <password>

import { MongoClient } from 'mongodb';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.log('Usage: node test-login.js <email> <password>');
  process.exit(1);
}

async function testLogin() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db(process.env.DB_NAME || 'campus_id_saas');
    const usersCollection = db.collection('users');
    
    console.log('🔍 Searching for user with email:', email);
    console.log('🔍 Searching for userType: admin\n');
    
    // Find user (same query as login endpoint)
    const user = await usersCollection.findOne({ 
      email: email, 
      userType: 'admin' 
    });
    
    if (!user) {
      console.log('❌ User not found with this email and userType combination\n');
      
      // Check if user exists with different userType
      const anyUser = await usersCollection.findOne({ email: email });
      if (anyUser) {
        console.log('⚠️  Found user with same email but different userType:');
        console.log('   UserType:', anyUser.userType);
        console.log('   Status:', anyUser.status);
        console.log('   Email Verified:', anyUser.emailVerified);
        console.log('\n💡 Make sure you select the correct user type during login!\n');
      } else {
        console.log('❌ No user found with this email at all\n');
      }
      return;
    }
    
    console.log('✅ User found!\n');
    console.log('📋 User Details:');
    console.log('   Email:', user.email);
    console.log('   User Type:', user.userType);
    console.log('   Status:', user.status);
    console.log('   Email Verified:', user.emailVerified);
    console.log('   Created:', user.createdAt);
    console.log('   Profile:', user.profile.firstName, user.profile.lastName);
    console.log('');
    
    // Test password
    console.log('🔐 Testing password...');
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    console.log('🔐 Password match:', isValidPassword ? '✅ YES' : '❌ NO');
    console.log('');
    
    // Check login requirements
    console.log('📝 Login Requirements Check:');
    console.log('   1. User exists:', '✅ YES');
    console.log('   2. Password correct:', isValidPassword ? '✅ YES' : '❌ NO');
    console.log('   3. Email verified:', user.emailVerified ? '✅ YES' : '❌ NO');
    console.log('   4. Status is active:', user.status === 'active' ? '✅ YES' : `❌ NO (${user.status})`);
    console.log('');
    
    // Final verdict
    if (!isValidPassword) {
      console.log('❌ LOGIN WILL FAIL: Invalid password');
      console.log('💡 The password you entered does not match the stored password.');
      console.log('💡 Try using "Forgot Password" to reset it.\n');
    } else if (!user.emailVerified) {
      console.log('❌ LOGIN WILL FAIL: Email not verified');
      console.log('💡 You need to verify your email with the OTP code.\n');
    } else if (user.status !== 'active') {
      console.log(`❌ LOGIN WILL FAIL: Account status is "${user.status}"`);
      console.log('💡 Account needs to be activated.\n');
    } else {
      console.log('✅ LOGIN SHOULD SUCCEED!');
      console.log('💡 All requirements are met. If login still fails, check:');
      console.log('   - Are you selecting the correct user type (admin)?');
      console.log('   - Is the backend server running?');
      console.log('   - Check backend console logs for errors\n');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

testLogin();
