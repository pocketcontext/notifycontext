onRealtimeSubscribeRequest(e => require(`${__hooks}/inbox_realtime.js`).subscribe(e));
// PocketBase defers after-success hooks until the outer transaction commits.
onRecordAfterCreateSuccess(e => require(`${__hooks}/inbox_realtime.js`).changed(e), 'notification_events');

// New comments already signal through their acknowledgement event. Personal triage signals only the sender.
onRecordAfterUpdateSuccess(e => {
  if(e.record.getInt('activity_version') !== e.record.original().getInt('activity_version'))return e.next();
  return require(`${__hooks}/inbox_realtime.js`).changed(e);
}, 'notification_feedback');
