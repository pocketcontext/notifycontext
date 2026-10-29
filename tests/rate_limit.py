#!/usr/bin/env python3
"""The installed client waits out the deployment rate limit (60 SQL reads per 10 s per client IP).

A real server with NOTIFYCONTEXT_RATE_LIMITS=true is exhausted with raw reads; the client's next
query and backlog must then succeed after retrying, without read side effects, and a zero retry
budget must fail at once with exit code 1."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from integration import PASSWORD, account, operator, path, query, server  # noqa: E402

parser = argparse.ArgumentParser()
parser.add_argument('--binary', required=True)
args = parser.parse_args()


def client(request, email, *command, wait=None):
    env = {key: value for key, value in os.environ.items() if not key.startswith('NOTIFYCONTEXT_')}
    env.update(NOTIFYCONTEXT_URL=request.base_url, NOTIFYCONTEXT_USER_EMAIL=email, NOTIFYCONTEXT_USER_PASSWORD=PASSWORD, XDG_STATE_HOME=state, XDG_CACHE_HOME=state)
    if wait is not None:
        env['NOTIFYCONTEXT_RATE_LIMIT_WAIT'] = wait
    started = time.monotonic()
    result = subprocess.run([sys.executable, '-c', 'from notifycontext_client.cli import main; raise SystemExit(main())', *command], capture_output=True, text=True, env=env, cwd=state, timeout=120)
    return result, time.monotonic() - started


def exhaust(request, token):
    for _ in range(80):
        try:
            request('POST', '/api/context/query', {'sql': 'SELECT 1 AS n'}, token, expected=429)
            return
        except AssertionError:
            pass
    raise AssertionError('the /api/context/ rate limit was never reached')


with tempfile.TemporaryDirectory(prefix='notifycontext-rate-limit-') as state, server(args.binary, {'NOTIFYCONTEXT_RATE_LIMITS': 'true'}) as request:
    op = operator(request)
    alice, at = account(request, op, 'alice@example.com')
    bob, bt = account(request, op, 'bob@example.com')
    for i in range(3):
        request('POST', path('notifications'), dict(subject=f'Rate-limit fixture {i}', body_markdown='Synthetic.', kind='fyi', ack_required=False, submission_key=f'limit-{i}', recipients=[bob['id']], references=[]), at)
    time.sleep(11)  # start from a fresh limiter window

    exhaust(request, bt)
    result, seconds = client(request, 'bob@example.com', 'query', 'SELECT count(*) AS total FROM notification_recipients')
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout)['rows'] in ([[3]], [{'total': 3}]), result.stdout
    assert 'rate limited by the server' in result.stderr and seconds < 30, (seconds, result.stderr)

    exhaust(request, bt)
    result, _ = client(request, 'bob@example.com', 'backlog')
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'rate limited by the server' in result.stderr, result.stderr

    exhaust(request, bt)
    result, seconds = client(request, 'bob@example.com', 'query', 'SELECT 1 AS n', wait='0')
    assert result.returncode == 1 and 'still rate limited' in result.stderr and seconds < 10, (result.returncode, seconds, result.stderr)

    time.sleep(11)
    rows = query(request, "SELECT read_at, acknowledged_at, archived_at FROM notification_recipients", bt)
    assert len(rows) == 3 and not any(any(row.values()) for row in rows), rows
print('Client rate-limit retry, budget exhaustion and absence of read side effects verified.')
