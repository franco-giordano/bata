import {en, LocalizedError} from './i18n.js';
export type Instrument = 'hihat' | 'snare' | 'kick';
export type Sound = Instrument | 'click';
export interface Pattern {
  id: string; name: string; description: string; letter?: string; bars: number; bpm: number;
  tracks: Record<Instrument, number[]>;
}
export interface Hit { instrument: Sound; velocity: number }
export const INSTRUMENTS: Instrument[] = ['hihat', 'snare', 'kick'];
export const KICKS = [[0,8],[0,8],[0,2],[0,4],[0,6],[0,8,10],[0,10],[0,14],[0,6,10],[0,10,14]];
const descriptions = [en['exercise.A'],en['exercise.B'],en['exercise.C'],en['exercise.D'],en['exercise.E'],en['exercise.F'],en['exercise.G'],en['exercise.H'],en['exercise.I'],en['exercise.J']];
export const EXERCISES: Pattern[] = KICKS.map((kicks, i) => ({
  id: `reading-${String.fromCharCode(97 + i)}`, name: en['exercise.name'].replace('{letter}',String.fromCharCode(65+i)),
  letter: String.fromCharCode(65+i), description: descriptions[i], bars: 1, bpm: 80,
  tracks: Object.fromEntries(INSTRUMENTS.map(track => [track, Array.from({length:16}, (_,step) =>
    +(track === 'kick' ? kicks.includes(step) : track === 'snare' ? [4,12].includes(step) : step % (i ? 2 : 4) === 0))])) as Pattern['tracks']
}));
export function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
export function validatePattern(input: unknown): Pattern {
  const value = input as Partial<Pattern> | null;
  if (!value || typeof value !== 'object' || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) throw new LocalizedError('error.name');
  if (![1,2,4].includes(value.bars as number)) throw new LocalizedError('error.bars');
  if (!Number.isInteger(value.bpm) || value.bpm! < 30 || value.bpm! > 240) throw new LocalizedError('error.tempo');
  for (const track of INSTRUMENTS) {
    const steps = value.tracks?.[track];
    if (!Array.isArray(steps) || steps.length !== value.bars! * 16 || !steps.every((n: unknown) => [0,1,2].includes(n as number))) throw new LocalizedError('error.steps',{sound:track,count:value.bars!*16});
  }
  // Keep only known tracks: an imported extra property must not become part of
  // the renderer or audio model, even if the three required tracks are valid.
  const tracks = Object.fromEntries(INSTRUMENTS.map(track => [track,[...value.tracks![track]]])) as Pattern['tracks'];
  return {id: typeof value.id === 'string' ? value.id.slice(0,100) : '', name:value.name.trim(), description:en['pattern.custom'], bars:value.bars!, bpm:value.bpm!, tracks};
}
export function readCollection(text: string, {allowEmpty=false}={}): Pattern[] {
  let data;
  try {data=JSON.parse(text);} catch {throw new LocalizedError('error.file');}
  if (!data || data.version !== 1 || !Array.isArray(data.patterns) || (!allowEmpty && !data.patterns.length)) throw new LocalizedError('error.collection');
  return data.patterns.map(validatePattern);
}
export function stepEvents(pattern: Pattern, step: number, {metronome=true, drums=true}={}) {
  const events: Hit[] = [];
  if (step < 0) { if (step % 4 === 0) events.push({instrument:'click',velocity: step === -16 ? 2 : 1}); return events; }
  if (metronome && step % 4 === 0) events.push({instrument:'click',velocity: step % 16 === 0 ? 2 : 1});
  if (drums) for (const instrument of INSTRUMENTS) if (pattern.tracks[instrument][step]) events.push({instrument,velocity:pattern.tracks[instrument][step]});
  return events;
}
export function stepDuration(bpm: number) { return 60 / bpm / 4; }
