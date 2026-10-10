import { z } from "zod";
import { uuid } from "../contracts/common";
import { CliError, type CliConfig } from "./config";
export type Reply<T> = { kind: "delivered"; data: T; generation: string } | { kind: "retryable"; delay: number } | { kind: "blocked"; code: string; expectedSequence?: number; currentVersion?: number };
const safeCodes = new Set(["sequence_gap", "sequence_conflict", "idempotency_conflict", "run_terminal", "run_conflict", "authentication_required", "resource_not_found", "version_conflict", "active_run", "task_project_mismatch", "run_transition_invalid", "human_required", "invalid_input", "task_completed", "project_archived"]);
export async function request<T>(config: CliConfig, path: string, schema: z.ZodType<T>, end: number, body?: Record<string, unknown>, key?: string): Promise<Reply<T>> {
  if (performance.now() >= end) return { kind: "retryable", delay: 0 };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, end - performance.now()));
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/v1${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${config.token}`, ...(body ? { "Content-Type": "application/json" } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual", signal: controller.signal });
    if (response.status === 429 || response.status === 503) {
      const retry = response.headers.get("retry-after");
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - Date.now()) : 100;
      await response.body?.cancel();
      return { kind: "retryable", delay: Number.isFinite(delay) ? Math.min(30000, delay) : 100 };
    }
    if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); return { kind: "blocked", code: "redirect_refused" }; }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) { await reader.cancel(); return { kind: "blocked", code: "invalid_response" }; }
      chunks.push(value);
    }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); } catch { return { kind: "blocked", code: "invalid_response" }; }
    if (!response.ok) {
      const error = z.object({ error: z.object({ code: z.string(), expectedSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(), currentVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }) }).safeParse(raw);
      if (!error.success || !safeCodes.has(error.data.error.code)) return { kind: "blocked", code: "server_rejected" };
      return { kind: "blocked", ...error.data.error };
    }
    const generation = response.headers.get("AgentFlow-Generation");
    const parsed = schema.safeParse(raw);
    if (!uuid.safeParse(generation).success || !parsed.success) return { kind: "blocked", code: "invalid_response" };
    return { kind: "delivered", data: parsed.data, generation: generation! };
  } catch (error) {
    if (error instanceof CliError) throw error;
    return { kind: "retryable", delay: 100 };
  } finally { clearTimeout(timer); }
}
