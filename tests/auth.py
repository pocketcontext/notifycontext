#!/usr/bin/env python3
"""Synthetic identity, revocation, direct-signup and directory rollback checks."""
import argparse
from integration import server, operator, account, path, query, PASSWORD


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--binary',required=True);args=ap.parse_args()
    with server(args.binary) as r:
        op=operator(r)
        collections=r('GET','/api/collections',token=op)['items']
        assert {c['name'] for c in collections if c['type']=='auth'}=={'users','_superusers'}
        users=next(c for c in collections if c['name']=='users')
        assert users['id']=='_pb_users_auth_' and users['authToken']['duration']==604800
        signup={'name':'Synthetic colleague','email':'member@example.test','verified':True,'password':PASSWORD,'passwordConfirm':PASSWORD}
        r('POST',path('users'),signup,expected=(400,403))
        r('POST',path('users')+'?context=oauth2',signup,expected=(400,403))
        r('POST',path('users'),dict(signup,id='dirfailure00001'),op,expected=(400,500))
        r('GET',path('users')+'/dirfailure00001',token=op,expected=404)
        user,token=account(r,op,'member@example.test')
        credentials={'identity':'member@example.test','password':PASSWORD}
        user_path=path('users')+'/'+user['id']
        n=r('POST',path('notifications'),{'subject':'Retained handoff','body_markdown':'General operations','kind':'fyi','submission_key':'auth-fixture','recipients':[user['id']]},token)
        assert 'submission_payload' not in n
        assert query(r,'SELECT name FROM user_directory',token)==[{'name':'member'}]
        for field,value in [('disabled',True),('name','Changed'),('verified',False),('password','NewPassword123!')]:
            r('PATCH',user_path,{field:value},token,expected=(400,403,404))
        r('DELETE',user_path,token=op,expected=(400,403))
        def rejected(t):
            for method,payload,url in [('GET',None,'/api/context/schema'),('POST',{'sql':'SELECT * FROM notifications'},'/api/context/query'),('GET',None,path('notifications')),('POST',{},'/api/collections/users/auth-refresh'),('POST',{},'/api/files/token'),('POST',{'availability':'busy'},path('user_status'))]:
                r(method,url,payload,t,expected=(400,401,403,404))
            r('POST','/api/batch',{'requests':[{'method':'POST','url':path('user_status'),'body':{'availability':'busy'}}]},t,expected=(400,401,403))
        r('PATCH',user_path,{'disabled':True},op)
        rejected(token)
        r('POST','/api/collections/users/auth-with-password',credentials,expected=(400,401,403))
        r('PATCH',user_path,{'disabled':False},op)
        rejected(token)
        token=r('POST','/api/collections/users/auth-with-password',credentials)['token']
        assert query(r,'SELECT id, sender FROM notifications',token)==[{'id':n['id'],'sender':user['id']}]
        r('PATCH',user_path,{'verified':False},op)
        rejected(token)
        r('POST','/api/collections/users/auth-with-password',credentials,expected=(400,401,403))
        r('PATCH',user_path,{'verified':True},op)
        fresh=r('POST','/api/collections/users/auth-with-password',credentials)['token']
        assert r('POST','/api/collections/users/auth-refresh',{},fresh)['record']['id']==user['id']
    print('PASS: default users, blocked signup, directory rollback, immutable accounts, disabled/unverified sessions and retained attribution')

if __name__=='__main__':main()
