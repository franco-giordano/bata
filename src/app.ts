import {t, soundName, plural, getLocale, initializeLocale, setLocale, LocalizedError, GLOSSARY, type MessageKey, type TranslationParams, type Locale} from './i18n.js';
import {EXERCISES, INSTRUMENTS, clone, validatePattern, readCollection, type Pattern, type Instrument, type Sound} from './model.js';
import {DrumPlayer} from './audio.js';
import {renderBar} from './notation.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const button = (id: string) => $<HTMLButtonElement>(id);
const player = new DrumPlayer();
const storageKey = 'bata.grooves.v1';
let custom: Pattern[] = [], selected = EXERCISES[0], draft: Pattern | null = null;
let resolution = 2, pending = false, generation = 0, taps: number[] = [], previewing = false;
let lastStep: number | null = null;
let statusMessage: {key:MessageKey;params:TranslationParams;error:boolean} = {key:'status.initial',params:{},error:false};
const message = (key: MessageKey, params: TranslationParams={}, error=false) => {
  statusMessage={key,params,error};
  $('status').textContent=t(key,params); $('status').classList.toggle('error',error);
};
const failure = (error: unknown) => {
  if(error instanceof LocalizedError)message(error.key,error.params,true);
  else if(error instanceof Error && ['QuotaExceededError','SecurityError'].includes(error.name))message('error.storage',{},true);
  else message('error.generic',{},true);
};
const patternName = (pattern: Pattern) => pattern.letter?t('exercise.name',{letter:pattern.letter}):pattern.name;
const patternDescription = (pattern: Pattern) => pattern.letter?t(`exercise.${pattern.letter}` as MessageKey):t('pattern.custom');

// randomUUID requires HTTPS; getRandomValues also works on a phone over LAN HTTP.
const uid = () => `custom-${crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)),n=>n.toString(16)).join('-')}`;
function saveCollection(patterns: Pattern[]) {
  localStorage.setItem(storageKey,JSON.stringify({version:1,patterns}));
  custom=patterns; renderLibrary();
}
function renderLibrary() {
  $('exercise-list').replaceChildren(...EXERCISES.map(pattern => {
    const item=document.createElement('button'); item.textContent=pattern.letter!;
    item.setAttribute('aria-label',`${patternName(pattern)}: ${patternDescription(pattern)}`);
    item.setAttribute('aria-pressed',String(pattern.id===selected.id)); item.onclick=()=>select(pattern); return item;
  }));
  $('custom-list').replaceChildren(...custom.map(pattern=> {
    const item=document.createElement('button'); item.className='custom-item'; item.textContent=pattern.name;
    item.setAttribute('aria-pressed',String(pattern.id===selected.id)); item.onclick=()=>select(pattern); return item;
  }));
  $('empty-custom').hidden=custom.length>0; $('export-all').hidden=custom.length===0;
}
function renderScore(pattern: Pattern) {
  $('score').innerHTML=Array.from({length:pattern.bars},(_,bar)=>`<div class="notation-bar" data-bar="${bar}">${renderBar(pattern,bar)}<div class="playhead"></div></div>`).join('');
}
function renderPattern(pattern: Pattern, isDraft=false) {
  $('pattern-name').textContent=isDraft ? input('groove-name').value.trim() || t('pattern.untitled') : patternName(pattern);
  $('pattern-description').textContent=isDraft ? t('pattern.draftDescription') : patternDescription(pattern);
  $('collection-label').textContent=t(isDraft?'collection.draft':pattern.letter?'collection.source':'collection.custom');
  $('bar-label').textContent=t(plural('pattern.bars.one','pattern.bars.other',pattern.bars),{count:pattern.bars});
  renderScore(pattern);
}
function clearPosition() {
  document.querySelectorAll('.active,.current').forEach(el=>el.classList.remove('active','current'));
  lastStep=null; renderPosition();
}
function stop() {
  generation++; pending=false; player.stop(); clearPosition(); previewing=false;
  button('play').disabled=false; renderTransport();
  message('status.stopped');
}
function select(pattern: Pattern) {
  stop(); selected=pattern; draft=null; $('editor').hidden=true;
  button('edit').textContent=t(pattern.letter?'action.editCopy':'action.edit');
  if(!pattern.letter) setTempo(pattern.bpm);
  renderPattern(pattern); renderLibrary(); message(pattern.letter?'status.source':'status.custom');
}
function setTempo(value: number) {
  const bpm=Math.max(30,Math.min(240,Math.round(Number.isFinite(value)?value:80)));
  player.bpm=bpm; input('bpm').value=String(bpm); input('tempo-slider').value=String(bpm);
}
async function start(pattern: Pattern, preview=false) {
  if (pending) return;
  stop(); const token=++generation; pending=true;
  renderTransport(); message('status.loading');
  try {
    player.metronome=input('click-only').checked || input('metronome').checked;
    player.drums=!input('click-only').checked;
    player.loop=input('loop').checked;
    const started = await player.start(clone(pattern),input('count-in').checked);
    if(token!==generation || !started) return;
    previewing=preview; renderPattern(pattern,preview);
    renderTransport();
    message(preview?'status.preview':input('click-only').checked?'status.clickOnly':'status.playing');
  } catch(error) {if(token===generation) {stop();failure(error);}}
  finally {if(token===generation) {pending=false;button('play').disabled=false;renderTransport();}}
}
player.onend=()=>{stop();message('status.finished');};
player.oninterrupt=()=>{stop();message('status.interrupted');};
button('play').onclick=()=>player.running||pending?stop():void start(draft??selected,Boolean(draft));
input('bpm').onchange=()=>setTempo(Number(input('bpm').value));
input('tempo-slider').oninput=()=>setTempo(Number(input('tempo-slider').value));
button('slower').onclick=()=>setTempo(player.bpm-5); button('faster').onclick=()=>setTempo(player.bpm+5);
button('tap').onclick=()=> {
  const now=performance.now(); if(taps.length && now-taps.at(-1)!>2000) taps=[];
  taps.push(now); taps=taps.slice(-5);
  if(taps.length>1) {setTempo(60000*(taps.length-1)/(now-taps[0])); message('status.tap',{bpm:player.bpm});}
  else message('status.keepTapping');
};
input('metronome').onchange=()=>player.metronome=input('click-only').checked||input('metronome').checked;
input('click-only').onchange=()=>{player.drums=!input('click-only').checked;player.metronome=input('click-only').checked||input('metronome').checked;};
input('loop').onchange=()=>player.loop=input('loop').checked;
const allPatterns=()=>[...EXERCISES,...custom];
for(const [id,delta] of [['previous',-1],['next',1]] as const) button(id).onclick=()=>{
  const all=allPatterns(), index=all.findIndex(p=>p.id===selected.id); select(all[(index+delta+all.length)%all.length]);
};
function frame() {
  if(player.running) {
    const event=player.currentEvent();
    if(event) {
      const beat=Math.floor((event.step<0?event.step+16:event.step%16)/4);
      $('beat-lights').querySelectorAll('span').forEach((el,i)=>el.classList.toggle('active',i===beat));
      lastStep=event.step; renderPosition();
      document.querySelectorAll<HTMLElement>('.notation-bar').forEach((el,i)=>{
        const active=event.step>=0 && i===Math.floor(event.step/16); el.classList.toggle('active',active);
        if(active) el.querySelector<HTMLElement>('.playhead')!.style.left=`${(82+(event.step%16)*25)/510*100}%`;
      });
      document.querySelectorAll<HTMLElement>('.cell').forEach(el=>el.classList.toggle('current',previewing&&Number(el.dataset.step)===event.step));
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.addEventListener('keydown',event=>{
  if(event.code==='Space' && !event.repeat && !(event.target instanceof HTMLElement && event.target.closest('input,select,textarea,button,summary,a'))) {event.preventDefault();button('play').click();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(player.running||pending)){stop();message('status.background');}});

function openEditor(blank=false) {
  stop(); draft=blank ? {id:uid(),name:t('pattern.new'),description:t('pattern.custom'),bars:1,bpm:player.bpm,tracks:{hihat:Array(16).fill(0),snare:Array(16).fill(0),kick:Array(16).fill(0)}} : clone(selected);
  if(draft.letter) {draft.id=uid();draft.name=t('pattern.variation',{name:patternName(draft)});delete draft.letter;}
  input('groove-name').value=draft.name;
  $<HTMLSelectElement>('bars').value=String(draft.bars);
  resolution=INSTRUMENTS.some(t=>draft!.tracks[t].some((v,i)=>i%2&&v))?1:2;
  $<HTMLSelectElement>('resolution').value=String(resolution);
  $('delete').hidden=!custom.some(p=>p.id===draft!.id); $('editor').hidden=false;
  renderGrid(); $('editor').scrollIntoView({behavior:'smooth',block:'nearest'});
}
button('new-groove').onclick=()=>openEditor(true); button('edit').onclick=()=>openEditor();
button('close-editor').onclick=()=>{stop();draft=null;$('editor').hidden=true;renderPattern(selected);};
input('groove-name').oninput=()=>{if(draft)renderPattern(draft,true);};
function renderGrid() {
  if(!draft)return;
  $('grid-scroll-hint').hidden=resolution!==1;
  const fragment=document.createDocumentFragment();
  for(let bar=0;bar<draft.bars;bar++) {
    const wrapper=document.createElement('div');wrapper.className=`grid-bar ${resolution===1?'sixteenths':''}`;
    wrapper.tabIndex=0;wrapper.setAttribute('role','group');wrapper.setAttribute('aria-label',t('editor.bar',{bar:bar+1}));
    const caption=document.createElement('div');caption.className='grid-caption';caption.textContent=t('editor.bar',{bar:bar+1});wrapper.append(caption);
    const counts=document.createElement('div');counts.className='grid-row counts';counts.style.setProperty('--columns',String(16/resolution));counts.append(document.createElement('span'));
    for(let s=0;s<16;s+=resolution){const cell=document.createElement('span');cell.textContent=s%4===0?String(s/4+1):s%4===2?'&':s%4===1?'e':'a';counts.append(cell);}wrapper.append(counts);
    for(const track of INSTRUMENTS) {
      const row=document.createElement('div');row.className=`grid-row ${resolution===1?'sixteenths':''}`;row.style.setProperty('--columns',String(16/resolution));
      const label=document.createElement('button');label.textContent=soundName(track);label.className='instrument';label.title=t('editor.listen',{sound:track});
      label.onclick=()=>void audition(track);row.append(label);
      for(let s=0;s<16;s+=resolution) {
        const step=bar*16+s,cell=document.createElement('button');cell.className=`cell ${s%4===0?'beat-start':''}`;cell.dataset.step=String(step);
        const update=()=>{const value=draft!.tracks[track][step];cell.dataset.value=String(value);cell.textContent=value===2?'>':value===1?'●':'·';cell.setAttribute('aria-pressed',String(value>0));cell.setAttribute('aria-label',t('editor.cell',{sound:track,bar:bar+1,beat:`${Math.floor(s/4)+1}${['',' e',' &',' a'][s%4]}`,state:t((['note.rest','note.hit','note.accent'] as const)[value])}));};
        update();cell.onclick=()=>{if(!draft)return;if(player.running||pending)stop();draft.tracks[track][step]=(draft.tracks[track][step]+1)%3;update();renderScore(draft);};row.append(cell);
      }
      wrapper.append(row);
    }
    fragment.append(wrapper);
  }
  $('step-grid').replaceChildren(fragment); renderPattern(draft,true);
}
async function audition(track: Instrument) {
  if(player.running||pending) return;
  try {await player.prepare();if(player.running||pending)return;const source=player.context.createBufferSource(),gain=player.context.createGain();source.buffer=player.buffers![track];gain.gain.value=player.mix[track]*.5;source.connect(gain);gain.connect(player.context.destination);source.start();source.onended=()=>gain.disconnect();}catch(error){failure(error);}
}
$<HTMLSelectElement>('resolution').onchange=()=>{
  const next=Number($<HTMLSelectElement>('resolution').value);
  if(next===2&&draft&&INSTRUMENTS.some(t=>draft!.tracks[t].some((v,i)=>i%2&&v))) { $<HTMLSelectElement>('resolution').value='1';message('error.grid',{},true);return;}
  resolution=next;renderGrid();
};
$<HTMLSelectElement>('bars').onchange=()=>{
  if(!draft)return;stop();const bars=Number($<HTMLSelectElement>('bars').value);
  if(bars<draft.bars&&INSTRUMENTS.some(t=>draft!.tracks[t].slice(bars*16).some(Boolean))&&!confirm(t('confirm.removeBars'))){$<HTMLSelectElement>('bars').value=String(draft.bars);return;}
  for(const t of INSTRUMENTS) draft.tracks[t]=Array.from({length:bars*16},(_,i)=>draft!.tracks[t][i]??0);
  draft.bars=bars;renderGrid();
};
button('preview').onclick=()=>{if(player.running||pending){stop();return;}if(draft)void start(draft,true);};
button('clear').onclick=()=>{if(!draft)return;stop();for(const t of INSTRUMENTS)draft.tracks[t].fill(0);renderGrid();};
button('save').onclick=()=>{
  if(!draft)return;
  try {
    const pattern=validatePattern({...draft,name:input('groove-name').value,bpm:player.bpm});
    const next=custom.filter(p=>p.id!==pattern.id);next.push(pattern);saveCollection(next);select(pattern);message('status.saved');
  }catch(error){failure(error);}
};
button('delete').onclick=()=>{if(draft&&confirm(t('confirm.delete',{name:draft.name}))){try{saveCollection(custom.filter(p=>p.id!==draft!.id));select(EXERCISES[0]);message('status.deleted');}catch(error){failure(error);}}};
function download(patterns: Pattern[]) {
  const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,patterns},null,2)],{type:'application/json'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='bata-grooves.json';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
button('export').onclick=()=>{
  try { download([validatePattern({...clone(draft??selected),name:draft?input('groove-name').value:patternName(selected),bpm:player.bpm})]); }
  catch(error) {failure(error);}
};
button('export-all').onclick=()=>download(custom);
button('import').onclick=()=>input('import-file').click();
input('import-file').onchange=async()=>{
  const file=input('import-file').files?.[0];if(!file)return;
  try {
    if(file.size>1024*1024)throw new LocalizedError('error.fileSize');
    const patterns=readCollection(await file.text()).map(p=>({...p,id:uid()}));
    saveCollection([...custom,...patterns]);select(patterns[0]);message(plural('status.imported.one','status.imported.other',patterns.length),{count:patterns.length});
  }catch(error){failure(error);}finally{input('import-file').value='';}
};
function renderMixer() {
const controls=document.createDocumentFragment();
for(const name of [...INSTRUMENTS,'click'] as Sound[]) {
  const label=document.createElement('label'),text=document.createElement('span'),slider=document.createElement('input');
  text.textContent=soundName(name);slider.type='range';slider.min='0';slider.max='100';slider.value=String(player.mix[name]*100);
  slider.setAttribute('aria-label',t('mixer.volume',{sound:name}));slider.oninput=()=>player.setVolume(name,Number(slider.value)/100);label.append(text,slider);controls.append(label);
}
$('mixer-controls').replaceChildren(controls);
}
initializeLocale();
for(const [english,spanish] of GLOSSARY) {
  const row=document.createElement('tr');
  for(const [text,lang] of [[english,'en'],[spanish,'es-AR']]) {
    const cell=document.createElement('td');cell.textContent=text;cell.lang=lang;row.append(cell);
  }
  $('glossary-terms').append(row);
}
try{const stored=localStorage.getItem(storageKey);if(stored)custom=readCollection(stored,{allowEmpty:true});}catch{message('error.savedGrooves',{},true);}
applyLocale();

function renderTransport() {
  button('play').textContent=t(pending?'action.cancel':player.running?'action.stop':'action.play');
  button('preview').textContent=t(player.running&&previewing?'action.stopPreview':'action.preview');
}
function renderPosition() {
  if(lastStep===null){$('position').textContent=t('transport.ready');return;}
  const beat=Math.floor((lastStep<0?lastStep+16:lastStep%16)/4)+1;
  $('position').textContent=lastStep<0?t('transport.countPosition',{beat}):t('transport.position',{bar:Math.floor(lastStep/16)+1,beat});
}
function applyLocale() {
  document.documentElement.lang=getLocale();
  document.title=t('app.title');
  document.querySelector<HTMLMetaElement>('meta[name="description"]')!.content=t('app.description');
  const attributes = {'i18n':'textContent','i18nAria':'aria-label','i18nPlaceholder':'placeholder','i18nAlt':'alt'} as const;
  for(const [dataKey,attribute] of Object.entries(attributes)) {
    const selector='data-'+dataKey.replace(/[A-Z]/g,char=>'-'+char.toLowerCase());
    document.querySelectorAll<HTMLElement>(`[${selector}]`).forEach(element=>{
      const text=t(element.dataset[dataKey] as MessageKey);
      if(attribute==='textContent')element.textContent=text;else element.setAttribute(attribute,text);
    });
  }
  $<HTMLSelectElement>('language').value=getLocale();
  button('edit').textContent=t(selected.letter?'action.editCopy':'action.edit');
  renderLibrary();renderMixer();
  if(draft)renderGrid();else renderPattern(selected);
  renderTransport();renderPosition();
  message(statusMessage.key,statusMessage.params,statusMessage.error);
}
$<HTMLSelectElement>('language').onchange=()=>{setLocale($<HTMLSelectElement>('language').value as Locale);applyLocale();};
