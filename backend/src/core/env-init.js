import fs from 'node:fs';

try {
  const raw = fs.readFileSync('.env', 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const [key, ...rest] = trimmed.split('=');
    if (!process.env[key]) {
      process.env[key] = rest.join('=').replace(/^"|"$/g, '');
    }
  }
} catch {
  // .env is optional
}
