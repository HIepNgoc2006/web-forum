import { legacyHeadHtml, legacyShellHtml } from '@/generated/legacy-shell';
import {
  legacyBodyClassScript,
  legacyInitialRouteMarkup,
  legacyInitialRouteScript,
} from '@/lib/legacy-head';
import { LegacyBootstrap } from './legacy-bootstrap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SNAPSHOT_MARKER =
  '<script id="initialHomeSnapshot" type="application/json">null</script>';

function withoutInlineScript(markup: string, script: string): string {
  return script ? markup.replace(`<script>${script}</script>`, '') : markup;
}

const LEGACY_INITIAL_ROUTE_STYLE_MARKUP = withoutInlineScript(
  legacyInitialRouteMarkup(legacyHeadHtml),
  legacyInitialRouteScript(legacyHeadHtml),
);
const LEGACY_SHELL_WITHOUT_BODY_CLASS_SCRIPT = withoutInlineScript(
  legacyShellHtml,
  legacyBodyClassScript(legacyShellHtml),
);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function loadInitialHomeSnapshot(): Promise<Record<string, unknown> | null> {
  const backendOrigin = new URL(
    process.env.BACKEND_ORIGIN || 'http://127.0.0.1:3000',
  ).origin;
  try {
    const response = await fetch(`${backendOrigin}/api/home`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return null;
    }
    const envelope = record(await response.json());
    const snapshot = record(envelope?.data ?? envelope);
    return snapshot && Array.isArray(snapshot.boards) ? snapshot : null;
  } catch {
    return null;
  }
}

function inlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function shellWithSnapshot(snapshot: Record<string, unknown> | null): string {
  const shell = snapshot
    ? LEGACY_SHELL_WITHOUT_BODY_CLASS_SCRIPT.replace(
        SNAPSHOT_MARKER,
        `<script id="initialHomeSnapshot" type="application/json">${inlineJson(snapshot)}</script>`,
      )
    : LEGACY_SHELL_WITHOUT_BODY_CLASS_SCRIPT;

  return LEGACY_INITIAL_ROUTE_STYLE_MARKUP
    ? `${LEGACY_INITIAL_ROUTE_STYLE_MARKUP}\n${shell}`
    : shell;
}

export default async function LegacyPage() {
  const snapshot = await loadInitialHomeSnapshot();
  return (
    <>
      <div
        id="nextLegacyRoot"
        data-bootstrap-state="loading"
        aria-busy="true"
        className="next-legacy-root"
        hidden
        dangerouslySetInnerHTML={{ __html: shellWithSnapshot(snapshot) }}
      />
      <LegacyBootstrap />
    </>
  );
}
