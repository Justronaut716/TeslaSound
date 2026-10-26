import { getPreset } from './engine-presets.js?v=20261026-combustion';
const bounded = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const param = (value, i) => typeof value === 'number' ? value : value[Math.min(i, value.length - 1)];
const TAU = 2 * Math.PI;

class Resonator {
  constructor(rate, frequency, q) {
    const omega = TAU * frequency / rate;
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

// Two short exhaust paths retain the irregular sequence in each cylinder bank.
// Inverted, damped reflections colour the pulses; the dry path has no delay.
class ExhaustBank {
  constructor(rate, headerMs, reflectionMs) {
    this.pulses = new Float32Array(2048);
    this.cursor = 0;
    this.header = Math.round(rate * headerMs / 1000);
    this.reflection = new Float32Array(Math.max(1, Math.round(rate * reflectionMs / 1000)));
    this.reflectionCursor = 0;
    this.damped = 0;
    this.damping = 1 - Math.exp(-TAU * 2600 / rate);
  }
  fire(soft, power, load, strength) {
    for (let i = 0; i < soft.length; i++) {
      const index = (this.cursor + this.header + i) & 2047;
      this.pulses[index] += (soft[i] + (power[i] - soft[i]) * load) * strength;
    }
  }
  process() {
    const pressure = this.pulses[this.cursor];
    this.pulses[this.cursor] = 0;
    this.cursor = (this.cursor + 1) & 2047;
    const reflected = this.reflection[this.reflectionCursor];
    this.damped += (reflected - this.damped) * this.damping;
    const x = pressure - this.damped * 0.48;
    this.reflection[this.reflectionCursor] = x / (1 + Math.abs(x) * 0.25);
    this.reflectionCursor = (this.reflectionCursor + 1) % this.reflection.length;
    return pressure * 0.8 + this.damped * 0.65;
  }
}

function pressurePulse(rate, width, power) {
  const length = Math.min(1700, Math.ceil(rate * width * 10));
  const pulse = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    // Fast compression front followed by the negative pressure wave. A smooth
    // attack and tail avoid the old single-sample step/organ-like waveform.
    const attack = 1 - Math.exp(-t / 0.00012);
    const positive = Math.exp(-t / width);
    const negative = 0.32 * t / (width * 2.4) * Math.exp(1 - t / (width * 2.4));
    const window = (1 + Math.cos(Math.PI * i / length)) * 0.5;
    pulse[i] = attack * (positive - negative) * window * (power ? 1.3 : 0.8);
  }
  return pulse;
}

export class V8Synth {
  constructor(rate, presetId) {
    this.preset = getPreset(presetId);
    const p = this.preset;
    this.rate = rate;
    this.phase = 0; this.cylinder = 0; this.idlePhase = 0;
    this.rpm = p.idle; this.load = 0.035; this.overrun = 0; this.bass = 0.7;
    this.turboPhase = 0; this.mechanicalPhase = 0; this.boost = 0;
    this.exhaust = this.air = this.chuff = 0;
    this.lastX = this.lastY = this.outputX = this.outputY = this.radiation = 0;
    this.random = 0x12345678;
    this.banks = p.headerMs.map((header, i) => new ExhaustBank(rate, header, p.reflectionMs[i]));
    this.softPulse = pressurePulse(rate, p.pulse, false);
    this.powerPulse = pressurePulse(rate, p.pulse, true);
    this.body = new Resonator(rate, p.bodyHz, p.bodyQ);
    this.pipe = new Resonator(rate, p.pipeHz, p.pipeQ);
    this.intake = new Resonator(rate, p.pipeHz * 2.3, 0.8);
    this.dc = Math.exp(-TAU * 18 / rate);
    this.radiationCoefficient = 1 - Math.exp(-TAU * 4200 / rate);
    this.rpmSlew = 1 - Math.exp(-1 / (rate * 0.008));
    this.loadSlew = 1 - Math.exp(-1 / (rate * 0.012));
    this.boostSlew = 1 - Math.exp(-1 / (rate * 0.18));
    this.airCoefficient = 1 - Math.exp(-TAU * 1800 / rate);
    this.chuffDecay = Math.exp(-1 / (rate * 0.009));
    this.coefficient = 0; this.coefficientCountdown = 0;
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
      this.idlePhase = (this.idlePhase + 4.3 / this.rate) % 1;
      const idleWeight = Math.max(0, 1 - (this.rpm - p.idle) / 1400);
      const flutter = 1 + Math.sin(this.idlePhase * TAU) * p.roughness * idleWeight;
      // One combustion event per cylinder per 720 degrees, including at redline.
      this.phase += this.rpm * flutter * p.cylinders / (120 * this.rate);
      if (this.phase >= 1) {
        this.phase -= 1;
        const strength = p.strength[this.cylinder] * (0.45 + this.load * 0.9)
          * (1 + noise * p.variation * (0.4 + idleWeight * 0.6));
        const bank = p.banks[this.cylinder];
        this.banks[bank].fire(this.softPulse, this.powerPulse, this.load, strength);
        this.chuff = 1;
        this.cylinder = (this.cylinder + 1) % p.cylinders;
      }
      const combustion = this.banks[0].process() * p.bankMix[0] + this.banks[1].process() * p.bankMix[1];
      // Refresh expensive coefficients every 32 samples (less than 0.8 ms).
      if (this.coefficientCountdown-- <= 0) {
        const cutoff = p.cutoff + this.rpm * p.cutoffRpm + this.load * p.cutoffLoad;
        this.coefficient = 1 - Math.exp(-TAU * Math.min(cutoff, this.rate * 0.42) / this.rate);
        this.coefficientCountdown = 31;
      }
      this.exhaust += (combustion - this.exhaust) * this.coefficient;
      const body = this.body.process(combustion), pipe = this.pipe.process(combustion);
      this.air += (noise - this.air) * this.airCoefficient;
      this.chuff *= this.chuffDecay;
      const breath = this.intake.process(noise * (0.2 + this.chuff * 0.8));
      const intake = breath * (0.003 + this.load * this.load * p.intake);
      this.boost += (this.load - this.boost) * this.boostSlew;
      let turbo = 0;
      if (p.turbo) {
        this.turboPhase = (this.turboPhase + (900 + this.boost * 2500 + this.rpm * 0.06) / this.rate) % 1;
        turbo = p.turbo * (Math.sin(this.turboPhase * TAU) * this.boost * this.load
          + this.air * Math.max(0, this.boost - this.load) * 5);
      }
      this.mechanicalPhase = (this.mechanicalPhase + this.rpm / (60 * this.rate)) % 1;
      const mechanical = p.mechanical * (0.15 + this.load) * Math.sin(this.mechanicalPhase * TAU * (p.cylinders / 2 + 2));
      const overrunTexture = this.overrun * (breath * 0.025 + pipe * (0.35 + noise * 0.18));
      const x = this.exhaust * (0.6 + this.load * 0.55)
        + body * (0.18 + this.bass * p.bodyGain) + pipe * (0.25 + this.load * p.pipeGain)
        + intake + overrunTexture + turbo + mechanical;
      const dcFree = x - this.lastX + this.dc * this.lastY;
      this.lastX = x; this.lastY = dcFree;
      // Asymmetric combustion can regain DC in the nonlinear exhaust stage.
      // Remove it after saturation as well as before it.
      const saturated = Math.tanh(dcFree * 1.7 * p.level) * 0.5;
      const clean = saturated - this.outputX + this.dc * this.outputY;
      this.outputX = saturated; this.outputY = clean;
      // Exhaust radiation/interior damping rounds the upper harmonics created
      // by saturation, especially on the high-revving V10. No lookahead.
      this.radiation += (clean - this.radiation) * this.radiationCoefficient;
      output[i] = Math.max(-0.94, Math.min(0.94, this.radiation));
    }
  }
}
