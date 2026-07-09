import { createRoot, type Root } from 'react-dom/client';
import { AdminStatusIsland } from './AdminStatusIsland';

const mountedRoots = new WeakMap<Element, Root>();

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

  let root = mountedRoots.get(host);
  if (!root) {
    root = createRoot(host);
    mountedRoots.set(host, root);
  }

  root.render(<AdminStatusIsland />);
}
