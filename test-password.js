// Test password verification
import bcrypt from 'bcryptjs';

const storedHash = '$2b$12$CTIT2ROhdevp4TNXfApN2Orh.i4qO9HEHJA8k8unQbZyWHIF/v3Ie';

// Test different possible passwords
const possiblePasswords = [
  'Hackless#12345',
  'hackless#12345', 
  'Hackless12345',
  'hackless12345',
  'password123',
  'Password123',
  'securePassword123',
  'your-super-secret-jwt-key-here-change-this-in-production'
];

console.log('Testing password verification...\n');

for (const password of possiblePasswords) {
  try {
    const isMatch = await bcrypt.compare(password, storedHash);
    console.log(`Password: "${password}" -> ${isMatch ? '✅ MATCH' : '❌ No match'}`);
  } catch (error) {
    console.log(`Password: "${password}" -> ❌ Error: ${error.message}`);
  }
}

// Also test creating a new hash for the correct password
console.log('\n--- Creating new hash for Hackless#12345 ---');
const newHash = await bcrypt.hash('Hackless#12345', 12);
console.log('New hash:', newHash);
const testNew = await bcrypt.compare('Hackless#12345', newHash);
console.log('New hash verification:', testNew ? '✅ Works' : '❌ Failed');