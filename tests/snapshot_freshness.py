#!/usr/bin/env python3
"""Synthetic read-after-write checks for reused filtered SQL snapshots.

The pinned server retains each requester's private snapshot while the source
database is unchanged. These checks prove reuse with X-Context-Snapshot-At
(unchanged on a cache hit), then require every write that changes notification
state or authorization to be visible on the very next read, without stale rows
or privacy leaks for the sender, recipient, unrelated users or pending email
addresses.
"""
import argparse
import concurrent.futures
import json
import secrets
import urllib.error
import urllib.request
from integration import server, operator, account, path
from oauth_integration import google_fixture, REDIRECT


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--binary', required=True)
    args = ap.parse_args()
    with google_fixture() as (url, codes), server(args.binary, {'NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN': 'example.com'}) as req:
        def sql(query, token, expected=200):
            request = urllib.request.Request(req.base_url + '/api/context/query', data=json.dumps({'sql': query}).encode(),
                                             headers={'Content-Type': 'application/json', 'Authorization': token}, method='POST')
            try:
                with urllib.request.urlopen(request, timeout=25) as response:
                    status, raw, headers = response.status, response.read(), response.headers
            except urllib.error.HTTPError as error:
                status, raw, headers = error.code, error.read(), error.headers
            assert status in (expected if isinstance(expected, tuple) else (expected,)), (query, status, raw.decode())
            if status != 200:
                return None, None
            assert headers['X-Context-Scope'] == 'authorized-snapshot'
            result = json.loads(raw)
            assert not result['truncated']
            return [dict(zip(result['columns'], row)) for row in result['rows']], headers['X-Context-Snapshot-At']

        def warm(query, token):
            """Read twice: an unchanged capture time proves the second read reused the snapshot."""
            rows, first = sql(query, token)
            again, second = sql(query, token)
            assert rows == again and first == second, 'expected a reused snapshot for an unchanged source'
            return rows, first

        def fresh(query, token, before):
            """The first read after a commit must come from a new capture."""
            rows, at = sql(query, token)
            assert at != before, 'a committed write must invalidate the reused snapshot'
            return rows

        op = operator(req)
        alice, at = account(req, op, 'alice@example.com')
        bob, bt = account(req, op, 'bob@example.com')
        carol, ct = account(req, op, 'carol@example.com')
        provider = {'name': 'google', 'clientId': 'synthetic', 'clientSecret': 'synthetic', 'authURL': url + '/authorize',
                    'tokenURL': url + '/token', 'userInfoURL': url + '/userinfo'}
        req('PATCH', '/api/collections/users', {'oauth2': {'enabled': True, 'providers': [provider]}}, op)
        schema = req('GET', '/api/context/schema', token=at)
        assert schema['permissionModel'] == 'filtered-snapshot' and 'snapshot' not in schema
        assert schema['snapshotLimits']['maxConcurrentPerRequester'] == 0, 'per-requester admission must stay disabled'

        notes = 'SELECT n.id,n.withdrawn_at FROM notifications n ORDER BY n.id'
        recipients = 'SELECT id,notification,recipient,addressed_email,read_at,acknowledged_at,archived_at,claimed_at,claim_expires_at,revision FROM notification_recipients ORDER BY id'
        events = 'SELECT event_type,notification_recipient FROM notification_events ORDER BY created,id'
        unread = ("SELECT count(*) AS total FROM notification_recipients r JOIN notifications n ON n.id=r.notification "
                  "WHERE r.recipient='{}' AND (r.read_at='' OR r.read_at IS NULL) AND (r.archived_at='' OR r.archived_at IS NULL) "
                  "AND (n.withdrawn_at='' OR n.withdrawn_at IS NULL)")
        bob_unread = unread.format(bob['id'])

        # Everyone starts empty and cached.
        _, alice_at = warm(notes, at)
        _, bob_at = warm(notes, bt)
        _, carol_at = warm(notes, ct)
        assert warm(bob_unread, bt)[0] == [{'total': 0}]

        # Publication becomes visible immediately to the sender and recipient, never to unrelated users.
        n = req('POST', path('notifications'), dict(subject='Synthetic freshness', body_markdown='**Synthetic**', kind='review_requested',
                                                     ack_required=True, submission_key='fresh-' + secrets.token_hex(4), recipients=[bob['id']],
                                                     recipient_emails=['future@example.com'],
                                                     references=[dict(kind='url', label='Ref', url='https://example.com/ref')]), at)
        assert [r['id'] for r in fresh(notes, at, alice_at)] == [n['id']]
        assert [r['id'] for r in fresh(notes, bt, bob_at)] == [n['id']]
        assert fresh(notes, ct, carol_at) == []
        sender_rows, _ = warm(recipients, at)
        assert len(sender_rows) == 2 and {r['addressed_email'] for r in sender_rows if not r['recipient']} == {'future@example.com'}
        bob_rows, _ = warm(recipients, bt)
        assert len(bob_rows) == 1 and bob_rows[0]['recipient'] == bob['id'], 'recipients see only their own row'
        assert 'future@example.com' not in json.dumps(bob_rows)
        assert warm(recipients, ct)[0] == [] and warm('SELECT id FROM notification_references', ct)[0] == []
        assert len(warm('SELECT id FROM notification_references', bt)[0]) == 1
        assert warm(bob_unread, bt)[0] == [{'total': 1}]
        # An account provisioned after publication gains nothing before a verified Google claim.
        future, ft = account(req, op, 'future@example.com')
        assert warm(notes, ft)[0] == [] and warm(recipients, ft)[0] == []

        # Each explicit recipient action is visible on the next read for recipient and sender.
        row = bob_rows[0]
        for action, field, expected_unread in [('read', 'read_at', 0), ('acknowledge', 'acknowledged_at', 0),
                                               ('archive', 'archived_at', 0), ('unarchive', 'archived_at', 0)]:
            _, bob_at = warm(recipients, bt)
            _, alice_at = warm(recipients, at)
            _, unread_at = warm(bob_unread, bt)
            _, carol_at = warm(events, ct)
            _, events_at = warm(events, bt)
            row = req('PATCH', path('notification_recipients') + '/' + row['id'], {'expected_revision': row['revision'], 'action': action}, bt)
            mine = fresh(recipients, bt, bob_at)
            assert len(mine) == 1 and mine[0]['revision'] == row['revision'], (action, mine)
            assert bool(mine[0][field]) == (action != 'unarchive'), (action, mine)
            sender_view = {r['id']: r for r in fresh(recipients, at, alice_at)}
            assert sender_view[row['id']]['revision'] == row['revision'] and sender_view[row['id']][field] == mine[0][field]
            assert fresh(bob_unread, bt, unread_at) == [{'total': expected_unread}]
            assert fresh(events, ct, carol_at) == [], 'unrelated users never see events'
            assert [e['event_type'] for e in fresh(events, bt, events_at)].count(action) == 1, action
            assert [e['event_type'] for e in sql(events, at)[0]].count(action) == 1, action

        # Withdrawal is visible at once and removes the item from the unread count.
        second = req('POST', path('notifications'), dict(subject='Synthetic withdrawal', body_markdown='Second', kind='fyi',
                                                          submission_key='withdraw-' + secrets.token_hex(4), recipients=[bob['id']]), at)
        _, bob_at = warm(notes, bt)
        assert warm(bob_unread, bt)[0] == [{'total': 1}]
        req('PATCH', path('notifications') + '/' + second['id'], {'expected_revision': second['revision'], 'action': 'withdraw',
                                                                   'withdrawal_reason': 'Synthetic'}, at)
        assert next(r for r in fresh(notes, bt, bob_at) if r['id'] == second['id'])['withdrawn_at']
        assert sql(bob_unread, bt)[0] == [{'total': 0}]

        # A verified Google claim changes authorization; the claimant's cached empty snapshot must not survive.
        _, future_at = warm(notes, ft)
        _, alice_at = warm(recipients, at)
        _, bob_at = warm(recipients, bt)
        metadata = req('GET', '/api/collections/users/auth-methods')['oauth2']['providers'][0]
        code = secrets.token_urlsafe(24)
        codes[code] = {'challenge': metadata['codeChallenge'], 'user': {'sub': 'future@example.com', 'email': 'future@example.com',
                                                                         'email_verified': True, 'hd': 'example.com', 'name': 'Synthetic future'}}
        claim = req('POST', '/api/collections/users/auth-with-oauth2', {'provider': 'google', 'code': code, 'redirectURL': REDIRECT,
                                                                       'codeVerifier': metadata['codeVerifier']})
        assert claim['record']['id'] == future['id']
        assert [r['id'] for r in fresh(notes, ft, future_at)] == [n['id']]
        claimed, _ = sql(recipients, claim['token'])
        assert len(claimed) == 1 and claimed[0]['recipient'] == future['id'] and claimed[0]['claimed_at'] and not claimed[0]['claim_expires_at']
        assert {r['recipient'] for r in fresh(recipients, at, alice_at)} == {bob['id'], future['id']}
        bob_rows = fresh(recipients, bt, bob_at)
        assert [r['recipient'] for r in bob_rows] == [bob['id'], bob['id']] and 'future@example.com' not in json.dumps(bob_rows)
        assert sql(notes, ct)[0] == [] and sql(recipients, ct)[0] == []

        # Concurrent reads from several tabs of one account are admitted (no per-requester 429).
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            results = list(pool.map(lambda _: sql(bob_unread, bt)[0], range(8)))
        assert all(result == [{'total': 0}] for result in results)

        # Revocation is enforced before any cached snapshot can be served.
        warm(notes, ct)
        req('PATCH', path('users') + '/' + carol['id'], {'disabled': True}, op)
        sql(notes, ct, expected=(401, 403))
    print('Snapshot reuse read-after-write, claim, privacy and revocation checks passed')


if __name__ == '__main__':
    main()
