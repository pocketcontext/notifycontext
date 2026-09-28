function invalid(message){throw new BadRequestError(message);}
function denied(){throw new ForbiddenError('This operation is not permitted');}
function conflict(){throw new ApiError(409,'Revision or submission conflict',{});}
function rows(app,table,filter,params){return app.findRecordsByFilter(table,filter,'',0,0,params||{});}
function get(app,table,id){try{return app.findRecordById(table,id);}catch(_){throw new NotFoundError('Record not accessible');}}
function active(app,id){const u=get(app,'users',id);if(u.getBool('disabled')||!u.getBool('verified'))denied();}
function only(body,fields){for(const k of Object.keys(body))if(!fields.includes(k))invalid(k+' is not accepted');}
function str(value,name,max,required){if(value===undefined&&!required)return '';if(typeof value!=='string'||value.length>max||(required&&!value.trim()))invalid('Invalid '+name);return value;}
function date(value,name){
  if(value===undefined||value==='')return '';
  if(typeof value!=='string')invalid('Invalid '+name);
  const match=/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if(!match)invalid(name+' requires an ISO timestamp with timezone');
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  if(year<1000||month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||Number(match[4])>23||Number(match[5])>59||Number(match[6])>59)invalid('Invalid '+name);
  const normalized=value.replace(' ','T');if(!Number.isFinite(Date.parse(normalized)))invalid('Invalid '+name);
  return new Date(normalized).toISOString();
}
function record(app,table,values){const r=new Record(app.findCollectionByNameOrId(table));for(const k in values)r.set(k,values[k]);app.save(r);return r;}
function event(app,n,actor,type,recipient){record(app,'notification_events',{notification:n,notification_recipient:recipient||'',actor,event_type:type});}
function revision(body,r){if(!Number.isSafeInteger(body.expected_revision)||body.expected_revision<1)invalid('expected_revision must be a positive integer');if(body.expected_revision!==r.getInt('revision'))conflict();}
function bump(app,r){const n=r.getInt('revision')+1;if(!Number.isSafeInteger(n))invalid('Revision exhausted');r.set('revision',n);app.save(r);return r;}
function publish(app,id,b){
  only(b,['subject','body_markdown','kind','ack_required','due_at','submission_key','recipients','references']);
  const recipients=b.recipients;
  if(!Array.isArray(recipients)||!recipients.length||recipients.length>100||recipients.some(x=>typeof x!=='string'||!x))invalid('recipients must contain 1–100 user IDs');
  if(b.ack_required!==undefined&&typeof b.ack_required!=='boolean')invalid('ack_required must be boolean');
  if(!['fyi','review_requested','action_required'].includes(b.kind))invalid('Invalid kind');
  const refs=b.references===undefined?[]:b.references;
  if(!Array.isArray(refs)||refs.length>30)invalid('At most 30 references allowed');
  const payload={subject:str(b.subject,'subject',200,true),body_markdown:str(b.body_markdown,'body_markdown',20000,true),kind:b.kind,ack_required:b.ack_required||false,due_at:date(b.due_at,'due_at'),submission_key:str(b.submission_key,'submission_key',200,true),recipients:Array.from(new Set(recipients)).sort(),references:refs.map(ref=>{
    if(!ref||typeof ref!=='object'||Array.isArray(ref))invalid('Invalid reference');only(ref,['kind','label','url','source_system','external_id']);
    if(!['document','task','record','url'].includes(ref.kind))invalid('Invalid reference kind');
    const url=str(ref.url,'url',2000,true);if(!/^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/i.test(url)||/[\u0000-\u0020\u007f]/.test(url))invalid('Reference URL must be HTTP(S)');
    return {kind:ref.kind,label:str(ref.label,'label',200,true),url,source_system:str(ref.source_system,'source_system',100),external_id:str(ref.external_id,'external_id',200)};
  })};
  const canonical=JSON.stringify(payload),existing=rows(app,'notifications','sender = {:id} && submission_key = {:key}',{id,key:payload.submission_key})[0];
  if(existing){if(existing.getString('submission_payload')!==canonical)conflict();return existing;}
  for(const target of payload.recipients)active(app,target);
  const values={sender:id,revision:1,submission_payload:canonical};for(const k of ['subject','body_markdown','kind','ack_required','due_at','submission_key'])values[k]=payload[k];
  const n=record(app,'notifications',values);
  for(const target of payload.recipients)record(app,'notification_recipients',{notification:n.id,recipient:target,revision:1});
  for(const ref of payload.references)record(app,'notification_references',Object.assign({notification:n.id},ref));
  event(app,n.id,id,'published');return n;
}
function updateNotification(app,id,r,b){
  only(b,['expected_revision','action','withdrawal_reason']);if(r.getString('sender')!==id)denied();
  if(b.action!=='withdraw')invalid('Only withdrawal is allowed');const reason=str(b.withdrawal_reason,'withdrawal_reason',2000,true);
  if(r.getString('withdrawn_at')){if(r.getString('withdrawal_reason')!==reason)conflict();return r;}
  revision(b,r);r.set('withdrawn_at',new Date().toISOString());r.set('withdrawal_reason',reason);bump(app,r);event(app,r.id,id,'withdrawn');return r;
}
function updateRecipient(app,id,r,b){
  only(b,['expected_revision','action','acknowledgement_markdown']);if(r.getString('recipient')!==id)denied();
  const fields={read:'read_at',acknowledge:'acknowledged_at',archive:'archived_at',unarchive:'archived_at'},field=fields[b.action];if(!field)invalid('Invalid recipient action');
  const note=str(b.acknowledgement_markdown,'acknowledgement_markdown',4000);
  if(b.action!=='acknowledge'&&b.acknowledgement_markdown!==undefined)invalid('Note belongs to acknowledgement');
  const satisfied=b.action==='unarchive'?!r.getString(field):!!r.getString(field);
  if(satisfied){if(b.action==='acknowledge'&&r.getString('acknowledgement_markdown')!==note)conflict();return r;}
  revision(b,r);const n=get(app,'notifications',r.getString('notification'));
  if(b.action==='acknowledge'&&n.getString('withdrawn_at'))invalid('Cannot acknowledge a withdrawn notification');
  r.set(field,b.action==='unarchive'?'':new Date().toISOString());if(b.action==='acknowledge')r.set('acknowledgement_markdown',note);
  bump(app,r);event(app,n.id,id,b.action,r.id);return r;
}
function personal(app,id,table,r,b){
  const fresh=!r,fields=table==='user_status'?['availability','message','expires_at']:['alerts_paused_until'];only(b,fields.concat(fresh?[]:['expected_revision']));
  if(fresh){if(rows(app,table,'user = {:id}',{id}).length)conflict();r=new Record(app.findCollectionByNameOrId(table));r.set('user',id);r.set('revision',1);}else{if(r.getString('user')!==id)denied();revision(b,r);}
  if(table==='user_status'){
    if(fresh||b.availability!==undefined){if(!['available','busy','in_a_meeting','away','not_set'].includes(b.availability))invalid('Invalid availability');r.set('availability',b.availability);}
    if(b.message!==undefined)r.set('message',str(b.message,'message',200));
    if(b.expires_at!==undefined)r.set('expires_at',date(b.expires_at,'expires_at'));
  }else if(b.alerts_paused_until!==undefined)r.set('alerts_paused_until',date(b.alerts_paused_until,'alerts_paused_until'));
  if(fresh)app.save(r);else bump(app,r);return r;
}
// Rebind original JSON: PocketBase's loaded requestInfo body has already coerced
// record fields (including malformed dates/booleans), which cannot validate intent.
function rawBody(e){
  const shape={};for(const key of Object.keys(e.requestInfo().body))shape[key]=key==='ack_required'?false:key==='expected_revision'?-0:['recipients','references'].includes(key)?[]:'';
  const model=new DynamicModel(shape);try{e.bindBody(model);}catch(_){invalid('Invalid JSON field types');}
  return JSON.parse(JSON.stringify(model));
}
function write(e){
  const id=e.auth&&e.auth.collection().name==='users'?e.auth.id:'';if(!id)denied();
  const table=e.record.collection().name,fresh=e.record.isNew(),body=rawBody(e);let result;
  if(!body||typeof body!=='object'||Array.isArray(body))invalid('JSON object required');
  if(!fresh&&(!Number.isSafeInteger(body.expected_revision)||body.expected_revision<1))invalid('expected_revision must be a positive integer');
  e.app.runInTransaction(app=>{active(app,id);const r=fresh?null:get(app,table,e.record.id);
    if(table==='notifications')result=fresh?publish(app,id,body):updateNotification(app,id,r,body);
    else if(table==='notification_recipients')result=updateRecipient(app,id,r,body);
    else result=personal(app,id,table,r,body);
  });
  return e.json(200,result);
}
module.exports={write};
