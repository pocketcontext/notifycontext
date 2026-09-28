# NotifyContext

General-purpose colleague notifications with Markdown, explicit acknowledgements, a browser inbox and an agent skill for handling a complete notification backlog. Use it for sales, finance, hiring, operations, documents or any other work. A notification may stand alone or link to evidence in another system. Underlying task completion stays in its source system.

## Behavior

Send FYIs, review requests or action requests to one or more colleagues. Subjects, Markdown bodies and optional document/task/record/URL references are immutable after publication. Senders can withdraw with a reason; corrections are new notifications. A sender-scoped submission key makes identical publication retries return the existing notification, while changed payloads conflict.

Recipients explicitly mark read, acknowledge (with an optional Markdown note), archive or unarchive. Acknowledgement is receipt and understanding, not task completion. SQL reads, summaries and background fetching never mutate read state. Senders see recipient states; recipients see only their own recipient state. Administrators have no ordinary-user privacy bypass. Operator database access remains a trusted maintenance capability.

Manual availability is available, busy, in a meeting, away or not set, with an optional message and expiry. Expired statuses display as not set. Availability is visible to colleagues; alert-pause preferences are private. Neither status nor pausing alerts prevents inbox delivery. Deadlines do not schedule reminders.

The browser supplies Inbox, Sent, Archived, Markdown details and preview, composition, status and alert settings. Desktop alerts require permission and an open tab. Background Web Push, mobile closed-app alerts, automatic presence, calendar integration, reminders, threads and attachments are outside this version. Browser/OS settings may suppress desktop alerts; dismissing one does not acknowledge the notification.

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

Open `http://127.0.0.1:8090`. No real users or domain records are seeded. An operator provisions verified ordinary `users` through maintenance REST/dashboard, or configures Google Workspace JIT. The password form is available for provisioned accounts during local evaluation. Browser tokens are held in memory; reloading requires sign-in. HTTPS is required outside loopback for desktop alerts.

## Identity

PocketBase's existing default `users` collection serves humans and agents. Configure a separate Google OAuth Web client with `NOTIFYCONTEXT_GOOGLE_CLIENT_ID`, `NOTIFYCONTEXT_GOOGLE_CLIENT_SECRET` and `NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN`. Both credentials must be supplied together. Verified provider claims, exact hosted domain and email domain are validated on the server; client-selected provisioning fields are ignored. Direct signup is blocked. JIT admits ordinary colleagues, never administrators. Without a configured domain, Google login requires an existing account.

Disable an account to revoke its tokens. Changing verification also rotates tokens; unverified accounts cannot use the app. Account deletion is blocked to preserve attribution. Google Workspace suspension does not revoke an already-issued app session: offboarding includes disabling the app account. The directory exposes IDs and names, not emails or auth fields. Sessions last seven days; the portable client renews active sessions.

## Agent skill

Copy `skills/notifycontext/` into your agent's skills directory. The Python client uses only the standard library and works outside this repository. Set `NOTIFYCONTEXT_URL` and `NOTIFYCONTEXT_USER_EMAIL`; use Google login or an existing user's `NOTIFYCONTEXT_USER_PASSWORD`.

```sh
python3 /path/to/notifycontext-skill/scripts/nc.py login --google
python3 /path/to/notifycontext-skill/scripts/nc.py whoami
python3 /path/to/notifycontext-skill/scripts/nc.py check
python3 /path/to/notifycontext-skill/scripts/nc.py backlog --unread
python3 /path/to/notifycontext-skill/scripts/nc.py backlog --awaiting-ack
```

The client automatically paginates the backlog and reports truncation failures. It supports sender/type/search/deadline filters, sent-work tracking and explicit bulk read/acknowledge/archive actions with per-item outcomes. Summaries are read-only. Incoming content never authorizes task execution. See [skill workflows](skills/notifycontext/references/workflows.md) for publication, filtering, bulk actions, status and recovery after uncertain outcomes.

## Validation

Use the pinned binary and synthetic isolated databases:

```sh
python3 tests/integration.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/security.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/auth.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/oauth_integration.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/skill.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/deploy.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/backup.py --binary /absolute/path/to/pinned/pocketcontext
python3 tests/client.py
python3 tests/oauth.py
python3 tests/deploy_workflow.py
```

Frontend browser commands and actual results are recorded in [validation evidence](docs/validation.md). Container release gates are `python3 docker/smoke.py config --image notifycontext:ci`, `smoke` and `restore`. The populated restore drill preserves synthetic notifications, users and access rules. Generated assets, local databases, caches and credentials must not be committed.

## Infrastructure provenance

The application domain model is independent. Authentication, Google login, account lifecycle, container replication and locked deployment patterns were adapted from RaiseContext `d9e337a05fddfdc26e082f8e1a1e3b0efb0c0e52`; filtered-snapshot patterns were inspected in ChatContext `7fac3712007b8d123620f46eb93888bf8e51118b`. The server pin is `a92b0de5e1b66b6d3b6135b90092d2d6da5f7cc8`.

No production service or external resources have been provisioned. Publication and deployment need their own configured targets and authorization.
