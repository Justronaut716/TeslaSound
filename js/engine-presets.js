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
    decay: 0.0028, decayLoad: 0.0012, cutoff: 240, cutoffRpm: 0.045, cutoffLoad: 1100,
    bodyGain: 1.8, pipeGain: 0.22, intake: 0.045, level: 1, turbo: 0, mechanical: 0
  },
  {
    id: 'i6-turbo', name: 'Reihensechser Turbo',
    description: 'Kerniger Sechszylinder mit weicherem Lauf, Turbopfeifen und dezentem Ablasszischen beim Lupfen.',
    cylinders: 6, banks: [0, 1, 0, 1, 0, 1],
    strength: [1, 0.99, 1.01, 1, 0.99, 1.01],
    idle: 780, redline: 7200, rpmScale: 1.08,
    bodyHz: 145, bodyQ: 0.65, pipeHz: 650, pipeQ: 0.9,
    decay: 0.0025, decayLoad: 0.0009, cutoff: 360, cutoffRpm: 0.045, cutoffLoad: 1350,
    bodyGain: 1.05, pipeGain: 0.19, intake: 0.038, level: 0.95, turbo: 0.025, mechanical: 0.006
  },
  {
    id: 'v10-supercar', name: 'V10 Supercar',
    description: 'Heller, bissiger Hochdrehzahlklang mit metallischem Ansaugton.',
    cylinders: 10, banks: [0, 1, 0, 1, 1, 0, 1, 0, 0, 1],
    strength: [1, 0.98, 1.01, 0.97, 1.02, 0.99, 1, 0.98, 1.02, 0.99],
    idle: 1000, redline: 9000, rpmScale: 1.35,
    bodyHz: 190, bodyQ: 0.7, pipeHz: 1100, pipeQ: 1.25,
    decay: 0.0015, decayLoad: 0.0006, cutoff: 620, cutoffRpm: 0.06, cutoffLoad: 2100,
    bodyGain: 0.8, pipeGain: 0.35, intake: 0.028, level: 1.1, turbo: 0, mechanical: 0.035
  },
  {
    id: 'v12-gt', name: 'V12 GT',
    description: 'Dichter, gleichmäßiger Zwölfzylinderklang – sonor unten, seidig bei hoher Drehzahl.',
    cylinders: 12, banks: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    strength: [1, 0.995, 1.005, 1, 0.995, 1.005, 1, 0.995, 1.005, 1, 0.995, 1.005],
    idle: 900, redline: 8200, rpmScale: 1.2,
    bodyHz: 120, bodyQ: 0.65, pipeHz: 760, pipeQ: 0.75,
    decay: 0.0022, decayLoad: 0.0007, cutoff: 400, cutoffRpm: 0.04, cutoffLoad: 1500,
    bodyGain: 1.2, pipeGain: 0.16, intake: 0.02, level: 0.85, turbo: 0, mechanical: 0.012
  }
].map((preset, index) => Object.freeze({ ...preset, index, banks: Object.freeze(preset.banks), strength: Object.freeze(preset.strength) })));

export function getPreset(id) {
  return ENGINE_PRESETS.find(preset => preset.id === id) || ENGINE_PRESETS[0];
}
