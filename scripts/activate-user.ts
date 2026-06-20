import 'dotenv/config';
import { MongoClient } from 'mongodb';

/**
 * One-off admin utility to manually verify + activate a stuck user account.
 *
 * Use when a user's email was never flagged verified (e.g. a verification link
 * that predated institution-scoped verification updated a same-email account at
 * another institution instead).
 *
 * Usage:
 *   bun scripts/activate-user.ts <email> [institutionCode]
 *
 * Examples:
 *   bun scripts/activate-user.ts andreolumide@gmail.com UNILAG
 *   bun scripts/activate-user.ts andreolumide@gmail.com         (if email is unique)
 *
 * Point it at the right database by setting MONGODB_URL / DB_NAME in your env
 * (same as the backend). For the deployed DB, run it with the production
 * MONGODB_URL.
 */
async function main() {
  const [, , emailArg, institutionCode] = process.argv;

  if (!emailArg) {
    console.error('❌ Usage: bun scripts/activate-user.ts <email> [institutionCode]');
    process.exit(1);
  }

  const email = emailArg.toLowerCase().trim();
  const mongoUrl = process.env.MONGODB_URL || 'mongodb://localhost:27017';
  const dbName = process.env.DB_NAME || 'campus_id_saas';

  const client = new MongoClient(mongoUrl, {
    serverSelectionTimeoutMS: 10000,
    // Mirror the app's relaxed-TLS behaviour for local Atlas dev.
    ...(/(mongodb\+srv|mongodb\.net)/.test(mongoUrl) && process.env.NODE_ENV !== 'production'
      ? { tlsAllowInvalidCertificates: true }
      : {}),
  });

  try {
    await client.connect();
    const db = client.db(dbName);
    const users = db.collection('users');
    const institutions = db.collection('institutions');

    // Resolve institution filter (optional but recommended when emails repeat).
    let institutionId;
    if (institutionCode) {
      const inst = await institutions.findOne({ code: institutionCode.toUpperCase() });
      if (!inst) {
        console.error(`❌ Institution with code "${institutionCode}" not found.`);
        process.exit(1);
      }
      institutionId = inst._id;
    }

    const filter: Record<string, unknown> = { email };
    if (institutionId) filter.institutionId = institutionId;

    const matches = await users.find(filter).toArray();
    if (matches.length === 0) {
      console.error(`❌ No user found for ${email}${institutionCode ? ` at ${institutionCode}` : ''}.`);
      process.exit(1);
    }
    if (matches.length > 1) {
      console.error(
        `⚠️  ${matches.length} users share this email across institutions. ` +
          'Re-run with the institution code to target one:',
      );
      for (const u of matches) {
        console.error(`   - ${u.userType} | institutionId=${u.institutionId} | status=${u.status} | verified=${u.emailVerified}`);
      }
      process.exit(1);
    }

    const target = matches[0]!;
    const result = await users.updateOne(
      { _id: target._id },
      { $set: { emailVerified: true, status: 'active', updatedAt: new Date() } },
    );

    console.log(
      `✅ Activated ${target.userType} ${email} (institutionId=${target.institutionId}). ` +
        `modified=${result.modifiedCount}`,
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
