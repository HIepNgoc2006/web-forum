/**
 * Compatibility entry for the admin status island only.
 * Prefer feature-specific modules (`mount-admin-status`, `mount-admin-health`,
 * `mount-admin-analytics`, `mount-account-preferences`) for dynamic imports so
 * each route/tab pays only for its own island chunk.
 */
export { mountReactIslands } from './mount-admin-status';
