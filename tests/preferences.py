#!/usr/bin/env python3
"""Private auto-advance preferences and populated upgrade using synthetic records."""
import argparse
from integration import server, operator, account, path, query


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True)
    args = parser.parse_args()
    # Run immediately before the new migration, using the previous preference schema.
    fixture = '''migrate(app=>{
      const user=new Record(app.findCollectionByNameOrId('users'));
      user.set('email','legacy@example.com');user.set('name','Legacy');user.set('verified',true);
      user.setPassword('SyntheticUserPassword123!');app.save(user);
      const preference=new Record(app.findCollectionByNameOrId('notification_preferences'));
      preference.set('user',user.id);preference.set('alerts_paused_until','2099-01-01T12:00:00Z');
      preference.set('revision',7);app.save(preference);
    },()=>{});'''
    with server(args.binary, fixture_migrations={'1790300750_preference_fixture.js': fixture}) as req:
        op = operator(req)
        _, owner = account(req, op, 'owner@example.com')
        _, other = account(req, op, 'other@example.com')
        legacy = req('POST', '/api/collections/users/auth-with-password',
                     {'identity': 'legacy@example.com', 'password': 'SyntheticUserPassword123!'})['token']
        old = query(req, 'SELECT * FROM notification_preferences', legacy)[0]
        assert old['auto_advance'] == 'stay' and old['revision'] == 7
        assert old['alerts_paused_until'].startswith('2099-01-01 12:00:00')
        assert not query(req, 'SELECT * FROM notification_preferences', owner)
        pref = req('POST', path('notification_preferences'), {'alerts_paused_until': ''}, owner)
        assert pref['auto_advance'] == 'stay' and pref['revision'] == 1
        assert not query(req, 'SELECT auto_advance FROM notification_preferences', other)
        route = path('notification_preferences') + '/' + pref['id']
        req('GET', route, token=other, expected=(403, 404))
        req('PATCH', route, {'expected_revision': 1, 'auto_advance': 'next'}, other, 403)
        req('PATCH', route, {'expected_revision': 1, 'auto_advance': 'next'}, expected=(401, 403, 404))
        for invalid in ('', 'older', 'NEXT', True, 1, [], {}, None):
            req('PATCH', route, {'expected_revision': pref['revision'], 'auto_advance': invalid}, owner, 400)
        assert query(req, 'SELECT revision,auto_advance FROM notification_preferences', owner) == [{'revision': 1, 'auto_advance': 'stay'}]
        for value in ('next', 'previous', 'list', 'stay'):
            before = pref
            pref = req('PATCH', route, {'expected_revision': pref['revision'], 'auto_advance': value}, owner)
            assert pref['auto_advance'] == value and pref['revision'] == before['revision'] + 1
            req('PATCH', route, {'expected_revision': before['revision'], 'auto_advance': 'next'}, owner, 409)
        pref = req('PATCH', route, {'expected_revision': pref['revision'], 'auto_advance': 'previous',
                                  'alerts_paused_until': '2099-01-01T12:00:00Z'}, owner)
        pref = req('PATCH', route, {'expected_revision': pref['revision'], 'auto_advance': 'next'}, owner)
        assert pref['alerts_paused_until'].startswith('2099-01-01 12:00:00')
        pref = req('PATCH', route, {'expected_revision': pref['revision'], 'alerts_paused_until': ''}, owner)
        assert pref['auto_advance'] == 'next' and not pref['alerts_paused_until']
        req('POST', path('notification_preferences'), {'auto_advance': 'next'}, owner, 409)
        req('POST', path('notification_preferences'), {'auto_advance': 'invalid'}, other, 400)
        chosen = req('POST', path('notification_preferences'), {'auto_advance': 'list'}, other)
        assert chosen['auto_advance'] == 'list'
        req('PATCH', route, {'expected_revision': pref['revision'], 'user': chosen['user'], 'auto_advance': 'stay'}, owner, 400)
        assert query(req, 'SELECT auto_advance FROM notification_preferences', owner) == [{'auto_advance': 'next'}]
        assert query(req, 'SELECT auto_advance FROM notification_preferences', other) == [{'auto_advance': 'list'}]
    print('Auto-advance preference defaults, populated migration, validation, revision and privacy checks passed')


if __name__ == '__main__':
    main()
