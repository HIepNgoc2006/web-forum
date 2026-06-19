// Live smoke test for the new AI capabilities against the configured provider.
// Reads GOOGLE_AI_API_KEY / GOOGLE_AI_MODEL from the repo-root .env, then exercises
// translate -> speak -> transcribe(the spoken audio) -> caption(describe+ocr).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiClient } from '../src/core/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const backend = path.resolve(here, '..');

// Minimal .env loader (mirrors server.js hand-parsing) for AI keys only.
for (const line of fs.readFileSync(path.join(backend, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const ai = createAiClient();
const log = (label, value) => console.log(`\n=== ${label} ===\n${value}`);

let exitCode = 0;
async function step(label, fn) {
  try {
    const out = await fn();
    log(`PASS ${label}`, typeof out === 'string' ? out : JSON.stringify(out).slice(0, 200));
    return out;
  } catch (error) {
    exitCode = 1;
    log(`FAIL ${label}`, `${error.message}`);
    return null;
  }
}

const translation = await step('translate VI->EN', () => ai.translate('Xin chào, đây là 36chan diễn đàn ẩn danh.', 'en'));

const spoken = await step('speak (TTS)', () => ai.speak('Xin chào 36chan, kiểm tra giọng nói.'));
if (spoken) {
  console.log(`   audio bytes: ${Buffer.from(spoken.data, 'base64').length}, mime: ${spoken.mimeType}`);
}

if (spoken) {
  await step('transcribe (the TTS audio)', () => ai.transcribe({ data: spoken.data, mimeType: spoken.mimeType }));
} else {
  const wavPath = path.join(here, 'silence.wav');
  if (fs.existsSync(wavPath)) {
    const wav = fs.readFileSync(wavPath).toString('base64');
    await step('transcribe (silence.wav, audio-path reachability)', () =>
      ai.transcribe({ data: wav, mimeType: 'audio/wav' })
    );
  }
}

const imgPath = path.join(root, 'home-top.png');
if (fs.existsSync(imgPath)) {
  const imageB64 = fs.readFileSync(imgPath).toString('base64');
  await step('caption describe (home-top.png)', () => ai.caption({ data: imageB64, mimeType: 'image/png' }, 'describe'));
  await step('caption OCR (home-top.png)', () => ai.caption({ data: imageB64, mimeType: 'image/png' }, 'ocr'));
} else {
  log('SKIP caption', 'home-top.png not found');
}

void translation;
process.exit(exitCode);
