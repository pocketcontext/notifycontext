# NotifyContext application contract
Default PocketBase users; ordinary admitted Workspace colleagues share directory/status only. No role bypass for notification privacy. SQL is filtered, business REST reads/realtime locked; writes use REST. User directory id/name (no emails). References optional; any work domain.
Collections:
- notifications: sender relation users, subject text max 200, body_markdown text max 20000, kind fyi|review_requested|action_required, ack_required bool, due_at optional date, submission_key text max 200 unique with sender, withdrawn_at optional date, withdrawal_reason text max 2000, revision integer, created/updated. Indexes: unique sender/submission_key, created/id and sender/created/id.
- notification_recipients: notification relation, optional recipient relation users, immutable addressed_email text max 254, claimed_at and claim_expires_at optional dates, read_at/acknowledged_at/archived_at optional dates, acknowledgement_markdown max 4000, revision, created/updated. Partial unique notification/recipient where recipient is nonempty; partial unique notification/addressed_email where addressed_email is nonempty. Ordinary lookup indexes: recipient/created/id and notification/recipient. Sender sees all recipients, recipient only self. An empty recipient is an unclaimed email target and grants no access.
- notification_references: notification, kind document|task|record|url, label max 200, url max 2000 http(s) only, source_system max 100 optional, external_id max 200 optional, created/updated. Ordinary lookup index notification/created/id.
- notification_events: notification, notification_recipient optional, actor users, event_type, created. Immutable server managed. Sender sees all, recipient sees publication/withdrawal and own actions only.
- user_status: user unique relation, availability available|busy|in_a_meeting|away|not_set, message max 200, expires_at optional date, revision, created/updated. Owner writes, all colleagues read. Expired displays not_set.
- notification_preferences: user unique relation, alerts_paused_until optional date, revision, created/updated. Owner only.
Publish POST /api/collections/notifications/records with subject,body_markdown,kind,ack_required,due_at,submission_key, recipients:[user IDs], recipient_emails:[email addresses], references:[{kind,label,url,source_system,external_id}]. Server attribution, timestamps and recipient/reference/event writes atomic. Identical retry returns existing; changed payload for same sender/key conflicts. Combined input arrays contain 1–100 entries before deduplication; either array may be omitted. References max 30. Sender-supplied sender/id/timestamps rejected or overwritten safely.
Withdraw PATCH notifications/ID {expected_revision, action:"withdraw", withdrawal_reason}. No editing content/deleting.
Recipient PATCH notification_recipients/ID {expected_revision,action:"read"|"acknowledge"|"archive"|"unarchive",acknowledgement_markdown optional}. Server timestamps, owner only, idempotent action retries when already satisfied. Acknowledgement does not mean task complete. No other recipient mutations.
Status/preferences POST owner record then PATCH with expected_revision; server owns user. Status expiry displayed at read time, not auto-rewritten.
No background Web Push in v1. Private realtime inbox-change signals prompt authenticated SQL reads after committed notification events, with 60-second fallback polling and reconnect/visibility refresh. Browser reads do not mark read. Native alerts require open app and permission. Pauses affect alerts only. No calendar integration, presence, reminders, attachments or threads.

## Email recipients and claims

Email addressing is enabled only with `NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN`. Addresses are trimmed, lowercased and strictly validated against that exact domain. Plus tags and dots are never folded, aliases are never expanded, and no invitation email is sent. The public colleague directory still exposes only IDs and names.

Publication immediately links an email to an existing enabled, verified account, including an operator-provisioned account. Existing disabled, unverified or ambiguous email matches reject the whole publication. Email and ID inputs that resolve to the same account create one recipient row. ID-only rows keep addressed_email and claimed_at empty; email-linked rows retain the normalized address and set claimed_at. For an unknown address, the server creates a pending row with no recipient and claim_expires_at exactly 30 days after publication. Clients cannot set these fields.

A successful Google OAuth exchange with trusted verified email and Workspace claims may claim pending rows for its exact address. Claiming works for newly admitted and existing accounts, runs in the same transaction as OAuth provisioning, and happens before the auth response. It sets recipient and claimed_at, clears claim_expires_at, increments revision, and records a private `claimed` event. It leaves read/acknowledgement/archive state untouched. Password sign-in, token refresh and manual provisioning do not claim pending history. A later email-targeted publication may immediately link an operator-provisioned account, but earlier pending history still requires Google verification.

Expired or withdrawn pending rows never claim. Claimed rows never follow email changes or reassign to another account. If an operator changes an existing recipient's email to a pending address on the same notification, the existing linked row is retained and the conflicting pending row remains unclaimed until expiry; it is not merged or rewritten.

Pending/expired state is derived from an empty recipient and claim_expires_at, with withdrawal taking precedence in presentation. Pending addresses and expiry are visible only to the sender; after claim the linked recipient can see their own row. No other colleague can inspect or claim an address using ordinary REST updates.

Canonical submission payloads retain sorted normalized email inputs independently of their later account resolution, so an identical retry after signup or claim returns the original notification. Empty email arrays preserve the previous ID-only canonical format. Changing from an ID to an email or otherwise changing addressing inputs under an existing key is a conflict, even if the new input would resolve to the same person.

## Sender feedback inbox

`notification_feedback` is server-created, sender-private state, unique per notification:
notification, user (original sender), latest_recipient, latest_at, activity_version,
read_version, read_at, archived_at, revision and created/updated. Filtered SQL admits
only `user = :requester`; business REST reads and client create/delete are locked.
A non-whitespace acknowledgement comment from another user increments activity_version,
sets the latest recipient/time and clears read_at/archived_at atomically with the
acknowledgement. Empty acknowledgements and self-comments create no feedback. An emoji
counts as a comment. Original content and recipient state are unchanged.

Owner-only PATCH supports `{expected_revision, action: "read"|"archive"|"unarchive"}`.
Every action checks revision before idempotency, so a stale read or archive cannot
consume a newer comment. Read records the current activity_version; archive does not
implicitly read. On a conflict, refresh before deciding whether to retry. The UI uses
one row per notification, ordered by latest comment time, with the latest commenter and
preview. Sent retains the original record. Awaiting acknowledgement/deadline filters
apply to recipient work, not sender feedback. Withdrawn feedback is excluded from the
active inbox and unread count; history remains accessible by direct link/Sent.

Migration 1790300600 backfills all nonempty historical acknowledgement comments from
others, including archived recipient rows. Sender read state cannot be inferred, so
these start unread/unarchived. Multiple recipients collapse into one entry. It emits
no events; historical activity timestamps and initial alert baseline prevent a desktop
alert burst. Private sender state changes signal only the sender's tabs. New comment
alerts use notification/activity-version identity, so later comments can alert again.
No editable comments, repeat acknowledgements or full conversations are added.

## Combined actions

Recipient PATCH additionally supports `acknowledge_archive` (acknowledge with the optional
note, mark read and archive) and `read_archive` (mark read and archive without acknowledging).
Feedback PATCH supports `read_archive`, recording the current activity version and archiving.
Each combined operation is one authenticated transaction, one row revision increment and
all-or-nothing with feedback creation and audit events. Existing timestamps are preserved;
only newly performed recipient actions emit their normal audit event. An existing
acknowledgement note cannot be replaced. Combined actions always check expected_revision,
including retries; after a transport failure or conflict, read state before retrying.

The UI presents a split button: its explicit primary label performs the combined action,
and the arrow reveals individual actions. When a combination is unavailable, the first
applicable individual action is primary and alternatives remain in the dropdown. A single
remaining action has no arrow. Withdraw and move-to-inbox are never combined. The optional
acknowledgement note applies to both acknowledgement variants. Menus support keyboard
navigation, Escape and outside-click dismissal; tab order remains ordinary buttons.
