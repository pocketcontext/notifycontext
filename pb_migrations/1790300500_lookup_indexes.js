// Ordinary (non-partial) lookup indexes. Filtered-snapshot export policies and
// hook lookups query recipients and references by notification, and the Sent
// view orders a sender's notifications by date. The partial unique recipient
// indexes cannot serve those predicates and are not copied into SQL snapshots.
migrate(app=>{
  const add=(name,statements)=>{
    const c=app.findCollectionByNameOrId(name);
    for(const sql of statements){const index=sql.split(' ')[2];if(!c.indexes.some(v=>v.split(' ').includes(index)))c.indexes.push(sql);}
    app.save(c);
  };
  add('notification_recipients',['CREATE INDEX idx_recipient_by_notification ON notification_recipients (notification,recipient)']);
  add('notification_references',['CREATE INDEX idx_reference_by_notification ON notification_references (notification,created,id)']);
  add('notifications',['CREATE INDEX idx_notification_sent ON notifications (sender,created,id)']);
},app=>{
  const drop=(name,index)=>{const c=app.findCollectionByNameOrId(name);c.indexes=c.indexes.filter(v=>!v.split(' ').includes(index));app.save(c);};
  drop('notification_recipients','idx_recipient_by_notification');
  drop('notification_references','idx_reference_by_notification');
  drop('notifications','idx_notification_sent');
});
