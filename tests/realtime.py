#!/usr/bin/env python3
"""Actual SSE privacy, commit/rollback, recovery and session lifecycle checks."""
import argparse
import contextlib
import http.client
import json
import queue
import secrets
import socket
import threading
import time
import urllib.request
from integration import server, operator, account, path, query, PASSWORD
from oauth_integration import google_fixture, REDIRECT


class InboxStream:
    def __init__(self, req, token, user_id):
        self.req, self.token = req, token
        self.topic = 'notifycontext.inbox.' + user_id
        self.stream = urllib.request.urlopen(req.base_url + '/api/realtime', timeout=60)
        while True:
            line = self.stream.readline().decode().strip()
            if line.startswith('data:'):
                self.client_id = json.loads(line[5:])['clientId']
                break
        assert self.stream.readline().strip() == b''
        self.events = queue.Queue()
        self.thread = threading.Thread(target=self._read, daemon=True)
        self.thread.start()

    def subscribe(self, topics=None, token=None, expected=204):
        return self.req('POST', '/api/realtime', {
            'clientId': self.client_id, 'subscriptions': topics or [self.topic, 'PB_CONNECT']
        }, self.token if token is None else token, expected=expected)

    def _read(self):
        event, data = '', ''
        try:
            while True:
                line = self.stream.readline()
                if not line:
                    return
                line = line.decode().rstrip('\r\n')
                if line.startswith('event:'): event = line[6:].strip()
                elif line.startswith('data:'): data += line[5:].strip()
                elif not line:
                    if event: self.events.put((event, data))
                    event, data = '', ''
        except (OSError, ValueError, AttributeError, http.client.IncompleteRead):
            pass

    def changed(self):
        event, data = self.events.get(timeout=3)
        assert event == self.topic, (event, data)
        assert json.loads(data) == {}, data

    def quiet(self):
        try: event = self.events.get(timeout=.25)
        except queue.Empty: return
        raise AssertionError(('Unexpected private event', event))

    def close(self):
        try: self.stream.fp.raw._sock.shutdown(socket.SHUT_RDWR)
        except (AttributeError, OSError): pass
        self.thread.join(timeout=1)
        self.stream.close()


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--binary', required=True); args = parser.parse_args()
    with google_fixture() as (url, codes), server(args.binary, {'NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN': 'example.com'}) as req, contextlib.ExitStack() as stack:
        op = operator(req)
        alice, at = account(req, op, 'alice@example.com')
        bob, bt = account(req, op, 'bob@example.com')
        eve, et = account(req, op, 'eve@example.com')
        outsider, ot = account(req, op, 'outsider@example.com')
        def stream(token, user):
            result = InboxStream(req, token, user['id']); stack.callback(result.close); return result
        a, b, e, o = stream(at, alice), stream(bt, bob), stream(et, eve), stream(ot, outsider)
        for s in [a, b, e, o]: s.subscribe()
        # Anonymous, operator and cross-user/wildcard topics cannot listen.
        guest = stream('', bob)
        guest.subscribe(expected=403)
        guest.subscribe(token=op, expected=403)
        o.subscribe([b.topic], expected=403)
        o.subscribe(['notifycontext.inbox.*'], expected=403)
        o.subscribe([b.topic + '?options={}'], expected=403)
        o.subscribe()
        counter = 0
        def publish(recipients=None, **extra):
            nonlocal counter
            counter += 1
            body = dict(subject='Synthetic private inbox', body_markdown='Private body never sent in SSE', kind='fyi', submission_key=str(counter))
            if recipients is not None: body['recipients'] = recipients
            body.update(extra)
            return req('POST', path('notifications'), body, at), body
        n, body = publish([bob['id'], eve['id']])
        for s in [a, b, e]: s.changed()
        o.quiet(); guest.quiet()
        # Event already sees committed SQL and has not marked anything read.
        recipient = query(req, f"SELECT * FROM notification_recipients WHERE notification='{n['id']}'", bt)[0]
        assert not recipient['read_at']
        req('POST', path('notifications'), body, at)
        for s in [a, b, e]: s.quiet()  # idempotent retry creates no event
        for action in ['read', 'acknowledge', 'archive', 'unarchive']:
            recipient = req('PATCH', path('notification_recipients') + '/' + recipient['id'], {'action': action, 'expected_revision': recipient['revision']}, bt)
            a.changed(); b.changed(); e.quiet(); o.quiet()
        req('PATCH', path('notifications') + '/' + n['id'], {'action': 'withdraw', 'expected_revision': 1, 'withdrawal_reason': 'Synthetic replacement'}, at)
        for s in [a, b, e]: s.changed()
        req('POST', path('notifications'), dict(body, submission_key='rollback', subject='Synthetic audit failure'), at, expected=400)
        for s in [a, b, e, o]: s.quiet()
        assert not query(req, "SELECT id FROM notifications WHERE submission_key='rollback'", at)
        # Disconnect and new subscription recover via ordinary authorized SQL.
        b.close()
        publish([bob['id']]); a.changed()
        b = stream(bt, bob); b.subscribe()
        assert len(query(req, 'SELECT * FROM notifications', bt)) == 2
        publish([bob['id']]); a.changed(); b.changed()
        # Revoked connections cannot receive later signals; enabling does not revive tokens.
        req('PATCH', path('users') + '/' + bob['id'], {'disabled': True}, op)
        req('PATCH', path('users') + '/' + bob['id'], {'disabled': False}, op)
        publish([bob['id']]); a.changed(); b.quiet()
        b.subscribe(expected=(401, 403))
        # Existing sessions receive a pending claim only after OAuth commits.
        provider = {'name': 'google', 'clientId': 'synthetic', 'clientSecret': 'synthetic', 'authURL': url + '/authorize', 'tokenURL': url + '/token', 'userInfoURL': url + '/userinfo'}
        req('PATCH', '/api/collections/users', {'oauth2': {'enabled': True, 'providers': [provider]}}, op)
        def exchange(email, expected=200):
            metadata = req('GET', '/api/collections/users/auth-methods')['oauth2']['providers'][0]
            code = secrets.token_urlsafe(24)
            codes[code] = {'challenge': metadata['codeChallenge'], 'user': {'sub': email, 'email': email, 'email_verified': True, 'hd': 'example.com', 'name': 'Synthetic colleague'}}
            return req('POST', '/api/collections/users/auth-with-oauth2', {'provider': 'google', 'code': code, 'redirectURL': REDIRECT, 'codeVerifier': metadata['codeVerifier']}, expected=expected)
        publish(recipient_emails=['future@example.com']); a.changed()
        future, ft = account(req, op, 'future@example.com'); f = stream(ft, future); f.subscribe()
        exchange('future@example.com'); a.changed(); f.changed(); e.quiet(); o.quiet()
        assert len(query(req, 'SELECT * FROM notifications', ft)) == 1
        publish(recipient_emails=['rollback@example.com']); a.changed()
        publish(recipient_emails=['rollback@example.com'], subject='Synthetic claim failure'); a.changed()
        rollback, rt = account(req, op, 'rollback@example.com'); r = stream(rt, rollback); r.subscribe()
        exchange('rollback@example.com', expected=(400, 403, 500))
        a.quiet(); r.quiet()
        assert not query(req, 'SELECT * FROM notifications', rt)
        # Expired bearer on a still-open connection no longer gets a change signal.
        req('PATCH', '/api/collections/users', {'authToken': {'duration': 10}}, op)
        expired_token = req('POST', '/api/collections/users/auth-with-password', {'identity': 'outsider@example.com', 'password': PASSWORD})['token']
        short = stream(expired_token, outsider); short.subscribe()
        time.sleep(10.1)
        publish([outsider['id']]); a.changed(); o.changed(); short.quiet()
    print('NotifyContext private SSE: routing, rollback, OAuth claims, recovery, revocation and expiry passed')


if __name__ == '__main__': main()
