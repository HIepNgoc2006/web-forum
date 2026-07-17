import fs from 'node:fs';

function loadEnv(file: string) {
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
      continue;
    }
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnv('backend/.env');

const apiKey = String(process.env.RESEND_API_KEY || '').trim();
const from = String(process.env.EMAIL_FROM || '').trim();

const domainsResponse = await fetch('https://api.resend.com/domains', {
  headers: { authorization: `Bearer ${apiKey}` }
});
const domainsPayload = await domainsResponse.json();
const domain = (domainsPayload.data || []).find((item: { name?: string }) => item.name === 'example.com');

let domainDetail: Record<string, unknown> | null = null;
if (domain?.id) {
  const detailResponse = await fetch(`https://api.resend.com/domains/${domain.id}`, {
    headers: { authorization: `Bearer ${apiKey}` }
  });
  domainDetail = await detailResponse.json();
}

const detailData = (domainDetail?.data || domainDetail || {}) as {
  name?: string;
  status?: string;
  region?: string;
  records?: Array<{ record?: string; type?: string; status?: string; name?: string }>;
};

const sendResponse = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    from,
    to: ['delivered@resend.dev'],
    subject: '36chan Resend probe',
    text: 'Probe only. Safe Resend test address.'
  })
});
const sendBody = await sendResponse.json().catch(() => ({}));

console.log(
  JSON.stringify(
    {
      apiAuthOk: domainsResponse.ok,
      domainStatus: domain?.status ?? null,
      domainDetail: {
        name: detailData.name ?? domain?.name ?? null,
        status: detailData.status ?? domain?.status ?? null,
        region: detailData.region ?? null,
        records: (detailData.records || []).map((record) => ({
          record: record.record,
          type: record.type,
          status: record.status,
          name: record.name
        }))
      },
      sendProbe: {
        httpStatus: sendResponse.status,
        ok: sendResponse.ok,
        id: sendBody.id || null,
        message: sendBody.message || sendBody.error || null,
        name: sendBody.name || null
      }
    },
    null,
    2
  )
);

if (!domainsResponse.ok || !sendResponse.ok) {
  process.exitCode = 1;
}
