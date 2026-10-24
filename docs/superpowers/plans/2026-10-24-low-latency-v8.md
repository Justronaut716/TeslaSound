# Low-latency V8 Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans, task by task.

**Goal:** Reduce avoidable processing latency and synthesize responsive V8 sound from GPS in the Tesla browser.

**Architecture:** Separate a timestamped driving model, virtual drivetrain, audio renderer and UI. AudioWorklet performs continuous synthesis; a 20-ms controller updates AudioParams, independent of rendering. Native AudioNodes provide a compatible fallback.

**Tech Stack:** Static HTML, CSS, JavaScript modules, Web Audio, Geolocation, Node built-in test runner, Chromium.

**Spec:** `docs/superpowers/specs/2026-10-24-low-latency-v8-design.md`

## Global Constraints
- No runtime dependencies or build step; all asset paths relative for GitHub Pages.
- No CAN/pedal access or claim of measured total latency. GPS-derived deceleration cannot distinguish braking from regeneration.
- Invalid/stale GPS must release engine load; prediction bounded to 350 ms.
- Test-mode input and GPS input must stay isolated.

## Review Focus
- Null/zero/negative GPS speeds and unusable positions must not create phantom acceleration.
- Delayed and reordered fixes must not be treated as fresh.
- Starts/stops, mode switches and permission errors must clean up resources and old state.
- Worklet loading failure must recover to native audio and report the active backend.
- Continuous extremes of RPM/load must stay finite, bounded, audible and free of DC drift.

## Task 1: GPS state estimation and drivetrain
Files: `js/driving-model.js`, `js/drivetrain.js`, `tests/driving.test.js`, `package.json`.
Interfaces: `DrivingModel.pushGPS(fix, now)` (speed m/s, timestamp monotonic ms, accuracy m), `snapshot(now)` returns speed, acceleration, state, stale, age, interval; `Drivetrain.update(snapshot, now)` returns rpm, load, overrun, gear.
- [x] Write and run failing tests for acceleration/cruise/deceleration/idle, noisy speed, bounded prediction, stale data, outliers and position-speed fallback.
- [x] Implement model and drivetrain with SI units internally, hysteresis, measured-time derivatives and bounded prediction.
- [x] Run `npm test`, verify all model tests pass, commit.

## Task 2: Audio synthesis
Files: `js/v8-synth.js`, `js/engine-worklet.js`, `js/audio-engine.js`, `tests/audio.test.js`.
Interfaces: `V8Synth.render(output, rpm, load, overrun, bass)` renders mono Float32 samples; `AudioEngine.start()`, `update(params)`, `stop()`, `diagnostics()` control lifecycle/backend.
- [x] Write/run failing offline signal tests for idle, redline, spectral change with load, DC removal and smoothing.
- [x] Implement deterministic bank firing, exhaust resonances, load/overrun textures and soft limiter; wrap in a parameterized AudioWorklet with native fallback.
- [x] Run `npm test`, verify signal stability at 44.1/48 kHz and absence of scheduling queues, commit.

## Task 3: Browser integration and documentation
Files: `index.html`, `style.css`, `js/app.js`, `README.md`, `tests/browser-smoke.mjs`.
- [x] Integrate separate 20-ms audio control and throttled UI, GPS timestamp conversion, clean start/stop/restart, strict test/GPS mode isolation and immediate volume changes.
- [x] Add driving state, gear, explicit GPS/audio diagnostics, gas/brake test controls and accessible labels.
- [x] Exercise actual Chromium with Worklet and forced fallback, permission errors, suspended audio, mode switches, stale fixes and rapid start/stop.
- [x] Document GPS limits, local test commands, audio path and required stationary hardware verification.
- [x] Run complete suite and browser smoke test; prepare the verified files for a GitHub branch and draft PR without merging.

## Task 4: Phone/Bluetooth playback profile (user addition)
Files: `js/phone-playback.js`, `js/app.js`, `index.html`, `tests/phone.test.js`, `tests/browser_smoke.py`, `README.md`.
- [x] Write/run failing lifecycle tests: wake-lock denial, cancellation during pending request, duplicate request suppression and audio-category restoration.
- [x] Implement optional phone session, explicit output selector, persisted device preference and truthful OS-pairing instructions. Route through the OS, with no fake connection status or Web-Bluetooth audio transport.
- [x] Run full Node suite and actual Chromium profile tests; include startup cancellation, Worklet rejection and stopping during speaker test.
