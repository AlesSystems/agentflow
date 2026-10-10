import { Agent, request as httpRequest } from "node:http";
import { z } from "zod";
import { uuid } from "../contracts/common";
import { CliError, type CliConfig } from "./config";
export type Reply<T> = { kind: "delivered"; data: T; generation: string } | { kind: "retryable"; delay: number } | { kind: "blocked"; code: string; expectedSequence?: number; currentVersion?: number };
const safeCodes = new Set(["sequence_gap", "sequence_conflict", "idempotency_conflict", "run_terminal", "run_conflict", "authentication_required", "resource_not_found", "version_conflict", "active_run", "task_project_mismatch", "run_transition_invalid", "human_required", "invalid_input", "task_completed", "project_archived"]);
export async function request<T>(config: CliConfig, path: string, schema: z.ZodType<T>, end: number, body?: Record<string, unknown>, key?: string): Promise<Reply<T>> {
  if (performance.now() >= end) return { kind: "retryable", delay: 0 };
  const agent = new Agent({ proxyEnv: {} as NodeJS.ProcessEnv });
  let active: ReturnType<typeof httpRequest> | undefined;
  let responseStarted=false,timedOut=false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await new Promise<{ status: number; headers: Record<string,string | string[] | undefined>; bytes: Buffer; oversized?: boolean }>((resolve,reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      active = httpRequest({ hostname: "127.0.0.1", port: config.port, path: `/api/v1${path}`, method: body ? "POST" : "GET", agent, headers: { Host: `127.0.0.1:${config.port}`, Authorization: `Bearer ${config.token}`, ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload!) } : {}), ...(key ? { "Idempotency-Key": key } : {}) } }, incoming => {
        responseStarted=true;
        const status = incoming.statusCode ?? 0;
        if (status === 429 || status === 503 || status >= 300 && status < 400) {
          resolve({status,headers:incoming.headers,bytes:Buffer.alloc(0)}); incoming.destroy(); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        incoming.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 65536) { resolve({status,headers:incoming.headers,bytes:Buffer.alloc(0),oversized:true}); incoming.destroy(); }
          else chunks.push(chunk);
        });
        incoming.on("end", () => resolve({status,headers:incoming.headers,bytes:Buffer.concat(chunks)}));
        incoming.on("error",reject);
        incoming.on("aborted", () => reject(new Error("response interrupted")));
      });
      active.on("error",reject);
      timer = setTimeout(() => {timedOut=true;active?.destroy(new Error("request deadline"));},Math.max(1,end-performance.now()));
      active.end(payload);
    });
    if (response.status === 429 || response.status === 503) {
      const retryHeader = response.headers["retry-after"];
      const retry = typeof retryHeader === "string" ? retryHeader : undefined;
      const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : retry ? Math.max(0, Date.parse(retry) - Date.now()) : 100;
      return { kind: "retryable", delay: Number.isFinite(delay) ? Math.min(30000, delay) : 100 };
    }
    if (response.status >= 300 && response.status < 400) return { kind: "blocked", code: "redirect_refused" };
    if (response.oversized) return { kind: "blocked", code: "invalid_response" };
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.bytes)); } catch { return { kind: "blocked", code: "invalid_response" }; }
    if (response.status < 200 || response.status >= 300) {
      const error = z.object({ error: z.object({ code: z.string(), expectedSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(), currentVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() }) }).safeParse(raw);
      if (!error.success || !safeCodes.has(error.data.error.code)) return { kind: "blocked", code: "server_rejected" };
      return { kind: "blocked", ...error.data.error };
    }
    const generation = response.headers["agentflow-generation"];
    const parsed = schema.safeParse(raw);
    if (!uuid.safeParse(generation).success || !parsed.success) return { kind: "blocked", code: "invalid_response" };
    return { kind: "delivered", data: parsed.data, generation: generation as string };
  } catch (error) {
    if (error instanceof CliError) throw error;
    return responseStarted&&!timedOut?{kind:"blocked",code:"invalid_response"}:{ kind: "retryable", delay: 100 };
  } finally { clearTimeout(timer); active?.destroy(); agent.destroy(); }
}
