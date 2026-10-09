import { createHash } from 'node:crypto';
export function canonicalJson(value: unknown): string {
 if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
 if(value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+canonicalJson((value as Record<string,unknown>)[key])).join(',') + '}';
 return JSON.stringify(value);
}
export const canonicalDigest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
