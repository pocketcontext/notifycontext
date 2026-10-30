#!/usr/bin/env python3
"""Run a temporary loopback-only preview with 19 synthetic historical comments."""
import argparse,signal,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
from integration import server
from feedback import LEGACY_FIXTURE
ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--binary',required=True);args=ap.parse_args()
with server(args.binary,fixture_migrations={'1790300550_preview_feedback.js':LEGACY_FIXTURE}) as request:
    print(f'Preview: {request.base_url}',flush=True)
    print('Local test sign-in: sender@example.com / SyntheticUserPassword123!',flush=True)
    print('To add a later comment: sign in as later@example.com with the same password, open the tunnel notification and acknowledge with a note. Then return to sender@example.com.',flush=True)
    print('Synthetic data only. Ctrl-C stops the server and deletes the temporary database.',flush=True)
    try:signal.pause()
    except KeyboardInterrupt:pass
