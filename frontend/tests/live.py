#!/usr/bin/env python3
"""Run real browser against an isolated pinned NotifyContext server with synthetic records."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tests'))
from integration import server,operator,account,path,query
ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);args=ap.parse_args()
with server(args.binary, {'NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN':'example.com'}) as request:
    op=operator(request)
    alice,at=account(request,op,'alice@example.com');bob,bt=account(request,op,'bob@example.com')
    notification=request('POST',path('notifications'),dict(subject='Supplier renewal ready',body_markdown='## Review\nPlease review **the terms**.',kind='review_requested',ack_required=True,submission_key='browser-fixture',recipients=[bob['id']],references=[]),at)
    subprocess.run(['node',str(Path(__file__).with_suffix('.mjs'))],cwd=ROOT/'frontend',env=dict(os.environ,NOTIFYCONTEXT_TEST_URL=request.base_url,NOTIFYCONTEXT_TEST_ALICE=alice['id']),check=True)
    recipient=query(request,"SELECT * FROM notification_recipients WHERE notification='"+notification['id']+"'",bt)[0]
    assert recipient['read_at'] and recipient['acknowledged_at']
    assert recipient['acknowledgement_markdown']=='Received; reviewing this afternoon.'
    assert query(request,'SELECT * FROM user_status',bt)[0]['availability']=='in_a_meeting'
    assert query(request,'SELECT * FROM notification_preferences',bt)[0]['alerts_paused_until']
    addressed=query(request,"SELECT r.* FROM notification_recipients r JOIN notifications n ON n.id=r.notification WHERE n.subject='Email-addressed handoff'",bt)
    assert len(addressed)==2
    known=next(row for row in addressed if row['addressed_email']=='alice@example.com')
    pending=next(row for row in addressed if row['addressed_email']=='new.colleague@example.com')
    assert known['recipient']==alice['id'] and known['claimed_at'] and not known['claim_expires_at']
    assert not pending['recipient'] and not pending['claimed_at'] and pending['claim_expires_at']
print('Browser writes and immediate/pending email addressing verified through authenticated SQL.')
