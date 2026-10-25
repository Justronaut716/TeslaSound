import { clamp } from './driving-model.js';
import { getPreset } from './engine-presets.js';

const RATIOS = [3.4, 2.3, 1.62, 1.2, 0.96, 0.78];
const UPSHIFT = [10, 18, 28, 40, 55]; // m/s; downshifts have a separate boundary.

export class Drivetrain {
  constructor(presetId) { this.setPreset(presetId); this.reset(); }

  setPreset(presetId) { this.preset = getPreset(presetId); }

  reset() {
    this.rpm = this.preset.idle;
    this.load = 0;
    this.gear = 1;
    this.lastTime = null;
    this.shiftTime = -Infinity;
    this.overrun = 0;
  }

  update(driving, now) {
    const dt = this.lastTime === null ? 0.02 : clamp((now - this.lastTime) / 1000, 0, 0.1);
    this.lastTime = now;
    const speed = clamp(Number.isFinite(driving.speed) ? driving.speed : 0, 0, 90);
    const valid = !driving.stale && driving.state !== 'unknown';
    if (valid && now - this.shiftTime > 650) {
      if (this.gear < 6 && speed > UPSHIFT[this.gear - 1]) {
        this.gear++;
        this.shiftTime = now;
      } else if (this.gear > 1 && speed < UPSHIFT[this.gear - 2] * 0.76) {
        this.gear--;
        this.shiftTime = now;
      }
    }
    const shifting = now - this.shiftTime < 140;
    // Sound follows new acceleration immediately. Only the visual state waits
    // for hysteresis confirmation; otherwise that delay sits on the audio path.
    const accelerating = driving.acceleration > 0.3 || (driving.state === 'accelerating' && driving.acceleration > 0.18);
    const decelerating = driving.acceleration < -0.3 || driving.state === 'decelerating';
    let load = !valid || speed < 0.45 ? 0.035
      : decelerating ? 0.01
      : accelerating ? clamp(0.32 + driving.acceleration * 0.16, 0.32, 1)
      : clamp(0.13 + speed * 0.0015, 0.13, 0.25);
    if (shifting) load *= 0.25;
    this.load += (load - this.load) * (1 - Math.exp(-dt / 0.035));
    const { idle, redline, rpmScale } = this.preset;
    const desired = !valid || speed < 0.45 ? idle
      : clamp(idle + speed * 3.6 * RATIOS[this.gear - 1] * 30 * rpmScale + this.load * 450, idle, redline);
    this.rpm += (desired - this.rpm) * (1 - Math.exp(-dt / (shifting ? 0.07 : 0.055)));
    const overrun = valid && decelerating && speed > 2 ? clamp(-driving.acceleration / 3, 0, 1) : 0;
    this.overrun += (overrun - this.overrun) * (1 - Math.exp(-dt / 0.05));
    return { rpm: this.rpm, load: this.load, overrun: this.overrun, gear: this.gear, shifting };
  }
}
