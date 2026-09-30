# NotifyContext browser client

Responsive inbox, sent notifications, Markdown composer/detail, explicit acknowledgement, availability and desktop alerts for general colleague work. Browser reads use authenticated filtered SQL; writes use ordinary PocketBase REST.

```sh
npm ci
npm run build
```

The composer accepts directory selections, comma-separated recipient emails, or both. Existing verified active accounts receive notifications immediately. A new colleague has 30 days to sign in and claim a pending notification; no invitation email is sent. Sent details preserve recipients without directory accounts and show “Awaiting first sign-in,” “Expired,” or “Withdrawn.” Email addresses are shown only where the authenticated sender/recipient SQL policy permits.

The production build writes `../pb_public/` (generated and untracked). Run the pinned PocketContext binary from the application root; `pb_hooks/frontend.pb.js` serves these public assets. `npm run dev` starts a local Vite client and proxies `/api` to a local server at `127.0.0.1:8090`.

Use your admitted Google Workspace account. The expandable local sign-in form supports operator-provisioned test accounts. The official PocketBase SDK LocalAuthStore keeps tokens under `notifycontext.auth`, sharing sign-in across tabs and browser restarts. Logout clears private views across tabs; account changes discard old requests. Active browser sessions renew at most every five minutes. Tokens are accessible to same-origin JavaScript. SQL pagination adapts to response byte truncation. Fetching and opening detail do not mark read or acknowledge; use the explicit action buttons.

Desktop alerts require HTTPS or localhost, permission, the Notifications API, Web Locks and an open app tab. Polling runs every 15 seconds, subject to browser throttling. Notifications use generic lock-screen text and contain no message content. Web Locks serialize cross-tab deduplication; only a notification ID and alert time are stored locally. Pausing alerts preserves incoming notifications for one catch-up summary while the app stays open. This is not background Web Push. In unsupported browsers, use the inbox.

Validation:

```sh
npx playwright install chromium
npm test
npm run build
python3 tests/live.py --binary /absolute/path/to/pinned/pocketcontext
```

The browser suite exercises safe Markdown, explicit actions, a multi-page backlog, mobile layout, keyboard dialog navigation, permission denial, alert deduplication, pause/resume and revoked sessions. Alert APIs are mocked; native OS popup delivery is not verified. The live test runs a production build against an isolated synthetic database and verifies browser writes through authenticated SQL. Live Google OAuth requires separately configured credentials and is not covered by the local browser test.
