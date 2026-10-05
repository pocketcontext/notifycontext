"""Exercise container startup around durable maintenance without cloud access."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class MaintenanceEntrypointTests(unittest.TestCase):
    def run_entrypoint(self, state=None, *, db=True, malformed=False, replicate=False,
                       marker_mode=0o600, marker_kind='file', oversized=False, direct_serve=False, sync_fail=False, provision=True):
        with tempfile.TemporaryDirectory(prefix='notifycontext-maintenance-entrypoint-') as tmp:
            root = Path(tmp)
            data = root / 'pb_data'
            data.mkdir()
            if db:
                (data / 'data.db').touch()
            if malformed:
                (data / 'maintenance.json').write_text('{invalid')
            elif state is not None:
                (data / 'maintenance.json').write_text(json.dumps(state))
            marker = data / 'maintenance.json'
            if marker.exists():
                if oversized:
                    marker.write_text(marker.read_text() + ' ' * 4096)
                marker.chmod(marker_mode)
            if marker_kind in ('symlink', 'dangling'):
                target = root / 'marker-target'
                if marker_kind == 'symlink':
                    marker.rename(target)
                else:
                    marker.unlink(missing_ok=True)
                marker.symlink_to(target)
            elif marker_kind == 'directory':
                marker.unlink(missing_ok=True)
                marker.mkdir(mode=0o700)
            calls = root / 'calls'
            server = root / 'server'
            server.write_text('#!/bin/sh\nprintf "%s\\n" "$1" >> "$TEST_CALLS"\n')
            server.chmod(0o700)
            litestream = root / 'litestream'
            litestream.write_text('#!/bin/sh\nprintf "litestream:%s\\n" "$1" >> "$TEST_CALLS"\nif [ "$1" = sync ] && [ "$TEST_SYNC_FAIL" = true ]; then exit 1; fi\n')
            litestream.chmod(0o700)
            script = (ROOT / 'docker/entrypoint.sh').read_text()
            for before, after in (
                ('APP_DIR=/app', 'APP_DIR=' + str(root)),
                ('DATA_DIR=/storage/pb_data', 'DATA_DIR=' + str(data)),
                ('SERVER=/usr/local/bin/pocketcontext', 'SERVER=' + str(server)),
            ):
                script = script.replace(before, after)
            entrypoint = root / 'entrypoint.sh'
            entrypoint.write_text(script)
            env = {k: v for k, v in os.environ.items() if not k.startswith(('NOTIFYCONTEXT_', 'LITESTREAM_'))}
            env.update(TEST_CALLS=str(calls), PATH=str(root) + ':' + env['PATH'],
                       NOTIFYCONTEXT_SUPERUSER_EMAIL='operator@example.test',
                       NOTIFYCONTEXT_SUPERUSER_PASSWORD='SyntheticPassword123!',
                       BASE_URL='https://wiki.example.test')
            if replicate:
                env.update({f'LITESTREAM_{key}': 'synthetic' for key in ('BUCKET', 'PATH', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY')})
            else:
                env['LITESTREAM_DISABLED'] = 'true'
            env['TEST_SYNC_FAIL'] = 'true' if sync_fail else 'false'
            if not provision:
                env.pop('NOTIFYCONTEXT_SUPERUSER_EMAIL', None)
                env.pop('NOTIFYCONTEXT_SUPERUSER_PASSWORD', None)
            result = subprocess.run(['sh', str(entrypoint)] + (['serve'] if direct_serve else []), env=env, capture_output=True, text=True, timeout=10)
            return result, calls.read_text().splitlines() if calls.exists() else []

    def test_replica_handshake_before_serve(self):
        result, calls = self.run_entrypoint(replicate=True, direct_serve=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['litestream:sync', 'serve'])

    def test_failed_handshake_never_serves(self):
        result, calls = self.run_entrypoint(replicate=True, direct_serve=True, sync_fail=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, ['litestream:sync'])

    def test_fresh_google_only_database_initializes_before_replication(self):
        result, calls = self.run_entrypoint(replicate=True, db=False, provision=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['litestream:restore', 'migrate', 'litestream:replicate'])

    def test_normal_start_provisions(self):
        for state in (None, {'readOnly': False, 'generation': 2}):
            result, calls = self.run_entrypoint(state)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(calls, ['superuser', 'serve'])

    def test_frozen_start_preserves_credentials(self):
        result, calls = self.run_entrypoint({'readOnly': True, 'generation': 1})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['serve'])

    def test_frozen_start_skips_all_restore(self):
        result, calls = self.run_entrypoint({'readOnly': True, 'generation': 1}, replicate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, ['litestream:replicate'])

    def test_frozen_missing_database_stops_before_restore(self):
        result, calls = self.run_entrypoint({'readOnly': True, 'generation': 1}, db=False, replicate=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_malformed_state_stops_before_any_command(self):
        for state in ({}, {'readOnly': False}, {'generation': 1},
                      {'readOnly': False, 'generation': 1, 'extra': False},
                      {'readOnly': 'false', 'generation': 1}, {'readOnly': False, 'generation': True},
                      {'readOnly': False, 'generation': -1}, {'readOnly': False, 'generation': 2**64}):
            result, calls = self.run_entrypoint(state)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(calls, [])
        result, calls = self.run_entrypoint(malformed=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_unsafe_marker_stops_before_any_command(self):
        cases = [{'marker_kind': kind} for kind in ('symlink', 'dangling', 'directory')]
        cases += [{'marker_mode': mode} for mode in (0o644, 0o640, 0o604)]
        cases += [{'oversized': True}]
        for options in cases:
            with self.subTest(options=options):
                result, calls = self.run_entrypoint({'readOnly': False, 'generation': 1},
                                                    replicate=True, **options)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, [])


if __name__ == '__main__':
    unittest.main()
