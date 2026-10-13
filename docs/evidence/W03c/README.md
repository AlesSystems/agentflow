# W03c qualified evidence

W03c is integrated through [PR #15](https://github.com/AlesSystems/agentflow/pull/15), with private archival and guarded cleanup complete. The exact-source package reviews found no actionable findings at `fd44b9545d9e8fbff1f8b8486a96a3d3540f4f59`. Astra approved exactly the six recorded relative failures, and Root accepted the campaign under that separate disposition. Final scoped documentation review and matching-head integration are complete. W04 and the v1 release are unexecuted.

[acceptance.json](acceptance.json) preserves all 42 HTTP distributions, their measured samples, all 15 separate base/head comparisons, and the six relative failures. The revised campaign completed 3,810 declared requests with no missing or failed requests and no absolute-budget failure. Its original result remains `acceptance=false`, exit 1. The approved policy disposition is separate from that immutable result.

The first campaign stopped at 460 of 3,810 requests because its proof layout lacked the stopped-SQL audit destination. Its original failure is retained, incomplete, and unpooled. The approved output-layout repair led to the separate revised campaign. No sample removal, pooling, or causal host-noise explanation applies.

The six relative failures are `tasks-head-legacy-1`, `activity-head-legacy-1`, `activity-head-legacy-2`, `progress.ingest-head-legacy-2`, `export-head-legacy-2`, and `events-head-legacy-3`. Five add 0.803667–1.491459 ms at p95. The export comparison adds 7.639584 ms. Export and price each have ten measured requests per repetition; their p95 is the cohort maximum. These finite observations do not establish population throughput or W04 load acceptance. Exact-source analysis identifies possible structural costs but does not prove the causes of all six failures. HTTP stage and backup subcauses remain unknown.

| Approved comparison | Added p95 ms | Regression % |
| --- | ---: | ---: |
| `tasks-head-legacy-1` | 0.803667000 | 23.253136568 |
| `activity-head-legacy-1` | 1.491459000 | 47.703790181 |
| `activity-head-legacy-2` | 1.220958000 | 38.985922437 |
| `progress.ingest-head-legacy-2` | 0.806709000 | 25.383509493 |
| `export-head-legacy-2` | 7.639584000 | 33.220578695 |
| `events-head-legacy-3` | 0.816666000 | 31.001346851 |

The root audit reconciled the raw journal, native timing, response facts, source/runtime pins, 18 closed services, and 7,476 captured SQL rows through 18 further stopped copies. Original database triplets remain held and unchanged. The worker audit created a zero-byte WAL and a 32,768-byte SHM after its pre-open copy hashes; its main database hashes remained unchanged. Wrapper counters cover native service instrumentation and exclude React and Next client cleanup.

The original full suites remain composed evidence: 252 unit passes; 587 integration passes, five failures, and one skip; 19 focused registry repairs; four prerequisite cases; 90 browser passes and two held visual skips. The dedicated two-tab witness is separate. Helper controls passed 39 tests; types and lint passed. The previously qualified production build has the same 119 shipping inputs, with no new build and an inherited tracing warning.

The three PNGs are unchanged approved repair captures, verified by SHA-256 before and after copying. Desktop is 1440×3848; narrow is 375×5133. Native Chrome 200% is a 1440×913 top viewport at 720 CSS pixels and DPR 2. Scoped axe, overflow, reduced-motion, and keyboard evidence qualify those checks only. The captures qualify accepted `8fdff6c` shipping code from the `6580696` repair build, with later test and documentation changes. No new appearance cycle, image edit, or capture ran.

Named macOS 27.0 arm64 verification does not establish Linux or pristine-operating-system support. Optional live GitHub verification is unexecuted. Public evidence excludes credentials, raw headers, private paths, prompts, and task database contents.

Astra verdict `APPROVED_EXACT_OBSERVATIONS` has SHA-256
`bbf51e5623324e81e290788e8fda5f3257af29247f86a058359e5cade1763dea`. Root campaign acceptance has SHA-256
`72707e370b2bbb89437b0e2235231c8251dc23b74b258c483c6089ea80bba0f7`. Both bind the recorded `fd44b95` candidate and unchanged raw result.
The approval changes no budget and supplies no future measurement or regression waiver.
