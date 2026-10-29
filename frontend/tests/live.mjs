import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
const base=process.env.NOTIFYCONTEXT_TEST_URL,tokens=JSON.parse(process.env.NOTIFYCONTEXT_TEST_TOKENS||'{}'),fixture=process.env.NOTIFYCONTEXT_TEST_FIXTURE;
const browser=await chromium.launch({headless:true});
// Every SQL read the page sends; request budgets are measured on the real server and realtime stream.
function track(page){const log=[];page.on('request',request=>{if(request.url().endsWith('/api/context/query'))log.push(request.postDataJSON().sql);});return log;}
async function signIn(page,email){
 await page.getByText('Local test sign-in').click();
 await page.getByLabel('Email',{exact:true}).fill(email);
 await page.getByLabel('Password',{exact:true}).fill('SyntheticUserPassword123!');
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
}
const sql=async(token,text)=>{const response=await fetch(base+'/api/context/query',{method:'POST',headers:{'Content-Type':'application/json',Authorization:token},body:JSON.stringify({sql:text})});return {status:response.status,body:await response.json()};};
const records=result=>result.body.rows.map(row=>Object.fromEntries(result.body.columns.map((column,i)=>[column,row[i]])));
try {
 if(process.env.NOTIFYCONTEXT_TEST_MODE==='limit') {
  const page=await (await browser.newContext({viewport:{width:1440,height:1000}})).newPage(),errors=[],log=track(page);
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await signIn(page,'bob@example.com');
  await page.locator('#connection').filter({hasText:'Connected'}).waitFor();
  // Exhaust this client IP's /api/context/ bucket, as other tabs or colleagues behind one NAT would.
  let limited;for(let i=0;i<80 && !limited;i++){const result=await sql(tokens.bob,'SELECT id FROM user_directory LIMIT 1');if(result.status===429)limited=result;}
  assert.ok(limited,'expected a 429 from the deployment rate limit');
  const before=log.length;
  await page.getByRole('heading',{name:'Supplier renewal ready',exact:true}).click();
  await page.locator('#detail').filter({hasText:/NotifyContext is busy\. Retrying in \d+s\./}).waitFor();
  await expect(page.getByText(/Too Many Requests/)).toHaveCount(0);
  await page.getByRole('button',{name:'Refresh notifications',exact:true}).click();
  await page.locator('#notice').filter({hasText:/busy/}).waitFor();
  // Recovery re-opens the same selection automatically once the window resets.
  await page.locator('.detail-title').filter({hasText:'Supplier renewal ready'}).waitFor({timeout:40000});
  await expect(page.getByText(/Too Many Requests/)).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Mark read',exact:true})).toBeVisible();
  await page.locator('#connection').filter({hasText:'Connected'}).waitFor({timeout:40000});
  assert.deepEqual(errors,[]);
  console.log(`Rate-limited reads recovered: ${log.length-before} SQL requests from the browser during the cooldown and recovery.`);
 } else {
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await context.newPage(),errors=[],log=track(page),counts={};
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base);
 await signIn(page,'bob@example.com');
 await page.locator('#connection').filter({hasText:'Connected'}).waitFor();
 const peer=await page.context().newPage();
 await peer.goto(base);
 await peer.locator('#connection').filter({hasText:'Connected'}).waitFor();
 await peer.reload();await peer.locator('#connection').filter({hasText:'Connected'}).waitFor();
 await peer.getByRole('button',{name:'Sign out',exact:true}).click();
 await page.getByRole('button',{name:'Continue with Google'}).waitFor();
 await page.reload();await page.getByRole('button',{name:'Continue with Google'}).waitFor();
 let mark=log.length;
 await signIn(page,'bob@example.com');
 await peer.locator('#connection').filter({hasText:'Connected'}).waitFor();
 await page.locator('#connection').filter({hasText:'Connected'}).waitFor();await page.waitForTimeout(3000);counts.startup=log.length-mark;
 await expect(peer).toHaveTitle('(1) NotifyContext');
 mark=log.length;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForTimeout(3000);counts.steady=log.length-mark;
 mark=log.length;
 await page.getByRole('heading',{name:'Supplier renewal ready',exact:true}).click();
 await page.locator('article strong').filter({hasText:'terms'}).waitFor();await page.waitForTimeout(1000);counts.detail=log.length-mark;
 // Opening the detail shows only Bob's own recipient row and its actions.
 await expect(page.locator('.recipient-status')).toHaveCount(0);await expect(page.locator('.references a')).toHaveText(/Renewal terms/);
 mark=log.length;
 await page.getByRole('button',{name:'Mark read',exact:true}).click();
 await page.getByRole('button',{name:'Mark read',exact:true}).waitFor({state:'detached'});
 // A separate open tab must receive the committed change before fallback polling.
 await expect(peer).toHaveTitle('NotifyContext',{timeout:5000});await peer.close();
 await page.waitForTimeout(3000);counts.action=log.length-mark;
 await page.getByLabel('Optional acknowledgement note').fill('Received; reviewing this afternoon.');
 await page.getByRole('button',{name:'Acknowledge',exact:true}).click();
 await page.locator('.acknowledgement').filter({hasText:'Received; reviewing this afternoon.'}).waitFor();
 await page.getByRole('button',{name:'Archive',exact:true}).click();
 await page.getByRole('button',{name:'Move to inbox',exact:true}).waitFor();
 await expect(page.locator('.notification-row').filter({hasText:'Supplier renewal ready'})).toHaveCount(0);
 await page.getByRole('button',{name:'Archived',exact:false}).click();
 await page.locator('.notification-row').filter({hasText:'Supplier renewal ready'}).waitFor();
 // Privacy of the consolidated detail statement, replayed exactly as the browser sent it.
 const detailSql=log.find(text=>text.includes(') AS recipients') && text.includes(fixture));assert.ok(detailSql,'detail SQL captured');
 const view=async who=>{const result=await sql(tokens[who],detailSql);assert.equal(result.status,200);const [row]=records(result);return row && {...row,people:JSON.parse(row.recipients),refs:JSON.parse(row.refs)};};
 const [asAlice,asBob,asCarol,asDave]=await Promise.all(['alice','bob','carol','dave'].map(view));
 assert.equal(asAlice.people.length,2);assert.equal(asAlice.recipient_total,2);assert.equal(asAlice.refs.length,1);
 assert.equal(asBob.people.length,1);assert.equal(asBob.people[0].acknowledgement_markdown,'Received; reviewing this afternoon.');assert.ok(asBob.people[0].read_at && asBob.people[0].archived_at && asBob.people[0].revision>1);
 assert.equal(asCarol.people.length,1);assert.notEqual(asCarol.people[0].id,asBob.people[0].id);assert.equal(asCarol.people[0].acknowledged_at,'');
 assert.equal(asDave,undefined);
 // Sender view includes Bob's state; another recipient's state never reaches Carol.
 assert.ok(asAlice.people.some(person=>person.id===asBob.people[0].id && person.acknowledged_at));
 await page.getByRole('button',{name:'New notification'}).click();
 await page.getByLabel('To',{exact:true}).selectOption(process.env.NOTIFYCONTEXT_TEST_ALICE);
 await page.getByLabel('Subject',{exact:true}).fill('Budget approval requested');
 await page.locator('#body').fill('## Budget\nPlease review **the totals**.');
 await page.getByLabel('Request acknowledgement',{exact:true}).check();
 await page.getByRole('button',{name:'Send notification',exact:true}).click();
 await page.locator('#dialog').waitFor({state:'hidden'});
 await page.locator('.detail-title').filter({hasText:'Budget approval requested'}).waitFor();
 await page.getByRole('button',{name:'Sent',exact:false}).click();
 await page.locator('.notification-row').filter({hasText:'Budget approval requested'}).waitFor();
 await page.locator('#settings').click();
 await page.getByLabel('Status',{exact:true}).selectOption('in_a_meeting');
 await page.getByRole('button',{name:'Save status',exact:true}).click();
 await page.locator('#my-status').filter({hasText:'In a meeting'}).waitFor();
 await page.locator('#settings').click();
 await page.getByLabel('Pause duration',{exact:true}).selectOption('30');
 await page.getByRole('button',{name:'Save alert preference',exact:true}).click();
 await page.locator('#dialog').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'New notification'}).click();
 await page.getByLabel('Recipient emails',{exact:true}).fill('alice@example.com, new.colleague@example.com');
 await page.getByLabel('Subject',{exact:true}).fill('Email-addressed handoff');
 await page.locator('#body').fill('A handoff for existing and new colleagues.');
 await page.getByRole('button',{name:'Send notification',exact:true}).click();
 await page.locator('#dialog').waitFor({state:'hidden'});
 await page.locator('.detail-title').filter({hasText:'Email-addressed handoff'}).waitFor();
 await page.locator('.recipient-status').getByText('Awaiting first sign-in',{exact:true}).waitFor();
 await page.locator('.recipient-status').getByText('new.colleague@example.com',{exact:true}).waitFor();
 await page.locator('.recipient-status').getByText('Unread',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Sent',exact:false}).click();
 await page.locator('.notification-row').filter({hasText:'Email-addressed handoff'}).click();
 await page.locator('.recipient-status').getByText('Awaiting first sign-in',{exact:true}).waitFor();
 await page.screenshot({path:process.env.NOTIFYCONTEXT_SCREENSHOT || '/tmp/notifycontext-live-desktop.png',fullPage:true});
 // The sender's maximum-size notification: a character-safe excerpt and all 100 long multibyte acknowledgements.
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await signIn(page,'alice@example.com');
 await page.locator('#connection').filter({hasText:'Connected'}).waitFor();
 await page.getByRole('button',{name:'Sent',exact:false}).click();
 const largeRow=page.locator('.notification-row').filter({hasText:'界界界'});await largeRow.waitFor();
 const excerpt=await largeRow.locator('.excerpt').textContent();assert.equal([...excerpt].length,140);assert.equal(excerpt,'😀'.repeat(140));
 mark=log.length;await largeRow.click();
 await expect(page.locator('.recipient-status > div')).toHaveCount(100,{timeout:15000});
 await expect(page.locator('.recipient-status .markdown').first()).toHaveText('界'.repeat(4000));
 assert.ok((await page.locator('article').textContent()).includes(' éñd'));
 counts.largeDetail=log.length-mark;assert.ok(counts.largeDetail>1,'oversized aggregate used the bounded fallback');
 const large=await sql(tokens.alice,log.slice(mark).find(text=>text.includes(') AS recipients')));assert.equal(large.status,400);assert.match(large.body.message,/too big/);
 assert.deepEqual(errors,[]);
 console.log('SQL requests measured in the browser:',JSON.stringify(counts));
 console.log('Actual-server browser workflow passed: auth, consolidated filtered SQL inbox/detail, sender/recipient/unrelated privacy, read, acknowledge, archive, compose, sent, status, pause and oversized fallback.');
 }
} finally {await browser.close();}
