import { escapeHtml } from './format';
import type { AnyRecord } from './types';

function asLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((line) => String(line || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

function fillPolicyList(key: string, lines: string[]) {
  const list = document.querySelector(`[data-policy-list="${key}"]`);
  if (!list || !lines.length) {
    return;
  }
  list.replaceChildren(
    ...lines.map((line) => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    })
  );
}

function fillPolicyText(key: string, text: string) {
  if (!text) {
    return;
  }
  document.querySelectorAll(`[data-policy-text="${key}"]`).forEach((node) => {
    node.textContent = text;
  });
}

export function applySiteContent(content: AnyRecord = {}) {
  const title = String(content.policyTitle || '').trim();
  const subtitle = String(content.policySubtitle || '').trim();
  if (title) {
    document.querySelectorAll('[data-policy-title]').forEach((node) => {
      node.textContent = title;
    });
  }
  if (subtitle) {
    document.querySelectorAll('[data-policy-subtitle]').forEach((node) => {
      node.textContent = subtitle;
    });
  }

  fillPolicyList('rules', asLines(content.rules));
  fillPolicyList('privacy', asLines(content.privacy));
  fillPolicyList('ai', asLines(content.ai));
  fillPolicyList('report', asLines(content.report));
  fillPolicyList('feedback', asLines(content.feedback));
  fillPolicyList('contact', asLines(content.contact));
  fillPolicyText('appealIntro', String(content.appealIntro || '').trim());
  fillPolicyText('pii', String(content.pii || '').trim());
}

export function createSiteContentController({ api, state }: AnyRecord) {
  let loadedAt = 0;
  let inflight: Promise<AnyRecord> | null = null;

  async function loadSiteContent({ force = false }: AnyRecord = {}) {
    if (!force && state.siteContent && Date.now() - loadedAt < 30_000) {
      return state.siteContent;
    }
    if (inflight) {
      return inflight;
    }
    inflight = api('/api/site-content')
      .then((content: AnyRecord) => {
        state.siteContent = content;
        loadedAt = Date.now();
        applySiteContent(content);
        return content;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  async function loadPolicy() {
    try {
      await loadSiteContent();
    } catch (error) {
      console.warn('Không tải được nội dung chính sách:', error);
      if (state.siteContent) {
        applySiteContent(state.siteContent);
      }
    }
  }

  return {
    loadSiteContent,
    loadPolicy,
    applySiteContent
  };
}

export function adminSiteContentHtml(content: AnyRecord = {}) {
  return `
    <div class="admin-site-content" data-admin-site-content>
      <section class="admin-board-create">
        <h2>Nội dung trang /policy/</h2>
        <p class="muted">Owner có thể chỉnh toàn bộ copy public của trang chính sách. Mỗi dòng trong ô danh sách là một mục.</p>
        <div class="admin-board-create-grid admin-site-content-grid">
          <label class="admin-site-content-wide"><span>Tiêu đề</span><input data-admin-site-policy-title maxlength="120" value="${escapeHtml(content.policyTitle || '')}" /></label>
          <label class="admin-site-content-wide"><span>Mô tả ngắn</span><textarea data-admin-site-policy-subtitle rows="2" maxlength="300">${escapeHtml(content.policySubtitle || '')}</textarea></label>
          <label class="admin-site-content-wide"><span>Nội quy (mỗi dòng 1 mục)</span><textarea data-admin-site-rules rows="5" maxlength="4000">${escapeHtml(asLines(content.rules).join('\n'))}</textarea></label>
          <label class="admin-site-content-wide"><span>Ẩn danh &amp; riêng tư</span><textarea data-admin-site-privacy rows="5" maxlength="4000">${escapeHtml(asLines(content.privacy).join('\n'))}</textarea></label>
          <label class="admin-site-content-wide"><span>AI kiểm duyệt</span><textarea data-admin-site-ai rows="5" maxlength="4000">${escapeHtml(asLines(content.ai).join('\n'))}</textarea></label>
          <label class="admin-site-content-wide"><span>Cách báo cáo</span><textarea data-admin-site-report rows="5" maxlength="4000">${escapeHtml(asLines(content.report).join('\n'))}</textarea></label>
          <label class="admin-site-content-wide"><span>Giới thiệu kháng nghị</span><textarea data-admin-site-appeal-intro rows="3" maxlength="500">${escapeHtml(content.appealIntro || '')}</textarea></label>
          <label class="admin-site-content-wide"><span>Góp ý</span><textarea data-admin-site-feedback rows="5" maxlength="4000">${escapeHtml(asLines(content.feedback).join('\n'))}</textarea></label>
          <label class="admin-site-content-wide"><span>Liên hệ</span><textarea data-admin-site-contact rows="5" maxlength="4000">${escapeHtml(asLines(content.contact).join('\n'))}</textarea></label>
          <label class="admin-site-content-wide"><span>PII cần tránh</span><textarea data-admin-site-pii rows="4" maxlength="1000">${escapeHtml(content.pii || '')}</textarea></label>
          <button class="primary-button" data-admin-site-content-save type="button">Lưu nội dung /policy/</button>
        </div>
        <p class="muted">Board rules vẫn chỉnh riêng ở tab <strong>Bảng</strong> (mỗi board một bộ nội quy + banner).</p>
      </section>
    </div>
  `;
}

export function adminSiteContentPayload(root: Element | null) {
  if (!root) {
    return {};
  }
  const read = (selector: string) =>
    String((root.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null)?.value || '');
  return {
    policyTitle: read('[data-admin-site-policy-title]'),
    policySubtitle: read('[data-admin-site-policy-subtitle]'),
    rules: asLines(read('[data-admin-site-rules]')),
    privacy: asLines(read('[data-admin-site-privacy]')),
    ai: asLines(read('[data-admin-site-ai]')),
    report: asLines(read('[data-admin-site-report]')),
    appealIntro: read('[data-admin-site-appeal-intro]'),
    feedback: asLines(read('[data-admin-site-feedback]')),
    contact: asLines(read('[data-admin-site-contact]')),
    pii: read('[data-admin-site-pii]')
  };
}
