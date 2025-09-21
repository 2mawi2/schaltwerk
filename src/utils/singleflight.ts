// Single-flight guard to prevent racing duplicate operations
const inflight = new Map<string, Promise<unknown>>();

export function singleflight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function hasInflight(key: string): boolean {
  return inflight.has(key);
}

export function clearInflights(keys: string[]): void {
  keys.forEach(key => inflight.delete(key));
}