import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
const cwd=fileURLToPath(new URL('../',import.meta.url));const {chromium,expect}=createRequire(cwd+'/package.json')('@playwright/test');
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3062'],{cwd,stdio:'ignore'});let browser;
try{
 for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:3062')).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
 browser=await chromium.launch({headless:true});const page=await browser.newPage();await page.clock.install();
 let calls=0,status='ready';const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('pageerror',e.message);});
 await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.hostname!=='127.0.0.1')return route.abort();
 if(u.pathname==='/api/me'){calls++;return route.fulfill({json:{user:{id:'test-user',name:'Polling test'},identities:[],processingMode:'server',selected:'test-workspace',workspaces:[{id:'test-workspace',name:'Polling workspace',role:'owner'}],meetings:[{id:'test-meeting',workspace_id:'test-workspace',title:'Polling fixture',status,created_at:new Date().toISOString(),duration:null,visibility:'private',transcript:[],notes:null,version:1}]}});}
 if(u.pathname.startsWith('/api/'))return route.fulfill({json:{enabled:false,profile:null,items:[],actions:[]}});return route.continue();});
 await page.goto('http://127.0.0.1:3062');await expect(page.getByText('Polling fixture',{exact:true})).toBeVisible();
 await page.clock.pauseAt(new Date(Date.now()+1000));const base=calls;
 await page.clock.runFor(10000);assert.equal(calls,base,'idle should not poll after five seconds');
 await page.clock.runFor(20000);await expect.poll(()=>calls).toBe(base+1);
 status='queued';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>calls).toBe(base+2);
 await expect(page.getByText('queued',{exact:true})).toBeVisible();await page.clock.runFor(5100);await expect.poll(()=>calls).toBe(base+3);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});const hidden=calls;
 await page.clock.runFor(120000);assert.equal(calls,hidden,'background must not poll');
 status='ready';await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect.poll(()=>calls).toBe(hidden+1);
 await expect(page.getByText('ready',{exact:true})).toBeVisible();await page.clock.runFor(10000);assert.equal(calls,hidden+1);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks:['idle 30s','active job 5s','focus refresh','background silence','resume refresh','completed job returns to idle']}));
}finally{await browser?.close();server.kill('SIGTERM');}
