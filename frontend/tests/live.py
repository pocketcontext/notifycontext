#!/usr/bin/env python3
"""Run real browser against an isolated pinned NotifyContext server with synthetic records."""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import time
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tests'))
from integration import server,operator,account,path,query
ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);args=ap.parse_args()
node=lambda env:subprocess.run(['node',str(Path(__file__).with_suffix('.mjs'))],cwd=ROOT/'frontend',env=dict(os.environ,**env),check=True)
with server(args.binary, {'NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN':'example.com'}) as request:
    op=operator(request)
    alice,at=account(request,op,'alice@example.com');bob,bt=account(request,op,'bob@example.com')
    carol,ct=account(request,op,'carol@example.com');dave,dt=account(request,op,'dave@example.com')
    notification=request('POST',path('notifications'),dict(subject='Supplier renewal ready',body_markdown='## Review\nPlease review **the terms**.',kind='review_requested',ack_required=True,submission_key='browser-fixture',recipients=[bob['id'],carol['id']],references=[dict(kind='url',label='Renewal terms',url='https://example.com/terms',source_system='',external_id='')]),at)
    # Maximum-size multibyte fixture: 100 recipients whose 4000-unit acknowledgements exceed SQLite's
    # 1 MiB value limit as one JSON aggregate, so the detail must use its separate bounded reads.
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        crowd=list(pool.map(lambda i:account(request,op,f'crowd{i:03d}@example.com'),range(100)))
    subject='界'*200;body='😀'*9998+' éñd'
    large=request('POST',path('notifications'),dict(subject=subject,body_markdown=body,kind='fyi',ack_required=True,submission_key='browser-large',recipients=[user['id'] for user,_ in crowd],references=[]),at)
    def acknowledge(item):
        user,token=item
        row=query(request,f"SELECT id, revision FROM notification_recipients WHERE notification='{large['id']}'",token)
        assert len(row)==1,row
        request('PATCH',path('notification_recipients')+'/'+row[0]['id'],dict(expected_revision=row[0]['revision'],action='acknowledge',acknowledgement_markdown='界'*4000),token)
    with concurrent.futures.ThreadPoolExecutor(8) as pool:list(pool.map(acknowledge,crowd))
    node(dict(NOTIFYCONTEXT_TEST_URL=request.base_url,NOTIFYCONTEXT_TEST_ALICE=alice['id'],NOTIFYCONTEXT_TEST_FIXTURE=notification['id'],NOTIFYCONTEXT_TEST_LARGE=large['id'],NOTIFYCONTEXT_TEST_TOKENS=json.dumps(dict(alice=at,bob=bt,carol=ct,dave=dt))))
    recipient=query(request,"SELECT * FROM notification_recipients WHERE notification='"+notification['id']+"'",bt)[0]
    assert recipient['read_at'] and recipient['acknowledged_at'] and recipient['archived_at']
    assert recipient['acknowledgement_markdown']=='Received; reviewing this afternoon.'
    assert not query(request,"SELECT * FROM notification_recipients WHERE notification='"+notification['id']+"' AND recipient='"+carol['id']+"'",ct)[0]['read_at']
    assert query(request,'SELECT * FROM user_status',bt)[0]['availability']=='in_a_meeting'
    assert query(request,'SELECT * FROM notification_preferences',bt)[0]['alerts_paused_until']
    addressed=query(request,"SELECT r.* FROM notification_recipients r JOIN notifications n ON n.id=r.notification WHERE n.subject='Email-addressed handoff'",bt)
    assert len(addressed)==2
    known=next(row for row in addressed if row['addressed_email']=='alice@example.com')
    pending=next(row for row in addressed if row['addressed_email']=='new.colleague@example.com')
    assert known['recipient']==alice['id'] and known['claimed_at'] and not known['claim_expires_at']
    assert not pending['recipient'] and not pending['claimed_at'] and pending['claim_expires_at']
print('Browser writes and immediate/pending email addressing verified through authenticated SQL.')
# The deployment rate limits (60 SQL reads per 10 s per client IP) produce real 429s without Retry-After.
with server(args.binary, {'NOTIFYCONTEXT_RATE_LIMITS':'true'}) as request:
    op=operator(request)
    alice,at=account(request,op,'alice@example.com');bob,bt=account(request,op,'bob@example.com')
    notification=request('POST',path('notifications'),dict(subject='Supplier renewal ready',body_markdown='Rate-limit recovery fixture.',kind='fyi',ack_required=False,submission_key='limit-fixture',recipients=[bob['id']],references=[]),at)
    node(dict(NOTIFYCONTEXT_TEST_URL=request.base_url,NOTIFYCONTEXT_TEST_MODE='limit',NOTIFYCONTEXT_TEST_FIXTURE=notification['id'],NOTIFYCONTEXT_TEST_TOKENS=json.dumps(dict(bob=bt))))
    time.sleep(11)  # let the limiter window pass before verifying through SQL
    assert not query(request,"SELECT * FROM notification_recipients WHERE notification='"+notification['id']+"'",bt)[0]['read_at']
print('Real rate-limit cooldown and detail recovery verified without implicit reads.')
