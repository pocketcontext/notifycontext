#!/usr/bin/env python3
"""Synthetic shared conversation privacy, retries, races, migration and rollback."""
import argparse
import concurrent.futures
from integration import server,operator,account,path,query
from feedback import LEGACY_FIXTURE


def test(binary):
 with server(binary,fixture_migrations={'1790300550_legacy_feedback.js':LEGACY_FIXTURE}) as req:
    op=operator(req)
    def login(email):return req('POST','/api/collections/users/auth-with-password',{'identity':email,'password':'SyntheticUserPassword123!'})['token']
    historical=login('sender@example.com')
    assert not query(req,'SELECT * FROM notification_comments',historical)
    states=query(req,'SELECT * FROM notification_conversation_state',historical)
    assert len(states)==22 and sum(not s['archived_at'] for s in states)==19
    alice,at=account(req,op,'alice@example.com');bob,bt=account(req,op,'bob@example.com');carol,ct=account(req,op,'carol@example.com');eve,et=account(req,op,'eve@example.com')
    n=req('POST',path('notifications'),dict(subject='Conversation',body_markdown='Shared original',kind='review_requested',ack_required=True,submission_key='conversation',recipients=[bob['id'],carol['id']]),at)
    def sql(table,t):return query(req,f"SELECT * FROM {table} WHERE notification='{n['id']}' ORDER BY id",t)
    def state(t):return sql('notification_conversation_state',t)[0]
    def recipient(t):return sql('notification_recipients',t)[0]
    def post(t,key,body='Shared comment',expected=200):return req('POST',path('notification_comments'),dict(notification=n['id'],body_markdown=body,submission_key=key),t,expected)
    def triage(t,s,action,expected=200):return req('PATCH',path('notification_conversation_state')+'/'+s['id'],dict(expected_revision=s['revision'],action=action),t,expected)
    assert state(at)['archived_at'] and not state(bt)['read_at']
    before=state(bt);b=recipient(bt)
    req('PATCH',path('notification_recipients')+'/'+b['id'],dict(expected_revision=b['revision'],action='acknowledge',acknowledgement_markdown='Private legacy note'),bt)
    assert not sql('notification_comments',ct)
    assert all('Private legacy note' not in str(row) for row in sql('notification_recipients',ct))
    assert state(at)['latest_comment']=='' and not state(at)['read_at']
    author_before=state(bt)
    c=post(bt,'one')
    assert c['author']==bob['id'] and c['sequence']==1 and state(bt)==author_before
    assert len(sql('notification_comments',at))==len(sql('notification_comments',ct))==1
    assert not state(at)['read_at'] and not state(ct)['archived_at']
    assert state(at)['latest_comment']==c['id']
    assert not recipient(ct)['acknowledged_at']
    for table in ['notification_comments','notification_conversation_state']:
      assert not sql(table,et)
      req('GET',path(table),token=at,expected=403)
      req('DELETE',path(table)+'/'+(c['id'] if table=='notification_comments' else state(at)['id']),token=at,expected=(403,404))
    post(et,'forbidden',expected=403)
    triage(ct,state(at),'read',403)
    req('POST',path('notification_conversation_state'),{},at,expected=(400,403))
    req('PATCH',path('notification_comments')+'/'+c['id'],dict(body_markdown='Edited'),bt,expected=(403,404))
    for field,value in [('author',alice['id']),('sequence',99),('created','2030-01-01')]:
      req('POST',path('notification_comments'),dict(notification=n['id'],body_markdown='Spoof',submission_key='spoof',**{field:value}),bt,400)
    post(bt,'blank',' ',400);post(bt,'long','a'*4001,400)
    assert post(bt,'one')['id']==c['id'];post(bt,'one','Changed',409)
    s=triage(at,state(at),'read_archive');old_recipient=recipient(ct)
    post(bt,'two','Second comment')
    assert not state(at)['read_at'] and not state(at)['archived_at']
    for action in ['read','archive','read_archive','unarchive']:triage(at,s,action,409)
    req('PATCH',path('notification_recipients')+'/'+old_recipient['id'],dict(expected_revision=old_recipient['revision'],action='read'),ct,409)
    # Canonical triage maintains recipient state, acknowledgement stays separate.
    done=triage(ct,state(ct),'read_archive');assert done['read_at'] and done['archived_at']
    assert recipient(ct)['read_at'] and recipient(ct)['archived_at'] and not recipient(ct)['acknowledged_at']
    assert {'conversation_read','conversation_archive'}.issubset({e['event_type'] for e in sql('notification_events',ct)})
    old=recipient(ct);post(at,'sender-reply')
    req('PATCH',path('notification_recipients')+'/'+old['id'],dict(expected_revision=old['revision'],action='read'),ct,409)
    current=recipient(ct);req('PATCH',path('notification_recipients')+'/'+current['id'],dict(expected_revision=current['revision'],action='read'),ct)
    assert state(ct)['read_at']
    # Concurrent retries create one comment and one sequence; distinct posts stay contiguous.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
      retried=list(pool.map(lambda _:post(bt,'concurrent'),range(4)))
    assert len({x['id'] for x in retried})==1
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
      list(pool.map(lambda i:post(bt,'distinct-'+str(i)),range(4)))
    comments=query(req,f"SELECT * FROM notification_comments WHERE notification='{n['id']}' ORDER BY sequence",at)
    assert [r['sequence'] for r in comments]==list(range(1,len(comments)+1))
    assert len([e for e in sql('notification_events',at) if e['event_type']=='commented'])==len(comments)
    own=req('POST',path('notifications'),dict(subject='Sender also recipient',body_markdown='Synthetic',kind='fyi',submission_key='own',recipients=[alice['id'],bob['id']]),at)
    own_rows=query(req,f"SELECT * FROM notification_recipients WHERE notification='{own['id']}'",at)
    own_a=next(r for r in own_rows if r['recipient']==alice['id']);own_b=next(r for r in own_rows if r['recipient']==bob['id'])
    req('PATCH',path('notification_recipients')+'/'+own_b['id'],dict(expected_revision=own_b['revision'],action='acknowledge',acknowledgement_markdown='Private feedback'),bt)
    req('PATCH',path('notification_recipients')+'/'+own_a['id'],dict(expected_revision=own_a['revision'],action='read_archive'),at,409)
    fail_triage=req('POST',path('notifications'),dict(subject='Synthetic archive failure',body_markdown='Rollback triage',kind='fyi',submission_key='triage-failure',recipients=[bob['id']]),at)
    triage_state=query(req,f"SELECT * FROM notification_conversation_state WHERE notification='{fail_triage['id']}'",bt)[0]
    req('PATCH',path('notification_conversation_state')+'/'+triage_state['id'],dict(expected_revision=triage_state['revision'],action='read_archive'),bt,400)
    assert query(req,f"SELECT * FROM notification_conversation_state WHERE notification='{fail_triage['id']}'",bt)[0]==triage_state
    assert not query(req,f"SELECT * FROM notification_recipients WHERE notification='{fail_triage['id']}'",bt)[0]['read_at']
    assert len(query(req,f"SELECT * FROM notification_events WHERE notification='{fail_triage['id']}'",bt))==1
    failed=req('POST',path('notifications'),dict(subject='Synthetic comment failure',body_markdown='Rollback',kind='fyi',submission_key='failure',recipients=[bob['id']]),at)
    before_failure=query(req,f"SELECT * FROM notification_conversation_state WHERE notification='{failed['id']}'",bt)
    req('POST',path('notification_comments'),dict(notification=failed['id'],body_markdown='Rollback',submission_key='failure'),at,400)
    assert not query(req,f"SELECT * FROM notification_comments WHERE notification='{failed['id']}'",bt)
    assert query(req,f"SELECT * FROM notification_conversation_state WHERE notification='{failed['id']}'",bt)==before_failure
    req('PATCH',path('notifications')+'/'+n['id'],dict(expected_revision=n['revision'],action='withdraw',withdrawal_reason='Complete'),at)
    post(bt,'withdrawn',expected=400);assert post(bt,'one')['id']==c['id']
 print('PASS conversations: private legacy migration, participants, immutable posts, duplicate/concurrent retries, explicit triage, stale actions, withdrawal')

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);test(ap.parse_args().binary)
