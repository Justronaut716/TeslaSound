import { V8Synth } from './v8-synth.js?v=20261026-combustion';
import { getPreset } from './engine-presets.js?v=20261026-combustion';

// At most two engines run during a 45-ms crossfade. Rapid selections replace
// one pending ID rather than creating an audio queue or an unbounded voice list.
export class EngineSynth {
  constructor(rate, presetId) {
    this.rate = rate;
    this.currentId = getPreset(presetId).id;
    this.pendingId = this.currentId;
    this.current = new V8Synth(rate, this.currentId);
    this.previous = null;
    this.fadeSamples = Math.round(rate * 0.045);
    this.remaining = 0;
    this.scratch = new Float32Array(128);
  }

  setPreset(id) { this.pendingId = getPreset(id).id; }

  render(output, rpm, load, overrun, bass) {
    if (!this.previous && this.pendingId !== this.currentId) {
      this.previous = this.current;
      this.currentId = this.pendingId;
      this.current = new V8Synth(this.rate, this.currentId);
      this.remaining = this.fadeSamples;
    }
    this.current.render(output, rpm, load, overrun, bass);
    if (!this.previous) return;
    // Standard Worklet quanta reuse the preallocated buffer. Offline rendering
    // may supply a different block size; resize only when that size changes.
    if (this.scratch.length !== output.length) this.scratch = new Float32Array(output.length);
    this.previous.render(this.scratch, rpm, load, overrun, bass);
    for (let i = 0; i < output.length; i++) {
      const mix = 1 - this.remaining / this.fadeSamples;
      output[i] = this.scratch[i] * (1 - mix) + output[i] * mix;
      this.remaining = Math.max(0, this.remaining - 1);
    }
    if (!this.remaining) this.previous = null;
  }
}
