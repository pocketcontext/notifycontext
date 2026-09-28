#!/usr/bin/env python3
"""Synthetic pending-email publication, OAuth claims, migration and privacy checks."""
import argparse
import concurrent.futures
import json
import secrets
from integration import server, operator, account, path, query, PASSWORD
from oauth_integration import google_fixture, REDIRECT


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);args=ap.parse_args()
    with google_fixture() as (url,codes),server(args.binary,{'NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN':'example.com'}) as req:
        op=operator(req);alice,at=account(req,op,'alice@example.com');bob,bt=account(req,op,'bob@example.com');eve,et=account(req,op,'eve@example.com')
        provider={'name':'google','clientId':'synthetic','clientSecret':'synthetic','authURL':url+'/authorize','tokenURL':url+'/token','userInfoURL':url+'/userinfo'}
        req('PATCH','/api/collections/users',{'oauth2':{'enabled':True,'providers':[provider]}},op)
        def exchange(email,verified=True,hd='example.com',expected=200,subject=None):
            metadata=req('GET','/api/collections/users/auth-methods')['oauth2']['providers'][0];code=secrets.token_urlsafe(24)
            codes[code]={'challenge':metadata['codeChallenge'],'user':{'sub':subject or email.lower(),'email':email,'email_verified':verified,'hd':hd,'name':'Synthetic colleague'}}
            return req('POST','/api/collections/users/auth-with-oauth2',{'provider':'google','code':code,'redirectURL':REDIRECT,'codeVerifier':metadata['codeVerifier']},expected=expected)
        def payload(key,**extra):return dict(subject='Supplier review',body_markdown='**Synthetic** general work',kind='review_requested',submission_key=key,**extra)
        def publish(body,expected=200):return req('POST',path('notifications'),body,at,expected)
        def recipients(n,token=at):return query(req,"SELECT * FROM notification_recipients WHERE notification='"+n['id']+"'",token)
        mixed=payload('mixed',recipients=[bob['id']],recipient_emails=[' Future@Example.com ','future@example.com','BOB@example.com'])
        n=publish(mixed);rs=recipients(n);assert len(rs)==2
        pending=next(r for r in rs if not r['recipient']);linked=next(r for r in rs if r['recipient'])
        assert pending['addressed_email']=='future@example.com' and pending['claim_expires_at'] and not pending['claimed_at']
        assert linked['recipient']==bob['id'] and linked['claimed_at'] and not linked['claim_expires_at']
        assert publish(mixed)['id']==n['id']
        assert not query(req,'SELECT * FROM notification_recipients',et)
        assert len(recipients(n,bt))==1 and recipients(n,bt)[0]['addressed_email']=='bob@example.com'
        # No directory email expansion, REST bypass or pending mutation route.
        req('POST','/api/context/query',{'sql':'SELECT email FROM user_directory'},at,expected=(400,403))
        req('PATCH',path('notification_recipients')+'/'+pending['id'],{'expected_revision':1,'action':'read'},at,expected=403)
        for bad in ['outside@outside.com','a..b@example.com','x@example.com.attacker.test','x@EXAMPLE.COM\nInjected: value','@example.com','Name <a@example.com>']:
            publish(payload('invalid-'+secrets.token_hex(3),recipient_emails=[bad]),400)
        publish(payload('too-many',recipient_emails=['same@example.com']*101),400)
        for flag in ['disabled','verified']:
            u,t=account(req,op,flag+'@example.com');req('PATCH',path('users')+'/'+u['id'],{flag:flag=='disabled'},op)
            publish(payload('reject-'+flag,recipient_emails=[flag+'@example.com']),403)
        # Merely provisioning an account or password login must not claim pending history.
        future,ft=account(req,op,'future@example.com')
        assert not query(req,'SELECT * FROM notifications',ft)
        assert not next(r for r in recipients(n) if r['id']==pending['id'])['claimed_at']
        assert publish(mixed)['id']==n['id']  # Canonical payload survives identity creation.
        exchange('future@example.com',verified=False,expected=(400,403));assert not query(req,'SELECT * FROM notifications',ft)
        exchange('future@example.com',hd='outside.com',expected=(400,403));assert not query(req,'SELECT * FROM notifications',ft)
        auth=exchange('FUTURE@example.com');assert auth['record']['id']==future['id']
        claimed=recipients(n,auth['token'])[0]
        assert claimed['id']==pending['id'] and claimed['recipient']==future['id'] and claimed['claimed_at'] and not claimed['claim_expires_at'] and claimed['revision']==2
        assert publish(mixed)['id']==n['id']
        count=len(query(req,'SELECT * FROM notification_events',auth['token']));exchange('future@example.com');assert len(query(req,'SELECT * FROM notification_events',auth['token']))==count
        assert len(query(req,"SELECT * FROM notification_events WHERE event_type='claimed'",bt))==0
        assert not claimed['read_at'] and not claimed['acknowledged_at']
        ack=req('PATCH',path('notification_recipients')+'/'+claimed['id'],{'expected_revision':claimed['revision'],'action':'acknowledge','acknowledgement_markdown':'Received'},auth['token'])
        assert ack['acknowledged_at'] and ack['revision']==3
        # Multiple empty recipient relations must coexist under the partial indexes.
        pair=publish(payload('two-pending',recipient_emails=['first-pending@example.com','second-pending@example.com']))
        assert len(recipients(pair))==2 and all(not r['recipient'] for r in recipients(pair))
        first_auth=exchange('first-pending@example.com');assert len(recipients(pair,first_auth['token']))==1
        assert len(recipients(pair))==2 and sum(not r['recipient'] for r in recipients(pair))==1
        # Expired rows stay exactly as addressed and never become visible after valid OAuth.
        expired=publish(dict(payload('expired',recipient_emails=['expired@example.com']),subject='Synthetic expired recipient'))
        before_expired=recipients(expired)[0];expired_auth=exchange('expired@example.com')
        assert recipients(expired)[0]==before_expired
        assert not query(req,'SELECT * FROM notifications',expired_auth['token'])
        assert not query(req,"SELECT id FROM notification_events WHERE notification='"+expired['id']+"' AND event_type='claimed'",at)
        # Existing claims never move when operator changes an email and Google provisions its former address.
        req('PATCH',path('users')+'/'+future['id'],{'email':'renamed@example.com'},op)
        replacement=exchange('future@example.com',subject='replacement-identity')
        assert replacement['record']['id']!=future['id'] and not query(req,'SELECT * FROM notifications',replacement['token'])
        assert next(r for r in recipients(n) if r['id']==pending['id'])['recipient']==future['id']
        # New Google identity and pending linkage commit together, or both roll back on event failure.
        failing=publish(dict(payload('claim-failure',recipient_emails=['rollback@example.com']),subject='Synthetic claim failure'))
        exchange('rollback@example.com',expected=(400,403,500))
        assert req('GET',path('users')+'?filter=email%3D%22rollback%40example.com%22',token=op)['totalItems']==0
        assert not recipients(failing)[0]['recipient']
        # Existing-user claims across multiple notifications roll back together.
        normal=publish(payload('multi-normal',recipient_emails=['multirollback@example.com']))
        bad=publish(dict(payload('multi-failure',recipient_emails=['multirollback@example.com']),subject='Synthetic claim failure'))
        multi,mt=account(req,op,'multirollback@example.com')
        before_rows=recipients(normal)+recipients(bad)
        exchange('multirollback@example.com',expected=(400,403,500))
        assert recipients(normal)+recipients(bad)==before_rows
        assert not query(req,'SELECT * FROM notifications',mt)
        assert not query(req,"SELECT id FROM notification_events WHERE event_type='claimed' AND actor='"+multi['id']+"'",at)
        # Withdrawal prevents claim even when Google later verifies the exact address.
        withdrawn=publish(payload('withdrawn',recipient_emails=['withdrawn@example.com']))
        req('PATCH',path('notifications')+'/'+withdrawn['id'],{'expected_revision':1,'action':'withdraw','withdrawal_reason':'Superseded'},at)
        w=exchange('withdrawn@example.com');assert not query(req,'SELECT * FROM notifications',w['token'])
        # Signup and publication serialize: every notification is linked exactly once whichever wins.
        race=publish(payload('race-first',recipient_emails=['race@example.com']))
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first=pool.submit(exchange,'race@example.com');second=pool.submit(publish,payload('race-second',recipient_emails=['race@example.com']))
            race_auth=first.result();race_second=second.result()
        assert len(recipients(race,race_auth['token']))==1 and len(recipients(race_second,race_auth['token']))==1
        assert all(r['recipient']==race_auth['record']['id'] for r in recipients(race)+recipients(race_second))
    migration_checks(args.binary)
    print('Pending-email recipients: mixed publication, privacy, trusted claims, rollback, races and migration passed')


def migration_checks(binary):
    # Synthetic pre-feature records inserted by a fixture migration before the additive migration.
    canonical=dict(subject='Legacy',body_markdown='Retained',kind='fyi',ack_required=False,due_at='',submission_key='legacy',recipients=['legacyuser00001'],references=[])
    fixture="""migrate(app=>{
const p=PAYLOAD;
const u=new Record(app.findCollectionByNameOrId('users'));u.id='legacyuser00001';u.set('name','Legacy');u.set('email','legacy@example.com');u.set('verified',true);u.setPassword('SyntheticUserPassword123!');app.save(u);
const n=new Record(app.findCollectionByNameOrId('notifications'));n.id='legacynote00001';for(const k in p)if(!['recipients','references'].includes(k))n.set(k,p[k]);n.set('sender',u.id);n.set('revision',1);n.set('submission_payload',JSON.stringify(p));app.save(n);
const r=new Record(app.findCollectionByNameOrId('notification_recipients'));r.set('notification',n.id);r.set('recipient',u.id);r.set('revision',1);app.save(r);
},()=>{});""".replace('PAYLOAD',json.dumps(canonical,separators=(',',':')))
    with server(binary,{'NOTIFYCONTEXT_GOOGLE_WORKSPACE_DOMAIN':'example.com'},fixture_migrations={'1790300350_legacy_fixture.js':fixture}) as req:
        token=req('POST','/api/collections/users/auth-with-password',{'identity':'legacy@example.com','password':PASSWORD})['token']
        record=req('POST',path('notifications'),canonical,token)
        assert record['id']=='legacynote00001'
        row=query(req,'SELECT * FROM notification_recipients',token)[0]
        assert row['recipient']=='legacyuser00001' and not row['addressed_email'] and not row['claimed_at'] and not row['claim_expires_at']

if __name__=='__main__':main()
