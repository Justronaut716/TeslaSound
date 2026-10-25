import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_PRESETS, getPreset } from '../js/engine-presets.js';
import { V8Synth } from '../js/v8-synth.js';
import { Drivetrain } from '../js/drivetrain.js';
import { EngineSynth } from '../js/engine-synth.js';

const rms = data => Math.sqrt(data.reduce((s, x) => s + x * x, 0) / data.length);
function render(id, rpm = 3000, load = 0.65, rate = 48000) {
  const synth = new V8Synth(rate, id);
  synth.render(new Float32Array(rate), rpm, load, 0, 0.7);
  const data = new Float32Array(rate);
  synth.render(data, rpm, load, 0, 0.7);
  return data;
}
function energy(data, hz, rate = 48000) {
  let re = 0, im = 0;
  for (let i = 0; i < data.length; i++) {
    re += data[i] * Math.cos(i * 2 * Math.PI * hz / rate);
    im += data[i] * Math.sin(i * 2 * Math.PI * hz / rate);
  }
  return re * re + im * im;
}

test('four engine choices have different combustion fundamentals at the same RPM', () => {
  assert.equal(ENGINE_PRESETS.length, 4);
  for (const [id, hz] of [['i6-turbo', 150], ['v8-muscle', 200], ['v10-supercar', 250], ['v12-gt', 300]]) {
    const data = render(id);
    assert(energy(data, hz) > energy(data, hz + 11) * 100, `${id}: missing ${hz} Hz firing tone`);
  }
  const samples = ENGINE_PRESETS.map(p => render(p.id));
  for (let a = 0; a < samples.length; a++) for (let b = a + 1; b < samples.length; b++) {
    const difference = samples[a].reduce((s, x, i) => s + (x - samples[b][i]) ** 2, 0) / samples[a].length;
    assert(difference > 0.005, 'presets must produce different signals, not just labels');
  }
});

test('every preset stays finite, audible and bounded at idle and redline', () => {
  for (const p of ENGINE_PRESETS) for (const rate of [44100, 48000]) for (const [rpm, load] of [[p.idle, 0.035], [p.redline, 1]]) {
    const data = render(p.id, rpm, load, rate);
    assert(data.every(Number.isFinite), `${p.id} nonfinite samples`);
    assert(rms(data) > 0.015, `${p.id} inaudible`);
    assert(data.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0) < 0.96);
    assert(Math.abs(data.reduce((s, x) => s + x, 0) / data.length) < 0.006, `${p.id}: DC offset`);
  }
});

test('drivetrain applies selected idle/RPM range without resetting travel or gear', () => {
  const d = new Drivetrain();
  for (let t = 0; t <= 1000; t += 20) d.update({speed: 20, acceleration: 1, state: 'accelerating', stale: false}, t);
  const gear = d.gear;
  d.setPreset('v10-supercar');
  assert.equal(d.gear, gear);
  let output;
  for (let t = 1020; t < 3020; t += 20) output = d.update({speed: 0, acceleration: 0, state: 'idle', stale: false}, t);
  assert(Math.abs(output.rpm - 1000) < 1);
  d.reset();
  assert.equal(d.rpm, 1000, 'mode reset must retain the selected engine');
});

test('invalid saved preset falls back to V8 and cannot corrupt audio', () => {
  assert.equal(getPreset('invalid').id, 'v8-muscle');
  assert.deepEqual(render('invalid'), render('v8-muscle'));
});

test('switching engines begins on the continuing old signal and ends on the selected engine', () => {
  const synth = new EngineSynth(48000), reference = new V8Synth(48000);
  const buffer = new Float32Array(128), expected = new Float32Array(128);
  for (let i = 0; i < 100; i++) { synth.render(buffer, 3000, 0.7, 0, 0.7); reference.render(expected, 3000, 0.7, 0, 0.7); }
  synth.setPreset('v12-gt');
  synth.render(buffer, 3000, 0.7, 0, 0.7); reference.render(expected, 3000, 0.7, 0, 0.7);
  assert(Math.abs(buffer[0] - expected[0]) < 0.000001, 'switch must begin with continuous old audio');
  const settled = new Float32Array(48000);
  for (let i = 0; i < 500; i++) synth.render(buffer, 3000, 0.7, 0, 0.7);
  synth.render(settled, 3000, 0.7, 0, 0.7);
  assert(energy(settled, 300) > energy(settled, 200) * 10, 'V12 selection did not reach renderer');
});

test('rapid selections retain only the latest pending engine and remain bounded', () => {
  const synth = new EngineSynth(48000);
  const block = new Float32Array(128);
  for (const id of ['v10-supercar', 'i6-turbo', 'v8-muscle', 'v12-gt']) {
    synth.setPreset(id); synth.render(block, 3000, 0.65, 0, 0.7);
    assert(block.every(x => Number.isFinite(x) && Math.abs(x) < 0.96));
  }
  for (let i = 0; i < 500; i++) synth.render(block, 3000, 0.65, 0, 0.7);
  const data = new Float32Array(48000);
  synth.render(data, 3000, 0.65, 0, 0.7);
  assert(energy(data, 300) > energy(data, 200) * 10);
});
