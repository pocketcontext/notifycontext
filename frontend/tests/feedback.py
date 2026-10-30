#!/usr/bin/env python3
"""Real browser test of historical feedback and live resurfacing."""
import argparse,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tests'))
from integration import server,query
from feedback import LEGACY_FIXTURE
ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);args=ap.parse_args()
with server(args.binary,fixture_migrations={'1790300550_legacy_feedback.js':LEGACY_FIXTURE}) as req:
    token=req('POST','/api/collections/users/auth-with-password',{'identity':'later@example.com','password':'SyntheticUserPassword123!'})['token']
    r=query(req,"SELECT * FROM notification_recipients WHERE acknowledged_at=''",token)[0]
    subprocess.run(['node',str(Path(__file__).with_suffix('.mjs'))],cwd=ROOT/'frontend',check=True,env=dict(os.environ,NOTIFYCONTEXT_TEST_URL=req.base_url,NOTIFYCONTEXT_LATER_TOKEN=token,NOTIFYCONTEXT_LATER_ROW=json.dumps(r)))
print('Real browser feedback backfill, explicit read, archive persistence, search, later reply and alert behavior passed.')
