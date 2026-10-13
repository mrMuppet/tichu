// Selbst erzeugte Spielklänge (Web Audio, keine Audiodateien nötig)
(function () {
  'use strict';
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('tichu.muted') === '1'; } catch (e) { /* egal */ }

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // kurzer Ton mit Hüllkurve
  function tone(freq, start, dur, opts) {
    const c = ac(), o = opts || {};
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, c.currentTime + start);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, c.currentTime + start + dur);
    const vol = o.vol || 0.15;
    g.gain.setValueAtTime(0.0001, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol, c.currentTime + start + (o.attack || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(c.currentTime + start);
    osc.stop(c.currentTime + start + dur + 0.05);
  }

  // gefiltertes Rauschen (Kartengeräusche)
  function noise(start, dur, opts) {
    const c = ac(), o = opts || {};
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, o.decay || 2);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.value = o.freq || 2500;
    f.Q.value = o.q || 0.8;
    const g = c.createGain();
    g.gain.value = o.vol || 0.3;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(c.currentTime + start);
  }

  // ein „Wuff“: kurzer, rauer Ton mit schnellem Tonhöhenabfall plus Rauschen
  function woof(start) {
    const c = ac();
    const t = c.currentTime + start;
    const osc = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.03);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.16);
    f.type = 'bandpass'; f.frequency.value = 1100; f.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(f); f.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + 0.22);
    noise(start, 0.12, { freq: 1500, q: 1.5, vol: 0.25, decay: 3 });
  }

  // Audiodateien (werden beim ersten Klang geladen und dekodiert)
  const SAMPLES = { dog: 'sounds/dog-bark.wav' };
  const buffers = {};
  function loadSamples() {
    if (loadSamples.done) return;
    loadSamples.done = true;
    for (const [name, url] of Object.entries(SAMPLES)) {
      fetch(url).then(r => r.arrayBuffer()).then(b => ac().decodeAudioData(b))
        .then(buf => { buffers[name] = buf; }).catch(() => { /* Ersatzklang bleibt */ });
    }
  }
  function sample(name, vol) {
    const c = ac(), src = c.createBufferSource(), g = c.createGain();
    src.buffer = buffers[name];
    g.gain.value = vol;
    src.connect(g); g.connect(c.destination);
    src.start();
  }

  const SOUNDS = {
    dog() { if (buffers.dog) sample('dog', 0.8); else { woof(0); woof(0.22); } },
    play() { noise(0, 0.09, { freq: 3200, vol: 0.35 }); noise(0.02, 0.06, { freq: 1200, vol: 0.2 }); },
    pass() { tone(320, 0, 0.12, { type: 'triangle', vol: 0.08 }); },
    turn() { tone(660, 0, 0.15, { vol: 0.12 }); tone(880, 0.12, 0.22, { vol: 0.12 }); },
    bomb() {
      tone(140, 0, 0.6, { type: 'sawtooth', to: 40, vol: 0.18 });
      noise(0, 0.5, { filter: 'lowpass', freq: 600, vol: 0.6, decay: 1.5 });
    },
    tichu() { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.08, 0.25, { type: 'triangle', vol: 0.12 })); },
    collect() { for (let i = 0; i < 4; i++) noise(i * 0.05, 0.07, { freq: 2200 + i * 300, vol: 0.18 }); },
    dragon() { tone(110, 0, 0.5, { type: 'sawtooth', to: 70, vol: 0.12 }); tone(165, 0.05, 0.45, { type: 'square', to: 90, vol: 0.05 }); },
    roundEnd() { [523, 659, 784].forEach((f, i) => tone(f, i * 0.14, 0.35, { vol: 0.12 })); tone(1047, 0.42, 0.6, { vol: 0.12 }); },
    warn() { tone(990, 0, 0.08, { type: 'square', vol: 0.05 }); tone(990, 0.15, 0.08, { type: 'square', vol: 0.05 }); },
  };

  // Browser erlauben Audio erst nach einer Nutzeraktion: dann vorladen
  document.addEventListener('pointerdown', () => { if (!muted) loadSamples(); }, { once: true });

  window.Sfx = {
    play(name) {
      if (muted || !SOUNDS[name]) return;
      loadSamples();
      try { SOUNDS[name](); } catch (e) { /* Audio nicht verfügbar */ }
    },
    get muted() { return muted; },
    setMuted(v) {
      muted = !!v;
      try { localStorage.setItem('tichu.muted', muted ? '1' : '0'); } catch (e) { /* egal */ }
    },
  };
})();
