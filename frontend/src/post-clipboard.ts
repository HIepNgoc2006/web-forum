export function selectedPostQuoteText(postElement: Element | null): string {
  const selection = window.getSelection?.();
  const body = postElement?.querySelector('.post-body');
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !body) {
    return '';
  }
  const range = selection.getRangeAt(0);
  if (!range.intersectsNode(body)) {
    return '';
  }
  const lines = selection
    .toString()
    .replace(/\r/g, '')
    .slice(0, 800)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return lines.map((line) => `>${line}`).join('\n');
}

export function absolutePostPermalink(permalink?: string): string {
  if (!permalink || permalink === '#') {
    return window.location.href;
  }
  return `${window.location.origin}${window.location.pathname}${permalink}`;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

type PostClipboardActionsDependencies = {
  showToast: (message: string) => void;
};

export function createPostClipboardActions({ showToast }: PostClipboardActionsDependencies) {
  async function copyPostPermalink(permalink?: string): Promise<void> {
    const absolutePermalink = absolutePostPermalink(permalink);
    try {
      const copied = await copyTextToClipboard(absolutePermalink);
      showToast(copied ? 'Đã sao chép link bài viết.' : absolutePermalink);
    } catch {
      showToast(absolutePermalink);
    }
  }

  return {
    copyPostPermalink
  };
}