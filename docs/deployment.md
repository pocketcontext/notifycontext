# Deployment

NotifyContext runs at `https://notify.pocketcontext.com` on the existing `once-v2`
host. The maintained private scaffold is the sibling `once-pocketcontext-v2`
repository. Preserve its application identity, volume, private primary-file bucket,
independent Litestream replica, runtime settings and resource limits. The retired
source-host volume must never restart beside the destination writer.

## Continuous deployment

`image.yml` publishes only when `NOTIFYCONTEXT_PUBLISH_ENABLED=true`, on main and
after application tests and container configuration, smoke and recovery checks.
After successful manifest publication, its deployment job runs when
`COLORS_PROFILE` is nonempty and `CONTEXT_DEPLOY_PAUSED` is not `true`. The intended
profile is `once-v2`; configure that GitHub environment for main-only deployment.
It supplies `SSH_PRIVATE_KEY` as a secret and `SERVER_IP`, `SERVER_USER` and
pinned `SSH_KNOWN_HOSTS` as variables. A missing host-key pin stops deployment.

SSH sends no remote command. The dedicated restricted key invokes the maintained
ONCE stop-first dispatcher for NotifyContext. The destination policy tracks
`ghcr.io/pocketcontext/notifycontext:latest`, uses a 300-second graceful stop and
keeps ONCE automatic image updates disabled. Publication and deployment are
serialized without cancelling an active deployment. CI checks NotifyContext's
public `/up` after SSH succeeds; health proves database availability, not the
source revision. Verify the deployed image/revision separately for release evidence.

Set repository variable `CONTEXT_DEPLOY_PAUSED=true` to publish without deploying.
The pause does not stop a deployment already running or fence another host. Keep
it set while preparing credentials or changing deployment policy; enable deployment
only after the destination policy and restricted key are verified.

The app-local `deploy/deploy-notifycontext.py` and `deploy/install.py` commands are
retired and fail closed. Do not install them: they implement the obsolete source
host's update/rollback behavior. `deploy/once-application.yml` is a historical
source-scaffold fragment, not the destination configuration. Maintain deployment
policy through `once-pocketcontext-v2`, preserving sibling application policies and
keys. Do not run full scaffold convergence just to deploy an application release.

A failed destination update retains its pending marker under
`/var/lib/once-deploy/notify.pocketcontext.com.pending`; there is no automatic
rollback. Inspect the application, schema and replication before deliberately
clearing that marker. Never remove it simply to retry a failed deployment.

## Identity and storage

Use a dedicated Google Web OAuth client with verified Workspace JIT. Register
`http://127.0.0.1:8765/callback` and
`https://notify.pocketcontext.com/api/oauth2-redirect`. Configure both
`NOTIFYCONTEXT_GOOGLE_CLIENT_ID` and `NOTIFYCONTEXT_GOOGLE_CLIENT_SECRET`, and set
`NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN` explicitly. Humans and agents use default
`users`. Preserve existing SMTP settings; colleague notification delivery itself
needs no SMTP.

Keep credentials in the maintained scaffold's private bindings, outside Git and
logs. ONCE supplies `BASE_URL`; retain `NOTIFYCONTEXT_TRUSTED_PROXY_HEADER` and
`NOTIFYCONTEXT_RATE_LIMITS` from the reviewed destination configuration. Optional
operator bootstrap email/password must be paired.

The image exposes port 80 and database-backed `/up`. SQLite lives under `/storage`;
primary files, including avatars, live in private S3. The container requires both
primary S3 and Litestream; `LITESTREAM_DISABLED` is unsupported. See README for the
complete storage settings and strict startup contract. External reference
destinations are not backed up by NotifyContext.

For a new installation, run one-shot `init` on the intended empty volume and empty
replica before normal startup. Existing production updates must use the existing
volume, not `init`. Empty-volume recovery requires a replica, stages SQLite and
checks every referenced remote file before installation. Preserve `maintenance.json`
and a consistent `auxiliary.db` separately for frozen recovery.

For disaster recovery, stop/fence the existing writer, preserve the failed volume,
restore into a separate empty volume, and validate authenticated access and complete
notification/recipient/reference/event state before enabling one writer. Litestream
is asynchronous; zero data loss is not promised. Old snapshots are not a lossless
rollback after production has accepted later writes.

Run `python3 tests/deploy_workflow.py` for the deployment guards, commandless SSH,
host-key failure, remote failure propagation, health target and retired-command
checks. The destination dispatcher's stop-first/pending-marker behavior is maintained
and validated in the ONCE scaffold/package, not duplicated in this app repository.
