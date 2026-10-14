# Automatic local Claude Code observations

## Scope

The operator requested a Claude Code connector beside the Codex one on 2026-10-14 and accepted the recommended decisions in the plan. AgentFlow lists existing local Claude Code sessions, their subagents and workflow agents. Selecting a session shows recorded requests, the latest assistant reply per turn, checklist progress where Claude recorded a task list, and child agents. The connection is read-only. Observation never changes Claude Code sessions, agent execution or human acceptance.

## Design decision

Claude Code has no supported history interface. `claude agents --json` lists only running sessions, and the Agent SDK is not installed on the host. The connector therefore reads Claude Code's on-disk transcripts. This is undocumented storage, accepted by the operator in the [decision record](../DECISIONS.md) with these mitigations: tolerant parsing, unknown values instead of guesses, a synthetic fixture corpus, and visible unavailable and stale states.

Three designs were compared. Duplicating the Codex files for Claude would have grown every Codex special case into a second branch. A generic raw-event endpoint would have moved source interpretation into the browser and weakened the field allowlist. The selected design is one connector registry:

- `src/contracts/connectors.ts` holds the shared DTOs, previously the Codex DTOs, renamed without field changes.
- `ConnectorObserver` (`src/integrations/connector/observer.ts`) owns the in-memory cache, opaque scoped cursors, deduped loads, the detail cache and concurrency cap, stale fallback, the 10,000-chat cap, contract validation of reader output, and closing.
- Each source implements `ConnectorSourceReader`. `CodexSource` keeps the app-server reader. `ClaudeSource` reads files.
- Routes are `/connections/{source}` rows dispatched through `state.connectors[source]`. The Codex routes and their OpenAPI entries are unchanged.
- One page component, `ConnectorHistory`, renders both sources from a descriptor table holding copy, base path, deep link and capabilities.

## Source format (Claude Code 2.1.x)

- Sessions: `projects/<encoded-cwd>/<sessionId>.jsonl`. The directory encoding is lossy, so `cwd` is taken from records.
- Subagents: `<sessionId>/subagents/agent-<agentId>.jsonl` with `agent-<agentId>.meta.json`, and workflow agents under `subagents/workflows/wf_<id>/`.
- Titles come from the last `custom-title` record, and agent names from the last `agent-name` record.
- Requests are user records typed by a person. Tool results, meta records, compaction summaries, task notifications, command output and interrupt markers are excluded. Queued prompts start a turn.
- Assistant text blocks are grouped by message id.
- Checklists are replayed from `TaskCreate` and `TaskUpdate`, from `TodoWrite`, and from `task_reminder` snapshots.
- Running status comes from `sessions/<pid>.json`, used only while that pid is alive and owned by the user.
- Records repeated when a session is resumed are ignored by id. Unparseable lines and unknown record types are skipped.

## Content visibility and file access

Only selected fields cross the boundary: request text, assistant text, task subjects and statuses, cwd, model, titles, agent names and types, timestamps and ids. Thinking, tool inputs and results, and other attachments are discarded at parse. Every free-text field goes through the shared redaction and length limits.

The reader opens only three path shapes: session and agent transcripts, agent meta files, and numeric process files. It opens with `O_NOFOLLOW`, requires a regular file inside the real root, and does not follow symlinked directories. It never opens session key files, `history.jsonl`, settings or credentials, and never writes. The root is `AGENTFLOW_CLAUDE_DIR` (absolute), else `CLAUDE_CONFIG_DIR`, else `~/.claude`.

Bounds:
- The index reads at most the head and tail of each changed file, extending the tail backwards up to 2 MiB to find a complete record. Unchanged files are cached by mtime and size.
- Details read at most the last 16 MiB and 200,000 lines, and cache built turns for up to eight unchanged files.
- Turns are paged 10 at a time, newest first.

## Acceptance contract

- Discover local sessions, subagents and workflow agents automatically, with search, kind filters and pagination.
- Show recorded requests, latest replies and real checklist progress. Preserve unknown progress where no task list was recorded.
- Label running and idle sessions from live process files; everything else is a stored observation.
- Refresh automatically while visible. Keep the last observations, labeled stale, during source failures.
- Reject unauthenticated and reporter access. Preserve Host and Origin checks and no-store headers.
- Never start, resume, interrupt or modify Claude Code sessions.
- Keep real transcript content out of tests, logs, committed screenshots and public evidence.

## Verification

Baseline: `6e5344a`. Registry refactor: `1c33011`. Reader: `b1d1eb5` (contracts and fixtures) and `0057179`. UI: `c8387d9`. Core hardening: `26dd57d`. Routes: `6f5e6c9`. Review and real-data repairs: `0a0294d`, `f49b21a`, `2f2d815`, `ecffb87`, `7345e40`. Host: macOS 27.0 arm64, Node 24.15.0, Claude Code 2.1.281.

Implementation used Sonnet workers and independent Opus reviewers.
- The refactor review found no blocking issues. Its hardening suggestions landed in `26dd57d`.
- The reader and UI review found two blocking issues, both fixed in `0a0294d`: an invalid e2e mock, and task notifications counted as requests. The re-review of the fix found none blocking; its follow-ups landed in `2f2d815`.
- A final whole-branch review raised eight non-blocking findings. Four were fixed in `7345e40`, and the other four are recorded under Limits.

Checks at `7345e40`:
- Type checking, lint, OpenAPI consistency and the webpack production build passed. `docs/openapi.json` changed only by the two Claude paths.
- 60 connector unit and HTTP tests passed. The HTTP test covers paired access, reporter and unauthenticated rejection, Origin checks, no-store responses, a missing source directory, and that no board tasks are created.
- The Claude and Codex browser specs passed, along with the journey, tracking and accessibility specs that render the discovery links. Thirteen tests passed; one failed on the first run and passed on an immediate rerun.

Actual production verification ran against this host's real `~/.claude`, with an isolated AgentFlow data directory on port 3100. Only shape summaries were inspected, never transcript text.
- 265 sessions and agents listed; the first list took 340 ms.
- All 351 turns loaded: no duplicate turn ids, no injected-tag requests, no detail errors.
- The coordinator's own session showed as running from its live process file, with its newest turn in progress.
- A session with a recorded task list showed 5 of 5 checklist steps.
- A subagent opened its parent.
- The archive toggle and deep link are absent.
- At 375 px the Claude and Codex pages have no horizontal scroll.
- Codex still connected and listed chats.
- Private screenshots are retained under `work/poteto/claude-connector/real/`.

Real data exposed three defects that the synthetic fixtures had missed, each now fixed with a regression test:
- Records repeated on resume duplicated turns.
- Desktop-app agent messages, CI events and app actions were counted as requests.
- Leading system reminders hid a real request.

The broad regression run is qualified, not fully green:
- Unit: 334 passed, three failed. The same three fail at baseline `6e5344a`.
- Integration: 571 passed, 29 failed, 33 skipped.
  - Several failures are fixtures that create data under the symlinked macOS `/var` temporary directory, which the store rejects with `SYMLINK`. With `TMPDIR` set to its real path, those files passed, including w03c CLI, w03c campaign controls, P07 warm accounting and P07 flush reconciliation.
  - The rest need historical sources, private upgrade proofs or journey roots, or are 60-second historical performance helpers.
- Browser: 78 passed, 16 failed, two skipped. Fourteen were the same temporary-directory issue and passed with a real `TMPDIR`. The W04 appearance and joined journey need private roots.

No failure traced to this branch.

## Limits

- The transcript format is undocumented and can change in a Claude Code release. Unknown records are skipped, so a format change shows up as missing fields or an unavailable state, not invented data.
- The index reads only the head and tail of large files. A title or model recorded only in the middle can be missed.
- Detail shows a bounded recent window of very large transcripts.
- Process files can be reused by a later same-user process with the same pid until Claude Code removes the stale file.
- Subagents have no live process file, so their status is always a stored observation.
- When more than 10,000 transcript files exist, the walk stops in directory order and the list is marked partial.
- Requests that consist only of one markup element, such as pasted HTML, are treated like harness-injected records and not shown.
- A queued prompt is shown when it is queued. If Claude Code also records it again on delivery, it can appear twice; real data did not confirm this.
- A relative `CLAUDE_CONFIG_DIR` is ignored in favour of `~/.claude`.
- Desktop-app metadata (titles, the archived flag), a deep link into Claude, and workflow phase progress are deferred. Claude sessions have no archive concept in the CLI, so the archive toggle is hidden.
