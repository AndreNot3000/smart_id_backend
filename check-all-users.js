// Check all users with a specific email
// Usage: node check-all-users.js <email>

import { MongoClient } from 'mongodb';
import 'dotenv/config';

const email = process.argv[2];

if (!email) {
  console.log('Usage: node check-all-users.js <email>');
  process.exit(1);
}

async function checkAllUsers() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URL;
  
  if (!mongoUri) {
    console.log('❌ MongoDB connection string not found');
    process.exit(1);
  }
  
  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');
    
    const db = client.db(process.env.DB_NAME || 'campus_id_saas');
    const usersCollection = db.collection('users');
    
    console.log('🔍 Searching for ALL users with email:', email);
    console.log('');
    
    // Find all users with this email (any userType)
    const users = await usersCollection.find({ 
      email: email 
    }).toArray();
    
    if (users.length === 0) {
      console.log('❌ No users found with this email\n');
      return;
    }
    
    console.log(`✅ Found ${users.length} user(s) with this email:\n`);
    
    users.forEach((user, index) => {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`User #${index + 1}:`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log('  Email:', user.email);
      console.log('  User Type:', user.userType);
      console.log('  Status:', user.status);
      console.log('  Email Verified:', user.emailVerified);
      console.log('  Institution ID:', user.institutionId);
      console.log('  Created:', user.createdAt);
      console.log('  Profile:', JSON.stringify(user.profile, null, 2));
      console.log('  Password Hash:', user.passwordHash.substring(0, 20) + '...');
      console.log('');
    });
    
    // Check if passwords are different
    if (users.length > 1) {
      console.log('⚠️  MULTIPLE ACCOUNTS DETECTED!\n');
      console.log('💡 Analysis:');
      
      const passwordHashes = users.map(u => u.passwordHash);
      const uniquePasswords = [...new Set(passwordHashes)];
      
      if (uniquePasswords.length === 1) {
        console.log('   ✅ All accounts have the SAME password');
      } else {
        console.log('   ⚠️  Accounts have DIFFERENT passwords!');
        users.forEach((user, index) => {
          console.log(`      User #${index + 1} (${user.userType}): ${user.passwordHash.substring(0, 20)}...`);
        });
      }
      
      console.log('');
      console.log('💡 Recommendations:');
      console.log('   1. You should only have ONE account per email');
      console.log('   2. Consider deleting duplicate accounts');
      console.log('   3. Or use different emails for different roles');
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.close();
  }
}

checkAllUsers();
