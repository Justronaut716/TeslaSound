import { EngineSynth } from './engine-synth.js';
import { ENGINE_PRESETS } from './engine-presets.js';

class V8Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 850, minValue: 650, maxValue: 10000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0.035, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'overrun', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bass', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'preset', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' }
    ];
  }
  constructor(options) {
    super();
    this.synth = new EngineSynth(sampleRate, options.processorOptions?.presetId);
    this.presetIndex = -1;
  }
  process(inputs, outputs, parameters) {
    const channels = outputs[0];
    if (channels?.length) {
      const index = Math.round(parameters.preset[0]);
      if (index !== this.presetIndex) {
        this.synth.setPreset(ENGINE_PRESETS[index]?.id);
        this.presetIndex = index;
      }
      this.synth.render(channels[0], parameters.rpm, parameters.load, parameters.overrun, parameters.bass);
      for (let i = 1; i < channels.length; i++) channels[i].set(channels[0]);
    }
    return true;
  }
}
registerProcessor('teslasound-v8', V8Processor);
