# NotifyContext release and deployment

## Pending email delivery release — 28 September 2026

Deployed at https://notify.pocketcontext.com from source `2be8d49338bcbdf12325c39212b5fb60b3125799`. The PocketContext pin remains `a92b0de5e1b66b6d3b6135b90092d2d6da5f7cc8`.

- Public image: `ghcr.io/pocketcontext/notifycontext:latest` and `sha-2be8d49`.
- Multi-platform digest: `sha256:9c7a7a19302f6565bb5bd1d7367fd58ceb7b674a8865e20c2f957519f5c16283`.
- AMD64 manifest: `sha256:cd3158ed4fbe56e4ebad76ccde67f11f04e1b383de4e58d67d0e3ba252fc63bd`.
- ARM64 manifest: `sha256:f33cf83d8ae5e31afd1bd712052b8bc9b798d921c3e9b8967f0a42487ad2f566`.

[Release CI](https://github.com/pocketcontext/notifycontext/actions/runs/36391659180) and [application CI](https://github.com/pocketcontext/notifycontext/actions/runs/36391658930) passed. This includes the additive migration, trusted Google pending claims, rollback, races, expiry/withdrawal, privacy, legacy publication-key compatibility, copied skill, eleven browser tests and container recovery with pending recipients. Anonymous manifest/configuration access verified both image architectures and the source labels.

The browser and skill now accept Workspace email destinations before first sign-in. Existing eligible accounts link immediately; other addresses remain pending for 30 days and can be claimed only by the matching verified Google identity. No invitation email is sent. Sent backlog filters distinguish awaiting signup and expired recipients. See the data model and skill workflows for exact semantics.

A production API backup was created and verified before migration. The restricted-key locked update passed, and runtime revision/digest, unchanged server pin, one writer, one CPU, 512 MiB and disabled automatic updates were verified. All thirteen sibling containers and existing authorized keys were preserved. Public HTTPS, new browser assets, authentication and the new private recipient columns passed post-deployment checks; the synthetic verification account was disabled and no notifications were sent.

Post-update recovery from the production EU R2 replica passed. The three new fields were present in the disposable restored database before application startup, proving the replica contained the migration. Integrity, restored authentication, Google configuration and API schema passed with replication disabled and loopback-only access. Temporary containers and volume were removed.

Live Google browser sign-in and native desktop-alert delivery remain user-device checks. Earlier release evidence follows; its image digest is historical.

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
