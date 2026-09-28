#!/usr/bin/env python3
"""Restore a populated synthetic PocketBase backup into isolated empty storage."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.request
import zipfile
from integration import ROOT, PASSWORD, server, operator, account, path, query


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);args=ap.parse_args()
    with tempfile.TemporaryDirectory(prefix='notifycontext-restore-') as tmp:
        restored=Path(tmp)/'restored';restored.mkdir()
        with server(args.binary) as r:
            op=operator(r);sender,st=account(r,op,'sender@example.test');recipient,rt=account(r,op,'recipient@example.test');outsider,ot=account(r,op,'outsider@example.test')
            n=r('POST',path('notifications'),{'subject':'Synthetic renewal','body_markdown':'## Please review\n**Supplier renewal**','kind':'review_requested','ack_required':True,'submission_key':'restore-fixture','recipients':[recipient['id']],'references':[{'kind':'document','label':'Terms','url':'https://example.test/terms','external_id':'revision-1'}]},st)
            rec=query(r,'SELECT * FROM notification_recipients',rt)[0]
            r('PATCH',path('notification_recipients')+'/'+rec['id'],{'action':'acknowledge','acknowledgement_markdown':'Received, review tomorrow.','expected_revision':1},rt)
            r('POST',path('user_status'),{'availability':'busy','message':'Reviewing'},rt)
            r('POST',path('notification_preferences'),{'alerts_paused_until':'2030-01-01T00:00:00Z'},rt)
            expected={t:query(r,'SELECT * FROM '+t+' ORDER BY id',rt) for t in ['notifications','notification_recipients','notification_references','notification_events','user_status','notification_preferences']}
            r('POST','/api/backups',{'name':'synthetic-recovery.zip'},op,expected=204)
            with zipfile.ZipFile(r.data_dir/'backups'/'synthetic-recovery.zip') as archive:
                for entry in archive.infolist():
                    dest=(restored/entry.filename).resolve()
                    assert dest.is_relative_to(restored.resolve())
                archive.extractall(restored)
        assert (restored/'data.db').is_file()
        with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
        base=f'http://127.0.0.1:{port}'
        def request(method,url,body=None,token=None):
            headers={'Content-Type':'application/json'}
            if token:headers['Authorization']=token
            req=urllib.request.Request(base+url,data=None if body is None else json.dumps(body).encode(),headers=headers,method=method)
            with urllib.request.urlopen(req,timeout=15) as response:return json.load(response)
        with open(Path(tmp)/'restore.log','w+') as log:
            proc=subprocess.Popen([str(Path(args.binary).resolve()),'serve','--dir',str(restored),'--http',f'127.0.0.1:{port}'],cwd=ROOT,stdout=log,stderr=log)
            try:
                for _ in range(150):
                    try:request('GET','/api/health');break
                    except OSError:
                        if proc.poll() is not None:log.seek(0);raise AssertionError(log.read())
                        time.sleep(.1)
                else:raise AssertionError('Restored server did not start')
                auth=request('POST','/api/collections/users/auth-with-password',{'identity':'recipient@example.test','password':PASSWORD})
                assert auth['record']['id']==recipient['id']
                for table,rows in expected.items():assert query(request,'SELECT * FROM '+table+' ORDER BY id',auth['token'])==rows,table
                other=request('POST','/api/collections/users/auth-with-password',{'identity':'outsider@example.test','password':PASSWORD})
                assert query(request,'SELECT * FROM notifications',other['token'])==[]
                assert query(request,'SELECT * FROM notification_preferences',other['token'])==[]
            finally:proc.terminate();proc.wait(timeout=20)
    print('PASS: populated backup restores identities, Markdown, acknowledgement, references, history, status/preferences and privacy')

if __name__=='__main__':main()
