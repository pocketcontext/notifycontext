#!/usr/bin/env python3
"""Sender inbox migration, privacy, read/archive races and acknowledgement idempotency."""
import argparse
from integration import server,operator,account,path,query

# Runs before the feature migration: 19 historical comments, including one emoji, plus exclusions.
LEGACY_FIXTURE = r'''
migrate(app=>{
 const save=(table,values)=>{const r=new Record(app.findCollectionByNameOrId(table));for(const k in values)r.set(k,values[k]);app.save(r);return r;};
 const user=(email,name)=>{const r=new Record(app.findCollectionByNameOrId('users'));r.set('email',email);r.set('name',name);r.set('verified',true);r.setPassword('SyntheticUserPassword123!');app.save(r);return r;};
 const a=user('sender@example.com','Preview Sender'),b=user('reviewer@example.com','Preview Reviewer');
 const later=user('later@example.com','Later Reviewer');
 for(let i=0;i<22;i++){
   const n=save('notifications',{sender:a.id,subject:i===0?'PocketContext built-in tunnel (preview)':`Historical notification ${i+1}`,body_markdown:'Synthetic local preview. No real messages are sent.',kind:'fyi',submission_key:'legacy-'+i,revision:1});
   save('notification_recipients',{notification:n.id,recipient:i===21?a.id:b.id,revision:2,acknowledged_at:'2026-10-23 07:50:38.083Z',acknowledgement_markdown:i===0?'Amazing feature!':i===18?'🎉':i===19?'':i===20?'   ':'Thanks for the update.',read_at:'2026-10-23 07:50:38.083Z',archived_at:'2026-10-24 07:50:38.083Z'});
   if(i===0)save('notification_recipients',{notification:n.id,recipient:later.id,revision:1});
 }
},()=>{});
'''

def test(binary):
 with server(binary,fixture_migrations={'1790300550_legacy_feedback.js':LEGACY_FIXTURE}) as req:
    op=operator(req)
    def login(email):return req('POST','/api/collections/users/auth-with-password',{'identity':email,'password':'SyntheticUserPassword123!'})['token']
    at=login('sender@example.com');bt=login('reviewer@example.com')
    historical=query(req,'SELECT * FROM notification_feedback',at)
    assert len(historical)==19,len(historical)
    assert all(r['activity_version']==1 and r['read_version']==0 and not r['read_at'] and not r['archived_at'] for r in historical)
    assert not query(req,'SELECT * FROM notification_feedback',bt)
    assert all(r['read_at'] and r['archived_at'] for r in query(req,"SELECT * FROM notification_recipients WHERE acknowledged_at != ''",at))
    assert not query(req,'SELECT * FROM notification_events',at), 'Migration must not generate notifications/alerts'
    alice,at=account(req,op,'alice@example.com');bob,bt=account(req,op,'bob@example.com');carol,ct=account(req,op,'carol@example.com');eve,et=account(req,op,'eve@example.com')
    def publish(key,recipients=None):return req('POST',path('notifications'),dict(subject=key,body_markdown='Synthetic test',kind='fyi',submission_key=key,recipients=recipients or [bob['id'],carol['id']]),at)
    def recipient(n,t):return query(req,f"SELECT * FROM notification_recipients WHERE notification='{n['id']}'",t)[0]
    def ack(n,t,note):
      r=recipient(n,t)
      return req('PATCH',path('notification_recipients')+'/'+r['id'],dict(expected_revision=r['revision'],action='acknowledge',acknowledgement_markdown=note),t)
    def feedback(n):return query(req,f"SELECT * FROM notification_feedback WHERE notification='{n['id']}'",at)[0]
    def action(f,act,token=None,expected=200):return req('PATCH',path('notification_feedback')+'/'+f['id'],dict(expected_revision=f['revision'],action=act),token or at,expected)
    n=publish('Comments return to inbox');b=ack(n,bt,'Amazing feature!');f=feedback(n)
    assert not f['read_at'] and not f['archived_at'] and f['activity_version']==1
    # Repeated acknowledgement does not create a second activity or undo read/archive.
    read=action(f,'read');archived=action(read,'archive')
    assert read['read_version']==1 and read['read_at'] and archived['archived_at']
    ack(n,bt,'Amazing feature!');assert all(archived[k]==v for k,v in feedback(n).items())
    # Recipient state is independent; a read of details never consumes feedback.
    assert not recipient(n,bt)['read_at'] and not recipient(n,bt)['archived_at']
    assert all(archived[k]==v for k,v in feedback(n).items())
    for t in [bt,ct,et]:
      assert not query(req,'SELECT * FROM notification_feedback',t)
      action(archived,'read',t,403)
    req('POST',path('notification_feedback'),{},at,expected=(400,403))
    req('GET',path('notification_feedback'),token=at,expected=403)
    req('DELETE',path('notification_feedback')+'/'+f['id'],token=at,expected=(403,404))
    # A different recipient supplies the later reply; full conversations remain out of scope.
    c=ack(n,ct,'Another useful comment');fresh=feedback(n)
    assert fresh['activity_version']==2 and fresh['latest_recipient']==c['id'] and not fresh['read_at'] and not fresh['archived_at']
    for act in ['read','archive','unarchive']:action(archived,act,expected=409)
    assert feedback(n)==fresh
    moved=action(action(fresh,'archive'),'unarchive');assert not moved['archived_at'] and not moved['read_at']
    assert action(moved,'read')['read_version']==2
    blank=publish('Blank acknowledgement');ack(blank,bt,'  ')
    assert not query(req,f"SELECT * FROM notification_feedback WHERE notification='{blank['id']}'",at)
    own=publish('Own acknowledgement',[alice['id']]);ack(own,at,'Self note')
    assert not query(req,f"SELECT * FROM notification_feedback WHERE notification='{own['id']}'",at)
    failed=publish('Synthetic feedback failure');r=recipient(failed,bt)
    req('PATCH',path('notification_recipients')+'/'+r['id'],dict(expected_revision=r['revision'],action='acknowledge',acknowledgement_markdown='Roll back'),bt,400)
    assert not recipient(failed,bt)['acknowledged_at']
    assert not query(req,f"SELECT * FROM notification_feedback WHERE notification='{failed['id']}'",at)
    # Duplicate/comment editing remains forbidden.
    r=recipient(n,bt)
    req('PATCH',path('notification_recipients')+'/'+r['id'],dict(expected_revision=r['revision'],action='acknowledge',acknowledgement_markdown='Changed'),bt,409)
 print('Feedback: 19-row backfill, exclusions, privacy, idempotency, independent state and stale-action/new-comment behavior passed.')

if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);test(ap.parse_args().binary)
