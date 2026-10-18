# App logo verification

The shared `BrandMark` uses the approved README logo in the application header,
pairing page, and unpaired-browser prompt. The adjacent AgentFlow text supplies
the accessible name, so the image has an empty alt attribute. The favicon uses
32 px and 48 px PNG entries converted from the same source image.

Verified on macOS with Node 24.15.0, npm 11.12.1, and Playwright's isolated Chrome
profile against a fresh production build and synthetic external data directory.

- `npm ci`, `npm run lint`, `npm run typecheck`, and `npm run build` passed.
- `AGENTFLOW_TEST_BROWSER=chrome npx playwright test tests/e2e/pairing.spec.ts`
  passed all three tests.
- A temporary browser probe decoded the header and pairing images, confirmed the
  AgentFlow link's accessible name and keyboard focus, and checked no horizontal
  overflow at 1440 px and 375 px widths.
- The page declares `/favicon.ico`. The HTTP response was 200 with
  `image/x-icon`, and both embedded PNG entries validated.
- The browser probe reported no page errors. Screenshots show synthetic empty
  project state and a blank pairing form.
- The Impeccable detector reported no findings on changed lines. Its advisories
  describe existing styles outside this change.

The full integration and release qualification suites were not run for this
branding change. No new operating-system qualification is claimed.

[Desktop header](header-desktop.png), [mobile header](header-mobile.png), and
[pairing page](pairing.png) were inspected at this candidate.
