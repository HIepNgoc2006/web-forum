import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(packageRoot, 'public');

const svg192 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" width="192" height="192">
  <rect width="192" height="192" rx="36" fill="#121214"/>
  <g transform="translate(96 84) scale(2.8)">
    <path d="M0 -15 C-12 -28 -28 -12 -15 0 C-28 12 -12 28 0 15 C12 28 28 12 15 0 C28 -12 12 -28 0 -15 Z" fill="#22c55e"/>
  </g>
  <text x="96" y="152" text-anchor="middle" font-family="Arial, sans-serif" font-size="32" font-weight="bold" fill="#ffffff">36chan</text>
</svg>`;

const svg512 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#121214"/>
  <g transform="translate(256 224) scale(7.5)">
    <path d="M0 -15 C-12 -28 -28 -12 -15 0 C-28 12 -12 28 0 15 C12 28 28 12 15 0 C28 -12 12 -28 0 -15 Z" fill="#22c55e"/>
  </g>
  <text x="256" y="410" text-anchor="middle" font-family="Arial, sans-serif" font-size="84" font-weight="bold" fill="#ffffff">36chan</text>
</svg>`;

await sharp(Buffer.from(svg192)).png().toFile(path.join(publicDir, 'icon-192.png'));
await sharp(Buffer.from(svg512)).png().toFile(path.join(publicDir, 'icon-512.png'));

console.log('Successfully generated icon-192.png and icon-512.png in frontend/public');
