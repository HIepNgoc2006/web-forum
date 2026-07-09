import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const mountedRoots = new WeakMap<Element, Root>();

/**
 * Render a React node into a host element, reusing the root when already mounted.
 * Shared by feature-specific mount modules so each island chunk stays narrow.
 */
export function renderIntoHost(host: Element, node: ReactNode): void {
  let root = mountedRoots.get(host);
  if (!root) {
    root = createRoot(host);
    mountedRoots.set(host, root);
  }
  root.render(node);
}
