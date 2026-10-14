import type { ConnectorChat } from "../../contracts/connectors";
import { ConnectorObserver, type ConnectorMessages, type ConnectorObserverOptions, type ConnectorSourceReader, type SourceDetail, type SourceIndex } from "../connector/observer";

export type ClaudeFs = { open: typeof import("node:fs/promises").open; readdir: typeof import("node:fs/promises").readdir; stat: typeof import("node:fs/promises").stat };
export type ClaudeSourceOptions = { root: string; maxFiles?: number; fs?: ClaudeFs };

export class ClaudeSource implements ConnectorSourceReader {
  readonly messages: ConnectorMessages = {
    connected: "Local Claude Code transcripts. Running status comes from live Claude Code processes.",
    partial: "Local Claude Code history exceeds the connector limit. These observations are partial.",
    detail: "Local Claude Code transcript. Turn activity is a bounded recent window; checklist progress is shown only where Claude recorded a task list.",
    stale: "Claude Code history is unavailable. Showing the last successful local observations.",
    unavailable: "Claude Code local history is unavailable. Check that Claude Code has run on this machine and try again.",
  };
  constructor(private readonly options: ClaudeSourceOptions) {}
  async loadIndex(): Promise<SourceIndex> { throw new Error("not implemented"); }
  async readDetail(_stored: ConnectorChat, _turnsCursor: string | undefined): Promise<SourceDetail> { throw new Error("not implemented"); }
  beginClosing() {}
  async close() {}
}
export const createClaudeObserver = (options: ClaudeSourceOptions & ConnectorObserverOptions) => new ConnectorObserver(new ClaudeSource(options), options);
