# P05 transport slice

This is the first slice of the approved P05 plan (SHA256
`e70c35a7431cad373eb11c7987de785307232ca6f486ab2d5afa952013192031`).
P05 remains open; browser subscription, projections, UI and browser acceptance
are outside this candidate.

The typed endpoint registry now declares browser-only `GET /changes/stream` and
finite `HEAD`. Native launcher dispatch owns the response, bypassing Next
compression/buffering. The framework fallback rejects this stream capability as
unavailable. All launcher envelope, credential, Fetch Metadata and body guards
apply before stream headers; every supplied raw Origin is validated.

`Store.changeBatch` validates canonical decimal cursor strings in
`0..9223372036854775807`, reads generation/bounds and at most 100 ascending
committed notices in a short transaction, and returns before waiting or writing.
SQL casts cursors to TEXT and parameters to INTEGER. Snapshot envelopes and
frame contracts share the range validator. Historical command receipts are not
rewritten. Migration files 0000..0005 and schema version 6 are unchanged.

Streams poll every 500ms, send keepalive comments every 15s while writable, admit
20 leases, and reject the 21st with finite 429/Retry-After. Encoded app queue plus
native writable bytes are capped before admission at 1 MiB. Native write=false
stops batches and starts a separate five-second stalled deadline. A separate
500ms session check continues while blocked, and each write/drain revalidates.
Invalid sessions destroy/discard unsent data. Already socket-buffered bytes
cannot be recalled and may still reach a client after revocation.

Abort, closure and shutdown cancel timers/listeners, discard queues, remove
leases and resolve dispatch. Shutdown closes leases before Store drain/closure.
Owner-returned diagnostics contain counts, bytes and monotonic timestamps; there
is no public diagnostics route or SSE body logging.

## Reproduce

Run `npm run build`, then
`node --expose-gc --import tsx tests/fixtures/p05-transport.ts`.
The fixture uses the production launcher, actual TCP sockets and an external
synthetic temporary SQLite directory with registered connections. It removes
that directory and shuts down all sockets/servers. It proves incremental frames
under Accept-Encoding gzip, snapshot/write/subscribe replay, canonical query
rejections, browser authority, finite HEAD/reset, Last-Event-ID precedence,
paused-reader native pressure and stalled termination, writer progress, replay,
blocked revoke/expiry with server-write timestamps, 20/21 admission, 100
connect/disconnect cycles, memory samples and shutdown-before-Store closure.

The fixture records the shipping build ID and source-file hashes. Native pressure
in the initial successful run peaked at 75,282 queued+writable bytes and closed
in 5,026ms; a concurrent SQLite write took 0.043ms. These are synthetic local
measurements, not UI latency or sustained-load acceptance. Unit coverage also
forces the pre-enqueue 1MiB ceiling (native pressure normally stops far below
it). The memory procedure performs three explicit GC collections separated by
25ms for idle, steady, paused and post-close samples; heap must return within
20% of idle. RSS is recorded, with no cross-platform RSS guarantee.

Cursor/Store tests prove zero, SQLite maximum, maximum+1, the JS-safe boundary,
adjacent distinct unsafe-integer cursors, ordered replay near maximum and actual
AUTOINCREMENT exhaustion rolling back projections, acceptance facts and receipts.
The first cursor test commit was RED because the new capability was absent; a
subsequent malformed-decimal test also exposed and corrected a throwing BigInt
refinement. Production transport proof was required before its implementation
commit. Full P05 production browser/report-to-visible, silence/restore, sustained
load, multi-tab and independent-review gates remain open.
