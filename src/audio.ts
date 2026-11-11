import {LocalizedError} from './i18n.js';
import {INSTRUMENTS, stepEvents, stepDuration, type Pattern, type Sound, type Instrument} from './model.js';

export class DrumPlayer {
  context!: AudioContext;
  buffers?: Record<Instrument,AudioBuffer>;
  bus?: GainNode;
  limiter?: DynamicsCompressorNode;
  trackGains: Record<Sound,GainNode> | null = null;
  bpm: number; metronome: boolean; drums: boolean; loop: boolean;
  mix: Record<Sound,number>;
  events: {time:number;step:number}[];
  running: boolean;
  pattern!: Pattern;
  step = 0; nextTime = 0; ending: number | null = null;
  timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private loading?: Promise<void>;
  onend?: () => void;
  oninterrupt?: () => void;
  constructor() {
    this.bpm = 80; this.metronome = true; this.drums = true; this.loop = true;
    this.mix = {hihat:.55,snare:.8,kick:.9,click:.4}; this.events = []; this.running = false;
  }
  async prepare() {
    this.context ??= new (window.AudioContext || (window as unknown as {webkitAudioContext: typeof AudioContext}).webkitAudioContext)();
    this.context.onstatechange = () => { if(this.context.state !== 'running' && this.running) {this.stop();this.oninterrupt?.();} };
    await this.context.resume();
    if (!this.buffers) {
      this.loading ??= (async () => {
        const buffers = await Promise.all(INSTRUMENTS.map(async name => {
          const response = await fetch(`./assets/sounds/${name}.wav`);
          if (!response.ok) throw new LocalizedError('error.audioLoad',{sound:name});
          return [name,await this.context.decodeAudioData(await response.arrayBuffer())];
        }));
        this.buffers = Object.fromEntries(buffers) as Record<Instrument,AudioBuffer>;
      })().finally(() => { this.loading = undefined; });
      await this.loading;
    }
  }
  async start(pattern: Pattern, countIn: boolean) {
    this.stop();
    const generation = this.generation;
    await this.prepare();
    if (generation !== this.generation) return false;
    this.pattern = pattern;
    this.bus = this.context.createGain(); this.bus.gain.value = .75;
    const limiter = this.context.createDynamicsCompressor();
    this.bus.connect(limiter); limiter.connect(this.context.destination);
    this.limiter = limiter;
    this.trackGains = Object.fromEntries(([...INSTRUMENTS,'click'] as Sound[]).map(name => {
      const gain = this.context.createGain(); gain.gain.value = this.mix[name]; gain.connect(this.bus!); return [name,gain];
    })) as Record<Sound,GainNode>;
    this.step = countIn ? -16 : 0; this.nextTime = this.context.currentTime + .08;
    this.running = true; this.ending = null;
    this.timer = setInterval(() => this.schedule(),25); this.schedule();
    return true;
  }
  setVolume(name: Sound,value: number) {
    this.mix[name] = value;
    this.trackGains?.[name].gain.setTargetAtTime(value,this.context.currentTime,.01);
  }
  schedule() {
    if (!this.running) return;
    // A long foreground task can stall timers without hiding the page. Do not
    // send overdue notes to Web Audio, which would play them all immediately.
    if (this.ending === null && this.context.currentTime - this.nextTime > .1) {
      this.stop(); this.oninterrupt?.(); return;
    }
    while (this.nextTime < this.context.currentTime + .1 && this.ending === null) {
      for (const event of stepEvents(this.pattern,this.step,this)) this.hit(event.instrument,event.velocity,this.nextTime);
      this.events.push({time:this.nextTime, step:this.step});
      this.nextTime += stepDuration(this.bpm);
      this.step++;
      if (this.step === this.pattern.bars*16) {
        if (this.loop) this.step=0;
        else this.ending = this.nextTime;
      }
    }
    if (this.ending !== null && this.context.currentTime >= this.ending) { this.stop(); this.onend?.(); }
  }
  hit(name: Sound,velocity: number,time: number) {
    const envelope = this.context.createGain(); envelope.connect(this.trackGains![name]);
    if (name === 'click') {
      const oscillator = this.context.createOscillator(); oscillator.frequency.value = velocity === 2 ? 1400 : 950;
      envelope.gain.setValueAtTime(.5,time); envelope.gain.exponentialRampToValueAtTime(.001,time+.035);
      oscillator.connect(envelope); oscillator.start(time); oscillator.stop(time+.04);
      oscillator.onended = () => envelope.disconnect();
    } else {
      const source = this.context.createBufferSource(); source.buffer = this.buffers![name];
      envelope.gain.value = velocity === 2 ? 1 : .7;
      source.connect(envelope); source.start(time); source.onended = () => envelope.disconnect();
    }
  }
  stop() {
    this.generation++;
    clearInterval(this.timer); this.running=false; this.events=[];
    this.bus?.disconnect(); this.limiter?.disconnect(); this.trackGains=null;
  }
  currentEvent() {
    let event;
    while(this.events.length && this.events[0].time <= this.context.currentTime) event=this.events.shift();
    return event;
  }
}
