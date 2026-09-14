/**
 * One IPC round trip for ALL persisted settings/position keys.
 *
 * Every provider (Settings, Bible, Compare) awaits this same promise, so the
 * renderer pays a single `store:get-all` instead of ~13 individual
 * `store:get` calls at startup. Never rejects: on failure callers fall back
 * to their in-code defaults, same as a missing key.
 */
let cache: Promise<Record<string, unknown>> | null = null;

export function loadAllSettings(): Promise<Record<string, unknown>> {
  if (!cache) {
    cache = window.electronAPI.store.getAll().catch(() => ({}));
  }
  return cache;
}
