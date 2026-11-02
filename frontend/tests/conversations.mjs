import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const base=process.env.NOTIFYCONTEXT_TEST_URL,id=process.env.NOTIFYCONTEXT_TEST_FIXTURE,tokens=JSON.parse(process.env.NOTIFYCONTEXT_TEST_TOKENS);
const browser=await chromium.launch(),errors=[];
async function api(who,path,body,method='POST'){
 const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:tokens[who]},body:JSON.stringify(body)});
 assert.equal(response.status,200,await response.clone().text());return response.json();
}
async function query(who,sql){const data=await api(who,'/api/context/query',{sql});return data.rows.map(row=>Object.fromEntries(data.columns.map((key,i)=>[key,row[i]])));}
async function state(who){return (await query(who,`SELECT * FROM notification_conversation_state WHERE notification='${id}'`))[0];}
async function open(who,width=1440){
 const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.notificationCalls=[];window.Notification=class{static permission='granted';constructor(title,options){window.notificationCalls.push({title,...options});}close(){}};});
 await page.goto(base+'/#/notifications/'+id);await page.getByText('Local test sign-in').click();await page.getByLabel('Email',{exact:true}).fill(who+'@example.com');await page.getByLabel('Password',{exact:true}).fill('SyntheticUserPassword123!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('.detail-title')).toHaveText('Conversation browser review');return page;
}
async function post(page,body){await page.getByLabel('Add a comment').fill(body);await page.getByRole('button',{name:'Post comment',exact:true}).click();await expect(page.getByLabel('Add a comment')).toHaveValue('');}
try{
 const alice=await open('alice'),carol=await open('carol',390);
 await expect(alice.locator('.recipient-status')).toContainText('Private acknowledgement from Bob');
 await expect(carol.locator('#detail')).not.toContainText('Private acknowledgement from Bob');
 assert.equal((await query('carol','SELECT * FROM notification_comments')).length,0);
 const before=await state('carol');await post(carol,'**First shared comment**');await post(carol,'Second shared comment');
 assert.deepEqual(await state('carol'),before,'Posting does not read or acknowledge your own delivery');
 await expect(alice.locator('.conversation-comment')).toHaveCount(2,{timeout:10000});
 await expect(carol.locator('.conversation-comment')).toHaveCount(2);
 assert.equal((await query('carol',`SELECT acknowledged_at FROM notification_recipients WHERE notification='${id}'`))[0].acknowledged_at,'');
 await carol.getByRole('button',{name:'Read & archive conversation',exact:true}).click();await expect(carol.locator('.notification-row')).toHaveCount(0);
 await carol.getByLabel('Add a comment').fill('A draft while someone else replies');
 await post(alice,'Sender response: searchable discussion phrase');
 await expect(carol.locator('.notification-row')).toHaveCount(1,{timeout:10000});await expect(carol.locator('.notification-row')).toHaveClass(/unread/);
 await expect(carol.locator('.conversation-comment')).toHaveCount(3,{timeout:10000});await expect(carol.getByLabel('Add a comment')).toHaveValue('A draft while someone else replies');
 assert.equal((await state('carol')).read_at,'');assert.equal((await state('carol')).archived_at,'');
 await expect.poll(()=>carol.evaluate(()=>window.notificationCalls.length)).toBe(1);
 await carol.evaluate(()=>window.dispatchEvent(new Event('online')));assert.equal(await carol.evaluate(()=>window.notificationCalls.length),1);
 await carol.getByRole('button',{name:'← Back to inbox',exact:true}).click();await carol.locator('#search').fill('searchable discussion phrase');await expect(carol.locator('.notification-row')).toHaveCount(1);await carol.locator('.notification-row').click();
 assert.equal((await query('eve','SELECT * FROM notification_comments')).length,0);
 // Another tab/agent can append enough comments to require bounded chronological pages.
 for(let i=0;i<32;i++)await api('bob','/api/collections/notification_comments/records',{notification:id,body_markdown:'Pagination comment '+i,submission_key:'browser-page-'+i});
 await carol.evaluate(()=>window.dispatchEvent(new Event('online')));await expect(carol.locator('.conversation-comment')).toHaveCount(30,{timeout:10000});
 await carol.getByRole('button',{name:'Load earlier comments',exact:true}).click();await expect(carol.locator('.conversation-comment')).toHaveCount(35);
 await expect(carol.locator('.conversation-comment').first()).toContainText('First shared comment');await expect(carol.locator('.conversation-comment').last()).toContainText('Pagination comment 31');
 await expect(carol.getByLabel('Add a comment')).toHaveValue('A draft while someone else replies');
 await carol.getByLabel('Add a comment').focus();await carol.getByLabel('Add a comment').evaluate(el=>el.setSelectionRange(2,7));
 await api('bob','/api/collections/notification_comments/records',{notification:id,body_markdown:'After expanding history',submission_key:'after-expand'});
 await expect(carol.locator('.conversation-comment')).toHaveCount(36,{timeout:10000});
 await expect(carol.getByLabel('Add a comment')).toBeFocused();assert.deepEqual(await carol.getByLabel('Add a comment').evaluate(el=>[el.selectionStart,el.selectionEnd]),[2,7]);
 assert.equal(await carol.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await mkdir('/tmp/notifycontext-conversation-checks',{recursive:true});
 await carol.screenshot({path:'/tmp/notifycontext-conversation-checks/mobile.png',fullPage:true});await alice.screenshot({path:'/tmp/notifycontext-conversation-checks/desktop.png',fullPage:true});
 const [notification]=await query('alice',`SELECT revision FROM notifications WHERE id='${id}'`);
 await api('alice','/api/collections/notifications/records/'+id,{expected_revision:notification.revision,action:'withdraw',withdrawal_reason:'Conversation complete'},'PATCH');
 await expect(carol.locator('#comment-form')).toHaveCount(0,{timeout:10000});await expect(carol.locator('.conversation')).toContainText('closed to new comments');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
