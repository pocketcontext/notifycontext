import {test,expect} from '@playwright/test';
const user='user00000000001',sender='user00000000002';
const jwt=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({id:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
const now=new Date().toISOString();
const initial={id:'note00000000001',sender,subject:'Supplier renewal ready',body_markdown:'## Review requested\n\nPlease review the [handoff](https://example.com).\n\n| Item | Status |\n| --- | --- |\n| Quote | Ready |\n\n```js\nconst approved = false;\n```\n\n<img src=x onerror="window.attacked=true">\n\n[bad](javascript:window.attacked=true)\n\n[mail](mailto:colleague@example.com)',kind:'review_requested',ack_required:true,due_at:'',withdrawn_at:'',withdrawal_reason:'',revision:1,created:now};
const users={[user]:'Vamsi',[sender]:'Jack'};
// Query shapes: consolidated refresh, consolidated detail, joined directory, and the separate fallback/legacy reads.
const classify=sql=>sql.startsWith('WITH page')?'inbox':sql.includes(') AS recipients')?'detail':sql.includes('FROM user_directory d LEFT JOIN')?'directory':sql.includes('recipient_total') || sql.startsWith('SELECT * FROM notifications')?'note':sql.includes('FROM notification_recipients r LEFT JOIN')?'recipients':sql.includes('FROM notification_references')?'references':sql.includes('FROM user_directory')?'users':sql.includes('FROM user_status')?'statuses':sql.includes('FROM notification_preferences')?'preferences':sql.startsWith('SELECT n.id, n.created')?'latest':sql.includes('count(*) AS total')?'unread':'list';
const viewerOf=request=>{try{return JSON.parse(Buffer.from(request.headers().authorization.split('.')[1],'base64url')).id;}catch{return '';}};
async function setup(page, {count=1,permission='default',holdRead=false,pending=false,withdrawn=false,restore=false,preference:initialPreference=null,body,subject}={}) {
  let releaseRead;const readGate=new Promise(resolve=>{releaseRead=resolve;});
  const writes=[],queries=[],oversize=new Set(),tooBig=new Set(),statuses=[];let preference=initialPreference,unreadOverride=null;
  let notes=Array.from({length:count},(_,i)=>({...initial,id:'note'+String(i+1).padStart(11,'0'),subject:i?'Notification '+(i+1):subject||initial.subject,body_markdown:i?initial.body_markdown:body||initial.body_markdown}));
  let recipients=notes.map((n,i)=>({id:'recp'+String(i+1).padStart(11,'0'),notification:n.id,recipient:user,addressed_email:'',claimed_at:'',claim_expires_at:'',read_at:'',acknowledged_at:'',archived_at:'',acknowledgement_markdown:'',revision:1,created:now}));
  if(pending){
    notes[0].sender=user;if(withdrawn){notes[0].withdrawn_at=now;notes[0].withdrawal_reason='Superseded';}
    recipients=[{...recipients[0],recipient:sender,recipient_name:'Jack',addressed_email:'jack@example.test',claimed_at:now,claim_expires_at:''},
      {...recipients[0],id:'pending00000001',recipient:'',recipient_name:null,addressed_email:'new.colleague@example.test',claimed_at:'',claim_expires_at:new Date(Date.now()+30*86400000).toISOString()},
      {...recipients[0],id:'expired00000001',recipient:'',recipient_name:null,addressed_email:'expired.colleague@example.test',claimed_at:'',claim_expires_at:'2020-01-01 00:00:00.000Z'},...recipients.slice(1)];
  }
  const result=records=>({columns:Object.keys(records[0]||{}),rows:records.map(Object.values),truncated:false});
  const literal=(sql,pattern)=>{const match=sql.match(pattern);return match?match[1].replaceAll("''","'"):null;};
  const page31=sql=>({offset:Number(sql.match(/OFFSET (\d+)\s*$/)?.[1] || 0),limit:Number(sql.match(/LIMIT (\d+) OFFSET \d+\s*$/)?.[1] || 1000)});
  const visibleNote=(n,viewer)=>n.sender===viewer || recipients.some(r=>r.notification===n.id && r.recipient===viewer);
  function listRows(sql,viewer) {
    const {offset,limit}=page31(sql),search=literal(sql,/instr\(lower\(n\.subject\),lower\('((?:[^']|'')*)'\)\)/),mine=n=>recipients.find(r=>r.notification===n.id && r.recipient===viewer);
    let items=sql.includes('WHERE n.sender=')?notes.filter(n=>n.sender===viewer).map(n=>({n,r:null})):notes.map(n=>({n,r:mine(n)})).filter(({r})=>r && (sql.includes("r.archived_at != ''")?!!r.archived_at:!r.archived_at));
    if(sql.includes(" AND (r.read_at='' OR r.read_at IS NULL)"))items=items.filter(({r})=>!r.read_at);
    if(sql.includes('n.ack_required=1'))items=items.filter(({n,r})=>n.ack_required && !n.withdrawn_at && !r?.acknowledged_at);
    if(search!==null)items=items.filter(({n})=>n.id===search || n.subject.toLowerCase().includes(search.toLowerCase()) || n.body_markdown.toLowerCase().includes(search.toLowerCase()));
    return items.slice(offset,offset+limit).map(({n,r})=>({id:n.id,sender:n.sender,subject:n.subject,excerpt:[...n.body_markdown].slice(0,140).join(''),...(sql.includes('n.*')?n:{}),kind:n.kind,ack_required:n.ack_required,withdrawn_at:n.withdrawn_at,created:n.created,recipient_record:r?.id ?? null,read_at:r?.read_at ?? null,acknowledged_at:r?.acknowledged_at ?? null,archived_at:r?.archived_at ?? null,recipient_revision:r?.revision ?? null}));
  }
  const latest=viewer=>notes.filter(n=>!n.withdrawn_at && recipients.some(r=>r.notification===n.id && r.recipient===viewer)).slice(0,100).map(n=>({id:n.id,created:n.created}));
  const unread=viewer=>unreadOverride ?? recipients.filter(r=>r.recipient===viewer && !r.read_at && !r.archived_at && !notes.find(n=>n.id===r.notification)?.withdrawn_at).length;
  const prefs=()=>preference?[{id:preference.id,alerts_paused_until:preference.alerts_paused_until,revision:preference.revision}]:[];
  const directory=()=>Object.entries(users).map(([id,name])=>{const status=statuses.find(s=>s.user===id);return {id,name,status_id:status?.id ?? null,availability:status?.availability ?? null,message:status?.message ?? null,expires_at:status?.expires_at ?? null,status_revision:status?.revision ?? null};});
  const noteFor=(sql,viewer)=>{const id=literal(sql,/(?:n\.id|WHERE id)=\'([a-z0-9]{15})\'/);const n=notes.find(item=>item.id===id);return n && visibleNote(n,viewer)?n:null;};
  const peopleFor=(n,viewer)=>recipients.filter(r=>r.notification===n.id && (n.sender===viewer || r.recipient===viewer)).map(({notification,...r})=>({...r,recipient_name:r.recipient_name ?? users[r.recipient] ?? null}));
  const refsFor=n=>n.id===notes[0]?.id?[{id:'ref000000000001',kind:'url',label:'Supporting document',url:'https://example.com',created:now}]:[];
  const detailNote=(n,viewer)=>{const {submission_key,updated,...fields}=n;return {...fields,recipient_total:peopleFor(n,viewer).length,reference_total:refsFor(n).length};};
  function answer(sql,viewer) {
    const kind=classify(sql),n=['detail','note'].includes(kind)?noteFor(sql,viewer):null;
    if(oversize.has(kind))return {columns:['x'],rows:[],truncated:true};
    if(kind==='inbox'){const list=sql.slice(sql.indexOf(' AS (')+5,sql.indexOf('), latest(id, created) AS ('));return result([{unread:unread(viewer),latest:JSON.stringify(latest(viewer)),list:JSON.stringify(listRows(list,viewer)),preferences:prefs()[0]?JSON.stringify(prefs()[0]):null}]);}
    if(kind==='detail')return result(n?[{...detailNote(n,viewer),recipients:JSON.stringify(peopleFor(n,viewer)),refs:JSON.stringify(refsFor(n))}]:[]);
    if(kind==='directory'){const {offset,limit}=page31(sql);return result(directory().slice(offset,offset+limit));}
    if(kind==='note')return result(n?[sql.startsWith('SELECT * ')?n:detailNote(n,viewer)]:[]);
    if(kind==='recipients'){const m=notes.find(item=>sql.includes(item.id));const {offset,limit}=page31(sql);return result(m && visibleNote(m,viewer)?peopleFor(m,viewer).slice(offset,offset+limit):[]);}
    if(kind==='references'){const m=notes.find(item=>sql.includes(item.id));return result(m && visibleNote(m,viewer)?refsFor(m):[]);}
    if(kind==='users')return result(Object.entries(users).map(([id,name])=>({id,name})));
    if(kind==='statuses')return result(statuses);
    if(kind==='preferences')return result(prefs());
    if(kind==='latest')return result(latest(viewer));
    if(kind==='unread')return result([{total:unread(viewer)}]);
    return result(listRows(sql,viewer));
  }
  await page.addInitScript(()=>{
    window.realtimeConnections=[];
    window.EventSource=class extends EventTarget {
      constructor(){super();this.readyState=1;window.realtimeConnections.push(this);setTimeout(()=>this.dispatchEvent(new MessageEvent('PB_CONNECT',{data:'{}',lastEventId:'test-client'})),0);}
      close(){this.readyState=2;}
    };
    window.inboxSignal=()=>window.realtimeConnections.at(-1).dispatchEvent(new MessageEvent('notifycontext.inbox.user00000000001',{data:'{}'}));
  });
  await page.addInitScript(({permission})=>{window.notificationCalls=[];window.Notification=class {static permission=permission;static async requestPermission(){this.permission='granted';return 'granted';}constructor(title,options){window.notificationCalls.push({title,...options});}close(){}};},{permission});
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),body=request.postDataJSON();
    let data;
    if(url.pathname==='/api/realtime'){await route.fulfill({status:200,contentType:'application/json',body:'{}'});return;}
    if(url.pathname.endsWith('/auth-with-password'))data={token:jwt,record:{id:user,name:'Vamsi',collectionName:'users',email:'vamsi@example.test'}};
    else if(url.pathname.endsWith('/auth-refresh')){const token=request.headers().authorization;const id=JSON.parse(Buffer.from(token.split('.')[1],'base64url')).id;data={token,record:{id,name:id===user?'Vamsi':'Other colleague',collectionName:'users'}};}
    else if(url.pathname==='/api/context/query') {
      const sql=body.sql,kind=classify(sql);queries.push({kind,sql,at:Date.now()});
      if(tooBig.has(kind)){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({status:400,message:'SQL query rejected: string or blob too big.',data:{}})});return;}
      data=answer(sql,viewerOf(request));
    } else {
      writes.push({path:url.pathname,body});
      const recipient=recipients.find(r=>url.pathname.endsWith('/'+r.id));
      if(recipient){if(body.action==='archive')recipient.archived_at=now;if(body.action==='unarchive')recipient.archived_at='';if(body.action==='read')recipient.read_at=now;if(body.action==='acknowledge'){recipient.acknowledged_at=now;recipient.acknowledgement_markdown=body.acknowledgement_markdown;}recipient.revision++;data=recipient;}
      else if(url.pathname.includes('notification_preferences')){preference={id:'prefs0000000001',revision:(preference?.revision || 0)+1,...body};delete preference.expected_revision;data=preference;}
      else if(url.pathname.includes('user_status')){const status={id:'status000000001',user,revision:1,...body};statuses.splice(0,statuses.length,status);data=status;}
      else data={...initial,id:'created00000001',...body};
    }
    if(holdRead && body?.action==='read')await readGate;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/');if(!restore){await page.getByText('Local test sign-in').click();await page.getByLabel('Email',{exact:true}).fill('vamsi@example.test');await page.getByLabel('Password',{exact:true}).fill('test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();}await expect(page.locator('#view-title')).toHaveText('Inbox');await expect(page.locator('#filter-label')).toHaveText('All');await expect(page.locator('#connection')).toContainText('Connected');
  return {writes,queries,oversize,tooBig,releaseRead,notes:()=>notes,recipients:()=>recipients,
    kinds:(from=0)=>queries.slice(from).map(query=>query.kind),
    setUnread(value){unreadOverride=value;},
    setPreference(value){preference=value;},
    addNotification(){notes.unshift({...initial,id:'new000000000001',created:new Date().toISOString(),subject:'New update'});recipients.unshift({id:'newrec000000001',notification:'new000000000001',recipient:user,revision:1,read_at:'',acknowledged_at:'',archived_at:'',acknowledgement_markdown:'',addressed_email:'',claimed_at:'',claim_expires_at:'',created:now});}};
}
const settle=page=>page.waitForTimeout(2600);
test('safe Markdown detail and explicit recipient actions',async({page})=>{
  const {writes,releaseRead}=await setup(page,{holdRead:true});
  await page.getByRole('heading',{name:'Supplier renewal ready'}).click();
  await expect(page.locator('article table')).toBeVisible();await expect(page.locator('article pre')).toHaveText('const approved = false;\n');
  expect(await page.evaluate(()=>window.attacked)).toBeUndefined();await expect(page.locator('article img')).toHaveCount(0);await expect(page.locator('article a[href^="javascript:"]')).toHaveCount(0);
  const handoff=page.locator('article a',{hasText:'handoff'});await expect(handoff).toHaveAttribute('target','_blank');await expect(handoff).toHaveAttribute('rel','noopener noreferrer');
  await expect(page.locator('article a[href^="mailto:"]')).not.toHaveAttribute('target',/./);
  expect(writes).toHaveLength(0);
  await page.getByLabel('Optional acknowledgement note').fill('Draft survives marking read.');
  await page.getByRole('button',{name:'Mark read',exact:true}).click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].body.action).toBe('read');
  await expect(page.getByLabel('Optional acknowledgement note')).toBeDisabled();
  await expect(page.getByRole('button',{name:'Acknowledge',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Archive',exact:true})).toBeDisabled();
  releaseRead();
  await expect(page.getByRole('button',{name:'Mark read',exact:true})).toHaveCount(0);
  await expect(page.getByLabel('Optional acknowledgement note')).toHaveValue('Draft survives marking read.');
  await page.getByLabel('Optional acknowledgement note').fill('Received, reviewing tomorrow.');await page.getByRole('button',{name:'Acknowledge',exact:true}).click();await expect(page.locator('.acknowledgement')).toContainText('Received, reviewing tomorrow.');expect(writes[1].body.action).toBe('acknowledge');
});
test('complete backlog pagination and search',async({page})=>{
  await setup(page,{count:65});await expect(page.locator('.notification-row')).toHaveCount(30);await page.getByRole('button',{name:'Next →'}).click();await expect(page.locator('#page-label')).toHaveText('Page 2');await expect(page.locator('.notification-row')).toHaveCount(30);await page.getByRole('button',{name:'Next →'}).click();await expect(page.locator('.notification-row')).toHaveCount(5);await expect(page.getByRole('button',{name:'Next →'})).toBeDisabled();await page.getByRole('searchbox').fill('missing');await expect(page.getByRole('heading',{name:'No matching notifications'})).toBeVisible();
});
test('composer, settings, keyboard focus and mobile layout',async({page})=>{
  await page.setViewportSize({width:390,height:844});const {writes}=await setup(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'New notification'}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.getByLabel('To',{exact:true}).selectOption(sender);await page.getByLabel('Subject',{exact:true}).fill('Please review the budget');await page.locator('#body').fill('**Budget** review\n\n- Check totals');await page.getByText('Preview Markdown',{exact:true}).click();await expect(page.locator('#preview strong')).toHaveText('Budget');await page.getByRole('button',{name:'Send notification',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(writes[0].body.subject).toBe('Please review the budget');expect(writes[0].body.submission_key).toBeTruthy();
  await page.getByRole('button',{name:'← Back to inbox'}).click();await page.getByRole('button',{name:'Open notifications menu',exact:true}).click();await page.locator('#settings').click();await page.getByLabel('Status',{exact:true}).selectOption('busy');await page.getByRole('button',{name:'Save status'}).click();expect(writes[1].body.availability).toBe('busy');expect(writes[1].body.user).toBeUndefined();
  await page.locator('#settings').click();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();await expect(page.locator('#settings')).toBeFocused();
  await page.screenshot({path:'/tmp/notifycontext-mobile.png',fullPage:true});
});
test('notification permission and privacy-preserving alerts',async({page})=>{
  const mock=await setup(page);await page.getByRole('button',{name:'Enable desktop alerts'}).click();await expect(page.locator('#alerts')).toHaveText('Desktop alerts enabled');mock.addNotification();await page.getByRole('button',{name:'Refresh notifications'}).click();await expect.poll(()=>page.evaluate(()=>window.notificationCalls.length)).toBe(1);const [alert]=await page.evaluate(()=>window.notificationCalls);expect(alert.title).toBe('New notification');expect(alert.body).not.toContain('Supplier');await page.getByRole('button',{name:'Refresh notifications'}).click();expect(await page.evaluate(()=>window.notificationCalls.length)).toBe(1);
});
test('blocked notifications provide recovery and inbox remains usable',async({page})=>{
  await setup(page,{permission:'denied'});await page.getByRole('button',{name:'Alerts blocked · help'}).click();await expect(page.locator('#notice')).toContainText('browser settings');await expect(page.locator('.notification-row')).toHaveCount(1);await page.screenshot({path:'/tmp/notifycontext-desktop.png',fullPage:true});
});

test('paused arrivals produce one catch-up summary on resume',async({page})=>{
 const mock=await setup(page,{permission:'granted'});
 await page.locator('#settings').click();await page.getByLabel('Pause duration',{exact:true}).selectOption('30');await page.getByRole('button',{name:'Save alert preference'}).click();
 mock.addNotification();await page.getByRole('button',{name:'Refresh notifications'}).click();await expect(page.locator('#alerts')).toHaveText('Desktop alerts paused');expect(await page.evaluate(()=>window.notificationCalls.length)).toBe(0);
 await page.locator('#settings').click();await page.getByRole('button',{name:'Save alert preference'}).click();await expect.poll(()=>page.evaluate(()=>window.notificationCalls.length)).toBe(1);expect((await page.evaluate(()=>window.notificationCalls))[0].body).toBe('Open your inbox to catch up.');
});
test('revoked session returns to login and clears private content',async({page})=>{
 await setup(page);await page.route('**/api/context/query',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'Authentication required'})}));
 await page.getByRole('button',{name:'Refresh notifications'}).click();await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();await expect(page.locator('#notice')).toContainText('session ended');await expect(page.getByText('Supplier renewal ready')).toHaveCount(0);
});

test('revoked session during detail loading cannot render stale content',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await setup(page);await page.route('**/api/context/query',async route=>{if(classify(route.request().postDataJSON().sql)==='detail')await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'Authentication required'})});else await route.fallback();});
 await page.getByRole('heading',{name:'Supplier renewal ready'}).click();await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();expect(errors).toEqual([]);await expect(page.locator('article')).toHaveCount(0);
});

test('email-only and mixed addressing preserve explicit recipients and explain no invitation',async({page})=>{
 const {writes}=await setup(page);await page.getByRole('button',{name:'New notification'}).click();await expect(page.getByText('No invitation email is sent.',{exact:true})).toBeVisible();
 await page.getByLabel('Subject',{exact:true}).fill('Welcome handoff');await page.locator('#body').fill('Please review this when you sign in.');
 await page.getByRole('button',{name:'Send notification',exact:true}).click();await expect(page.locator('#form-error')).toContainText('Choose a colleague');expect(writes).toHaveLength(0);
 await page.getByLabel('Recipient emails',{exact:true}).fill('NEW.Colleague@example.test, second@example.test');await page.getByRole('button',{name:'Send notification',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
 expect(writes[0].body.recipients).toEqual([]);expect(writes[0].body.recipient_emails).toEqual(['new.colleague@example.test','second@example.test']);
 await page.getByRole('button',{name:'New notification'}).click();await page.getByLabel('To',{exact:true}).selectOption(sender);await page.getByLabel('Recipient emails',{exact:true}).fill('another@example.test');await page.getByLabel('Subject',{exact:true}).fill('Mixed recipients');await page.locator('#body').fill('Shared update');await page.getByRole('button',{name:'Send notification',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();expect(writes[1].body.recipients).toEqual([sender]);expect(writes[1].body.recipient_emails).toEqual(['another@example.test']);
});
test('Sent keeps pending recipients without directory accounts and distinguishes expiry',async({page})=>{
 await setup(page,{pending:true});await page.getByRole('button',{name:'Sent',exact:false}).click();await page.getByRole('heading',{name:'Supplier renewal ready'}).click();
 const statuses=page.locator('.recipient-status');await expect(statuses.getByText('new.colleague@example.test',{exact:true})).toBeVisible();await expect(statuses.getByText('Awaiting first sign-in',{exact:true})).toBeVisible();await expect(statuses.getByText('expired.colleague@example.test',{exact:true})).toBeVisible();await expect(statuses.getByText('Expired',{exact:true})).toBeVisible();await expect(statuses.getByText('Unread',{exact:true})).toBeVisible();await expect(statuses.getByText('jack@example.test',{exact:true})).toBeVisible();
});
test('withdrawal takes precedence over pending and expired recipient statuses',async({page})=>{
 await setup(page,{pending:true,withdrawn:true});await page.getByRole('button',{name:'Sent',exact:false}).click();await page.getByRole('heading',{name:'Supplier renewal ready'}).click();await expect(page.locator('.recipient-status').getByText('Withdrawn',{exact:true})).toHaveCount(3);await expect(page.getByText('Awaiting first sign-in',{exact:true})).toHaveCount(0);await expect(page.getByText('Expired',{exact:true})).toHaveCount(0);
});

test('permalinks restore outside-page records through login and browser history without acknowledgements',async({page})=>{
  const {writes}=await setup(page,{count:65});
  await page.goto('/#/notifications/note00000000065?view=archived&q=missing');await page.reload();
  await expect(page.getByRole('button',{name:'Continue with Google'})).toHaveCount(0);
  await expect(page.locator('.detail-title')).toHaveText('Notification 65');
  await expect(page.locator('#search')).toHaveValue('missing');
  await expect(page.locator('#view-title')).toHaveText('Archived');
  await expect(page.locator('.notification-row')).toHaveCount(0);
  await page.getByRole('button',{name:'Sent',exact:false}).first().click();
  await expect(page.locator('#view-title')).toHaveText('Sent');
  await page.goBack();await expect(page.locator('.detail-title')).toHaveText('Notification 65');
  await expect(page.getByRole('button',{name:'Copy record link',exact:true})).toBeVisible();
  expect(writes).toHaveLength(0);
});


test('persistent login and cross-tab logout discard late private responses',async({page,context})=>{
  await setup(page);
  const peer=await context.newPage();await setup(peer,{restore:true});
  await peer.reload();await expect(peer.locator('#connection')).toContainText('Connected');
  let release;const gate=new Promise(resolve=>{release=resolve;});
  let requested;const started=new Promise(resolve=>{requested=resolve;});
  await page.route('**/api/context/query',async route=>{
    if(classify(route.request().postDataJSON().sql)==='detail'){requested();await gate;await route.fallback();}
    else await route.fallback();
  });
  await page.getByRole('heading',{name:'Supplier renewal ready'}).click();await started;
  await peer.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
  release();await page.reload();
  await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
  await expect(page.locator('article')).toHaveCount(0);
  await page.unroute('**/api/context/query');
  await page.getByText('Local test sign-in').click();await page.getByLabel('Email',{exact:true}).fill('vamsi@example.test');await page.getByLabel('Password',{exact:true}).fill('test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(peer.locator('#view-title')).toHaveText('Inbox');
});

test('cross-tab account replacement removes private detail and drafts',async({page,context})=>{
  await setup(page);const peer=await context.newPage();await setup(peer,{restore:true});
  await page.getByRole('heading',{name:'Supplier renewal ready'}).click();
  await expect(page.locator('article')).toBeVisible();
  await page.getByRole('button',{name:'New notification'}).click();
  await page.getByLabel('Subject',{exact:true}).fill('Private draft');
  await page.route('**/api/context/query',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({columns:[],rows:[],truncated:false})}));
  const token=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({id:sender,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
  await peer.evaluate(({token,id})=>localStorage.setItem('notifycontext.auth',JSON.stringify({token,record:{id,name:'Other colleague',collectionName:'users'}})),{token,id:sender});
  await expect(page.locator('#settings')).toContainText('Other colleague');
  await expect(page.locator('article')).toHaveCount(0);await expect(page.getByLabel('Subject',{exact:true})).toHaveCount(0);
  await expect(page.getByText('Supplier renewal ready',{exact:true})).toHaveCount(0);
});


test('same-account token renewal preserves an open draft and rebinds realtime',async({page,context})=>{
  await setup(page);const peer=await context.newPage();await setup(peer,{restore:true});
  await expect.poll(()=>page.evaluate(()=>window.realtimeConnections.length)).toBeGreaterThan(0);
  const connections=await page.evaluate(()=>window.realtimeConnections.length);
  await page.getByRole('button',{name:'New notification'}).click();await page.getByLabel('Subject',{exact:true}).fill('Keep this draft');
  const token=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({id:user,exp:Math.floor(Date.now()/1000)+7200})).toString('base64url')+'.renewed';
  await peer.evaluate(token=>{const session=JSON.parse(localStorage.getItem('notifycontext.auth'));session.token=token;localStorage.setItem('notifycontext.auth',JSON.stringify(session));},token);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('notifycontext.auth')).token)).toBe(token);
  await expect(page.getByLabel('Subject',{exact:true})).toHaveValue('Keep this draft');
  await expect.poll(()=>page.evaluate(()=>window.realtimeConnections.length)).toBeGreaterThan(connections);
});

test('a delayed refresh cannot restore a session after cross-tab logout',async({page,context})=>{
  await setup(page);const peer=await context.newPage();await setup(peer,{restore:true});
  let release;const gate=new Promise(resolve=>{release=resolve;});
  let requested;const started=new Promise(resolve=>{requested=resolve;});
  await page.route('**/api/collections/users/auth-refresh',async route=>{
    requested();await gate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({token:jwt,record:{id:user,name:'Vamsi',collectionName:'users'}})});
  });
  await page.reload();await started;
  await peer.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
  const response=page.waitForResponse('**/api/collections/users/auth-refresh');release();await response;
  await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('notifycontext.auth'))).toBeNull();
});


test('notification filters sit under the selected inbox, sent, or archived tab',async({page})=>{
  await setup(page);
  await expect(page.locator('#filter')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'All notifications',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Unread',exact:true}).click();
  await expect(page).toHaveURL(/filter=unread/);
  await expect(page.locator('#filter-label')).toHaveText('Unread');
  await expect(page.locator('.view-filters:not([hidden]) .view-filter.active')).toHaveText('Unread');
  await page.getByRole('button',{name:'Inbox',exact:false}).click();
  await expect(page.locator('#view-title')).toHaveText('Inbox');
  await expect(page).not.toHaveURL(/filter=/);
  await expect(page.locator('.view-filters:not([hidden]) .view-filter.active')).toHaveCount(0);
  await page.getByRole('button',{name:'Sent',exact:false}).click();
  await expect(page.locator('#view-title')).toHaveText('Sent');
  await expect(page).toHaveURL(/view=sent/);
  await expect(page).not.toHaveURL(/filter=/);
  await page.getByRole('button',{name:'Past response deadline',exact:true}).click();
  await expect(page).toHaveURL(/filter=overdue/);
  await expect(page.locator('.view-filters:not([hidden])')).toHaveAttribute('data-for','sent');
  await expect(page.getByRole('button',{name:'Unread',exact:true})).toHaveCount(1);
});
test('mobile inbox, sent, and archived collapse into a left menu',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await setup(page);
  await expect(page.getByRole('button',{name:'Sent',exact:false})).toHaveCount(0);
  await page.getByRole('button',{name:'Open notifications menu',exact:true}).click();
  await expect(page.getByRole('button',{name:'Close notifications menu',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Sent',exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Unread',exact:true}).click();
  await expect(page).toHaveURL(/filter=unread/);
  await expect(page.getByRole('button',{name:'Sent',exact:false})).toHaveCount(0);
  await page.getByRole('button',{name:'Open notifications menu',exact:true}).click();
  await page.getByRole('button',{name:'Inbox',exact:false}).click();
  await expect(page.locator('#view-title')).toHaveText('Inbox');
  await expect(page).not.toHaveURL(/filter=/);
  await expect(page.locator('.view-filters:not([hidden]) .view-filter.active')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Sent',exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Close notifications menu',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sent',exact:false})).toHaveCount(0);
});

test('tab count preserves explicit actions, ignores filters, and resets on logout',async({page})=>{
  await setup(page,{count:101});await expect(page).toHaveTitle('(101) NotifyContext');
  const favicon=page.locator('link[rel="icon"]');await expect(favicon).toHaveAttribute('href',/99%2B/);
  await page.getByRole('heading',{name:'Supplier renewal ready'}).click();await expect(page).toHaveTitle('(101) NotifyContext');
  await page.getByRole('button',{name:'Acknowledge',exact:true}).click();await expect(page).toHaveTitle('(101) NotifyContext');
  await page.getByRole('button',{name:'Mark read',exact:true}).click();await expect(page).toHaveTitle('(100) NotifyContext');
  await page.getByRole('searchbox').fill('missing');await expect(page.getByRole('heading',{name:'No matching notifications'})).toBeVisible();await expect(page).toHaveTitle('(100) NotifyContext');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveTitle('NotifyContext');await expect(favicon).not.toHaveAttribute('href',/%3Ctext/);
});
test('archived notifications do not count and failures retain the indicator',async({page})=>{
  await setup(page);await expect(page).toHaveTitle('(1) NotifyContext');
  await page.route('**/api/context/query',route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Offline"}'}));
  await page.getByRole('button',{name:'Refresh notifications'}).click();await expect(page.locator('#connection')).toContainText('interrupted');await expect(page).toHaveTitle('(1) NotifyContext');
  await page.unroute('**/api/context/query');
  await page.getByRole('heading',{name:'Supplier renewal ready'}).click();await page.getByRole('button',{name:'Archive',exact:true}).click();await expect(page).toHaveTitle('NotifyContext');
});

test('realtime refreshes a background inbox, coalesces events and keeps alert pause independent',async({page})=>{
 const mock=await setup(page,{permission:'granted'});
 await page.locator('#settings').click();await page.getByLabel('Pause duration',{exact:true}).selectOption('30');await page.getByRole('button',{name:'Save alert preference'}).click();
 await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,value:true}));
 mock.addNotification();await page.evaluate(()=>{for(let i=0;i<5;i++)window.inboxSignal();});
 await expect(page).toHaveTitle('(2) NotifyContext');await expect(page.locator('#unread-count')).toHaveText('2');expect(await page.evaluate(()=>window.notificationCalls.length)).toBe(0);
});
test('withdrawn notifications do not contribute to the tab count',async({page})=>{
 await setup(page,{pending:true,withdrawn:true});await expect(page).toHaveTitle('NotifyContext');await expect(page.locator('#unread-count')).toHaveText('0');
});

test('reconnect and fallback polling recover changes without an inbox signal',async({page})=>{
 await page.clock.install();const mock=await setup(page);
 mock.addNotification();
 await page.evaluate(()=>window.realtimeConnections.at(-1).dispatchEvent(new MessageEvent('PB_CONNECT',{data:'{}',lastEventId:'reconnected-client'})));
 await expect(page).toHaveTitle('(2) NotifyContext');
 mock.setUnread(3);
 await page.clock.fastForward(60000);await expect(page).toHaveTitle('(3) NotifyContext');
});
test('an inbox event during an in-flight poll schedules a follow-up and logout rejects stale count',async({page})=>{
 const mock=await setup(page);let release,started;
 const gate=new Promise(resolve=>{release=resolve;}),requested=new Promise(resolve=>{started=resolve;});let held=false;
 await page.route('**/api/context/query',async route=>{
  if(!held && classify(route.request().postDataJSON().sql)==='inbox'){held=true;started();await gate;mock.setUnread(1);await route.fallback();}else await route.fallback();
 });
 await page.getByRole('button',{name:'Refresh notifications'}).click();await requested;
 mock.addNotification();await page.evaluate(()=>window.inboxSignal());release();await expect(page).toHaveTitle('(1) NotifyContext');
 // The stale in-flight result is followed by exactly the one queued refresh.
 mock.setUnread(null);await expect(page).toHaveTitle('(2) NotifyContext');
 let releaseAgain,startedAgain;const gateAgain=new Promise(resolve=>{releaseAgain=resolve;}),requestedAgain=new Promise(resolve=>{startedAgain=resolve;});
 await page.route('**/api/context/query',async route=>{
  if(classify(route.request().postDataJSON().sql)==='inbox'){startedAgain();await gateAgain;mock.setUnread(99);await route.fallback();}else await route.fallback();
 });
 await page.getByRole('button',{name:'Refresh notifications'}).click();await requestedAgain;
 await page.getByRole('button',{name:'Sign out',exact:true}).click();releaseAgain();await expect(page).toHaveTitle('NotifyContext');await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
});

test('request budget: startup, steady refresh, detail open and recipient action',async({page})=>{
 const mock=await setup(page,{count:3});await settle(page);
 // Startup: one joined directory/status page and one consolidated refresh; realtime connect joins it.
 expect(mock.kinds()).toEqual(['directory','inbox']);
 let mark=mock.queries.length;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await settle(page);
 expect(mock.kinds(mark)).toEqual(['inbox']);
 mark=mock.queries.length;await page.getByRole('heading',{name:'Supplier renewal ready'}).click();await expect(page.locator('.detail-title')).toBeVisible();await page.waitForTimeout(500);
 expect(mock.kinds(mark)).toEqual(['detail']);expect(mock.writes).toHaveLength(0);
 mark=mock.queries.length;await page.getByRole('button',{name:'Mark read',exact:true}).click();await expect(page.getByRole('button',{name:'Mark read',exact:true})).toHaveCount(0);await settle(page);
 expect(mock.kinds(mark).sort()).toEqual(['detail','inbox']);expect(mock.writes.map(write=>write.body.action)).toEqual(['read']);
 expect(mock.writes[0].path).toMatch(/\/notification_recipients\/records\/recp00000000001$/);expect(mock.writes[0].body.expected_revision).toBe(1);
 // The list excerpt is selected in SQL; full bodies stay out of the refresh.
 const inbox=mock.queries.find(query=>query.kind==='inbox').sql;expect(inbox).not.toContain('n.*');expect(inbox).toContain('substr(n.body_markdown,1,140)');
});
test('direct link startup reads the detail once and hashchange avoids redundant reloads',async({page})=>{
 const mock=await setup(page,{count:65});
 await page.goto('/#/notifications/note00000000065?view=inbox&page=1');await expect(page.locator('.detail-title')).toHaveText('Notification 65');await settle(page);
 let mark=mock.queries.length;await page.reload();
 await expect(page.locator('.detail-title')).toHaveText('Notification 65');await settle(page);
 expect(mock.kinds(mark)).toEqual(['directory','inbox','detail']);
 await expect(page.locator('#page-label')).toHaveText('Page 2');await expect(page.locator('.notification-row')).toHaveCount(30);
 // Back to the list (no detail read), then forward to the same record: the list is unchanged, so no reads at all.
 mark=mock.queries.length;await page.evaluate(()=>{location.hash='#/?view=inbox&page=1';});await expect(page.locator('.detail-placeholder')).toBeVisible();await page.waitForTimeout(500);
 expect(mock.kinds(mark)).toEqual([]);
 await page.evaluate(()=>{location.hash='#/notifications/note00000000065?view=inbox&page=1';});await expect(page.locator('.detail-title')).toHaveText('Notification 65');await page.waitForTimeout(500);
 expect(mock.kinds(mark)).toEqual(['detail']);
 mark=mock.queries.length;await page.evaluate(()=>{location.hash='#/notifications/note00000000065?view=inbox&page=2';});await expect(page.locator('#page-label')).toHaveText('Page 3');await page.waitForTimeout(500);
 expect(mock.kinds(mark)).toEqual(['inbox']);await expect(page.locator('.detail-title')).toHaveText('Notification 65');
 expect(mock.writes).toHaveLength(0);
});
test('an empty inbox still carries the unread total and alert pause',async({page})=>{
 const mock=await setup(page,{count:0,permission:'granted',preference:{id:'prefs0000000001',alerts_paused_until:new Date(Date.now()+3600000).toISOString(),revision:1}});
 await expect(page.getByRole('heading',{name:'You’re all caught up'})).toBeVisible();await expect(page.locator('#unread-count')).toHaveText('0');await expect(page).toHaveTitle('NotifyContext');
 await expect(page.locator('#alerts')).toHaveText('Desktop alerts paused');await expect(page.locator('#pagination')).toBeHidden();
 expect(mock.kinds()).toEqual(['directory','inbox']);
});
test('sent, archived, full-content search, filters and page boundaries',async({page})=>{
 const mock=await setup(page,{count:60,pending:true,body:'Opening paragraph. '+'x'.repeat(200)+' hiddenkeyword at the end.'});
 await expect(page.locator('.notification-row')).toHaveCount(30);await expect(page.locator('.notification-row').first().locator('.excerpt')).not.toContainText('hiddenkeyword');
 await page.getByRole('button',{name:'Next →'}).click();await expect(page.locator('#page-label')).toHaveText('Page 2');
 // 59 inbox rows: page 2 holds 29 and the 31-row probe disables Next exactly at the boundary.
 await expect(page.locator('.notification-row')).toHaveCount(29);await expect(page.getByRole('button',{name:'Next →'})).toBeDisabled();
 await page.getByRole('button',{name:'Sent',exact:false}).click();await expect(page.locator('.notification-row')).toHaveCount(1);await expect(page.locator('#pagination')).toBeHidden();
 await page.getByRole('searchbox').fill('hiddenkeyword');await expect(page.locator('.notification-row')).toHaveCount(1);await expect(page.locator('.notification-row h2')).toHaveText('Supplier renewal ready');
 await page.getByRole('button',{name:'Inbox',exact:false}).click();await page.getByRole('searchbox').fill('Notification 2');await expect(page.locator('.notification-row')).toHaveCount(11);
 await page.getByRole('searchbox').fill('');await expect(page.locator('.notification-row')).toHaveCount(30);
 await page.locator('.notification-row h2').filter({hasText:/^Notification 2$/}).click();await page.getByRole('button',{name:'Archive',exact:true}).click();await expect(page.getByRole('button',{name:'Move to inbox',exact:true})).toBeVisible();
 await expect(page.locator('.notification-row h2').filter({hasText:/^Notification 2$/})).toHaveCount(0);
 await page.getByRole('button',{name:'Archived',exact:false}).click();await expect(page.locator('.notification-row')).toHaveCount(1);await expect(page.locator('.notification-row h2')).toHaveText('Notification 2');
 await page.getByRole('button',{name:'Inbox',exact:false}).click();await page.getByRole('button',{name:'Unread',exact:true}).click();await expect(page.locator('.notification-row')).toHaveCount(30);
 // Totals and alert inputs ignore the displayed view, filter, search and page.
 const sqls=mock.queries.filter(query=>query.kind==='inbox').map(query=>query.sql.slice(query.sql.indexOf('), latest(id, created) AS (')));
 expect(new Set(sqls).size).toBe(1);await expect(page.locator('#unread-count')).toHaveText('58');
});
test('a 429 without Retry-After backs off, stays friendly and re-opens the selected detail',async({page})=>{
 const mock=await setup(page);let limited=1;
 await page.route('**/api/context/query',async route=>{if(limited>0 && classify(route.request().postDataJSON().sql)==='detail'){limited--;await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({status:429,message:'Too Many Requests.',data:{}})});}else await route.fallback();});
 const mark=mock.queries.length;await page.getByRole('heading',{name:'Supplier renewal ready'}).click();
 await expect(page.locator('#detail')).toContainText(/NotifyContext is busy\. Retrying in \ds\./);await expect(page.getByText(/Too Many Requests/)).toHaveCount(0);
 // Cooldown: manual and background triggers send nothing, the manual one explains the wait.
 await page.getByRole('button',{name:'Refresh notifications'}).click();await page.evaluate(()=>{window.inboxSignal();document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));});
 await expect(page.locator('#notice')).toContainText(/busy\. Retrying in \ds/);
 expect(mock.kinds(mark)).toEqual([]);
 await expect(page.locator('.detail-title')).toHaveText('Supplier renewal ready',{timeout:5000});
 await expect(page.locator('#notice')).toBeHidden();await expect(page.locator('#connection')).toContainText('Connected');
 expect(mock.kinds(mark).sort()).toEqual(['detail','inbox']);expect(mock.writes).toHaveLength(0);
});
test('repeated 429s without Retry-After retry within one rate-limit window',async({page})=>{
 await page.clock.install();await page.addInitScript(()=>{Math.random=()=>0.999;});const mock=await setup(page);await settle(page);let limited=6;
 await page.route('**/api/context/query',async route=>{if(limited>0 && classify(route.request().postDataJSON().sql)==='inbox'){limited--;await route.fulfill({status:429,contentType:'application/json',body:JSON.stringify({status:429,message:'Too Many Requests.',data:{}})});}else await route.fallback();});
 await page.getByRole('button',{name:'Refresh notifications'}).click();
 // Waits grow 2, 4, 8 s, then stay at the 11 s cap, never beyond one window.
 const steps=[2,4,8,11,11,11];
 for(let i=0;i<steps.length;i++){await expect.poll(()=>limited).toBe(5-i);await page.getByRole('button',{name:'Refresh notifications'}).click();const seconds=Number((await page.locator('#notice').textContent()).match(/Retrying in (\d+)s/)[1]);expect(seconds).toBeLessThanOrEqual(steps[i]);expect(seconds).toBeGreaterThanOrEqual(steps[i]-1);if(i<steps.length-1)await page.clock.fastForward(steps[i]*1000+100);}
 limited=0;await page.clock.fastForward(11100);
 await expect(page.locator('#connection')).toContainText('Connected');await expect(page.locator('#notice')).toBeHidden();
});
test('a 429 with Retry-After holds every refresh trigger until the hinted time',async({page})=>{
 const mock=await setup(page);let limited=1,limitedAt=0;
 await page.route('**/api/context/query',async route=>{if(limited>0 && classify(route.request().postDataJSON().sql)==='inbox'){limited--;limitedAt=Date.now();await route.fulfill({status:429,headers:{'Retry-After':'3'},contentType:'application/json',body:JSON.stringify({status:429,message:'Too many concurrent snapshot reads for this account',data:{}})});}else await route.fallback();});
 await page.getByRole('button',{name:'Refresh notifications'}).click();
 await expect(page.locator('#notice')).toContainText(/NotifyContext is busy\. Retrying in [34]s\./);await expect(page.locator('#connection')).toContainText('busy');
 const mark=mock.queries.length;
 for(let i=0;i<4;i++){await page.evaluate(()=>{window.inboxSignal();document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));});await page.waitForTimeout(500);}
 expect(mock.kinds(mark)).toEqual([]);
 await expect(page.locator('#connection')).toContainText('Connected',{timeout:5000});await expect(page.locator('#notice')).toBeHidden();
 const resumed=mock.queries.slice(mark);expect(resumed.map(query=>query.kind)).toEqual(['inbox']);expect(resumed[0].at-limitedAt).toBeGreaterThanOrEqual(3000);expect(resumed[0].at-limitedAt).toBeLessThan(4500);
});
test('navigation during a cooldown waits, and sign-out during a cooldown cancels queued reads',async({page})=>{
 const mock=await setup(page,{pending:true});let limited=1;
 await page.route('**/api/context/query',async route=>{if(limited>0){limited--;await route.fulfill({status:429,headers:{'Retry-After':'2'},contentType:'application/json',body:'{"message":"Too Many Requests."}'});}else await route.fallback();});
 await page.getByRole('button',{name:'Refresh notifications'}).click();await expect(page.locator('#notice')).toContainText('busy');
 let mark=mock.queries.length;await page.getByRole('button',{name:'Sent',exact:false}).click();await expect(page.locator('#view-title')).toHaveText('Sent');
 await page.waitForTimeout(800);expect(mock.kinds(mark)).toEqual([]);
 await expect(page.locator('.notification-row')).toHaveCount(1,{timeout:5000});expect(mock.kinds(mark)).toEqual(['inbox']);
 limited=1;await page.getByRole('heading',{name:'Supplier renewal ready'}).click();await expect(page.locator('#detail')).toContainText('busy');
 mark=mock.queries.length;await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();
 await page.waitForTimeout(4000);expect(mock.kinds(mark)).toEqual([]);await expect(page.getByText('Supplier renewal ready')).toHaveCount(0);
 // A new sign-in after the cooldown restores the route's record through ordinary startup, with no extra retry.
 await page.getByText('Local test sign-in').click();await page.getByLabel('Email',{exact:true}).fill('vamsi@example.test');await page.getByLabel('Password',{exact:true}).fill('test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.locator('#connection')).toContainText('Connected');await settle(page);expect(mock.kinds(mark)).toEqual(['directory','inbox','detail']);await expect(page.locator('.detail-title')).toHaveText('Supplier renewal ready');
});
test('a transient detail failure retries after the next successful refresh',async({page})=>{
 const mock=await setup(page);let failing=true;
 await page.route('**/api/context/query',async route=>{if(failing && classify(route.request().postDataJSON().sql)==='detail')await route.fulfill({status:503,contentType:'application/json',body:'{"message":"Database busy; retry the query"}'});else await route.fallback();});
 await page.getByRole('heading',{name:'Supplier renewal ready'}).click();await expect(page.locator('#detail')).toContainText('Database busy');
 failing=false;await page.getByRole('button',{name:'Refresh notifications'}).click();await expect(page.locator('.detail-title')).toHaveText('Supplier renewal ready');
 expect(mock.writes).toHaveLength(0);
});
test('concurrent realtime, manual, visibility and online refreshes coalesce',async({page})=>{
 const mock=await setup(page);await settle(page);mock.addNotification();
 let mark=mock.queries.length;
 // Background bursts, including one arriving during the in-flight refresh, yield one run plus at most one follow-up, 2 s apart.
 const burst=()=>page.evaluate(()=>{for(let i=0;i<10;i++){window.inboxSignal();document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));}});
 await burst();await page.waitForTimeout(300);await burst();
 await expect(page).toHaveTitle('(2) NotifyContext');await settle(page);await settle(page);
 let kinds=mock.kinds(mark);expect(kinds.every(kind=>kind==='inbox')).toBe(true);expect(kinds.length).toBeGreaterThanOrEqual(1);expect(kinds.length).toBeLessThanOrEqual(2);
 const times=mock.queries.slice(mark).map(query=>query.at);// Measured at request arrival, so allow for latency jitter around the 2 s browser-side interval.
 for(let i=1;i<times.length;i++)expect(times[i]-times[i-1]).toBeGreaterThanOrEqual(1700);
 // Manual refreshes skip the interval but share the queue: two clicks plus a burst are at most one read per click plus one follow-up.
 mark=mock.queries.length;
 await page.getByRole('button',{name:'Refresh notifications'}).click();await page.getByRole('button',{name:'Refresh notifications'}).click();await burst();
 await settle(page);await settle(page);
 kinds=mock.kinds(mark);expect(kinds.every(kind=>kind==='inbox')).toBe(true);expect(kinds.length).toBeGreaterThanOrEqual(1);expect(kinds.length).toBeLessThanOrEqual(3);
});
test('oversized aggregates fall back to complete separate reads',async({page})=>{
 const mock=await setup(page,{count:2,pending:true});mock.oversize.add('inbox');mock.tooBig.add('detail');
 let mark=mock.queries.length;await page.getByRole('button',{name:'Refresh notifications'}).click();await page.waitForTimeout(800);
 expect(mock.kinds(mark)).toEqual(['inbox','latest','unread','preferences','list']);await expect(page.locator('.notification-row')).toHaveCount(1);await expect(page.locator('#unread-count')).toHaveText('1');
 await page.getByRole('button',{name:'Sent',exact:false}).click();await page.waitForTimeout(800);mark=mock.queries.length;await page.getByRole('heading',{name:'Supplier renewal ready'}).click();
 await expect(page.locator('.recipient-status > div')).toHaveCount(3);expect(mock.kinds(mark)).toEqual(['detail','note','recipients','references']);
 await expect(page.locator('.references a')).toHaveCount(1);
});
test('an incomplete fallback recipient list is reported, never shown partially',async({page})=>{
 const mock=await setup(page,{pending:true});mock.oversize.add('detail');
 await page.route('**/api/context/query',async route=>{const sql=route.request().postDataJSON().sql;if(classify(sql)==='recipients')await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({columns:['id'],rows:[['recp00000000001']],truncated:false})});else await route.fallback();});
 await page.getByRole('button',{name:'Sent',exact:false}).click();await page.getByRole('heading',{name:'Supplier renewal ready'}).click();
 await expect(page.locator('#detail')).toContainText('Recipient details are incomplete');await expect(page.locator('.recipient-status')).toHaveCount(0);
});
test('sender sees every recipient while a recipient sees only their own row and actions',async({page})=>{
 const mock=await setup(page,{count:2,pending:true});
 await page.getByRole('heading',{name:'Notification 2'}).click();await expect(page.locator('.detail-title')).toHaveText('Notification 2');
 await expect(page.locator('.recipient-status')).toHaveCount(0);await expect(page.getByRole('button',{name:'Acknowledge',exact:true})).toBeVisible();
 const detail=mock.queries.filter(query=>query.kind==='detail').at(-1).sql;expect(detail).not.toContain('SELECT *');expect(detail).toContain("'revision',revision");
 await page.getByRole('button',{name:'Sent',exact:false}).click();await page.getByRole('heading',{name:'Supplier renewal ready'}).click();
 await expect(page.locator('.recipient-status > div')).toHaveCount(3);await expect(page.locator('.actions')).toHaveCount(0);
 await page.getByRole('button',{name:'Inbox',exact:false}).click();await page.getByRole('heading',{name:'Notification 2'}).click();
 await page.getByRole('button',{name:'Archive',exact:true}).click();await expect(page.getByRole('button',{name:'Move to inbox',exact:true})).toBeVisible();
 expect(mock.writes.at(-1).path).toMatch(/recp00000000002$/);
});
test('maximum-length multibyte content keeps a character-safe excerpt and the full detail',async({page})=>{
 const body='😀'.repeat(19990)+' éñd',subject='界'.repeat(200);
 await setup(page,{body,subject});
 const excerpt=await page.locator('.notification-row .excerpt').textContent();expect([...excerpt]).toHaveLength(140);expect(excerpt).toBe('😀'.repeat(140));
 await page.getByRole('heading',{name:subject}).click();await expect(page.locator('article')).toContainText('éñd');
 expect([...(await page.locator('article').textContent()).trim()].length).toBe(19994);
});
test('another tab’s alert pause reaches this tab on the next refresh',async({page})=>{
 const mock=await setup(page,{permission:'granted'});await expect(page.locator('#alerts')).toHaveText('Desktop alerts enabled');
 mock.setPreference({id:'prefs0000000001',alerts_paused_until:new Date(Date.now()+1800000).toISOString(),revision:2});
 const mark=mock.queries.length;await page.evaluate(()=>window.inboxSignal());await expect(page.locator('#alerts')).toHaveText('Desktop alerts paused');
 expect(mock.kinds(mark)).toEqual(['inbox']);
 mock.addNotification();await page.getByRole('button',{name:'Refresh notifications'}).click();await expect(page).toHaveTitle('(2) NotifyContext');expect(await page.evaluate(()=>window.notificationCalls.length)).toBe(0);
});
test('directory and status refresh on schedule and immediately after the user’s own status change',async({page})=>{
 await page.clock.install();const mock=await setup(page);await settle(page);
 expect(mock.kinds().filter(kind=>kind==='directory')).toHaveLength(1);
 const inboxReads=()=>mock.kinds().filter(kind=>kind==='inbox').length,base=inboxReads();
 for(let i=1;i<=4;i++){await page.clock.fastForward(60000);await expect.poll(inboxReads).toBe(base+i);}
 expect(mock.kinds().filter(kind=>kind==='directory')).toHaveLength(1);
 await page.clock.fastForward(60000);await expect.poll(()=>mock.kinds().filter(kind=>kind==='directory').length).toBe(2);
 await page.locator('#settings').click();await page.getByLabel('Status',{exact:true}).selectOption('busy');await page.getByRole('button',{name:'Save status'}).click();
 await expect(page.locator('#my-status')).toHaveText('Busy');expect(mock.kinds().filter(kind=>kind==='directory')).toHaveLength(3);
});
