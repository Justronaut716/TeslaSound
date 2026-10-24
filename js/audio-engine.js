import { clamp } from './driving-model.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.backend = null;
    this.sources = [];
    this.fallbackReason = '';
  }

  async start() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('Web Audio wird von diesem Browser nicht unterstützt.');
    this.ctx = new Context({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    // resume() is called during the button gesture, before any module loading.
    await ctx.resume();
    if (this.ctx !== ctx || ctx.state === 'closed') return false;
    try {
      if (!ctx.audioWorklet || !window.AudioWorkletNode) throw new Error('AudioWorklet nicht verfügbar');
      await ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url));
      if (this.ctx !== ctx || ctx.state === 'closed') return false;
      this.node = new AudioWorkletNode(ctx, 'teslasound-v8', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.connect(this.master);
      this.node.onprocessorerror = () => {
        if (this.ctx !== ctx || ctx.state === 'closed') return;
        this.node.disconnect();
        this.node = null;
        this.fallbackReason = 'Audio-Thread unterbrochen';
        this.createFallback();
      };
      this.backend = 'AudioWorklet';
    } catch (error) {
      if (this.ctx !== ctx || ctx.state === 'closed') return false;
      this.fallbackReason = error.message;
      this.createFallback();
    }
    return true;
  }

  createFallback() {
    const ctx = this.ctx;
    this.backend = 'Web Audio (Kompatibilität)';
    this.fallback = ctx.createGain();
    this.fallback.gain.value = 0.2;
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 450; this.lowpass.Q.value = 0.65;
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = 'lowshelf'; this.bassFilter.frequency.value = 120;
    const dc = ctx.createBiquadFilter(); dc.type = 'highpass'; dc.frequency.value = 18;
    const limiter = ctx.createWaveShaper();
    limiter.curve = Float32Array.from({ length: 2049 }, (_, i) => 0.9 * Math.tanh((i / 1024 - 1) * 1.5));
    // No compressor lookahead, convolution tail, ScriptProcessor or audio queue.
    this.fallback.connect(this.lowpass); this.lowpass.connect(this.bassFilter);
    this.bassFilter.connect(dc); dc.connect(limiter); limiter.connect(this.master);
    this.oscillators = [];
    for (const bank of [[0, 3, 5, 6], [1, 2, 4, 7]]) {
      const real = new Float32Array(65), imag = new Float32Array(65);
      for (let h = 1; h < real.length; h++) {
        for (const cylinder of bank) {
          const phase = h * cylinder * Math.PI / 4;
          const envelope = 0.25 / (1 + (h * 0.17) ** 2);
          real[h] += Math.cos(phase) * envelope;
          imag[h] -= Math.sin(phase) * envelope;
        }
      }
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
      osc.frequency.value = 850 / 120;
      osc.connect(this.fallback); osc.start();
      this.sources.push(osc); this.oscillators.push(osc);
    }
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x12345678;
    for (let i = 0; i < data.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      data[i] = seed / 2147483648;
    }
    const noise = ctx.createBufferSource(); noise.buffer = buffer; noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = 1200; noiseFilter.Q.value = 0.7;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
    noise.connect(noiseFilter); noiseFilter.connect(this.noiseGain); this.noiseGain.connect(this.fallback);
    noise.start(); this.sources.push(noise);
  }

  update({ rpm, load, overrun, volume, bass }) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    const now = ctx.currentTime;
    if (this.node) {
      // .value changes the current parameter without appending automation events.
      for (const [name, value] of Object.entries({ rpm, load, overrun, bass })) {
        this.node.parameters.get(name).value = value;
      }
    } else if (this.oscillators) {
      const target = (param, value) => {
        param.cancelScheduledValues(now);
        param.setTargetAtTime(value, now, 0.008);
      };
      for (const osc of this.oscillators) target(osc.frequency, rpm / 120);
      target(this.fallback.gain, 0.13 + load * 0.25);
      target(this.lowpass.frequency, 240 + rpm * 0.045 + load * 1100);
      target(this.bassFilter.gain, -4 + bass * 12);
      target(this.noiseGain.gain, 0.015 + load * load * 0.13 + overrun * 0.015);
    }
    this.setVolume(volume);
  }

  setVolume(volume) {
    if (!this.ctx || this.ctx.state === 'closed') return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(clamp(volume, 0, 1), now, 0.01);
  }

  diagnostics() {
    const ctx = this.ctx;
    return { backend: this.backend, state: ctx?.state ?? 'closed', sampleRate: ctx?.sampleRate,
      baseLatency: Number.isFinite(ctx?.baseLatency) ? ctx.baseLatency : null,
      outputLatency: Number.isFinite(ctx?.outputLatency) ? ctx.outputLatency : null };
  }

  async stop() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.ctx = null;
    if (ctx.state === 'running') {
      this.master.gain.cancelScheduledValues(ctx.currentTime);
      this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.006);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    if (this.node) { this.node.onprocessorerror = null; this.node.disconnect(); this.node = null; }
    for (const source of this.sources) { source.stop(); source.disconnect(); }
    this.sources = []; this.oscillators = null;
    if (ctx.state !== 'closed') await ctx.close();
  }
}
