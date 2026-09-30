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
