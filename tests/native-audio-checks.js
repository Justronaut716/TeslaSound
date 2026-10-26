// Render actual browser nodes rather than mocking oscillators/buffers/filters.
import { AudioEngine } from '../js/audio-engine.js?v=20261026-combustion';
import { ENGINE_PRESETS } from '../js/engine-presets.js?v=20261026-combustion';

function energy(audio, hz) {
  let re = 0, im = 0;
  for (let i = 0; i < audio.length; i++) {
    const phase = i * 2 * Math.PI * hz / 48000;
    re += audio[i] * Math.cos(phase); im += audio[i] * Math.sin(phase);
  }
  return re * re + im * im;
}

async function render(id, rpm, load, bass = 0.7) {
  const engine = new AudioEngine(id), ctx = new OfflineAudioContext(1, 96000, 48000);
  engine.ctx = ctx; engine.master = ctx.createGain(); engine.master.connect(ctx.destination);
  engine.createFallback();
  engine.update({ rpm, load, overrun: 0, volume: 1, bass });
  const audio = (await ctx.startRendering()).getChannelData(0).subarray(48000);
  let peak = 0, sum = 0, jump = 0, mean = 0;
  for (let i = 0; i < audio.length; i++) {
    peak = Math.max(peak, Math.abs(audio[i])); sum += audio[i] * audio[i]; mean += audio[i];
    if (i) jump = Math.max(jump, Math.abs(audio[i] - audio[i - 1]));
  }
  const p = ENGINE_PRESETS.find(p => p.id === id), firing = rpm * p.cylinders / 120;
  // Some exhaust/low-shelf settings attenuate the fundamental while retaining
  // strong overtones. Check the firing-order family, not only its first tone.
  let firingEnergy = 0, betweenOrders = 0;
  for (let harmonic = 1; harmonic <= 4; harmonic++) {
    firingEnergy += energy(audio, firing * harmonic);
    betweenOrders += energy(audio, firing * harmonic + rpm / 240);
  }
  return { id, rpm, load, bass, peak, jump, mean: mean / audio.length, rms: Math.sqrt(sum / audio.length),
    pitch: firingEnergy / Math.max(1e-12, betweenOrders),
    low: energy(audio, firing), high: energy(audio, firing * 7) };
}

export async function checkNativeAudio() {
  const signals = [];
  for (const p of ENGINE_PRESETS) {
    for (const [rpm, load, bass] of [[p.idle, 0.035, 0.7], [3000, 0.08, 0.7], [3000, 0.95, 0.7],
      [p.redline, 1, 1], [1400, 0.5, 0], [1400, 0.5, 1]]) {
      signals.push(await render(p.id, rpm, load, bass));
    }
  }
  const engine = new AudioEngine('v8-muscle'), ctx = new OfflineAudioContext(1, 48000, 48000);
  engine.ctx = ctx; engine.master = ctx.createGain(); engine.master.connect(ctx.destination);
  engine.createFallback();
  for (let i = 0; i < 40; i++) engine.setPreset(ENGINE_PRESETS[i % 4].id);
  const bounded = { voices: engine.voices.size, sources: engine.sources.length };
  await ctx.startRendering(); await engine.stop();
  bounded.stopped = engine.sources.length === 0 && engine.ctx === null;
  return { signals, bounded };
}
