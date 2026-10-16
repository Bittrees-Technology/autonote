// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {startVisiblePolling} from '../lib/visible-polling.mjs';
function fixture() {
 const doc=new EventTarget(),win=new EventTarget();doc.hidden=false;
 let next=0;const pending=new Map();
 const timers={setTimeout(fn,delay){pending.set(++next,{fn,delay});return next;},clearTimeout(id){pending.delete(id);}};
 return {doc,win,timers,pending,hide(v){doc.hidden=v;doc.dispatchEvent(new Event('visibilitychange'));},focus(){win.dispatchEvent(new Event('focus'));},async tick(){const [id,item]=pending.entries().next().value;pending.delete(id);await item.fn();}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('hidden tabs make no calls; returning refreshes immediately and cleanup removes listeners',async()=>{
 const f=fixture();f.doc.hidden=true;let calls=0;
 const stop=startVisiblePolling(async()=>{calls++;},{...f,intervalMs:15000});
 await settle();assert.equal(calls,0);assert.equal(f.pending.size,0);
 f.hide(false);await settle();assert.equal(calls,1);assert.equal(f.pending.size,1);
 f.hide(true);assert.equal(f.pending.size,0);f.focus();await settle();assert.equal(calls,1);
 f.hide(false);await settle();assert.equal(calls,2);stop();f.focus();await settle();assert.equal(calls,2);assert.equal(f.pending.size,0);
});
test('slow requests never overlap and completion after unmount schedules nothing',async()=>{
 const f=fixture();let done,calls=0;
 const stop=startVisiblePolling(()=>{calls++;return new Promise(r=>{done=r;});},{...f,intervalMs:5000});
 f.focus();f.hide(true);f.hide(false);assert.equal(calls,1);assert.equal(f.pending.size,0);
 stop();done();await settle();assert.equal(f.pending.size,0);
});
test('polling resumes after failures and retains the configured live cadence',async()=>{
 const f=fixture();let calls=0,errors=0;
 const stop=startVisiblePolling(async()=>{calls++;if(calls===1)throw Error('offline');},{...f,intervalMs:5000,onError:()=>errors++});
 await settle();assert.equal(errors,1);assert.equal([...f.pending.values()][0].delay,5000);
 await f.tick();assert.equal(calls,2);assert.equal(f.pending.size,1);stop();
});
