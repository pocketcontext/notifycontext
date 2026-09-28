#!/usr/bin/env python3
"""Copied portable CLI against an isolated server: backlog, retries, status and bulk actions."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from integration import ROOT, server, operator, account, PASSWORD, path, query


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    parser.add_argument('--write-schema', action='store_true')
    args = parser.parse_args()
    with server(args.binary) as request, tempfile.TemporaryDirectory(prefix='notifycontext-skill-') as tmp:
        op = operator(request)
        sender, token = account(request, op, 'sender@example.com')
        recipient, recipient_token = account(request, op, 'recipient@example.com')
        schema = request('GET', '/api/context/schema', token=token)
        snapshot = ROOT / 'skills/notifycontext/references/schema.json'
        if args.write_schema:
            snapshot.write_text(json.dumps(schema, indent=2) + '\n')
        assert json.loads(snapshot.read_text()) == schema, 'Schema changed; review and regenerate snapshot'
        skill = Path(tmp) / 'portable'
        shutil.copytree(ROOT / 'skills/notifycontext', skill)
        env = {**os.environ, 'XDG_CACHE_HOME': str(Path(tmp) / 'cache'),
               'NOTIFYCONTEXT_URL': request.base_url, 'NOTIFYCONTEXT_USER_EMAIL': 'sender@example.com',
               'NOTIFYCONTEXT_USER_PASSWORD': PASSWORD}
        def cli(*argv, expected=0):
            result = subprocess.run(['python3', str(skill / 'scripts/nc.py'), *argv], env=env, cwd=tmp, capture_output=True, text=True)
            assert PASSWORD not in result.stdout + result.stderr and token not in result.stdout + result.stderr
            assert result.returncode == expected, (argv, result.stdout, result.stderr)
            return result.stdout
        assert json.loads(cli('whoami'))['id'] == sender['id']
        cli('check')
        cli('query', 'SELECT id,name FROM user_directory')
        key = cli('newkey').strip()
        payload = dict(subject='Synthetic supplier review', body_markdown='## Terms\nPlease review **renewal**.', kind='review_requested',
                       ack_required=True, submission_key=key, recipients=[recipient['id']],
                       references=[dict(kind='document', label='Terms', url='https://example.com/terms')])
        first = json.loads(cli('publish', json.dumps(payload)))
        assert json.loads(cli('publish', json.dumps(payload)))['id'] == first['id']
        cli('publish', json.dumps(dict(payload, subject='Different content')), expected=4)
        for index in range(4):
            cli('publish', json.dumps(dict(payload, submission_key='extra-' + str(index))))
        env['NOTIFYCONTEXT_USER_EMAIL'] = 'recipient@example.com'
        backlog = json.loads(cli('backlog', '--page-size', '2', '--unread'))
        assert backlog['count'] == 5 and backlog['complete']
        assert all(not row['read_at'] and not row['acknowledged_at'] for row in backlog['items'])
        assert len({row['recipient_record_id'] for row in backlog['items']}) == 5
        assert json.loads(cli('backlog', '--search', 'not present'))['count'] == 0
        cli('backlog', '--since', '2026-02-30', expected=2)
        assert json.loads(cli('backlog', '--since', '2000-01-01', '--before', '2099-01-01'))['count'] == 5
        assert all(not row['read_at'] for row in query(request, 'SELECT * FROM notification_recipients', recipient_token))
        selected = backlog['items'][0]
        action = dict(id=selected['recipient_record_id'], expected_revision=selected['recipient_revision'],
                      action='acknowledge', acknowledgement_markdown='Received; reviewing tomorrow.')
        result = json.loads(cli('bulk', json.dumps([action])))
        assert result['results'][0]['ok']
        cli('bulk', json.dumps([action]))  # Already-satisfied retry is safe.
        assert json.loads(cli('backlog', '--awaiting-ack'))['count'] == 4
        row = json.loads(cli('get', 'notification_recipients', selected['recipient_record_id']))
        cli('bulk', json.dumps([dict(id=row['id'], expected_revision=row['revision'], action='archive')]))
        assert json.loads(cli('backlog'))['count'] == 4
        assert json.loads(cli('backlog', '--include-archived'))['count'] == 5
        status = json.loads(cli('create', 'user_status', '{"availability":"busy","message":"Supplier review"}'))
        cli('update', 'user_status', status['id'], json.dumps(dict(expected_revision=status['revision'], availability='available')))
        cli('update', 'user_status', status['id'], json.dumps(dict(expected_revision=status['revision'], availability='away')), expected=4)
        cli('create', 'notification_preferences', '{"alerts_paused_until":"2099-01-01T12:00:00Z"}')
        cli('update', 'notification_recipients', row['id'], '{"action":"read"}', expected=2)
        env['NOTIFYCONTEXT_USER_EMAIL'] = 'sender@example.com'
        assert json.loads(cli('backlog', '--sent', '--include-archived'))['count'] == 5
        cli('logout')
    print('Portable skill, schema, backlog and explicit mutation checks passed.')


if __name__ == '__main__': main()
