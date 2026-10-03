const prefix = 'notifycontext.inbox.';

function allowed(app, auth, topic) {
  if (!auth || auth.collection().name !== 'users' || topic !== prefix + auth.id) return false;
  const current = app.findRecordById('users', auth.id);
  return current.getBool('verified') && !current.getBool('disabled') && current.tokenKey() === auth.tokenKey();
}

function subscribe(e) {
  for (const topic of e.subscriptions) {
    if (topic.startsWith(prefix) && !allowed(e.app, e.auth, topic)) {
      throw new ForbiddenError('Inbox subscriptions require the matching active account.');
    }
  }
  e.client.set('notifycontextInboxToken', (e.requestInfo().headers.authorization || '').replace(/^Bearer\s+/i, ''));
  return e.next();
}

function delivery(e) {
  if (!allowed(e.app, e.client.get('auth'), e.message.name)) return false;
  try {
    const auth = e.app.findAuthRecordByToken(e.client.get('notifycontextInboxToken') || '', 'auth');
    return allowed(e.app, auth, e.message.name);
  } catch (_) { return false; }
}

function changed(e) {
  e.next();
  // Signals contain no record IDs, content, counts or recipient lists. The
  // browser re-reads its authorized SQL snapshot; delivery is best effort.
  try {
    const event = e.record;
    const notification = e.app.findRecordById('notifications', event.getString('notification'));
    const targets = {[notification.getString('sender')]: true};
    const recipientId = event.getString('notification_recipient');
    const recipients = recipientId
      ? [e.app.findRecordById('notification_recipients', recipientId)]
      : e.app.findRecordsByFilter('notification_recipients', 'notification = {:id}', '', 0, 0, {id: notification.id});
    for (const recipient of recipients) {
      const id = recipient.getString('recipient');
      if (id) targets[id] = true;
    }
    const clients = e.app.subscriptionsBroker().clients();
    for (const id of Object.keys(clients)) {
      const client = clients[id], auth = client.get('auth');
      if (!auth || !targets[auth.id]) continue;
      const topic = prefix + auth.id;
      if (client.hasSubscription(topic) && allowed(e.app, auth, topic)) {
        client.send(new SubscriptionMessage({name: topic, data: '{}'}));
      }
    }
  } catch (_) {
    // Never turn a committed publication into an apparent failed write.
    e.app.logger().warn('Inbox realtime signal failed; clients will recover by polling.');
  }
}

module.exports = {subscribe, changed, delivery};
