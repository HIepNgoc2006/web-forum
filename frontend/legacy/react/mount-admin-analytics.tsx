import {
  AdminAnalyticsCardsIsland,
  type AdminAnalyticsCardsIslandProps
} from './AdminAnalyticsCardsIsland';
import { renderIntoHost } from './render-into-host';

/** Mount analytics metric cards into `#reactAdminAnalyticsCards` when present. */
export function mountAdminAnalyticsCardsIsland(props: AdminAnalyticsCardsIslandProps): void {
  const host = document.getElementById('reactAdminAnalyticsCards');
  if (!host) {
    return;
  }
  renderIntoHost(host, <AdminAnalyticsCardsIsland {...props} />);
}
