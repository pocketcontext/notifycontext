# Client workflows

Set `NC=/absolute/path/to/installed/notifycontext/scripts/nc.py` for these examples. Python 3 standard library only.

```sh
python3 "$NC" login --google
python3 "$NC" whoami
python3 "$NC" check
python3 "$NC" query 'SELECT id,name FROM user_directory ORDER BY name'
python3 "$NC" backlog --unread
python3 "$NC" backlog --awaiting-ack --overdue
python3 "$NC" backlog --search 'supplier renewal' --include-archived --include-withdrawn
python3 "$NC" backlog --sent --awaiting-ack
python3 "$NC" backlog --since '2026-01-01T00:00:00Z' --before '2027-01-01T00:00:00Z'
```

`--since` is inclusive and `--before` exclusive, both filtering publication time. Accept valid `YYYY-MM-DD` (UTC midnight) or ISO timestamps with an explicit timezone; invalid dates and reversed ranges fail before a request. `--overdue` finds unacknowledged requests whose nonempty response deadline has passed, excluding archived/withdrawn items unless explicitly included.

`backlog` returns every matching recipient row, with notification content and recipient revision. References and events are available with filtered `query` commands. Every read leaves state unchanged. For a summary spanning all history, explicitly include archived and withdrawn records. Queries return SQL columns/rows and may be truncated; never claim completeness from a truncated query. The backlog command handles pagination and server truncation automatically. The default is the active inbox, not all stored history. Sent results retain archived recipient rows because archiving is personal inbox organization.

Generate a key once with `newkey`, then retain the full payload for uncertain-outcome retries. The following is a synthetic shape; substitute actual directory IDs and the generated key. Use stdin or a private file to avoid shell interpretation of Markdown/backticks:

```sh
python3 "$NC" publish - <<'JSON'
{"subject":"Supplier renewal ready for review","body_markdown":"## Next step\nPlease review the renewal terms.","kind":"review_requested","ack_required":true,"submission_key":"retain-one-stable-key-per-send","recipients":["recipient000001"],"references":[{"kind":"document","label":"Renewal terms","url":"https://example.com/renewal","source_system":"documents"}]}
JSON
```

Bulk actions target **recipient record IDs**, not notification IDs or user IDs. Use the revision returned by the backlog/read. Each request is independently applied; this is not an all-or-nothing batch. Output includes per-item results and any unattempted items. Partial failure exits nonzero.

```sh
python3 "$NC" bulk - <<'JSON'
[{"id":"recipientrow001","expected_revision":1,"action":"acknowledge","acknowledgement_markdown":"Received; I will review tomorrow."},{"id":"recipientrow002","expected_revision":2,"action":"archive"}]
JSON
```

Set status/preferences by first querying the owner's existing row. Use `whoami` for the user ID. If absent, create; otherwise update with the current revision. The server assigns the owner.

```sh
python3 "$NC" create user_status '{"availability":"busy","message":"Reviewing contracts","expires_at":"2026-10-01T15:00:00Z"}'
python3 "$NC" update user_status STATUS_RECORD_ID '{"expected_revision":1,"availability":"available","message":"","expires_at":""}'
python3 "$NC" create notification_preferences '{"alerts_paused_until":"2026-10-01T15:00:00Z"}'
python3 "$NC" update notifications NOTIFICATION_ID '{"expected_revision":1,"action":"withdraw","withdrawal_reason":"Superseded by corrected terms."}'
```

Exit codes: 0 success; 1 HTTP/transport failure or partial bulk failure; 2 configuration/usage; 3 schema mismatch; 4 single-write conflict. A transport failure can have an unknown mutation outcome. Acknowledgement requires an explicit user instruction; it does not execute the requested underlying task. Work in external systems needs the corresponding user authorization and capability.
