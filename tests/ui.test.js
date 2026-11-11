import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {DrumPlayer} from '../dist/js/audio.js';
import {EXERCISES,clone} from '../dist/js/model.js';
import {renderBar} from '../dist/js/notation.js';
import {en,es,getLocale,setLocale,t,plural,LocalizedError} from '../dist/js/i18n.js';

const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
let run=0;
function setup() {
  const dom=new JSDOM(html,{url:'http://localhost:8000/',pretendToBeVisual:true});
  for(const key of ['window','document','HTMLElement','HTMLInputElement','localStorage'])globalThis[key]=dom.window[key];
  globalThis.requestAnimationFrame=()=>0;
  globalThis.confirm=()=>true;
  dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
  dom.window.HTMLAnchorElement.prototype.click=()=>{};
  return {
    dom,
    byId:id=>dom.window.document.getElementById(id),
    change:id=>dom.window.document.getElementById(id).dispatchEvent(new dom.window.Event('change')),
    boot:()=>import(`../dist/js/app.js?test=${run++}`),
  };
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('exercise navigation, multi-bar editing, storage, tempo, import, and deletion work together',async()=>{
  const {dom,byId,change,boot}=setup();
  try {
    await boot();
    assert.equal(byId('exercise-list').children.length,10);
    byId('exercise-list').children[9].click();assert.equal(byId('pattern-name').textContent,'Exercise J');
    byId('edit').click();assert.equal(byId('editor').hidden,false);
    assert.equal(document.querySelectorAll('.cell').length,24);
    byId('groove-name').value='My variation';
    const first=document.querySelector('.cell');
    first.click();assert.equal(first.dataset.value,'2');
    first.click();assert.equal(first.dataset.value,'0');
    first.click();assert.equal(first.dataset.value,'1');
    byId('resolution').value='1';change('resolution');
    assert.equal(document.querySelectorAll('.cell').length,48);
    // A sixteenth-note hit must remain visible when changing grid resolution.
    const offbeat=document.querySelector('.cell[data-step="1"]');offbeat.click();
    byId('resolution').value='2';change('resolution');assert.equal(byId('resolution').value,'1');
    byId('bars').value='4';change('bars');
    assert.equal(document.querySelectorAll('.cell').length,192);
    byId('save').click();assert.equal(byId('pattern-name').textContent,'My variation');
    assert.equal(byId('custom-list').children.length,1);
    const stored=JSON.parse(localStorage.getItem('bata.grooves.v1'));
    assert.equal(stored.patterns[0].bars,4);assert.equal(stored.patterns[0].tracks.kick.length,64);
    assert.equal(stored.patterns[0].tracks.hihat[1],1);
    byId('new-groove').click();byId('groove-name').value='Empty practice';byId('save').click();
    assert.equal(byId('custom-list').children.length,2);
    byId('bpm').value='999';change('bpm');assert.equal(byId('bpm').value,'240');
    byId('bpm').value='-3';change('bpm');assert.equal(byId('bpm').value,'30');
    const fileInput=byId('import-file');
    Object.defineProperty(fileInput,'files',{configurable:true,value:[{size:100,text:async()=>JSON.stringify(stored)}]});
    await fileInput.onchange();assert.equal(byId('custom-list').children.length,3);
    Object.defineProperty(fileInput,'files',{configurable:true,value:[{size:100,text:async()=>'{"version":1,"patterns":[{}]}'}]});
    await fileInput.onchange();assert.ok(byId('status').classList.contains('error'));
    assert.equal(byId('custom-list').children.length,3);
    byId('edit').click();byId('delete').click();assert.equal(byId('custom-list').children.length,2);
    const saved=localStorage.getItem('bata.grooves.v1');
    await boot();assert.equal(byId('custom-list').children.length,2);
    assert.equal(localStorage.getItem('bata.grooves.v1'),saved);
  }finally{dom.window.close();}
});

test('the displayed draft is what Play and Export use; editing cancels pending playback',async()=>{
  const {dom,byId,boot}=setup();
  const originalStart=DrumPlayer.prototype.start;
  const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
  try {
    let played;
    // The audio scheduler itself is exercised in practice.test.js. This spy
    // checks which pattern the UI hands to it, without requiring an audio device.
    DrumPlayer.prototype.start=async function(pattern){played=pattern;this.running=true;return true;};
    await boot();
    byId('new-groove').click();byId('groove-name').value='Displayed draft';
    byId('groove-name').dispatchEvent(new dom.window.Event('input'));
    assert.equal(byId('pattern-name').textContent,'Displayed draft');
    assert.equal(byId('collection-label').textContent,'GROOVE DRAFT');
    byId('play').click();await settle();
    assert.ok(Object.values(played.tracks).every(notes=>notes.every(note=>note===0)),'plays empty draft, not Exercise A');
    byId('play').click();
    let exported;URL.createObjectURL=blob=>{exported=blob;return 'blob:test';};URL.revokeObjectURL=()=>{};
    byId('export').click();assert.equal(JSON.parse(await exported.text()).patterns[0].name,'Displayed draft');
    byId('close-editor').click();assert.equal(byId('pattern-name').textContent,'Exercise A');
    byId('new-groove').click();
    let finish;DrumPlayer.prototype.start=function(){return new Promise(resolve=>finish=resolve);};
    byId('play').click();assert.equal(byId('play').textContent,'■ Cancel');assert.equal(byId('play').disabled,false);
    document.querySelector('.cell').click();assert.equal(byId('play').textContent,'▶ Play');finish(false);
    await settle();assert.equal(byId('play').textContent,'▶ Play');
  }finally{
    DrumPlayer.prototype.start=originalStart;URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;
    dom.window.close();
  }
});

test('more than 100 saved grooves and empty collections survive a reload',async()=>{
  const {dom,byId,boot}=setup();
  try {
    const patterns=Array.from({length:101},(_,i)=>({...clone(EXERCISES[0]),id:`custom-${i}`,name:`Groove ${i}`}));
    localStorage.setItem('bata.grooves.v1',JSON.stringify({version:1,patterns}));
    await boot();assert.equal(byId('custom-list').children.length,101);
    byId('custom-list').lastElementChild.click();assert.equal(byId('pattern-name').textContent,'Groove 100');
    localStorage.setItem('bata.grooves.v1','{"version":1,"patterns":[]}');
    await boot();assert.equal(byId('custom-list').children.length,0);assert.equal(byId('empty-custom').hidden,false);
    localStorage.setItem('bata.grooves.v1','{"version":2,"patterns":[]}');
    await boot();assert.ok(byId('status').classList.contains('error'));
  }finally{dom.window.close();}
});

test('generated notation is valid SVG XML for every supplied exercise',()=>{
  const {dom}=setup();
  try {
    for(const pattern of EXERCISES) {
      // Read the same renderer used by the production page, without injecting
      // it through the more forgiving HTML parser.
      const parsed=new dom.window.DOMParser().parseFromString(renderBar(pattern),'image/svg+xml');
      assert.equal(parsed.querySelector('parsererror'),null,pattern.name);
    }
  }finally{dom.window.close();}
});

test('both dictionaries have the same keys and interpolation parameters',()=>{
  assert.deepEqual(Object.keys(es).sort(),Object.keys(en).sort());
  for(const key of Object.keys(en)) {
    const parameters=text=>[...text.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort();
    assert.deepEqual(parameters(es[key]),parameters(en[key]),key);
  }
});

test('switching language preserves drafts, updates validation and accessibility, and persists the choice',async()=>{
  const {dom,byId,change,boot}=setup();
  try {
    await boot();
    byId('language').value='es-AR';change('language');
    assert.equal(document.documentElement.lang,'es-AR');assert.equal(document.title,'Bata · Práctica de batería');
    assert.equal(byId('pattern-name').textContent,'Ejercicio A');
    assert.match(byId('pattern-description').textContent,/negras.*Bombo/);
    assert.equal(byId('play').textContent,'▶ Reproducir');
    assert.match(document.querySelector('.notation-bar svg').getAttribute('aria-label'),/^Compás 1.*Tambor.*Bombo/);
    byId('new-groove').click();byId('groove-name').value='Mi práctica';
    document.querySelector('.cell').click();
    byId('groove-name').value='';byId('save').click();
    assert.match(byId('status').textContent,/Poné un nombre/);
    byId('language').value='en';change('language');
    assert.equal(byId('editor').hidden,false);assert.equal(document.querySelector('.cell').dataset.value,'1');
    assert.match(byId('status').textContent,/Give each groove a name/);
    assert.match(document.querySelector('.cell').getAttribute('aria-label'),/bar 1, beat 1: hit/);
    byId('groove-name').value='Mi práctica';byId('save').click();
    byId('language').value='es-AR';change('language');
    assert.equal(byId('pattern-name').textContent,'Mi práctica','custom names are never translated');
    assert.equal(localStorage.getItem('bata.locale.v1'),'es-AR');
    await boot();assert.equal(getLocale(),'es-AR');assert.equal(byId('language').value,'es-AR');
    assert.equal(byId('pattern-name').textContent,'Ejercicio A');
    assert.equal(t(plural('pattern.bars.one','pattern.bars.other',1),{count:1}),'1 compás · se repite');
    assert.equal(t(plural('pattern.bars.one','pattern.bars.other',2),{count:2}),'2 compases · se repiten');
    const error=new LocalizedError('error.steps',{sound:'kick',count:16});
    assert.match(error.message,/Bombo necesita 16 pasos/);
    assert.match(byId('glossary-terms').textContent,/Snare drumTambor \/ redoblante/);
  }finally{setLocale('en',false);dom.window.close();}
});
