// Sound only, through Web Audio: every sound is synthesised, no audio files
// and no network request. The context is created lazily on the first user
// gesture, so the game stays silent (and error-free) in screenshot mode and
// before the first press. Three buses (music / world / ui) with a priority
// and a per-sound concurrency cap, so a pile-up of crashes never turns to mud.
// A tiny step-sequenced music loop runs under it all.
export function createSound(opts = {}) {
  const disabled = !!opts.disabled; // bench / ?noaudio: never touch audio
  let context = null;
  let master = null;
  let musicBus = null;
  let worldBus = null;
  let uiBus = null;
  let muted = false;
  let engineOsc = null;
  let engineGain = null;
  let engineFilter = null;
  let sirenOsc = null;
  let sirenGain = null;
  let sirenTimer = 0;
  let sirenHigh = false;
  let musicTimer = null;
  let musicStep = 0;
  // Concurrency caps: how many voices of one sound may overlap.
  const active = new Map();
  function gate(name, max, duration) {
    const n = active.get(name) || 0;
    if (n >= max) return false;
    active.set(name, n + 1);
    setTimeout(() => active.set(name, Math.max(0, (active.get(name) || 1) - 1)), Math.ceil(duration * 1000));
    return true;
  }

  function ensure() {
    if (disabled) return null;
    if (context === null) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return null;
        context = new AudioContext();
        master = context.createGain();
        master.gain.value = 0.6;
        master.connect(context.destination);
        musicBus = context.createGain();
        musicBus.gain.value = 0.5;
        musicBus.connect(master);
        worldBus = context.createGain();
        worldBus.gain.value = 0.9;
        worldBus.connect(master);
        uiBus = context.createGain();
        uiBus.gain.value = 0.8;
        uiBus.connect(master);
        startEngine();
        startMusic();
      } catch {
        return null;
      }
    }
    if (context && context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }

  function tone(freq, start, duration, type, gainValue, slideTo, bus) {
    const ctx = ensure();
    if (ctx === null || muted) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + start + duration);
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(gainValue, ctx.currentTime + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
      osc.connect(gain).connect(bus || worldBus);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration + 0.05);
    } catch { /* Sound is decoration: never let it break the game. */ }
  }

  function noise(start, duration, gainValue, filterFreq, bus) {
    const ctx = ensure();
    if (ctx === null || muted) return;
    try {
      const len = Math.max(1, Math.floor(ctx.sampleRate * duration));
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq || 1200;
      const gain = ctx.createGain();
      gain.gain.value = gainValue;
      src.connect(filter).connect(gain).connect(bus || worldBus);
      src.start(ctx.currentTime + start);
    } catch { /* ignore */ }
  }

  function startEngine() {
    try {
      engineOsc = context.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 55;
      engineFilter = context.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 420;
      engineGain = context.createGain();
      engineGain.gain.value = 0;
      engineOsc.connect(engineFilter).connect(engineGain).connect(worldBus);
      engineOsc.start();
    } catch { /* ignore */ }
  }

  function setEngine(speed, driving) {
    if (!context || !engineGain || muted) return;
    try {
      const target = driving ? 0.05 + Math.min(0.11, Math.abs(speed) * 0.003) : 0.0;
      engineGain.gain.setTargetAtTime(target, context.currentTime, 0.1);
      engineOsc.frequency.setTargetAtTime(52 + Math.abs(speed) * 3.2, context.currentTime, 0.1);
    } catch { /* ignore */ }
  }

  function setSiren(on) {
    const ctx = ensure();
    if (ctx === null) return;
    try {
      if (on && !sirenOsc) {
        // A siren is two alternating sine sweeps: 700 -> 1100 Hz, then back.
        sirenOsc = ctx.createOscillator();
        sirenOsc.type = 'sine';
        sirenOsc.frequency.value = 700;
        sirenGain = ctx.createGain();
        sirenGain.gain.value = 0.05;
        sirenOsc.connect(sirenGain).connect(worldBus);
        sirenOsc.start();
        sirenTimer = 0;
        sirenHigh = false;
      } else if (!on && sirenOsc) {
        sirenOsc.stop();
        sirenOsc = null;
        sirenGain = null;
      }
    } catch { /* ignore */ }
  }

  function updateSiren(dt) {
    if (!sirenOsc || muted) return;
    sirenTimer += dt;
    if (sirenTimer > 0.55) {
      sirenTimer = 0;
      sirenHigh = !sirenHigh;
      try {
        const t = context.currentTime;
        sirenOsc.frequency.cancelScheduledValues(t);
        sirenOsc.frequency.setValueAtTime(sirenOsc.frequency.value, t);
        sirenOsc.frequency.linearRampToValueAtTime(sirenHigh ? 1100 : 700, t + 0.5);
      } catch { /* ignore */ }
    }
  }

  // Music: a slow minor-key groove — bass on the beat, a sparse lead arp.
  // 16 steps a bar at 96 bpm, scheduled a bar ahead.
  const BASS = [55, 0, 55, 0, 65.41, 0, 55, 0, 49, 0, 49, 0, 58.27, 0, 65.41, 0];
  const LEAD = [220, 0, 261.63, 0, 329.63, 0, 261.63, 0, 196, 0, 220, 0, 246.94, 0, 293.66, 0];
  function startMusic() {
    if (musicTimer !== null) return;
    const stepDur = 60 / 96 / 4;
    musicTimer = setInterval(() => {
      if (muted || !context) return;
      const now = context.currentTime;
      for (let i = 0; i < 16; i += 1) {
        const step = (musicStep + i) % 16;
        const t = now + i * stepDur - context.currentTime;
        const bass = BASS[step];
        const lead = LEAD[step];
        if (bass) tone(bass, Math.max(0, t), stepDur * 1.8, 'sine', 0.12, null, musicBus);
        if (lead && step % 2 === 0) tone(lead, Math.max(0, t), stepDur * 1.4, 'triangle', 0.045, null, musicBus);
      }
      musicStep = (musicStep + 16) % 16;
    }, stepDur * 16 * 1000);
  }

  function jingle() {
    [523.25, 659.25, 783.99, 1046.5].forEach((n, i) => tone(n, i * 0.11, 0.5, 'triangle', 0.14, null, uiBus));
  }
  function fail() {
    [392, 311, 233].forEach((n, i) => tone(n, i * 0.16, 0.4, 'sawtooth', 0.08, null, uiBus));
  }

  return {
    unlock() { ensure(); },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.6;
      return muted;
    },
    isMuted() { return muted; },
    setEngine,
    setSiren,
    updateSiren,
    click() { if (gate('click', 2, 0.1)) tone(880, 0, 0.1, 'sine', 0.07, null, uiBus); },
    steal() { if (gate('steal', 1, 0.3)) { tone(220, 0, 0.15, 'square', 0.1, 440); tone(440, 0.1, 0.2, 'square', 0.08); } },
    crash() { if (gate('crash', 2, 0.35)) { noise(0, 0.35, 0.3, 900); tone(70, 0, 0.3, 'sine', 0.25, 40); } },
    pickup() { if (gate('pickup', 3, 0.3)) { tone(987.77, 0, 0.15, 'triangle', 0.14); tone(1318.5, 0.08, 0.25, 'triangle', 0.12); } },
    punch() { if (gate('punch', 2, 0.12)) { noise(0, 0.12, 0.22, 500); tone(120, 0, 0.12, 'sine', 0.18, 60); } },
    shot() { if (gate('shot', 3, 0.18)) { noise(0, 0.18, 0.3, 2500); tone(180, 0, 0.15, 'sine', 0.2, 50); } },
    hit() { if (gate('hit', 3, 0.2)) tone(140, 0, 0.2, 'sawtooth', 0.12, 70); },
    jingle,
    fail,
  };
}
