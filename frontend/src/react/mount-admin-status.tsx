import { AdminStatusIsland } from './AdminStatusIsland';
import { renderIntoHost } from './render-into-host';

function mountAdminStatusIsland(): void {
  const host = document.getElementById('reactAdminStatusIsland');
  if (!host) {
    return;
  }
  renderIntoHost(host, <AdminStatusIsland />);
}

/**
 * Mount the admin status chip island only.
 * Safe no-op when the mount node is missing so the vanilla shell keeps working.
 * Intentionally does not import health, analytics, or account islands.
 */
export function mountReactIslands(): void {
  mountAdminStatusIsland();
}
