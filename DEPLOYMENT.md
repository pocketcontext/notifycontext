## Packaged CLI and opt-in tracing — 4 October 2026

Deployed source `f80ddf183acc95d9242db07f35f20ae20cb86238` at `https://notify.pocketcontext.com`.
Image `sha256:44d0faefb016e187ee66724c8b2179662a657b0232483bfe63442d902e171191`; server pin `a92b0de5e1b66b6d3b6135b90092d2d6da5f7cc8` is unchanged.
The standalone `notifycontext` uv launcher pins package `70aca0f200933a8bb001d1f041d65b0a6b2a4e2a`.
Old script entry points are removed; no compatibility wrappers are provided.

[Release CI](https://github.com/pocketcontext/notifycontext/actions/runs/37193930172) passed application, browser, container configuration,
smoke and populated recovery gates before publication. Copied remote launchers
passed isolated workflow and tracing tests. A predeployment backup was verified;
the update used the locked operator wrapper. Exact runtime revision, one writer,
existing resource settings and disabled automatic updates were verified.
Public health and anonymous SQL-schema rejection passed; the installed CLI's
live schema check passed. Eight source apps passed a live `SELECT 1` capture
with paired client/server traces and SQL text excluded. No business records
were created; diagnostic traces were uploaded to ObserveContext.

VaultContext was excluded from this migration. A separate VaultContext release
was observed during the window and was left untouched. Five other unrelated
containers retained their IDs, images and settings. The private scaffold records
the coordinated release matrix and verification evidence.

# NotifyContext release and deployment

## Realtime unread favicon — 3 October 2026

Deployed source `76795736c30aa8cfc7d2be6afa50cd25e830810c` at
https://notify.pocketcontext.com. The PocketContext server pin remains
`a92b0de5e1b66b6d3b6135b90092d2d6da5f7cc8`.

- Multi-platform image: `ghcr.io/pocketcontext/notifycontext@sha256:c39ca860beb56d745510ccb86f9bbc9da216de6714f94966de6a5bb7b17178b5`.
- ARM64 manifest: `sha256:c5eb70e4ce0aabf9dfaa93f45a5451aa2f612a7d5b37ba6ce43e5300717a2255`.
- AMD64 manifest: `sha256:fcc76d4f9c47b9ac0da0e8d748f9da0ee05a9abd998edb52daa06f95cf583bdd`.
- [Application CI](https://github.com/pocketcontext/notifycontext/actions/runs/37132612514) and [release CI](https://github.com/pocketcontext/notifycontext/actions/runs/37132612678) passed, including container configuration, smoke and populated replica restoration.

The N favicon now overlays unread counts 1–99 and 99+, while the title/sidebar
retain the exact count. Counts exclude archived and withdrawn notifications.
Authenticated per-user signals after committed notification events trigger SQL
refreshes, with a 60-second fallback and reconnect/visibility recovery. Ordinary
record subscriptions remain locked; signals contain no notification data.

All twelve Python suites, 22 browser tests, the Node.js 22 build and the actual
server browser workflow passed locally. The latter verifies another open tab
updates through SSE within five seconds. Actual pinned Chromium icons were
inspected at standard/2x display scales and with a dark browser theme.

The pre-update backup `before-realtime-favicon-20261003151413.zip` passed ZIP
integrity and database-entry checks. The installed locked graceful-stop wrapper
matched the versioned source and was invoked through the existing operator SSH
access; the dedicated local deployment key was unavailable on this host. One
writer, one CPU, 512 MiB, persistent storage and disabled automatic updates were
verified afterward. All fourteen other managed containers retained their IDs,
images, states and settings. No new infrastructure or business records were created.

Production HTTPS health, exact public JavaScript/CSS bytes, restrictive security
headers, rejected anonymous SQL/schema/private-SSE subscriptions, desktop/mobile
rendering, keyboard focus and absence of overflow/script errors passed. Full
interactive Google sign-in and native OS alert delivery remain user-device checks.
Existing tabs need one reload to load this browser release. Suspended or closed
tabs cannot promise immediate updates.

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
