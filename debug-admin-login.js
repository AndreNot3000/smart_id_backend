// Debug script to check admin account status
// Usage: node debug-admin-login.js <email>

import { MongoClient } from 'mongodb';
import 'dotenv/config';

const email = process.argv[2];

if (!email) {
  console.log('Usage: node debug-admin-login.js <email>');
  process.exit(1);
}

async function checkAdminAccount() {
  const client = new MongoClient(process.env.MONGODB_URI);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db(process.env.DB_NAME || 'campus_id_saas');
    const usersCollection = db.collection('users');
    
    // Find user
    const user = await usersCollection.findOne({ email: email });
    
    if (!user) {
      console.log('❌ User not found with email:', email);
      
      // Check if there's a similar email
      const allAdmins = await usersCollection.find({ userType: 'admin' }).toArray();
      console.log('\n📋 All admin emails in database:');
      allAdmins.forEach(admin => {
        console.log(`  - ${admin.email} (status: ${admin.status}, verified: ${admin.emailVerified})`);
      });
      
      return;
    }
    
    console.log('\n✅ User found!');
    console.log('📋 User Details:');
    console.log('  Email:', user.email);
    console.log('  User Type:', user.userType);
    console.log('  Status:', user.status);
    console.log('  Email Verified:', user.emailVerified);
    console.log('  Institution ID:', user.institutionId);
    console.log('  Created At:', user.createdAt);
    console.log('  Profile:', JSON.stringify(user.profile, null, 2));
    
    // Check institution
    const institutionsCollection = db.collection('institutions');
    const institution = await institutionsCollection.findOne({ _id: user.institutionId });
    
    if (institution) {
      console.log('\n🏫 Institution Details:');
      console.log('  Name:', institution.name);
      console.log('  Code:', institution.code);
      console.log('  Status:', institution.status);
    } else {
      console.log('\n❌ Institution not found!');
    }
    
    // Check OTP records
    const otpCollection = db.collection('otp_codes');
    const otpRecords = await otpCollection
      .find({ email: email })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();
    
    if (otpRecords.length > 0) {
      console.log('\n📧 Recent OTP Records:');
      otpRecords.forEach((record, index) => {
        console.log(`  ${index + 1}. Code: ${record.code}`);
        console.log(`     Purpose: ${record.purpose}`);
        console.log(`     Used: ${record.used}`);
        console.log(`     Expires: ${record.expiresAt}`);
        console.log(`     Expired: ${record.expiresAt <= new Date()}`);
        console.log('');
      });
    } else {
      console.log('\n📧 No OTP records found');
    }
    
    // Provide recommendations
    console.log('\n💡 Recommendations:');
    if (!user.emailVerified) {
      console.log('  ⚠️  Email is not verified. User needs to verify email with OTP.');
    }
    if (user.status !== 'active') {
      console.log(`  ⚠️  Account status is "${user.status}". Should be "active" to login.`);
    }
    if (user.emailVerified && user.status === 'active') {
      console.log('  ✅ Account is properly configured. Check if password is correct.');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await client.close();
  }
}

checkAdminAccount();
