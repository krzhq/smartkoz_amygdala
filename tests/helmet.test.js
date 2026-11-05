const {test}=require('node:test');
const assert=require('node:assert/strict');
const {HelmetState}=require('../lib/helmet-state');
const observation=(state,visible=state!=='UNKNOWN')=>({eye_state:state,eyes_visible:visible,confidence:visible?.92:null});
function setup(){const events=[],engine=new HelmetState(e=>events.push(e));return {events,engine,sample:(s,t,v)=>engine.sample(observation(s,v),t,1700000000000+t)};}
test('normal needs three stable open observations over half a second',()=>{
  const {sample}=setup();assert.equal(sample('OPEN',0).status,'WARMING_UP');assert.equal(sample('OPEN',300).status,'WARMING_UP');assert.equal(sample('OPEN',600).status,'NORMAL');
});
test('one second of closed eyes never creates an alert',()=>{
  const {sample,events}=setup();sample('CLOSED',0);sample('CLOSED',500);assert.equal(sample('CLOSED',1000).status,'EYES_CLOSED');assert.equal(events.length,0);
});
test('closed threshold is monotonic time, not frame count, and one continuous warning has one event',()=>{
  const {sample,events}=setup();for(const t of [0,500,1000,1500,2000,2500,2999])sample('CLOSED',t);
  assert.equal(events.length,0);assert.equal(sample('CLOSED',3000).status,'EYES_CLOSED_WARNING');sample('CLOSED',3500);sample('CLOSED',4000);
  assert.equal(events.filter(e=>e.action==='start').length,1);
});
test('one missed frame does not reset closure but prolonged uncertainty cannot accumulate closure',()=>{
  const a=setup();a.sample('CLOSED',0);a.sample('CLOSED',600);a.sample('UNKNOWN',900);for(const t of [1200,1800,2400,3000])a.sample('CLOSED',t);assert.equal(a.events.length,1);
  const b=setup();b.sample('CLOSED',0);b.sample('UNKNOWN',500);b.sample('UNKNOWN',1000);b.sample('UNKNOWN',1500);b.sample('CLOSED',1800);b.sample('CLOSED',2500);b.sample('CLOSED',3100);assert.equal(b.events.length,0);
});
test('a late return after one uncertain frame resets the evidence clock',()=>{
  const {sample,events}=setup();sample('CLOSED',0);sample('UNKNOWN',300);sample('CLOSED',1400);sample('CLOSED',2200);sample('CLOSED',3000);assert.equal(events.length,0);
});
test('one noisy open frame does not close a warning; stable open frames do',()=>{
  const {sample,events}=setup();for(let t=0;t<=3000;t+=500)sample('CLOSED',t);
  assert.equal(sample('OPEN',3300).status,'EYES_CLOSED_WARNING');sample('CLOSED',3500);
  sample('OPEN',3800);sample('OPEN',4100);assert.equal(sample('OPEN',4400).status,'NORMAL');
  assert.equal(events.filter(e=>e.action==='end'&&e.type==='EYES_CLOSED_WARNING').length,1);
  sample('CLOSED',4700);sample('CLOSED',5200);assert.equal(events.filter(e=>e.action==='start').length,1);
});
test('visibility loss requires prior stable eyes and two seconds of successfully analyzed absence',()=>{
  const {sample,events}=setup();for(let t=0;t<=3000;t+=500)sample('UNKNOWN',t);assert.equal(events.length,0);
  sample('OPEN',3500);sample('OPEN',3800);sample('OPEN',4100);
  for(const t of [4400,4900,5400,5900,6399])sample('UNKNOWN',t);assert.equal(events.length,0);
  assert.equal(sample('UNKNOWN',6400).status,'VISIBILITY_LOST');sample('UNKNOWN',6900);assert.equal(events.length,1);
});
test('visibility recovers on stable visible eyes; a closed-eye warning still needs stable open evidence',()=>{
  const {sample,events}=setup();for(let t=0;t<=3000;t+=500)sample('CLOSED',t);
  for(let t=3500;t<=5500;t+=500)sample('UNKNOWN',t);
  sample('CLOSED',5800);sample('CLOSED',6100);assert.equal(sample('CLOSED',6400).status,'EYES_CLOSED_WARNING');
  assert.ok(events.some(e=>e.type==='VISIBILITY_LOST'&&e.action==='end'));
  assert.equal(events.filter(e=>e.type==='EYES_CLOSED_WARNING'&&e.action==='end').length,0);
});
test('camera/model failures are distinct and never show normal; long gaps reset timing',()=>{
  const {engine,sample,events}=setup();sample('OPEN',0);sample('OPEN',300);sample('OPEN',600);
  assert.equal(engine.fault('CAMERA_DISCONNECTED',900,1700000000900).status,'CAMERA_DISCONNECTED');
  assert.equal(engine.fault('AI_UNAVAILABLE',1000,1700000001000).status,'AI_UNAVAILABLE');
  assert.equal(sample('OPEN',1300).status,'WARMING_UP');
  sample('CLOSED',1600);sample('CLOSED',6000);sample('CLOSED',6500);assert.equal(events.filter(e=>e.type==='EYES_CLOSED_WARNING').length,0);
});
test('restart restores open event identity while requiring fresh temporal evidence',()=>{
  const events=[],e=new HelmetState(value=>events.push(value),[{event_type:'EYES_CLOSED_WARNING',started_at:'2023-11-14T22:13:20.000Z'}]);
  e.sample(observation('CLOSED'),0,1700000005000);e.sample(observation('CLOSED'),500,1700000005500);assert.equal(events.length,0);
  e.sample(observation('OPEN'),800,1700000005800);e.sample(observation('OPEN'),1100,1700000006100);e.sample(observation('OPEN'),1400,1700000006400);
  assert.equal(events.length,1);assert.equal(events[0].action,'end');
});
