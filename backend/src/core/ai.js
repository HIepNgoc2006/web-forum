const DEFAULT_MODEL = process.env.GOOGLE_AI_MODEL ?? 'gemini-1.5-flash';

const MODERATION_SYSTEM_PROMPT = `
Bạn là bộ lọc kiểm duyệt trước khi đăng của 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Nhiệm vụ: phân loại nội dung công khai theo mức an toàn, không đoán danh tính người viết, không yêu cầu IP, không dùng dữ liệu ngoài phần nội dung.
Chỉ trả về JSON hợp lệ theo dạng: {"status":"Safe"|"Flagged","labels":["Toxic"|"Spam"|"Hate Speech"|"Fake News"|"PII Risk"]}.
Gắn Flagged khi nội dung có độc hại, spam, thù ghét, kích động bạo lực, quấy rối, lừa đảo, tin giả nguy hiểm, hoặc rủi ro lộ thông tin cá nhân.
Nếu an toàn, trả labels rỗng.
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

const REWRITE_SYSTEM_PROMPT = `
Bạn là trợ lý viết lại bản nháp cho 36chan, diễn đàn ảnh ẩn danh cho sinh viên Việt Nam.
Viết lại nội dung sao cho an toàn hơn trước khi đăng: bỏ thông tin cá nhân, giảm cáo buộc chưa kiểm chứng, bỏ công kích/quấy rối.
Giữ ý chính nếu có thể, viết bằng tiếng Việt tự nhiên, ngắn gọn.
Chỉ trả về một bản nháp đã viết lại, không giải thích, không tự đăng thay người dùng.
`.trim();

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

function requireGoogleAiKey() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    const error = new Error('Chưa cấu hình Google AI Studio. Thêm GOOGLE_AI_API_KEY vào backend/.env để dùng tính năng AI này.');
    error.statusCode = 503;
    throw error;
  }
  return apiKey;
}

async function generateWithGoogle(prompt, systemPrompt) {
  const apiKey = requireGoogleAiKey();

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 }
    })
  });
  if (!response.ok) {
    throw new Error(`Yêu cầu Google AI thất bại: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n') ?? '';
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Phản hồi AI không có JSON');
  }
  return JSON.parse(match[0]);
}

function bulletize(text, limit = 5) {
  return text
    .split('\n')
    .map((line) => line.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function createAiClient() {
  return {
    async moderate(text) {
      if (!process.env.GOOGLE_AI_API_KEY) {
        return heuristicModeration(text);
      }

      try {
        const result = await generateWithGoogle(`
Nội dung:
${redactSensitiveText(text)}
`, MODERATION_SYSTEM_PROMPT);
        const parsed = extractJson(result);
        const labels = Array.isArray(parsed.labels) ? parsed.labels : [];
        return parsed.status === 'Flagged'
          ? { status: 'Flagged', labels }
          : { status: 'Safe', labels: [] };
      } catch {
        return heuristicModeration(text);
      }
    },

    async summarize(items) {
      const text = items.map((item, index) => `${index + 1}. ${redactSensitiveText(item.body)}`).join('\n');
      const result = await generateWithGoogle(`
Nội dung:
${text}
`, SUMMARY_SYSTEM_PROMPT);
      return bulletize(result, 5);
    },

    async suggest(contextItems) {
      const text = contextItems.map((item) => redactSensitiveText(item.body)).join('\n');
      const result = await generateWithGoogle(`
Ngữ cảnh:
${text}
`, SUGGEST_SYSTEM_PROMPT);
      return bulletize(result, 3);
    },

    async rewrite(text) {
      return (
        await generateWithGoogle(`
Bản nháp:
${redactSensitiveText(text)}
`, REWRITE_SYSTEM_PROMPT)
      ).trim();
    }
  };
}
