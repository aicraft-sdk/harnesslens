/**
 * Fails loud on missing required configuration, never silently defaulting it.
 * Mirrors this repo's "never silently drop, always structured reason" discipline.
 */
export function assertRequiredEnv(names: readonly string[]): void {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }
}
