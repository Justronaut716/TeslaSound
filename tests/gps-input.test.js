import test from 'node:test';
import assert from 'node:assert/strict';
import { readGPSPosition } from '../js/gps-input.js';
import { DrivingModel, speedFromPosition } from '../js/driving-model.js';

const wall = 1800000000000;
const position = (speed, age = 0, accuracy = 5) => ({timestamp: wall - age, coords: {speed, accuracy, latitude: 52.52, longitude: 13.405}});

test('reported speed is usable even when position accuracy is coarse', () => {
  const input = readGPSPosition(position(15, 0, 600), 10000, wall);
  assert.equal(input.error, null);
  assert.equal(input.fix.speed, 15);
  const model = new DrivingModel();
  assert(model.pushGPS(input.fix, 10000));
  assert.equal(model.snapshot(10000).speed, 15);
});

test('moderately delayed fixes remain usable without hiding their true age', () => {
  const model = new DrivingModel();
  for (let t = 10000; t <= 13000; t += 1000) {
    const input = readGPSPosition(position(10 + (t - 10000) / 500, 3500, 120), t, wall);
    assert.equal(input.error, null);
    assert(model.pushGPS(input.fix, t));
    const snapshot = model.snapshot(t);
    assert.equal(snapshot.stale, false);
    assert.equal(snapshot.age, 3500);
  }
  assert.equal(model.snapshot(18000).stale, true, 'data loss must still release engine load');
});

test('rejects old/future fixes with actual age instead of one ambiguous quality error', () => {
  const old = readGPSPosition(position(15, 12000, 5), 15000, wall);
  assert.equal(old.fix, null);
  assert.match(old.error, /12[.,]0 s/);
  const future = readGPSPosition(position(15, -4000, 5), 15000, wall);
  assert.equal(future.fix, null);
  assert.match(future.error, /Zukunft/);
});

test('missing timestamps use an explicitly marked reception time, not a false acquisition age', () => {
  for (const timestamp of [0, null, undefined, NaN]) {
    const input = readGPSPosition({...position(8), timestamp}, 10000, wall);
    assert.equal(input.fix.timestamp, 10000);
    assert.equal(input.fix.timeEstimated, true);
    assert.match(input.diagnostic, /Messzeit unbekannt/);
  }
});

test('unknown position precision permits reported velocity but never position differentiation', () => {
  assert.equal(readGPSPosition(position(12, 0, null), 10000, wall).fix.speed, 12);
  const input = readGPSPosition(position(null, 0, null), 10000, wall);
  assert.equal(input.fix, null);
  assert.match(input.error, /Positionsgenauigkeit/);
});

test('coarse position-only speed requires movement beyond uncertainty over a longer window', () => {
  const previous = {latitude: 0, longitude: 0, timestamp: 0, accuracy: 120};
  assert.equal(speedFromPosition(previous, {...previous, latitude: 0.0001, timestamp: 1000}), null);
  assert(Math.abs(speedFromPosition(previous, {...previous, latitude: 0.0018, timestamp: 10000}) - 20) < 0.1);
  assert.equal(speedFromPosition(previous, {...previous, latitude: 0.0018, timestamp: 10000, accuracy: 2000}), null);
});

test('duplicate delayed timestamps cannot refresh the old measurement forever', () => {
  const model = new DrivingModel();
  const fix = readGPSPosition(position(10, 3000, 200), 10000, wall).fix;
  assert(model.pushGPS(fix, 10000));
  assert.equal(model.pushGPS(fix, 11000), false);
  assert.equal(model.snapshot(17000).stale, true);
});

test('position differentiation never mixes acquisition time with receipt time', () => {
  const a = readGPSPosition(position(null, 3000, 3), 4000, wall).position;
  const b = readGPSPosition({timestamp:0, coords:{speed:null,accuracy:3,latitude:52.52009,longitude:13.405}}, 5000, wall).position;
  const c = readGPSPosition({timestamp:0, coords:{speed:null,accuracy:3,latitude:52.52018,longitude:13.405}}, 6000, wall).position;
  assert.equal(speedFromPosition(a, b), null, 'different clocks must not produce a false 2.5 m/s speed');
  assert(Math.abs(speedFromPosition(b, c) - 10) < 0.1);
});

test('normalizes Unix seconds and reproduces the 55-year age shown in the Tesla photo', () => {
  const vehicleWall = 1753940126826, timestampSeconds = 1753940126;
  // Treating seconds as milliseconds produced exactly the photographed error.
  assert.equal(((vehicleWall - timestampSeconds) / 1000).toFixed(1), '1752186186.7');
  const input = readGPSPosition({...position(12), timestamp: timestampSeconds}, 10000, vehicleWall);
  assert.equal(input.error, null);
  assert.equal(input.fix.timestamp, 9174);
  assert.equal(input.fix.timeEstimated, false);
  assert.match(input.diagnostic, /Sekunden/);
  assert.match(input.diagnostic, /0\.8 s/);
});

test('stale and future Unix-second timestamps retain the normal age checks', () => {
  assert.match(readGPSPosition({...position(12), timestamp:(wall - 12000) / 1000}, 10000, wall).error, /12\.0 s/);
  assert.match(readGPSPosition({...position(12), timestamp:(wall + 4000) / 1000}, 10000, wall).error, /Zukunft/);
});

test('relative timestamp origins are marked unknown instead of compared with Unix time', () => {
  for (const timestamp of [4321, 123456789, 9876543210]) {
    const input = readGPSPosition({...position(12), timestamp}, 10000, wall);
    assert.equal(input.error, null);
    assert.equal(input.fix.timestamp, 10000);
    assert.equal(input.fix.timeEstimated, true);
    assert.equal(input.fix.rawTimestamp, timestamp);
    assert.match(input.diagnostic, /Zeitbasis unbekannt/);
  }
});

test('repeated relative timestamps cannot keep cached speed alive or invent position movement', () => {
  const model = new DrivingModel();
  const a = readGPSPosition({...position(12), timestamp:4321}, 10000, wall);
  const b = readGPSPosition({...position(12), timestamp:4321}, 11000, wall);
  assert(model.pushGPS(a.fix, 10000));
  assert.equal(model.pushGPS(b.fix, 11000), false);
  assert.equal(speedFromPosition(a.position, {...b.position, latitude:52.5202}), null);
  assert.equal(model.snapshot(14000).stale, true);
});
