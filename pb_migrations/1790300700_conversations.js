migrate(app=>{
  const access="@request.auth.id != '' && @request.auth.collectionName = 'users' && @request.auth.disabled = false && @request.auth.verified = true";
  const rel=(name,table,required=true)=>({name,type:'relation',collectionId:app.findCollectionByNameOrId(table).id,maxSelect:1,required,cascadeDelete:false});
  const integer=(name,min=0)=>({name,type:'number',onlyInt:true,min,max:9007199254740991});
  const stamps=[{name:'created',type:'autodate',onCreate:true},{name:'updated',type:'autodate',onCreate:true,onUpdate:true}];
  app.save(new Collection({name:'notification_comments',type:'base',listRule:null,viewRule:null,createRule:access,updateRule:null,deleteRule:null,
    fields:[rel('notification','notifications'),rel('author','users'),{name:'body_markdown',type:'text',required:true,max:4000},{name:'submission_key',type:'text',required:true,max:200},integer('sequence',1),...stamps],
    indexes:['CREATE UNIQUE INDEX idx_comment_submission ON notification_comments (author,submission_key)','CREATE UNIQUE INDEX idx_comment_sequence ON notification_comments (notification,sequence)']}));
  app.save(new Collection({name:'notification_conversation_state',type:'base',listRule:null,viewRule:null,createRule:null,updateRule:access,deleteRule:null,
    fields:[rel('notification','notifications'),rel('user','users'),rel('latest_comment','notification_comments',false),integer('activity_version'),integer('read_version'),integer('revision',1),...['latest_at','read_at','archived_at'].map(name=>({name,type:'date'})),...stamps],
    indexes:['CREATE UNIQUE INDEX idx_conversation_user ON notification_conversation_state (notification,user)','CREATE INDEX idx_conversation_inbox ON notification_conversation_state (user,latest_at,id)']}));
  // Preserve legacy private notes and triage exactly; never convert a note into a shared comment.
  for(const n of app.findRecordsByFilter('notifications','id != ""','',0,0)){
    const recipients=app.findRecordsByFilter('notification_recipients','notification = {:n}','',0,0,{n:n.id});
    const feedback=app.findRecordsByFilter('notification_feedback','notification = {:n}','',1,0,{n:n.id})[0];
    const members={[n.getString('sender')]:null};
    for(const r of recipients)if(r.getString('recipient'))members[r.getString('recipient')]=r;
    for(const user of Object.keys(members)){
      const source=user===n.getString('sender')&&feedback?feedback:members[user];
      const s=new Record(app.findCollectionByNameOrId('notification_conversation_state'));
      s.set('notification',n.id);s.set('user',user);s.set('revision',1);
      s.set('latest_at',source&&source.collection().name==='notification_feedback'?source.getString('latest_at'):n.getString('created'));
      const version=source?(source.collection().name==='notification_feedback'?source.getInt('activity_version'):1):0;
      s.set('activity_version',version);s.set('read_version',source?(source.getString('read_at')?version:0):0);
      s.set('read_at',source?source.getString('read_at'):n.getString('created'));s.set('archived_at',source?source.getString('archived_at'):n.getString('created'));app.save(s);
    }
  }
},()=>{throw new Error('Restore a verified backup to roll back conversations');});
