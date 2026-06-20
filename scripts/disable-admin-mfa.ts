import 'dotenv/config';
import { MongoClient } from 'mongodb';

/**
 * Emergency utility: turn off admin MFA for an account (e.g. when production
 * frontend cannot complete the MFA step yet).
 *
 * Usage:
 *   bun scripts/disable-admin-mfa.ts <email> [institutionCode]
 */
async function main() {
  const [, , emailArg, institutionCode] = process.argv;

  if (!emailArg) {
    console.error('❌ Usage: bun scripts/disable-admin-mfa.ts <email> [institutionCode]');
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();
  const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
  const dbName = process.env.DB_NAME || 'campus_id_saas';

  const client = new MongoClient(mongoUrl, {
    serverSelectionTimeoutMS: 10000,
    ...(/(mongodb\+srv|mongodb\.net)/.test(mongoUrl) && process.env.NODE_ENV !== 'production'
      ? { tlsAllowInvalidCertificates: true }
      : {}),
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    const users = db.collection('users');

    const filter: Record<string, unknown> = { email, userType: 'admin' };
    if (institutionCode) {
      const inst = await db.collection('institutions').findOne({
        code: institutionCode.toUpperCase(),
      });
      if (!inst) {
        console.error(`❌ Institution not found: ${institutionCode}`);
        process.exit(1);
      }
      filter.institutionId = inst._id;
    }

    const user = await users.findOne(filter);
    if (!user) {
      console.error(`❌ Admin not found: ${email}`);
      process.exit(1);
    }

    await users.updateOne(
      { _id: user._id },
      {
        $set: { mfaEnabled: false, updatedAt: new Date() },
        $unset: {
          mfaSecretEnc: '',
          mfaBackupCodesHash: '',
          mfaConfirmedAt: '',
        },
      },
    );

    console.log(`✅ MFA disabled for admin ${email} (${user._id})`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
