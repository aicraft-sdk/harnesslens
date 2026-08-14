export const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'] as const;
export function isDangerousKey(key: string): boolean {
  return (DANGEROUS_KEYS as readonly string[]).includes(key);
}
