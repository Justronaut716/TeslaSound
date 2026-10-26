import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_PRESETS } from '../js/engine-presets.js';
import { createEngineLoops, loopWeights } from '../js/engine-loops.js';

const energy = (data, hz, rate) => {
  let re = 0, im = 0;
  for (let i = 0; i < data.length; i++) {
    const phase = i * 2 * Math.PI * hz / rate;
    re += data[i] * Math.cos(phase); im += data[i] * Math.sin(phase);
  }
  return re * re + im * im;
};

test('native loops retain true engine pitch, stay bounded and wrap without a click', () => {
  for (const rate of [44100, 48000]) for (const p of ENGINE_PRESETS) {
    const loops = createEngineLoops(rate, p.id);
    assert.equal(loops.length, 6, 'fixed three-RPM/two-load bank');
    for (const { data, rpm, load } of loops) {
      assert(data.every(x => Number.isFinite(x) && Math.abs(x) <= 0.94));
      const rms = Math.sqrt(data.reduce((s, x) => s + x * x, 0) / data.length);
      assert(rms > 0.015, `${p.id} ${rpm} ${load}: silent loop`);
      assert(Math.abs(data[0] - data[data.length - 1]) < 0.12, `${p.id}: loop clicks`);
      const firing = rpm * p.cylinders / 120;
      // Probe halfway between crank orders; a fixed offset can land on a
      // legitimate V8 bank harmonic and mistake its burble for wrong pitch.
      assert(energy(data, firing, rate) > energy(data, firing + rpm / 240, rate) * 20, `${p.id}: wrong loop pitch`);
    }
  }
});

test('RPM/load blending is continuous, normalized and uses the adjacent anchors', () => {
  const anchors = [800, 2800, 5600];
  for (const rpm of [650, 800, 1000, 2799, 2800, 2801, 4500, 5600, 8500]) {
    for (const load of [0, 0.2, 0.8, 1]) {
      const weights = loopWeights(anchors, rpm, load);
      assert.equal(weights.length, 6);
      assert(weights.every(w => w >= 0 && w <= 1));
      assert(Math.abs(weights.reduce((s, x) => s + x, 0) - 1) < 1e-9);
      if (rpm >= 2800) assert.equal(weights[0] + weights[1], 0, 'idle loop must not run across redline');
      if (rpm <= 2800) assert.equal(weights[4] + weights[5], 0, 'high loop must not drone at idle');
    }
  }
  const left = loopWeights(anchors, 2799.99, 0.5), right = loopWeights(anchors, 2800.01, 0.5);
  assert(left.every((x, i) => Math.abs(x - right[i]) < 0.0001), 'crossing an RPM anchor causes a level jump');
});
