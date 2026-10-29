#!/usr/bin/env python3
"""Synthetic upgrade check for the ordinary lookup-index migration.

Populates an isolated database with the previous migrations, upgrades it, and
checks that the indexes exist, existing records and partial unique indexes are
unchanged, export policies and frontend detail reads use the new indexes, and
the down migration removes only the added indexes.
"""
import argparse
import contextlib
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PASSWORD = 'SyntheticUserPassword123!'
ADMIN = ['admin@example.com', 'SyntheticAdminPassword123!']
MIGRATION = '1790300500_lookup_indexes.js'
ADDED = {'idx_recipient_by_notification', 'idx_reference_by_notification', 'idx_notification_sent'}
PRESERVED = {'idx_recipient_notification', 'idx_recipient_address', 'idx_pending_address', 'idx_recipient_inbox',
             'idx_notification_submission', 'idx_notification_created'}


def command(binary, data, migrations):
    return [str(Path(binary).resolve()), '--dir', str(data), '--migrationsDir', str(migrations), '--hooksDir', str(ROOT / 'pb_hooks')]


@contextlib.contextmanager
def serve(binary, data, migrations):
    env = dict(os.environ, NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN='example.com')
    result = subprocess.run(command(binary, data, migrations) + ['superuser', 'upsert', *ADMIN], cwd=ROOT, capture_output=True, text=True, env=env)
    assert result.returncode == 0, result.stdout + result.stderr
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    with open(data.parent / f'server-{port}.log', 'w+') as log:
        proc = subprocess.Popen(command(binary, data, migrations) + ['serve', '--http', f'127.0.0.1:{port}'], cwd=ROOT, stdout=log, stderr=log, env=env)

        def request(method, path, body=None, token=None, expected=200):
            headers = {'Content-Type': 'application/json'}
            if token:
                headers['Authorization'] = token
            req = urllib.request.Request(f'http://127.0.0.1:{port}' + path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=25) as response:
                    status, raw = response.status, response.read()
            except urllib.error.HTTPError as error:
                status, raw = error.code, error.read()
            assert status == expected, (method, path, status, raw.decode())
            return json.loads(raw) if raw else None
        try:
            for _ in range(150):
                try:
                    request('GET', '/api/health')
                    break
                except (OSError, AssertionError):
                    if proc.poll() is not None:
                        log.seek(0)
                        raise AssertionError(log.read())
                    time.sleep(.1)
            yield request
        except Exception:
            log.seek(0)
            print(log.read()[-12000:])
            raise
        finally:
            proc.terminate()
            proc.wait(timeout=20)


def indexes(data):
    with contextlib.closing(sqlite3.connect(f'file:{data}/data.db?mode=ro', uri=True)) as db:
        return {name: sql for name, sql in db.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--binary', required=True)
    args = ap.parse_args()
    assert (ROOT / 'pb_migrations' / MIGRATION).is_file()
    with tempfile.TemporaryDirectory(prefix='notifycontext-indexes-') as tmp:
        tmp = Path(tmp)
        data, old = tmp / 'pb_data', tmp / 'previous_migrations'
        shutil.copytree(ROOT / 'pb_migrations', old, ignore=shutil.ignore_patterns(MIGRATION))
        with serve(args.binary, data, old) as req:
            op = req('POST', '/api/collections/_superusers/auth-with-password', {'identity': ADMIN[0], 'password': ADMIN[1]})['token']
            tokens = {}
            for name in ('alice', 'bob', 'carol'):
                email = name + '@example.com'
                req('POST', '/api/collections/users/records', dict(email=email, name=name, verified=True, password=PASSWORD, passwordConfirm=PASSWORD), op)
                tokens[name] = req('POST', '/api/collections/users/auth-with-password', {'identity': email, 'password': PASSWORD})['token']
            bob = req('GET', '/api/collections/users/records?filter=email%3D%22bob%40example.com%22', token=op)['items'][0]['id']
            payload = dict(subject='Synthetic upgrade', body_markdown='Before upgrade', kind='fyi', submission_key='upgrade-1', recipients=[bob],
                           recipient_emails=['pending@example.com'], references=[dict(kind='url', label='Ref', url='https://example.com/ref')])
            published = req('POST', '/api/collections/notifications/records', payload, tokens['alice'])
        before = indexes(data)
        assert not ADDED & set(before) and PRESERVED <= set(before)
        with contextlib.closing(sqlite3.connect(f'file:{data}/data.db?mode=ro', uri=True)) as db:
            rows_before = {t: db.execute(f'SELECT * FROM {t} ORDER BY id').fetchall() for t in ('notifications', 'notification_recipients', 'notification_references', 'notification_events')}

        # Upgrade: serving applies the pending migration to the populated database.
        with serve(args.binary, data, ROOT / 'pb_migrations') as req:
            alice = req('POST', '/api/collections/users/auth-with-password', {'identity': 'alice@example.com', 'password': PASSWORD})['token']
            assert req('POST', '/api/collections/notifications/records', payload, alice)['id'] == published['id'], 'deduplication survives upgrade'
            detail = req('POST', '/api/context/query', {'sql': f"SELECT count(*) AS c FROM notification_recipients WHERE notification='{published['id']}'"}, alice)
            assert detail['rows'] == [[2]]
            carol = req('POST', '/api/collections/users/auth-with-password', {'identity': 'carol@example.com', 'password': PASSWORD})['token']
            assert req('POST', '/api/context/query', {'sql': 'SELECT id FROM notifications'}, carol)['rows'] == []
        after = indexes(data)
        assert ADDED <= set(after), sorted(after)
        assert {k: before[k] for k in PRESERVED} == {k: after[k] for k in PRESERVED}, 'existing (partial) indexes must be unchanged'
        assert 'WHERE' not in ' '.join(after[k] for k in ADDED), 'added indexes must be ordinary so snapshots can copy them'
        cfg = json.loads((ROOT / 'pocketcontext.json').read_text())
        with contextlib.closing(sqlite3.connect(f'file:{data}/data.db?mode=ro', uri=True)) as db:
            assert rows_before == {t: db.execute(f'SELECT * FROM {t} ORDER BY id').fetchall() for t in rows_before}
        # Plan on a copy without sqlite_stat1: PocketBase's optimizer statistics for
        # this tiny fixture favour scans, while realistic tables and snapshots do not.
        planned = tmp / 'planned.db'
        with contextlib.closing(sqlite3.connect(f'file:{data}/data.db?mode=ro', uri=True)) as source, contextlib.closing(sqlite3.connect(planned)) as copy:
            source.backup(copy)
            if copy.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_stat1'").fetchone():
                copy.execute('DELETE FROM sqlite_stat1')
                copy.commit()
        with contextlib.closing(sqlite3.connect(planned)) as db:
            def plan(sql, **params):
                return ' '.join(row[3] for row in db.execute('EXPLAIN QUERY PLAN ' + sql, params))
            for table in ('notifications', 'notification_references', 'notification_events'):
                export = f"SELECT id FROM {table} WHERE (:requester <> '') AND ({cfg['snapshot']['filters'][table]})"
                assert 'idx_recipient_by_notification' in plan(export, requester=bob), (table, plan(export, requester=bob))
            lookup = plan('SELECT id FROM notification_recipients WHERE notification = :n', n=published['id'])
            assert 'idx_recipient_by_notification' in lookup, lookup
            assert 'idx_reference_by_notification' in plan('SELECT * FROM notification_references WHERE notification = :n ORDER BY created, id', n=published['id'])
            sent = plan('SELECT id FROM notifications WHERE sender = :s ORDER BY created DESC, id DESC LIMIT 31', s=bob)
            assert 'idx_notification_sent' in sent and 'TEMP B-TREE' not in sent, sent

        # The down migration removes only the added indexes.
        result = subprocess.run(command(args.binary, data, ROOT / 'pb_migrations') + ['migrate', 'down', '1'], cwd=ROOT, capture_output=True, text=True,
                                env=dict(os.environ, NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN='example.com'), input='y\n')
        assert result.returncode == 0, result.stdout + result.stderr
        reverted = indexes(data)
        assert not ADDED & set(reverted) and {k: before[k] for k in PRESERVED} == {k: reverted[k] for k in PRESERVED}
    print('Lookup-index upgrade, plan, preservation and rollback checks passed')


if __name__ == '__main__':
    main()
