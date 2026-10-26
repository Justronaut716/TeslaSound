// Shared tuning for the renderer, native fallback, drivetrain and selector.
// Fictional syntheses: no recording or claim to reproduce a specific vehicle.
export const ENGINE_PRESETS = Object.freeze([
  {
    id: 'v8-muscle', name: 'V8 Muscle',
    description: 'Tiefes, ungleichmäßiges Grollen mit kräftigem Auspuffbass.',
    cylinders: 8, banks: [0, 1, 1, 0, 1, 0, 0, 1],
    strength: [1, 0.92, 1.03, 0.96, 1.01, 0.94, 1.04, 0.97],
    idle: 850, redline: 6800, rpmScale: 1,
    bodyHz: 95, bodyQ: 0.85, pipeHz: 430, pipeQ: 1.15,
    pulse: 0.0011, headerMs: [0.4, 2.1], reflectionMs: [8.7, 6.8], bankMix: [1, 0.57],
    roughness: 0.018, variation: 0.11,
    cutoff: 650, cutoffRpm: 0.09, cutoffLoad: 2700,
    bodyGain: 1.8, pipeGain: 0.55, intake: 0.15, level: 1.35, turbo: 0, mechanical: 0.007
  },
  {
    id: 'i6-turbo', name: 'Reihensechser Turbo',
    description: 'Kerniger Sechszylinder mit weicherem Lauf, Turbopfeifen und dezentem Ablasszischen beim Lupfen.',
    cylinders: 6, banks: [0, 1, 0, 1, 0, 1],
    strength: [1, 0.99, 1.01, 1, 0.99, 1.01],
    idle: 780, redline: 7200, rpmScale: 1.08,
    bodyHz: 145, bodyQ: 0.65, pipeHz: 650, pipeQ: 0.9,
    pulse: 0.00085, headerMs: [0.5, 0.8], reflectionMs: [5.7, 5.1], bankMix: [1, 0.94],
    roughness: 0.005, variation: 0.045,
    cutoff: 850, cutoffRpm: 0.09, cutoffLoad: 2500,
    bodyGain: 1.05, pipeGain: 0.42, intake: 0.12, level: 1.25, turbo: 0.022, mechanical: 0.009
  },
  {
    id: 'v10-supercar', name: 'V10 Supercar',
    description: 'Heller, bissiger Hochdrehzahlklang mit metallischem Ansaugton.',
    cylinders: 10, banks: [0, 1, 0, 1, 1, 0, 1, 0, 0, 1],
    strength: [1, 0.98, 1.01, 0.97, 1.02, 0.99, 1, 0.98, 1.02, 0.99],
    idle: 1000, redline: 9000, rpmScale: 1.35,
    bodyHz: 190, bodyQ: 0.7, pipeHz: 1100, pipeQ: 1.25,
    pulse: 0.00055, headerMs: [0.3, 0.65], reflectionMs: [3.1, 3.7], bankMix: [1, 0.85],
    roughness: 0.006, variation: 0.055,
    cutoff: 1400, cutoffRpm: 0.12, cutoffLoad: 4000,
    bodyGain: 0.8, pipeGain: 0.9, intake: 0.2, level: 1.45, turbo: 0, mechanical: 0.028
  },
  {
    id: 'v12-gt', name: 'V12 GT',
    description: 'Dichter, gleichmäßiger Zwölfzylinderklang – sonor unten, seidig bei hoher Drehzahl.',
    cylinders: 12, banks: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    strength: [1, 0.995, 1.005, 1, 0.995, 1.005, 1, 0.995, 1.005, 1, 0.995, 1.005],
    idle: 900, redline: 8200, rpmScale: 1.2,
    bodyHz: 120, bodyQ: 0.65, pipeHz: 760, pipeQ: 0.75,
    pulse: 0.0008, headerMs: [0.4, 0.6], reflectionMs: [5.3, 4.7], bankMix: [1, 0.96],
    roughness: 0.003, variation: 0.025,
    cutoff: 1000, cutoffRpm: 0.08, cutoffLoad: 3000,
    bodyGain: 1.2, pipeGain: 0.5, intake: 0.1, level: 1.2, turbo: 0, mechanical: 0.012
  }
].map((preset, index) => Object.freeze({ ...preset, index,
  banks: Object.freeze(preset.banks), strength: Object.freeze(preset.strength),
  headerMs: Object.freeze(preset.headerMs), reflectionMs: Object.freeze(preset.reflectionMs), bankMix: Object.freeze(preset.bankMix)
})));

export function getPreset(id) {
  return ENGINE_PRESETS.find(preset => preset.id === id) || ENGINE_PRESETS[0];
}
