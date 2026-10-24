import { V8Synth } from './v8-synth.js';

class V8Processor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 850, minValue: 650, maxValue: 7200, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0.035, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'overrun', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'bass', defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }
  constructor() {
    super();
    this.synth = new V8Synth(sampleRate);
  }
  process(inputs, outputs, parameters) {
    const channels = outputs[0];
    if (channels?.length) {
      this.synth.render(channels[0], parameters.rpm, parameters.load, parameters.overrun, parameters.bass);
      for (let i = 1; i < channels.length; i++) channels[i].set(channels[0]);
    }
    return true;
  }
}
registerProcessor('teslasound-v8', V8Processor);
