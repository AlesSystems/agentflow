import type { ConnectorTurn } from "../../contracts/connectors";

export type IndexFields = { cwd: string | null; customTitle: string | null; firstRequest: string | null; updatedAt: string | null; agentName: string | null; model: string | null };
export type TurnOptions = { running: boolean };

export function parseLines(raw: string, options: { dropFirst?: boolean; maxLines?: number } = {}): Record<string, unknown>[] {
  throw new Error("not implemented");
}
export function deriveIndexFields(records: Record<string, unknown>[]): IndexFields {
  throw new Error("not implemented");
}
export function buildTurns(records: Record<string, unknown>[], options: TurnOptions): ConnectorTurn[] {
  throw new Error("not implemented");
}
