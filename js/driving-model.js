// SI units throughout: m/s, m/s² and monotonic milliseconds.
import { GPS_LIMITS } from './gps-input.js';
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function speedFromPosition(previous, current) {
  if (!previous || !current) return null;
  if (Boolean(previous.timeEstimated) !== Boolean(current.timeEstimated)) return null;
  for (const p of [previous, current]) {
    if (![p.latitude, p.longitude, p.accuracy, p.timestamp].every(finite)
      || Math.abs(p.latitude) > 90 || Math.abs(p.longitude) > 180
      || p.accuracy < 0 || p.accuracy > GPS_LIMITS.maxPositionAccuracy) return null;
  }
  const dt = (current.timestamp - previous.timestamp) / 1000;
  if (dt < 0.5 || dt > GPS_LIMITS.positionWindowMs / 1000) return null;
  const rad = Math.PI / 180;
  const a = Math.sin((current.latitude - previous.latitude) * rad / 2) ** 2
    + Math.cos(previous.latitude * rad) * Math.cos(current.latitude * rad)
    * Math.sin((current.longitude - previous.longitude) * rad / 2) ** 2;
  const distance = 6371000 * 2 * Math.asin(Math.sqrt(clamp(a, 0, 1)));
  // Do not turn position jitter inside the uncertainty radius into engine load.
  const uncertainty = Math.max(3, Math.hypot(previous.accuracy, current.accuracy)
    * (Math.max(previous.accuracy, current.accuracy) > 50 ? 1 : 0.65));
  if (distance < uncertainty) return current.accuracy <= 10 && previous.accuracy <= 10 ? 0 : null;
  const speed = distance / dt;
  return speed <= 90 ? speed : null;
}

export class DrivingModel {
  constructor() { this.reset(); }

  reset() {
    this.last = null;
    this.speed = 0;
    this.acceleration = 0;
    this.interval = null;
    this.state = 'unknown';
    this.candidate = null;
  }

  pushGPS(fix, now) {
    const { speed, timestamp, accuracy } = fix;
    const positionSource = fix.source === 'position';
    const validAccuracy = accuracy === null || accuracy === undefined ? !positionSource
      : finite(accuracy) && accuracy >= 0 && (!positionSource || accuracy <= GPS_LIMITS.maxPositionAccuracy);
    if (![speed, timestamp, now].every(finite) || speed < 0 || speed > 90 || !validAccuracy
      || timestamp > now + GPS_LIMITS.futureToleranceMs || now - timestamp > GPS_LIMITS.maxAgeMs) return false;
    const timeEstimated = Boolean(fix.timeEstimated);
    const timebaseChanged = this.last && this.last.timeEstimated !== timeEstimated;
    const dt = this.last ? (timestamp - this.last.timestamp) / 1000 : null;
    if (!timebaseChanged && dt !== null && dt <= 0) return false;
    // A long gap is a new observation, not evidence of a huge acceleration.
    if (!this.last || timebaseChanged || now - this.last.receivedAt > this.dropoutAfter() || dt > this.staleAfter() / 1000) {
      this.speed = speed;
      this.acceleration = 0;
      this.interval = null;
      this.state = speed < 0.6 ? 'idle' : 'cruising';
      this.candidate = null;
    } else {
      if (dt < 0.08 || Math.abs(speed - this.last.speed) > 12 * dt + 1.5) return false;
      const measured = clamp((speed - this.last.speed) / dt, -12, 8);
      const tau = fix.source === 'position' ? 0.85 : 0.4;
      this.acceleration += (measured - this.acceleration) * (1 - Math.exp(-dt / tau));
      // Correct the short predictor using the new measurement, once, at ingestion.
      const prior = this.speed + this.acceleration * Math.min(dt, 0.35);
      const correction = fix.source === 'position' ? 0.8 : 0.94;
      this.speed = clamp(prior + (speed - prior) * correction, 0, 90);
      this.interval = this.interval === null ? dt * 1000 : this.interval * 0.7 + dt * 300;
    }
    this.last = { speed, timestamp, accuracy, source: fix.source || 'speed', timeEstimated,
      receivedAt: now, ageAtReceipt: Math.max(0, now - timestamp) };
    return true;
  }

  dropoutAfter() { return clamp((this.interval ?? 1000) * 2.5, 1800, 3000); }
  staleAfter() { return (this.last?.ageAtReceipt ?? 0) + this.dropoutAfter(); }

  snapshot(now) {
    const age = this.last ? Math.max(0, now - this.last.timestamp) : Infinity;
    const receptionAge = this.last ? Math.max(0, now - this.last.receivedAt) : Infinity;
    const timeEstimated = this.last?.timeEstimated ?? false;
    const stale = !this.last || age > this.staleAfter();
    if (stale) {
      this.state = 'unknown';
      this.candidate = null;
      return { speed: this.speed, acceleration: 0, state: 'unknown', stale, age, receptionAge, timeEstimated, interval: this.interval, source: this.last?.source };
    }
    // Never invent more than 350 ms of travel between actual fixes.
    const speed = clamp(this.speed + this.acceleration * (timeEstimated ? 0 : Math.min(age / 1000, 0.35)), 0, 90);
    const decay = Math.exp(-Math.max(0, receptionAge - Math.max(250, (this.interval ?? 1000) * 0.85)) / 350);
    const acceleration = this.acceleration * decay;
    const enter = this.last.source === 'position' ? 0.7 : 0.45;
    let next;
    if (speed < (this.state === 'idle' ? 0.8 : 0.45)) next = 'idle';
    else if (acceleration > (this.state === 'accelerating' ? 0.18 : enter)) next = 'accelerating';
    else if (acceleration < (this.state === 'decelerating' ? -0.18 : -enter)) next = 'decelerating';
    else next = 'cruising';
    if (next === this.state) this.candidate = null;
    else if (this.candidate?.state !== next) this.candidate = { state: next, since: now };
    else if (now - this.candidate.since >= 120) {
      this.state = next;
      this.candidate = null;
    }
    return { speed, acceleration, state: this.state, stale, age, receptionAge, timeEstimated, interval: this.interval, source: this.last.source };
  }
}
