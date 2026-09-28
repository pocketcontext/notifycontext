onRecordCreateRequest(e=>require(`${__hooks}/notify.js`).write(e),'notifications','user_status','notification_preferences');
onRecordUpdateRequest(e=>require(`${__hooks}/notify.js`).write(e),'notifications','notification_recipients','user_status','notification_preferences');
onRecordCreateRequest(()=>{throw new ForbiddenError('Server-managed collection');},'notification_recipients','notification_references','notification_events');
onRecordUpdateRequest(()=>{throw new ForbiddenError('Immutable server-managed collection');},'notification_references','notification_events');
onRecordDeleteRequest(()=>{throw new ForbiddenError('History is retained; withdraw or archive instead');},'notifications','notification_recipients','notification_references','notification_events','user_status','notification_preferences');
