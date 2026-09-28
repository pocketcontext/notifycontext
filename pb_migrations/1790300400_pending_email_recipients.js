migrate(app=>{
  const c=app.findCollectionByNameOrId('notification_recipients');
  c.fields.getByName('recipient').required=false;
  c.fields.add(new TextField({name:'addressed_email',max:254}));
  c.fields.add(new DateField({name:'claimed_at'}));
  c.fields.add(new DateField({name:'claim_expires_at'}));
  c.indexes=c.indexes.filter(v=>!v.includes('idx_recipient_notification'));
  c.indexes.push("CREATE UNIQUE INDEX idx_recipient_notification ON notification_recipients (notification,recipient) WHERE recipient != ''");
  c.indexes.push("CREATE UNIQUE INDEX idx_recipient_address ON notification_recipients (notification,addressed_email) WHERE addressed_email != ''");
  c.indexes.push("CREATE INDEX idx_pending_address ON notification_recipients (addressed_email,claim_expires_at) WHERE recipient = ''");
  app.save(c);
},()=>{throw new Error('Restore a verified backup; pending-recipient history cannot be destructively rolled back');});
