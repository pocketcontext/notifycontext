# NotifyContext release and deployment

Public source: https://github.com/pocketcontext/notifycontext.
Public container target: `ghcr.io/pocketcontext/notifycontext`.
Production origin: `https://notify.pocketcontext.com`.

Publication and deployment through the existing `once-pocketcontext` scaffold were authorized on 28 September 2026. Initial release source is `97099b9`; PocketContext pin is `a92b0de5e1b66b6d3b6135b90092d2d6da5f7cc8`.

The first release checks ran in GitHub Actions:
- [Container release](https://github.com/pocketcontext/notifycontext/actions/runs/36386755852)
- [Application integration](https://github.com/pocketcontext/notifycontext/actions/runs/36386755221)

CI found a read/acknowledgement browser interaction race. The fix disables overlapping recipient actions, preserves acknowledgement drafts and has a deterministic regression test. All eight local browser tests and the actual-server workflow passed after the fix; the corrected release is being checked.

No image digest or production deployment is verified yet. Do not treat the public repository as evidence of public registry access.

The ONCE entry is prepared for one CPU / 512 MiB. Scaffold build and dry-run passed. Read-only host inspection confirmed ARM64, ONCE v0.3.3 and no existing NotifyContext container. No sibling app or key was changed.

App-specific placeholders/defaults are in the scaffold's ignored mode-0600 `.envrc.private`. Dedicated Google OAuth client credentials, operator credentials, R2 endpoint/access keys and a deployment key reference must be completed before production launch. Use private bucket `notifycontext-backup`, prefix `once-pocketcontext/notifycontext`, verified Workspace domain `pocketcontext.com` and exact redirects documented in [deployment preparation](docs/deployment.md).

Outstanding checks: container release gates, anonymous manifest/configuration/layer access, dedicated R2 probe, targeted DNS plan/apply, one-writer deployment with disabled auto-updates, runtime revision/health, Google sign-in, native desktop alerts and populated replica recovery.
