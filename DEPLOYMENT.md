# NotifyContext release and deployment

## Published release — 28 September 2026

- Public repository: https://github.com/pocketcontext/notifycontext
- Public image: `ghcr.io/pocketcontext/notifycontext:latest` (also `sha-36a145a`)
- Image source: `36a145af60d7168150200969ba5a9263d0327b41`
- PocketContext pin: `a92b0de5e1b66b6d3b6135b90092d2d6da5f7cc8`
- Multi-platform digest: `sha256:f1ca9fbc404e745fb00a7f62e5f929d074927e6ffc2488ae7bfd41b9ea3d5d82`
- AMD64 manifest: `sha256:b98b91fcf05ca6352726d8c2c5047ceb445f373c41f5936c3e3cbe4259ad8db2`
- ARM64 manifest: `sha256:ee24a18fd5c7f8cc97513527fe72fed18cb604fa603cc2024fc36705d3dd0cc2`

[Release CI](https://github.com/pocketcontext/notifycontext/actions/runs/36387200250) and [application CI](https://github.com/pocketcontext/notifycontext/actions/runs/36387199993) passed. Gates include backend/privacy/auth/OAuth/skill/client, browser regression and actual-server workflow, container configuration, startup/persistence and populated Litestream disaster/shutdown-sync restore. Anonymous manifest, configuration and layer access passed for both architectures; image configuration labels match the source revision above. Later documentation-only commits do not change this image.

CI exposed a read/acknowledgement race, fixed before publication: recipient controls are disabled during a write and existing acknowledgement drafts survive non-acknowledgement refreshes. A deterministic browser regression covers the interaction.

## Deployment prepared, not running

Deployment through the existing ONCE host is authorized. The scaffold declares `notify.pocketcontext.com`, one CPU and 512 MiB. Build/dry-run passed; read-only host inspection confirmed ARM64, ONCE v0.3.3, available capacity and no existing NotifyContext container. No sibling application or remote key was changed.

App-specific placeholders/defaults are in `/home/jack/code/pocketcontext/once-pocketcontext/.envrc.private`, ignored by Git and mode 0600. A dedicated local deployment key was generated and its reference recorded. The following `COLORS_PAR_APP_NOTIFYCONTEXT_` fields remain empty:

- `SUPERUSER_EMAIL`, `SUPERUSER_PASSWORD`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `LITESTREAM_ENDPOINT`, `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`

Complete the dedicated Google Web OAuth client and private R2 setup before production launch. Bucket/prefix defaults are `notifycontext-backup` and `once-pocketcontext/notifycontext`; trusted Workspace domain is `pocketcontext.com`. Google redirect URIs are `http://127.0.0.1:8765/callback` and `https://notify.pocketcontext.com/api/oauth2-redirect`. See [deployment preparation](docs/deployment.md).

Remaining work after credentials: verify the dedicated bucket with a disposable object probe, review/apply targeted DNS, deploy the pinned image with one writer and automatic updates disabled, install the dedicated locked wrapper, verify runtime revision/health/authentication and replica recovery. Real Google browser sign-in and native desktop-alert delivery remain user-device checks. No production instance or DNS record has been created for NotifyContext.
