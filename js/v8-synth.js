import { getPreset } from './engine-presets.js';
const bounded = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const param = (value, i) => typeof value === 'number' ? value : value[Math.min(i, value.length - 1)];

class Resonator {
  constructor(rate, frequency, q) {
    const omega = 2 * Math.PI * frequency / rate;
    const alpha = Math.sin(omega) / (2 * q), norm = 1 / (1 + alpha);
    this.b = alpha * norm;
    this.a1 = -2 * Math.cos(omega) * norm;
    this.a2 = (1 - alpha) * norm;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
  process(x) {
    const y = this.b * (x - this.x2) - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

export class V8Synth {
  constructor(rate, presetId) {
    this.preset = getPreset(presetId);
    const p = this.preset;
    this.rate = rate;
    this.phase = 0;
    this.cylinder = 0;
    this.rpm = p.idle; this.load = 0.035; this.overrun = 0; this.bass = 0.7;
    this.turboPhase = 0; this.mechanicalPhase = 0; this.boost = 0;
    this.left = this.right = this.exhaust = this.air = 0;
    this.lastX = this.lastY = 0;
    this.random = 0x12345678;
    this.body = new Resonator(rate, p.bodyHz, p.bodyQ);
    this.pipe = new Resonator(rate, p.pipeHz, p.pipeQ);
    this.dc = Math.exp(-2 * Math.PI * 18 / rate);
    this.rpmSlew = 1 - Math.exp(-1 / (rate * 0.008));
    this.loadSlew = 1 - Math.exp(-1 / (rate * 0.012));
    this.boostSlew = 1 - Math.exp(-1 / (rate * 0.18));
    this.airCoefficient = 1 - Math.exp(-2 * Math.PI * 1600 / rate);
  }

  render(output, rpm = 850, load = 0.035, overrun = 0, bass = 0.7) {
    const p = this.preset;
    for (let i = 0; i < output.length; i++) {
      this.rpm += (bounded(param(rpm, i), 650, p.redline, p.idle) - this.rpm) * this.rpmSlew;
      this.load += (bounded(param(load, i), 0, 1, 0) - this.load) * this.loadSlew;
      this.overrun += (bounded(param(overrun, i), 0, 1, 0) - this.overrun) * this.loadSlew;
      this.bass += (bounded(param(bass, i), 0, 1, 0.7) - this.bass) * this.loadSlew;
      this.random ^= this.random << 13; this.random ^= this.random >>> 17; this.random ^= this.random << 5;
      const noise = this.random / 2147483648;
      // Each cylinder fires once per 720° (120 / RPM seconds).
      this.phase += this.rpm * p.cylinders / (120 * this.rate);
      if (this.phase >= 1) {
        this.phase -= 1;
        const strength = p.strength[this.cylinder] * (0.65 + 0.5 * this.load)
          * (1 + noise * (0.055 - this.load * 0.025));
        if (p.banks[this.cylinder] === 0) this.left += strength;
        else this.right += strength;
        this.cylinder = (this.cylinder + 1) % p.cylinders;
      }
      const decay = Math.exp(-1 / (this.rate * (p.decay + this.load * p.decayLoad)));
      this.left *= decay;
      this.right *= decay * 0.9996;
      const combustion = this.left * 0.68 + this.right * 0.63;
      const cutoff = p.cutoff + this.rpm * p.cutoffRpm + this.load * p.cutoffLoad;
      this.exhaust += (combustion - this.exhaust) * (1 - Math.exp(-2 * Math.PI * cutoff / this.rate));
      const body = this.body.process(this.exhaust), pipe = this.pipe.process(combustion);
      this.air += (noise - this.air) * this.airCoefficient;
      const intake = (noise - this.air) * (0.004 + this.load ** 2 * p.intake) * (0.5 + combustion * 0.5);
      let turbo = 0, mechanical = 0;
      if (p.turbo) {
        this.boost += (this.load - this.boost) * this.boostSlew;
        this.turboPhase = (this.turboPhase + (750 + this.boost * 2200 + this.rpm * 0.08) / this.rate) % 1;
        turbo = p.turbo * (Math.sin(this.turboPhase * 2 * Math.PI) * this.boost * this.load
          + this.air * Math.max(0, this.boost - this.load) * 3);
      }
      if (p.mechanical) {
        this.mechanicalPhase = (this.mechanicalPhase + this.rpm * (p.cylinders / 2 + 2) / (60 * this.rate)) % 1;
        mechanical = p.mechanical * this.load * Math.sin(this.mechanicalPhase * 2 * Math.PI);
      }
      // Restrained overrun texture follows negative acceleration, never random loud bangs.
      const overrunTexture = this.air * this.overrun * (0.012 + combustion * 0.035);
      const x = this.exhaust * (0.55 + this.load * 0.42)
        + body * (0.12 + this.bass * p.bodyGain) + pipe * (0.12 + this.load * p.pipeGain)
        + intake + overrunTexture + turbo + mechanical;
      const dcFree = x - this.lastX + this.dc * this.lastY;
      this.lastX = x; this.lastY = dcFree;
      output[i] = Math.tanh(dcFree * 1.5 * p.level) * 0.9;
    }
  }
}
