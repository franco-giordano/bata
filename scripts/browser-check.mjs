// Optional real-browser QA. Start the static server and a dedicated Firefox
// WebDriver BiDi instance first; see README.md. No browser driver package needed.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const url=process.env.BATA_URL??'http://127.0.0.1:8000/';
const socket=new WebSocket(process.env.BATA_BIDI_URL??'ws://127.0.0.1:9222/session');
const pending=new Map(), errors=[];
let sequence=0,context,session=false;
socket.addEventListener('message',event=>{
  const response=JSON.parse(String(event.data));
  if(response.method==='log.entryAdded'&&response.params.level==='error')errors.push(response.params);
  const request=pending.get(response.id);
  if(request){clearTimeout(request.timeout);pending.delete(response.id);response.type==='error'?request.reject(new Error(JSON.stringify(response))):request.resolve(response.result);}
});
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
function call(method,params={}) {
  return new Promise((resolve,reject)=>{
    const id=++sequence;
    const timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out: ${method}`));},15000);
    pending.set(id,{resolve,reject,timeout});socket.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const result=await call('script.evaluate',{expression:`(async()=>JSON.stringify(await (${expression})))()`,target:{context},awaitPromise:true});
  if(result.type==='exception')throw new Error(JSON.stringify(result));
  return 'value' in result.result?JSON.parse(result.result.value):null;
}
const resize=(width,height=1000)=>call('browsingContext.setViewport',{context,viewport:{width,height}});
const pause=ms=>evaluate(`(async()=>{await new Promise(r=>setTimeout(r,${ms}));return true;})()`);
const change=(id,value,property='value')=>evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el[${JSON.stringify(property)}]=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
async function click(selector) {
  const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  await call('input.performActions',{context,actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',...point},{type:'pointerDown',button:0},{type:'pointerUp',button:0}]}]});
}
async function screenshot(name) {
  const result=await call('browsingContext.captureScreenshot',{context,origin:'viewport',format:{type:'image/png'}});
  await writeFile(`test-results/browser/${name}.png`,Buffer.from(result.data,'base64'));
}
try {
  await call('session.new',{capabilities:{}});session=true;
  await call('session.subscribe',{events:['log.entryAdded']});
  context=(await call('browsingContext.create',{type:'tab'})).context;
  await call('browsingContext.activate',{context});
  await call('browsingContext.navigate',{context,url,wait:'complete'});
  // Only use this check with the dedicated test profile described in the README.
  const originalStorage=await evaluate(`({grooves:localStorage.getItem('bata.grooves.v1'),locale:localStorage.getItem('bata.locale.v1')})`);
  await mkdir('test-results/browser',{recursive:true});
  const results={layouts:[]};
  try {
    for(const locale of ['en','es-AR']) {
      await change('language',locale);
      for(const width of [320,375,768,1280]) {
        await resize(width);
        const layout=await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,locale:document.documentElement.lang})`);
        assert.equal(layout.locale,locale);assert.ok(layout.scroll<=width,JSON.stringify(layout));results.layouts.push(layout);
        if(width===375||width===1280){await evaluate('window.scrollTo(0,0)');await screenshot(`${locale}-${width}`);}
      }
    }
    await resize(1280);
    await evaluate(`(async()=>{
      const {DrumPlayer}=await import('./js/audio.js');window.qaEvents=[];
      const hit=DrumPlayer.prototype.hit;
      DrumPlayer.prototype.hit=function(name,velocity,time){qaEvents.push({name,velocity,time});return hit.call(this,name,velocity,time);};
      const start=DrumPlayer.prototype.start;
      DrumPlayer.prototype.start=async function(...args){window.qaPlayer=this;const result=await start.apply(this,args);if(result){const analyser=this.context.createAnalyser(),silence=this.context.createGain();silence.gain.value=0;this.bus.connect(analyser);analyser.connect(silence);silence.connect(this.context.destination);window.qaAnalyser=analyser;}return result;};
      return true;
    })()`);
    await change('count-in',false,'checked');await change('metronome',false,'checked');await change('loop',true,'checked');await change('bpm','120');
    await click('#play');
    results.audio=await evaluate(`(async()=>{let peak=0;for(let i=0;i<150;i++){await new Promise(r=>setTimeout(r,10));if(window.qaAnalyser){const data=new Float32Array(qaAnalyser.fftSize);qaAnalyser.getFloatTimeDomainData(data);for(const value of data)peak=Math.max(peak,Math.abs(value));}}return {peak,state:qaPlayer.context.state,running:qaPlayer.running,samples:Object.keys(qaPlayer.buffers||{})};})()`);
    assert.equal(results.audio.state,'running');assert.ok(results.audio.running&&results.audio.peak>.001,JSON.stringify(results.audio));
    assert.deepEqual(results.audio.samples.sort(),['hihat','kick','snare']);
    await change('language','en');assert.equal(await evaluate('qaPlayer.running'),true);
    await change('bpm','240');await pause(1200);
    const hats=await evaluate(`qaEvents.filter(e=>e.name==='hihat').map(e=>e.time)`);
    assert.ok(Math.abs(hats.at(-1)-hats.at(-2)-.25)<.001);
    const cutoff=await evaluate('qaPlayer.context.currentTime+.15');await change('click-only',true,'checked');await pause(900);
    const clicks=await evaluate(`qaEvents.filter(e=>e.time>${cutoff})`);
    assert.ok(clicks.length>=2&&clicks.every(e=>e.name==='click'));
    await click('#play');await evaluate('window.qaEvents=[]');
    await change('count-in',true,'checked');await change('click-only',false,'checked');await change('loop',false,'checked');
    await click('#play');await pause(2400);
    assert.equal(await evaluate('qaPlayer.running'),false);
    assert.equal(await evaluate(`qaEvents.filter(e=>e.name==='click').length`),4);
    assert.equal(await evaluate(`qaEvents.filter(e=>e.name==='hihat').length`),4);
    await resize(375);await change('language','es-AR');await click('#new-groove');
    await change('groove-name','Práctica de prueba');await change('resolution','1');await change('bars','2');
    await click('.grid-bar:nth-child(2) .grid-row:last-child .cell[data-step="31"]');await click('#save');
    await call('browsingContext.reload',{context,wait:'complete'});
    assert.equal(await evaluate('document.documentElement.lang'),'es-AR');
    await click('#custom-list button:last-child');await click('#edit');
    assert.equal(await evaluate('document.querySelectorAll(".cell").length'),96);
    results.editor=await evaluate(`({width:innerWidth,scroll:document.documentElement.scrollWidth,grid:document.querySelector('.grid-bar').scrollWidth,visibleGrid:document.querySelector('.grid-bar').clientWidth})`);
    assert.ok(results.editor.scroll<=375&&results.editor.grid>results.editor.visibleGrid,JSON.stringify(results.editor));
    await evaluate(`document.getElementById('editor').scrollIntoView({block:'start'})`);await screenshot('es-AR-editor');
    await change('language','en');assert.equal(await evaluate('document.getElementById("groove-name").value'),'Práctica de prueba');
    assert.deepEqual(errors,[]);results.errors=errors;
    await writeFile('test-results/browser/results.json',JSON.stringify(results,null,2));
    console.log('PASS: both languages at 320/375/768/1280px, real Web Audio signal, live tempo, click-only, count-in, one-shot, custom save/reload and mobile editor.');
    console.log('Screenshots and results: test-results/browser/');
  } finally {
    await evaluate(`(()=>{for(const [key,value] of Object.entries(${JSON.stringify(originalStorage)})){const name=key==='grooves'?'bata.grooves.v1':'bata.locale.v1';if(value===null)localStorage.removeItem(name);else localStorage.setItem(name,value);}return true;})()`);
    await call('browsingContext.close',{context});
  }
} finally {
  if(session)await call('session.end');socket.close();
}
