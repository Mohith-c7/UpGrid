// Feature-flag registry. Each module registers a function returning its flags;
// GET /api/v1/config merges all providers into `features`.
export type FlagProvider = () => Record<string, boolean>;
const providers: FlagProvider[] = [];
export function registerFeatureFlags(fn: FlagProvider): void { providers.push(fn); }
export function collectFeatureFlags(): Record<string, boolean> {
  return providers.reduce((acc, fn) => ({ ...acc, ...fn() }), {} as Record<string, boolean>);
}
