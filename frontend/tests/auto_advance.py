#!/usr/bin/env python3
"""Auto-advance SQL and browser navigation against an isolated synthetic server."""
import argparse,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tests'))
from integration import server,operator,account,path,query
ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);args=ap.parse_args()
with server(args.binary) as req:
    op=operator(req)
    alice,at=account(req,op,'alice@example.com');bob,bt=account(req,op,'bob@example.com')
    for i in range(35):
        req('POST',path('notifications'),dict(subject=f'Auto advance {i}',body_markdown='Synthetic navigation fixture.',kind='review_requested',ack_required=True,submission_key=f'advance-{i}',recipients=[bob['id']]),at)
    req('POST',path('notification_preferences'),dict(auto_advance='next'),bt)
    subprocess.run(['node',str(Path(__file__).with_suffix('.mjs'))],cwd=ROOT/'frontend',check=True,env=dict(os.environ,NOTIFYCONTEXT_TEST_URL=req.base_url,NOTIFYCONTEXT_TEST_TOKEN=bt))
print('PASS auto-advance real SQL: both directions across pages, explicit triage, destination remains unread and unacknowledged')
