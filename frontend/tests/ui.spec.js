import {test,expect} from '@playwright/test';
const user='user00000000001',sender='user00000000002';
const jwt=Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({id:user,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
const now=new Date().toISOString();
const initial={id:'note00000000001',sender,subject:'Supplier renewal ready',body_markdown:'## Review requested\n\nPlease review the [handoff](https://example.com).\n\n| Item | Status |\n| --- | --- |\n| Quote | Ready |\n\n```js\nconst approved = false;\n```\n\n<img src=x onerror="window.attacked=true">\n\n[bad](javascript:window.attacked=true)',kind:'review_requested',ack_required:true,due_at:'',withdrawn_at:'',withdrawal_reason:'',revision:1,created:now};
async function setup(page, {count=1,permission='default',holdRead=false,pending=false,withdrawn=false}={}) {
  let releaseRead;const readGate=new Promise(resolve=>{releaseRead=resolve;});
  const writes=[],notices=[];let preference=null;let notes=Array.from({length:count},(_,i)=>({...initial,id:'note'+String(i+1).padStart(11,'0'),subject:i?'Notification '+(i+1):initial.subject}));
  let recipients=notes.map((n,i)=>({id:'recp'+String(i+1).padStart(11,'0'),notification:n.id,recipient:user,read_at:'',acknowledged_at:'',archived_at:'',acknowledgement_markdown:'',revision:1,created:now}));
  if(pending){
    notes[0].sender=user;if(withdrawn){notes[0].withdrawn_at=now;notes[0].withdrawal_reason='Superseded';}
    recipients=[{...recipients[0],recipient:sender,recipient_name:'Jack',addressed_email:'jack@example.test',claimed_at:now,claim_expires_at:''},
      {...recipients[0],id:'pending00000001',recipient:'',recipient_name:null,addressed_email:'new.colleague@example.test',claimed_at:'',claim_expires_at:new Date(Date.now()+30*86400000).toISOString()},
      {...recipients[0],id:'expired00000001',recipient:'',recipient_name:null,addressed_email:'expired.colleague@example.test',claimed_at:'',claim_expires_at:'2020-01-01 00:00:00.000Z'}];
  }
  const result=records=>({columns:Object.keys(records[0]||{}),rows:records.map(Object.values),truncated:false});
  await page.addInitScript(({permission})=>{window.notificationCalls=[];window.Notification=class {static permission=permission;static async requestPermission(){this.permission='granted';return 'granted';}constructor(title,options){window.notificationCalls.push({title,...options});}close(){}};},{permission});
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),body=request.postDataJSON();
    let data;
    if(url.pathname.endsWith('/auth-with-password'))data={token:jwt,record:{id:user,name:'Vamsi',email:'vamsi@example.test'}};
    else if(url.pathname==='/api/context/query') {
      const sql=body.sql;
      if(sql.includes('FROM user_directory'))data=result([{id:user,name:'Vamsi'},{id:sender,name:'Jack'}]);
      else if(sql.includes('FROM user_status'))data=result([]);
      else if(sql.includes('FROM notification_preferences'))data=result(preference?[preference]:[]);
      else if(sql.includes('count(*)'))data=result([{total:recipients.filter(r=>!r.read_at).length}]);
      else if(sql.startsWith('SELECT n.id, n.created'))data=result(notes.map(n=>({id:n.id,created:n.created})));
      else if(sql.includes('FROM notification_references'))data=result([{id:'ref000000000001',notification:notes[0].id,label:'Supporting document',url:'https://example.com',kind:'url'}]);
      else if(sql.includes('FROM notification_recipients'))data=result(recipients.filter(r=>sql.includes(r.notification)));
      else if(sql.startsWith('SELECT * FROM notifications'))data=result(notes.filter(n=>sql.includes(n.id)));
      else {
        const offset=Number(sql.match(/OFFSET (\d+)/)?.[1] || 0);
        let filtered=notes;
        if(sql.includes("lower('missing')"))filtered=[];
        data=result(filtered.slice(offset,offset+31).map(n=>({...n,recipient_record:recipients.find(r=>r.notification===n.id).id,...Object.fromEntries(['read_at','acknowledged_at','archived_at'].map(k=>[k,recipients.find(r=>r.notification===n.id)[k]])),recipient_revision:1})));
      }
    } else {
      writes.push({path:url.pathname,body});
      const recipient=recipients.find(r=>url.pathname.endsWith('/'+r.id));
      if(recipient){if(body.action==='read')recipient.read_at=now;if(body.action==='acknowledge'){recipient.acknowledged_at=now;recipient.acknowledgement_markdown=body.acknowledgement_markdown;}data=recipient;}
      else if(url.pathname.includes('notification_preferences')){preference={id:'prefs0000000001',revision:1,...body};data=preference;}else data={...initial,id:'created00000001',...body};
    }
    if(holdRead && body?.action==='read')await readGate;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/');await page.getByText('Local test sign-in').click();await page.getByLabel('Email',{exact:true}).fill('vamsi@example.test');await page.getByLabel('Password',{exact:true}).fill('test-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Inbox',exact:true})).toBeVisible();await expect(page.locator('#connection')).toContainText('Connected');
  return {writes,releaseRead,addNotification(){notes.unshift({...initial,id:'new000000000001',created:new Date().toISOString(),subject:'New update'});recipients.unshift({id:'newrec000000001',notification:'new000000000001',recipient:user,revision:1,read_at:'',acknowledged_at:'',archived_at:''});}};
}
test('safe Markdown detail and explicit recipient actions',async({page})=>{
  const {writes,releaseRead}=await setup(page,{holdRead:true});
  await page.getByRole('heading',{name:'Supplier renewal ready'}).click();
  await expect(page.locator('article table')).toBeVisible();await expect(page.locator('article pre')).toHaveText('const approved = false;\n');
  expect(await page.evaluate(()=>window.attacked)).toBeUndefined();await expect(page.locator('article img')).toHaveCount(0);await expect(page.locator('article a[href^="javascript:"]')).toHaveCount(0);
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
  await page.getByRole('button',{name:'← Back to inbox'}).click();await page.locator('#settings').click();await page.getByLabel('Status',{exact:true}).selectOption('busy');await page.getByRole('button',{name:'Save status'}).click();expect(writes[1].body.availability).toBe('busy');expect(writes[1].body.user).toBeUndefined();
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
 const errors=[];page.on('pageerror',error=>errors.push(error.message));await setup(page);await page.route('**/api/context/query',async route=>{if(route.request().postDataJSON().sql.startsWith('SELECT * FROM notifications'))await route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'Authentication required'})});else await route.fallback();});
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
