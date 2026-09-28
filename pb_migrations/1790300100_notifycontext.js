migrate(app => {
  const access="@request.auth.id != '' && @request.auth.collectionName = 'users' && @request.auth.disabled = false && @request.auth.verified = true";
  const rel=(name,table,required=true)=>({name,type:'relation',collectionId:app.findCollectionByNameOrId(table).id,maxSelect:1,required,cascadeDelete:false});
  const text=(name,max,required=false)=>({name,type:'text',max,required});
  const date=name=>({name,type:'date'});
  const stamps=[{name:'created',type:'autodate',onCreate:true},{name:'updated',type:'autodate',onCreate:true,onUpdate:true}];
  const revision={name:'revision',type:'number',required:true,onlyInt:true,min:1,max:9007199254740991};
  const add=(name,fields,indexes=[],create=false,update=false)=>app.save(new Collection({name,type:'base',listRule:null,viewRule:null,createRule:create?access:null,updateRule:update?access:null,deleteRule:null,fields:fields.concat(stamps),indexes}));
  add('user_directory',[text('name',200,true)]);
  add('notifications',[rel('sender','users'),text('subject',200,true),text('body_markdown',20000,true),{name:'kind',type:'select',values:['fyi','review_requested','action_required'],maxSelect:1,required:true},{name:'ack_required',type:'bool'},date('due_at'),text('submission_key',200,true),{name:'submission_payload',type:'text',max:150000,hidden:true},date('withdrawn_at'),text('withdrawal_reason',2000),revision],['CREATE UNIQUE INDEX idx_notification_submission ON notifications (sender,submission_key)','CREATE INDEX idx_notification_created ON notifications (created,id)'],true,true);
  add('notification_recipients',[rel('notification','notifications'),rel('recipient','users'),date('read_at'),date('acknowledged_at'),date('archived_at'),text('acknowledgement_markdown',4000),revision],['CREATE UNIQUE INDEX idx_recipient_notification ON notification_recipients (notification,recipient)','CREATE INDEX idx_recipient_inbox ON notification_recipients (recipient,created,id)'],false,true);
  add('notification_references',[rel('notification','notifications'),{name:'kind',type:'select',values:['document','task','record','url'],maxSelect:1,required:true},text('label',200,true),text('url',2000,true),text('source_system',100),text('external_id',200)]);
  add('notification_events',[rel('notification','notifications'),rel('notification_recipient','notification_recipients',false),rel('actor','users'),text('event_type',50,true)]);
  add('user_status',[rel('user','users'),{name:'availability',type:'select',values:['available','busy','in_a_meeting','away','not_set'],required:true,maxSelect:1},text('message',200),date('expires_at'),revision],['CREATE UNIQUE INDEX idx_status_user ON user_status (user)'],true,true);
  add('notification_preferences',[rel('user','users'),date('alerts_paused_until'),revision],['CREATE UNIQUE INDEX idx_preferences_user ON notification_preferences (user)'],true,true);
},()=>{throw new Error('Restore a verified backup to roll back initial schema');});
