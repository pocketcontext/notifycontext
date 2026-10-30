import {pb, signIn, refreshSession, sessionIdentity} from './auth.js';
import {escapeHTML as e, sqlQuote as q, markdown, rows, statusLabel, kindLabel, effectiveStatus, alertDecision} from './core.js';
import {updateTabIndicator} from './tab-indicator.js';
import './style.css';

const state = {view:'inbox', filter:'all', search:'', page:0, list:[], directory:[], statuses:[], directoryAt:0, preferences:null, latest:null, lastPoll:0, connected:false, selected:null};
let searchOpen=false;
const filterOptions=[['unread','Unread'],['awaiting','Awaiting acknowledgement'],['overdue','Past response deadline']];
function filterMenu(view){return `<div class="view-filters" data-for="${view}" hidden>${filterOptions.map(([value,label])=>`<button type="button" class="view-filter" data-filter="${value}">${label}</button>`).join('')}</div>`;}
const pageSize=30;
function routeState() {
  const [path,search='']=location.hash.replace(/^#\/?/,'').split('?'), params=new URLSearchParams(search);
  return {selected:/^notifications\/[a-z0-9]{15}$/.test(path)?path.split('/')[1]:null,view:['inbox','sent','archived'].includes(params.get('view'))?params.get('view'):'inbox',filter:['all','unread','awaiting','overdue'].includes(params.get('filter'))?params.get('filter'):'all',search:(params.get('q')||'').slice(0,500),page:Math.min(100000,Math.max(0,parseInt(params.get('page')||'0',10)||0))};
}
function routeHref(record=state.selected, clean=false) {
  const params=new URLSearchParams();
  if(!clean){params.set('view',state.view);if(state.search)params.set('q',state.search);if(state.filter!=='all')params.set('filter',state.filter);if(state.page)params.set('page',state.page);}
  return `#/${record?'notifications/'+record:''}${params.size?'?'+params:''}`;
}
function saveRoute(replace=false) { const href=routeHref(); if(location.hash!==href)history[replace?'replaceState':'pushState'](null,'',href); }
function paintRoute() {
  all('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===state.view));
  all('.view-filters').forEach(menu=>{menu.hidden=menu.dataset.for!==state.view;});
  all('.view-filter').forEach(button=>button.classList.toggle('active',button.dataset.filter===state.filter));
  const title=$('#view-title');if(title)title.textContent=state.view==='sent'?'Sent':state.view==='archived'?'Archived':'Inbox';
  const filter=$('#filter-label');if(filter)filter.textContent=filterOptions.find(([value])=>value===state.filter)?.[1] || 'All';
  const search=$('#search');if(search)search.value=state.search;
  if(state.search)searchOpen=true;
  syncSearchPanel();
}
function barHeight(){const bar=$('.app-bar');if(bar)document.documentElement.style.setProperty('--bar-height',`${bar.offsetHeight}px`);}
function syncSearchPanel(){
  const panel=$('#search-panel');
  if(panel)panel.hidden=false;
  barHeight();
}
function setMobileNav(open) {
  const nav=$('#notification-nav');
  if(!nav)return;
  if(open)barHeight();
  nav.classList.toggle('open',open);
  const backdrop=$('#nav-backdrop');
  if(backdrop)backdrop.hidden=!open;
  const toggle=$('#nav-toggle');
  if(!toggle)return;
  toggle.setAttribute('aria-expanded',String(open));
  toggle.setAttribute('aria-label',open?'Close notifications menu':'Open notifications menu');
}
function showList(){const panel=$('#detail');if(!panel)return;panel.classList.remove('open');panel.dataset.id='';panel.innerHTML='<p class="detail-placeholder">Select a notification.</p>';}
const listKey=()=>[state.view,state.filter,state.search,state.page].join('\n');
document.addEventListener('keydown',event=>{
  if(event.key!=='Escape' || event.target?.closest?.('dialog'))return;
  if($('#notification-nav')?.classList.contains('open'))setMobileNav(false);
},true);
window.matchMedia('(max-width:900px)').addEventListener('change',event=>{if(!event.matches)setMobileNav(false);syncSearchPanel();});
// Reload only what the route change affects; an already rendered detail is reused.
window.addEventListener('hashchange',()=>{if(!pb.authStore.isValid)return;const list=listKey(),selected=state.selected;Object.assign(state,routeState());paintRoute();if(listKey()!==list)void loadList();if(!state.selected)showList();else if(state.selected!==selected || $('#detail')?.dataset.id!==state.selected)void openDetail(state.selected);else $('#detail').classList.add('open');});

let sessionEpoch=0;
const parseDate=value=>new Date(String(value).replace(' ','T'));
window.addEventListener('online',()=>{if(pb.authStore.isValid)void requestRefresh();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && pb.authStore.isValid)void requestRefresh();});
// The /api/context/ rate limit counts every SQL request per client IP (60 per 10 s in deploy.js), so
// background triggers share one queue: one refresh in flight, at most one pending, automatic runs at
// least minRefresh apart. A 429 pauses every SQL read until the cooldown ends.
const minRefresh=2000, coalesceDelay=250, directoryMaxAge=300000, directoryUnknownAge=60000, backoffBase=2000, backoffMax=11000, retryAfterMax=60000;
let timer, searchTimer, refreshTimer, refreshAt=Infinity, refreshBusy=false, queued=null, lastRefresh=0, cooldownUntil=0, cooldownTimer, backoffStep=0, detailRetry=null, listGeneration=0, realtimeGeneration=0, realtimeStarted=false, realtimeToken='';
// urgent: user navigation, manual refresh or own write; skips coalescing and the minimum interval, never the cooldown.
function requestRefresh({manual=false,urgent=false,visible=false,epoch=sessionEpoch}={}) {
  if(epoch!==sessionEpoch)return Promise.resolve();
  queued??={waiters:[],manual:false,urgent:false,visible:false};
  queued.manual||=manual;queued.urgent||=urgent||manual;queued.visible||=visible||manual;
  const done=new Promise(resolve=>queued.waiters.push(resolve));
  if(manual && Date.now()<cooldownUntil)report(busyMessage(),false,true);
  planRefresh();return done;
}
function planRefresh() {
  if(!queued || refreshBusy)return;
  const now=Date.now(),at=Math.max(cooldownUntil,queued.urgent?now:Math.max(now+coalesceDelay,lastRefresh+minRefresh));
  if(at>=refreshAt)return;
  clearTimeout(refreshTimer);refreshAt=at;refreshTimer=setTimeout(runRefresh,at-now);
}
async function runRefresh() {
  refreshAt=Infinity;
  if(!queued || refreshBusy)return;
  if(Date.now()<cooldownUntil){planRefresh();return;}
  const job=queued,epoch=sessionEpoch;queued=null;refreshBusy=true;lastRefresh=Date.now();
  try {await poll(job.manual,job.visible);}
  finally {job.waiters.forEach(resolve=>resolve());if(epoch===sessionEpoch){refreshBusy=false;planRefresh();}}
}
const busyMessage=()=>`NotifyContext is busy. Retrying in ${Math.max(1,Math.ceil((cooldownUntil-Date.now())/1000))}s.`;
const busy=()=>{armRecovery();return Object.assign(new Error(busyMessage()),{busy:true});};
// Retry-After is delta-seconds or an HTTP date, capped at 60 s. Without it, back off 2, 4, 8, 11 s with 50–100% jitter:
// PocketBase's limiter refills its whole fixed window within about 10 s (whole seconds), and rejected requests cost nothing.
function enterCooldown(retryAfter) {
  const value=String(retryAfter??'').trim(),hinted=!value?NaN:/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-Date.now();
  const wait=Number.isFinite(hinted)?Math.min(retryAfterMax,Math.max(0,hinted))+Math.random()*500:Math.min(backoffMax,backoffBase*2**backoffStep)*(0.5+Math.random()/2);
  backoffStep=Math.min(backoffStep+1,10);cooldownUntil=Math.max(cooldownUntil,Date.now()+wait);
  clearTimeout(cooldownTimer);cooldownTimer=undefined;armRecovery();
}
function armRecovery() {
  if(cooldownTimer)return;
  const epoch=sessionEpoch;
  cooldownTimer=setTimeout(()=>{cooldownTimer=undefined;if(epoch!==sessionEpoch)return;if(Date.now()<cooldownUntil){armRecovery();return;}retryDetail(epoch);planRefresh();},Math.max(0,cooldownUntil-Date.now()));
}
// Re-open a detail that failed transiently, only for the same account and selection.
function retryDetail(epoch=sessionEpoch) {
  const retry=detailRetry;
  if(!retry || Date.now()<cooldownUntil)return;
  detailRetry=null;
  if(retry.epoch===epoch && epoch===sessionEpoch && state.selected===retry.id)void openDetail(retry.id);
}
async function subscribeInbox(epoch) {
  const generation=++realtimeGeneration;
  realtimeStarted=true;realtimeToken=pb.authStore.token;
  const refresh=()=>{if(generation===realtimeGeneration)void requestRefresh({epoch});};
  try {
    // Rebind the authenticated stream when this account renews its bearer token.
    await pb.realtime.unsubscribe();
    if(epoch!==sessionEpoch || generation!==realtimeGeneration)return;
    await Promise.all([
      pb.realtime.subscribe('PB_CONNECT',refresh),
      pb.realtime.subscribe(`notifycontext.inbox.${pb.authStore.record.id}`,refresh),
    ]);
    refresh();
  } catch { /* The periodic refresh remains available if realtime cannot connect. */ }
}
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
function report(message, error=false, busyNotice=false) { const box=$('#notice'); if(box){box.textContent=message;box.className=`notice ${error?'error':''}`;box.dataset.busy=busyNotice?'1':'';box.hidden=false;} }
function friendly(error) { if(error?.busy)return error.message; if(error?.status===429)return 'NotifyContext is busy. Wait a moment and try again.'; return error?.response?.message || error.message || 'Something went wrong. Please try again.'; }
// Every SQL read passes the cooldown; the per-call fetch exposes Retry-After without a shared hook.
async function send(sql) {
  if(Date.now()<cooldownUntil)throw busy();
  let retryAfter=null,result;
  try {result=await pb.send('/api/context/query',{method:'POST',body:{sql},fetch:(url,options)=>fetch(url,options).then(response=>{retryAfter=response.headers.get('Retry-After');return response;})});}
  catch(error){if(error?.status===429){enterCooldown(retryAfter);throw busy();}throw error;}
  backoffStep=0;
  return result;
}
// Aggregate JSON cells cannot be split by query(); null asks the caller for its separate bounded reads.
async function aggregate(sql) {
  try {const result=await send(sql);return result.truncated?null:rows(result);}
  catch(error){if(error?.status===400 && /too big/i.test(friendly(error)))return null;throw error;}
}
const pairs=keys=>keys.map(key=>`'${key}',${key}`).join(', ');
async function query(sql) {
  const result=await send(sql);
  if (!result.truncated) return rows(result);
  const match=sql.match(/LIMIT (\d+)(?: OFFSET (\d+))?$/);
  if(!match || Number(match[1])<=1)throw new Error('A result is too large. Narrow your search.');
  const total=Number(match[1]),offset=Number(match[2]||0),size=Math.max(1,Math.floor(total/2)),base=sql.slice(0,match.index),records=[];
  for(let i=0;i<total;i+=size){const count=Math.min(size,total-i),batch=await query(`${base}LIMIT ${count} OFFSET ${offset+i}`);records.push(...batch);if(batch.length<count)break;}
  return records;
}
function login() {
  // The cooldown deadline describes the server's per-IP limit, not the account, so it survives sign-out.
  clearInterval(timer);clearTimeout(searchTimer);clearTimeout(refreshTimer);clearTimeout(cooldownTimer);cooldownTimer=undefined;refreshAt=Infinity;sessionEpoch++;listGeneration++;refreshBusy=false;queued?.waiters.forEach(resolve=>resolve());queued=null;lastRefresh=0;detailRetry=null;realtimeStarted=false;realtimeGeneration++;updateTabIndicator(0);searchOpen=false;Object.assign(state,{view:'inbox',filter:'all',search:'',page:0,list:[],directory:[],statuses:[],directoryAt:0,preferences:null,latest:null,lastPoll:0,connected:false,selected:null,pendingAlerts:new Map()});
  $('#app').innerHTML=`<main class="login"><div class="brand"><span class="brand-mark">N</span> NotifyContext</div><section class="login-card"><p class="eyebrow">KEEP WORK MOVING</p><h1>A clear place for<br>your next handoff.</h1><p class="muted">Updates, requests and acknowledgements.<br>For every kind of work.</p><button class="primary wide" id="google">Continue with Google</button><p class="fine">Use your organization's Google Workspace account.</p><details><summary>Local test sign-in</summary><form id="login-form"><label>Email<input name="email" type="email" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="secondary wide">Sign in</button></form></details><div id="notice" class="notice" role="status" hidden></div></section><p class="login-foot">Your attention, thoughtfully organized.</p></main>`;
  $('#google').onclick=async()=>{try {await signIn(null,null,true);}catch(error){report(friendly(error),true);}};
  $('#login-form').onsubmit=async event=>{event.preventDefault(); const data=new FormData(event.target);try {await signIn(data.get('email'),data.get('password'));}catch(error){report(friendly(error),true);}};
}
async function start() {
  const epoch=sessionEpoch,current=pb.authStore.record;
  Object.assign(state,routeState());
  if(state.search)searchOpen=true;
  $('#app').innerHTML=`<div class="workspace"><aside class="sidebar"><a href="#" class="brand"><span class="brand-mark">N</span><span>NotifyContext</span></a><button id="compose" class="primary compose"><span aria-hidden="true">＋</span> New notification</button><button id="nav-backdrop" class="nav-backdrop" type="button" aria-label="Dismiss notifications menu" hidden></button><nav id="notification-nav" aria-label="Notifications"><a href="#" class="brand menu-brand"><span class="brand-mark">N</span><span>NotifyContext</span></a><button class="nav active" data-view="inbox">Inbox <span id="unread-count" class="count">0</span></button>${filterMenu('inbox')}<button class="nav" data-view="sent">Sent <span aria-hidden="true">↗</span></button>${filterMenu('sent')}<button class="nav" data-view="archived">Archived</button>${filterMenu('archived')}<div class="sidebar-bottom"><p id="connection" class="connection">Connecting…</p><button id="settings" class="profile"><span class="avatar">${e((current.name||'U').slice(0,1))}</span><span><strong>${e(current.name || 'Your account')}</strong><small id="my-status">Not set</small></span><span aria-hidden="true">⌄</span></button><button id="signout" class="text-button">Sign out</button><button id="alerts" class="secondary alerts-control">Enable desktop alerts</button></div></nav></aside><main class="main"><header class="app-bar"><button id="nav-toggle" class="nav-toggle" type="button" aria-expanded="false" aria-controls="notification-nav" aria-label="Open notifications menu"><span aria-hidden="true"></span></button><div id="search-panel" class="search-panel"><label class="search-field"><span class="sr-only">Search notifications</span><input id="search" type="search" placeholder="Search subjects and messages"></label><button id="copy-search" class="search-copy" type="button" aria-label="Copy search link" title="Copy search link"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5"></path><path d="M14 11a5 5 0 0 0-7.07 0L5.5 12.43a5 5 0 0 0 7.07 7.07L14 18"></path></svg></button></div><button id="refresh" class="icon-button" aria-label="Refresh notifications">↻</button><button id="compose-bar" class="primary compose bar-compose" type="button" aria-label="New notification"><span aria-hidden="true">＋</span></button></header><div class="context-bar" aria-label="Current list"><span id="view-title">Inbox</span><span id="filter-label">All</span></div><div id="notice" class="notice" role="status" hidden></div><div class="content-grid"><section class="list-panel" aria-label="Notification list"><div id="list" aria-live="polite"></div><div class="pagination" id="pagination" hidden><button class="text-button" id="previous">← Previous</button><span id="page-label"></span><button class="text-button" id="next">Next →</button></div></section><section id="detail" class="detail-panel" aria-label="Notification detail"><p class="detail-placeholder">Select a notification.</p></section></div></main></div><dialog id="dialog"></dialog>`;
  paintRoute();
    $('#copy-search').onclick=()=>void navigator.clipboard.writeText(new URL(routeHref(null),location.href).href).then(()=>report('Search link copied.')).catch(()=>report('Unable to copy link.',true));
  const openCompose=()=>{setMobileNav(false);compose();};
  $('#compose').onclick=openCompose;
  $('#compose-bar').onclick=openCompose;
  $('#settings').onclick=settings;
  $('#signout').onclick=()=>pb.authStore.clear();
  $('#nav-toggle').onclick=()=>setMobileNav(!$('#notification-nav').classList.contains('open'));
  $('#nav-backdrop').onclick=()=>setMobileNav(false);
  all('[data-view]').forEach(button=>button.onclick=()=>{state.view=button.dataset.view;state.filter='all';state.page=0;state.selected=null;paintRoute();showList();saveRoute();void loadList();});
  $('#search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.search=$('#search').value;state.page=0;saveRoute(true);void loadList();},250);};
  all('.view-filter').forEach(button=>button.onclick=()=>{state.filter=button.dataset.filter;state.page=0;paintRoute();saveRoute();setMobileNav(false);void loadList();});
  $('#previous').onclick=()=>{state.page=Math.max(0,state.page-1);saveRoute();void loadList();};
  $('#next').onclick=()=>{state.page++;saveRoute();void loadList();};
  $('#refresh').onclick=()=>void requestRefresh({manual:true});
  $('#alerts').onclick=enableAlerts;
  updateAlerts();
  try {
    await refreshSession(); if(epoch!==sessionEpoch)return;
    // Subscribe first, briefly, so the connection's own refresh signal joins the startup refresh.
    const live=subscribeInbox(epoch);await Promise.race([live,new Promise(resolve=>setTimeout(resolve,1000))]); if(epoch!==sessionEpoch)return;
    await requestRefresh({urgent:true,visible:true}); if(epoch!==sessionEpoch)return;
    if(state.selected)await openDetail(state.selected);
  } catch(error){report(friendly(error),true);}
  if(epoch!==sessionEpoch)return;
  timer=setInterval(()=>void requestRefresh(),60000);

}
// Names and statuses change rarely and expiry is evaluated locally, so they refresh every five minutes,
// after a minute when an unknown sender appears, and immediately after the user's own status change.
async function directory() {
  const epoch=sessionEpoch,records=[];
  for(let offset=0;;offset+=200){const batch=await query(`SELECT d.id, d.name, s.id AS status_id, s.availability, s.message, s.expires_at, s.revision AS status_revision FROM user_directory d LEFT JOIN user_status s ON s.user=d.id ORDER BY d.id LIMIT 200 OFFSET ${offset}`);records.push(...batch);if(batch.length<200)break;}
  if(epoch!==sessionEpoch)return;
  state.directory=records.map(({id,name})=>({id,name}));state.directoryAt=Date.now();
  state.statuses=records.filter(row=>row.status_id).map(row=>({id:row.status_id,user:row.id,availability:row.availability,message:row.message,expires_at:row.expires_at,revision:row.status_revision}));
  const mine=$('#my-status');if(mine)mine.textContent=statusDescription(pb.authStore.record.id);
}
const directoryDue=()=>{const age=Date.now()-state.directoryAt;return age>directoryMaxAge || (age>directoryUnknownAge && state.list.some(item=>!state.directory.some(user=>user.id===item.sender)));};
const visibleNote="(n.withdrawn_at='' OR n.withdrawn_at IS NULL)";
const listKeys=['id','sender','subject','excerpt','kind','ack_required','withdrawn_at','created','recipient_record','read_at','acknowledged_at','archived_at','recipient_revision','feedback_record','commenter'];
// Both inbox branches have one row per notification. A sender who also addressed themselves
// uses the feedback row once a colleague comments; their own recipient actions remain in detail.
function inboxRows() {
  const user=q(pb.authStore.record.id);
  return `SELECT n.id,n.sender,n.subject,substr(n.body_markdown,1,140) AS excerpt,n.kind,n.ack_required,n.withdrawn_at,n.created,n.due_at,n.body_markdown,
    r.id AS recipient_record,r.read_at,r.acknowledged_at,r.archived_at,r.revision AS recipient_revision,NULL AS feedback_record,NULL AS commenter
    FROM notifications n JOIN notification_recipients r ON r.notification=n.id AND r.recipient=${user}
    WHERE NOT EXISTS (SELECT 1 FROM notification_feedback f WHERE f.notification=n.id AND f.user=${user})
    UNION ALL SELECT n.id,n.sender,n.subject,substr(c.acknowledgement_markdown,1,140),n.kind,n.ack_required,n.withdrawn_at,f.latest_at,n.due_at,n.body_markdown,
    NULL,f.read_at,NULL,f.archived_at,f.revision,f.id,c.recipient
    FROM notification_feedback f JOIN notifications n ON n.id=f.notification JOIN notification_recipients c ON c.id=f.latest_recipient WHERE f.user=${user}`;
}
function listSql() {
  const user=q(pb.authStore.record.id), archived=state.view==='archived';
  if(state.view==='sent'){
    let where=`n.sender=${user}`;
    if(state.filter==='unread')where+=` AND EXISTS (SELECT 1 FROM notification_recipients ur WHERE ur.notification=n.id AND (ur.read_at='' OR ur.read_at IS NULL))`;
    if(['awaiting','overdue'].includes(state.filter))where+=` ${state.filter==='awaiting'?'AND n.ack_required=1':''} AND ${visibleNote} AND EXISTS (SELECT 1 FROM notification_recipients ar WHERE ar.notification=n.id AND ar.acknowledged_at='')`;
    if(state.filter==='overdue')where+=` AND n.due_at != '' AND n.due_at < ${q(new Date().toISOString().replace('T',' '))}`;
    if(state.search)where+=` AND (${searchSql()})`;
    return `SELECT n.id,n.sender,n.subject,substr(n.body_markdown,1,140) AS excerpt,n.kind,n.ack_required,n.withdrawn_at,n.created,NULL AS recipient_record,NULL AS read_at,NULL AS acknowledged_at,NULL AS archived_at,NULL AS recipient_revision,NULL AS feedback_record,NULL AS commenter FROM notifications n WHERE ${where} ORDER BY n.created DESC,n.id DESC LIMIT ${pageSize+1} OFFSET ${state.page*pageSize}`;
  }
  let where=archived?"r.archived_at != ''":"(r.archived_at = '' OR r.archived_at IS NULL)";
  // Withdrawn records remain available by direct link and in Sent, never in active inbox counts.
  if(!archived)where+=` AND ${visibleNote}`;
  if(state.filter==='unread')where+=" AND (r.read_at='' OR r.read_at IS NULL)";
  if(['awaiting','overdue'].includes(state.filter))where+=` AND r.feedback_record IS NULL ${state.filter==='awaiting'?'AND n.ack_required=1':''} AND ${visibleNote} AND (r.acknowledged_at='' OR r.acknowledged_at IS NULL)`;
  if(state.filter==='overdue')where+=` AND n.due_at != '' AND n.due_at < ${q(new Date().toISOString().replace('T',' '))}`;
  if(state.search)where+=` AND (${searchSql()})`;
  return `SELECT ${listKeys.map(k=>'r.'+k).join(',')} FROM (${inboxRows()}) r JOIN notifications n ON n.id=r.id WHERE ${where} ORDER BY r.created DESC,r.id DESC LIMIT ${pageSize+1} OFFSET ${state.page*pageSize}`;
}
function searchSql(){
  const term=q(state.search);
  return `n.id=${term} OR instr(lower(n.subject),lower(${term}))>0 OR instr(lower(n.body_markdown),lower(${term}))>0 OR EXISTS (SELECT 1 FROM notification_recipients sc WHERE sc.notification=n.id AND instr(lower(sc.acknowledgement_markdown),lower(${term}))>0)`;
}
// One request per ordinary refresh: the current page (31st row probes for more) plus view-independent
// unread total, latest 100 inbox IDs for alerts and the owner's preferences, even when the page is empty.
async function inbox() {
  const user=q(pb.authStore.record.id),list=listSql(),prefs='SELECT id, alerts_paused_until, revision FROM notification_preferences LIMIT 1';
  const latest=`SELECT r.id, r.created, CASE WHEN r.feedback_record IS NULL THEN r.id ELSE r.id || ':' || f.activity_version END AS activity_key FROM (${inboxRows()}) r LEFT JOIN notification_feedback f ON f.id=r.feedback_record WHERE r.withdrawn_at='' AND r.archived_at='' ORDER BY r.created DESC,r.id DESC LIMIT 100`;
  const unread=`SELECT count(*) AS total FROM (${inboxRows()}) r WHERE r.read_at='' AND r.archived_at='' AND r.withdrawn_at=''`;
  const [row]=await aggregate(`WITH page(${listKeys.join(', ')}) AS (${list}), latest(id, created, activity_key) AS (${latest}) SELECT (${unread}) AS unread, (SELECT json_group_array(json_object('id',id,'created',created,'activity_key',activity_key) ORDER BY created DESC, id DESC) FROM latest) AS latest, (SELECT json_group_array(json_object(${pairs(listKeys)}) ORDER BY created DESC, id DESC) FROM page) AS list, (SELECT json_object('id',id,'alerts_paused_until',alerts_paused_until,'revision',revision) FROM (${prefs})) AS preferences`) || [];
  if(row)return {unread:Number(row.unread)||0,latest:JSON.parse(row.latest),list:JSON.parse(row.list),preferences:row.preferences?JSON.parse(row.preferences):null};
  // Bounded fallback for an oversized envelope: separate reads, the list paged by query()'s splitter.
  const records=await query(latest),total=await query(unread),preferences=await query(prefs);
  return {unread:Number(total[0]?.total)||0,latest:records,preferences:preferences[0] || null,list:await query(list)};
}
function loadList() { listGeneration++; return requestRefresh({urgent:true,visible:true}); }
function renderList(batch) {
  state.list=batch.slice(0,pageSize);
  const hasMore=batch.length>pageSize,pager=$('#pagination');
  if(pager)pager.hidden=state.page===0 && !hasMore;
  $('#previous').disabled=state.page===0;$('#next').disabled=!hasMore;$('#page-label').textContent=`Page ${state.page+1}`;
  $('#list').innerHTML=state.list.length?state.list.map(item=>`<button class="notification-row ${!item.read_at && state.view!=='sent'?'unread':''} ${state.selected===item.id?'selected':''}" data-id="${e(item.id)}"><div class="row-top"><span class="sender">${e(name(item.commenter || item.sender))}${item.feedback_record?' replied':''}</span><time>${e(date(item.created))}</time></div><h2>${e(item.subject)}</h2><p class="excerpt">${e(item.excerpt)}</p><div class="row-bottom"><span class="badge ${e(item.kind)}">${e(kindLabel(item.kind))}</span>${item.feedback_record?'<span class="state-label">Comment on your notification</span>':''}${item.withdrawn_at?'<span class="state-label">Withdrawn</span>':item.acknowledged_at?'<span class="state-label">✓ Acknowledged</span>':item.ack_required && !item.feedback_record?'<span class="state-label">Acknowledgement requested</span>':''}</div></button>`).join(''):`<div class="empty"><span class="empty-icon">✓</span><h2>${state.search || state.filter!=='all'?'No matching notifications':'You’re all caught up'}</h2><p>${state.search || state.filter!=='all'?'Try another search or filter.':'New updates and requests will appear here.'}</p></div>`;
  all('.notification-row').forEach(button=>button.onclick=()=>openDetail(button.dataset.id));
}
// Run only through runRefresh(), which serializes refreshes.
async function poll(manual=false, visible=false) {
  if(!pb.authStore.isValid){if(pb.authStore.record){pb.authStore.clear();report('Your session expired. Sign in again to continue.',true);}return;}
  const epoch=sessionEpoch,generation=listGeneration;
  try {
    await refreshSession();
    if(epoch!==sessionEpoch)return;
    if(directoryDue()){await directory();if(epoch!==sessionEpoch)return;}
    const {latest,unread,preferences,list}=await inbox();
    if(epoch!==sessionEpoch)return;
    state.preferences=preferences;
    const incoming=state.latest===null?[]:latest.filter(item=>!state.latest.has(item.activity_key || item.id) && parseDate(item.created).getTime()>=state.lastPoll-15000);
    const paused=state.preferences?.alerts_paused_until && parseDate(state.preferences.alerts_paused_until)>new Date();
    incoming.forEach(item=>state.pendingAlerts.set(item.activity_key || item.id,item));
    const pending=[...state.pendingAlerts.values()];
    const decision=alertDecision({latest:pending,previous:state.latest,paused,permission:'Notification' in window?Notification.permission:'unsupported',missed:pending.length>incoming.length || (state.lastPoll && Date.now()-state.lastPoll>45000)});
    if(decision) await desktopAlert(decision,pending[0]?.id,pending[0]?.activity_key);
    if(epoch!==sessionEpoch)return;
    if(!paused)state.pendingAlerts.clear();
    state.latest=new Set(latest.map(item=>item.activity_key || item.id));state.lastPoll=Date.now();state.connected=true;
    $('#unread-count').textContent=unread;updateTabIndicator(unread);
    $('#connection').textContent='● Connected · automatic updates';$('#connection').classList.remove('offline');
    updateAlerts();
    if(generation===listGeneration)renderList(list);
    const box=$('#notice');if(box && (manual || box.dataset.busy))box.hidden=true;
    retryDetail(epoch);
  } catch(error) {
    if(epoch!==sessionEpoch){if(!pb.authStore.isValid)report(friendly(error),true);return;}
    state.connected=false;$('#connection').textContent=error.busy?'○ Server busy · retrying shortly':'○ Connection interrupted · retrying';$('#connection').classList.add('offline');
    if(manual || visible)report(friendly(error),!error.busy,error.busy);
    // Queue the follow-up; runRefresh holds it until the cooldown ends.
    if(error.busy)void requestRefresh({visible,epoch});
  }
}
async function desktopAlert(decision,id,activityKey=id) {
  const epoch=sessionEpoch;
  // The Web Locks API serializes localStorage dedup across authenticated tabs.
  if(!navigator.locks)return; // No unreliable fallback that could issue duplicate alerts.
  await navigator.locks.request('notifycontext-alert',async()=>{
    if(epoch!==sessionEpoch || !pb.authStore.isValid)return;
    const key=`notifycontext-alert:${pb.authStore.record.id}`;
    try {const seen=JSON.parse(localStorage.getItem(key)||'{}');if(seen.id===activityKey)return;localStorage.setItem(key,JSON.stringify({id:activityKey,at:Date.now()}));}catch{return;}
    try {const alert=new Notification(decision.title,{body:decision.body,tag:'notifycontext-inbox'});alert.onclick=()=>{window.focus();if(epoch===sessionEpoch && id)void openDetail(id);alert.close();};}catch{report('Desktop alerts are unavailable here. Keep using the inbox.');}
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
const recipientKeys=['id','recipient','recipient_name','addressed_email','claimed_at','claim_expires_at','read_at','acknowledged_at','archived_at','acknowledgement_markdown','revision','created'],referenceKeys=['id','kind','label','url','created'];
const final=message=>Object.assign(new Error(message),{final:true});
// One request: the notification plus separately aggregated recipients and references (no cross product).
// The requester's snapshot filters both: a sender sees every recipient, a recipient only their own row.
async function loadDetail(id) {
  const note=`SELECT (SELECT json_object('id',f.id,'read_at',f.read_at,'archived_at',f.archived_at,'revision',f.revision,'latest_recipient',f.latest_recipient,'latest_at',f.latest_at) FROM notification_feedback f WHERE f.notification=n.id) AS feedback, n.id, n.sender, n.subject, n.body_markdown, n.kind, n.ack_required, n.due_at, n.withdrawn_at, n.withdrawal_reason, n.revision, n.created, (SELECT count(*) FROM notification_recipients WHERE notification=n.id) AS recipient_total, (SELECT count(*) FROM notification_references WHERE notification=n.id) AS reference_total`;
  const recipients=`SELECT r.id, r.recipient, d.name AS recipient_name, r.addressed_email, r.claimed_at, r.claim_expires_at, r.read_at, r.acknowledged_at, r.archived_at, r.acknowledgement_markdown, r.revision, r.created FROM notification_recipients r LEFT JOIN user_directory d ON d.id=r.recipient WHERE r.notification=${q(id)}`;
  const references=`SELECT id, kind, label, url, created FROM notification_references WHERE notification=${q(id)}`;
  const found=await aggregate(`${note}, (SELECT json_group_array(json_object(${pairs(recipientKeys)}) ORDER BY created, id) FROM (${recipients})) AS recipients, (SELECT json_group_array(json_object(${pairs(referenceKeys)}) ORDER BY created, id) FROM (${references})) AS refs FROM notifications n WHERE n.id=${q(id)} LIMIT 1`);
  let detail;
  if(found){if(!found[0])return null;const {recipients:people,refs,...notification}=found[0];detail={notification,recipients:JSON.parse(people),references:JSON.parse(refs)};}
  else {
    // Oversized aggregates (for example 100 long multibyte acknowledgements): separate bounded reads.
    const [notification]=await query(`${note} FROM notifications n WHERE n.id=${q(id)} LIMIT 1`);
    if(!notification)return null;
    detail={notification,recipients:await query(`${recipients} ORDER BY r.created, r.id LIMIT 100`),references:await query(`${references} ORDER BY created, id LIMIT 30`)};
  }
  if(detail.recipients.length!==Number(detail.notification.recipient_total) || detail.references.length!==Number(detail.notification.reference_total))throw final('Recipient details are incomplete. Reload to try again.');
  return detail;
}
function actionControl(record,notification,feedback=false){
  const prefix=feedback?'feedback':'message',attribute=feedback?'data-feedback-action':'data-action';
  const individual=[];
  if(!feedback && !record.acknowledged_at && !notification.withdrawn_at)individual.push(['acknowledge','Acknowledge']);
  if(!record.read_at)individual.push(['read',feedback?'Mark comments read':'Mark read']);
  individual.push([record.archived_at?'unarchive':'archive',record.archived_at?(feedback?'Move comments to inbox':'Move to inbox'):(feedback?'Archive comments':'Archive')]);
  const primary=!record.archived_at && individual.some(([action])=>action==='acknowledge')?['acknowledge_archive','Acknowledge & archive']:
    !record.archived_at && !record.read_at?['read_archive',feedback?'Read & archive comments':'Read & archive']:individual[0];
  const choices=individual.filter(([action])=>action!==primary[0]),hint=primary[0]==='acknowledge_archive'?'Saves your note, acknowledges, marks read and archives.':primary[0]==='read_archive'?(feedback?'Marks current comments read and archives them.':'Marks this message read and archives it.'):'';
  return `<div class="action-split"><button class="primary" ${attribute}="${primary[0]}" ${hint?`aria-describedby="${prefix}-action-hint"`:''}>${primary[1]}</button>${choices.length?`<button type="button" class="primary action-toggle" popovertarget="${prefix}-action-options" aria-expanded="false" aria-label="Other ${prefix} actions">▾</button><div id="${prefix}-action-options" class="action-options" popover="auto" role="group" aria-label="Individual ${prefix} actions">${choices.map(([action,label])=>`<button type="button" ${attribute}="${action}">${label}</button>`).join('')}</div>`:''}</div>${hint?`<p class="fine" id="${prefix}-action-hint">${hint}</p>`:''}`;
}
function bindActionMenus(){
  all('.action-toggle').forEach(toggle=>{
    const menu=document.getElementById(toggle.getAttribute('popovertarget'));
    menu.addEventListener('toggle',event=>{
      const open=event.newState==='open';toggle.setAttribute('aria-expanded',String(open));
      if(!open)return;
      const box=toggle.getBoundingClientRect();
      menu.style.left=Math.max(8,Math.min(box.right-menu.offsetWidth,innerWidth-menu.offsetWidth-8))+'px';
      menu.style.top=(box.bottom+menu.offsetHeight+8<=innerHeight?box.bottom+6:Math.max(8,box.top-menu.offsetHeight-6))+'px';
      menu.querySelector('button')?.focus();
    });
    menu.addEventListener('keydown',event=>{
      const buttons=[...menu.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);
      if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
      }
    });
  });
}
async function openDetail(id) {
  const epoch=sessionEpoch;
  state.selected=id;saveRoute();
  const panel=$('#detail');panel.scrollTop=0;panel.classList.add('open');panel.dataset.id='';panel.innerHTML='<p class="loading">Loading notification…</p>';
  try {
    const detail=await loadDetail(id);
    if(epoch!==sessionEpoch || state.selected!==id)return;
    if(!detail)throw final('This notification is no longer available.');
    const {notification,recipients,references}=detail;
    const feedback=notification.feedback?JSON.parse(notification.feedback):null;
    if(detailRetry?.id===id)detailRetry=null;
    const mine=recipients.find(r=>r.recipient===pb.authStore.record.id),sender=notification.sender===pb.authStore.record.id;
    panel.innerHTML=`<button class="text-button mobile-back" id="back">← Back to inbox</button><div class="detail-meta"><span class="badge ${e(notification.kind)}">${e(kindLabel(notification.kind))}</span><time>${e(date(notification.created))}</time></div><button class="text-button" id="copy-record">Copy record link</button><h2 class="detail-title">${e(notification.subject)}</h2><div class="author"><span class="avatar">${e(name(notification.sender).slice(0,1))}</span><div><strong>${e(name(notification.sender))}</strong><small>${e(statusDescription(notification.sender))}</small></div></div>${notification.withdrawn_at?`<div class="notice error">Withdrawn: ${e(notification.withdrawal_reason)}</div>`:''}${notification.due_at?`<p class="deadline">Response requested by ${e(date(notification.due_at))}</p>`:''}<article class="markdown">${markdown(notification.body_markdown)}</article>${references.length?`<section class="references"><h3>Related context</h3>${references.map(ref=>`<a href="${e(/^https?:\/\//i.test(ref.url)?ref.url:'#')}" target="_blank" rel="noopener noreferrer">${e(ref.label || ref.url)} <span aria-hidden="true">↗</span></a>`).join('')}</section>`:''}${mine?`<section class="actions"><p class="muted">${mine.acknowledged_at?`Acknowledged ${e(date(mine.acknowledged_at))}`:notification.ack_required?'Your acknowledgement is requested.':'Acknowledge to let the sender know you received this.'}</p>${mine.acknowledgement_markdown?`<div class="markdown acknowledgement">${markdown(mine.acknowledgement_markdown)}</div>`:''}${!mine.acknowledged_at && !notification.withdrawn_at?'<label>Optional acknowledgement note<textarea id="ack-note" maxlength="4000" rows="2" placeholder="Received. I’ll review this tomorrow."></textarea></label>':''}${actionControl(mine,notification)}<p class="fine">Acknowledgement confirms receipt, not completion of the work.</p></section>`:''}${feedback?`<section class="actions feedback-actions"><h3>Comments on your notification</h3><p>${feedback.read_at?'Comments marked read':'New comment'} · ${e(date(feedback.latest_at))}</p><div class="markdown">${markdown(recipients.find(r=>r.id===feedback.latest_recipient)?.acknowledgement_markdown || '')}</div>${actionControl(feedback,notification,true)}</section>`:''}${sender?`<section class="recipient-status"><h3>Recipient status</h3>${recipients.map(r=>recipientSummary(r,notification)).join('')}${!notification.withdrawn_at?'<button class="text-button danger" id="withdraw">Withdraw notification</button>':''}</section>`:''}`;
    bindActionMenus();
    $('#copy-record').onclick=()=>void navigator.clipboard.writeText(new URL(routeHref(id,true),location.href).href).then(()=>report('Link copied.')).catch(()=>report('Unable to copy link.',true));
    $('#back').onclick=()=>{panel.classList.remove('open');state.selected=null;saveRoute();};
    all('[data-action]').forEach(button=>button.onclick=async()=>{
      const action=button.dataset.action,note=$('#ack-note')?.value || '';
      const controls=all('.actions button, .actions textarea');
      controls.forEach(control=>{control.disabled=true;});
      try {
        await pb.collection('notification_recipients').update(mine.id,{expected_revision:mine.revision,action,...(['acknowledge','acknowledge_archive'].includes(action)?{acknowledgement_markdown:note}:{})});
        if(epoch!==sessionEpoch)return;
        // Own write: one urgent list refresh plus the detail re-read; the write itself is never retried.
        const refreshed=requestRefresh({urgent:true});
        if(state.selected===id){await openDetail(id);if(!['acknowledge','acknowledge_archive'].includes(action) && state.selected===id && $('#ack-note'))$('#ack-note').value=note;}
        await refreshed;
      }catch(error){report(friendly(error),true);controls.forEach(control=>{control.disabled=false;});}
    });
    all('[data-feedback-action]').forEach(button=>button.onclick=async()=>{
      all('.feedback-actions button').forEach(b=>{b.disabled=true;});
      try{
        await pb.collection('notification_feedback').update(feedback.id,{expected_revision:feedback.revision,action:button.dataset.feedbackAction});
        if(epoch!==sessionEpoch)return;
        await requestRefresh({urgent:true});if(state.selected===id)await openDetail(id);
      }catch(error){
        if(epoch!==sessionEpoch)return;
        if(state.selected===id)await openDetail(id);
        report(error.status===409?'A newer comment or action arrived. Review the refreshed comments and try again.':friendly(error),true);
      }
    });
    if($('#withdraw'))$('#withdraw').onclick=()=>withdraw(notification);
    all('.notification-row').forEach(button=>button.classList.toggle('selected',button.dataset.id===id));
    panel.dataset.id=id;
  }catch(error){if(epoch!==sessionEpoch || state.selected!==id)return;if(!error.final && (error.busy || !error.status || error.status>=500 || error.status===408))detailRetry={epoch,id};panel.innerHTML=`<button class="text-button" id="error-back">← Back to inbox</button><div class="empty"><p>${e(friendly(error))}</p></div>`;$('#error-back').onclick=()=>{panel.classList.remove('open');state.selected=null;saveRoute();};}
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
    $('#status-form').onsubmit=async event=>{event.preventDefault();const data=new FormData(event.target),until=data.get('expiry')==='day'?new Date(new Date().setHours(23,59,59,999)):new Date(Date.now()+Number(data.get('expiry'))*60000);try{const body={availability:data.get('availability'),message:data.get('message'),expires_at:data.get('availability')==='not_set'?'':until.toISOString()};if(current)await pb.collection('user_status').update(current.id,{...body,expected_revision:current.revision});else await pb.collection('user_status').create(body);$('#dialog').close();report('Availability updated.');await directory().catch(()=>{state.directoryAt=0;});}catch(error){if($('#form-error'))$('#form-error').textContent=friendly(error);else report(friendly(error),true);}};
    $('#pause-form').onsubmit=async event=>{event.preventDefault();const duration=Number(new FormData(event.target).get('duration'));try{const body={alerts_paused_until:duration?new Date(Date.now()+duration*60000).toISOString():''};if(state.preferences)await pb.collection('notification_preferences').update(state.preferences.id,{...body,expected_revision:state.preferences.revision});else await pb.collection('notification_preferences').create(body);$('#dialog').close();report(duration?'Desktop alerts paused. Your inbox keeps receiving notifications.':'Desktop alerts resumed.');await requestRefresh({urgent:true});updateAlerts();}catch(error){if($('#form-error'))$('#form-error').textContent=friendly(error);else report(friendly(error),true);}};
  });
}
// A session change clears every view before booting the newly authenticated user.
let displayedIdentity;
pb.authStore.onChange(() => {
  const next=sessionIdentity();
  if(next===displayedIdentity){if(next && realtimeStarted && realtimeToken!==pb.authStore.token)void subscribeInbox(sessionEpoch);return;}
  displayedIdentity=next;
  login();
  if (pb.authStore.isValid && pb.authStore.record?.collectionName === 'users')
    void start().catch(error => report(friendly(error),true));
}, true);
