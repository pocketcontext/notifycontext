#!/usr/bin/env python3
"""Command-line client for a NotifyContext colleague notification server. Python 3 standard library only.

Configuration comes from three environment variables:
  NOTIFYCONTEXT_URL             server address, for example https://notify.example.com
  NOTIFYCONTEXT_USER_EMAIL     email of an account in the `users` collection
  NOTIFYCONTEXT_USER_PASSWORD  password of that account (optional with Google login)

Exit codes: 0 success; 1 HTTP or transport error; 2 usage or configuration error;
3 `check` found schema differences; 4 HTTP 409 (read the record again, then retry).
"""
import argparse
from datetime import datetime, timezone
import base64
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ENV = ['NOTIFYCONTEXT_URL', 'NOTIFYCONTEXT_USER_EMAIL', 'NOTIFYCONTEXT_USER_PASSWORD']
SCHEMA_FILE = Path(__file__).with_name('schema.json')
TIMEOUT = 30
USER_AGENT = 'NotifyContext/1.0'
hidden = []  # The password and tokens. say() masks them in everything it prints.


class Fail(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def hide(value):
    if value:
        hidden.append(value)
    return value


def say(text, stream=sys.stderr):
    for value in hidden:
        text = text.replace(value, '***')
    print(text, file=stream)


def dump(data, pretty=False):
    if pretty:
        return json.dumps(data, indent=2, ensure_ascii=False)
    return json.dumps(data, separators=(',', ':'), ensure_ascii=False)


def config(names=ENV[:2]):
    missing = [name for name in names if not os.environ.get(name)]
    if missing:
        raise Fail(2, 'missing environment variable: ' + ', '.join(missing) + '. Ask the user to set every missing variable; do not look for credentials elsewhere.')
    url = os.environ[ENV[0]].rstrip('/')
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise Fail(2, 'NOTIFYCONTEXT_URL must be an HTTP(S) URL without credentials, query, or fragment')
    if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise Fail(2, 'Use HTTPS for a remote NotifyContext server')
    return {'url': url, 'email': os.environ[ENV[1]], 'password': hide(os.environ.get(ENV[2]))}


# Token cache: one file per server URL and email, readable only by the current user.

def cache_file(cfg):
    base = os.environ.get('XDG_CACHE_HOME') or str(Path.home() / '.cache')
    key = hashlib.sha256((cfg['url'] + '\n' + cfg['email']).encode()).hexdigest()[:32]
    return Path(base) / 'notifycontext' / (key + '.json')


def load_session(cfg):
    try:
        session = json.loads(cache_file(cfg).read_text())
        if not isinstance(session, dict) or session.get('url') != cfg['url'] or session.get('email') != cfg['email']:
            return None
        return session if isinstance(session.get('token'), str) and hide(session['token']) else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def save_session(cfg, session):
    path = cache_file(cfg)
    try:
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(path.parent, 0o700)
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, prefix='.session-', delete=False) as handle:
            temporary = Path(handle.name)
            os.fchmod(handle.fileno(), 0o600)
            json.dump(session, handle)
        os.replace(temporary, path)
    except OSError as error:
        say(f'note: token not cached ({error.strerror}); sign-in will be required again')


# HTTP

class NoRedirect(urllib.request.HTTPRedirectHandler):
    """A followed redirect would turn a POST into a GET and could send the token to another host."""
    def redirect_request(self, *args):
        return None


opener = urllib.request.build_opener(NoRedirect)


def send(cfg, method, path, body=None, token=None, timeout=TIMEOUT):
    """Send one request. Returns (status, parsed JSON body, or the text when it is not JSON)."""
    headers = {'Content-Type': 'application/json', 'User-Agent': USER_AGENT}
    if token:
        headers['Authorization'] = token
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(cfg['url'] + path, data=data, headers=headers, method=method)
    try:
        with opener.open(request, timeout=timeout) as response:
            status, raw = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, raw = error.code, error.read()
        if 300 <= status < 400:
            raise Fail(1, f'HTTP {status}: the server redirects to {error.headers.get("Location")}. Set NOTIFYCONTEXT_URL to the final address.')
    except (OSError, ValueError, http.client.HTTPException) as error:
        reason = getattr(error, 'reason', error)
        raise Fail(1, f'cannot reach {cfg["url"]}: {reason}')
    text = raw.decode('utf-8', 'replace')
    try:
        return status, json.loads(text) if text else None
    except ValueError:
        return status, text[:2000]


def login(cfg):
    if not cfg.get('password'):
        raise Fail(2, 'Set NOTIFYCONTEXT_USER_PASSWORD for password login, or run notifycontext login --google for browser sign-in.')
    status, data = send(cfg, 'POST', '/api/collections/users/auth-with-password', {'identity': cfg['email'], 'password': cfg['password']})
    if status != 200 or not isinstance(data, dict) or 'token' not in data:
        raise Fail(1, f'login as {cfg["email"]} failed: HTTP {status}\n{dump(data)}\nCheck the three NOTIFYCONTEXT_ variables with the user. User credentials only.')
    return auth_session(cfg, data, 'password')


def auth_session(cfg, data, method):
    """Accept only the expected users identity; never retain provider metadata."""
    token = data.get('token') if isinstance(data, dict) else None
    if isinstance(token, str):
        hide(token)
    record = data.get('record') if isinstance(data, dict) else None
    if (not isinstance(token, str) or not token or not isinstance(record, dict) or record.get('collectionName') != 'users'
            or not record.get('id') or not isinstance(record.get('email'), str)
            or record['email'].casefold() != cfg['email'].casefold()):
        raise Fail(1, 'Authentication returned an unexpected identity; no session saved. Check NOTIFYCONTEXT_USER_EMAIL.')
    session = {'url': cfg['url'], 'email': cfg['email'], 'token': token, 'method': method, 'refreshed_at': time.time()}
    save_session(cfg, session)
    return session


def oauth_send(cfg, method, path, body=None, token=None):
    try:
        return send(cfg, method, path, body, token)
    except Fail:
        # Redirect locations and transport errors may contain authorization credentials.
        raise Fail(1, 'OAuth authentication request failed; check the server URL and connection, then retry.') from None


def oauth_refresh_needed(session):
    """Unverified JWT claims only schedule renewal; the server always authenticates the token."""
    try:
        payload = session['token'].split('.')[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
        now = time.time()
        refreshed_at = session['refreshed_at']
        return (not 0 <= now - refreshed_at < 300 or claims['exp'] <= now + 60)
    except (ValueError, TypeError, KeyError, IndexError):
        return True


def google_login(cfg, port=8765, timeout=180):
    if not 1 <= port <= 65535 or not 1 <= timeout <= 600:
        raise Fail(2, 'OAuth port must be 1–65535 and timeout must be 1–600 seconds')
    status, data = oauth_send(cfg, 'GET', '/api/collections/users/auth-methods')
    oauth = data.get('oauth2', {}) if isinstance(data, dict) else {}
    providers = oauth.get('providers', [])
    provider = next((p for p in providers if isinstance(p, dict) and p.get('name') == 'google'), None)
    if status != 200 or not oauth.get('enabled') or not provider:
        raise Fail(1, 'Google OAuth is not enabled on this NotifyContext server.')
    auth_url = urllib.parse.urlsplit(provider.get('authURL', ''))
    if auth_url.scheme != 'https' or auth_url.hostname != 'accounts.google.com' or auth_url.username or auth_url.password or auth_url.fragment:
        raise Fail(1, 'Server returned an unexpected Google authorization URL.')
    state = secrets.token_urlsafe(32)
    verifier = hide(secrets.token_urlsafe(48))
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    redirect = f'http://127.0.0.1:{port}/callback'
    metadata = urllib.parse.parse_qs(auth_url.query)
    client_ids = metadata.get('client_id', [])
    if len(client_ids) != 1 or not client_ids[0]:
        raise Fail(1, 'Server returned an invalid Google client ID.')
    params = {'client_id': client_ids[0]}
    params.update(state=state, code_challenge=challenge, code_challenge_method='S256', redirect_uri=redirect,
                  login_hint=cfg['email'], response_type='code', scope='openid email profile', access_type='online')
    url = urllib.parse.urlunsplit(auth_url._replace(query=urllib.parse.urlencode(params)))
    outcome = {}

    class Callback(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Callback URLs contain credentials.

        def do_GET(self):
            parsed = urllib.parse.urlsplit(self.path)
            values = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
            code = values.get('code', [])
            valid_state = values.get('state', [])
            valid = (self.headers.get('Host') == f'127.0.0.1:{port}' and parsed.path == '/callback' and len(valid_state) == 1
                     and secrets.compare_digest(valid_state[0], state))
            if not valid:
                status, message = 400, 'Invalid sign-in callback. Return to your terminal.'
            elif 'error' in values:
                outcome['error'] = 'Google sign-in was denied or cancelled; run notifycontext login --google to retry.'
                status, message = 400, 'Sign-in was cancelled. Return to your terminal.'
            elif len(code) != 1 or not code[0]:
                outcome['error'] = 'Google returned an invalid sign-in callback.'
                status, message = 400, 'Invalid sign-in callback. Return to your terminal.'
            else:
                outcome['code'] = hide(code[0])
                status, message = 200, 'Authorization received. Return to your terminal to check sign-in.'
            self.send_response(status)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()
            self.wfile.write(message.encode())

    class Listener(http.server.HTTPServer):
        def get_request(self):
            connection, address = super().get_request()
            connection.settimeout(1)
            return connection, address

        def handle_error(self, request, client_address):
            pass  # Never print request data or exception tracebacks.

    try:
        server = Listener(('127.0.0.1', port), Callback)
    except OSError:
        raise Fail(1, f'Cannot listen on 127.0.0.1:{port}; check for another login process or choose --port.')
    with server:
        server.timeout = 0.25
        say(f'For SSH, forward this port: ssh -L {port}:127.0.0.1:{port} user@ssh-host')
        say('Open this URL in your browser (keep it private):\n' + url)
        deadline = time.monotonic() + timeout
        while not outcome and time.monotonic() < deadline:
            server.handle_request()
    if not outcome:
        raise Fail(1, 'Google sign-in timed out; run notifycontext login --google to retry.')
    if 'error' in outcome:
        raise Fail(1, outcome['error'])
    status, data = oauth_send(cfg, 'POST', '/api/collections/users/auth-with-oauth2', {
        'provider': 'google', 'code': outcome['code'], 'codeVerifier': verifier, 'redirectURL': redirect,
    })
    if status != 200:
        raise Fail(1, f'Google sign-in failed: HTTP {status}. Check Workspace eligibility, account access, and the redirect URI with your operator.')
    return auth_session(cfg, data, 'google')


def token_rejected(cfg, token):
    return send(cfg, 'POST', '/api/context/query', {'sql': 'SELECT 1'}, token)[0] == 401


def call(cfg, method, path, body=None):
    """Authenticated request. Returns (status, data).

    Only the SQL endpoints answer an expired or revoked token with 401. The records API treats it as no
    token and answers 400, 403, or 404. So after such an error with a cached token, check the token,
    and if the server rejects it, log in once and send the request once more. The first attempt wrote nothing.
    """
    session = load_session(cfg)
    cached = session is not None
    if not cached:
        session = login(cfg)
    if session.get('method') == 'google' and (oauth_refresh_needed(session) or path == '/api/collections/users/auth-refresh'):
        # Renew at most every five minutes, or near expiry, to respect auth rate limits.
        status, data = oauth_send(cfg, 'POST', '/api/collections/users/auth-refresh', token=session['token'])
        if status != 200:
            raise Fail(1, f'Google session could not be refreshed (HTTP {status}); run notifycontext login --google again.')
        session = auth_session(cfg, data, 'google')
        if path == '/api/collections/users/auth-refresh':
            return status, data
    status, data = send(cfg, method, path, body, session['token'])
    if cached and 400 <= status < 500 and status != 409 and (status == 401 or token_rejected(cfg, session['token'])):
        if session.get('method') == 'google':
            raise Fail(1, 'Google session was rejected; run notifycontext login --google again.')
        session = login(cfg)
        status, data = send(cfg, method, path, body, session['token'])
    return status, data


def must(cfg, method, path, body=None):
    """Like call(), but an HTTP error ends the command with the server's status and body on stderr."""
    status, data = call(cfg, method, path, body)
    if status < 400:
        return data
    lines = [f'HTTP {status} from {method} {path}', dump(data, pretty=True)]
    conflict = status == 409
    if conflict:
        lines.append('HTTP 409: revision or submission conflict. Read current state and check the original payload before retrying; do not change a submission key to bypass a conflict.')
    raise Fail(4 if conflict else 1, '\n'.join(lines))


# Commands

def read_json(text, kind, what):
    if text == '-':
        text = sys.stdin.read()
    try:
        value = json.loads(text)
    except ValueError as error:
        raise Fail(2, f'{what} is not valid JSON: {error}')
    if not isinstance(value, kind):
        raise Fail(2, f'{what} must be a JSON {"array" if kind is list else "object"}')
    return value


def require_revision(body):
    if type(body.get('expected_revision')) is not int or body['expected_revision'] < 1:
        raise Fail(2, 'updates require expected_revision from your last read; read the record before changing it')


def records(collection, record=None):
    path = f'/api/collections/{urllib.parse.quote(collection, safe="")}/records'
    return path if record is None else f'{path}/{urllib.parse.quote(record, safe="")}'


def columns(tables):
    return {table['name']: {column['name']: column.get('type') for column in table['columns']} for table in tables}


def check(cfg):
    """Compare the live SQL schema with references/schema.json. Returns the exit code."""
    try:
        reference = columns(json.loads(SCHEMA_FILE.read_text())['tables'])
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise Fail(2, f'cannot read {SCHEMA_FILE}: {error}')
    live = columns(must(cfg, 'GET', '/api/context/schema')['tables'])
    differences = []
    for table in sorted(set(live) | set(reference)):
        if table not in reference:
            differences.append(f'table {table}: on the server, not in the reference files')
        elif table not in live:
            differences.append(f'table {table}: in the reference files, not on the server')
        else:
            for column in sorted(set(live[table]) | set(reference[table])):
                if column not in reference[table]:
                    differences.append(f'column {table}.{column}: on the server, not in the reference files')
                elif column not in live[table]:
                    differences.append(f'column {table}.{column}: in the reference files, not on the server')
                elif live[table][column] != reference[table][column]:
                    differences.append(f'column {table}.{column}: type {live[table][column]} on the server, {reference[table][column]} in the reference files')
    if not differences:
        say(f'OK: the live schema matches references/schema.json ({len(live)} tables)', sys.stdout)
        return 0
    for line in differences:
        say(line, sys.stdout)
    say('The server is authoritative: run `notifycontext schema` and follow the server\'s error messages where the reference files disagree. '
        'Ask the user to update this skill.', sys.stdout)
    return 3


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def query_rows(cfg, sql):
    result = must(cfg, 'POST', '/api/context/query', {'sql': sql})
    return [dict(zip(result['columns'], row)) if isinstance(row, list) else row for row in result['rows']], result.get('truncated', False)


def identity(cfg):
    refreshed = must(cfg, 'POST', '/api/collections/users/auth-refresh')
    hide(refreshed.get('token'))
    return refreshed['record']


def filter_date(value, option):
    """Accept calendar dates or timezone-qualified ISO timestamps, normalized to UTC."""
    if value is None:
        return None
    pattern = r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))?"
    try:
        if not re.fullmatch(pattern, value):
            raise ValueError()
        if len(value) > 10 and value[-1] != 'Z' and (int(value[-5:-3]) > 23 or int(value[-2:]) > 59):
            raise ValueError()
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if len(value) == 10:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat(timespec='microseconds').replace('+00:00', 'Z')
    except (ValueError, OverflowError):
        raise Fail(2, f'{option} must be a valid YYYY-MM-DD date or ISO timestamp with timezone, for example 2026-10-01T12:00:00Z') from None


def backlog(cfg, args):
    """Keyset pagination, shrinking pages on row/byte truncation; never silently partial."""
    since = filter_date(args.since, '--since')
    before = filter_date(args.before, '--before')
    if since and before and since >= before:
        raise Fail(2, '--since must be earlier than --before')
    if not 1 <= args.page_size <= 100:
        raise Fail(2, 'page size must be 1–100')
    if (args.awaiting_signup or args.expired_signup) and not args.sent:
        raise Fail(2, '--awaiting-signup and --expired-signup require --sent')
    uid = identity(cfg)['id']
    predicates = [('n.sender' if args.sent else 'r.recipient') + ' = ' + literal(uid)]
    if not args.include_archived and not args.sent:
        predicates.append("r.archived_at = ''")
    if not args.include_withdrawn:
        predicates.append("n.withdrawn_at = ''")
    if args.awaiting_signup:
        predicates.extend(["n.withdrawn_at = ''", "r.recipient = ''", "r.claim_expires_at != ''", "julianday(r.claim_expires_at) > julianday('now')"])
    if args.expired_signup:
        predicates.extend(["n.withdrawn_at = ''", "r.recipient = ''", "r.claim_expires_at != ''", "julianday(r.claim_expires_at) <= julianday('now')"])
    if args.unread:
        predicates.append("r.read_at = ''")
    if args.awaiting_ack:
        predicates.extend(['n.ack_required = 1', "r.acknowledged_at = ''"])
    if args.overdue:
        predicates.extend(["n.due_at != ''", "julianday(n.due_at) < julianday('now')", "r.acknowledged_at = ''"])
    if args.sender:
        predicates.append('n.sender = ' + literal(args.sender))
    if args.kind:
        predicates.append('n.kind = ' + literal(args.kind))
    if args.search:
        predicates.append('(instr(lower(n.subject),lower(' + literal(args.search) + ')) > 0 OR instr(lower(n.body_markdown),lower(' + literal(args.search) + ')) > 0)')
    if since:
        predicates.append('julianday(n.created) >= julianday(' + literal(since) + ')')
    if before:
        predicates.append('julianday(n.created) < julianday(' + literal(before) + ')')
    result, cursor, size = [], '', args.page_size
    if not 1 <= size <= 100:
        raise Fail(2, 'page size must be 1–100')
    while True:
        sql = '''SELECT r.id AS recipient_record_id,r.recipient,r.revision AS recipient_revision,
          d.name AS recipient_name,r.addressed_email,r.claimed_at,r.claim_expires_at,
          CASE WHEN n.withdrawn_at != '' THEN 'withdrawn'
               WHEN r.recipient != '' THEN CASE WHEN r.claimed_at != '' THEN 'claimed' ELSE 'registered' END
               WHEN julianday(r.claim_expires_at) <= julianday('now') THEN 'expired' ELSE 'awaiting_signup' END AS signup_status,
          r.read_at,r.acknowledged_at,r.acknowledgement_markdown,r.archived_at,
          n.id AS notification_id,n.sender,n.subject,n.body_markdown,n.kind,n.ack_required,
          n.due_at,n.created,n.withdrawn_at,n.withdrawal_reason
          FROM notification_recipients r JOIN notifications n ON n.id=r.notification
          LEFT JOIN user_directory d ON d.id=r.recipient WHERE '''
        sql += ' AND '.join(predicates + ['r.id > ' + literal(cursor)]) + f' ORDER BY r.id LIMIT {size}'
        rows, truncated = query_rows(cfg, sql)
        if truncated:
            if size == 1:
                raise Fail(1, 'A notification exceeds the SQL response limit; use a targeted query. Backlog is incomplete.')
            size = max(1, size // 2)
            continue
        result.extend(rows)
        if len(rows) < size:
            break
        next_cursor = rows[-1]['recipient_record_id']
        if next_cursor <= cursor:
            raise Fail(1, 'Backlog cursor did not advance; refusing an incomplete result')
        cursor = next_cursor
    return {'items': result, 'count': len(result), 'complete': True,
            'consistency': 'Paginated live reads; concurrent changes may require another refresh.'}


def bulk(cfg, items):
    if not items or len(items) > 1000:
        raise Fail(2, 'bulk requires 1–1000 explicit recipient actions')
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not re.fullmatch('[a-z0-9]{15}', item['id']):
            raise Fail(2, 'each action needs a recipient record id')
        require_revision(item)
        if item.get('action') not in ('read', 'acknowledge', 'archive', 'unarchive'):
            raise Fail(2, 'action must be read, acknowledge, archive or unarchive')
        if set(item) - {'id', 'expected_revision', 'action', 'acknowledgement_markdown'}:
            raise Fail(2, 'unexpected bulk action fields')
    results = []
    for item in items:
        try:
            status, data = call(cfg, 'PATCH', records('notification_recipients', item['id']),
                                {k: v for k, v in item.items() if k != 'id'})
            results.append({'id': item['id'], 'action': item['action'], 'status': status, 'ok': status < 400, 'result': data})
        except Fail as error:
            results.append({'id': item['id'], 'action': item['action'], 'ok': False, 'error': str(error),
                            'outcome': 'unknown; read state before retrying'})
            # A transport/auth failure is a useful stopping condition; preserve unattempted work.
            break
    return {'results': results, 'unattempted': items[len(results):]}, all(r['ok'] for r in results) and len(results) == len(items)


def run(args):
    if args.command == 'newkey':
        print(secrets.token_urlsafe(24))
        return 0
    cfg = config()
    if args.command == 'logout':
        cache_file(cfg).unlink(missing_ok=True)
        return 0
    if args.command == 'login':
        google_login(cfg, args.port, args.timeout)
        say(f'Signed in as {cfg["email"]} at {cfg["url"]}', sys.stdout)
        return 0
    if args.command == 'check':
        return check(cfg)
    code = 0
    if args.command == 'whoami':
        row = identity(cfg)
        data = {'id': row['id'], 'name': row.get('name', ''), 'email': cfg['email'], 'url': cfg['url']}
    elif args.command == 'schema':
        data = must(cfg, 'GET', '/api/context/schema')
    elif args.command == 'backlog':
        data = backlog(cfg, args)
    elif args.command == 'bulk':
        data, ok = bulk(cfg, read_json(args.json, list, 'bulk actions'))
        code = 0 if ok else 1
    elif args.command == 'query':
        sql = sys.stdin.read() if args.query == '-' else args.query
        data = must(cfg, 'POST', '/api/context/query', {'sql': sql})
        if data.get('truncated'):
            say('Result truncated; narrow columns or page before claiming completeness.')
    elif args.command == 'get':
        if not re.fullmatch('[a-z0-9]{15}', args.id):
            raise Fail(2, 'invalid record id')
        data, truncated = query_rows(cfg, 'SELECT * FROM "' + args.collection + '" WHERE id=' + literal(args.id))
        if truncated or not data:
            raise Fail(1, 'Record unavailable or exceeds SQL response limit')
        data = data[0]
    elif args.command == 'publish':
        body = read_json(args.json, dict, 'notification')
        if not isinstance(body.get('submission_key'), str) or not body['submission_key'].strip():
            raise Fail(2, 'publish requires a stable submission_key; generate once with newkey and retain the payload for retries')
        recipients, emails = body.get('recipients', []), body.get('recipient_emails', [])
        if (not isinstance(recipients, list) or not isinstance(emails, list)
                or not 1 <= len(recipients) + len(emails) <= 100
                or any(not isinstance(value, str) or not value.strip() for value in recipients + emails)):
            raise Fail(2, 'publish requires 1–100 explicit recipients and/or recipient_emails as arrays of nonempty strings')
        data = must(cfg, 'POST', records('notifications'), body)
    elif args.command in ('create', 'update'):
        body = read_json(args.json, dict, 'record')
        if args.command == 'create':
            if args.collection not in ('user_status', 'notification_preferences'):
                raise Fail(2, 'create supports status/preferences; use publish for notifications')
            data = must(cfg, 'POST', records(args.collection), body)
        else:
            require_revision(body)
            data = must(cfg, 'PATCH', records(args.collection, args.id), body)
    say(dump(data, args.pretty), sys.stdout)
    return code


READABLE = ('notifications', 'notification_recipients', 'notification_references', 'notification_events',
            'user_directory', 'user_status', 'notification_preferences')
WRITABLE = ('notifications', 'notification_recipients', 'user_status', 'notification_preferences')


def parse(argv):
    parser = argparse.ArgumentParser(description='NotifyContext notifications and complete backlog client. Reads never mark notifications read.')
    parser.add_argument('--pretty', action='store_true')
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('whoami', 'schema', 'check', 'logout', 'newkey'):
        commands.add_parser(name)
    p = commands.add_parser('login')
    p.add_argument('--google', required=True, action='store_true')
    p.add_argument('--port', type=int, default=8765)
    p.add_argument('--timeout', type=int, default=180)
    p = commands.add_parser('query'); p.add_argument('query')
    p = commands.add_parser('get'); p.add_argument('collection', choices=READABLE); p.add_argument('id')
    for name in ('publish', 'bulk'):
        p = commands.add_parser(name); p.add_argument('json', help='JSON payload or - for stdin')
    for name in ('create', 'update'):
        p = commands.add_parser(name); p.add_argument('collection', choices=WRITABLE)
        if name == 'update': p.add_argument('id')
        p.add_argument('json', help='JSON payload or - for stdin')
    p = commands.add_parser('backlog', help='Retrieve every matching recipient row with keyset pagination')
    for flag in ('sent', 'include-archived', 'include-withdrawn', 'unread', 'awaiting-ack', 'overdue'):
        p.add_argument('--' + flag, action='store_true')
    signup = p.add_mutually_exclusive_group()
    signup.add_argument('--awaiting-signup', action='store_true', help='With --sent: unclaimed email recipients before their 30-day expiry')
    signup.add_argument('--expired-signup', action='store_true', help='With --sent: unclaimed email recipients whose claim deadline passed')
    for flag in ('sender', 'search', 'since', 'before'):
        p.add_argument('--' + flag)
    p.add_argument('--kind', choices=('fyi', 'review_requested', 'action_required'))
    p.add_argument('--page-size', type=int, default=50)
    return parser.parse_args(argv)


def _main():
    try:
        return run(parse(sys.argv[1:]))
    except Fail as error:
        say(f'notifycontext: {error}')
        return error.code
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        say(f'notifycontext: unexpected {type(error).__name__}: {error}')
        return 1


def main():
    from observecontext_client.instrumentation import instrument_cli
    with instrument_cli(service='notifycontext.client', opener=opener):
        return _main()


if __name__ == '__main__':
    sys.exit(main())
