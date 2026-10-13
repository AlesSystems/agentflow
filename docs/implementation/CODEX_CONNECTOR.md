# Automatic local Codex observations

## Scope

The operator requested automatic discovery of existing Codex chats, agents, tasks and progress on 2026-10-13. This extends v1 with a Codex-specific read-only connection. No changes to Codex chats, agent execution, or human acceptance are authorized by observation.

AgentFlow lists existing local chats, including archived records on request. Selecting a chat shows recorded user requests, recent assistant updates, turn outcomes and child agents. Automatic refresh reads source changes. Source task progress is separate from human acceptance on the Work board. Missing checklist progress remains unknown.

## Design decision

Use one runtime-owned Codex observer with a bounded in-memory cache and a dedicated human-authenticated Codex page. The observer starts a local stdio app-server reader lazily and uses read methods only. List requests set useStateDbOnly to avoid scan-and-repair behavior. Codex retains ownership of its history. AgentFlow does not copy transcripts into its business database or history exports.

Two alternatives were reviewed. Persistent observation tables would require migration, retention, restore and synchronization contracts without improving the requested viewing journey. The selected observer hides protocol negotiation, process lifecycle, pagination, source interpretation and retry boundaries behind list/detail/close methods. Independent design review favored it with conditions on freshness, privacy and bounded reads.

The initial host probe used installed Codex CLI 0.157.1 and the managed app-server binary 0.162.1. A dedicated stdio reader discovered 1,138 stored threads, including 611 subagents. It reported all threads notLoaded. Existing-daemon proxy initialization timed out. The connector therefore must not present these observations as the desktop runtime's live state. Older child-agent relationships are stored in source.subAgent.thread_spawn and need that compatibility path.

The installed protocol exposes persisted requests and turn status, plus optional plan text. A bounded sample of 3,784 recent items did not contain structured checklists. No completion percentage may be fabricated from message count, token usage or a completed turn.

## Content visibility

The paired local browser may display bounded request and assistant-update excerpts, plus a preview fallback when a chat has no title. This is part of the requested task-progress view. Only these selected fields cross the observation boundary. Reasoning, tool arguments, command output and raw protocol errors are excluded. Common token patterns are redacted as a precaution, not a guarantee that user-authored text contains no secrets. No excerpts belong in public verification artifacts.

## Acceptance contract

- Discover pre-existing local chats automatically with source pagination, search and archive selection.
- Show child-agent relationships, source requests and recorded turn progress. Preserve unknown values and timestamped observations.
- Refresh automatically while the page is visible. Retain explicitly stale observations during source failures and recover after restart.
- Reject unauthenticated and reporter access to all Codex history routes. Preserve Host/Origin checks and no-store headers.
- Use only a fixed allowlist of read-only Codex methods. Never start, resume, interrupt, rename, archive, delete or send messages to a chat.
- Bound response framing, request time, concurrency, cached pages and displayed strings. Close only connector-owned processes.
- Keep actual user chat content out of tests, committed screenshots, logs and public evidence.
- Verify a production build in the browser with real local history and leave it running for manual testing.

## Production compiler

The build command now selects Next.js webpack. Three Turbopack attempts were stopped during compilation after excessive memory use. Process samples recorded 42.8 GiB and 24.0 GiB footprints. Moving subprocess ownership entirely into the launcher did not resolve the compiler behavior. The webpack build compiled in 5.3 seconds and completed. The exact Turbopack cause is not isolated. No dependency version changed.

## Verification

Pending implementation and exact-candidate review. Baseline is deda6c7205a38d32ed1c9da6f981fcb7595a0840. Private discovery and decision evidence is under work/poteto/codex-connector/.
