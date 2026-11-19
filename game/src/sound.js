// Neon Harbor — synthesised sound. Every sound is built from oscillators and
// noise buffers in Web Audio; there are no audio files anywhere in the game.

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
    this.musicTimer = 0;
    this.musicStep = 0;
    this.noiseBuffer = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.startEngine();
      this.startSiren();
    } catch (e) {
      this.ctx = null;
    }
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.5;
  }

  startEngine() {
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;
    const low = this.ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 320;
    this.engineOsc.connect(low);
    low.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
  }

  startSiren() {
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'sine';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0.0;
    this.sirenLfo = this.ctx.createOscillator();
    this.sirenLfo.type = 'sine';
    this.sirenLfo.frequency.value = 0.6;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 220;
    this.sirenLfo.connect(lfoGain);
    lfoGain.connect(this.sirenOsc.frequency);
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    this.sirenLfo.start();
  }

  // Called every frame: engine follows speed, siren follows the wanted level.
  update(speedNorm, wantedStars) {
    if (!this.ctx) return;
    if (!Number.isFinite(speedNorm)) speedNorm = 0;
    const now = this.ctx.currentTime;
    if (this.engineOsc) {
      this.engineOsc.frequency.setTargetAtTime(55 + speedNorm * 130, now, 0.08);
      this.engineGain.gain.setTargetAtTime(speedNorm > 0.02 ? 0.05 + speedNorm * 0.05 : 0.0, now, 0.1);
    }
    if (this.sirenGain) {
      this.sirenGain.gain.setTargetAtTime(wantedStars > 0 ? 0.035 : 0.0, now, 0.3);
    }
    // Minimal generative music: a slow minor arpeggio, one note per beat.
    this.musicTimer -= 1 / 60;
    if (this.musicTimer <= 0) {
      this.musicTimer = 0.42;
      const scale = [110, 130.8, 164.8, 196, 220, 261.6];
      const note = scale[this.musicStep % scale.length];
      this.musicStep++;
      this.blip(note, 0.4, 'triangle', 0.045);
      if (this.musicStep % 4 === 1) this.blip(note / 2, 0.8, 'sine', 0.05);
    }
  }

  blip(freq, dur, type, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  noiseBurst(dur, vol, filterFreq) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  shot() {
    this.noiseBurst(0.14, 0.35, 2600);
    this.blip(180, 0.08, 'square', 0.12);
  }

  punch() {
    this.noiseBurst(0.09, 0.3, 500);
  }

  crash() {
    this.noiseBurst(0.3, 0.4, 900);
  }

  click() {
    this.blip(660, 0.07, 'sine', 0.08);
  }

  steal() {
    this.blip(392, 0.1, 'triangle', 0.1);
    setTimeout(() => this.blip(523, 0.12, 'triangle', 0.1), 90);
  }

  missionDone() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'triangle', 0.12), i * 110));
  }
}
