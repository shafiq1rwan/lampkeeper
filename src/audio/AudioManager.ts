// Procedural Web Audio: footsteps, hum, switches, repair, creature cues. No audio files.
// Levels are deliberately low; there are no sudden volume spikes or continuous horror drones.

type Mute = 'settings' | 'hidden' | 'ad' | 'pause';

export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private hum!: GainNode;
  private noise!: AudioBuffer;
  private repairOsc: OscillatorNode | null = null;
  private repairGain: GainNode | null = null;
  private chaseTimer = 0;
  private readonly mutes = new Set<Mute>();
  private effectsLevel = 0.8;
  private ambienceLevel = 0.6;
  private gentle = false;
  private chasing = false;

  get unlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Create/resume the context. Must be called from a real user gesture. */
  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.build();
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private build(): void {
    const c = this.ctx!;
    this.master = c.createGain();
    this.master.gain.value = 0;
    this.master.connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.connect(this.master);
    this.amb = c.createGain();
    this.amb.connect(this.master);
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Quiet electrical hum, scaled by how many circuits are powered.
    this.hum = c.createGain();
    this.hum.gain.value = 0;
    this.hum.connect(this.amb);
    for (const [f, g] of [
      [60, 0.5],
      [120, 0.3],
      [180, 0.08],
    ]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      const og = c.createGain();
      og.gain.value = g * 0.05;
      o.connect(og).connect(this.hum);
      o.start();
    }
    // Soft room tone.
    const air = c.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const ag = c.createGain();
    ag.gain.value = 0.012;
    air.connect(lp).connect(ag).connect(this.amb);
    air.start();
    this.applyLevels();
  }

  setLevels(muted: boolean, ambience: number, effects: number, gentle: boolean): void {
    if (muted) this.mutes.add('settings');
    else this.mutes.delete('settings');
    this.ambienceLevel = ambience;
    this.effectsLevel = effects;
    this.gentle = gentle;
    this.applyLevels();
  }

  /** Mute reasons compose like pause reasons: e.g. an ad ending does not unmute a hidden tab. */
  setMuted(reason: Exclude<Mute, 'settings'>, on: boolean): void {
    if (on) this.mutes.add(reason);
    else this.mutes.delete(reason);
    this.applyLevels();
  }

  private applyLevels(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const silent = this.mutes.size > 0;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(silent ? 0 : 1, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.effectsLevel, t, 0.05);
    this.amb.gain.setTargetAtTime(this.ambienceLevel, t, 0.1);
    if (silent) this.stopRepair();
  }

  setHum(poweredCircuits: number): void {
    if (!this.ctx) return;
    this.hum.gain.setTargetAtTime(0.35 + poweredCircuits * 0.3, this.ctx.currentTime, 0.4);
  }

  // ---------------------------------------------------------------- one-shots

  private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private tone(type: OscillatorType, f0: number, f1: number, peak: number, attack: number, decay: number, delay = 0): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + attack + decay);
    const g = c.createGain();
    this.env(g, t, peak, attack, decay);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + attack + decay + 0.05);
  }

  private burst(freq: number, q: number, peak: number, decay: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    this.env(g, t, peak, 0.005, decay);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random() * 0.5);
    s.stop(t + decay + 0.05);
  }

  footstep(): void {
    this.burst(700 + Math.random() * 300, 0.8, 0.09, 0.07);
  }

  switchOn(): void {
    this.burst(3000, 2, 0.12, 0.03, 'highpass');
    this.tone('sine', 140, 90, 0.16, 0.005, 0.12);
    this.tone('triangle', 220, 440, 0.05, 0.05, 0.3, 0.05);
  }

  switchOffWarning(): void {
    this.burst(2600, 2, 0.1, 0.03, 'highpass');
    this.tone('triangle', 520, 190, 0.07, 0.05, 0.95);
  }

  circuitOff(): void {
    this.tone('sine', 110, 60, 0.12, 0.01, 0.35);
  }

  powerFull(): void {
    this.tone('square', 196, 196, 0.035, 0.01, 0.12);
    this.tone('square', 165, 165, 0.035, 0.01, 0.16, 0.15);
  }

  startRepair(): void {
    const c = this.ctx;
    if (!c || this.repairOsc || this.mutes.size > 0) return;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 330;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.045, c.currentTime, 0.05);
    const lfo = c.createOscillator();
    lfo.frequency.value = 14;
    const lg = c.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg).connect(g.gain);
    o.connect(g).connect(this.sfx);
    o.start();
    lfo.start();
    o.onended = () => lfo.stop();
    this.repairOsc = o;
    this.repairGain = g;
  }

  repairProgress(p: number): void {
    if (this.repairOsc && this.ctx) this.repairOsc.frequency.setTargetAtTime(330 + p * 330, this.ctx.currentTime, 0.05);
  }

  stopRepair(): void {
    if (!this.repairOsc || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.repairGain!.gain.setTargetAtTime(0, t, 0.03);
    this.repairOsc.stop(t + 0.15);
    this.repairOsc = null;
    this.repairGain = null;
  }

  repairDone(): void {
    this.stopRepair();
    this.tone('sine', 880, 880, 0.12, 0.01, 0.6);
    this.tone('sine', 1320, 1320, 0.07, 0.01, 0.7, 0.08);
    this.burst(4000, 1, 0.05, 0.15, 'highpass');
  }

  warn(): void {
    const k = this.gentle ? 0.5 : 1;
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(62, t);
    o.frequency.linearRampToValueAtTime(48, t + 0.8);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(200, t);
    f.frequency.linearRampToValueAtTime(520, t + 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13 * k, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.95);
    o.connect(f).connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 1);
    this.tone('sine', 1250, 1400, 0.025 * k, 0.05, 0.4, 0.1);
  }

  /** Low heartbeat pulse while chased (called each frame). */
  setChasing(on: boolean, dt: number): void {
    this.chasing = on;
    if (!this.ctx || !on) {
      this.chaseTimer = 0;
      return;
    }
    this.chaseTimer -= dt;
    if (this.chaseTimer <= 0) {
      this.chaseTimer = 0.62;
      const k = this.gentle ? 0.5 : 1;
      this.tone('sine', 70, 50, 0.12 * k, 0.01, 0.16);
      this.tone('sine', 66, 48, 0.08 * k, 0.01, 0.16, 0.2);
    }
  }

  get isChasing(): boolean {
    return this.chasing;
  }

  emerge(): void {
    this.burst(400, 3, 0.05 * (this.gentle ? 0.6 : 1), 0.9, 'bandpass');
  }

  retreat(): void {
    this.burst(900, 2, 0.05, 0.5, 'bandpass');
    this.tone('sine', 300, 120, 0.04, 0.02, 0.5);
  }

  safeArrival(): void {
    this.tone('sine', 392, 392, 0.035, 0.03, 0.45);
    this.tone('sine', 494, 494, 0.028, 0.03, 0.45, 0.04);
  }

  capture(): void {
    const k = this.gentle ? 0.6 : 1;
    this.tone('sine', 90, 40, 0.16 * k, 0.02, 0.9);
    this.burst(300, 1, 0.06 * k, 0.7);
  }

  tenant(): void {
    this.tone('triangle', 523, 523, 0.06, 0.02, 0.25);
    this.tone('triangle', 659, 659, 0.06, 0.02, 0.3, 0.14);
  }

  result(): void {
    [523, 659, 784].forEach((f, i) => this.tone('sine', f, f, 0.07, 0.02, 0.6, i * 0.12));
  }

  ending(): void {
    [392, 494, 587, 784].forEach((f, i) => this.tone('sine', f, f, 0.06, 0.05, 1.4, i * 0.3));
  }

  ui(): void {
    this.tone('sine', 660, 660, 0.03, 0.005, 0.06);
  }
}
