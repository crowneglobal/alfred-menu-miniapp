# Task feed deployment

The frontend task fix depends on the authenticated task API and nginx route in the paired `crowneglobal/Alfred` server PR. Do not publish this frontend before that server change is approved and serving the new contract. Preserve the existing fullscreen control clearance.

## API contract

- HTTPS base: `https://evaluations-standings-helicopter-carries.trycloudflare.com`. This is the existing server tunnel, not a permanent domain. Its `/api/tasks` route currently requires the server patch. If the tunnel hostname changes, update `API_BASE` to the verified replacement before publishing.
- Header: `X-Telegram-Init-Data` contains `Telegram.WebApp.initData`; do not log it or put it in URLs.
- GET `/api/tasks?scope=me|all&limit=200&before_id=<cursor>` returns `{tasks, next_cursor, total, can_view_all}`. Omit the cursor for the first page; fetch until it is null.
- The server authenticates the Telegram signature, limits All to configured managers, and filters personal assignments before pagination. The frontend treats a missing/error/invalid response as a visible failure, never an empty successful feed.

## Release verification

1. Follow the server repository review and deployment rule, including Fio merge. Validate nginx configuration and the signed API contract after deployment. Unauthenticated requests must fail; the exact GitHub Pages origin must pass CORS preflight.
2. Run `tests/task-feed.cjs`, `tests/telegram-safe-area.cjs`, `tests/search-layout.cjs`, and `tests/bottom-tray.cjs` with Playwright and the official Telegram SDK snapshot supplied through `TG_SDK_PATH`. These are fixtures, not a phone or live API verification. Preserve the collapsed tray with Search and New Task revealed only when expanded.
3. Publish the frontend only after the authenticated HTTPS API works. Confirm the served HTML matches the tested commit.
4. Open the named Telegram app and check personal tasks, All, groups, Today and Week. Record actual phone confirmation separately from automated tests.

No task records should be written by deployment checks. The local tests intercept all traffic and block task mutations.

## Large lists

All cursor pages remain searchable. Swipe controls are populated near the viewport or on the first interaction. Lightweight row wrappers are created during initial rendering so initialization cannot cancel an in-flight click by reparenting its target. Today editing/details also initialize the corresponding source row before interaction. Browsers without IntersectionObserver populate controls immediately.

A desktop Chromium fixture with 6,441 synthetic tasks rendered in 1.06 seconds versus 3.66 seconds before deferred controls; searching the oldest task took 0.44 seconds. These local-response measurements do not establish phone or production-network performance. All source rows remain in the DOM, so this reduces initial overhead but is not full list virtualization.
