onRealtimeSubscribeRequest(e => require(`${__hooks}/inbox_realtime.js`).subscribe(e));
// PocketBase defers after-success hooks until the outer transaction commits.
onRecordAfterCreateSuccess(e => require(`${__hooks}/inbox_realtime.js`).changed(e), 'notification_events');
