import { PocShell } from './poc-shell';

/**
 * Optional catch-all keeps the first POC as a static SPA shell.
 * Official Vite→Next migration guidance uses this pattern with generateStaticParams
 * returning only the index route while router migration is deferred.
 */
export function generateStaticParams() {
  return [{ slug: [''] }];
}

export default function Page() {
  return <PocShell />;
}
