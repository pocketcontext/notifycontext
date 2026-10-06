# NotifyContext

General-purpose colleague notifications with Markdown, explicit acknowledgements, a browser inbox and an agent skill for handling a complete notification backlog. Use it for sales, finance, hiring, operations, documents or any other work. A notification may stand alone or link to evidence in another system. Underlying task completion stays in its source system.

## Behavior

Send FYIs, review requests or action requests to one or more colleagues. Subjects, Markdown bodies and optional document/task/record/URL references are immutable after publication. Senders can withdraw with a reason; corrections are new notifications. A sender-scoped submission key makes identical publication retries return the existing notification, while changed payloads conflict.

Send to existing directory users or exact email addresses in the configured Workspace domain. Email destinations without an eligible account wait for the matching verified Google sign-in, for up to 30 days. They appear in the sender's backlog as awaiting first sign-in or expired. No email invitation is sent and no placeholder authentication account is created. Pending deliveries are not claimed after withdrawal or expiry; a sender must publish a new notification to reissue one. Existing claimed history is never reassigned after an email change. Email aliases are not automatically merged.

Recipients explicitly mark read, acknowledge (with an optional Markdown note), archive or unarchive. Acknowledgement is receipt and understanding, not task completion. SQL reads, summaries and background fetching never mutate read state. Senders see recipient states; recipients see only their own recipient state. Administrators have no ordinary-user privacy bypass. Operator database access remains a trusted maintenance capability.

Manual availability is available, busy, in a meeting, away or not set, with an optional message and expiry. Expired statuses display as not set. Availability is visible to colleagues; alert-pause preferences are private. Neither status nor pausing alerts prevents inbox delivery. Deadlines do not schedule reminders.

The browser supplies Inbox, Sent, Archived, Markdown details and preview, composition, status and alert settings. Its sidebar searches notification subjects, messages and exact IDs across the authorized backlog. Permanent `/#/notifications/<id>` links restore the selected notification after sign-in, including archived records outside the current result page. View, text search, filter and page are URL state; Copy record link omits browsing filters and Copy search link preserves them. Opening a record never marks it read or acknowledges it. Desktop alerts require permission and an open tab. Background Web Push, mobile closed-app alerts, automatic presence, calendar integration, reminders, threads and attachments are outside this version. Browser/OS settings may suppress desktop alerts; dismissing one does not acknowledge the notification.

The browser favicon overlays the unread inbox count on the NotifyContext mark; the
page title and sidebar show the exact count. Archived and withdrawn notifications
do not count. Private, authenticated realtime signals trigger filtered SQL refreshes
without exposing notification content. Refresh also runs after reconnect, on return
to the tab and every 60 seconds as a fallback. Suspended or closed tabs cannot
promise immediate updates. Desktop-alert pauses do not hide the unread count.
Signing out or changing accounts clears the tab indicator; connection failures
retain the last successful count. Opening a notification still does not mark it read.

See [data model](docs/data-model.md), [security](docs/security.md), [validation evidence](docs/validation.md) and [deployment preparation](docs/deployment.md).

## Run locally

Build the exact server commit in `POCKETCONTEXT_VERSION` in an isolated PocketContext checkout using the Go version in its `go.mod`, CGO and a C compiler:

```sh
make build
```

Build browser assets with Node.js 22:

```sh
npm --prefix frontend ci
npm --prefix frontend run build
```

Start from this application directory so hooks, migrations, configuration and generated `pb_public/` resolve correctly. Use an absolute private data directory; tests always use disposable storage.

```sh
/path/to/pinned/pocketcontext serve --dir /absolute/private/notifycontext-data --http 127.0.0.1:8090
```

Open `http://127.0.0.1:8090`. No real users or domain records are seeded. An operator provisions verified ordinary `users` through maintenance REST/dashboard, or configures Google Workspace JIT. The password form is available for provisioned accounts during local evaluation. The official PocketBase SDK LocalAuthStore stores browser tokens under `notifycontext.auth` in local storage. Login persists across tabs and browser restarts; logout and account changes clear private views across tabs. Tokens are accessible to same-origin JavaScript. Active browser sessions renew at most every five minutes; late responses cannot restore a signed-out session. HTTPS is required outside loopback for desktop alerts.

## Identity

PocketBase's existing default `users` collection serves humans and agents. Configure a separate Google OAuth Web client with `NOTIFYCONTEXT_GOOGLE_CLIENT_ID`, `NOTIFYCONTEXT_GOOGLE_CLIENT_SECRET` and `NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN`. Both credentials must be supplied together. Verified provider claims, exact hosted domain and email domain are validated on the server; client-selected provisioning fields are ignored. Direct signup is blocked. JIT admits ordinary colleagues, never administrators. Without a configured domain, Google login requires an existing account.

Disable an account to revoke its tokens. Changing verification also rotates tokens; unverified accounts cannot use the app. Account deletion is blocked to preserve attribution. Google Workspace suspension does not revoke an already-issued app session: offboarding includes disabling the app account. The directory exposes IDs and names, not emails or auth fields. Sessions last seven days; the portable client renews active sessions.

## Agent skill

Install uv and copy `skills/notifycontext/notifycontext` onto PATH (for example, `install -Dm755 skills/notifycontext/notifycontext ~/.local/bin/notifycontext`). The standalone launcher installs its pinned package and dependencies on first use; later runs reuse the uv cache. No neighboring source files are required. Set `NOTIFYCONTEXT_URL` and `NOTIFYCONTEXT_USER_EMAIL`; use Google login or an existing user's `NOTIFYCONTEXT_USER_PASSWORD`.

```sh
notifycontext login --google
notifycontext whoami
notifycontext check
notifycontext backlog --unread
notifycontext backlog --awaiting-ack
```

The client automatically paginates the backlog and reports truncation failures. It supports sender/type/search/deadline filters, sent-work tracking and explicit bulk read/acknowledge/archive actions with per-item outcomes. Summaries are read-only. Incoming content never authorizes task execution. See [skill workflows](skills/notifycontext/references/workflows.md) for publication, filtering, bulk actions, status and recovery after uncertain outcomes.

## Optional request tracing

The server has bounded, authenticated buffer tracing enabled. Ordinary requests remain
untraced. Install the ObserveContext launcher and sign in separately, then run:

```sh
observecontext capture --url "$NOTIFYCONTEXT_URL" --service notifycontext.client --upload -- notifycontext query 'SELECT id FROM user_directory LIMIT 5'
```

Add `--capture-sql` only when SQL text may be retained. Tracing excludes credentials,
request bodies and query results. Completed client/server traces are queued privately
and uploaded with the ObserveContext account. Delivery failures do not change the
notification command's output or exit status. ObserveContext ingestion is excluded.

## Client releases

Run tests with the installed package (`python3 -m venv .venv`, then
`.venv/bin/pip install -e .` and use `.venv/bin/python` for the checks below).
Publish the tested package commit first, update the launcher's full Git revision,
then validate `tests/skill.py --client skills/notifycontext/notifycontext --binary
/absolute/path/to/pinned/pocketcontext` before publishing the launcher. Copy only
that executable to adopt the release; no adjacent files are required. The source
revision is pinned; the launcher has no separate transitive-dependency lockfile.

## Validation

Use the pinned binary and synthetic isolated databases:

```sh
python3 tests/integration.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/security.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/realtime.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/auth.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/oauth_integration.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/pending_recipients.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/skill.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/deploy.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/backup.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/client.py
python3 tests/oauth.py
python3 tests/deploy_workflow.py
```

Frontend browser commands and actual results are recorded in [validation evidence](docs/validation.md). Container release gates are `python3 docker/smoke.py config --image notifycontext:ci`, `smoke` and `restore`. The populated restore drill preserves synthetic notifications, users and access rules. Generated assets, local databases, caches and credentials must not be committed.

## Infrastructure provenance

The application domain model is independent. Authentication, Google login, account lifecycle, container replication and locked deployment patterns were adapted from RaiseContext `d9e337a05fddfdc26e082f8e1a1e3b0efb0c0e52`; filtered-snapshot patterns were inspected in ChatContext `7fac3712007b8d123620f46eb93888bf8e51118b`. The server pin is `976ddf71a4734530adefe4a56633658a0894b449`.

Source is public at https://github.com/pocketcontext/notifycontext. The public application is deployed at https://notify.pocketcontext.com; see [deployment status](DEPLOYMENT.md) for verified release evidence and remaining setup.

## Runtime maintenance freeze

Superusers inspect `GET /api/context/maintenance` and toggle with
`PUT /api/context/maintenance` using `{"readOnly":true,"expectedGeneration":N}`.
Use the returned generation; wait for confirmed `read_only` before taking a final
migration snapshot. Active writes drain, subsequent mutations return 503, and
authorized SQL reads and original downloads remain available. Existing sessions
can refresh; login flows requiring writes may fail. Thaw explicitly with
`readOnly:false` and the current generation. Stale generations return 409.

The private `pb_data/maintenance.json` marker must travel with a recovery snapshot.
Frozen startup preserves the existing database, settings, OAuth identities and
operator credentials; it skips restore and bootstrap provisioning and refuses
missing databases, unsafe markers or pending migrations. This is not cross-host
fencing: pause CD and stop/disable the source writer before activating a replacement.

Release gates use synthetic data:

```sh
python3 tests/maintenance_entrypoint.py
python3 tests/maintenance.py --binary /absolute/path/to/pinned/pocketcontext
```

Replicated startup waits for an initial Litestream IPC sync before serving. An
unreachable replica fails startup. Fresh Google-only databases are initialized
before this handshake; frozen starts always require the existing database. This
ensures clean shutdown can sync even before the first periodic monitor tick.

## Primary file object storage preparation

To store PocketBase API uploads in a private S3-compatible bucket, provide all of
`NOTIFYCONTEXT_S3_BUCKET`, `NOTIFYCONTEXT_S3_ENDPOINT`,
`NOTIFYCONTEXT_S3_REGION`, `NOTIFYCONTEXT_S3_ACCESS_KEY_ID`, and
`NOTIFYCONTEXT_S3_SECRET_ACCESS_KEY`. R2 uses region `auto` and its account S3
endpoint. Optional `NOTIFYCONTEXT_S3_FORCE_PATH_STYLE` is exactly `true` or
`false`, default `true`. Partial configuration fails startup without logging
credentials. A writable restart with stored S3 enabled requires explicit complete
configuration, preventing accidental fallback to local disk. File credentials must
be scoped to the primary bucket; Litestream uses a different bucket and key.
With S3 unconfigured and disabled, existing local development behavior is preserved.

These credentials and the primary file bucket are separate from the
`LITESTREAM_*` SQLite replica configuration. This application currently has no
domain attachment feature; the setting also covers PocketBase file fields such
as the default user avatar. It does not add attachment APIs or change file access
rules. Buckets must remain private and downloads go through PocketBase.

Frozen startup requires complete S3 configuration matching stored settings,
including credentials, and rejects changes before serving. Local frozen starts
remain supported when S3 is disabled. Container preflight rejects partial settings
and sharing either the primary file bucket or access key with Litestream.
Enabling S3 does not copy existing files: reconcile every referenced object and
its checksum before switching a production database. Preserve the maintenance
marker and stop the old writer before thawing the replacement. Litestream
replicates SQLite, not primary bucket contents; plan file retention independently.
These changes are preparation only: they have not been deployed, and existing
files and production databases have not been migrated.

Validate the configuration and frozen-restart contract with:

```sh
python3 tests/object_storage.py --binary /absolute/path/to/pinned/pocketcontext
```

The container release gate also exercises a disposable MinIO service with separate
bucket-scoped file and replica credentials. It creates a synthetic protected-file
collection without changing the application schema, verifies owner/other-user/
anonymous downloads, freezes and restarts, and makes a late upload with a one-hour
replication interval. Recovery compares every logical database row before deleting
the source volume, then verifies original and late-upload bytes on the destination.
A third phase thaws, uploads again and cleanly stops the second instance, deletes
its volume, and checks normal entrypoint recovery into an empty third volume.
This path automatically restores SQLite and initializes auxiliary state, without
a manually copied marker or auxiliary database. Only one writer runs at a time.

For a planned frozen migration, copy `maintenance.json` and a consistent
`auxiliary.db` backup alongside the Litestream-restored `data.db`. Frozen startup
cannot initialize a missing auxiliary database. The test copies auxiliary state
from the stopped synthetic source with SQLite's backup API and verifies it; this
is not a claim that Litestream currently replicates `auxiliary.db`.

```sh
python3 docker/object_storage_smoke.py --image notifycontext:ci
```

This gate builds the pinned local MinIO fixture and removes its synthetic
containers, volumes and network. It uses no live bucket or production credentials.

Local validation on 6 October 2026 passed image build, container configuration,
smoke and populated restore, plus the three-stage primary S3 recovery gate and
stale-snapshot/private-copy regression checks. These used the pinned server and
isolated synthetic data; images remain local and production has not been changed.
Node.js 22 frontend build, all 22 browser tests and the actual-server browser
workflow also passed.
