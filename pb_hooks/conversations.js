function denied(){throw new ForbiddenError('This operation is not permitted');}
function invalid(message){throw new BadRequestError(message);}
function conflict(){throw new ApiError(409,'Revision or submission conflict',{});}
function rows(app,table,filter,params){return app.findRecordsByFilter(table,filter,'',0,0,params||{});}
function bump(app,r){const v=r.getInt('revision')+1;if(!Number.isSafeInteger(v))invalid('Revision exhausted');r.set('revision',v);app.save(r);return r;}
function state(app,n,user){return rows(app,'notification_conversation_state','notification = {:n} && user = {:u}',{n:n.id,u:user})[0];}
function ensure(app,n,user,recipient){
  let s=state(app,n,user);if(s)return s;
  s=new Record(app.findCollectionByNameOrId('notification_conversation_state'));
  s.set('notification',n.id);s.set('user',user);s.set('latest_at',n.getString('created'));s.set('revision',1);
  s.set('activity_version',recipient?1:0);s.set('read_version',recipient&&recipient.getString('read_at')?1:0);
  s.set('read_at',recipient?recipient.getString('read_at'):n.getString('created'));
  s.set('archived_at',recipient?recipient.getString('archived_at'):n.getString('created'));
  // A newly claimed addressed participant receives existing shared history, never private notes.
  if(recipient){const last=app.findRecordsByFilter('notification_comments','notification = {:n}','-sequence',1,0,{n:n.id})[0];if(last){s.set('latest_comment',last.id);s.set('latest_at',last.getString('created'));s.set('activity_version',last.getInt('sequence')+1);s.set('read_at','');s.set('archived_at','');}}
  app.save(s);return s;
}
function initialize(app,n){
  const recipients=rows(app,'notification_recipients','notification = {:n}',{n:n.id});
  for(const r of recipients)if(r.getString('recipient'))ensure(app,n,r.getString('recipient'),r);
  ensure(app,n,n.getString('sender'),null);
}
function incoming(app,s,latestAt,comment){
  const version=s.getInt('activity_version')+1;if(!Number.isSafeInteger(version))invalid('Conversation activity exhausted');
  s.set('activity_version',version);s.set('latest_at',latestAt);s.set('latest_comment',comment||'');s.set('read_at','');s.set('archived_at','');bump(app,s);
}
function privateFeedback(app,n,feedback){
  initialize(app,n);incoming(app,state(app,n,n.getString('sender')),feedback.getString('latest_at'),'');
  for(const r of rows(app,'notification_recipients','notification = {:n} && recipient = {:u}',{n:n.id,u:n.getString('sender')}))bump(app,r);
}
function applyAction(app,s,action){
  const now=new Date().toISOString();let changed=false;
  if(['read','read_archive','acknowledge_archive'].includes(action) && (!s.getString('read_at')||s.getInt('read_version')!==s.getInt('activity_version'))){s.set('read_version',s.getInt('activity_version'));s.set('read_at',now);changed=true;}
  if(['archive','read_archive','acknowledge_archive'].includes(action)&&!s.getString('archived_at')){s.set('archived_at',now);changed=true;}
  if(action==='unarchive'&&s.getString('archived_at')){s.set('archived_at','');changed=true;}
  if(changed)bump(app,s);return s;
}
function legacyAction(app,n,user,action,current=true){
  const s=state(app,n,user);if(!s)return;
  const changes=(['read','read_archive','acknowledge_archive'].includes(action)&&(!s.getString('read_at')||s.getInt('read_version')!==s.getInt('activity_version')))||(['archive','read_archive','acknowledge_archive'].includes(action)&&!s.getString('archived_at'))||(action==='unarchive'&&!!s.getString('archived_at'));
  if(changes&&!current)conflict();if(changes)applyAction(app,s,action);return changes;
}
function post(app,user,b){
  for(const k of Object.keys(b))if(!['notification','body_markdown','submission_key'].includes(k))invalid(k+' is not accepted');
  for(const [k,max] of [['notification',15],['body_markdown',4000],['submission_key',200]])if(typeof b[k]!=='string'||!b[k].trim()||b[k].length>max)invalid('Invalid '+k);
  let n;try{n=app.findRecordById('notifications',b.notification);}catch(_){throw new NotFoundError('Record not accessible');}
  const recipient=rows(app,'notification_recipients','notification = {:n} && recipient = {:u}',{n:n.id,u:user})[0];
  if(n.getString('sender')!==user&&!recipient)denied();
  const existing=rows(app,'notification_comments','author = {:u} && submission_key = {:key}',{u:user,key:b.submission_key})[0];
  if(existing){if(existing.getString('notification')!==n.id||existing.getString('body_markdown')!==b.body_markdown)conflict();return existing;}
  if(n.getString('withdrawn_at'))invalid('Cannot comment on a withdrawn notification');
  const last=app.findRecordsByFilter('notification_comments','notification = {:n}','-sequence',1,0,{n:n.id})[0],sequence=last?last.getInt('sequence')+1:1;
  if(!Number.isSafeInteger(sequence))invalid('Comment sequence exhausted');
  const c=new Record(app.findCollectionByNameOrId('notification_comments'));
  for(const k of ['notification','body_markdown','submission_key'])c.set(k,b[k]);c.set('author',user);c.set('sequence',sequence);app.save(c);
  initialize(app,n);
  for(const s of rows(app,'notification_conversation_state','notification = {:n}',{n:n.id})){
    if(s.getString('user')===user)continue;
    incoming(app,s,c.getString('created'),c.id);
    // Old clients must refresh their revision before a read/archive can consume a newer comment.
    for(const r of rows(app,'notification_recipients','notification = {:n} && recipient = {:u}',{n:n.id,u:s.getString('user')}))bump(app,r);
    for(const f of rows(app,'notification_feedback','notification = {:n} && user = {:u}',{n:n.id,u:s.getString('user')}))bump(app,f);
  }
  const event=new Record(app.findCollectionByNameOrId('notification_events'));event.set('notification',n.id);event.set('actor',user);event.set('event_type','commented');app.save(event);return c;
}
function update(app,user,s,b){
  for(const k of Object.keys(b))if(!['expected_revision','action'].includes(k))invalid(k+' is not accepted');
  if(s.getString('user')!==user)denied();
  if(b.expected_revision!==s.getInt('revision'))conflict();
  if(!['read','archive','unarchive','read_archive'].includes(b.action))invalid('Invalid conversation action');
  applyAction(app,s,b.action);
  // Maintain older clients' personal triage without touching acknowledgement or private note content.
  for(const table of ['notification_recipients','notification_feedback']){
    const owner=table==='notification_recipients'?'recipient':'user';
    for(const r of rows(app,table,'notification = {:n} && '+owner+' = {:u}',{n:s.getString('notification'),u:user})){
      let changed=false;const actions=[];
      if(['read','read_archive'].includes(b.action)&&!r.getString('read_at')){r.set('read_at',s.getString('read_at'));if(table==='notification_feedback')r.set('read_version',r.getInt('activity_version'));changed=true;actions.push('read');}
      if(['archive','read_archive'].includes(b.action)&&!r.getString('archived_at')){r.set('archived_at',s.getString('archived_at'));changed=true;actions.push('archive');}
      if(b.action==='unarchive'&&r.getString('archived_at')){r.set('archived_at','');changed=true;actions.push('unarchive');}
      if(changed)bump(app,r);
      if(table==='notification_recipients')for(const action of actions){const event=new Record(app.findCollectionByNameOrId('notification_events'));event.set('notification',s.getString('notification'));event.set('notification_recipient',r.id);event.set('actor',user);event.set('event_type','conversation_'+action);app.save(event);}
    }
  }
  return s;
}
module.exports={initialize,ensure,privateFeedback,legacyAction,post,update};
