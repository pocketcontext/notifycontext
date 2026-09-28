#!/usr/bin/env python3
"""Synthetic HTTP integration and authorization tests; no application data is reused."""
import argparse
import concurrent.futures
import contextlib
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PASSWORD = 'SyntheticUserPassword123!'

@contextlib.contextmanager
def server(binary, env=None):
    with tempfile.TemporaryDirectory(prefix='notifycontext-test-') as tmp:
        hooks=Path(tmp)/'pb_hooks'
        shutil.copytree(ROOT/'pb_hooks',hooks)
        (hooks/'zz_failure_fixture.pb.js').write_text('''
onRecordCreateExecute(e=>{if(e.record.getString('event_type')==='published' && e.app.findRecordById('notifications',e.record.getString('notification')).getString('subject')==='Synthetic audit failure')throw new Error('Synthetic audit failure');e.next();},'notification_events');
onRecordCreateExecute(e=>{if(e.record.id==='dirfailure00001')throw new Error('Synthetic directory failure');e.next();},'user_directory');
''')
        common=[str(Path(binary).resolve()),'--dir',str(Path(tmp)/'pb_data'),'--migrationsDir',str(ROOT/'pb_migrations'),'--hooksDir',str(hooks)]
        child_env=dict(os.environ)
        child_env.update(env or {})
        result=subprocess.run(common+['superuser','upsert','admin@example.com','SyntheticAdminPassword123!'],cwd=ROOT,capture_output=True,text=True,env=child_env)
        assert result.returncode==0,result.stdout+result.stderr
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        with open(Path(tmp)/'server.log','w+') as log:
            proc=subprocess.Popen(common+['serve','--http',f'127.0.0.1:{port}'],cwd=ROOT,stdout=log,stderr=log,env=child_env)
            def request(method,path,body=None,token=None,expected=200):
                headers={'Content-Type':'application/json'}
                if token:headers['Authorization']=token
                req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
                try:
                    with urllib.request.urlopen(req,timeout=25) as r:status,raw=r.status,r.read()
                except urllib.error.HTTPError as e:status,raw=e.code,e.read()
                assert status in (expected if isinstance(expected,tuple) else (expected,)),(method,path,status,raw.decode())
                return json.loads(raw) if raw else None
            try:
                for _ in range(150):
                    try:request('GET','/api/health');break
                    except (OSError,AssertionError):
                        if proc.poll() is not None:log.seek(0);raise AssertionError(log.read())
                        time.sleep(.1)
                else:log.seek(0);raise AssertionError('Startup timeout\n'+log.read())
                request.base_url=f'http://127.0.0.1:{port}'
                request.data_dir=Path(tmp)/'pb_data'
                yield request
            except Exception:
                log.seek(0)
                print(log.read()[-18000:])
                raise
            finally:
                proc.terminate();proc.wait(timeout=20)

def path(table):return '/api/collections/'+table+'/records'
def operator(request):return request('POST','/api/collections/_superusers/auth-with-password',{'identity':'admin@example.com','password':'SyntheticAdminPassword123!'})['token']
def account(request,op,email,**extra):
    user=request('POST',path('users'),dict(email=email,name=email.split('@')[0],verified=True,password=PASSWORD,passwordConfirm=PASSWORD,**extra),op)
    token=request('POST','/api/collections/users/auth-with-password',{'identity':email,'password':PASSWORD})['token']
    return user,token

def query(request,sql,token):
    result=request('POST','/api/context/query',{'sql':sql},token)
    return [dict(zip(result['columns'],row)) if isinstance(row,list) else row for row in result['rows']]

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);args=ap.parse_args()
    with server(args.binary) as req:
        op=operator(req)
        alice,at=account(req,op,'alice@example.com');bob,bt=account(req,op,'bob@example.com');eve,et=account(req,op,'eve@example.com')
        def create(table,body,token=at,expected=200):return req('POST',path(table),body,token,expected)
        def patch(table,r,body,token=at,expected=200):return req('PATCH',path(table)+'/'+r['id'],dict(expected_revision=r['revision'],**body),token,expected)
        def sql(q,token=at):return query(req,q,token)
        def publish(key,**extra):return dict(subject='Supplier renewal',body_markdown='## Review\nPlease review **the terms**.',kind='review_requested',ack_required=True,submission_key=key,recipients=[bob['id']],references=[dict(kind='document',label='Terms',url='https://example.com/terms',source_system='wiki',external_id='revision1')],**extra)
        payload=publish('one');n=create('notifications',payload)
        assert n['sender']==alice['id'] and n['revision']==1 and 'submission_payload' not in n
        assert create('notifications',payload)['id']==n['id']
        create('notifications',dict(payload,subject='Different'),expected=409)
        assert len(sql('SELECT * FROM notifications',bt))==1
        for table in ['notifications','notification_recipients','notification_references','notification_events']:
            assert not sql('SELECT * FROM '+table,et)
            req('GET',path(table),token=bt,expected=403)
        recipients=sql('SELECT * FROM notification_recipients',bt);r=recipients[0]
        assert not r['read_at'] and not r['acknowledged_at']
        patch('notification_recipients',r,{'action':'acknowledge'},et,403)
        patch('notifications',n,{'action':'withdraw','withdrawal_reason':'Wrong'},bt,403)
        read=patch('notification_recipients',r,{'action':'read'},bt)
        assert read['read_at'] and not read['acknowledged_at']
        assert patch('notification_recipients',r,{'action':'read'},bt)['revision']==read['revision']
        patch('notification_recipients',r,{'action':'archive'},bt,409)
        ack=patch('notification_recipients',read,{'action':'acknowledge','acknowledgement_markdown':'Received, thanks.'},bt)
        assert ack['acknowledged_at'] and ack['revision']==3
        assert patch('notification_recipients',read,{'action':'acknowledge','acknowledgement_markdown':'Received, thanks.'},bt)['revision']==3
        patch('notification_recipients',ack,{'action':'acknowledge','acknowledgement_markdown':'Changed'},bt,409)
        archived=patch('notification_recipients',ack,{'action':'archive'},bt)
        assert archived['archived_at'];assert not patch('notification_recipients',archived,{'action':'unarchive'},bt)['archived_at']
        withdrawn=patch('notifications',n,{'action':'withdraw','withdrawal_reason':'Superseded'})
        assert withdrawn['withdrawn_at'];assert patch('notifications',n,{'action':'withdraw','withdrawal_reason':'Superseded'})['revision']==2
        status=create('user_status',{'availability':'busy','message':'Reviewing invoices','expires_at':'2030-01-01T12:00:00Z'},bt)
        assert len(sql('SELECT * FROM user_status',et))==1
        patch('user_status',status,{'availability':'away'},at,403)
        status=patch('user_status',status,{'availability':'away'},bt)
        pref=create('notification_preferences',{'alerts_paused_until':'2030-01-01T12:00:00Z'},bt)
        assert not sql('SELECT * FROM notification_preferences',at)
        assert len(sql('SELECT * FROM notification_preferences',bt))==1
        patch('notification_preferences',pref,{'alerts_paused_until':''},bt)
        # Unknown managed fields, alternate REST paths, recipient validation and rollback.
        for field,value in [('sender',eve['id']),('id','spoofrecord0001'),('revision',99),('created','2030-01-01')]:
            create('notifications',dict(publish('spoof-'+field),**{field:value}),expected=400)
        for table in ['notification_events','notification_references','notification_recipients']:
            create(table,{},expected=(400,403))
        req('DELETE',path('notifications')+'/'+n['id'],token=at,expected=(403,404))
        create('notifications',dict(publish('bad-recipient'),recipients=[bob['id'],'missing00000001']),expected=404)
        create('notifications',dict(publish('bad-url'),references=[dict(kind='url',label='Bad',url='javascript:alert(1)')]),expected=400)
        create('notifications',dict(publish('rollback'),subject='Synthetic audit failure'),expected=400)
        assert not sql("SELECT id FROM notifications WHERE submission_key IN ('rollback','bad-recipient','bad-url')")
        # Recipient identities and private actions do not leak to fellow recipients.
        group=create('notifications',dict(publish('group'),recipients=[bob['id'],eve['id']]))
        gr=sql("SELECT * FROM notification_recipients WHERE notification='"+group['id']+"'",bt)[0]
        patch('notification_recipients',gr,{'action':'read'},bt)
        assert len(sql("SELECT * FROM notification_recipients WHERE notification='"+group['id']+"'",et))==1
        assert len(sql("SELECT * FROM notification_events WHERE notification='"+group['id']+"'",et))==1
        assert len(sql("SELECT * FROM notification_events WHERE notification='"+group['id']+"'",at))==2
        # Concurrent identical publishes yield a single result, and revisions serialize writes.
        concurrent_payload=publish('concurrent')
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:create('notifications',concurrent_payload),range(4)))
        assert len({v['id'] for v in results})==1
        assert len(sql('SELECT * FROM user_directory'))==3
    print('NotifyContext integration, privacy, idempotency and transactional rollback checks passed')

if __name__=='__main__':main()
