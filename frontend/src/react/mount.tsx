import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  AdminAnalyticsCardsIsland,
  type AdminAnalyticsCardsIslandProps
} from './AdminAnalyticsCardsIsland';
import { AdminHealthIsland, type AdminHealthIslandProps } from './AdminHealthIsland';
import { AdminStatusIsland } from './AdminStatusIsland';

const mountedRoots = new WeakMap<Element, Root>();

function renderIntoHost(host: Element, node: ReactNode): void {
  let root = mountedRoots.get(host);
  if (!root) {
    root = createRoot(host);
    mountedRoots.set(host, root);
  }
  root.render(node);
}

/**
 * Mount isolated React islands into optional DOM anchors.
 * Safe no-op when a mount node is missing so the vanilla shell keeps working.
 */
export function mountReactIslands(): void {
  mountAdminStatusIsland();
}

function mountAdminStatusIsland(): void {
  const host = document.getElementById('reactAdminStatusIsland');
  if (!host) {
    return;
  }
  renderIntoHost(host, <AdminStatusIsland />);
}

/** Mount the admin health dashboard into `#reactAdminHealthIsland` when present. */
export function mountAdminHealthIsland(health: AdminHealthIslandProps['health']): void {
  const host = document.getElementById('reactAdminHealthIsland');
  if (!host) {
    return;
  }
  renderIntoHost(host, <AdminHealthIsland health={health || {}} />);
}

/** Mount analytics metric cards into `#reactAdminAnalyticsCards` when present. */
export function mountAdminAnalyticsCardsIsland(props: AdminAnalyticsCardsIslandProps): void {
  const host = document.getElementById('reactAdminAnalyticsCards');
  if (!host) {
    return;
  }
  renderIntoHost(host, <AdminAnalyticsCardsIsland {...props} />);
}
