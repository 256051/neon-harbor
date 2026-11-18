// Neon Harbor — every sound is synthesised with Web Audio; the game ships no
// audio files. The first call creates the context (browsers require a user
// gesture first) and resumes it; mute is a master gain that also silences the
// generative music loop, which runs on a lookahead scheduler.

const TUNES = [
  [220, 261.63, 329.63, 392], // Am
  [174.61, 220, 261.63, 329.63], // F
  [196, 246.94, 293.66, 392], // G
  [164.81, 220, 261.63, 329.63], // E
];
const TUNE_LEN = 8;

function createNoiseBuffer(ctx, duration) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function createSound() {
  let ctx = null;
  let master = null;
  let muted = false;
  let musicTimer = null;
  let tuneIndex = 0;
  let noteIndex = 0;
  let nextTime = 0;
  let noiseBuffer = null;

  function ensure() {
    if (ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    ctx = new AudioContextClass();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    noiseBuffer = createNoiseBuffer(ctx, 2);
  }

  function resume() {
    if (!ctx) ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  function tone(freq, dur, type = 'sine', volume = 0.5, when = 0, slideTo = null) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function noise(dur, filterFreq, type = 'lowpass', volume = 0.5, when = 0) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + when;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + dur + 0.05);
  }

  function playTuneStep() {
    if (!ctx || muted) return;
    const chord = TUNES[tuneIndex % TUNES.length];
    const note = chord[noteIndex % chord.length];
    tone(note, 1.6, 'sine', 0.14, 0, note);
    if (noteIndex % 4 === 0) tone(note / 2, 1.8, 'triangle', 0.08, 0, note / 2);
    noteIndex += 1;
    if (noteIndex >= TUNE_LEN) {
      noteIndex = 0;
      tuneIndex += 1;
    }
  }

  return {
    init() { ensure(); resume(); },
    setMuted(value) {
      muted = value;
      if (master) master.gain.value = muted ? 0 : 1;
    },
    isMuted() { return muted; },
    unlock() { resume(); },
    click() { tone(440, 0.05, 'square', 0.2); },
    punch() { noise(0.08, 600, 'lowpass', 0.6); tone(150, 0.08, 'square', 0.3, 0, 80); },
    shoot() { noise(0.12, 1800, 'highpass', 0.7); tone(300, 0.1, 'sawtooth', 0.25, 0, 90); },
    siren() { tone(700, 0.45, 'sine', 0.25, 0, 1000); tone(1000, 0.45, 'sine', 0.25, 0.45, 700); },
    engine() { tone(55, 0.3, 'sawtooth', 0.12, 0, 90); },
    horn() { tone(311, 0.18, 'square', 0.18); tone(392, 0.18, 'square', 0.18); },
    pickup() { tone(523.25, 0.12, 'sine', 0.3); tone(659.25, 0.12, 'sine', 0.3, 0.08); tone(783.99, 0.2, 'sine', 0.3, 0.16); },
    carSteal() { tone(220, 0.15, 'square', 0.2); tone(330, 0.15, 'square', 0.2, 0.12); },
    wanted() { tone(880, 0.15, 'square', 0.25); tone(660, 0.2, 'square', 0.25, 0.15); },
    crash() { noise(0.3, 400, 'lowpass', 0.8); tone(90, 0.25, 'square', 0.4, 0, 40); },
    mission() { tone(392, 0.15, 'sine', 0.3); tone(523.25, 0.15, 'sine', 0.3, 0.12); tone(659.25, 0.3, 'sine', 0.3, 0.24); },
    fail() { tone(330, 0.25, 'sawtooth', 0.25, 0, 220); tone(220, 0.4, 'sawtooth', 0.25, 0.22, 110); },
    win() { tone(523.25, 0.2, 'sine', 0.3); tone(659.25, 0.2, 'sine', 0.3, 0.15); tone(783.99, 0.2, 'sine', 0.3, 0.3); tone(1046.5, 0.5, 'sine', 0.3, 0.45); },
    step() { noise(0.05, 300, 'lowpass', 0.08); },
    splash() { noise(0.3, 1200, 'bandpass', 0.4); },
    startMusic() {
      if (musicTimer) return;
      ensure();
      if (!ctx) return;
      nextTime = ctx.currentTime + 0.1;
      musicTimer = setInterval(() => {
        if (!ctx) return;
        while (nextTime < ctx.currentTime + 0.4) {
          const delay = Math.max(0, nextTime - ctx.currentTime);
          const chord = TUNES[tuneIndex % TUNES.length];
          const note = chord[noteIndex % chord.length];
          tone(note, 1.6, 'sine', 0.12, delay, note);
          noteIndex += 1;
          if (noteIndex >= TUNE_LEN) {
            noteIndex = 0;
            tuneIndex += 1;
          }
          nextTime += 0.45;
        }
      }, 100);
    },
    stopMusic() {
      if (musicTimer) {
        clearInterval(musicTimer);
        musicTimer = null;
      }
    },
    getState() { return { muted, musicPlaying: musicTimer !== null }; },
  };
}
