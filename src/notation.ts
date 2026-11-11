// A percussion staff: hi-hat crosses above, snare in the middle, kick below.
// Each quarter is split only as far as its notes require (quarter/eighth/sixteenth).
import {INSTRUMENTS, type Pattern, type Instrument} from './model.js';
import {t} from './i18n.js';
const head = (x: number,y: number,cross=false) => cross
  ? `<path d="M${x-4},${y-4}l8,8m-8,0l8,-8" fill="none"/>`
  : `<ellipse cx="${x}" cy="${y}" rx="5.5" ry="3.8" transform="rotate(-18 ${x} ${y})" fill="currentColor" stroke="none"/>`;
function rest(x: number,y: number,duration: number) {
  if (duration === 4) return `<path d="M${x+2},${y-11}l-5,8 6,6 -5,4 3,5 -7,-3 3,-6 -5,-6z" fill="currentColor" stroke="none"/>`;
  return `<circle cx="${x-2}" cy="${y-3}" r="2.5" fill="currentColor"/><path d="M${x-2},${y-3}q6,3 8,-4l-7,19" fill="none"/>${duration===1?`<circle cx="${x-4}" cy="${y+3}" r="2.5" fill="currentColor"/>`:''}`;
}
export function renderBar(pattern: Pattern,bar=0) {
  const offset=bar*16, x=(step: number)=>82+step*25;
  const description = INSTRUMENTS.map(track => {
    const beats = pattern.tracks[track].slice(offset,offset+16).flatMap((value,step) => {
      const subdivision = ['', ' e', ' &', ' a'][step%4];
      const beat=`${Math.floor(step/4)+1}${subdivision}`;
      return value ? [value===2?t('note.accented',{beat}):beat] : [];
    });
    return t('score.track',{sound:track,beats:beats.join(', ') || t('note.rests')});
  }).join('. ');
  const label=t('score.label',{bar:bar+1,description}).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  let svg = `<svg viewBox="0 0 510 195" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg"><g stroke="currentColor" stroke-width="1.3">`;
  for (let y=66;y<=106;y+=10) svg+=`<path d="M20,${y}H493" opacity=".45"/>`;
  svg+='<path d="M30,76v20m6,-20v20" stroke-width="4"/><path d="M493,66v40"/>';
  svg+='<g fill="currentColor" stroke="none" font-family="Georgia,serif" font-size="25" font-weight="bold"><text x="48" y="83">4</text><text x="48" y="105">4</text></g>';
  for (let beat=0;beat<4;beat++) {
    // Separate upper (hat/snare) and lower (kick) voices preserve overlapping notes.
    for (const lower of [false,true]) {
      const tracks: Instrument[] = lower ? ['kick'] : ['hihat','snare'];
      const hits = Array.from({length:4},(_,i)=>beat*4+i).filter(s=>tracks.some(t=>pattern.tracks[t][offset+s]));
      const duration = hits.some(s=>s%2) ? 1 : hits.some(s=>s%4) ? 2 : 4;
      const stems: {x:number;end:number;s:number}[]=[];
      for (let s=beat*4;s<beat*4+4;s+=duration) {
        const active=tracks.filter(t=>pattern.tracks[t][offset+s]);
        if (!active.length) {svg+=rest(x(s),lower?133:78,duration);continue;}
        const ys=active.map(t=>t==='hihat'?56:t==='snare'?86:101);
        for (let j=0;j<active.length;j++) {
          svg+=`<g data-instrument="${active[j]}" data-step="${offset+s}" data-accent="${pattern.tracks[active[j]][offset+s]===2}">${head(x(s),ys[j],active[j]==='hihat')}</g>`;
          if(pattern.tracks[active[j]][offset+s]===2) svg+=`<path d="M${x(s)-4},${lower?161:18}l8,3 -8,3" fill="none"/>`;
        }
        const sx=x(s)+(lower?-5:5), end=lower?151:29;
        svg+=`<path d="M${sx},${lower?Math.min(...ys):Math.max(...ys)}V${end}"/>`;
        stems.push({x:sx,end,s});
      }
      if (duration<4) {
        for (const stem of stems) {
          const next=stems.find(other=>other.s===stem.s+duration);
          const previous=stems.find(other=>other.s===stem.s-duration);
          if(next) {
            svg+=`<path d="M${stem.x},${stem.end}H${next.x}" stroke-width="4"/>`;
            if(duration===1) svg+=`<path d="M${stem.x},${stem.end+(lower?-7:7)}H${next.x}" stroke-width="3"/>`;
          } else if(!previous) {
            const direction = lower ? -1 : 1;
            const flag = (y: number) => `<path data-flag-direction="${lower?'up':'down'}" d="M${stem.x},${y}c12,${5*direction} 15,${12*direction} 8,${22*direction}" fill="none"/>`;
            svg+=flag(stem.end);
            if(duration===1) svg+=flag(stem.end+7*direction);
          }
        }
      }
    }
  }
  svg+='</g><g fill="currentColor" font-family="system-ui,sans-serif" font-size="12" opacity=".6">';
  const subdivision = Object.values(pattern.tracks).some(steps=>steps.slice(offset,offset+16).some((value,i)=>i%2&&value)) ? 1 : 2;
  for(let s=0;s<16;s+=subdivision) svg+=`<text x="${x(s)}" y="184" text-anchor="middle">${s%4===0?s/4+1:s%4===2?'&amp;':s%4===1?'e':'a'}</text>`;
  return svg+'</g></svg>';
}
