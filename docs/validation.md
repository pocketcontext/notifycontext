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

Application image publication is gated by `NOTIFYCONTEXT_PUBLISH_ENABLED` and passing release checks. Public publication was subsequently authorized and enabled; see the release status above. At this initial release, no automatic production deployment workflow was active. Current deployment controls are in `docs/deployment.md`.

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

## Destination continuous deployment — 6 October 2026

The image workflow now includes deployment after successful manifest publication,
with the existing publication guard retained. Seven offline deployment tests pass:
pause/profile and publication dependency, environment/concurrency, actual commandless
SSH invocation, missing host-key refusal, remote failure propagation, bounded Notify
health checks, and both legacy commands refusing without changing keys or invoking
deployment tools. These replace tests of the retired source-host rollback wrapper.
The maintained destination dispatcher owns stop-first and pending-marker semantics.
Local workflow tests do not establish GitHub environment setup or live activation;
record those separately after verification.

## Browser-opening Google login — 21 October 2026

`login --google` opens the printed URL with the standard library browser module
unless `--no-browser` is given, `SSH_CONNECTION`/`SSH_TTY` is set or, outside macOS
and Windows, no graphical display is available. A failed open never fails login.
Unit tests mock the browser module. Integration, security, realtime, auth, OAuth
integration, pending-recipient, portable skill, deployment, populated backup,
maintenance, client (15), OAuth (15), deployment-workflow (10) and entrypoint
checks passed against server `976ddf71a4734530adefe4a56633658a0894b449`. Browser UI
source was unchanged; frontend and container checks were not rerun locally.

## Rate-limit recovery, consolidated reads and server 934a63a — 29 October 2026

Production readers saw PocketBase's "Too Many Requests" in the detail panel. The
`/api/context/` rule allows 60 requests per 10 seconds per `RealIP()`, and its 429
carries no `Retry-After`. The browser previously sent 15 SQL requests at startup,
6 per refresh, 3 per detail and about 15 per recipient action.

The browser now sends one refresh query returning the list page (explicit columns,
140-character SQL excerpt, has-more probe), global unread count, latest inbox IDs
and preferences; one detail query with independently aggregated recipients and
references; and a joined directory/status read at startup, every five minutes,
after an unknown sender and after its own status change. Oversized aggregates fall
back to separate reads; incomplete recipient lists are reported, never shown as
complete. Measured against the real server: startup 2, steady refresh 1, detail 1,
recipient action 2–3, direct-link startup 3. Triggers share one coalesced queue
(one in flight, one pending, 2-second background minimum). A 429 starts a shared
cooldown honoring `Retry-After`, otherwise 2–60 seconds of jittered exponential
backoff; the selected detail reopens after recovery for the same session and
selection. Writes are never retried automatically.

Server adoption: PocketContext `934a63a13c3fa97be5e5f0e0329b793375bc8f08`, built
from a clean detached worktree (`vcs.modified=false`), runs synchronous filtered
snapshots: a requester's copy is reused until any committed write. Background
generations, `trackChanges` and `maxConcurrentPerRequester` remain unset; the
schema reports the last as 0. Migration `1790300500_lookup_indexes.js` adds ordinary
`notification_recipients(notification,recipient)`,
`notification_references(notification,created,id)` and
`notifications(sender,created,id)` indexes, because snapshot index copying skips
partial indexes. On 20 synthetic users, 3,000 notifications and 11,051 recipient
rows, cold snapshot builds fell from a 5,003 ms timeout to about 430 ms for the
heaviest user and from about 2.4 s to 180 ms for the median user; warm reads stayed
about 3 ms over HTTP. Upgrade startup took under 0.4 seconds. `trackChanges` helped
only status writes and doubled write latency, so it stays off.

All README Python suites passed against 934a63a with synthetic isolated databases,
including the new `tests/snapshot_freshness.py` (reuse, then fresh state and
authorization after publication, read, acknowledge, archive, unarchive, withdrawal
and Google claim; sender, recipient, unrelated-user and pending-address privacy)
and `tests/lookup_indexes.py` (populated upgrade, unchanged partial indexes, plans,
down migration). The 39 Chromium tests, production build and actual-server browser
workflow passed against both 976ddf71 and 934a63a, including privacy of the replayed
detail SQL, read-after-write, 100 maximum-length multibyte acknowledgements and a
real rate-limit 429 with automatic detail recovery. A locally built image passed
config, smoke, populated restore and primary-S3 recovery; actionlint was clean.
Local runs used Node.js 26 and do not replace native CI on both architectures.

Known limits: cooldowns are per tab and shared IP buckets are not coordinated;
with `maxConcurrent` 4, many recipients refreshing after one write rebuild
snapshots repeatedly (no worse than the previous pin). The live trusted-proxy
header and effective rate-limit settings were not inspected from this host.

## Snapshot concurrency 8 — 29 October 2026

With the consolidated browser reads, eight synthetic users refreshing after one
write needed the minimum eight snapshot builds at `maxConcurrent` 4 (1.3–1.7 s),
but a refresh plus detail read doubled them to 16 (2.6 s). At 8 slots the same
load needed eight builds (1.3–1.4 s), using about 40 MB of temporary snapshot
files instead of 16–19 MB and peak memory of 129–131 MB within the 512 MB
container. `maxConcurrent` is now 8; the schema snapshots record it.

## Rate-limit backoff for the client and reader — 29 October 2026

PocketBase v0.40.4 limits per `RealIP()` in fixed whole-second windows that refill
completely (`/api/context/` within about 10 seconds) and does not charge rejected
requests or send `Retry-After`. The reader's backoff without a hint is now 2, 4, 8,
then 11 seconds (50–100% jitter) instead of growing to 60, and `Retry-After` is
capped at 60 seconds instead of 300. The CLI client's `send()` now retries HTTP 429,
including writes, which both limiters reject before execution: `Retry-After` when
present (capped at 60 s), otherwise 1, 2, 4, 8, 11 seconds with jitter, within a
60-second budget (`NOTIFYCONTEXT_RATE_LIMIT_WAIT`, 0 disables), with one stderr
line per wait. Other statuses and transport failures are not retried.

`tests/client.py` (20) checks the sequence, hints, cap, exhausted budget, disabled
budget, no 5xx retry and a resent write against a local HTTP server.
`tests/rate_limit.py` exhausts a real server's enabled limits, then verifies that
the installed client's query and backlog succeed after retrying, a zero budget
fails at once, and no recipient state changes. A new Chromium test checks the
reader's 2, 4, 8, 11, 11, 11 second waits. All README Python suites, 40 Chromium
tests, the production build and the actual-server browser workflow passed against
934a63a with synthetic isolated data.

## Server 416841c (v0.9.4, PocketBase v0.41.1) — 30 October 2026

The adopted server is `416841c4d1225ddc464ce0b1e787a797d5b8d7e8`, which changes only
PocketBase 0.40.4 to 0.41.1 and installer/release tooling. Against a clean build of
that commit, all README Python suites plus the CI maintenance, entrypoint,
recovery-comparison and object-storage checks, the 40 Chromium tests, the production
build and the actual-server browser workflow (including the real rate-limit 429 and
detail recovery) passed with synthetic isolated data. Local runs used Node.js 26.
Container gates were not run locally (no Docker).

## Markdown links open in a new tab — 30 October 2026

Sanitized Markdown `http(s)` links in notification bodies, acknowledgement notes and
the compose preview now open in a new tab with `rel="noopener noreferrer"`, matching
reference links, so the open record and acknowledgement drafts survive. `mailto:` and
in-app links are unchanged; `javascript:` links remain removed. The 40 Chromium tests,
the production build and the actual-server browser workflow passed against a clean
416841c build with synthetic isolated data, using Node.js 26 locally.

## Sender acknowledgement-comment inbox — local validation, 30 October 2026

Implemented sender-private feedback state, historical backfill and read/archive/unarchive
triage. Nonempty comments from another recipient resurface one notification row unread;
blank/self acknowledgements do not. Recipient state is unchanged. No conversation API
or repeat acknowledgements were added. This change has not been published or deployed.

Validated with a clean source build of the pinned PocketContext 416841c, CGO and
sqlite_math_functions, on macOS arm64. Frontend build and all 40 Playwright tests passed.
The real-browser feedback test passed a 19-comment historical migration, quiet startup,
comment search, explicit read, archive across reload, Sent retention, a later recipient
comment returning to the top, unread counts and one desktop alert. Native OS alerts
were mocked. The screenshot was inspected for layout.

Server feedback tests passed backfill exclusions, owner-only SQL/REST, independent
recipient state, duplicate acknowledgement idempotency, stale read/archive conflicts,
unarchive and transaction rollback on acknowledgement-event failure. Integration,
private realtime (including sender-only feedback triage and later-comment routing),
snapshot freshness, lookup-index upgrade/rollback and adversarial security passed.
The 22 client tests and portable skill/schema checks passed, including feedback retrieval
and explicit read/archive. The existing live-browser test also passed large-detail
fallback and real rate-limit recovery. Python 3.14 was used for security checks because
macOS system Python 3.9 raises socket.timeout separately from the test's TimeoutError catch.

`python3 scripts/preview_feedback.py --binary /absolute/path/to/pinned/pocketcontext`
starts a disposable loopback-only synthetic preview. Real existing comments are backfilled
when migration 1790300600 is deployed; no live recipient or sender state was changed during
this validation. The published client launcher remains unchanged until release.

Preview follow-up: fixed desktop scrolling so the list and detail panes scroll
independently within the viewport, and each selected message opens at its top.
The new long-list/long-message regression and both targeted mobile layout tests
passed (3 tests); production frontend build passed. Verified in the user's local
preview with the last row selected and its details visible alongside it.

Split-action follow-up: all 43 frontend tests passed, including the combined
request with an optional note, individual dropdown actions, keyboard dismissal,
and the single-action state without a dropdown. The production frontend build,
combined-action server tests, integration tests and feedback browser workflow
passed. Server coverage includes atomic read/acknowledge/archive, stale revisions,
authorization, later-comment resurfacing and rollback on audit-event failure.
Verified the split button and expanded individual-action menu in the local browser.
The restarted preview uses synthetic records; production remains unchanged.

## Shared notification conversations — 2 November 2026

Migration 1790300700 adds immutable shared comments and owner-only conversation
inbox state. Historical acknowledgement notes remain private. Synthetic tests cover
repeated sender/recipient comments, duplicate and simultaneous submissions, ordered
pagination, author attribution, private-state isolation, explicit triage, stale
legacy and canonical revisions, pending-email history claims, withdrawal, and
atomic rollback when comment or triage audit creation fails. The populated native
backup and container smoke/recovery fixtures now include comments and state.

Validation uses the unchanged clean server pin
`5f1b8f53e0af9d45cb0b396a2ecfb4e9932dca5a`, built with Go 1.27.2, CGO and the
Makefile's SQLite tags (`vcs.modified=false`). Application regression suites,
conversation tests, client tests and copied source-client skill checks passed.
Workflow validation with actionlint and the package source/wheel build passed.
Release CI still gates publication on native AMD64/ARM64 application, container
configuration, smoke and populated recovery checks.

The frontend production build, actual-server baseline and historical-feedback
workflows, and new conversation browser workflow passed. The browser regression
run passed 45 of 46 tests initially; its remaining test asserted identical SQL
across selected records. It was updated to compare the unchanged alert subquery
because detail-version refresh now includes the selected record. The corrected
test passed separately. New browser coverage includes shared visibility, multiple
replies, archived resurfacing, draft and focus/caret retention, expanded history,
withdrawal refresh, search and mobile layout. Desktop and mobile screenshots were
inspected; native OS alerts remain mocked.

The standalone launcher was then pinned to published client source
`9069a17a329269a585aa37d2b1109fbcec201ac0`. The copied-launcher skill suite passed
against the exact server pin from an unrelated temporary directory, including
conversation pagination, duplicate retries, schema checks and personal triage.

## Consistent Markdown editors and conversation split actions — 2 November 2026

The browser now uses one Write / Preview component for notification messages,
shared comments, private acknowledgement notes and withdrawal reasons. Saved
withdrawal reasons use the same sanitized renderer. Conversation triage uses the
existing green split-button pattern, preserving explicit version-checked actions.
No database schema, server pin or client package change is required.

All 24 local backend/client regression suites passed against the unchanged clean
`5f1b8f53e0af9d45cb0b396a2ecfb4e9932dca5a` server. The production frontend build
and all three rebuilt actual-server browser workflows passed: baseline (including
real 429 recovery), private feedback and shared conversations. New coverage checks
Preview submission and exact Markdown payloads, empty required validation, sanitized
withdrawal display, keyboard/mobile behavior, editor sizing, independent scroll,
account isolation, delayed-dialog safety and explicit split actions. A delayed
refresh regression verifies edits and cursor changes made while a read is pending;
focus is captured immediately before DOM replacement. Desktop/mobile screenshots
were inspected for layout and overflow. Workflow actionlint passed.

The final clean browser fixture run passed all 59 tests in 2.2 minutes.

## Consistent detail action sizing — 2 November 2026

A scoped CSS rule gives acknowledgement and conversation split controls, their
dropdown segments and Post comment 13px text and 38px height. Label widths remain
content-based; dropdown segments retain their 40px width. The old acknowledgement
primary-button 12px override was removed, while secondary-button styling remains.
Write / Preview tabs and controls outside the detail action area are unchanged.

Temporary browser measurements at 1440px and 390px viewport widths confirmed all
five target segments are exactly 38px high with 13px text. Comparing the previous
stylesheet on the same DOM confirmed the tabs remain 34px high with 12px text and
unchanged widths. Desktop/mobile and expanded-dropdown screenshots were inspected.
No tests were added for this CSS-only adjustment; existing release checks apply.

The production build, all 59 existing browser fixture tests and all three actual-server
workflows (`live.py`, `feedback.py`, `conversations.py`) passed against the unchanged
pinned server. The baseline workflow includes real 429 recovery. Workflow validation
and actionlint passed.

## Auto-advance after archiving — 2 November 2026

The private account preference selects stay (default), next older, previous newer,
or return to list after successful Inbox archive and combined archive actions.
The additive migration preserves existing alert pauses and revisions. Destination
selection uses the current filtered result order, captures the neighbor before
writing, revalidates after success and updates the displayed page. Navigation
never reads or acknowledges the destination and preserves drafts in the tab.

All 25 backend/CI regression suites and the updated source-client portable skill
suite passed against clean pinned server
`5f1b8f53e0af9d45cb0b396a2ecfb4e9932dca5a`. New preference coverage checks populated
upgrade, defaults, invalid values, private SQL/REST access, revision conflicts and
independent alert-pause updates. Backup/container fixtures retain nondefault
preferences. Package source/wheel build and workflow actionlint passed.

The production frontend build and all four actual-server browser workflows passed:
baseline (including real 429 recovery), private feedback, shared conversations and
new auto-advance navigation across page boundaries in both directions. The new
workflow verifies through authenticated SQL that destination read/acknowledgement
state stays untouched. Desktop and mobile settings screenshots were inspected.
Browser fixtures execute real SQLite SELECTs for neighbor/filter/pagination tests;
release CI additionally runs them and the actual-server workflows on AMD64/ARM64.
Local validation used Node.js 26; native CI uses the documented Node.js 22.

All 79 browser fixture cases passed: the full 75-case run (59 existing and 16 new)
and four additional concurrency/mobile cases, followed by the updated settings
screenshot check. Independent frontend/backend review found no blocking issues.

The portable launcher was pinned to published client source
`4e507e7b9375d5495d57aa1e72daec0103d37ab7`. Its copied-launcher suite passed from
an unrelated temporary directory against the exact pinned server, including live
schema comparison and explicit preference updates. The final release workflow
validates this source and launcher together before image publication.

## Checkbox recipient picker — 9 November 2026

The composer's "To" field is now a group of labelled checkboxes, one 44px row per
directory colleague, sorted by name, with the signed-in account marked "(you)". A
line below the list shows the count and names selected. More than eight colleagues
adds a filter field and an internally scrolling list; filtered-out selections stay
selected and are still sent. Availability appears under a name only when a current
status is set; unset and expired statuses show nothing instead of "Not set". The
hint reads "Choose colleagues, add emails, or both." Checkboxes keep the field name
`recipients`, so the publication payload is unchanged. With no recipients, submitting
focuses the first colleague (or the email field). Composer fields are 16px at
900px and below to avoid iOS zoom. No schema, hook, server pin or client change.

The directory (`user_directory`) mirrors every `users` row's ID and name and is not
updated when an account is disabled or unverified, so disabled accounts still appear.
Publication to them is refused (`notify.js` `active()`, HTTP 403). A synthetic local
instance with two disabled accounts named "Deployment verification (disabled after
checks)" reproduced both duplicate rows and the 403. The browser cannot tell which
entries are disabled; hiding them needs a server-side directory change.

Validation used a clean build of the unchanged pinned server
`5f1b8f53e0af9d45cb0b396a2ecfb4e9932dca5a` (`vcs.modified=false`, Go 1.27.2) and
synthetic isolated data. The production frontend build passed, as did all 83 browser
fixture tests: the 79 existing ones, with composer tests moved from `selectOption`
to checkboxes, and four new ones covering selection, deselection, the exact payload
keys, mixed recipients, keyboard Space/Tab/Shift+Tab with validation focus, a
filtered long list with hidden selections and Enter in the filter not submitting,
and 390px touch sizes (rows of at least 44px, 16px fields, no overflow). All four
actual-server browser workflows passed (`live.py` now checks a colleague by ID).
Every README Python suite, plus `tests/feedback.py`, `combined_actions.py`,
maintenance, object-storage, entrypoint and recovery-comparison, passed. The
package suites ran under `.venv/bin/python`. Desktop and 390px screenshots of a
synthetic local instance were inspected. Local runs used Node.js 26; container
gates were not run locally.
