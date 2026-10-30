import {chromium,expect} from '@playwright/test';
async function revealAction(page,name,feedback=false){
 const button=page.getByRole('button',{name,exact:true});
 const toggle=page.getByRole('button',{name:feedback?'Other feedback actions':'Other message actions',exact:true});
 await expect(page.locator('.actions button:disabled')).toHaveCount(0);
 await expect.poll(async()=>await button.isVisible() || await toggle.isVisible()).toBe(true);
 if(!await button.isVisible())await toggle.click();
 return button;
}
async function chooseAction(page,name,feedback=false){await (await revealAction(page,name,feedback)).click();}
import assert from 'node:assert/strict';
const base=process.env.NOTIFYCONTEXT_TEST_URL,token=process.env.NOTIFYCONTEXT_LATER_TOKEN,r=JSON.parse(process.env.NOTIFYCONTEXT_LATER_ROW);
const browser=await chromium.launch();
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.notificationCalls=[];window.Notification=class{static permission='granted';constructor(title,options){window.notificationCalls.push({title,...options});}close(){}};});
 await page.goto(base);await page.getByText('Local test sign-in').click();
 await page.getByLabel('Email',{exact:true}).fill('sender@example.com');
 await page.getByLabel('Password',{exact:true}).fill('SyntheticUserPassword123!');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.locator('#unread-count')).toHaveText('19');
 await expect(page.locator('.notification-row')).toHaveCount(19);
 assert.equal(await page.evaluate(()=>window.notificationCalls.length),0,'Historical backfill is quiet');
 await page.locator('#search').fill('Amazing feature!');
 await expect(page.locator('.notification-row')).toHaveCount(1);
 await expect(page.locator('.notification-row')).toContainText('Preview Reviewer replied');
 await page.locator('.notification-row').click();
 await expect(await revealAction(page,'Mark comments read',true)).toBeVisible();
 await expect(page.locator('#unread-count')).toHaveText('19'); // Opening is read-only.
 await chooseAction(page,'Mark comments read',true);
 await expect(page.locator('#unread-count')).toHaveText('18');
 await expect(page.locator('.notification-row')).not.toHaveClass(/unread/);
 await chooseAction(page,'Archive comments',true);
 await expect(page.locator('.notification-row')).toHaveCount(0);
 await page.reload();await expect(page.locator('#unread-count')).toHaveText('18');
 await page.getByRole('button',{name:'Archived',exact:true}).click();
 await expect(page.locator('.notification-row')).toHaveCount(1);
 await page.locator('.notification-row').click();
 await expect(await revealAction(page,'Move comments to inbox',true)).toBeVisible();
 await page.getByRole('button',{name:'Sent',exact:false}).click();
 await expect(page.locator('.notification-row')).toHaveCount(1); // Sent survives sender archive.
 await page.locator('[data-view="inbox"]').click();await page.locator('#search').fill('');
 await expect(page.locator('.notification-row')).toHaveCount(18);
 const response=await fetch(base+'/api/collections/notification_recipients/records/'+r.id,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:token},body:JSON.stringify({expected_revision:r.revision,action:'acknowledge',acknowledgement_markdown:'Another useful comment'})});
 assert.equal(response.status,200,await response.text());
 await expect(page.locator('#unread-count')).toHaveText('19',{timeout:10000});
 const first=page.locator('.notification-row').first();
 await expect(first).toContainText('Later Reviewer replied');await expect(first).toContainText('Another useful comment');await expect(first).toHaveClass(/unread/);
 await expect.poll(()=>page.evaluate(()=>window.notificationCalls.length)).toBe(1);
 await first.click();await expect(await revealAction(page,'Mark comments read',true)).toBeVisible();
 await page.getByRole('button',{name:'Refresh notifications',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.notificationCalls.length),1,'Refresh must not duplicate alerts');
 await page.screenshot({path:'test-results/feedback-preview.png',fullPage:true});
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
