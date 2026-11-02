#!/usr/bin/env python3
"""Browser conversations against an isolated synthetic server."""
import argparse,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tests'))
from integration import server,operator,account,path,query
ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);args=ap.parse_args()
with server(args.binary) as req:
    op=operator(req)
    alice,at=account(req,op,'alice@example.com');bob,bt=account(req,op,'bob@example.com');carol,ct=account(req,op,'carol@example.com');eve,et=account(req,op,'eve@example.com')
    n=req('POST',path('notifications'),dict(subject='Conversation browser review',body_markdown='Original shared context.',kind='review_requested',ack_required=True,submission_key='browser-conversation',recipients=[bob['id'],carol['id']]),at)
    r=query(req,f"SELECT * FROM notification_recipients WHERE notification='{n['id']}'",bt)[0]
    req('PATCH',path('notification_recipients')+'/'+r['id'],dict(expected_revision=r['revision'],action='acknowledge',acknowledgement_markdown='Private acknowledgement from Bob'),bt)
    subprocess.run(['node',str(Path(__file__).with_suffix('.mjs'))],cwd=ROOT/'frontend',check=True,env=dict(os.environ,NOTIFYCONTEXT_TEST_URL=req.base_url,NOTIFYCONTEXT_TEST_FIXTURE=n['id'],NOTIFYCONTEXT_TEST_TOKENS=json.dumps(dict(alice=at,bob=bt,carol=ct,eve=et))))
print('PASS browser conversations: repeated replies, private legacy notes, explicit state, archived resurfacing, realtime, draft preservation, search and pagination')
