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

## Production deployment — 28 September 2026

Running at https://notify.pocketcontext.com on the existing ARM64 ONCE v0.3.3 host, with one CPU, 512 MiB and automatic updates disabled. The initial deployment used the immutable multi-platform digest above. Use the installed dedicated locked graceful-stop wrapper for subsequent updates.

App-specific configuration remains in ignored mode-0600 `/home/jack/code/pocketcontext/once-pocketcontext/.envrc.private`. Operator credentials reuse the existing sibling credentials as requested. The dedicated replica uses the EU R2 endpoint, bucket `notifycontext-backup` and prefix `once-pocketcontext/notifycontext`. Disposable-object HEAD/write/read/list/delete checks passed. No secret values are stored in this repository.

Google redirect URIs are `http://127.0.0.1:8765/callback` and `https://notify.pocketcontext.com/api/oauth2-redirect`; trusted Workspace domain is `pocketcontext.com`. The configured default `users` Google provider was verified through the authenticated API.

Targeted DNS created only the NotifyContext record; all 17 existing managed DNS resources were preserved. The host resolver had cached an earlier NXDOMAIN, so initial deployment used a temporary exact-host origin entry, removed immediately afterward. Cloudflare proxying remains enabled. Installation of the restricted deployment key preserved all 14 sibling key lines.

Public HTTPS health, UI/security headers, blocked anonymous SQL and signup, ordinary-user authentication, schema and filtered SQL passed. The synthetic verification identity was disabled after checks; no notifications were sent. Live Google browser sign-in and native desktop-alert delivery remain user-device checks.

Production replica recovery passed using a fresh disposable volume: Litestream quick integrity check, restored startup/operator authentication, default identity, required schema and Google configuration. The restored app ran only on loopback with replication disabled and no replica credentials; temporary resources were removed. Desktop and mobile Chromium checks passed for assets, rendering, console errors, keyboard focus and horizontal overflow.

The dedicated SSH key successfully exercised a same-release update through the locked graceful-stop wrapper. Runtime source/server revisions, single-writer container count, CPU/memory limits and disabled automatic updates were verified afterward. All 13 sibling containers retained their IDs, images, running states and resource limits; public health remained successful.
