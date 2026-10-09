import type { z } from "zod";
import type { FrozenCommand } from "./commands";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code.replaceAll("_", " "));
  }
}
export class StaleSnapshot extends Error {}
export class ApiClient {
  private epoch = 0;
  constructor(
    public generation: string,
    private changed: (generation: string) => void,
    private transport: typeof fetch = (...args) => fetch(...args),
  ) {}
  private async request(path: string, init: RequestInit) {
    const epoch = this.epoch;
    const response = await this.transport(
      path.startsWith("/api/") ? path : "/api/v1" + path,
      { ...init, cache: "no-store" },
    );
    if (epoch !== this.epoch) throw new StaleSnapshot();
    const generation = response.headers.get("AgentFlow-Generation");
    if (generation && generation !== this.generation) {
      this.generation = generation;
      this.epoch++;
      this.changed(generation);
      throw new StaleSnapshot();
    }
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(response.status, body?.error?.code ?? "unavailable");
    }
    const body: unknown = await response.json();
    if (epoch !== this.epoch) throw new StaleSnapshot();
    return body;
  }
  async read<S extends z.ZodType>(path: string, schema: S) {
    const body = await this.request(path, { method: "GET" });
    const parsed = schema.parse(body);
    if (
      typeof parsed === "object" &&
      parsed &&
      "generation" in parsed &&
      parsed.generation !== this.generation
    )
      throw new StaleSnapshot();
    return parsed;
  }
  async command(command: FrozenCommand) {
    await this.request(command.path, {
      method: command.method,
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": command.key,
      },
      body: command.body,
    });
  }
}
