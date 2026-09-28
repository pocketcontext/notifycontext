#!/usr/bin/env python3
"""Behavioral tests: complete backlog, safe writes, partial results and SQL quoting."""
import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('nc', Path(__file__).resolve().parents[1] / 'skills/notifycontext/scripts/nc.py')
nc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nc)


class ClientTest(unittest.TestCase):
    def test_backlog_pages_until_empty_without_mutation(self):
        calls = []
        def query(cfg, sql):
            calls.append(sql)
            if "r.id > ''" in sql:
                return [{'recipient_record_id': 'a'}, {'recipient_record_id': 'b'}], False
            if "r.id > 'b'" in sql:
                return [{'recipient_record_id': 'c'}], False
            self.fail(sql)
        with patch.object(nc, 'identity', return_value={'id': 'self'}), patch.object(nc, 'query_rows', side_effect=query), patch.object(nc, 'call') as mutation:
            result = nc.backlog({}, nc.parse(['backlog', '--page-size', '2', '--unread', '--search', "O'Brien"]))
            self.assertEqual(result['count'], 3)
            self.assertTrue(result['complete'])
            self.assertIn("'O''Brien'", calls[0])
            self.assertIn("r.read_at = ''", calls[0])
            mutation.assert_not_called()

    def test_truncation_retries_same_cursor_with_smaller_page(self):
        calls = []
        def query(cfg, sql):
            calls.append(sql)
            if sql.endswith('LIMIT 4'):
                return [{'recipient_record_id': 'discard'}], True
            return [{'recipient_record_id': 'a'}], False
        with patch.object(nc, 'identity', return_value={'id': 'self'}), patch.object(nc, 'query_rows', side_effect=query):
            result = nc.backlog({}, nc.parse(['backlog', '--page-size', '4']))
        self.assertEqual(result['items'], [{'recipient_record_id': 'a'}])
        self.assertTrue(calls[-1].endswith('LIMIT 2'))
        self.assertIn("r.id > ''", calls[-1])

    def test_oversized_single_row_fails_instead_of_claiming_complete(self):
        with patch.object(nc, 'identity', return_value={'id': 'self'}), patch.object(nc, 'query_rows', return_value=([], True)):
            with self.assertRaises(nc.Fail): nc.backlog({}, nc.parse(['backlog', '--page-size', '1']))

    def test_sent_history_filters_are_explicit(self):
        with patch.object(nc, 'identity', return_value={'id': 'self'}), patch.object(nc, 'query_rows', return_value=([], False)) as query:
            nc.backlog({}, nc.parse(['backlog', '--sent', '--include-withdrawn', '--awaiting-ack']))
        sql = query.call_args.args[1]
        self.assertIn("n.sender = 'self'", sql)
        self.assertNotIn("r.archived_at = ''", sql)
        self.assertNotIn("n.withdrawn_at = ''", sql)
        self.assertIn('n.ack_required = 1', sql)

    def test_bulk_validates_entire_list_before_first_write(self):
        with patch.object(nc, 'call') as call:
            with self.assertRaises(nc.Fail):
                nc.bulk({}, [{'id': 'recipientrow001', 'expected_revision': 1, 'action': 'read'},
                             {'id': 'recipientrow002', 'action': 'archive'}])
            call.assert_not_called()

    def test_bulk_reports_conflicts_and_continues_explicit_actions(self):
        items = [{'id': 'recipientrow001', 'expected_revision': 1, 'action': 'read'},
                 {'id': 'recipientrow002', 'expected_revision': 1, 'action': 'archive'}]
        with patch.object(nc, 'call', side_effect=[(409, {'message': 'conflict'}), (200, {'id': 'recipientrow002'})]):
            result, ok = nc.bulk({}, items)
        self.assertFalse(ok)
        self.assertEqual([r['status'] for r in result['results']], [409, 200])
        self.assertEqual(result['unattempted'], [])

    def test_bulk_stops_on_uncertain_transport_outcome(self):
        items = [{'id': 'recipientrow001', 'expected_revision': 1, 'action': 'read'},
                 {'id': 'recipientrow002', 'expected_revision': 1, 'action': 'archive'}]
        with patch.object(nc, 'call', side_effect=nc.Fail(1, 'connection lost')):
            result, ok = nc.bulk({}, items)
        self.assertFalse(ok)
        self.assertEqual(result['unattempted'], items[1:])
        self.assertIn('unknown', result['results'][0]['outcome'])

    def test_invalid_date_filters_fail_before_network(self):
        for option, value in [('--since', 'yesterday'), ('--before', '2026-02-30'),
                              ('--since', '2026-10-01T12:00:00'), ('--before', ''),
                              ('--before', '2026-10-01T99:00:00Z'),
                              ('--since', '2026-10-01T12:00:00+01:99')]:
            with self.subTest(option=option, value=value), patch.object(nc, 'identity') as identity:
                with self.assertRaises(nc.Fail) as error:
                    nc.backlog({}, nc.parse(['backlog', option, value]))
                self.assertEqual(error.exception.code, 2)
                identity.assert_not_called()

    def test_dates_normalize_and_reversed_range_fails(self):
        self.assertEqual(nc.filter_date('2026-10-01', '--since'), '2026-10-01T00:00:00.000000Z')
        self.assertEqual(nc.filter_date('2026-10-01T13:00:00+01:00', '--before'), '2026-10-01T12:00:00.000000Z')
        with patch.object(nc, 'identity') as identity:
            with self.assertRaises(nc.Fail):
                nc.backlog({}, nc.parse(['backlog', '--since', '2026-10-02', '--before', '2026-10-01']))
            identity.assert_not_called()

    def test_overdue_excludes_withdrawn_and_acknowledged(self):
        with patch.object(nc, 'identity', return_value={'id': 'self'}), patch.object(nc, 'query_rows', return_value=([], False)) as query:
            nc.backlog({}, nc.parse(['backlog', '--overdue']))
        sql = query.call_args.args[1]
        self.assertIn("n.due_at != ''", sql)
        self.assertIn("julianday(n.due_at) < julianday('now')", sql)
        self.assertIn("r.acknowledged_at = ''", sql)
        self.assertIn("n.withdrawn_at = ''", sql)

    def test_signup_filters_require_sent_before_network(self):
        for flag in ('--awaiting-signup', '--expired-signup'):
            with patch.object(nc, 'identity') as identity:
                with self.assertRaises(nc.Fail) as error:
                    nc.backlog({}, nc.parse(['backlog', flag]))
                self.assertEqual(error.exception.code, 2)
                identity.assert_not_called()

    def test_signup_filters_keep_pending_rows_without_directory_matches(self):
        for flag, comparison in [('--awaiting-signup', '>'), ('--expired-signup', '<=')]:
            with self.subTest(flag=flag), patch.object(nc, 'identity', return_value={'id': 'self'}), patch.object(nc, 'query_rows', return_value=([], False)) as query:
                nc.backlog({}, nc.parse(['backlog', '--sent', flag, '--include-withdrawn']))
                sql = query.call_args.args[1]
                self.assertIn('LEFT JOIN user_directory d ON d.id=r.recipient', sql)
                self.assertIn("r.recipient = ''", sql)
                self.assertIn("n.withdrawn_at = ''", sql)
                self.assertIn("julianday(r.claim_expires_at) " + comparison + " julianday('now')", sql)
                self.assertIn('r.addressed_email', sql)
                self.assertIn('AS signup_status', sql)

    def test_email_only_publication_and_unchanged_retry_payload(self):
        payload = {'submission_key': 'stable-key', 'recipient_emails': ['colleague@example.com'],
                   'subject': 'Supplier review', 'body_markdown': 'Please review', 'kind': 'fyi'}
        with patch.object(nc, 'config', return_value={}), patch.object(nc, 'must', return_value={'id': 'notification001'}) as must, patch.object(nc, 'say'):
            for _ in range(2): nc.run(nc.parse(['publish', json.dumps(payload)]))
        self.assertEqual(must.call_count, 2)
        for call in must.call_args_list:
            self.assertEqual(call.args[3], payload)

    def test_invalid_mixed_recipient_lists_fail_without_network(self):
        for extra in [{'recipient_emails': 'a@example.com'}, {'recipient_emails': ['']},
                      {'recipients': [], 'recipient_emails': []}, {'recipient_emails': ['a@example.com'] * 101},
                      {'recipients': ['recipient000001'], 'recipient_emails': [None]}]:
            with self.subTest(extra=extra), patch.object(nc, 'config', return_value={}), patch.object(nc, 'must') as must:
                with self.assertRaises(nc.Fail):
                    nc.run(nc.parse(['publish', json.dumps({'submission_key': 'key', **extra})]))
                must.assert_not_called()

    def test_publication_requires_recoverable_key_before_network(self):
        with patch.object(nc, 'config', return_value={}), patch.object(nc, 'must') as must:
            with self.assertRaises(nc.Fail):
                nc.run(nc.parse(['publish', '{"recipients":["recipient000001"]}']))
            must.assert_not_called()


if __name__ == '__main__': unittest.main()
