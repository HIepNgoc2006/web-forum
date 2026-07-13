/**
 * Unofficial Google Translate web endpoint used as a free fallback when no AI
 * provider is configured. This is not Cloud Translation and may break or rate-limit.
 *
 * Endpoint pattern shared by community clients (e.g. lnreader GoogleTranslateFreeEngine).
 */

type TranslateError = Error & {
  statusCode?: number;
};

const TRANSLATE_ENDPOINT = 'https://translate-pa.googleapis.com/v1/translateHtml';
/** Public browser client key used by Google Translate web; overridable via env. */
const DEFAULT_FREE_API_KEY = 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520';
const MAX_CHUNK_LENGTH = 10_000;
const MAX_RETRIES = 5;
const FETCH_TIMEOUT_MS = 20_000;

const ALLOWED_TARGET_LANGS = new Set(['vi', 'en', 'ja', 'ko', 'zh', 'fr', 'es', 'de', 'th']);

function freeApiKey(): string {
  return String(process.env.GOOGLE_TRANSLATE_FREE_API_KEY || DEFAULT_FREE_API_KEY).trim();
}

export function normalizeTranslateTargetLang(targetLang: unknown = 'vi'): string {
  const lang = String(targetLang || 'vi').trim().toLowerCase();
  return ALLOWED_TARGET_LANGS.has(lang) ? lang : 'vi';
}

function decodeHtmlEntities(value: string): string {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&amp;/gi, '&')
    .trim();
}

function chunkTexts(texts: string[]): { textArray: string[]; indices: number[] }[] {
  const chunks: { textArray: string[]; indices: number[] }[] = [];
  let currentChunkTexts: string[] = [];
  let currentIndices: number[] = [];
  let currentLength = 0;

  for (let i = 0; i < texts.length; i += 1) {
    const text = texts[i];
    if (!text || !String(text).trim()) {
      continue;
    }

    if (currentLength + text.length > MAX_CHUNK_LENGTH && currentChunkTexts.length > 0) {
      chunks.push({ textArray: currentChunkTexts, indices: currentIndices });
      currentChunkTexts = [text];
      currentIndices = [i];
      currentLength = text.length;
    } else {
      currentChunkTexts.push(text);
      currentIndices.push(i);
      currentLength += text.length;
    }
  }

  if (currentChunkTexts.length > 0) {
    chunks.push({ textArray: currentChunkTexts, indices: currentIndices });
  }
  return chunks;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error('Dịch thuật quá thời gian chờ. Vui lòng thử lại.') as TranslateError;
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translateChunk(
  textArray: string[],
  source: string,
  target: string
): Promise<string[]> {
  let retryCount = 0;

  while (true) {
    const response = await fetchWithTimeout(TRANSLATE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json+protobuf',
        'x-goog-api-key': freeApiKey()
      },
      body: JSON.stringify([[textArray, source, target], 'te'])
    });

    if (response.status === 429) {
      if (retryCount >= MAX_RETRIES) {
        const error = new Error('Dịch thuật đang bị giới hạn (rate limit). Thử lại sau.') as TranslateError;
        error.statusCode = 429;
        throw error;
      }
      retryCount += 1;
      await delay(1000 * retryCount);
      continue;
    }

    if (!response.ok) {
      const error = new Error(`Dịch thuật thất bại: ${response.status}`) as TranslateError;
      error.statusCode = response.status >= 500 ? 502 : 502;
      throw error;
    }

    const data = (await response.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      const error = new Error('Phản hồi dịch thuật không hợp lệ.') as TranslateError;
      error.statusCode = 502;
      throw error;
    }

    const translated = data[0] as unknown[];
    if (translated.length !== textArray.length) {
      const error = new Error('Phản hồi dịch thuật không khớp độ dài đầu vào.') as TranslateError;
      error.statusCode = 502;
      throw error;
    }

    return translated.map((item) => decodeHtmlEntities(String(item ?? '')));
  }
}

/**
 * Translate one or more strings. Empty strings are preserved in-place.
 */
export async function translateTextsWithGoogleFree(
  texts: string[],
  targetLang: string = 'vi',
  sourceLang: string = 'auto'
): Promise<string[]> {
  const target = normalizeTranslateTargetLang(targetLang);
  const source = String(sourceLang || 'auto').trim() || 'auto';
  const results = texts.map((text) => String(text ?? ''));
  const chunks = chunkTexts(results);

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const translated = await translateChunk(chunk.textArray, source, target);
    chunk.indices.forEach((originalIndex, innerIdx) => {
      results[originalIndex] = translated[innerIdx] ?? results[originalIndex];
    });
    if (i + 1 < chunks.length) {
      await delay(200);
    }
  }

  return results;
}

export async function translateWithGoogleFree(
  text: string,
  targetLang: string = 'vi',
  sourceLang: string = 'auto'
): Promise<string> {
  const input = String(text ?? '');
  if (!input.trim()) {
    return '';
  }
  const [translated] = await translateTextsWithGoogleFree([input], targetLang, sourceLang);
  return translated ?? '';
}
