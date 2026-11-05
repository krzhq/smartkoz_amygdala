const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'smartkoz-assistant-'));
process.env.NODE_ENV='test';process.env.SMARTKOZ_DB=path.join(temp,'test.db');process.env.SMARTKOZ_UPLOADS=path.join(temp,'uploads');
const env=require('../lib/env'),originalSetting=env.get,originalFetch=global.fetch;
let key='first-test-key',model='openai/gpt-oss-20b',failure=null,calls=[],server,base,cookie;
env.get=name=>name==='GROQ_API_KEY'?key:name==='GROQ_MODEL'?model:originalSetting(name);
global.fetch=async(url,options)=>{
  if(!String(url).startsWith('https://api.groq.com/'))return originalFetch(url,options);
  const body=JSON.parse(options.body);calls.push({authorization:options.headers.Authorization,...body});
  if(failure)return Response.json({error:{message:'Test provider failure'}},{status:failure});
  if(body.model==='retired-test-model')return Response.json({error:{message:'Model unavailable'}},{status:404});
  return Response.json({choices:[{message:{content:'Assistant response'}}]});
};
const instance=require('../server');
before(async()=>{server=instance.app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));base=`http://127.0.0.1:${server.address().port}`;const r=await originalFetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'rukovod@gmail.com',password:'admin'})});cookie=r.headers.get('set-cookie').split(';')[0];});
after(async()=>{global.fetch=originalFetch;env.get=originalSetting;instance.platform.close();server.closeAllConnections();await new Promise(r=>server.close(r));instance.db.close();fs.rmSync(temp,{recursive:true,force:true});});
async function ask(language='ru'){const response=await originalFetch(base+'/api/assistant',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({question:'Hello',language})});return {status:response.status,data:await response.json()};}
test('replacing an assistant credential takes effect without restarting',async()=>{
  assert.equal((await ask()).data.source,'groq');assert.equal(calls.at(-1).authorization,'Bearer first-test-key');
  key='replacement-test-key';assert.equal((await ask()).data.source,'groq');assert.equal(calls.at(-1).authorization,'Bearer replacement-test-key');
});
test('an unavailable configured model falls back to an available model',async()=>{
  calls=[];model='retired-test-model';const result=await ask();assert.equal(result.status,200);assert.deepEqual(calls.map(c=>c.model),['retired-test-model','openai/gpt-oss-20b']);model='openai/gpt-oss-20b';
});
test('provider authentication failure is an error, never a fabricated local answer',async()=>{
  failure=401;const result=await ask();assert.equal(result.status,503);assert.equal(result.data.code,'ASSISTANT_AUTH');assert.equal(result.data.answer,undefined);assert.ok(!JSON.stringify(result.data).includes(key));failure=null;
});
test('the requested interface language is passed to the assistant',async()=>{
  await ask('kk');assert.match(calls.at(-1).messages[0].content,/казахском/);
  await ask('en');assert.match(calls.at(-1).messages[0].content,/английском/);
});
