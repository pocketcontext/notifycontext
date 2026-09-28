#!/usr/bin/env python3
"""Adversarial visibility and write-boundary checks with synthetic records."""
import argparse
import json
import urllib.request
from integration import server, operator, account, path, query

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);args=ap.parse_args()
    with server(args.binary) as req:
        op=operator(req)
        alice,at=account(req,op,'alice@example.com');bob,bt=account(req,op,'bob@example.com');eve,et=account(req,op,'eve@example.com');outsider,ot=account(req,op,'outsider@example.com')
        base=dict(subject='Private request',body_markdown='Synthetic confidential terms',kind='action_required',submission_key='private',recipients=[bob['id'],eve['id']])
        n=req('POST',path('notifications'),base,at)
        for sql in ['SELECT count(*) AS count FROM notifications','SELECT count(*) AS count FROM notifications n JOIN notification_recipients r ON n.id=r.notification','SELECT count(*) AS count FROM notification_events e LEFT JOIN notifications n ON n.id=e.notification']:
            assert query(req,sql,ot)[0]['count']==0
        recipients=query(req,'SELECT * FROM notification_recipients',bt)
        assert len(recipients)==1 and recipients[0]['recipient']==bob['id']
        r=recipients[0]
        req('PATCH',path('notification_recipients')+'/'+r['id'],dict(expected_revision=1,action='acknowledge',acknowledgement_markdown='Private acknowledgement'),bt)
        assert len(query(req,'SELECT * FROM notification_events',et))==1
        assert len(query(req,'SELECT * FROM notification_events',at))==2
        for sql in ['SELECT submission_payload FROM notifications','SELECT * FROM users','SELECT * FROM _superusers','SELECT * FROM sqlite_master','UPDATE notifications SET subject="changed"']:
            req('POST','/api/context/query',{'sql':sql},at,expected=(400,403))
        for token in [at,bt,ot]:
            req('GET',path('notifications')+'/'+n['id']+'?expand=sender',token=token,expected=(403,404))
            req('GET',path('notification_recipients')+'?expand=recipient,notification',token=token,expected=403)
        req('POST','/api/batch',{'requests':[{'method':'POST','url':path('notifications'),'body':dict(base,submission_key='batch')}]},at,expected=(400,403))
        assert not query(req,"SELECT id FROM notifications WHERE submission_key='batch'",at)
        for field,value in [('due_at','not-a-date'),('ack_required','true'),('subject',123),('recipients','all')]:
            req('POST',path('notifications'),dict(base,submission_key='malformed-'+field,**{field:value}),at,expected=400)
        for invalid_date in ['bad','2026-02-30T12:00:00Z','2026-10-01T12:00:00','2026-10-01T24:00:00Z']:
            req('POST',path('user_status'),{'availability':'busy','expires_at':invalid_date},at,expected=400)
        req('POST',path('notification_preferences'),{'alerts_paused_until':'bad'},at,expected=400)
        for table,body in [('notification_events',{}),('notification_references',{}),('notification_recipients',{})]:
            req('POST',path(table),body,op,expected=403)
        # Operator maintenance credentials cannot impersonate senders through domain hooks.
        req('POST',path('notifications'),dict(base,submission_key='operator'),op,expected=403)
        # Even addressed recipients cannot receive locked business rows via realtime.
        with urllib.request.urlopen(req.base_url+'/api/realtime',timeout=1) as stream:
            client_id=None
            while client_id is None:
                line=stream.readline().decode().strip()
                if line.startswith('data:'):
                    client_id=json.loads(line[5:])['clientId']
            # Consume the blank separator before observing subsequent events.
            assert stream.readline().strip()==b''
            req('POST','/api/realtime',{'clientId':client_id,'subscriptions':['notifications/*','notification_recipients/*','notification_events/*']},bt,expected=204)
            req('POST',path('notifications'),dict(base,submission_key='realtime-private'),at)
            try:
                line=stream.readline()
            except TimeoutError:
                pass
            else:
                raise AssertionError(('Business record leaked through realtime',line))
        req('PATCH',path('users')+'/'+bob['id'],{'disabled':True},op)
        req('POST','/api/context/query',{'sql':'SELECT * FROM notifications'},bt,expected=(401,403))
        req('PATCH',path('notification_recipients')+'/'+r['id'],{'expected_revision':2,'action':'archive'},bt,expected=(401,403))
        req('POST','/api/realtime',{'clientId':'synthetic','subscriptions':['notifications/*']},bt,expected=(400,401,403,404))
    print('NotifyContext adversarial SQL, REST, private events, coercion and revoked-session checks passed')

if __name__=='__main__':main()
