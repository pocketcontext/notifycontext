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

Docker CLI access is denied by the local daemon, and noninteractive sudo is unavailable. The image build and container config/smoke/populated-replica-restore checks have not run. CI includes these release gates. The native populated-backup test does not establish Litestream/R2 recovery.

No real Google OAuth client or production hostname has been configured. Live Google browser sign-in, real operating-system popup delivery, actual recipient device compatibility, HTTPS/proxy behavior, dedicated R2 access/replication and deployment remain unverified. Desktop alerts require an open authenticated browser client; there is no background Web Push.

Application image publication is gated by `NOTIFYCONTEXT_PUBLISH_ENABLED` and passing release checks. Public publication was subsequently authorized and enabled; see the release status above. Deployment preparation is in `docs/deployment.md`; no automatic production deployment workflow is active.
