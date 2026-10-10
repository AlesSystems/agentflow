# P06 synthetic evidence

All entities, reports, credentials, and browser journeys use isolated synthetic
fixtures. No operator database or provider-private state is inspected. The raw
JSON excludes credential bytes; literal pairing/reporter token checks passed
against every owned fixture token set before these files were retained.

Each attempt directory retains the original `performance.json` basename under
a gzip wrapper. The gzip files decompress to the exact original raw receipts. Compression uses
no filename header and timestamp zero. Read one with `gzip -dc <file>`.

| File | Result | Original decompressed SHA-256 |
| --- | --- | --- |
| [Attempt 1](attempt-1/performance.json.gz) | Failed local cursor admission deadline; 109 commits and 891 retained | `8bbd40b5469399e3bb9af17a29710b84534266b30c89c73f0b25211df29ed5a7` |
| [Attempt 2](attempt-2/performance.json.gz) | Incomplete at 122.495s; 974 commits and 26 retained | `fd7de2023bf40f81464cd65b5c7bf2449a4760160e270162a529f633c53013c7` |
| [Attempt 3](attempt-3/performance.json.gz) | Three fresh flush and native comparison gates passed | `9a7cbb106d733b5abfffc3161b2cf395ec15bbf84beceba998fcfbb49a760554` |

Failed receipts remain unmodified. Attempt 1's elapsed/accepted zeros were
unfinalized placeholders. Its CLI-duration sum is not measured whole-flush wall
time. Attempt 2 records actual wall time including startup. Its generic
“immutable queued event missing” error describes undelivered pending work after
the cutoff, not producer data loss. Neither failed fixture is reused as a full run.

Attempt 3 preserves all queued descriptors, original envelopes/digests/file bytes,
CLI codes and acknowledgement output, HTTP accepted/replay/error counts, native
warmup and measured samples, host/runtime/source/helper/lock/addon/build hashes,
and fixture preparation qualifications. Typed API pagination verifies IDs/counts;
immutable-body/digest comparisons are SQLite/original-queue facts, not a separately
captured full API payload comparison.

The [independent reconciliation](root-independent-reconciliation.json) verifies
3,000 queued/committed identities, bytes, times, digests, ACKs, watermarks, counts,
42 distributions, and 330 paired native identities. Its SHA-256 is
`ea7f0f932a63e028d256326658c79234713246b689a26750cdd761a708e6f05c`.
The [additional native database check](root-native-database-reconciliation.json)
verifies paired ingestion bodies/digests, 660 stored ACKs, six database counts and
integrity/foreign keys. Its SHA-256 is
`8e76f2d0180e48f85630d37af74ded65d31b11937bb18600f471c6f2e51ce3dc`.

Performance uses cached P05 assets with candidate CLI `4bb6dee`, not a fresh head
build or a relative CLI baseline. Two browser tabs are present, but combined-load
observer visibility is P07 work. Fresh production verification is recorded
separately in [the P06 receipt](../../P06.md).

Fresh production-build Chrome captures retain their original filenames:
[first tab](producer-review-tab1.png), [second tab](producer-review-tab2.png).
Both were visually inspected and contain synthetic journey state, no credentials
or operator/provider-private data. Their build is `sDI0xsv04jaYR13VYrGHA`.
