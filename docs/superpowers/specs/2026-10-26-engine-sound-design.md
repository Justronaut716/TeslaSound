# More convincing engine sound

The user hears a weak synthetic tone instead of an engine. The existing impulse
generator reduces both cylinder banks to almost the same low-passed exponential;
the native fallback reduces them further to fixed periodic oscillators.

Use a shared combustion renderer with finite pressure pulses, distinct bank
travel/reflection times, resonant exhaust/body and intake paths, small combustion
variation, rough idle, load-dependent bark, and restrained lift-off texture.
Keep the four fictional presets and their different firing rates and RPM limits.

Approaches considered: tuning the existing oscillator changes little of the
underlying tone; external recordings need licensed, matched RPM/load sets and
add downloads; a local combustion model improves both browsers without a new
network dependency. The third approach is the implementation choice.

The worklet renders continuously. The native fallback loops short, locally
rendered versions of that same model at three RPM anchors and two loads, with
continuous playback-rate adjustment and smooth mixing. This replaces the weak
oscillator fallback without a ScriptProcessor or a queued audio stream. Loops
have seamless boundaries and actual rendered RPM is used to preserve pitch.
Buffers are created lazily per preset and cached with a fixed maximum of four
voices. Both paths retain interactive latency, bounded levels, soft transitions,
existing volume/bass controls, lifecycle cleanup, GPS and phone behavior.

Validation includes measurable harmonic detail, load response, finite output at
44.1/48 kHz, true firing pitch and seamless loops, real native-browser rendered
audio, worklet integration and existing GPS/lifecycle coverage. Numerical tests
cannot establish that a particular Tesla's speakers sound convincing; presets
remain procedural characters rather than recordings of specific vehicles.
