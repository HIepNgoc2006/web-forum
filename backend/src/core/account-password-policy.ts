import crypto from 'node:crypto';

type PasswordPolicyError = Error & {
  statusCode?: number;
};

type PasswordPolicyOptions = {
  username?: string;
};

const MIN_PASSWORD_LENGTH = 10;
const MAX_PASSWORD_LENGTH = 160;

// These fingerprints are only a local blocklist representation, not stored
// account password hashes. Common-password detection remains case-insensitive.
const COMMON_PASSWORD_SHA256 = new Set([
  '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
  '0b14d501a594442a01c6859541bcb3e8164d183d32937b851835442f69d5c94e',
  'b3d17ebbe4f2b75d27b6309cfaae1487b667301a73951e7d523a039cd2dfe110',
  'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f',
  '8f0e2f76e22b43e2855189877e7dc1e1e7d98c226c95db247cd1d547928334a9',
  'c775e7b757ede630cd0aa1113bd102661ab38829ca52a6422ab782862f268646',
  '84d89877f0d4041efb6bf91a16f0248f2fd573e6af05c19f96bedb9f882f7882',
  'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f',
  '15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225',
  '932f3c1b56257ce8539ac269d7aab42550dacf8818d075f0bdf1990562aae3ef',
  '9a900403ac313ba27a1bc81f0932652b8020dac92c234d98fa0b06bf0040ecfd',
  'daaad6e5604e8e17bd9f108d91e26afe6281dac8fda0091040a7a6d7bd9b43b5',
  '69f5b43fa4a7ec67cc1e0aac24cc739f1273dbe1579d6f6439ed78405a15326d',
  '9b0eb22aef89516d6fb4b31ccf008a68abe0d10a3fc606316389613eccf96854',
  'a68349561396ec264a350847024a4521d00beaa3358660c2709a80f31c7acdd0',
  '41e5653fc7aeb894026d6bb7b2db7f65902b454945fa8fd65a6327047b5277fb',
  '3cebb057b0b49e5e41fcbe85d0546d316297b3ac8e7e2a16f9e098ddb8aa32ab',
  'f423a21ae763900c1c45ad85775ad2f625ddbdb9c33bf9bf0950957bca3f62f5',
  '5ace4981999e9122e593ecb67311be9b4e87ea7f97d806b782a9f8c6ac0a6807',
  '421e6d60ea8fa984281ff0710c8e8005471c58e218c25016c2c0643e5ad0336d',
  'b117ef94c554ede113d1296020dc9a5078826e1b27762f49fbbda8445b6a02f2',
  '6968fd41cd89f4b46eca4dbaea58978650b7b57495aead10cfe49b8cc0d2e3cd',
  '762daeeccf4aee2077fa9d1b7a0b7adac2201b00c96459fcdca387c797729408',
  'e76ef5923a42fe221d21972ccc5042e16bed81b0429e910b2fa895dee3ac9692',
  '270ecbea2ea035072bd9c5ce4d19c561c5e24a20242b30a5909e297858e228d3'
]);

function badRequest(message: string): PasswordPolicyError {
  const error = new Error(message) as PasswordPolicyError;
  error.statusCode = 400;
  return error;
}

function isCommonPassword(value: string): boolean {
  const fingerprint = crypto.createHash('sha256').update(value).digest('hex');
  return COMMON_PASSWORD_SHA256.has(fingerprint);
}

function isTrivialSequence(value: string): boolean {
  if (value.length < 2) {
    return false;
  }
  let ascending = true;
  let descending = true;
  for (let i = 1; i < value.length; i += 1) {
    const delta = value.charCodeAt(i) - value.charCodeAt(i - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
  }
  return ascending || descending;
}

export function assertAccountPassword(
  value = '',
  { username = '' }: PasswordPolicyOptions = {}
): string {
  const password = String(value ?? '');
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw badRequest('Mật khẩu cần từ 10 đến 160 ký tự');
  }
  const lower = password.toLowerCase();
  if (isCommonPassword(lower)) {
    throw badRequest('Mật khẩu quá phổ biến, vui lòng chọn mật khẩu khác');
  }
  if (username && lower === String(username).toLowerCase()) {
    throw badRequest('Mật khẩu không được trùng với tên tài khoản');
  }
  if (/^(.)\1+$/.test(password) || isTrivialSequence(lower)) {
    throw badRequest('Mật khẩu quá đơn giản, vui lòng chọn mật khẩu khác');
  }
  return password;
}
