import test from 'node:test';
import assert from 'node:assert/strict';
import { DrivingModel, speedFromPosition } from '../js/driving-model.js';
import { Drivetrain } from '../js/drivetrain.js';

const fix = (speed, timestamp, extra = {}) => ({ speed, timestamp, accuracy: 5, ...extra });
const feed = (model, start, duration, speed) => {
  for (let t = start; t <= start + duration; t += 100) {
    if (t % 1000 === 0) model.pushGPS(fix(speed(t), t), t);
    model.snapshot(t);
  }
  return model.snapshot(start + duration);
};

test('recognizes stationary, acceleration, cruise and deceleration from measured speed', () => {
  const m = new DrivingModel();
  assert.equal(feed(m, 0, 2000, () => 0).state, 'idle');
  assert.equal(feed(m, 3000, 4000, t => (t - 2000) * 0.002).state, 'accelerating');
  assert.equal(feed(m, 8000, 5000, () => 10).state, 'cruising');
  assert.equal(feed(m, 14000, 3000, t => 10 - (t - 13000) * 0.002).state, 'decelerating');
});

test('hysteresis suppresses GPS noise during constant driving', () => {
  const m = new DrivingModel();
  feed(m, 0, 2000, () => 15);
  const states = new Set();
  for (let t = 3000; t <= 15000; t += 100) {
    if (t % 1000 === 0) m.pushGPS(fix(15 + (t % 2000 === 0 ? 0.12 : -0.12), t), t);
    states.add(m.snapshot(t).state);
  }
  assert.deepEqual([...states], ['cruising']);
});

test('predicts only briefly and releases load when GPS stops', () => {
  const m = new DrivingModel();
  feed(m, 0, 4000, t => 5 + t * 0.002);
  const fresh = m.snapshot(4000);
  assert(m.snapshot(4200).speed > fresh.speed);
  assert(m.snapshot(4900).speed <= fresh.speed + 0.8);
  const stale = m.snapshot(8000);
  assert.equal(stale.stale, true);
  assert.equal(stale.state, 'unknown');
  assert.equal(stale.acceleration, 0);
  const drive = new Drivetrain();
  let output;
  for (let t = 8000; t < 9000; t += 20) output = drive.update(stale, t);
  assert(output.load < 0.07);
  assert(output.rpm < 1000);
});

test('rejects delayed, reordered, nonfinite, negative and implausible GPS fixes', () => {
  const m = new DrivingModel();
  assert.equal(m.pushGPS(fix(10, 1000), 1000), true);
  for (const f of [fix(10, 900), fix(10, 1100), fix(NaN, 2000), fix(-1, 2000), fix(120, 2000), fix(60, 2000), fix(10, 2000, {accuracy: -1})]) {
    assert.equal(m.pushGPS(f, f.timestamp === 1100 ? 8000 : 2000), false);
  }
  assert.equal(m.snapshot(2000).age, 1000);
  assert.equal(m.pushGPS(fix(11, 2100), 2200), true);
  assert.equal(m.snapshot(2200).age, 100);
});

test('first fix and recovery do not differentiate a long gap into acceleration', () => {
  const m = new DrivingModel();
  m.pushGPS(fix(20, 0), 0);
  assert.equal(m.snapshot(0).acceleration, 0);
  m.pushGPS(fix(0, 10000), 10000);
  assert.equal(m.snapshot(10000).acceleration, 0);
  assert.equal(m.snapshot(10300).state, 'idle');
});

test('position fallback rejects bad accuracy and distinguishes valid zero speed', () => {
  const first = { latitude: 0, longitude: 0, accuracy: 3, timestamp: 0 };
  const moved = { latitude: 0.00018, longitude: 0, accuracy: 3, timestamp: 2000 };
  assert(Math.abs(speedFromPosition(first, moved) - 10) < 0.1);
  assert.equal(speedFromPosition(first, { ...moved, accuracy: 150 }), null);
  assert.equal(speedFromPosition(first, { ...moved, timestamp: 0 }), null);
  assert.equal(speedFromPosition(first, { ...first, timestamp: 2000 }), 0);
  assert.equal(speedFromPosition(first, { ...moved, latitude: null }), null);
});

test('gear hysteresis avoids repeated shifts around an upshift threshold', () => {
  const d = new Drivetrain();
  let changes = 0, previous = 1;
  for (let t = 0; t < 8000; t += 20) {
    const output = d.update({ speed: t < 2000 ? 8 : 10 + Math.sin(t / 80) * 0.15, acceleration: 0, state: 'cruising', stale: false }, t);
    if (output.gear !== previous) changes++;
    previous = output.gear;
    assert(Number.isFinite(output.rpm));
    assert(output.rpm >= 780 && output.rpm <= 6800);
  }
  assert(changes <= 1);
});

test('sound load reacts to fresh acceleration before the visual-state confirmation delay', () => {
  const d = new Drivetrain();
  for (let t = 0; t < 1000; t += 20) d.update({speed: 8, acceleration: 0, state: 'cruising', stale: false}, t);
  let output;
  for (let t = 1000; t <= 1060; t += 20) output = d.update({speed: 8, acceleration: 2, state: 'cruising', stale: false}, t);
  assert(output.load > 0.4);
});
