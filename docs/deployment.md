# Deployment preparation

Public repository/container publication and deployment through the existing ONCE scaffold were authorized on 28 September 2026. Application names are `notify.pocketcontext.com`, `pocketcontext/notifycontext`, `ghcr.io/pocketcontext/notifycontext`, private bucket `notifycontext-backup`, and replica prefix `once-pocketcontext/notifycontext`. Verify availability and choose repository/package visibility before publication.

Use a dedicated Google Web OAuth client with verified Workspace JIT. Register `http://127.0.0.1:8765/callback` and `https://notify.pocketcontext.com/api/oauth2-redirect`. The browser and portable client use the default `users` collection. Set `NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN` explicitly; without it first-login provisioning is blocked. Configure both `NOTIFYCONTEXT_GOOGLE_CLIENT_ID` and `NOTIFYCONTEXT_GOOGLE_CLIENT_SECRET`. No SMTP is needed for colleague notification delivery.

Required operator settings are paired `NOTIFYCONTEXT_SUPERUSER_EMAIL`/`NOTIFYCONTEXT_SUPERUSER_PASSWORD`, `NOTIFYCONTEXT_TRUSTED_PROXY_HEADER=X-Forwarded-For`, and `NOTIFYCONTEXT_RATE_LIMITS=true`. ONCE provides the correct `BASE_URL`. Add future app-specific Google, operator and R2 credentials privately to `/home/jack/code/pocketcontext/once-pocketcontext/.envrc.private`, preserving all existing entries. No credentials were generated during local implementation.

The prepared scaffold fragment is `deploy/once-application.yml`. The application entry is now prepared in the sibling scaffold; complete dedicated credential placeholders before applying it. Replica credentials must be dedicated to this bucket. Never use a sibling replica. `LITESTREAM_DISABLED=true` is for disposable tests only.

The image exposes port 80 and database-backed `/up`; persistence lives under `/storage`. Build frontend assets into the image. Database backups contain users, notification bodies, acknowledgement notes, status, preferences and audit history. There are no uploaded attachments. External reference destinations are not backed up by NotifyContext.

One writer only: disable ONCE automatic updates. Install the dedicated `deploy/deploy-notifycontext.py` wrapper with its app-specific SSH key using `deploy/install.py` after provisioning. It locks updates, stops the old writer cleanly, and refuses ambiguous recovery. Never use overlapping rolling updates or restore a second writer against the live replica.

Publication is opt-in through repository variable `NOTIFYCONTEXT_PUBLISH_ENABLED=true`; application tests and container config/smoke/populated-restore gates must pass first. No automatic production deployment workflow is supplied. Record an immutable image digest and real browser Google/desktop-alert verification before release.

Recovery: stop the production writer, preserve the failed volume, restore a verified dedicated replica into a separate empty volume, validate authenticated access and notification/recipient/reference/event counts, then start exactly one writer. Roll back an image only if its schema remains compatible; otherwise use a deliberate backup restore. Litestream is asynchronous, so zero data loss is not promised. Measure actual backup lag and restore time during the release drill.
