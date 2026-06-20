import crypto from 'crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(bytes: number = 20): string {
  // RFC 4226 suggests 20 bytes for SHA1
  const raw = crypto.randomBytes(bytes);
  let out = '';
  for (let i = 0; i < raw.length; i += 5) {
    // encode 5 bytes => 8 base32 chars (approx). We'll do a simple bit-pack via our decoder's inverse approach:
    // easiest is to use Buffer -> bits loop similar to decode.
  }
  // implement a minimal base32 encoder
  let bits = 0;
  let val = 0;
  for (const b of raw) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(val >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(val << (5 - bits)) & 31]!;
  }
  return out;
}

export function totpCode(secretBase32: string, forTimeMs: number = Date.now(), stepSeconds: number = 30, digits: number = 6): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(forTimeMs / 1000 / stepSeconds);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter & 0xffffffff, 4);

  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const bin =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  const mod = 10 ** digits;
  const code = (bin % mod).toString().padStart(digits, '0');
  return code;
}

export function verifyTotpCode(secretBase32: string, code: string, window: number = 1): boolean {
  const clean = String(code).trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const now = Date.now();
  const step = 30_000;
  for (let w = -window; w <= window; w++) {
    if (totpCode(secretBase32, now + w * step) === clean) return true;
  }
  return false;
}

