import test from 'node:test';
import assert from 'node:assert/strict';
import { V8Synth } from '../js/v8-synth.js';

const rms = data => Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
function signal(rpm, load, rate = 48000, overrun = 0, bass = 0.7) {
  const synth = new V8Synth(rate);
  synth.render(new Float32Array(rate), rpm, load, overrun, bass);
  const data = new Float32Array(rate * 2);
  synth.render(data, rpm, load, overrun, bass);
  return data;
}

test('idle, full load and overrun remain finite, audible and bounded at both common sample rates', () => {
  for (const rate of [44100, 48000]) {
    for (const [rpm, load, overrun] of [[850, 0.035, 0], [3600, 1, 0], [6800, 1, 0], [4500, 0.01, 1]]) {
      const data = signal(rpm, load, rate, overrun);
      assert(data.every(Number.isFinite));
      assert(data.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0) < 0.96);
      assert(rms(data) > 0.015, `inaudible ${rpm}: ${rms(data)}`);
      assert(Math.abs(data.reduce((sum, x) => sum + x, 0) / data.length) < 0.003, 'DC drift');
    }
  }
});

test('load increases level and high-frequency detail at the same RPM', () => {
  const low = signal(2800, 0.08), high = signal(2800, 0.95);
  const differenceEnergy = data => {
    let sum = 0;
    for (let i = 1; i < data.length; i++) sum += (data[i] - data[i - 1]) ** 2;
    return sum / data.length;
  };
  assert(rms(high) > rms(low) * 1.25);
  assert(differenceEnergy(high) > differenceEnergy(low) * 1.5);
});

test('bass changes spectral balance rather than simply turning everything up', () => {
  const thin = signal(1400, 0.4, 48000, 0, 0);
  const deep = signal(1400, 0.4, 48000, 0, 1);
  const toneEnergy = (data, frequency) => {
    let re = 0, im = 0;
    for (let i = 0; i < data.length; i++) {
      re += data[i] * Math.cos(i * 2 * Math.PI * frequency / 48000);
      im += data[i] * Math.sin(i * 2 * Math.PI * frequency / 48000);
    }
    return re * re + im * im;
  };
  // 1400 RPM / 60 * 4 firing events per revolution = 93.33 Hz.
  const lowBoost = toneEnergy(deep, 93.333) / toneEnergy(thin, 93.333);
  const highBoost = toneEnergy(deep, 653.333) / toneEnergy(thin, 653.333);
  assert(lowBoost > highBoost * 1.3);
});

test('parameter changes preserve phase and avoid a discontinuous full-scale jump', () => {
  const synth = new V8Synth(48000);
  const before = new Float32Array(48000);
  synth.render(before, 850, 0.035, 0, 0.7);
  const after = new Float32Array(48000);
  synth.render(after, 6800, 1, 0, 0.7);
  assert(Math.abs(after[0] - before.at(-1)) < 0.08);
  assert(after.every(Number.isFinite));
  assert(rms(after.subarray(24000)) > 0.015);
});

test('scalar and AudioParam-array input agree within Float32 precision', () => {
  const scalar = new Float32Array(4096), parameter = new Float32Array(4096);
  new V8Synth(48000).render(scalar, 2500, 0.5, 0.2, 0.7);
  new V8Synth(48000).render(parameter, new Float32Array([2500]), new Float32Array([0.5]), new Float32Array([0.2]), new Float32Array([0.7]));
  const maxError = scalar.reduce((error, x, i) => Math.max(error, Math.abs(x - parameter[i])), 0);
  assert(maxError < 0.000001, `Float32 parameter error: ${maxError}`);
});
