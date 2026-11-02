import {test,expect} from '@playwright/test';
import {DatabaseSync} from 'node:sqlite';
import {mkdir} from 'node:fs/promises';

// Execute the browser's real SELECTs against synthetic rows, including window functions,
// filters and pagination. This avoids a mock that merely repeats the neighbor algorithm.
const user='user00000000001',sender='user00000000002';
const noteId=i=>'note'+String(i).padStart(11,'0');
const token=id=>Buffer.from('{}').toString('base64url')+'.'+Buffer.from(JSON.stringify({id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
async function fixture(page,{count=4,mode='next'}={}) {
  const db=new DatabaseSync(':memory:'),writes=[],queries=[];
  const tables={
    notifications:'id,sender,subject,body_markdown,kind,ack_required,due_at,withdrawn_at,withdrawal_reason,revision,created',
    notification_recipients:'id,notification,recipient,addressed_email,claimed_at,claim_expires_at,read_at,acknowledged_at,archived_at,acknowledgement_markdown,revision,created',
    notification_conversation_state:'id,notification,user,latest_comment,latest_at,activity_version,read_version,read_at,archived_at,revision',
    notification_comments:'id,notification,author,body_markdown,submission_key,sequence,created',
    notification_feedback:'id,notification,user,latest_recipient,latest_at,read_at,archived_at,revision',
    notification_references:'id,notification,kind,label,url,created',
    notification_preferences:'id,user,alerts_paused_until,auto_advance,revision',
    user_directory:'id,name',user_status:'id,user,availability,message,expires_at,revision',
  };
  for(const [table,columns] of Object.entries(tables))db.exec(`CREATE TABLE ${table} (${columns.split(',').map(c=>`${c} ${['revision','activity_version','read_version','sequence','ack_required'].includes(c)?'INTEGER':'TEXT'} DEFAULT ''`).join(',')})`);
  const insert=(table,row)=>db.prepare(`INSERT INTO ${table} (${Object.keys(row)}) VALUES (${Object.keys(row).map(()=>'?')})`).run(...Object.values(row));
  insert('user_directory',{id:user,name:'Viewer'});insert('user_directory',{id:sender,name:'Sender'});
  insert('notification_preferences',{id:'prefs0000000001',user,alerts_paused_until:'',auto_advance:mode,revision:1});
  for(let i=1;i<=count;i++) {
    const created=new Date(Date.UTC(2026,9,1,0,count-i)).toISOString(),id=noteId(i);
    insert('notifications',{id,sender,subject:`Notification ${i}`,body_markdown:`Synthetic message ${i}`,kind:'review_requested',ack_required:1,revision:1,created});
    insert('notification_recipients',{id:'recp'+String(i).padStart(11,'0'),notification:id,recipient:user,revision:1,created});
    insert('notification_conversation_state',{id:'state'+String(i).padStart(10,'0'),notification:id,user,latest_at:created,activity_version:1,read_version:0,revision:1});
  }
  await page.addInitScript(()=>{window.EventSource=class extends EventTarget {constructor(){super();setTimeout(()=>this.dispatchEvent(new MessageEvent('PB_CONNECT',{data:'{}',lastEventId:'synthetic'})),0);}close(){}};});
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url()),body=request.postDataJSON();let data={};
    if(url.pathname.endsWith('/auth-with-password') || url.pathname.endsWith('/auth-refresh'))data={token:token(user),record:{id:user,name:'Viewer',email:'viewer@example.test',collectionName:'users'}};
    else if(url.pathname==='/api/context/query'){
      queries.push(body.sql);const records=db.prepare(body.sql).all();data={columns:Object.keys(records[0]||{}),rows:records.map(Object.values),truncated:false};
    }else if(url.pathname.includes('/api/collections/')) {
      writes.push({path:url.pathname,body});const [,table,id]=url.pathname.match(/\/collections\/([^/]+)\/records\/?([^/]*)/)||[];
      const row=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
      if(table==='notification_preferences') {
        for(const field of ['auto_advance','alerts_paused_until'])if(field in body)db.prepare(`UPDATE ${table} SET ${field}=? WHERE id=?`).run(body[field],id);
        db.prepare(`UPDATE ${table} SET revision=revision+1 WHERE id=?`).run(id);
      }else {
        const action=body.action,notification=row.notification,at=new Date().toISOString();
        for(const target of ['notification_recipients','notification_conversation_state']){
          if(['archive','read_archive','acknowledge_archive'].includes(action))db.prepare(`UPDATE ${target} SET archived_at=? WHERE notification=?`).run(at,notification);
          if(['read','read_archive','acknowledge_archive'].includes(action))db.prepare(`UPDATE ${target} SET read_at=? WHERE notification=?`).run(at,notification);
          if(action==='unarchive')db.prepare(`UPDATE ${target} SET archived_at='' WHERE notification=?`).run(notification);
          db.prepare(`UPDATE ${target} SET revision=revision+1 WHERE notification=?`).run(notification);
        }
        if(['acknowledge','acknowledge_archive'].includes(action))db.prepare('UPDATE notification_recipients SET acknowledged_at=?,acknowledgement_markdown=? WHERE notification=?').run(at,body.acknowledgement_markdown||'',notification);
      }
      data=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/');await page.getByText('Local test sign-in').click();await page.getByLabel('Email',{exact:true}).fill('viewer@example.test');await page.getByLabel('Password',{exact:true}).fill('synthetic');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.locator('#connection')).toContainText('Connected');
  return {db,writes,queries};
}
async function open(page,i){await page.locator(`.notification-row[data-id="${noteId(i)}"]`).click();await expect(page.locator('.detail-title')).toHaveText(`Notification ${i}`);}
async function archive(page){await page.getByRole('button',{name:'Other conversation actions',exact:true}).click();await page.locator('.conversation-triage').getByRole('button',{name:'Archive',exact:true}).click();}
const title=page=>page.locator('.detail-title');

for(const [mode,source,destination] of [['next',2,3],['previous',2,1]])test(`auto-advance ${mode} selects the adjacent conversation without reading it`,async({page})=>{
  const mock=await fixture(page,{mode});await open(page,source);await archive(page);await expect(title(page)).toHaveText(`Notification ${destination}`);
  expect(mock.writes.map(w=>w.body.action)).toEqual(['archive']);
  expect(mock.db.prepare('SELECT read_at,acknowledged_at FROM notification_recipients WHERE notification=?').get(noteId(destination))).toEqual({read_at:'',acknowledged_at:''});
  await expect(page.locator(`.notification-row[data-id="${noteId(destination)}"]`)).toHaveClass(/selected/);
});
for(const [mode,source,destination,pageLabel] of [['next',30,31,'Page 1'],['previous',31,30,'Page 1']])test(`auto-advance ${mode} crosses a page boundary without skipping`,async({page})=>{
  await fixture(page,{count:65,mode});if(source===31)await page.getByRole('button',{name:'Next →'}).click();await open(page,source);await archive(page);
  await expect(title(page)).toHaveText(`Notification ${destination}`);await expect(page.locator('#page-label')).toHaveText(pageLabel);
  await expect(page.locator(`.notification-row[data-id="${noteId(destination)}"]`)).toHaveClass(/selected/);
});
for(const [mode,source] of [['next',4],['previous',1],['list',2]])test(`auto-advance ${mode} returns to list at the boundary or by preference`,async({page})=>{
  await fixture(page,{mode});await open(page,source);await archive(page);await expect(page.locator('.detail-placeholder')).toBeVisible();await expect(page).not.toHaveURL(/notifications\//);
});
test('auto-advance preserves current search and unread filter and stays inside results',async({page})=>{
  const mock=await fixture(page);mock.db.exec("UPDATE notifications SET subject='Other result' WHERE id='note00000000003'");
  await page.evaluate(()=>{location.hash='#/?view=inbox&filter=unread&q=Notification';});await expect(page.locator('.notification-row')).toHaveCount(3);await open(page,2);await archive(page);await expect(title(page)).toHaveText('Notification 4');await expect(page).toHaveURL(/filter=unread/);await expect(page.locator('#search')).toHaveValue('Notification');
});
test('auto-advance direct link outside current results returns to the list',async({page})=>{
  await fixture(page);await page.evaluate(()=>{location.hash='#/notifications/note00000000002?view=inbox&q=Notification%201';});await expect(title(page)).toHaveText('Notification 2');await archive(page);await expect(page.locator('.detail-placeholder')).toBeVisible();await expect(page.locator('#search')).toHaveValue('Notification 1');
});
for(const action of ['Read & archive','Acknowledge & archive'])test(`auto-advance follows ${action} with only the explicit combined write`,async({page})=>{
  const mock=await fixture(page);await open(page,1);if(action.startsWith('Acknowledge'))await page.locator('#ack-note').fill('Received');
  await page.getByRole('button',{name:action,exact:true}).click();await expect(title(page)).toHaveText('Notification 2');expect(mock.writes).toHaveLength(1);expect(mock.writes[0].body.action).toBe(action.startsWith('Read')?'read_archive':'acknowledge_archive');
  expect(mock.db.prepare('SELECT read_at,acknowledged_at FROM notification_recipients WHERE notification=?').get(noteId(2))).toEqual({read_at:'',acknowledged_at:''});
});
test('auto-advance preserves unsent comment and acknowledgement drafts on return',async({page})=>{
  await fixture(page);await open(page,1);await page.locator('#comment-body').fill('Keep this comment');await page.locator('#ack-note').fill('Keep private note');await archive(page);await expect(title(page)).toHaveText('Notification 2');await page.goBack();await expect(title(page)).toHaveText('Notification 1');await expect(page.locator('#comment-body')).toHaveValue('Keep this comment');await expect(page.locator('#ack-note')).toHaveValue('Keep private note');
});
for(const status of [409,500])test(`auto-advance stays on the conversation after HTTP ${status}`,async({page})=>{
  await fixture(page);await open(page,1);await page.route('**/api/collections/notification_conversation_state/records/*',route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({status,message:'Synthetic failure'})}));await archive(page);await expect(page.locator('#notice')).toBeVisible();await expect(title(page)).toHaveText('Notification 1');
});
test('auto-advance cannot override manual navigation while archive is pending',async({page})=>{
  await fixture(page);await open(page,1);let release,started;const gate=new Promise(r=>{release=r;}),pending=new Promise(r=>{started=r;});
  await page.route('**/api/collections/notification_conversation_state/records/*',async route=>{started();await gate;await route.fallback();});await archive(page);await pending;await open(page,4);release();await page.waitForTimeout(500);await expect(title(page)).toHaveText('Notification 4');
});
test('auto-advance settings persist independently from alert pauses; stay retains current behavior',async({page})=>{
  const mock=await fixture(page,{mode:'stay'});await page.locator('#settings').click();await mkdir('/tmp/notifycontext-auto-advance',{recursive:true});await page.screenshot({path:'/tmp/notifycontext-auto-advance/settings-desktop.png'});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/notifycontext-auto-advance/settings-mobile.png'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.setViewportSize({width:1280,height:720});await expect(page.getByLabel('After archiving a conversation')).toHaveValue('stay');await page.getByLabel('After archiving a conversation').selectOption('previous');await page.getByRole('button',{name:'Save general settings',exact:true}).click();await expect(page.locator('#dialog')).not.toBeVisible();
  await page.locator('#settings').click();await expect(page.getByLabel('After archiving a conversation')).toHaveValue('previous');await page.getByLabel('Pause duration').selectOption('30');await page.getByRole('button',{name:'Save alert preference',exact:true}).click();expect(mock.db.prepare('SELECT auto_advance FROM notification_preferences').get().auto_advance).toBe('previous');
  await page.locator('#settings').click();await page.getByLabel('After archiving a conversation').selectOption('stay');await page.getByRole('button',{name:'Save general settings',exact:true}).click();expect(mock.db.prepare('SELECT alerts_paused_until FROM notification_preferences').get().alerts_paused_until).not.toBe('');await open(page,1);await archive(page);await expect.poll(()=>mock.db.prepare('SELECT archived_at FROM notification_conversation_state WHERE notification=?').get(noteId(1)).archived_at).not.toBe('');await expect(title(page)).toHaveText('Notification 1');
});

test('auto-advance keeps the captured neighbor when new activity reorders the inbox',async({page})=>{
  const mock=await fixture(page);await open(page,2);
  await page.route('**/api/collections/notification_conversation_state/records/*',async route=>{
    mock.db.prepare('UPDATE notification_conversation_state SET latest_at=? WHERE notification=?').run(new Date().toISOString(),noteId(4));
    await route.fallback();
  });
  await archive(page);await expect(title(page)).toHaveText('Notification 3');
});
test('auto-advance skips a neighbor archived concurrently and clamps an emptied final page',async({page})=>{
  const mock=await fixture(page,{count:31});await page.getByRole('button',{name:'Next →'}).click();await open(page,31);await archive(page);await expect(page.locator('.detail-placeholder')).toBeVisible();await expect(page.locator('#page-label')).toHaveText('Page 1');
  await open(page,2);await page.route('**/api/collections/notification_conversation_state/records/*',async route=>{mock.db.prepare("UPDATE notification_conversation_state SET archived_at='2026-10-02' WHERE notification=?").run(noteId(3));await route.fallback();});await archive(page);await expect(title(page)).toHaveText('Notification 4');
});
test('auto-advance does not restore private detail after sign-out during archive',async({page})=>{
  await fixture(page);await open(page,1);let release,started;const gate=new Promise(r=>{release=r;}),pending=new Promise(r=>{started=r;});
  await page.route('**/api/collections/notification_conversation_state/records/*',async route=>{started();await gate;await route.fallback();});await archive(page);await pending;
  await page.getByRole('button',{name:'Sign out',exact:true}).click();release();await expect(page.getByRole('button',{name:'Continue with Google'})).toBeVisible();await page.waitForTimeout(300);await expect(title(page)).toHaveCount(0);
});
test('auto-advance works on mobile and transfers keyboard focus into the destination',async({page})=>{
  await page.setViewportSize({width:390,height:844});await fixture(page);await open(page,1);await page.locator('.conversation-triage').getByRole('button',{name:'Read & archive',exact:true}).focus();await page.keyboard.press('Enter');await expect(title(page)).toHaveText('Notification 2');
  await expect(page.locator('#detail')).toHaveClass(/open/);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.locator('#detail').evaluate(el=>el.contains(document.activeElement))).toBe(true);
});
