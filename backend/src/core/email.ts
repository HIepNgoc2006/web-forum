type FetchLike = typeof fetch;

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type EmailClient = {
  type: string;
  configured: boolean;
  send(message: EmailMessage): Promise<{ id?: string }>;
  health?(): Promise<{ type: string; configured: boolean; ready: boolean }>;
};

type ResendEmailClientOptions = {
  apiKey?: string;
  from?: string;
  fetchImpl?: FetchLike;
};

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';

export function createDisabledEmailClient(): EmailClient {
  return {
    type: 'disabled',
    configured: false,
    async send() {
      const error = new Error('Dịch vụ email chưa được cấu hình');
      error.statusCode = 503;
      throw error;
    },
    async health() {
      return { type: 'disabled', configured: false, ready: false };
    }
  };
}

export function createResendEmailClient({
  apiKey = process.env.RESEND_API_KEY,
  from = process.env.EMAIL_FROM,
  fetchImpl = fetch
}: ResendEmailClientOptions = {}): EmailClient {
  const safeApiKey = String(apiKey ?? '').trim();
  const safeFrom = String(from ?? '').trim();
  const configured = Boolean(safeApiKey && safeFrom);

  return {
    type: 'resend',
    configured,
    async send(message) {
      if (!configured) {
        const error = new Error('Dịch vụ email chưa được cấu hình');
        error.statusCode = 503;
        throw error;
      }

      const response = await fetchImpl(RESEND_EMAIL_ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${safeApiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          from: safeFrom,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {})
        })
      });

      const payload = await response.json().catch(() => ({})) as { id?: string; message?: string; error?: string };
      if (!response.ok) {
        const error = new Error(payload.message || payload.error || `Resend trả về HTTP ${response.status}`);
        error.statusCode = 502;
        throw error;
      }
      return { id: payload.id };
    },
    async health() {
      return { type: 'resend', configured, ready: configured };
    }
  };
}
