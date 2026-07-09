'use client';

import { useEffect, useState } from 'react';

/**
 * Minimal client shell for the Next.js POC.
 *
 * Intentionally does NOT import the production Vite app (`frontend/src`).
 * Goals for this POC:
 * - Prove Next.js install + TypeScript + static export (`output: "export"`).
 * - Document hash-route / backend static-serving constraints without changing production.
 * - Provide a clear "this is not production" UI for manual smoke checks.
 */
export function PocShell() {
  const [hash, setHash] = useState('(pending)');

  useEffect(() => {
    const readHash = () => setHash(window.location.hash || '(none)');
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, []);

  return (
    <main
      style={{
        maxWidth: 720,
        margin: '2.5rem auto',
        padding: '1.5rem 1.25rem',
        background: '#fff',
        border: '1px solid #ddd',
        borderRadius: 8,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      }}
    >
      <p
        style={{
          display: 'inline-block',
          margin: '0 0 1rem',
          padding: '0.2rem 0.55rem',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          color: '#7a3b00',
          background: '#fff3cd',
          border: '1px solid #f0d48a',
          borderRadius: 4,
        }}
      >
        POC only — not production
      </p>

      <h1 style={{ margin: '0 0 0.75rem', fontSize: '1.5rem' }}>
        36chan Next.js experiment
      </h1>

      <p style={{ margin: '0 0 1rem' }}>
        This package evaluates a future frontend migration. The production UI is
        still the Vite app under <code>frontend/</code>, served from{' '}
        <code>frontend/dist</code> by the existing backend static path.
      </p>

      <section style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem' }}>
          What this POC proves
        </h2>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>
            Isolated <code>frontend-next/</code> package and scripts
          </li>
          <li>
            Next.js App Router layout + catch-all page with static export
          </li>
          <li>Optional root scripts that do not replace <code>npm run build</code></li>
        </ul>
      </section>

      <section style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem' }}>
          Intentionally not migrated
        </h2>
        <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
          <li>Hash routes (<code>#board/...</code>, <code>#thread/...</code>)</li>
          <li>Vite shell, React islands, and production CSS</li>
          <li>Backend static serving / <code>STATIC_ROOT</code></li>
          <li>API payloads, Vietnamese UI copy, and production router</li>
        </ul>
      </section>

      <section style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.5rem' }}>
          Client hash probe
        </h2>
        <p style={{ margin: 0 }}>
          Current <code>window.location.hash</code>: <code>{hash}</code>
        </p>
        <p style={{ margin: '0.5rem 0 0', color: '#555', fontSize: 14 }}>
          Production navigation remains hash-based in Vite. Path-based Next
          routing is deferred; static export does not replace hash compatibility.
        </p>
      </section>

      <p style={{ margin: 0, fontSize: 14, color: '#444' }}>
        See <code>frontend-next/README.md</code> for run instructions, blockers,
        rollback, and recommendations.
      </p>
    </main>
  );
}
