#!/usr/bin/env python3
"""Atomic combined triage, note handling, stale writes and rollback."""
import argparse
from integration import server,operator,account,path,query

def test(binary):
 with server(binary) as req:
  op=operator(req);a,at=account(req,op,'a@example.com');b,bt=account(req,op,'b@example.com');c,ct=account(req,op,'c@example.com')
  def publish(subject):return req('POST',path('notifications'),dict(subject=subject,body_markdown='Synthetic',kind='review_requested',ack_required=True,submission_key=subject,recipients=[b['id'],c['id']]),at)
  def row(n,t=bt):return query(req,f"SELECT * FROM notification_recipients WHERE notification='{n['id']}'",t)[0]
  def feedback(n):return query(req,f"SELECT * FROM notification_feedback WHERE notification='{n['id']}'",at)[0]
  def patch(table,r,action,t=bt,expected=200,**more):return req('PATCH',path(table)+'/'+r['id'],dict(expected_revision=r['revision'],action=action,**more),t,expected)
  n=publish('Combined acknowledgement');r=row(n)
  patch('notification_recipients',r,'acknowledge_archive',at,403)
  done=patch('notification_recipients',r,'acknowledge_archive',acknowledgement_markdown='Reviewed, thanks.')
  assert done['read_at']==done['acknowledged_at']==done['archived_at'] and done['read_at']
  assert done['revision']==r['revision']+1 and done['acknowledgement_markdown']=='Reviewed, thanks.'
  f=feedback(n);assert f['activity_version']==1
  patch('notification_recipients',r,'acknowledge_archive',expected=409,acknowledgement_markdown='Reviewed, thanks.')
  again=patch('notification_recipients',done,'acknowledge_archive',acknowledgement_markdown='Reviewed, thanks.');assert again['revision']==done['revision']
  assert feedback(n)['activity_version']==1
  patch('notification_recipients',done,'acknowledge_archive',expected=409,acknowledgement_markdown='Changed')
  fdone=patch('notification_feedback',f,'read_archive',at)
  assert fdone['read_at'] and fdone['archived_at'] and fdone['read_version']==1 and fdone['revision']==f['revision']+1
  patch('notification_recipients',row(n,ct),'acknowledge',ct,acknowledgement_markdown='Later comment')
  fresh=feedback(n);assert fresh['activity_version']==2 and not fresh['read_at'] and not fresh['archived_at']
  patch('notification_feedback',fdone,'read_archive',at,409)
  assert feedback(n)==fresh
  read=publish('Read and archive');before=row(read)
  after=patch('notification_recipients',before,'read_archive')
  assert after['read_at']==after['archived_at'] and after['read_at'] and not after['acknowledged_at']
  patch('notification_recipients',after,'read_archive',expected=400,acknowledgement_markdown='Not allowed')
  assert not query(req,f"SELECT * FROM notification_feedback WHERE notification='{read['id']}'",at)
  withdrawn=publish('Withdrawn');patch('notifications',withdrawn,'withdraw',at,withdrawal_reason='Test')
  patch('notification_recipients',row(withdrawn),'acknowledge_archive',expected=400)
  assert not row(withdrawn)['read_at'] and not row(withdrawn)['archived_at']
  for subject,action in [('Synthetic feedback failure','acknowledge_archive'),('Synthetic archive failure','read_archive')]:
   failed=publish(subject);initial=row(failed)
   patch('notification_recipients',initial,action,expected=400,**({'acknowledgement_markdown':'Rollback'} if action=='acknowledge_archive' else {}))
   assert row(failed)==initial
   assert not query(req,f"SELECT * FROM notification_feedback WHERE notification='{failed['id']}'",at)
   assert [e['event_type'] for e in query(req,f"SELECT * FROM notification_events WHERE notification='{failed['id']}'",at)]==['published']
 print('Combined actions: atomic state, notes, authorization, revisions, retries, later comments and event-failure rollback passed.')
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);test(ap.parse_args().binary)
