import { clamp } from './driving-model.js';
import { getPreset } from './engine-presets.js';

export class AudioEngine {
  constructor(presetId) {
    this.preset = getPreset(presetId);
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
      this.node = new AudioWorkletNode(ctx, 'teslasound-v8', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
        parameterData: { preset: this.preset.index }, processorOptions: { presetId: this.preset.id }
      });
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
    this.voices = new Map();
    this.activeVoice = null;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x12345678;
    for (let i = 0; i < data.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      data[i] = seed / 2147483648;
    }
    this.noise = ctx.createBufferSource(); this.noise.buffer = buffer; this.noise.loop = true;
    this.noise.start(); this.sources.push(this.noise);
    this.activateFallback(this.preset);
  }

  createFallbackVoice(preset) {
    const ctx = this.ctx;
    const voice = { preset, oscillators: [] };
    voice.tone = ctx.createGain(); voice.tone.gain.value = 0.2;
    voice.lowpass = ctx.createBiquadFilter();
    voice.lowpass.type = 'lowpass'; voice.lowpass.frequency.value = preset.cutoff; voice.lowpass.Q.value = 0.65;
    voice.bass = ctx.createBiquadFilter();
    voice.bass.type = 'lowshelf'; voice.bass.frequency.value = preset.bodyHz;
    voice.fade = ctx.createGain(); voice.fade.gain.value = 0;
    const dc = ctx.createBiquadFilter(); dc.type = 'highpass'; dc.frequency.value = 18;
    const limiter = ctx.createWaveShaper();
    limiter.curve = Float32Array.from({ length: 2049 }, (_, i) => 0.9 * Math.tanh((i / 1024 - 1) * 1.5));
    // No compressor lookahead, convolution tail, ScriptProcessor or audio queue.
    voice.tone.connect(voice.lowpass); voice.lowpass.connect(voice.bass);
    voice.bass.connect(dc); dc.connect(limiter); limiter.connect(voice.fade); voice.fade.connect(this.master);
    for (const bank of [0, 1]) {
      const real = new Float32Array(65), imag = new Float32Array(65);
      for (let h = 1; h < real.length; h++) {
        for (let cylinder = 0; cylinder < preset.cylinders; cylinder++) {
          if (preset.banks[cylinder] !== bank) continue;
          const phase = h * cylinder * 2 * Math.PI / preset.cylinders;
          const envelope = preset.strength[cylinder] * 2 / preset.cylinders / (1 + (h * preset.decay * 60) ** 2);
          real[h] += Math.cos(phase) * envelope;
          imag[h] -= Math.sin(phase) * envelope;
        }
      }
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
      osc.frequency.value = preset.idle / 120;
      osc.connect(voice.tone); osc.start();
      this.sources.push(osc); voice.oscillators.push(osc);
    }
    const noiseFilter = ctx.createBiquadFilter(); noiseFilter.type = 'bandpass'; noiseFilter.frequency.value = preset.pipeHz * 2; noiseFilter.Q.value = 0.7;
    voice.noise = ctx.createGain(); voice.noise.gain.value = 0;
    this.noise.connect(noiseFilter); noiseFilter.connect(voice.noise); voice.noise.connect(voice.tone);
    if (preset.turbo || preset.mechanical) {
      voice.texture = ctx.createOscillator(); voice.texture.type = 'sine';
      voice.textureGain = ctx.createGain(); voice.textureGain.gain.value = 0;
      voice.texture.connect(voice.textureGain); voice.textureGain.connect(voice.bass);
      voice.texture.start(); this.sources.push(voice.texture);
    }
    return voice;
  }

  activateFallback(preset) {
    const now = this.ctx.currentTime;
    if (this.activeVoice) {
      this.activeVoice.fade.gain.cancelScheduledValues(now);
      this.activeVoice.fade.gain.setTargetAtTime(0, now, 0.012);
    }
    let voice = this.voices.get(preset.id);
    if (!voice) { voice = this.createFallbackVoice(preset); this.voices.set(preset.id, voice); }
    this.activeVoice = voice;
    this.updateFallback(voice, this.lastParams ?? { rpm: preset.idle, load: 0.035, overrun: 0, bass: 0.7 });
    voice.fade.gain.cancelScheduledValues(now);
    voice.fade.gain.setTargetAtTime(1, now, 0.012);
  }

  setPreset(presetId) {
    const preset = getPreset(presetId);
    if (preset.id === this.preset.id) return;
    this.preset = preset;
    if (this.node) this.node.parameters.get('preset').value = preset.index;
    else if (this.voices && this.ctx?.state !== 'closed') this.activateFallback(preset);
  }

  updateFallback(voice, { rpm, load, overrun, bass }) {
    const { preset } = voice, now = this.ctx.currentTime;
    const target = (param, value) => {
      param.cancelScheduledValues(now);
      param.setTargetAtTime(value, now, 0.008);
    };
    for (const osc of voice.oscillators) target(osc.frequency, rpm / 120);
    target(voice.tone.gain, (0.13 + load * 0.25) * preset.level);
    target(voice.lowpass.frequency, preset.cutoff + rpm * preset.cutoffRpm + load * preset.cutoffLoad);
    target(voice.bass.gain, -4 + bass * preset.bodyGain / 1.8 * 12);
    target(voice.noise.gain, 0.015 + load * load * preset.intake * 3 + overrun * 0.015);
    if (voice.texture) {
      target(voice.texture.frequency, preset.turbo ? 750 + load * 2200 + rpm * 0.08 : rpm * (preset.cylinders / 2 + 2) / 60);
      target(voice.textureGain.gain, (preset.turbo || preset.mechanical) * load * 0.7);
    }
  }

  update({ rpm, load, overrun, volume, bass }) {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    this.lastParams = { rpm, load, overrun, bass };
    if (this.node) {
      // .value changes the current parameter without appending automation events.
      for (const [name, value] of Object.entries({ rpm, load, overrun, bass, preset: this.preset.index })) {
        this.node.parameters.get(name).value = value;
      }
    } else if (this.activeVoice) this.updateFallback(this.activeVoice, this.lastParams);
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
    this.sources = []; this.voices = null; this.activeVoice = null;
    if (ctx.state !== 'closed') await ctx.close();
  }
}
