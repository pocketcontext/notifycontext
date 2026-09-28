# Data and authorization

Use `nc.py schema` for authoritative SQL columns; `schema.json` is the tested snapshot. The default PocketBase `users` auth collection is not exposed to SQL. `user_directory` provides admitted colleague IDs/names without email addresses.

- `notifications`: immutable sender-attributed subject, `body_markdown`, kind (`fyi`, `review_requested`, `action_required`), `ack_required`, optional `due_at`, `submission_key`, server timestamps and revision. Withdrawal is the only sender update.
- `notification_recipients`: notification and recipient relations; explicit `read_at`, `acknowledged_at`, `acknowledgement_markdown`, `archived_at`, revision. Sender sees recipient states; recipient sees only their own row.
- `notification_references`: notification, kind (`document`, `task`, `record`, `url`), label, HTTP(S) URL, optional source_system/external_id. Immutable.
- `notification_events`: immutable publication, withdrawal and recipient action history. Recipient sees global publication/withdrawal events and their own actions.
- `user_status`: unique owner, availability (`available`, `busy`, `in_a_meeting`, `away`, `not_set`), message, optional expires_at, revision. Colleagues can read; only owner changes.
- `notification_preferences`: unique owner, optional alerts_paused_until, revision. Owner only.

Dates use UTC. Empty dates are empty strings. All SQL results are requester-filtered; administrator status does not bypass notification privacy. REST business reads are locked; use SQL to retrieve records. Other applications' references do not grant access to those applications.

POST `/api/collections/notifications/records` accepts notification fields plus `recipients: [user IDs]` (1–100) and `references: [{kind,label,url,source_system,external_id}]` (0–30). This atomically creates content, recipients, references and publication history. Sender/key is unique; identical retries return existing content and changed payloads conflict.

PATCH `notifications/ID` accepts `{expected_revision,action:"withdraw",withdrawal_reason}`. PATCH `notification_recipients/ID` accepts `{expected_revision,action:"read"|"acknowledge"|"archive"|"unarchive",acknowledgement_markdown?}`. Repeated already-satisfied actions are idempotent. POST status/preferences creates the owner's record; PATCH requires expected_revision. No content editing or deletion.
