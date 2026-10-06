# Local validation — 28 September 2026

This records initial local implementation validation. Later public release/deployment status is recorded in [DEPLOYMENT.md](../DEPLOYMENT.md).

## Pinned server

Built PocketContext `a92b0de5e1b66b6d3b6135b90092d2d6da5f7cc8` from a clean detached worktree, with Go 1.27.1 and CGO enabled. `go version -m` confirms that revision and `vcs.modified=false`. Local binary: `/home/jack/.cache/notifycontext-server-a92b0de/bin/pocketcontext`.

The environment's `/tmp` quota prevented linking; building with task-specific `TMPDIR` and `GOTMPDIR` under the user's cache resolved it. Every test database and provider fixture was synthetic and isolated.

## Passed

- `tests/integration.py`: publication, concurrent duplicate retries, conflicts, withdrawal, explicit recipient actions, status/preferences and transactional rollback.
- `tests/security.py`: filtered SQL aggregates/joins, private recipient events, hidden/auth/system fields, independent REST/expansion rules, disabled batch API, strict input/calendar validation, revoked sessions and actual SSE subscription isolation.
- `tests/auth.py`: default identity collection, direct-signup rejection, directory rollback, blocked ordinary account management, disable/unverify revocation, preserved attribution.
- `tests/oauth_integration.py`: local Google provider fixture, Workspace JIT claims, PKCE, identity preservation and revocation.
- `tests/skill.py`: copied portable skill outside the repository, schema snapshot comparison, multi-page backlog with no read side effects, publish retries, per-item bulk actions, status/preferences and date-filter validation.
- `tests/deploy.py`: deployment settings, paired provider configuration failure, verified-user smoke client and populated domain fixture.
- `tests/backup.py`: populated native backup restored into isolated empty storage; identities, Markdown, acknowledgements, references, events, status/preferences and private visibility preserved.
- `tests/client.py`: 11 behavioral tests, including truncated-page adaptation, complete backlog retrieval, bulk outcomes and date filters.
- `tests/oauth.py`: 12 portable OAuth/session protocol tests.
- `tests/deploy_workflow.py`: 12 fixed-target deployment/recovery tests without remote execution.
- Skill creator `quick_validate.py`: passed. Independent agent review of the backlog skill found no blocking issues.
- Production frontend build with Node.js 22.
- Eight Playwright Chromium tests: safe Markdown, explicit actions, paginated backlog/search, mobile layout and keyboard dialog focus, permission denial, desktop-alert deduplication, paused catch-up, session revocation and revocation during detail retrieval.
- Actual production browser client against the pinned server: password sign-in, filtered inbox/detail, explicit read/acknowledgement, composition, sent view, availability and pause; writes independently verified using authenticated SQL.
- Generated frontend HTML/JavaScript/CSS serving helper checked against a native isolated server. Workflow YAML parsed successfully.

Browser commands from the application root:

```sh
npm --prefix frontend ci
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend test
npm --prefix frontend run build
python3 frontend/tests/live.py --binary /absolute/path/to/pinned/pocketcontext
```

The browser suite uses Chromium with synthetic HTTP fixtures; the live test uses the actual server and built assets. Notification API calls are stubbed in alert tests. Desktop and mobile screenshots were inspected for overflow and layout.

## Remaining release checks

Docker CLI access is denied by the local daemon, and noninteractive sudo is unavailable. These checks subsequently passed in [release CI](https://github.com/pocketcontext/notifycontext/actions/runs/36387200250): image build, container config/smoke and populated Litestream/MinIO replica restore. Production EU R2 recovery subsequently passed; see DEPLOYMENT.md.

Production Google provider configuration, HTTPS/proxy behavior, dedicated EU R2 access, recovery and deployment were subsequently verified. Live Google browser sign-in, real operating-system popup delivery and actual recipient device compatibility remain unverified. Desktop alerts require an open authenticated browser client; there is no background Web Push.

Application image publication is gated by `NOTIFYCONTEXT_PUBLISH_ENABLED` and passing release checks. Public publication was subsequently authorized and enabled; see the release status above. Deployment preparation is in `docs/deployment.md`; no automatic production deployment workflow is active.

## Pending email recipients — 28 September 2026

The unchanged clean pinned server was used for isolated synthetic tests. Existing integration, security, authentication, deployment settings, OAuth client and locked-deployment tests passed. The native backup fixture now includes an unclaimed email recipient and verifies that its destination/expiry survive restoration while remaining hidden from other recipients. The container smoke/replica fixture includes the same pending-recipient state.

The copied portable skill passed live schema comparison and full-backlog tests with pending rows, mixed ID/email deduplication and password-login nonclaim behavior; all 15 client tests passed. Eleven Chromium tests and the production build passed. The actual-server browser test publishes to an existing account and a future email address, verifies both in Sent, and independently checks linkage/expiry through authenticated SQL.

Independent review checked that verified Google claim writes commit before the token response, email addresses remain protected by sender/linked-recipient SQL filters, and old publication keys retain their canonical payload. Claiming a very large pending backlog uses one transaction and may increase Google sign-in latency; no background claimant is introduced.

The new pending-recipient suite passed migration/legacy-key compatibility, multiple pending destinations, expiry and withdrawal nonclaim, trusted Google claims, no password claim, new-account and multi-notification rollback, concurrent signup/publication, permanent claimed identity across email reassignment, and unchanged read/acknowledgement state after claim. The existing Google OAuth integration suite passed after the transaction changes. CI now runs the new suite before image publication.

## Record navigation — 30 September 2026

All README Python validation commands passed against the unchanged a92b0de server
pin with isolated synthetic databases. Twelve Chromium tests passed, including
permalinks outside the current list, reload/sign-in, archived/search URL state,
browser back navigation and absence of implicit acknowledgements. The production
frontend build passed. The browser test server now uses a configurable dedicated
port (`NOTIFYCONTEXT_TEST_PORT`) and refuses to reuse an unrelated running server.
Container config/smoke/populated-restore remain release CI gates.

## Persistent SDK browser sessions — 30 September 2026

All eleven README Python validation commands passed against the unchanged clean
`a92b0de` pin using isolated synthetic databases. Node.js 22 production build,
16 Playwright tests and the actual-server browser workflow passed. New coverage
checks cross-tab login/logout, persistence across reload, account changes clearing
private views/drafts, delayed responses and refresh after logout, and same-account
token renewal preserving an open draft. No implicit acknowledgement was added.
The official PocketBase JS SDK is pinned to 0.28.1 in the frontend lockfile.
Container smoke and populated recovery remain release CI gates.

## Realtime unread favicon — 3 October 2026

All twelve README Python suites passed against the unchanged clean `a92b0de`
server pin, using synthetic isolated databases. New actual-SSE coverage checks
sender/recipient routing, empty payloads, cross-user/operator/anonymous rejection,
locked record subscriptions, committed SQL visibility, duplicate retries,
publication and OAuth claim rollback, reconnect, revocation and token expiry.

The Node.js 22 production build and all 22 Playwright tests passed. Browser
coverage includes exact counts, zero/99+ badge states, filters, alert pauses,
withdrawal, offline retention, reconnect, 60-second fallback, changes during an
in-flight refresh, logout races and same-account token renewal without draft loss.

The production browser workflow verifies that marking a notification read in one
tab updates a second tab's title and sidebar through realtime within five seconds.
No read or acknowledgement is caused by fetching or opening a record.

Headed Chromium pinned-tab checks inspected the actual browser chrome at standard
and 2x display scales, including a dark browser theme. Counts 1, 9, 10, 24, 99 and
99+ remain visible with the N mark; zero uses the plain mark. The exact count stays
in the title/sidebar. This is a Linux Chromium check, not a guarantee for every
browser, device, suspension policy or native desktop notification configuration.

## Packaged CLI and tracing — 4 October 2026

The full-name `notifycontext` launcher replaces the former Python script; no
compatibility wrapper is shipped. The package owns the client and schema snapshot
and pins the ObserveContext instrumentation dependency. The server enables opt-in
bounded buffer tracing; ordinary requests remain untraced.

Local integration, security, realtime, auth, OAuth integration, pending-recipient,
portable skill, deployment, populated backup, client, OAuth and deployment-workflow
checks passed against server `a92b0de5e1b66b6d3b6135b90092d2d6da5f7cc8` in isolated
synthetic databases. Frontend build and all 22 browser fixture tests passed.
Remote copied-launcher and release container checks are recorded with the release.

## Runtime maintenance adoption

Release gates include `python3 tests/maintenance_entrypoint.py` and
`python3 tests/maintenance.py --binary /absolute/path/to/pinned/pocketcontext`.
They exercise superuser-only control, denied publication/acknowledgement/batch
writes, retained filtered-read privacy, auth refresh, generation conflicts,
frozen restart with changed deployment credentials, pending-migration rejection,
and explicit thaw with publication deduplication preserved. Startup cases cover
private regular markers, malformed state, missing databases, skipped restoration
and preserved operator credentials. The server's maintenance suite separately
checks in-flight write draining and managed SQLite connections.

## Strict container startup and recovery — 6 October 2026

The production container now requires primary S3 and Litestream and uses a Python
entrypoint. Fresh installation requires explicit `init`; normal empty-volume
startup requires a replica. Recovery stages SQLite and reads every referenced file
before atomic installation. File checks prove readability and complete transfer,
not cryptographic content integrity; NotifyContext has no authoritative file hashes.

Local validation used the unchanged pinned `976ddf71` server and synthetic isolated
records. All documented application Python suites passed, including copied skill,
notification/privacy/realtime/auth/OAuth/pending-recipient, deployment, backup,
maintenance, primary-storage settings, client/OAuth utilities and deployment wrapper.
The consolidated entrypoint suite passed 41 tests, including avatars, multiple files,
view aliases, unsafe references, interruption, secret suppression, frozen auxiliary
state and staged recovery. The compatibility maintenance-entrypoint command runs
this same suite. Recovery-comparison regression checks passed.

The local image build, configuration errors, original smoke assertions, populated
three-volume restore, and primary S3 recovery gates passed. The latter also checks
ordinary startup with no replica, explicit init against a populated replica, and
missing referenced objects: all fail without installing a database. Returning the
held synthetic object allows successful recovery. No image was published and no
production deployment or real data was changed. Browser assets were built by the
image; browser UI source was unchanged.
