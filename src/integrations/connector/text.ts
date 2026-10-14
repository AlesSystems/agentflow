export const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const text = (value: unknown, limit = 2000): string | null => typeof value === "string" && value.length ? value
  .replace(/\b(?:sk-[a-zA-Z0-9_-]{12,}|gh[pousr]_[a-zA-Z0-9]{20,}|[a-fA-F0-9]{48,}|[a-zA-Z0-9_-]{32,})\b/g, "[redacted]")
  .replace(/(\b(?:authorization|password|api[_-]?key|access[_-]?token|secret|token)(?:\s*[:=]\s*|\s+))([^\s,;]+)/gi, "$1[redacted]").slice(0, limit) : null;
