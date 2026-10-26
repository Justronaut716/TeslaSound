import { V8Synth } from './v8-synth.js?v=20261026-combustion';
import { getPreset } from './engine-presets.js?v=20261026-combustion';

// Procedural engine loops, generated locally and only when a preset is needed.
// No downloads and no JS callback in the native browser's audio render path.
export function createEngineLoops(rate, presetId) {
  const p = getPreset(presetId), loops = [];
  for (const anchor of [p.idle, p.redline * 0.4, p.redline * 0.8]) {
    const length = Math.round(rate * 120 / anchor * 8);
    const rpm = rate * 120 * 8 / length;
    for (const load of [0.035, 1]) {
      const synth = new V8Synth(rate, p.id);
      synth.rpm = rpm;
      const fade = Math.min(Math.round(rate * 0.012), Math.floor(length / 8));
      // Settle RPM, reflection and DC filters before capturing eight cycles.
      synth.render(new Float32Array(length * Math.ceil(rate * 0.25 / length)), rpm, load, 0, 0.5);
      const audio = new Float32Array(length + fade);
      synth.render(audio, rpm, load, 0, 0.5);
      // Continue from the end on each wrap and blend back to the original head.
      // The loop length stays exactly eight crank cycles, so pitch is unchanged.
      for (let i = 0; i < fade; i++) {
        const mix = i / fade;
        audio[i] = audio[length + i] * (1 - mix) + audio[i] * mix;
      }
      loops.push({ rpm, load, data: audio.slice(0, length) });
    }
  }
  return loops;
}

export function loopWeights(anchors, rpm, load) {
  const weights = [0, 0, 0, 0, 0, 0];
  const power = Math.max(0, Math.min(1, (load - 0.035) / 0.965));
  let low = rpm <= anchors[1] ? 0 : 1;
  const blend = Math.max(0, Math.min(1, Math.log(Math.max(1, rpm) / anchors[low]) / Math.log(anchors[low + 1] / anchors[low])));
  weights[low * 2] = (1 - blend) * (1 - power);
  weights[low * 2 + 1] = (1 - blend) * power;
  weights[(low + 1) * 2] = blend * (1 - power);
  weights[(low + 1) * 2 + 1] = blend * power;
  return weights;
}
