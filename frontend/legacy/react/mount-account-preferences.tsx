import {
  AccountPreferencesSummaryIsland,
  type AccountPreferencesSummaryIslandProps
} from './AccountPreferencesSummaryIsland';
import { renderIntoHost } from './render-into-host';

/** Mount account preferences summary into `#reactAccountPreferencesSummary` when present. */
export function mountAccountPreferencesSummaryIsland(
  props: AccountPreferencesSummaryIslandProps
): void {
  const host = document.getElementById('reactAccountPreferencesSummary');
  if (!host) {
    return;
  }
  renderIntoHost(host, <AccountPreferencesSummaryIsland {...props} />);
}
