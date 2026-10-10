# P05 synthetic browser evidence

These assets exercise the observer interface with synthetic public reports. They
are browser evidence, not actual human acceptance attestations or whole-package
approval. The [manifest](manifest.json) records exact image/video hashes and
capture sources.

Most static captures and the reconnect recording belong to `d239076`. Independent
finish review retained them only for unchanged regions. The task-attempt and
narrow-attempt replacements belong to `279ef63`, after editor lifetime/identity
and long-name wrapping repairs. `finish-recapture.json` owns those replacement
layouts and hashes; `inspection-original.json` describes the earlier batch and
does not transfer its axe result to replacement images.

The stale-report capture uses an aged synthetic record with a healthy browser
connection. The separate disconnected-browser capture follows a real stopped
server and retains a last-known fresh report. Actual elapsed silence behavior is
proved separately by the production browser test.

The native zoom capture has CSS width 720, DPR 2 and CSS zoom 1, with metadata in
`zoom-confirm.json`. The original Playwright full-page zoom capture was cropped
and was replaced using the native CDP viewport. `reconnect.webm` is an actual
6.6-second recording; reviewer inspection sampled frames at 1, 3 and 5 seconds,
without claiming full playback.

The keyboard and long-name JSON files record focused production-browser proofs.
The keyboard journey uses Tab, Enter, Space and typing, with active-element and
focus/draft retention evidence. The long-name test uses an accepted 200-character
unbroken identity in direct and embedded detail at 375px. The replacement capture
uses a different accepted 200-character unbroken fixture name.

Two own inspection batches and one detector pass were used. Subsequent captures
were explicitly requested by the independent finish reviewer. The qualified
detector JSON retains its raw hash and four pre-existing font-step advisories,
with public paths normalized. No further polish/detector pass or blanket
accessibility certification is claimed. The scoped finish verdict covers the
scored wrapping and keyboard fixes; final checks, measurement and integration
are separate gates.
