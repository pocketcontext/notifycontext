#!/usr/bin/env python3
"""Behavioral tests: complete backlog, safe writes, partial results and SQL quoting."""
import contextlib
import http.server
import importlib.util
import io
import json
import unittest
from pathlib import Path
import threading
from unittest.mock import patch

from notifycontext_client import cli as nc


class ClientTest(unittest.TestCase):
    def test_feedback_backlog_pages_and_keeps_sender_state_separate(self):
        calls=[]
        def query(cfg,sql):
            calls.append(sql)
            return ([{'feedback_record_id':'a'},{'feedback_record_id':'b'}] if "f.id > ''" in sql else []),False
        with patch.object(nc,'identity',return_value={'id':'self'}), patch.object(nc,'query_rows',side_effect=query), patch.object(nc,'call') as mutation:
            result=nc.backlog({},nc.parse(['backlog','--feedback','--unread','--page-size','2','--search','Amazing feature!']))
            self.assertEqual(result['count'],2)
            self.assertTrue(result['complete'])
            self.assertIn("f.user = 'self'",calls[0])
            self.assertIn('f.read_version < f.activity_version',calls[0])
            self.assertIn("f.archived_at = ''",calls[0])
            self.assertIn("f.id > 'b'",calls[1])
            mutation.assert_not_called()

    def test_feedback_rejects_recipient_filters(self):
        for flag in ['--sent','--awaiting-ack','--overdue']:
            with self.assertRaises(nc.Fail):
                nc.backlog({},nc.parse(['backlog','--feedback',flag]))

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


class RateLimitTest(unittest.TestCase):
    """send() against a real local HTTP server; sleeping and jitter are patched out."""
    def serve(self, responses):
        hits = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def handle_one(self):
                length = int(self.headers.get('Content-Length') or 0)
                hits.append((self.command, self.path, self.rfile.read(length)))
                status, headers = responses.pop(0) if responses else (200, {})
                body = json.dumps({'message': 'Too Many Requests.'} if status == 429 else {'ok': len(hits)}).encode()
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            do_GET = do_POST = do_PATCH = handle_one
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return {'url': f'http://127.0.0.1:{server.server_port}'}, hits

    def send(self, cfg, *args, budget=None, clock=None):
        sleeps, now = [], [0.0]
        def sleep(seconds):
            sleeps.append(round(seconds, 3))
            now[0] += seconds
        env = {} if budget is None else {'NOTIFYCONTEXT_RATE_LIMIT_WAIT': budget}
        with patch.dict(nc.os.environ, env), patch.object(nc.time, 'sleep', side_effect=sleep), patch.object(nc.time, 'monotonic', side_effect=lambda: now[0]), patch.object(nc.random, 'random', return_value=1.0), patch.object(nc.time, 'time', return_value=clock or 0), contextlib.redirect_stderr(io.StringIO()) as err:
            result = nc.send(cfg, *args)
        return result, sleeps, err.getvalue()

    def test_backs_off_within_one_window_then_succeeds(self):
        cfg, hits = self.serve([(429, {})] * 5)
        (status, data), sleeps, err = self.send(cfg, 'POST', '/api/context/query', {'sql': 'SELECT 1'})
        self.assertEqual((status, data), (200, {'ok': 6}))
        self.assertEqual(sleeps, [1, 2, 4, 8, 11])
        self.assertEqual(len(hits), 6)
        self.assertTrue(all(hit == hits[0] for hit in hits))
        self.assertEqual(err.count('rate limited'), 5)

    def test_retry_after_seconds_and_dates_are_capped(self):
        cfg, _ = self.serve([(429, {'Retry-After': '3'}), (429, {'Retry-After': '900'}), (429, {'Retry-After': 'Thu, 01 Jan 1970 00:00:20 GMT'})])
        (status, _), sleeps, _ = self.send(cfg, 'GET', '/x', budget='200', clock=10)
        self.assertEqual(status, 200)
        self.assertEqual(sleeps, [3.5, 60.5, 10.5])

    def test_budget_exhaustion_returns_429_with_guidance(self):
        cfg, hits = self.serve([(429, {})] * 20)
        (status, _), sleeps, _ = self.send(cfg, 'GET', '/x')
        self.assertEqual(status, 429)
        self.assertLessEqual(sum(sleeps), 60)
        self.assertEqual(len(hits), len(sleeps) + 1)
        with patch.object(nc, 'call', return_value=(429, {'message': 'Too Many Requests.'})), self.assertRaises(nc.Fail) as failure:
            nc.must(cfg, 'GET', '/x')
        self.assertEqual(failure.exception.code, 1)
        self.assertIn('still rate limited', str(failure.exception))

    def test_disabled_budget_and_other_errors_do_not_retry(self):
        for budget, status in (('0', 429), (None, 500), (None, 503)):
            with self.subTest(budget=budget, status=status):
                cfg, hits = self.serve([(status, {'Retry-After': '1'})])
                (got, _), sleeps, _ = self.send(cfg, 'GET', '/x', budget=budget)
                self.assertEqual((got, sleeps, len(hits)), (status, [], 1))
        with patch.dict(nc.os.environ, {'NOTIFYCONTEXT_RATE_LIMIT_WAIT': 'soon'}), self.assertRaises(nc.Fail) as failure:
            nc.rate_limit_budget()
        self.assertEqual(failure.exception.code, 2)

    def test_rejected_write_is_resent_once_with_the_same_body(self):
        cfg, hits = self.serve([(429, {})])
        (status, _), _, _ = self.send(cfg, 'PATCH', '/api/collections/notification_recipients/records/r1', {'action': 'read', 'expected_revision': 3})
        self.assertEqual(status, 200)
        self.assertEqual([hit[0] for hit in hits], ['PATCH', 'PATCH'])
        self.assertEqual(json.loads(hits[1][2]), {'action': 'read', 'expected_revision': 3})


if __name__ == '__main__': unittest.main()
