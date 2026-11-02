import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const base=process.env.NOTIFYCONTEXT_TEST_URL,token=process.env.NOTIFYCONTEXT_TEST_TOKEN;
const browser=await chromium.launch(),errors=[];
async function query(sql){const response=await fetch(base+'/api/context/query',{method:'POST',headers:{'Content-Type':'application/json',Authorization:token},body:JSON.stringify({sql})});assert.equal(response.status,200);const data=await response.json();return data.rows.map(row=>Object.fromEntries(data.columns.map((key,i)=>[key,row[i]])));}
async function archive(page){await page.getByRole('button',{name:'Other conversation actions',exact:true}).click();await page.locator('.conversation-triage').getByRole('button',{name:'Archive',exact:true}).click();}
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.getByText('Local test sign-in').click();await page.getByLabel('Email',{exact:true}).fill('bob@example.com');await page.getByLabel('Password',{exact:true}).fill('SyntheticUserPassword123!');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('.notification-row')).toHaveCount(30);
 const rows=await query('SELECT notification FROM notification_conversation_state WHERE activity_version>0 ORDER BY latest_at DESC,notification DESC');
 const source=rows[29].notification,destination=rows[30].notification;
 await page.locator(`.notification-row[data-id="${source}"]`).click();await archive(page);await expect(page.locator('#detail')).toHaveAttribute('data-id',destination);await expect(page.locator(`.notification-row[data-id="${destination}"]`)).toHaveClass(/selected/);await expect(page.locator('#page-label')).toHaveText('Page 1');
 let [recipient]=await query(`SELECT read_at,acknowledged_at FROM notification_recipients WHERE notification='${destination}'`);assert.deepEqual(recipient,{read_at:'',acknowledged_at:''});
 await page.locator('#settings').click();await page.getByLabel('After archiving a conversation').selectOption('previous');await page.getByRole('button',{name:'Save general settings',exact:true}).click();await expect(page.locator('#dialog')).not.toBeVisible();
 await page.getByRole('button',{name:'Next →'}).click();const previousSource=rows[31].notification;await page.locator(`.notification-row[data-id="${previousSource}"]`).click();await archive(page);await expect(page.locator('#detail')).toHaveAttribute('data-id',destination);await expect(page.locator('#page-label')).toHaveText('Page 1');
 [recipient]=await query(`SELECT read_at,acknowledged_at FROM notification_recipients WHERE notification='${destination}'`);assert.deepEqual(recipient,{read_at:'',acknowledged_at:''});
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
