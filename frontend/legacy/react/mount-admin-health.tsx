import { AdminHealthIsland, type AdminHealthIslandProps } from './AdminHealthIsland';
import { renderIntoHost } from './render-into-host';

/** Mount the admin health dashboard into `#reactAdminHealthIsland` when present. */
export function mountAdminHealthIsland(health: AdminHealthIslandProps['health']): void {
  const host = document.getElementById('reactAdminHealthIsland');
  if (!host) {
    return;
  }
  renderIntoHost(host, <AdminHealthIsland health={health || {}} />);
}
