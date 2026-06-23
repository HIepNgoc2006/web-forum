// GOOGLE_AI_MODEL is read dynamically from process.env to avoid module initialization ordering issues.

const MODERATION_SYSTEM_PROMPT = `
Bạn là bộ lọc kiểm duyệt trước khi đăng của 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Nhiệm vụ: phân loại nội dung công khai theo mức an toàn, không đoán danh tính người viết, không yêu cầu IP, không dùng dữ liệu ngoài phần nội dung.
Chỉ trả về JSON hợp lệ theo dạng: {"status":"Safe"|"Flagged","labels":["Toxic"|"Spam"|"Hate Speech"|"Fake News"|"PII Risk"],"confidence":0.0-1.0}.
Gắn Flagged khi nội dung có độc hại, spam, thù ghét, kích động bạo lực, quấy rối, lừa đảo, tin giả nguy hiểm, hoặc rủi ro lộ thông tin cá nhân.
Nếu an toàn, trả labels rỗng. Nếu không ước lượng được độ tin cậy, bỏ qua trường confidence.
`.trim();

const IMAGE_MODERATION_SYSTEM_PROMPT = `
Bạn là bộ lọc kiểm duyệt ảnh tải lên cho 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Nhiệm vụ: kiểm tra nội dung nhìn thấy trong ảnh và chữ trong ảnh (OCR), không đoán danh tính, không yêu cầu IP/token, không dùng dữ liệu ngoài ảnh.
Chỉ trả về JSON hợp lệ theo dạng: {"status":"Safe"|"Flagged","labels":["Toxic"|"Spam"|"Hate Speech"|"Fake News"|"PII Risk"|"Graphic Content"|"Sexual Content"|"Violence"|"Self-Harm"],"confidence":0.0-1.0}.
Gắn Flagged khi ảnh hoặc chữ trong ảnh có độc hại, spam, thù ghét, bạo lực, tự hại, nội dung tình dục không phù hợp, lừa đảo/tin giả nguy hiểm, hoặc rủi ro lộ thông tin cá nhân.
Nếu an toàn, trả labels rỗng. Nếu không ước lượng được độ tin cậy, bỏ qua trường confidence.
`.trim();

const SUMMARY_SYSTEM_PROMPT = `
Bạn là trợ lý tóm tắt cho 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Tóm tắt chỉ từ các bài viết công khai đã được ẩn danh hóa.
Viết bằng tiếng Việt tự nhiên, trung lập, ngắn gọn.
Trả về đúng 3-5 gạch đầu dòng, mỗi dòng là một ý chính.
Không bịa thêm thông tin, không đoán danh tính người viết, không kết luận vượt quá dữ liệu.
Nếu nội dung quá ít, nói rõ là chưa đủ dữ liệu để tóm tắt.
`.trim();

const SUGGEST_SYSTEM_PROMPT = `
Bạn là trợ lý gợi ý phản hồi cho 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Chỉ gợi ý bản nháp để người dùng tự chọn, không viết như đã đăng thay người dùng.
Viết 2-3 câu phản hồi ngắn, lịch sự, đúng ngữ cảnh, không công kích cá nhân.
Không yêu cầu dữ liệu cá nhân, không đoán danh tính, không tạo nội dung thù ghét hoặc quấy rối.
`.trim();

const REWRITE_NEUTRAL_PROMPT = `
Bạn là trợ lý viết lại bản nháp cho 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Nhiệm vụ: viết lại bản nháp theo tone TRUNG LẬP.
Yêu cầu: giữ văn phong khách quan, loại bỏ các từ ngữ mang tính phóng đại hoặc cảm tính cực đoan. Giữ ý chính nếu có thể, viết bằng tiếng Việt tự nhiên, ngắn gọn.
Chỉ trả về một bản nháp đã viết lại dưới dạng văn bản thường (plain text), không giải thích, không thêm bất kỳ tiền tố/hậu tố nào, không tự đăng thay người dùng.
`.trim();

const REWRITE_LESS_AGGRESSIVE_PROMPT = `
Bạn là trợ lý viết lại bản nháp cho 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Nhiệm vụ: viết lại bản nháp theo tone BỚT GAY GẮT.
Yêu cầu: làm dịu các từ ngữ thù địch, loại bỏ công kích cá nhân trực tiếp hoặc ngôn từ thóa mạ. Giữ ý chính nếu có thể, viết bằng tiếng Việt tự nhiên, ngắn gọn.
Chỉ trả về một bản nháp đã viết lại dưới dạng văn bản thường (plain text), không giải thích, không thêm bất kỳ tiền tố/hậu tố nào, không tự đăng thay người dùng.
`.trim();

const REWRITE_PRIVACY_SAFER_PROMPT = `
Bạn là trợ lý viết lại bản nháp cho 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Nhiệm vụ: viết lại bản nháp theo tone AN TOÀN RIÊNG TƯ.
Yêu cầu: loại bỏ hoàn toàn các thông tin nhạy cảm hoặc bối cảnh dễ suy đoán ra danh tính cá nhân. Giữ ý chính nếu có thể, viết bằng tiếng Việt tự nhiên, ngắn gọn.
Chỉ trả về một bản nháp đã viết lại dưới dạng văn bản thường (plain text), không giải thích, không thêm bất kỳ tiền tố/hậu tố nào, không tự đăng thay người dùng.
`.trim();

const REPORT_SUMMARY_SYSTEM_PROMPT = `
Bạn là trợ lý tổng hợp báo cáo vi phạm cho ban quản trị 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Nhiệm vụ: Tổng hợp danh sách lý do báo cáo của người dùng đối với một bài đăng thành một lý do tóm tắt ngắn gọn, rõ ràng.
Yêu cầu:
- Viết bằng tiếng Việt tự nhiên, trung lập, khách quan.
- Tóm tắt ngắn gọn các điểm chính bị người dùng khiếu nại (ví dụ: spam, công kích cá nhân, lộ thông tin...).
- TUYỆT ĐỐI không tự ý đưa ra quyết định kiểm duyệt (như xóa bài, khóa tài khoản...) hay đưa ra lời khuyên/hành động kiểm duyệt cụ thể. Chỉ trình bày lý do tóm tắt thô từ các báo cáo.
- Không bịa thêm thông tin, không tự đoán danh tính người viết/người báo cáo.
- Trả về kết quả ngắn gọn trong vòng 1-2 câu hoặc gạch đầu dòng ngắn.
`.trim();

const DUPLICATE_CHECK_SYSTEM_PROMPT = `
Bạn là trợ lý phát hiện chủ đề trùng lặp cho 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Nhiệm vụ:
- So sánh bài viết mới với danh sách chủ đề công khai cũ cùng bảng.
- Chỉ coi là trùng khi cùng một sự việc, câu chuyện, drama, hoặc lời thú nhận cụ thể một cách rõ rệt.
- Không coi là trùng nếu chỉ giống cảm xúc chung, thể loại câu hỏi, hoặc bối cảnh sinh viên phổ biến.
- Không đoán danh tính người viết, không suy luận thông tin cá nhân.
Chỉ trả về JSON hợp lệ theo dạng:
{"isDuplicate":true|false,"matchedThreadId":"id hoặc null","reason":"lý do ngắn bằng tiếng Việt hoặc null"}
`.trim();

const TRANSLATE_SYSTEM_PROMPT = `
Bạn là trợ lý dịch thuật cho 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Nhiệm vụ: dịch văn bản người dùng sang ngôn ngữ đích được yêu cầu.
Yêu cầu: giữ nguyên ý nghĩa, văn phong tự nhiên, không thêm bình luận hay giải thích.
Chỉ trả về bản dịch dưới dạng văn bản thường (plain text), không thêm tiền tố/hậu tố, không tự đăng thay người dùng.
`.trim();

const TRANSCRIBE_SYSTEM_PROMPT = `
Bạn là trợ lý gỡ băng (speech-to-text) cho 36chan.
Nhiệm vụ: chép lại chính xác lời nói trong audio thành văn bản.
Yêu cầu: giữ đúng ngôn ngữ gốc, không dịch, không thêm bình luận hay mô tả âm thanh.
Chỉ trả về phần lời thoại dưới dạng văn bản thường.
`.trim();

const CAPTION_DESCRIBE_SYSTEM_PROMPT = `
Bạn là trợ lý mô tả ảnh cho 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Nhiệm vụ: mô tả nội dung ảnh bằng tiếng Việt tự nhiên, ngắn gọn (1-3 câu).
Yêu cầu: chỉ mô tả những gì nhìn thấy, không đoán danh tính người trong ảnh, không suy diễn thông tin cá nhân.
Chỉ trả về phần mô tả dưới dạng văn bản thường.
`.trim();

const CAPTION_OCR_SYSTEM_PROMPT = `
Bạn là trợ lý trích xuất văn bản (OCR) cho 36chan.
Nhiệm vụ: trích xuất toàn bộ chữ nhìn thấy trong ảnh, giữ đúng thứ tự và ngôn ngữ gốc.
Yêu cầu: không dịch, không thêm bình luận. Nếu không có chữ nào, trả về chuỗi rỗng.
Chỉ trả về phần văn bản trích xuất dưới dạng văn bản thường.
`.trim();

const AUDIO_MIME_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/flac'
]);

// Wraps raw little-endian PCM (s16) in a minimal WAV container so browsers can play it
// from an <audio> element. Gemini TTS returns bare PCM (audio/L16), not a playable file.
function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Strips an optional `data:<mime>;base64,` prefix and returns the raw base64 payload.
function rawBase64(data = '') {
  const value = String(data);
  const comma = value.indexOf(',');
  return value.startsWith('data:') && comma !== -1 ? value.slice(comma + 1) : value;
}

function assertAudioMedia(media) {
  if (!media || typeof media.data !== 'string' || !media.data) {
    const error = new Error('Thiếu dữ liệu audio để xử lý.');
    error.statusCode = 400;
    throw error;
  }
  if (media.mimeType && !AUDIO_MIME_TYPES.has(media.mimeType)) {
    const error = new Error('Định dạng audio không được hỗ trợ.');
    error.statusCode = 415;
    throw error;
  }
}

function assertImageMedia(media) {
  if (!media || typeof media.data !== 'string' || !media.data) {
    const error = new Error('Thiếu dữ liệu ảnh để xử lý.');
    error.statusCode = 400;
    throw error;
  }
  if (media.mimeType && !String(media.mimeType).toLowerCase().startsWith('image/')) {
    const error = new Error('Định dạng ảnh không được hỗ trợ.');
    error.statusCode = 415;
    throw error;
  }
}

function notConfiguredError(message = 'Chưa cấu hình nhà cung cấp AI. Thêm khóa API vào backend/.env để dùng tính năng AI này.') {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

function heuristicModeration(text) {
  const normalized = text.toLowerCase();
  const rules = [
    { label: 'Spam', terms: ['http://', 'https://', 'telegram', 'free money', 'kiem tien'] },
    { label: 'Hate Speech', terms: ['thu han', 'diet chung', 'phan biet'] },
    {
      label: 'Fake News',
      terms: [
        'tin mat noi bo',
        '100% su that chua ai biet',
        'tin đồn',
        'tin don',
        'chưa kiểm chứng',
        'chua kiem chung',
        'bóc phốt',
        'boc phot',
        'lừa đảo',
        'lua dao',
        'ăn cắp',
        'an cap',
        'ngoại tình',
        'ngoai tinh'
      ]
    },
    { label: 'Toxic', terms: ['do ngu', 'chet di', 'oc cho', 'con me may'] }
  ];
  const labels = rules
    .filter((rule) => rule.terms.some((term) => normalized.includes(term)))
    .map((rule) => rule.label);
  const piiPatterns = [
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    /(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/,
    /\b(?:mssv|ma sinh vien|mã sinh viên|student id)\s*[:#-]?\s*[A-Z0-9]{5,}\b/i
  ];
  if (piiPatterns.some((pattern) => pattern.test(text)) && !labels.includes('PII Risk')) {
    labels.push('PII Risk');
  }

  return labels.length ? { status: 'Flagged', labels } : { status: 'Safe', labels: [] };
}

export function redactSensitiveText(text = '') {
  return String(text)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email da an]')
    .replace(/(?:\+?84|0)(?:[\s.-]?\d){8,10}\b/g, '[so dien thoai da an]')
    .replace(/\b(?:mssv|ma sinh vien|mã sinh viên|student id)\s*[:#-]?\s*[A-Z0-9]{5,}\b/gi, '[ma sinh vien da an]');
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Phản hồi AI không có JSON');
  }
  return JSON.parse(match[0]);
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = parsed > 1 ? parsed / 100 : parsed;
  return Math.min(1, Math.max(0, normalized));
}

function normalizeModerationResult(parsed = {}) {
  const labels = Array.isArray(parsed.labels)
    ? parsed.labels.map((label) => String(label ?? '').trim()).filter(Boolean)
    : [];
  const confidence = normalizeConfidence(parsed.confidence ?? parsed.confidenceScore ?? parsed.score);
  const result =
    parsed.status === 'Flagged'
      ? { status: 'Flagged', labels }
      : { status: 'Safe', labels: [] };
  return confidence === undefined ? result : { ...result, confidence };
}

function bulletize(text, limit = 5) {
  return text
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function duplicatePrompt(newBody, existingThreads = []) {
  const threadsText = existingThreads
    .map((thread, index) => {
      return [
        `#${index + 1}`,
        `Thread ID: ${thread.id}`,
        `Nội dung: ${redactSensitiveText(thread.body)}`
      ].join('\n');
    })
    .join('\n---\n');
  return `
New Thread Content:
${redactSensitiveText(newBody)}

Existing Threads:
${threadsText}
`.trim();
}

function normalizeDuplicateResult(parsed = {}) {
  return {
    isDuplicate: Boolean(parsed.isDuplicate),
    matchedThreadId: parsed.matchedThreadId ? String(parsed.matchedThreadId) : null,
    reason: parsed.reason ? String(parsed.reason).slice(0, 300) : null
  };
}

function extractGoogleAudioData(data = {}) {
  const outputAudio = data.interaction?.output_audio ?? data.output_audio;
  if (outputAudio?.data) {
    return {
      data: outputAudio.data,
      mimeType: outputAudio.mime_type ?? outputAudio.mimeType ?? 'audio/pcm;rate=24000'
    };
  }

  const inline = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData;
  return inline?.data
    ? {
        data: inline.data,
        mimeType: inline.mimeType ?? inline.mime_type ?? 'audio/pcm;rate=24000'
      }
    : null;
}

async function transcribeOpenAiCompatible({ media, apiKey, baseUrl, model }) {
  assertAudioMedia(media);
  const bytes = Buffer.from(rawBase64(media.data), 'base64');
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: media.mimeType ?? 'audio/mpeg' }), media.filename ?? 'audio.mp3');
  form.append('model', model);
  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!response.ok) {
    throw new Error(`Yêu cầu gỡ băng thất bại: ${response.status}`);
  }
  const data = await response.json();
  return String(data.text ?? '').trim();
}

function createTranscribeOverride() {
  const provider = process.env.TRANSCRIBE_PROVIDER;
  if (!provider) {
    return null;
  }
  if (provider !== 'openai-compatible') {
    const error = new Error('TRANSCRIBE_PROVIDER hiện chỉ hỗ trợ openai-compatible.');
    error.statusCode = 503;
    return {
      async transcribe() {
        throw error;
      }
    };
  }

  const apiKey =
    process.env.TRANSCRIBE_API_KEY ||
    process.env.GROQ_API_KEY ||
    process.env.OPENAI_COMPATIBLE_API_KEY ||
    process.env.OPENAI_API_KEY;
  const baseUrl = process.env.TRANSCRIBE_BASE_URL || process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.OPENAI_BASE_URL;
  const model = process.env.TRANSCRIBE_MODEL || process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';

  if (!apiKey || !baseUrl) {
    const error = new Error(
      'Chưa cấu hình speech-to-text provider. Thêm TRANSCRIBE_API_KEY và TRANSCRIBE_BASE_URL vào backend/.env.'
    );
    error.statusCode = 503;
    return {
      async transcribe() {
        throw error;
      }
    };
  }

  return {
    async transcribe(media) {
      return transcribeOpenAiCompatible({ media, apiKey, baseUrl, model });
    }
  };
}

function withTranscribeOverride(client) {
  const override = createTranscribeOverride();
  return override ? { ...client, transcribe: override.transcribe } : client;
}

// Google AI Provider
function createGoogleProvider() {
  function requireGoogleAiKey() {
    const apiKey = process.env.GOOGLE_AI_API_KEY;
    if (!apiKey) {
      const error = new Error('Chưa cấu hình Google AI Studio. Thêm GOOGLE_AI_API_KEY vào backend/.env để dùng tính năng AI này.');
      error.statusCode = 503;
      throw error;
    }
    return apiKey;
  }

  async function generateContent(parts, systemPrompt, { model, generationConfig } = {}) {
    const apiKey = requireGoogleAiKey();
    const selectedModel = model ?? process.env.GOOGLE_AI_MODEL ?? 'gemini-1.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.3, ...generationConfig }
    };
    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      throw new Error(`Yêu cầu Google AI thất bại: ${response.status}`);
    }
    return response.json();
  }

  function textFromResponse(data) {
    return data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join('\n') ?? '';
  }

  async function generate(prompt, systemPrompt) {
    return textFromResponse(await generateContent([{ text: prompt }], systemPrompt));
  }

  return {
    async moderate(text) {
      try {
        const result = await generate(`
Nội dung:
${redactSensitiveText(text)}
`, MODERATION_SYSTEM_PROMPT);
        return normalizeModerationResult(extractJson(result));
      } catch {
        return heuristicModeration(text);
      }
    },

    async moderateImage(media) {
      assertImageMedia(media);
      try {
        const data = await generateContent(
          [
            { inlineData: { mimeType: media.mimeType ?? 'image/png', data: rawBase64(media.data) } },
            { text: 'Kiểm duyệt ảnh tải lên này, bao gồm chữ nhìn thấy trong ảnh.' }
          ],
          IMAGE_MODERATION_SYSTEM_PROMPT,
          { generationConfig: { temperature: 0 } }
        );
        return normalizeModerationResult(extractJson(textFromResponse(data)));
      } catch {
        return { status: 'Safe', labels: [] };
      }
    },

    async summarize(items) {
      const text = items.map((item, index) => `${index + 1}. ${redactSensitiveText(item.body)}`).join('\n');
      const result = await generate(`
Nội dung:
${text}
`, SUMMARY_SYSTEM_PROMPT);
      return bulletize(result, 5);
    },

    async suggest(contextItems) {
      const text = contextItems.map((item) => redactSensitiveText(item.body)).join('\n');
      const result = await generate(`
Ngữ cảnh:
${text}
`, SUGGEST_SYSTEM_PROMPT);
      return bulletize(result, 3);
    },

    async rewrite(text, tone = 'neutral') {
      let prompt = REWRITE_NEUTRAL_PROMPT;
      if (tone === 'less-aggressive') {
        prompt = REWRITE_LESS_AGGRESSIVE_PROMPT;
      } else if (tone === 'privacy-safer') {
        prompt = REWRITE_PRIVACY_SAFER_PROMPT;
      }
      return (
        await generate(`
Bản nháp:
${redactSensitiveText(text)}
`, prompt)
      ).trim();
    },

    async summarizeReports(reasons) {
      const text = reasons.map((reason, index) => `${index + 1}. ${redactSensitiveText(reason)}`).join('\n');
      const result = await generate(`
Danh sách lý do báo cáo:
${text}
`, REPORT_SUMMARY_SYSTEM_PROMPT);
      return result.trim();
    },

    async checkDuplicateThread(newBody, existingThreads = []) {
      if (!existingThreads.length) {
        return { isDuplicate: false, matchedThreadId: null, reason: null };
      }
      const result = await generate(duplicatePrompt(newBody, existingThreads), DUPLICATE_CHECK_SYSTEM_PROMPT);
      return normalizeDuplicateResult(extractJson(result));
    },

    async translate(text, targetLang = 'vi') {
      const result = await generate(`
Ngôn ngữ đích: ${targetLang}
Văn bản cần dịch:
${redactSensitiveText(text)}
`, TRANSLATE_SYSTEM_PROMPT);
      return result.trim();
    },

    async transcribe(media) {
      assertAudioMedia(media);
      const data = await generateContent(
        [
          { inlineData: { mimeType: media.mimeType ?? 'audio/mpeg', data: rawBase64(media.data) } },
          { text: 'Chép lại toàn bộ lời nói trong audio này.' }
        ],
        TRANSCRIBE_SYSTEM_PROMPT
      );
      return textFromResponse(data).trim();
    },

    async caption(media, mode = 'describe') {
      assertImageMedia(media);
      const systemPrompt = mode === 'ocr' ? CAPTION_OCR_SYSTEM_PROMPT : CAPTION_DESCRIBE_SYSTEM_PROMPT;
      const instruction = mode === 'ocr' ? 'Trích xuất toàn bộ chữ trong ảnh này.' : 'Mô tả nội dung ảnh này.';
      const data = await generateContent(
        [
          { inlineData: { mimeType: media.mimeType ?? 'image/png', data: rawBase64(media.data) } },
          { text: instruction }
        ],
        systemPrompt
      );
      return textFromResponse(data).trim();
    },

    async speak(text, { voice } = {}) {
      // Use Gemini's native TTS through the Interactions API so the AI Studio key
      // works with current TTS models without Cloud Text-to-Speech credentials.
      const apiKey = requireGoogleAiKey();
      const model = process.env.GOOGLE_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
      const endpoint = 'https://generativelanguage.googleapis.com/v1beta/interactions';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          model,
          input: `Đọc to đoạn văn sau bằng giọng tự nhiên:\n${redactSensitiveText(text)}`,
          response_format: { type: 'audio' },
          generation_config: {
            speech_config: { voice_config: [{ voice: voice || 'Kore' }] }
          }
        })
      });
      if (!response.ok) {
        throw new Error(`Yêu cầu Google TTS thất bại: ${response.status}`);
      }
      const data = await response.json();
      const audio = extractGoogleAudioData(data);
      if (!audio?.data) {
        throw new Error('Google TTS không trả về audio.');
      }
      const sampleRate = Number(/rate=(\d+)/.exec(audio.mimeType ?? '')?.[1]) || 24000;
      const pcm = Buffer.from(audio.data, 'base64');
      return { data: pcmToWav(pcm, sampleRate).toString('base64'), mimeType: 'audio/wav' };
    }
  };
}

// OpenAI-compatible Provider
function createOpenAiCompatibleProvider() {
  const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL || process.env.OPENAI_BASE_URL;
  const model = process.env.OPENAI_COMPATIBLE_MODEL || process.env.OPENAI_MODEL || 'gpt-4-turbo';

  if (!apiKey || !baseUrl) {
    const error = new Error('Chưa cấu hình OpenAI-compatible provider. Thêm OPENAI_COMPATIBLE_API_KEY và OPENAI_COMPATIBLE_BASE_URL vào backend/.env để dùng tính năng AI này.');
    error.statusCode = 503;
    return {
      async moderate() {
        throw error;
      },
      async moderateImage() {
        throw error;
      },
      async summarize() {
        throw error;
      },
      async suggest() {
        throw error;
      },
      async rewrite() {
        throw error;
      },
      async summarizeReports() {
        throw error;
      },
      async checkDuplicateThread() {
        throw error;
      },
      async translate() {
        throw error;
      },
      async transcribe() {
        throw error;
      },
      async caption() {
        throw error;
      },
      async speak() {
        throw error;
      }
    };
  }

  async function generate(prompt, systemPrompt) {
    const endpoint = `${baseUrl}/chat/completions`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`Yêu cầu AI thất bại: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  return {
    async moderate(text) {
      try {
        const result = await generate(`
Nội dung:
${redactSensitiveText(text)}
`, MODERATION_SYSTEM_PROMPT);
        return normalizeModerationResult(extractJson(result));
      } catch {
        return heuristicModeration(text);
      }
    },

    async moderateImage(media) {
      assertImageMedia(media);
      const visionModel = process.env.OPENAI_VISION_MODEL || model;
      const dataUrl = `data:${media.mimeType ?? 'image/png'};base64,${rawBase64(media.data)}`;
      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: visionModel,
            messages: [
              { role: 'system', content: IMAGE_MODERATION_SYSTEM_PROMPT },
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'Kiểm duyệt ảnh tải lên này, bao gồm chữ nhìn thấy trong ảnh.' },
                  { type: 'image_url', image_url: { url: dataUrl } }
                ]
              }
            ],
            temperature: 0
          })
        });
        if (!response.ok) {
          throw new Error(`Yêu cầu kiểm duyệt ảnh thất bại: ${response.status}`);
        }
        const data = await response.json();
        return normalizeModerationResult(extractJson(String(data.choices?.[0]?.message?.content ?? '')));
      } catch {
        return { status: 'Safe', labels: [] };
      }
    },

    async summarize(items) {
      const text = items.map((item, index) => `${index + 1}. ${redactSensitiveText(item.body)}`).join('\n');
      const result = await generate(`
Nội dung:
${text}
`, SUMMARY_SYSTEM_PROMPT);
      return bulletize(result, 5);
    },

    async suggest(contextItems) {
      const text = contextItems.map((item) => redactSensitiveText(item.body)).join('\n');
      const result = await generate(`
Ngữ cảnh:
${text}
`, SUGGEST_SYSTEM_PROMPT);
      return bulletize(result, 3);
    },

    async rewrite(text, tone = 'neutral') {
      let prompt = REWRITE_NEUTRAL_PROMPT;
      if (tone === 'less-aggressive') {
        prompt = REWRITE_LESS_AGGRESSIVE_PROMPT;
      } else if (tone === 'privacy-safer') {
        prompt = REWRITE_PRIVACY_SAFER_PROMPT;
      }
      return (
        await generate(`
Bản nháp:
${redactSensitiveText(text)}
`, prompt)
      ).trim();
    },

    async summarizeReports(reasons) {
      const text = reasons.map((reason, index) => `${index + 1}. ${redactSensitiveText(reason)}`).join('\n');
      const result = await generate(`
Danh sách lý do báo cáo:
${text}
`, REPORT_SUMMARY_SYSTEM_PROMPT);
      return result.trim();
    },

    async checkDuplicateThread(newBody, existingThreads = []) {
      if (!existingThreads.length) {
        return { isDuplicate: false, matchedThreadId: null, reason: null };
      }
      const result = await generate(duplicatePrompt(newBody, existingThreads), DUPLICATE_CHECK_SYSTEM_PROMPT);
      return normalizeDuplicateResult(extractJson(result));
    },

    async translate(text, targetLang = 'vi') {
      const result = await generate(`
Ngôn ngữ đích: ${targetLang}
Văn bản cần dịch:
${redactSensitiveText(text)}
`, TRANSLATE_SYSTEM_PROMPT);
      return result.trim();
    },

    async transcribe(media) {
      const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1';
      return transcribeOpenAiCompatible({ media, apiKey, baseUrl, model: transcribeModel });
    },

    async caption(media, mode = 'describe') {
      assertImageMedia(media);
      const visionModel = process.env.OPENAI_VISION_MODEL || model;
      const systemPrompt = mode === 'ocr' ? CAPTION_OCR_SYSTEM_PROMPT : CAPTION_DESCRIBE_SYSTEM_PROMPT;
      const instruction = mode === 'ocr' ? 'Trích xuất toàn bộ chữ trong ảnh này.' : 'Mô tả nội dung ảnh này.';
      const dataUrl = `data:${media.mimeType ?? 'image/png'};base64,${rawBase64(media.data)}`;
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: visionModel,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                { type: 'text', text: instruction },
                { type: 'image_url', image_url: { url: dataUrl } }
              ]
            }
          ],
          temperature: 0.3
        })
      });
      if (!response.ok) {
        throw new Error(`Yêu cầu mô tả ảnh thất bại: ${response.status}`);
      }
      const data = await response.json();
      return String(data.choices?.[0]?.message?.content ?? '').trim();
    },

    async speak(text, { voice = 'alloy' } = {}) {
      const ttsModel = process.env.OPENAI_TTS_MODEL || 'tts-1';
      const response = await fetch(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: ttsModel,
          input: redactSensitiveText(text),
          voice,
          response_format: 'mp3'
        })
      });
      if (!response.ok) {
        throw new Error(`Yêu cầu chuyển văn bản thành giọng nói thất bại: ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      return { data: buffer.toString('base64'), mimeType: 'audio/mpeg' };
    }
  };
}

export function createAiClient() {
  const explicitProvider = process.env.AI_PROVIDER;
  let client = null;

  if (explicitProvider === 'openai-compatible') {
    client = createOpenAiCompatibleProvider();
  } else if (explicitProvider === 'google' || explicitProvider === 'google-ai-studio') {
    client = createGoogleProvider();
  }

  // Auto-detect based on configured keys
  if (!client && process.env.GOOGLE_AI_API_KEY) {
    client = createGoogleProvider();
  }

  if (
    !client &&
    ((process.env.OPENAI_COMPATIBLE_API_KEY && process.env.OPENAI_COMPATIBLE_BASE_URL) ||
      (process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL))
  ) {
    client = createOpenAiCompatibleProvider();
  }

  // Fallback with Google AI Studio warnings/errors for backward compatibility
  client = client ?? {
    async moderate(text) {
      return heuristicModeration(text);
    },
    async moderateImage() {
      throw notConfiguredError();
    },
    async summarize() {
      const error = new Error('Chưa cấu hình Google AI Studio. Thêm GOOGLE_AI_API_KEY vào backend/.env để dùng tính năng AI này.');
      error.statusCode = 503;
      throw error;
    },
    async suggest() {
      const error = new Error('Chưa cấu hình Google AI Studio. Thêm GOOGLE_AI_API_KEY vào backend/.env để dùng tính năng AI này.');
      error.statusCode = 503;
      throw error;
    },
    async rewrite() {
      const error = new Error('Chưa cấu hình Google AI Studio. Thêm GOOGLE_AI_API_KEY vào backend/.env để dùng tính năng AI này.');
      error.statusCode = 503;
      throw error;
    },
    async summarizeReports() {
      const error = new Error('Chưa cấu hình Google AI Studio. Thêm GOOGLE_AI_API_KEY vào backend/.env để dùng tính năng AI này.');
      error.statusCode = 503;
      throw error;
    },
    async checkDuplicateThread() {
      return { isDuplicate: false, matchedThreadId: null, reason: null };
    },
    async translate() {
      throw notConfiguredError();
    },
    async transcribe() {
      throw notConfiguredError();
    },
    async caption() {
      throw notConfiguredError();
    },
    async speak() {
      throw notConfiguredError();
    }
  };

  return withTranscribeOverride(client);
}
