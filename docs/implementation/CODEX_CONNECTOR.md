# Automatic local Codex observations

## Scope

The operator requested automatic discovery of existing Codex chats, agents, tasks and progress on 2026-10-13. This extends v1 with a Codex-specific read-only connection. No changes to Codex chats, agent execution, or human acceptance are authorized by observation.

AgentFlow lists existing local chats, including archived records on request. Selecting a chat shows recorded user requests, recent assistant updates, turn outcomes and child agents. Automatic refresh reads source changes. Source task progress is separate from human acceptance on the Work board. Missing checklist progress remains unknown.

## Design decision

Use one runtime-owned Codex observer with a bounded in-memory cache and a dedicated human-authenticated Codex page. The observer starts a local stdio app-server reader lazily and uses read methods only. List requests set useStateDbOnly to avoid scan-and-repair behavior. Codex retains ownership of its history. AgentFlow does not copy transcripts into its business database or history exports.

Two alternatives were reviewed. Persistent observation tables would require migration, retention, restore and synchronization contracts without improving the requested viewing journey. The selected observer hides protocol negotiation, process lifecycle, pagination, source interpretation and retry boundaries behind list/detail/close methods. Independent design review favored it with conditions on freshness, privacy and bounded reads.

The initial host probe used installed Codex CLI 0.157.1 and the managed app-server binary 0.162.1. A dedicated stdio reader discovered 1,138 stored threads, including 611 subagents. It reported all threads notLoaded. Existing-daemon proxy initialization timed out. The connector therefore must not present these observations as the desktop runtime's live state. Older child-agent relationships use source.subagent.thread_spawn or source.subAgent.thread_spawn; both compatibility paths are supported.

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

Baseline: `deda6c7205a38d32ed1c9da6f981fcb7595a0840`. Contracts: `b4f7ca5`. Implementation: `6751d21`. Reviewed repairs: `b063ef7b4f4c3efaf556071dd5f4117963cf2ce3`. Independent Standards and Spec reviews found no unresolved findings after the legacy source-key and capped archived-page warning fixes.

- Full unit run: 293 tests passed before the two review regression cases. Final focused run: 13 connector unit tests and one real HTTP integration test passed.
- Type checking, lint, OpenAPI consistency and whitespace checks passed.
- The HTTP test exercises paired access, unauthorized and reporter rejection, Origin checks, private no-store responses and absence of imported board tasks.
- The synthetic browser test passed for discovery, filtering, detail, unknown progress, automatic refresh, parent navigation and narrow reflow.
- Actual production browser verification loaded pre-existing local chats and child agents, followed a child to its parent, displayed recorded task requests and updates, and observed automatic updates from the active chat. At 375px, document width equals viewport width. Private desktop/mobile screenshots are retained locally.
- A sanitized ten-turn source comparison found six task requests in both summary and full-item views and zero missed requests. This is sample evidence, not a guarantee about every historical record.

Final `npm run build` (webpack) passed at shipping source `b063ef7`. The production service was restarted on `http://127.0.0.1:3000` and the paired browser reloaded successfully with Codex connected and actual history on 2026-10-13 at 18:31 Asia/Famagusta.

The broad regression run is qualified, not fully green:

- Integration: 580 passed, 18 failed, 33 skipped across 111 files (102 passed, eight failed, one skipped). Historical qualification/upgrade checks lack retained source/runtime/proof prerequisites. Two P06 baseline helpers timed out at 60 seconds while installing their historical dependencies; orphaned test-owned processes were stopped or confirmed exited. The W04 integration journey initially lacked its private root; the same joined journey later passed through the browser test with a valid external fixture directory.
- Browser: initial full run had 89 passed, four failed, two skipped. W04 appearance and joined journey subsequently passed with valid private directories; appearance additionally required Playwright's FFmpeg binary, which was installed. The P05 stale-state timing assertion initially measured 75,179ms against a 75,000ms limit and passed unchanged on focused rerun.
- P03 comment-reset interception failed twice with Playwright's `Route is already handled`. Its unchanged assertions passed five traced diagnostic runs. The precise interception race remains unresolved; tracing changes timing, so these passes do not establish a repair. No connector cause was demonstrated and unrelated product code was not changed.

These results do not requalify the historical v1 release or assert every regression gate passed. Connector-specific checks and independent reviews passed. Private discovery, logs, screenshots and decision evidence remain under `work/poteto/codex-connector/`; no private transcript is committed.

## Limits and workflow choices

This connector discovers history available to the installed local Codex app-server. Cloud-only and remote-host chats are outside that local source. Current harness agents absent from the source cannot be discovered. A separate reader does not establish the desktop daemon's live running status. Recorded outcomes can lag active work. Checklist percentages require explicit structured source steps; ordinary prose and completed turns never manufacture progress or human acceptance.

Poteto's Model the Domain principle led to separate observation DTOs instead of importing source turns as accepted board tasks. Prove It Works led to both deterministic authentication/protocol tests and actual local-history browser verification. No Codex mutation methods or model requests were introduced. There is no database schema change or public deployment. The existing v1.0.0 source release is preserved; these commits are local follow-on work.
