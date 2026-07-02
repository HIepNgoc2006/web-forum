import crypto from 'node:crypto';
import QRCode from 'qrcode';

// Base32 decoder
function base32Decode(str: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = str.toUpperCase().replace(/=+$/, '');
  let val = 0;
  let count = 0;
  const bytes = [];

  for (let i = 0; i < cleaned.length; i++) {
    const idx = alphabet.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new Error('Invalid base32 character');
    }
    val = (val << 5) | idx;
    count += 5;
    if (count >= 8) {
      bytes.push((val >>> (count - 8)) & 255);
      count -= 8;
    }
  }
  return Buffer.from(bytes);
}

// Generate base32 secret
export function generateSecret(length = 16): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const randomBytes = crypto.randomBytes(length);
  let secret = '';
  for (let i = 0; i < length; i++) {
    secret += alphabet[randomBytes[i] % 32];
  }
  return secret;
}

// Generate TOTP code
export function generateTOTP(secret: string, time = Date.now(), step = 30): string {
  const key = base32Decode(secret);
  const epoch = Math.floor(time / 1000);
  const counter = Math.floor(epoch / step);

  const buf = Buffer.alloc(8);
  const high = Math.floor(counter / 0x100000000);
  const low = counter % 0x100000000;
  buf.writeUInt32BE(high, 0);
  buf.writeUInt32BE(low, 4);

  const hmac = crypto.createHmac('sha1', key);
  hmac.update(buf);
  const hmacResult = hmac.digest();

  const offset = hmacResult[hmacResult.length - 1] & 0xf;
  const binary =
    ((hmacResult[offset] & 0x7f) << 24) |
    ((hmacResult[offset + 1] & 0xff) << 16) |
    ((hmacResult[offset + 2] & 0xff) << 8) |
    (hmacResult[offset + 3] & 0xff);

  const otp = binary % 1_000_000;
  return String(otp).padStart(6, '0');
}

// Verify TOTP code
export function verifyTOTP(token: unknown, secret: string, window = 1, step = 30): boolean {
  const cleanedToken = String(token).trim();
  if (!/^\d{6}$/.test(cleanedToken)) {
    return false;
  }
  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    const calculated = generateTOTP(secret, now + i * step * 1000, step);
    if (calculated === cleanedToken) {
      return true;
    }
  }
  return false;
}

// Generate 10 random alphanumeric backup codes
export function generateBackupCodes(count = 10): string[] {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
  }
  return codes;
}

// Generate QR Code URL
export async function generateQrCodeDataUrl(username: string, secret: string): Promise<string> {
  const otpauthUrl = `otpauth://totp/36chan:${encodeURIComponent(username)}?secret=${secret}&issuer=36chan`;
  return QRCode.toDataURL(otpauthUrl);
}
