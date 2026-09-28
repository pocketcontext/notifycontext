import PocketBase, {BaseAuthStore} from 'pocketbase';
import {escapeHTML as e, sqlQuote as q, markdown, rows, statusLabel, kindLabel, effectiveStatus, alertDecision} from './core.js';
import './style.css';

// Keep credentials in memory; no auth tokens in localStorage, URLs or notification payloads.
const pb = new PocketBase(location.origin, new BaseAuthStore());
pb.autoCancellation(false);
pb.afterSend=(response,data)=>{if(response.status===401 && pb.authStore.record){pb.authStore.clear();login();report('Your session ended. Sign in again to continue.',true);}return data;};
const state = {view:'inbox', filter:'all', search:'', page:0, list:[], directory:[], statuses:[], preferences:null, latest:null, lastPoll:0, connected:false, selected:null};
const pageSize=30;
let sessionEpoch=0;
const parseDate=value=>new Date(String(value).replace(' ','T'));
window.addEventListener('online',()=>{if(pb.authStore.isValid)void poll();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && pb.authStore.isValid)void poll();});
let timer, searchTimer, pollBusy=false, listGeneration=0;
const $ = sel=>document.querySelector(sel);
const all = sel=>[...document.querySelectorAll(sel)];
const date = value=>value ? parseDate(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '';
const name = id=>state.directory.find(user=>user.id===id)?.name || 'Colleague';
const statusFor = id=>state.statuses.find(status=>status.user===id);
const statusDescription = id=>{const status=statusFor(id);return `${statusLabel(effectiveStatus(status))}${effectiveStatus(status)!=='not_set' && status?.message ? ` · ${status.message}`:''}`;};
function recipientState(recipient, notification) {
  if(notification.withdrawn_at)return 'Withdrawn';
  if(!recipient.recipient)return recipient.claim_expires_at && parseDate(recipient.claim_expires_at)<=new Date()?'Expired':'Awaiting first sign-in';
  return recipient.acknowledged_at?'✓ Acknowledged':recipient.read_at?'Read':'Unread';
}
function recipientSummary(recipient, notification) {
  const label=recipient.recipient_name || (recipient.recipient?name(recipient.recipient):recipient.addressed_email || 'Pending colleague');
  const pending=!recipient.recipient && !notification.withdrawn_at;
  return `<div><strong>${e(label)}</strong><span>${e(recipientState(recipient,notification))}</span>${recipient.recipient && recipient.addressed_email?`<small class="recipient-email">${e(recipient.addressed_email)}</small>`:''}${pending && recipient.claim_expires_at?`<small class="claim-deadline">${parseDate(recipient.claim_expires_at)<=new Date()?'Sign-in window ended':'Sign in by'} ${e(date(recipient.claim_expires_at))}</small>`:''}${recipient.acknowledgement_markdown?`<div class="markdown">${markdown(recipient.acknowledgement_markdown)}</div>`:''}</div>`;
}
function report(message, error=false) { const box=$('#notice'); if(box){box.textContent=message;box.className=`notice ${error?'error':''}`;box.hidden=false;} }
function friendly(error) { return error?.response?.message || error.message || 'Something went wrong. Please try again.'; }
async function query(sql) {
  let result;
  try {result=await pb.send('/api/context/query',{method:'POST',body:{sql}});}catch(error){if(error.status===403 && pb.authStore.record){pb.authStore.clear();login();report('Your access changed. Sign in again to continue.',true);}throw error;}
  if (!result.truncated) return rows(result);
  const match=sql.match(/LIMIT (\d+)(?: OFFSET (\d+))?$/);
  if(!match || Number(match[1])<=1)throw new Error('A result is too large. Narrow your search.');
  const total=Number(match[1]),offset=Number(match[2]||0),size=Math.max(1,Math.floor(total/2)),base=sql.slice(0,match.index),records=[];
  for(let i=0;i<total;i+=size){const count=Math.min(size,total-i),batch=await query(`${base}LIMIT ${count} OFFSET ${offset+i}`);records.push(...batch);if(batch.length<count)break;}
  return records;
}
async function pageAll(table, where='', order='id') {
  const result=[];
  for(let offset=0;;offset+=200){const batch=await query(`SELECT * FROM ${table} ${where} ORDER BY ${order} LIMIT 200 OFFSET ${offset}`);result.push(...batch);if(batch.length<200) return result;}
}
function login() {
  clearInterval(timer);clearTimeout(searchTimer);sessionEpoch++;listGeneration++;pollBusy=false;Object.assign(state,{view:'inbox',filter:'all',search:'',page:0,list:[],directory:[],statuses:[],preferences:null,latest:null,lastPoll:0,connected:false,selected:null,pendingAlerts:new Map()});
  $('#app').innerHTML=`<main class="login"><div class="brand"><span class="brand-mark">N</span> NotifyContext</div><section class="login-card"><p class="eyebrow">KEEP WORK MOVING</p><h1>A clear place for<br>your next handoff.</h1><p class="muted">Updates, requests and acknowledgements.<br>For every kind of work.</p><button class="primary wide" id="google">Continue with Google</button><p class="fine">Use your organization's Google Workspace account.</p><details><summary>Local test sign-in</summary><form id="login-form"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="secondary wide">Sign in</button></form></details><div id="notice" class="notice" role="status" hidden></div></section><p class="login-foot">Your attention, thoughtfully organized.</p></main>`;
  $('#google').onclick=async()=>{try {await pb.collection('users').authWithOAuth2({provider:'google'});await start();}catch(error){report(friendly(error),true);}};
  $('#login-form').onsubmit=async event=>{event.preventDefault(); const data=new FormData(event.target);try {await pb.collection('users').authWithPassword(data.get('email'),data.get('password'));await start();}catch(error){report(friendly(error),true);}};
}
async function start() {
  const epoch=sessionEpoch,current=pb.authStore.record;
  $('#app').innerHTML=`<div class="workspace"><aside class="sidebar"><a href="#" class="brand"><span class="brand-mark">N</span><span>NotifyContext</span></a><button id="compose" class="primary compose"><span aria-hidden="true">＋</span> New notification</button><nav aria-label="Notifications"><button class="nav active" data-view="inbox">Inbox <span id="unread-count" class="count">0</span></button><button class="nav" data-view="sent">Sent <span aria-hidden="true">↗</span></button><button class="nav" data-view="archived">Archived</button></nav><div class="sidebar-bottom"><p id="connection" class="connection">Connecting…</p><button id="settings" class="profile"><span class="avatar">${e((current.name||'U').slice(0,1))}</span><span><strong>${e(current.name || 'Your account')}</strong><small id="my-status">Not set</small></span><span aria-hidden="true">⌄</span></button><button id="signout" class="text-button">Sign out</button></div></aside><main class="main"><header class="page-header"><div><p class="eyebrow">YOUR WORK, IN FOCUS</p><h1 id="view-title">Inbox</h1><p class="muted" id="view-description">Updates to read. Requests to move forward.</p></div><button id="alerts" class="secondary">Enable desktop alerts</button></header><div id="notice" class="notice" role="status" hidden></div><section class="toolbar" aria-label="Filter notifications"><label class="search"><span class="sr-only">Search notifications</span><input id="search" type="search" placeholder="Search subjects and messages"></label><label><span class="sr-only">Filter</span><select id="filter"><option value="all">All notifications</option><option value="unread">Unread</option><option value="awaiting">Awaiting acknowledgement</option><option value="overdue">Past response deadline</option></select></label><button id="refresh" class="icon-button" aria-label="Refresh notifications">↻</button></section><div class="content-grid"><section class="list-panel" aria-label="Notification list"><div id="list" aria-live="polite"></div><div class="pagination"><button class="text-button" id="previous">← Previous</button><span id="page-label"></span><button class="text-button" id="next">Next →</button></div></section><section id="detail" class="detail-panel" aria-label="Notification detail"><div class="empty detail-empty"><span class="empty-icon">↗</span><h2>A little context goes a long way.</h2><p>Select a notification to read the full message<br>and decide what happens next.</p></div></section></div></main></div><dialog id="dialog"></dialog>`;
  $('#compose').onclick=compose;
  $('#settings').onclick=settings;
  $('#signout').onclick=()=>{pb.authStore.clear();Object.assign(state,{latest:null,selected:null,page:0,view:'inbox'});login();};
  all('[data-view]').forEach(button=>button.onclick=()=>{state.view=button.dataset.view;state.page=0;state.selected=null;all('[data-view]').forEach(b=>b.classList.toggle('active',b===button));$('#view-title').textContent=state.view==='sent'?'Sent':state.view==='archived'?'Archived':'Inbox';$('#view-description').textContent=state.view==='sent'?'Handoffs you’ve shared. Responses you’re waiting for.':state.view==='archived'?'Handled and saved for later.':'Updates to read. Requests to move forward.';$('#detail').classList.remove('open');void loadList().catch(error=>report(friendly(error),true));});
  $('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.search=$('#search').value;state.page=0;void loadList().catch(error=>report(friendly(error),true));},250);};
  $('#filter').onchange=()=>{state.filter=$('#filter').value;state.page=0;void loadList().catch(error=>report(friendly(error),true));};
  $('#previous').onclick=()=>{state.page=Math.max(0,state.page-1);void loadList().catch(error=>report(friendly(error),true));};
  $('#next').onclick=()=>{state.page++;void loadList().catch(error=>report(friendly(error),true));};
  $('#refresh').onclick=()=>poll(true);
  $('#alerts').onclick=enableAlerts;
  updateAlerts();
  try { await directory(); await poll(true); } catch(error){report(friendly(error),true);}
  if(epoch!==sessionEpoch)return;
  timer=setInterval(()=>poll(),15000);

}
async function directory() {
  const epoch=sessionEpoch;
  const directory=await pageAll('user_directory'),statuses=await pageAll('user_status'),preferences=await query('SELECT * FROM notification_preferences LIMIT 1');
  if(epoch!==sessionEpoch)return;
  state.directory=directory;state.statuses=statuses;state.preferences=preferences[0] || null;
  $('#my-status').textContent=statusDescription(pb.authStore.record.id);
}
function listSql() {
  const user=q(pb.authStore.record.id), archived=state.view==='archived';
  const join=state.view==='sent'?'':` JOIN notification_recipients r ON r.notification=n.id AND r.recipient=${user}`;
  const fields=state.view==='sent'?"NULL AS recipient_record, NULL AS read_at, NULL AS acknowledged_at, NULL AS archived_at, NULL AS recipient_revision":'r.id AS recipient_record, r.read_at, r.acknowledged_at, r.archived_at, r.revision AS recipient_revision';
  let where=state.view==='sent'?`n.sender=${user}`:archived?"r.archived_at != ''":"(r.archived_at = '' OR r.archived_at IS NULL)";
  if(state.filter==='unread') where+=state.view==='sent'?` AND EXISTS (SELECT 1 FROM notification_recipients ur WHERE ur.notification=n.id AND (ur.read_at='' OR ur.read_at IS NULL))`:" AND (r.read_at='' OR r.read_at IS NULL)";
  if(['awaiting','overdue'].includes(state.filter)) where+=` ${state.filter==='awaiting'?'AND n.ack_required=1':''} AND (n.withdrawn_at='' OR n.withdrawn_at IS NULL) AND ${state.view==='sent'?"EXISTS (SELECT 1 FROM notification_recipients ar WHERE ar.notification=n.id AND (ar.acknowledged_at='' OR ar.acknowledged_at IS NULL))":"(r.acknowledged_at='' OR r.acknowledged_at IS NULL)"}`;
  if(state.filter==='overdue') where+=` AND n.due_at != '' AND n.due_at < ${q(new Date().toISOString().replace('T',' '))}`;
  if(state.search) where+=` AND (instr(lower(n.subject),lower(${q(state.search)}))>0 OR instr(lower(n.body_markdown),lower(${q(state.search)}))>0)`;
  return `SELECT n.*, ${fields} FROM notifications n${join} WHERE ${where} ORDER BY n.created DESC, n.id DESC LIMIT ${pageSize+1} OFFSET ${state.page*pageSize}`;
}
async function loadList() {
  const generation=++listGeneration, epoch=sessionEpoch;
  const batch=await query(listSql());
  if(generation!==listGeneration || epoch!==sessionEpoch)return;
  state.list=batch.slice(0,pageSize);
  $('#previous').disabled=state.page===0;$('#next').disabled=batch.length<=pageSize;$('#page-label').textContent=`Page ${state.page+1}`;
  $('#list').innerHTML=state.list.length?state.list.map(item=>`<button class="notification-row ${!item.read_at && state.view!=='sent'?'unread':''} ${state.selected===item.id?'selected':''}" data-id="${e(item.id)}"><div class="row-top"><span class="sender">${e(name(item.sender))}</span><time>${e(date(item.created))}</time></div><h2>${e(item.subject)}</h2><p class="excerpt">${e(item.body_markdown.slice(0,140))}</p><div class="row-bottom"><span class="badge ${e(item.kind)}">${e(kindLabel(item.kind))}</span>${item.withdrawn_at?'<span class="state-label">Withdrawn</span>':item.acknowledged_at?'<span class="state-label">✓ Acknowledged</span>':item.ack_required?'<span class="state-label">Acknowledgement requested</span>':''}</div></button>`).join(''):`<div class="empty"><span class="empty-icon">✓</span><h2>${state.search || state.filter!=='all'?'No matching notifications':'You’re all caught up'}</h2><p>${state.search || state.filter!=='all'?'Try another search or filter.':'New updates and requests will appear here.'}</p></div>`;
  all('.notification-row').forEach(button=>button.onclick=()=>openDetail(button.dataset.id));
}
async function poll(manual=false) {
  if(pollBusy)return;
  if(!pb.authStore.isValid){if(pb.authStore.record){pb.authStore.clear();login();report('Your session expired. Sign in again to continue.',true);}return;}
  pollBusy=true;const epoch=sessionEpoch;
  try {
    const latest=(await query(`SELECT n.id, n.created FROM notifications n JOIN notification_recipients r ON r.notification=n.id WHERE r.recipient=${q(pb.authStore.record.id)} AND (n.withdrawn_at='' OR n.withdrawn_at IS NULL) ORDER BY n.created DESC, n.id DESC LIMIT 100`));
    const unread=await query(`SELECT count(*) AS total FROM notification_recipients WHERE recipient=${q(pb.authStore.record.id)} AND (read_at='' OR read_at IS NULL) AND (archived_at='' OR archived_at IS NULL)`);
    if(epoch!==sessionEpoch)return;
    await directory();
    if(epoch!==sessionEpoch)return;
    const incoming=state.latest===null?[]:latest.filter(item=>!state.latest.has(item.id) && parseDate(item.created).getTime()>=state.lastPoll-15000);
    const paused=state.preferences?.alerts_paused_until && parseDate(state.preferences.alerts_paused_until)>new Date();
    incoming.forEach(item=>state.pendingAlerts.set(item.id,item));
    const pending=[...state.pendingAlerts.values()];
    const decision=alertDecision({latest:pending,previous:state.latest,paused,permission:'Notification' in window?Notification.permission:'unsupported',missed:pending.length>incoming.length || (state.lastPoll && Date.now()-state.lastPoll>45000)});
    if(decision) await desktopAlert(decision,pending[0]?.id);
    if(!paused)state.pendingAlerts.clear();
    state.latest=new Set(latest.map(item=>item.id));state.lastPoll=Date.now();state.connected=true;
    $('#unread-count').textContent=unread[0]?.total || 0;
    $('#connection').textContent='● Connected · updates every 15 seconds';$('#connection').classList.remove('offline');
    updateAlerts();
    await loadList();
    if(manual) report('Inbox is up to date. Fetching does not mark notifications read.');
  } catch(error) {if(epoch!==sessionEpoch)return;state.connected=false;$('#connection').textContent='○ Connection interrupted · retrying';$('#connection').classList.add('offline');if(manual)report(friendly(error),true);}
  finally {if(epoch===sessionEpoch)pollBusy=false;}
}
async function desktopAlert(decision,id) {
  // The Web Locks API serializes localStorage dedup across authenticated tabs.
  if(!navigator.locks)return; // No unreliable fallback that could issue duplicate alerts.
  await navigator.locks.request('notifycontext-alert',async()=>{
    const key=`notifycontext-alert:${pb.authStore.record.id}`;
    try {const seen=JSON.parse(localStorage.getItem(key)||'{}');if(seen.id===id)return;localStorage.setItem(key,JSON.stringify({id,at:Date.now()}));}catch{return;}
    try {const alert=new Notification(decision.title,{body:decision.body,tag:'notifycontext-inbox'});alert.onclick=()=>{window.focus();if(id)void openDetail(id);alert.close();};}catch{report('Desktop alerts are unavailable here. Keep using the inbox.');}
  });
}
function updateAlerts() {
  if(!$('#alerts'))return;
  const permission='Notification' in window && navigator.locks?Notification.permission:'unsupported';
  $('#alerts').textContent=permission==='unsupported'?'Desktop alerts unavailable':permission==='denied'?'Alerts blocked · help':permission==='granted'?(state.preferences?.alerts_paused_until && parseDate(state.preferences.alerts_paused_until)>new Date()?'Desktop alerts paused':'Desktop alerts enabled'):'Enable desktop alerts';
}
async function enableAlerts() {
  if(!('Notification' in window) || !navigator.locks){report('This browser does not support desktop alerts. Your inbox remains available.');return;}
  if(Notification.permission==='denied'){report('Desktop alerts are blocked. Allow notifications in this site’s browser settings, then reload.');return;}
  if(Notification.permission==='granted'){report('Alerts require this app to stay open. Pause alerts from your profile settings.');return;}
  const permission=await Notification.requestPermission();updateAlerts();report(permission==='granted'?'Desktop alerts enabled. Keep this tab open to receive them.':'Desktop alerts were not enabled. Your inbox remains available.');
}
async function openDetail(id) {
  const epoch=sessionEpoch;
  state.selected=id;
  const panel=$('#detail');panel.classList.add('open');panel.innerHTML='<p class="loading">Loading notification…</p>';
  try {
    const [notification]=await query(`SELECT * FROM notifications WHERE id=${q(id)} LIMIT 1`);
    if(epoch!==sessionEpoch)return;
    if(!notification)throw new Error('This notification is no longer available.');
    const [recipients,references]=await Promise.all([query(`SELECT r.*, d.name AS recipient_name FROM notification_recipients r LEFT JOIN user_directory d ON d.id=r.recipient WHERE r.notification=${q(id)} ORDER BY r.created, r.id LIMIT 100`),query(`SELECT * FROM notification_references WHERE notification=${q(id)} ORDER BY created, id LIMIT 30`)]);
    if(state.selected!==id || epoch!==sessionEpoch)return;
    const mine=recipients.find(r=>r.recipient===pb.authStore.record.id),sender=notification.sender===pb.authStore.record.id;
    panel.innerHTML=`<button class="text-button mobile-back" id="back">← Back to inbox</button><div class="detail-meta"><span class="badge ${e(notification.kind)}">${e(kindLabel(notification.kind))}</span><time>${e(date(notification.created))}</time></div><h2 class="detail-title">${e(notification.subject)}</h2><div class="author"><span class="avatar">${e(name(notification.sender).slice(0,1))}</span><div><strong>${e(name(notification.sender))}</strong><small>${e(statusDescription(notification.sender))}</small></div></div>${notification.withdrawn_at?`<div class="notice error">Withdrawn: ${e(notification.withdrawal_reason)}</div>`:''}${notification.due_at?`<p class="deadline">Response requested by ${e(date(notification.due_at))}</p>`:''}<article class="markdown">${markdown(notification.body_markdown)}</article>${references.length?`<section class="references"><h3>Related context</h3>${references.map(ref=>`<a href="${e(/^https?:\/\//i.test(ref.url)?ref.url:'#')}" target="_blank" rel="noopener noreferrer">${e(ref.label || ref.url)} <span aria-hidden="true">↗</span></a>`).join('')}</section>`:''}${mine?`<section class="actions"><p class="muted">${mine.acknowledged_at?`Acknowledged ${e(date(mine.acknowledged_at))}`:notification.ack_required?'Your acknowledgement is requested.':'Acknowledge to let the sender know you received this.'}</p>${mine.acknowledgement_markdown?`<div class="markdown acknowledgement">${markdown(mine.acknowledgement_markdown)}</div>`:''}${!mine.acknowledged_at && !notification.withdrawn_at?'<label>Optional acknowledgement note<textarea id="ack-note" maxlength="4000" rows="2" placeholder="Received. I’ll review this tomorrow."></textarea></label><button class="primary" data-action="acknowledge">Acknowledge</button>':''}<div class="secondary-actions">${!mine.read_at?'<button class="secondary" data-action="read">Mark read</button>':''}<button class="secondary" data-action="${mine.archived_at?'unarchive':'archive'}">${mine.archived_at?'Move to inbox':'Archive'}</button></div><p class="fine">Acknowledgement confirms receipt, not completion of the work.</p></section>`:''}${sender?`<section class="recipient-status"><h3>Recipient status</h3>${recipients.map(r=>recipientSummary(r,notification)).join('')}${!notification.withdrawn_at?'<button class="text-button danger" id="withdraw">Withdraw notification</button>':''}</section>`:''}`;
    $('#back').onclick=()=>{panel.classList.remove('open');state.selected=null;};
    all('[data-action]').forEach(button=>button.onclick=async()=>{
      const action=button.dataset.action,note=$('#ack-note')?.value || '';
      const controls=all('.actions button, .actions textarea');
      controls.forEach(control=>{control.disabled=true;});
      try {
        await pb.collection('notification_recipients').update(mine.id,{expected_revision:mine.revision,action,...(action==='acknowledge'?{acknowledgement_markdown:note}:{})});
        if(epoch!==sessionEpoch)return;
        if(state.selected===id){await openDetail(id);if(action!=='acknowledge' && state.selected===id && $('#ack-note'))$('#ack-note').value=note;}
        await poll();
      }catch(error){report(friendly(error),true);controls.forEach(control=>{control.disabled=false;});}
    });
    if($('#withdraw'))$('#withdraw').onclick=()=>withdraw(notification);
    all('.notification-row').forEach(button=>button.classList.toggle('selected',button.dataset.id===id));
  }catch(error){if(epoch!==sessionEpoch)return;panel.innerHTML=`<button class="text-button" id="error-back">← Back to inbox</button><div class="empty"><p>${e(friendly(error))}</p></div>`;$('#error-back').onclick=()=>{panel.classList.remove('open');state.selected=null;};}
}
function dialog(content,setup) {
  const modal=$('#dialog');modal.innerHTML=`<button class="dialog-close icon-button" aria-label="Close dialog">×</button>${content}`;$('.dialog-close').onclick=()=>modal.close();modal.showModal();setup?.(modal);
}
function compose() {
  const key=crypto.randomUUID();
  dialog(`<p class="eyebrow">SHARE WHAT MATTERS</p><h2>New notification</h2><form id="compose-form"><label>To<select name="recipients" aria-label="To" multiple size="4">${state.directory.map(user=>`<option value="${e(user.id)}">${e(user.name || 'Colleague')} · ${e(statusDescription(user.id))}</option>`).join('')}</select><small>Choose colleagues here, enter emails below, or combine both. Use Ctrl / ⌘ for multiple selections.</small></label><label>Recipient emails<input name="recipient_emails" aria-label="Recipient emails" type="email" multiple maxlength="26000" placeholder="colleague@example.com, teammate@example.com"><small>Separate email addresses with commas.</small></label><p class="fine">Existing accounts receive the notification immediately. New colleagues can claim it by signing in within 30 days. <strong>No invitation email is sent.</strong></p><label>Subject<input name="subject" maxlength="200" required placeholder="What should they know?"></label><div class="form-grid"><label>Type<select name="kind"><option value="fyi">FYI</option><option value="review_requested">Review requested</option><option value="action_required">Action required</option></select></label><label>Response deadline <span class="optional">optional</span><input type="datetime-local" name="due_at"></label></div><label>Message <span class="optional">Markdown supported</span><textarea name="body_markdown" id="body" maxlength="20000" rows="7" required placeholder="Add the context and a clear next step…"></textarea></label><details><summary>Preview Markdown</summary><div id="preview" class="markdown"></div></details><div class="form-grid"><label>Reference label <span class="optional">optional</span><input name="reference_label" maxlength="200" placeholder="Supporting document"></label><label>Reference URL <span class="optional">optional</span><input name="reference_url" type="url" placeholder="https://…"></label></div><label class="checkbox"><input type="checkbox" name="ack_required"> Request acknowledgement</label><p class="fine">Recipients’ status does not block delivery. Deadlines do not schedule reminders.</p><p id="form-error" class="form-error" role="alert"></p><button class="primary" type="submit">Send notification</button></form>`,()=>{
    $('#body').oninput=()=>{$('#preview').innerHTML=markdown($('#body').value);};
    $('#compose-form').onsubmit=async event=>{event.preventDefault();const form=event.target,data=new FormData(form),button=form.querySelector('[type=submit]');button.disabled=true;try {
      const url=data.get('reference_url');if(url && !/^https?:\/\//i.test(url))throw new Error('Reference URLs must begin with https:// or http://.');
      const recipients=data.getAll('recipients'),recipientEmails=[...new Set(String(data.get('recipient_emails') || '').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))];
      if(!recipients.length && !recipientEmails.length)throw new Error('Choose a colleague or enter at least one recipient email.');
      if(recipients.length+recipientEmails.length>100)throw new Error('A notification can address at most 100 recipients.');
      const payload={subject:data.get('subject'),body_markdown:data.get('body_markdown'),kind:data.get('kind'),ack_required:data.has('ack_required'),due_at:data.get('due_at')?new Date(data.get('due_at')).toISOString():'',submission_key:key,recipients,recipient_emails:recipientEmails,references:url?[{kind:'url',label:data.get('reference_label')||url,url,source_system:'',external_id:''}]:[]};
      const created=await pb.collection('notifications').create(payload);$('#dialog').close();report('Notification saved. No invitation email was sent. Open recipient status to check delivery and acknowledgement.');await loadList();await openDetail(created.id);
    }catch(error){if($('#form-error'))$('#form-error').textContent=friendly(error);else report(friendly(error),true);}finally{button.disabled=false;}};
  });
}
function withdraw(notification) {
  dialog(`<h2>Withdraw notification</h2><p>The original message remains visible with your withdrawal reason.</p><form id="withdraw-form"><label>Reason<textarea name="reason" maxlength="2000" required rows="3"></textarea></label><p id="form-error" class="form-error" role="alert"></p><button class="primary" type="submit">Withdraw</button></form>`,()=>{$('#withdraw-form').onsubmit=async event=>{event.preventDefault();try{await pb.collection('notifications').update(notification.id,{action:'withdraw',expected_revision:notification.revision,withdrawal_reason:new FormData(event.target).get('reason')});$('#dialog').close();await openDetail(notification.id);await loadList();}catch(error){if($('#form-error'))$('#form-error').textContent=friendly(error);else report(friendly(error),true);}};});
}
function settings() {
  const current=statusFor(pb.authStore.record.id),availability=effectiveStatus(current);
  dialog(`<p class="eyebrow">YOUR AVAILABILITY</p><h2>Let colleagues know</h2><form id="status-form"><label>Status<select name="availability" aria-label="Status">${['not_set','available','busy','in_a_meeting','away'].map(value=>`<option value="${value}" ${availability===value?'selected':''}>${statusLabel(value)}</option>`).join('')}</select></label><label>Short message <span class="optional">optional</span><input name="message" value="${e(current?.message||'')}" maxlength="200" placeholder="Reviewing the quarterly plan"></label><label>Clear status after<select name="expiry" aria-label="Clear status after"><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="240">4 hours</option><option value="day">End of day</option></select></label><p class="fine">Availability is shared with colleagues. It does not block notifications.</p><button class="primary">Save status</button></form><hr><h3>Desktop alerts</h3><p class="muted">Pause alerts separately. New notifications still reach your inbox.</p><form id="pause-form"><label>Pause duration<select name="duration" aria-label="Pause duration"><option value="0">Resume alerts</option><option value="30">30 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option></select></label><button class="secondary">Save alert preference</button></form><p class="fine">${state.preferences?.alerts_paused_until && parseDate(state.preferences.alerts_paused_until)>new Date()?`Paused until ${e(date(state.preferences.alerts_paused_until))}`:'Alerts are not paused.'} This app must remain open for desktop alerts.</p><p id="form-error" class="form-error" role="alert"></p>`,()=>{
    $('#status-form').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target),until=data.get('expiry')==='day'?new Date(new Date().setHours(23,59,59,999)):new Date(Date.now()+Number(data.get('expiry'))*60000);try{const body={availability:data.get('availability'),message:data.get('message'),expires_at:data.get('availability')==='not_set'?'':until.toISOString()};if(current)await pb.collection('user_status').update(current.id,{...body,expected_revision:current.revision});else await pb.collection('user_status').create(body);await directory();$('#dialog').close();report('Availability updated.');}catch(error){if($('#form-error'))$('#form-error').textContent=friendly(error);else report(friendly(error),true);}};
    $('#pause-form').onsubmit=async event=>{event.preventDefault();const duration=Number(new FormData(event.target).get('duration'));try{const body={alerts_paused_until:duration?new Date(Date.now()+duration*60000).toISOString():''};if(state.preferences)await pb.collection('notification_preferences').update(state.preferences.id,{...body,expected_revision:state.preferences.revision});else await pb.collection('notification_preferences').create(body);await directory();updateAlerts();$('#dialog').close();report(duration?'Desktop alerts paused. Your inbox keeps receiving notifications.':'Desktop alerts resumed.');if(!duration)await poll();}catch(error){if($('#form-error'))$('#form-error').textContent=friendly(error);else report(friendly(error),true);}};
  });
}
login();
