import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {EXERCISES,validatePattern,readCollection,clone,stepEvents,stepDuration} from '../dist/js/model.js';
import {renderBar} from '../dist/js/notation.js';
import {DrumPlayer} from '../dist/js/audio.js';

test('all ten transcriptions match the kick placements on the supplied sheet',()=>{
  const expected=[[1,3],[1,3],[1,1.5],[1,2],[1,2.5],[1,3,3.5],[1,3.5],[1,4.5],[1,2.5,3.5],[1,3.5,4.5]];
  assert.equal(EXERCISES.length,10);
  EXERCISES.forEach((p,i)=>{
    assert.deepEqual(p.tracks.kick.flatMap((hit,step)=>hit?[step/4+1]:[]),expected[i]);
    assert.deepEqual(p.tracks.snare.flatMap((hit,step)=>hit?[step]:[]),[4,12]);
    assert.equal(p.tracks.hihat.filter(Boolean).length,i===0?4:8);
    assert.doesNotThrow(()=>validatePattern(p));
    assert.ok(renderBar(p).includes('<svg'));
  });
});
test('imports round-trip accents and four-bar sixteenths; reject malformed patterns',()=>{
  const pattern=clone(EXERCISES[0]);pattern.name='Four bars';pattern.bars=4;
  for(const track in pattern.tracks)pattern.tracks[track]=Array(64).fill(0);
  pattern.tracks.kick[63]=2;pattern.tracks.snare[1]=1;
  const [restored]=readCollection(JSON.stringify({version:1,patterns:[pattern]}));
  assert.deepEqual(restored.tracks,pattern.tracks);
  for(const invalid of [null,{}, {...pattern,name:''},{...pattern,bpm:0},{...pattern,bars:3},{...pattern,tracks:{kick:[1]}}])assert.throws(()=>validatePattern(invalid));
  pattern.tracks.kick[0]=3;assert.throws(()=>validatePattern(pattern));
  assert.throws(()=>readCollection('{"version":2,"patterns":[]}'));
  for(const invalid of ['null','{}','[]','{"version":1,"patterns":[]}'])assert.throws(()=>readCollection(invalid),/version 1/);
  assert.deepEqual(readCollection('{"version":1,"patterns":[]}',{allowEmpty:true}),[]);
  assert.throws(()=>readCollection('{"version":2,"patterns":[]}',{allowEmpty:true}));
  assert.equal(readCollection(JSON.stringify({version:1,patterns:Array(101).fill(EXERCISES[0])})).length,101);
  const extraTrack=clone(EXERCISES[0]);extraTrack.tracks.unexpected={not:'notes'};
  const sanitized=validatePattern(extraTrack);
  assert.deepEqual(Object.keys(sanitized.tracks),['hihat','snare','kick']);
  assert.doesNotThrow(()=>renderBar(sanitized));
});
test('count-in has only four clicks, and click-only excludes all drums',()=>{
  const countIn=Array.from({length:16},(_,i)=>stepEvents(EXERCISES[0],i-16)).flat();
  assert.deepEqual(countIn.map(e=>e.instrument),Array(4).fill('click'));
  assert.equal(countIn[0].velocity,2);
  const onlyClick=Array.from({length:16},(_,i)=>stepEvents(EXERCISES[9],i,{drums:false})).flat();
  assert.equal(onlyClick.length,4);assert.ok(onlyClick.every(e=>e.instrument==='click'));
  assert.equal(stepDuration(120)*16,2);assert.equal(stepDuration(80)*16,3);
});

class FakeNode {
  gain={value:1,setValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(value){this.value=value;}};
  frequency={value:0};
  connect(){} disconnect(){this.disconnected=true;}
  start(time){this.startedAt=time;} stop(){}
}
class FakeContext {
  currentTime=0;state='running';destination=new FakeNode();sources=[];
  async resume(){};
  async decodeAudioData(buffer){assert.equal(new TextDecoder().decode(buffer.slice(0,4)),'RIFF');return {duration:1.85};}
  createGain(){return new FakeNode();} createDynamicsCompressor(){return new FakeNode();}
  createOscillator(){const node=new FakeNode();this.sources.push(node);return node;}
  createBufferSource(){const node=new FakeNode();this.sources.push(node);return node;}
}
test('audio loads real bundled WAVs and schedules an exact bar without timing drift',async()=>{
  globalThis.window={AudioContext:FakeContext};
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async path=>new Response(readFileSync(new URL('../'+String(path).replace('./',''),import.meta.url)));
  const player=new DrumPlayer();
  try {
    player.bpm=120;player.loop=false;player.metronome=false;
    let ended=false;player.onend=()=>ended=true;
    await player.start(EXERCISES[1],false);
    const context=player.context;
    for(let i=0;i<40;i++){context.currentTime=i*.05;player.schedule();}
    const kicks=context.sources.filter(source=>source.buffer===player.buffers.kick).map(s=>s.startedAt);
    const snares=context.sources.filter(source=>source.buffer===player.buffers.snare).map(s=>s.startedAt);
    assert.deepEqual(kicks.map(t=>+t.toFixed(6)),[.08,1.08]);assert.deepEqual(snares.map(t=>+t.toFixed(6)),[.58,1.58]);
    assert.equal(context.sources.filter(s=>s.buffer===player.buffers.hihat).length,8);
    player.setVolume('kick',.25);assert.equal(player.trackGains.kick.gain.value,.25);
    context.currentTime=2.1;player.schedule();assert.equal(ended,true);assert.equal(player.running,false);assert.equal(player.bus.disconnected,true);
  }finally{player.stop();globalThis.fetch=originalFetch;}
});
test('loop wraps exactly and live tempo changes use the audio clock',async()=>{
  const player=new DrumPlayer();player.context=new FakeContext();player.buffers={hihat:{},snare:{},kick:{}};
  player.bpm=120;player.metronome=false;
  try {
    await player.start(EXERCISES[0],false);
    for(let i=0;i<44;i++){player.context.currentTime=i*.05;player.schedule();}
    const kicks=player.context.sources.filter(s=>s.buffer===player.buffers.kick).map(s=>s.startedAt);
    assert.deepEqual(kicks,[.08,1.08,2.08]);
    const next=player.nextTime;
    player.bpm=60;player.context.currentTime=2.3;player.schedule();
    assert.ok(Math.abs(player.nextTime-next-.25)<1e-9);
    player.stop();assert.equal(player.events.length,0);assert.equal(player.running,false);
  }finally{player.stop();}
});
test('a delayed scheduler stops instead of playing a burst of overdue notes',async()=>{
  const player=new DrumPlayer();player.context=new FakeContext();player.buffers={hihat:{},snare:{},kick:{}};
  let interruptions=0;player.oninterrupt=()=>interruptions++;
  try {
    await player.start(EXERCISES[0],false);
    const before=player.context.sources.length;
    player.context.currentTime=1;player.schedule();
    assert.equal(player.context.sources.length,before);assert.equal(interruptions,1);assert.equal(player.running,false);
  }finally{player.stop();}
});
test('cancel and restart during loading never starts a canceled groove or loads samples twice',async()=>{
  const originalFetch=globalThis.fetch;
  const releases=[];let fetched=0;
  globalThis.fetch=path=>{fetched++;return new Promise(resolve=>releases.push(()=>resolve(new Response(readFileSync(new URL('../'+String(path).replace('./',''),import.meta.url))))));};
  const player=new DrumPlayer();player.context=new FakeContext();
  try {
    const canceled=player.start(EXERCISES[0],false);
    // Let resume finish and the shared sample request begin.
    await new Promise(resolve=>setImmediate(resolve));
    player.stop();
    const started=player.start(EXERCISES[9],false);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(fetched,3);
    releases.forEach(release=>release());
    assert.equal(await canceled,false);assert.equal(await started,true);
    assert.equal(player.pattern.id,EXERCISES[9].id);assert.equal(player.running,true);
  }finally{player.stop();globalThis.fetch=originalFetch;}
});
test('notation contains exactly the played notes, including custom accents in later bars',()=>{
  const custom=clone(EXERCISES[0]);custom.bars=2;
  custom.tracks={hihat:Array(32).fill(0),snare:Array(32).fill(0),kick:Array(32).fill(0)};
  custom.tracks.hihat[17]=2;custom.tracks.snare[20]=1;custom.tracks.kick[23]=2;
  for(const pattern of [...EXERCISES,custom]) {
    for(let bar=0;bar<pattern.bars;bar++) {
      const svg=renderBar(pattern,bar);
      const expected=Object.entries(pattern.tracks).flatMap(([track,steps])=>steps.flatMap((value,step)=>value&&Math.floor(step/16)===bar?[`${track}:${step}:${value===2}`]:[])).sort();
      const actual=[...svg.matchAll(/data-instrument="([^"]+)" data-step="(\d+)" data-accent="(true|false)"/g)].map(([,track,step,accent])=>`${track}:${step}:${accent}`).sort();
      assert.deepEqual(actual,expected);
      assert.match(svg,/aria-label="Bar/);assert.ok(!svg.includes(' & '));
    }
  }
  assert.match(renderBar(EXERCISES[4]),/data-flag-direction="up"[^>]+c12,-5 15,-12 8,-22/);
});
test('production output is self-contained and includes reference sheet and sample attribution',()=>{
  const html=readFileSync('dist/index.html','utf8');
  for(const match of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))assert.ok(existsSync(`dist/${match[1]}`),match[1]);
  assert.ok(existsSync('dist/assets/sounds/LICENSE'));
  for(const sound of ['kick','snare','hihat'])assert.ok(readFileSync(`dist/assets/sounds/${sound}.wav`).length>1000);
});
