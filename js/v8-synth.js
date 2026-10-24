// Eight combustion events per 720° cycle. Each cross-plane bank has uneven
// spacing; summing eight identical evenly spaced oscillators loses this texture.
const BANK = [0, 1, 1, 0, 1, 0, 0, 1];
const STRENGTH = [1, 0.92, 1.03, 0.96, 1.01, 0.94, 1.04, 0.97];
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
  constructor(rate) {
    this.rate = rate;
    this.phase = 0;
    this.cylinder = 0;
    this.rpm = 850; this.load = 0.035; this.overrun = 0; this.bass = 0.7;
    this.left = this.right = this.exhaust = this.air = 0;
    this.lastX = this.lastY = 0;
    this.random = 0x12345678;
    this.body = new Resonator(rate, 95, 0.85);
    this.pipe = new Resonator(rate, 430, 1.15);
    this.dc = Math.exp(-2 * Math.PI * 18 / rate);
    this.rpmSlew = 1 - Math.exp(-1 / (rate * 0.008));
    this.loadSlew = 1 - Math.exp(-1 / (rate * 0.012));
    this.airCoefficient = 1 - Math.exp(-2 * Math.PI * 1600 / rate);
  }

  render(output, rpm = 850, load = 0.035, overrun = 0, bass = 0.7) {
    for (let i = 0; i < output.length; i++) {
      this.rpm += (bounded(param(rpm, i), 650, 7200, 850) - this.rpm) * this.rpmSlew;
      this.load += (bounded(param(load, i), 0, 1, 0) - this.load) * this.loadSlew;
      this.overrun += (bounded(param(overrun, i), 0, 1, 0) - this.overrun) * this.loadSlew;
      this.bass += (bounded(param(bass, i), 0, 1, 0.7) - this.bass) * this.loadSlew;
      this.random ^= this.random << 13; this.random ^= this.random >>> 17; this.random ^= this.random << 5;
      const noise = this.random / 2147483648;
      this.phase += this.rpm / (15 * this.rate);
      if (this.phase >= 1) {
        this.phase -= 1;
        const strength = STRENGTH[this.cylinder] * (0.65 + 0.5 * this.load)
          * (1 + noise * (0.055 - this.load * 0.025));
        if (BANK[this.cylinder] === 0) this.left += strength;
        else this.right += strength;
        this.cylinder = (this.cylinder + 1) & 7;
      }
      const decay = Math.exp(-1 / (this.rate * (0.0028 + this.load * 0.0012)));
      this.left *= decay;
      this.right *= decay * 0.9996;
      const combustion = this.left * 0.68 + this.right * 0.63;
      const cutoff = 240 + this.rpm * 0.045 + this.load * 1100;
      this.exhaust += (combustion - this.exhaust) * (1 - Math.exp(-2 * Math.PI * cutoff / this.rate));
      const body = this.body.process(this.exhaust), pipe = this.pipe.process(combustion);
      this.air += (noise - this.air) * this.airCoefficient;
      const intake = (noise - this.air) * (0.004 + this.load ** 2 * 0.045) * (0.5 + combustion * 0.5);
      // Restrained overrun texture follows negative acceleration, never random loud bangs.
      const overrunTexture = this.air * this.overrun * (0.012 + combustion * 0.035);
      const x = this.exhaust * (0.55 + this.load * 0.42)
        + body * (0.12 + this.bass * 1.8) + pipe * (0.12 + this.load * 0.22)
        + intake + overrunTexture;
      const dcFree = x - this.lastX + this.dc * this.lastY;
      this.lastX = x; this.lastY = dcFree;
      output[i] = Math.tanh(dcFree * 1.5) * 0.9;
    }
  }
}
