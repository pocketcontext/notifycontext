#!/usr/bin/env python3
"""Exercise migration freeze with synthetic application content over HTTP."""
import argparse
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import time
from pathlib import Path
import urllib.error
import urllib.request

from integration import ROOT, server


def frozen_restart(binary, request, admin, token, frozen):
    """A fresh process preserves a frozen snapshot despite changed deploy settings."""
    with tempfile.TemporaryDirectory(prefix='notifycontext-frozen-restart-') as tmp:
        data = Path(tmp) / 'pb_data'
        data.mkdir()
        for source in request.data_dir.glob('*.db'):
            with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as read:
                with sqlite3.connect(data / source.name) as write:
                    read.backup(write)
        shutil.copy2(request.data_dir / 'maintenance.json', data / 'maintenance.json')
        if (request.data_dir / 'storage').exists():
            shutil.copytree(request.data_dir / 'storage', data / 'storage')
        def config_rows(path):
            with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
                return (db.execute('SELECT * FROM _params ORDER BY id').fetchall(),
                        db.execute('SELECT * FROM _collections ORDER BY id').fetchall(),
                        db.execute('SELECT * FROM users ORDER BY id').fetchall(),
                        db.execute('SELECT * FROM _superusers ORDER BY id').fetchall())
        stored = config_rows(data / 'data.db')
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        env = dict(os.environ, BASE_URL='https://must-not-apply.example.test',
                   NOTIFYCONTEXT_GOOGLE_CLIENT_ID='synthetic-changed-client',
                   NOTIFYCONTEXT_GOOGLE_CLIENT_SECRET='synthetic-changed-secret')
        common = [str(Path(binary).resolve()), '--dir', str(data),
                  '--migrationsDir', str(ROOT / 'pb_migrations'), '--hooksDir', str(ROOT / 'pb_hooks')]
        # New application migrations must not silently change a frozen snapshot.
        pending = Path(tmp) / 'pending_migrations'
        shutil.copytree(ROOT / 'pb_migrations', pending)
        (pending / '9999999999_frozen_pending.js').write_text(
            'migrate((app) => { app.db().newQuery("CREATE TABLE forbidden_frozen_write (id TEXT)").execute(); }, () => {});')
        rejected = subprocess.run([str(Path(binary).resolve()), '--dir', str(data),
            '--migrationsDir', str(pending), '--hooksDir', str(ROOT / 'pb_hooks'),
            'serve', '--http', f'127.0.0.1:{port}'], cwd=ROOT, env=env,
            capture_output=True, text=True, timeout=20)
        assert rejected.returncode != 0, 'pending migration started during freeze'
        assert config_rows(data / 'data.db') == stored, 'pending migration changed stored settings'
        def call(method, path, body=None, identity=admin):
            req = urllib.request.Request(f'http://127.0.0.1:{port}' + path,
                data=None if body is None else json.dumps(body).encode(),
                headers={'Content-Type': 'application/json', 'Authorization': identity}, method=method)
            with urllib.request.urlopen(req, timeout=10) as response:
                return json.loads(response.read())
        with (Path(tmp) / 'server.log').open('w+') as log:
            process = subprocess.Popen(common + ['serve', '--http', f'127.0.0.1:{port}'],
                                       cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                for _ in range(150):
                    if process.poll() is not None:
                        log.seek(0)
                        raise AssertionError(log.read())
                    try:
                        state = call('GET', '/api/context/maintenance')
                        break
                    except (OSError, ValueError):
                        time.sleep(.1)
                else:
                    raise AssertionError('frozen restart timed out')
                assert state['state'] == 'read_only' and state['generation'] == frozen['generation'], state
                assert config_rows(data / 'data.db') == stored, 'frozen bootstrap changed configuration'
                assert call('POST', '/api/context/query', {'sql': 'SELECT id FROM notifications'}, token)['rows']
                # Existing operator tokens can thaw after a full process restart.
                state = call('PUT', '/api/context/maintenance', {
                    'readOnly': False, 'expectedGeneration': frozen['generation']})
                assert state['state'] == 'writable', state
            finally:
                process.terminate()
                process.wait(timeout=15)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    args = parser.parse_args()
    with server(args.binary) as request:
        records = '/api/collections/'
        admin = request('POST', records + '_superusers/auth-with-password', {
            'identity':'admin@example.com', 'password':'SyntheticAdminPassword123!'})['token']
        def account(email):
            user = request('POST', records + 'users/records', {
                'email':email, 'name':'Synthetic', 'verified':True,
                'password':'SyntheticPassword123!', 'passwordConfirm':'SyntheticPassword123!'}, admin)
            token = request('POST', records + 'users/auth-with-password', {
                'identity':email, 'password':'SyntheticPassword123!'})['token']
            return user, token
        user, token = account('reader@example.test')
        outsider, other = account('outsider@example.test')
        payload = {'subject':'Synthetic freeze','body_markdown':'Synthetic evidence',
                   'kind':'fyi','submission_key':'freeze-1','recipients':[user['id']]}
        row = request('POST', records + 'notifications/records', payload, token)
        query_sql = 'SELECT id FROM notifications'
        assert request('POST','/api/context/query',{'sql':query_sql},other)['rows'] == []
        write_table = 'notifications'
        status = request('GET','/api/context/maintenance',token=admin)
        for identity in (None,token):
            request('GET','/api/context/maintenance',token=identity,expected=(401,403))
            request('PUT','/api/context/maintenance',{'readOnly':True,'expectedGeneration':status['generation']},identity,(401,403))
        frozen = request('PUT','/api/context/maintenance',{'readOnly':True,'expectedGeneration':status['generation']},admin)
        assert frozen['state'] == 'read_only'
        assert request('POST','/api/context/query',{'sql':query_sql},token)['rows'] == [[row['id']]]
        request('POST', records + 'users/auth-refresh', {}, token)
        for identity in (token,admin):
            request('POST',records + write_table + '/records',payload,identity,503)
            request('PATCH',records + write_table + '/records/' + row['id'],{'expected_revision':1},identity,503)
            request('POST','/api/batch',{'requests':[{'method':'POST','url':records + write_table + '/records','body':payload}]},identity,503)
        recipient = request('POST','/api/context/query',{'sql':'SELECT id, revision FROM notification_recipients'},token)['rows'][0]
        request('PATCH',records + 'notification_recipients/records/' + recipient[0], {'expected_revision':recipient[1], 'action':'acknowledge'},token,503)
        assert request('POST','/api/context/query',{'sql':'SELECT acknowledged_at FROM notification_recipients'},token)['rows'] == [['']]
        assert request('POST','/api/context/query',{'sql':query_sql},other)['rows'] == []
        frozen_restart(args.binary, request, admin, token, frozen)
        request('PUT','/api/context/maintenance',{'readOnly':False,'expectedGeneration':status['generation']},admin,409)
        thawed = request('PUT','/api/context/maintenance',{'readOnly':False,'expectedGeneration':frozen['generation']},admin)
        assert thawed['state'] == 'writable'
        request('PATCH',records + 'notification_recipients/records/' + recipient[0], {'expected_revision':recipient[1], 'action':'acknowledge'},token)
        assert request('POST',records + 'notifications/records',payload,token)['id'] == row['id']
    print('PASS: maintenance authorization, mutation rejection, read access, frozen restart and thaw')


if __name__ == '__main__':
    main()
