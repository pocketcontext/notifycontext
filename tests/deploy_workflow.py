#!/usr/bin/env python3
"""Deployment workflow and retired-entrypoint checks without live services."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = (ROOT / '.github/workflows/image.yml').read_text()
PUBLICATION, DEPLOYMENT = WORKFLOW.split('  deploy:\n', 1)


def step_script(name):
    step = DEPLOYMENT.split('      - name: ' + name + '\n', 1)[1]
    body = step.split('        run: |\n', 1)[1].split('      - name:', 1)[0]
    return textwrap.dedent(body)


class DeploymentTests(unittest.TestCase):
    def test_pause_only_gates_deployment_after_successful_publication(self):
        self.assertEqual(DEPLOYMENT.splitlines()[0].strip(),
            "if: vars.CONTEXT_DEPLOY_PAUSED != 'true' && vars.COLORS_PROFILE != ''")
        self.assertIn('    needs:\n      - manifest\n', DEPLOYMENT)
        self.assertNotIn('CONTEXT_DEPLOY_PAUSED', PUBLICATION)
        self.assertIn("vars.NOTIFYCONTEXT_PUBLISH_ENABLED == 'true' && github.ref == 'refs/heads/main' && github.event_name != 'pull_request'", PUBLICATION)
        self.assertNotIn('always()', DEPLOYMENT)
        self.assertNotIn('continue-on-error', DEPLOYMENT)

    def test_environment_and_concurrency_preserve_active_deployment(self):
        self.assertIn('    permissions: {}\n', DEPLOYMENT)
        self.assertIn('    environment:\n      name: ${{ vars.COLORS_PROFILE }}\n', DEPLOYMENT)
        self.assertIn('      group: deploy-${{ vars.COLORS_PROFILE }}\n      cancel-in-progress: false\n', DEPLOYMENT)
        self.assertIn('    timeout-minutes: 30\n', DEPLOYMENT)
        for setting in ('SERVER_IP', 'SERVER_USER', 'SSH_KNOWN_HOSTS'):
            self.assertIn(setting + ': ${{ vars.' + setting + ' }}', DEPLOYMENT)
        self.assertIn('SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}', DEPLOYMENT)

    def shell_fixture(self, script, hosts='synthetic-host-key', fail_ssh=False):
        with tempfile.TemporaryDirectory(prefix='notify-deployment-') as temp:
            root = Path(temp)
            binaries = root / 'bin'
            binaries.mkdir()
            stub = '#!' + sys.executable + '\n' + textwrap.dedent('''\
                import json, os, sys
                from pathlib import Path
                name = Path(sys.argv[0]).name
                with open(os.environ['CALLS'], 'a') as log:
                    log.write(json.dumps([name, *sys.argv[1:]]) + '\\n')
                if name == 'ssh-add':
                    Path(os.environ['KEY_INPUT']).write_text(sys.stdin.read())
                if name == 'ssh':
                    assert sys.stdin.read() == ''
                    sys.exit(int(os.environ.get('SSH_RESULT', '0')))
                ''')
            for name in ('ssh-agent', 'ssh-add', 'ssh', 'curl'):
                target = binaries / name
                target.write_text(stub)
                target.chmod(0o700)
            env = {'PATH': str(binaries) + os.pathsep + os.environ['PATH'], 'HOME': str(root),
                   'CALLS': str(root / 'calls'), 'KEY_INPUT': str(root / 'key'),
                   'SSH_PRIVATE_KEY': 'synthetic-private-key\r\n', 'SSH_KNOWN_HOSTS': hosts,
                   'SERVER_USER': 'deploy', 'SERVER_IP': '192.0.2.1',
                   'SSH_RESULT': '9' if fail_ssh else '0'}
            result = subprocess.run(['bash', '-e', '-o', 'pipefail', '-c', script],
                                    env=env, capture_output=True, text=True)
            calls = [json.loads(line) for line in (root / 'calls').read_text().splitlines()] if (root / 'calls').exists() else []
            known = root / '.ssh/known_hosts'
            return result, calls, known.read_text() if known.exists() else '', (root / 'key').read_text() if (root / 'key').exists() else ''

    def test_restricted_ssh_receives_no_remote_command_and_pinned_key(self):
        result, calls, known, key = self.shell_fixture(step_script('Deploy via SSH'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [['ssh-agent', '-s'], ['ssh-add', '-'],
            ['ssh', '-T', '-o', 'StrictHostKeyChecking=yes', 'deploy@192.0.2.1']])
        self.assertEqual(known, 'synthetic-host-key\n')
        self.assertEqual(key, 'synthetic-private-key\n\n')
        self.assertNotIn('synthetic-private-key', result.stdout + result.stderr)

    def test_missing_pinned_host_key_prevents_connection(self):
        result, calls, known, _ = self.shell_fixture(step_script('Deploy via SSH'), hosts='')
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('ssh', [call[0] for call in calls])
        self.assertEqual(known, '')

    def test_remote_failure_propagates(self):
        result, _, _, _ = self.shell_fixture(step_script('Deploy via SSH'), fail_ssh=True)
        self.assertEqual(result.returncode, 9)

    def test_health_targets_only_notify_with_bounded_retries(self):
        result, calls, _, _ = self.shell_fixture(step_script('Verify public health'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], 'curl')
        self.assertEqual(calls[0][-1], 'https://notify.pocketcontext.com/up')
        for flag in ('--fail', '--connect-timeout', '--max-time', '--retry-max-time'):
            self.assertIn(flag, calls[0])

    def test_retired_commands_refuse_without_touching_keys_or_calling_tools(self):
        with tempfile.TemporaryDirectory(prefix='notify-retired-deploy-') as temp:
            root = Path(temp)
            keys = root / '.ssh/authorized_keys'
            keys.parent.mkdir()
            keys.write_text('preserve every existing key\n')
            for command in ('docker', 'once', 'sudo', 'visudo'):
                trap = root / command
                trap.write_text('#!/bin/sh\ntouch "$HOME/unexpected-call"\nexit 99\n')
                trap.chmod(0o700)
            for name in ('deploy-notifycontext.py', 'install.py'):
                for args in ([], ['other-host']):
                    with self.subTest(name=name, args=args):
                        result = subprocess.run([sys.executable, str(ROOT / 'deploy' / name), *args],
                            env={'PATH': str(root), 'HOME': str(root)}, capture_output=True, text=True)
                        self.assertEqual(result.returncode, 1)
                        self.assertIn('once-pocketcontext-v2', result.stderr)
                        self.assertIn('retired', result.stderr)
                        self.assertFalse((root / 'unexpected-call').exists())
                        self.assertEqual(keys.read_text(), 'preserve every existing key\n')


if __name__ == '__main__':
    unittest.main()
