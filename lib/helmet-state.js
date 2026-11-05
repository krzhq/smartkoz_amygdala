// Temporal evidence only: no image inference and no client-supplied clocks.
const LIMITS = Object.freeze({closed:3000, invisible:2000, grace:800, gap:1500, stable:500, samples:3});
class HelmetState {
  constructor(onEvent=()=>{}, restored=[]) {
    this.onEvent=onEvent;
    this.active=new Map(restored.map(e=>[e.event_type,{wall:Date.parse(e.started_at)}]));
    this.resetEvidence();this.status='WARMING_UP';
  }
  resetEvidence(){
    this.last=null;this.closedAt=null;this.closedWall=null;this.lastClosed=null;
    this.openAt=null;this.openSamples=0;this.visibleAt=null;this.visibleSamples=0;
    this.absentAt=null;this.absentWall=null;this.uncertainAt=null;this.established=false;this.closedMs=0;
    this.eyeState='UNKNOWN';this.visibility='UNKNOWN';
  }
  begin(type,mono,wall,confidence=null,originWall=wall){
    if(this.active.has(type))return;
    this.active.set(type,{wall:originWall,mono});
    this.onEvent({action:'start',type,wall:originWall,triggered:wall,confidence});
  }
  end(type,wall){
    const e=this.active.get(type);if(!e)return;
    this.active.delete(type);this.onEvent({action:'end',type,wall,duration:Math.max(0,(wall-e.wall)/1000)});
  }
  fault(type,mono,wall){
    this.resetEvidence();this.status=type;
    this.begin(type,mono,wall);return this.snapshot();
  }
  sample(observation,mono,wall){
    if(this.last!==null&&mono<this.last)throw new Error('Monotonic time moved backwards');
    if(this.last!==null&&mono-this.last>LIMITS.gap){
      // A long processing/transport gap is not continuous eye evidence.
      this.closedAt=null;this.closedMs=0;this.lastClosed=null;
      this.openAt=null;this.openSamples=0;this.visibleAt=null;this.visibleSamples=0;this.absentAt=null;
    }
    this.last=mono;
    this.end('AI_UNAVAILABLE',wall);this.end('CAMERA_DISCONNECTED',wall);
    this.eyeState=observation.eye_state;
    if(observation.eyes_visible){
      this.absentAt=null;
      if(this.visibleAt===null){this.visibleAt=mono;this.visibleSamples=0;}
      this.visibleSamples++;
      if(this.visibleSamples>=LIMITS.samples&&mono-this.visibleAt>=LIMITS.stable){this.established=true;this.end('VISIBILITY_LOST',wall);}
      this.visibility=this.established?'VISIBLE':'ACQUIRING';
    }else{
      this.visibleAt=null;this.visibleSamples=0;
      if(this.absentAt===null){this.absentAt=mono;this.absentWall=wall;}
      this.visibility=this.established?'TEMPORARILY_LOST':'UNKNOWN';
      if(this.established&&mono-this.absentAt>=LIMITS.invisible){
        this.begin('VISIBILITY_LOST',mono,wall,observation.confidence,this.absentWall);this.visibility='LOST';
      }
    }
    if(observation.eye_state==='CLOSED'){
      if(this.uncertainAt!==null&&mono-this.uncertainAt>LIMITS.grace){this.closedAt=null;this.lastClosed=null;this.closedMs=0;}
      this.uncertainAt=null;
      if(this.closedAt===null){this.closedAt=mono;this.closedWall=wall;}
      this.lastClosed=mono;this.closedMs=mono-this.closedAt;
      this.openAt=null;this.openSamples=0;
      if(this.closedMs>=LIMITS.closed)this.begin('EYES_CLOSED_WARNING',mono,wall,observation.confidence,this.closedWall);
    }else if(observation.eye_state==='OPEN'){
      this.uncertainAt=null;
      if(this.openAt===null){this.openAt=mono;this.openSamples=0;}
      this.openSamples++;
      if(this.openSamples>=LIMITS.samples&&mono-this.openAt>=LIMITS.stable){
        this.closedAt=null;this.lastClosed=null;this.closedMs=0;this.end('EYES_CLOSED_WARNING',wall);
      }
    }else{
      if(this.uncertainAt===null)this.uncertainAt=mono;
      this.openAt=null;this.openSamples=0;
      // One missed/uncertain frame preserves continuity but does not add time.
      if(this.lastClosed!==null&&mono-this.lastClosed>LIMITS.grace){this.closedAt=null;this.lastClosed=null;this.closedMs=0;}
    }
    const stableOpen=this.openSamples>=LIMITS.samples&&this.openAt!==null&&mono-this.openAt>=LIMITS.stable;
    this.status=this.active.has('VISIBILITY_LOST')?'VISIBILITY_LOST':this.active.has('EYES_CLOSED_WARNING')?'EYES_CLOSED_WARNING':observation.eye_state==='CLOSED'?'EYES_CLOSED':stableOpen?'NORMAL':'WARMING_UP';
    return this.snapshot();
  }
  stop(wall){for(const type of [...this.active.keys()])this.end(type,wall);this.resetEvidence();this.status='STOPPED';return this.snapshot();}
  snapshot(){return {status:this.status,eye_state:this.eyeState,visibility:this.visibility,closed_seconds:Math.round(this.closedMs/100)/10,active_alerts:[...this.active.keys()]};}
}
module.exports={HelmetState,LIMITS};
