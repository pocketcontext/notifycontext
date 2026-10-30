migrate(app => {
  const relation=(name,table)=>({name,type:'relation',collectionId:app.findCollectionByNameOrId(table).id,maxSelect:1,required:true,cascadeDelete:false});
  app.save(new Collection({name:'notification_feedback',type:'base',listRule:null,viewRule:null,createRule:null,
    updateRule:"@request.auth.id != '' && @request.auth.collectionName = 'users' && @request.auth.disabled = false && @request.auth.verified = true",deleteRule:null,
    fields:[relation('notification','notifications'),relation('user','users'),relation('latest_recipient','notification_recipients'),
      ...['activity_version','revision'].map(name=>({name,type:'number',required:true,onlyInt:true,min:1,max:9007199254740991})),
      {name:'read_version',type:'number',onlyInt:true,min:0,max:9007199254740991},
      ...['latest_at','read_at','archived_at'].map(name=>({name,type:'date'})),
      {name:'created',type:'autodate',onCreate:true},{name:'updated',type:'autodate',onCreate:true,onUpdate:true}],
    indexes:['CREATE UNIQUE INDEX idx_feedback_notification ON notification_feedback (notification)', 'CREATE INDEX idx_feedback_user ON notification_feedback (user,latest_at,id)']}));
  // Historical comments are unread; no events are emitted and original recipient state is untouched.
  for (const r of app.findRecordsByFilter('notification_recipients',"acknowledged_at != ''",'acknowledged_at,id',0,0)) {
    if(!r.getString('acknowledgement_markdown').trim())continue;
    const n=app.findRecordById('notifications',r.getString('notification'));
    if(r.getString('recipient')===n.getString('sender'))continue;
    const previous=app.findRecordsByFilter('notification_feedback','notification = {:id}','',1,0,{id:n.id})[0];
    const f=previous || new Record(app.findCollectionByNameOrId('notification_feedback'));
    f.set('notification',n.id);f.set('user',n.getString('sender'));f.set('latest_recipient',r.id);
    f.set('latest_at',r.getString('acknowledged_at'));f.set('activity_version',f.getInt('activity_version')+1);f.set('revision',1);app.save(f);
  }
},()=>{throw new Error('Restore a verified backup to roll back feedback inbox state');});
