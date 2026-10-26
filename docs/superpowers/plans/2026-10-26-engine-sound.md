# Engine Sound Implementation Plan

> Execute inline with superpowers:executing-plans; request one independent final review.

**Goal:** Replace the thin engine tone in both audio paths with richer combustion and exhaust sound.
**Architecture:** Shared procedural renderer; real-time worklet and locally generated native buffer loops.
**Tech Stack:** JavaScript, Web Audio, Node tests, Chromium/Playwright.
**Spec:** docs/superpowers/specs/2026-10-26-engine-sound-design.md

## Global constraints

Four existing presets; no external audio downloads or dependencies; no ScriptProcessor;
no extra audio queue; preserve GPS, Bluetooth mode and start/stop behavior.

## Review focus

Native low/high RPM pitch and loop seams; bounded preset caching; processor-error fallback;
rapid switching and stop while starting; no stale module graph after deployment.

## Task 1: Shared combustion sound and loops

- [x] Add failing audio regression tests for harmonic richness and real-time/looped firing pitch.
- [x] Replace decaying DC excitation with shaped cylinder pulses and bank exhaust paths.
- [x] Tune four profiles for different body, intake and overrun character.
- [x] Generate finite, seamless RPM/load loops with correct reference pitch.
- [x] Run complete Node suite and export local audition WAVs.

## Task 2: Native playback and verification

- [x] Replace native oscillators with bounded RPM/load loop voices and smooth live controls.
- [x] Test actual native rendered audio, load/bass changes, loop edges and low/high RPM.
- [x] Run complete browser suite, including GPS, phone and lifecycle checks.
- [x] Update documentation and cache versions throughout the audio module graph.
- [x] Request independent review, fix confirmed issues, rerun relevant checks.
- [ ] Commit, publish via GitHub PR using the real main commit as parent, verify deployment and served bytes.

Validation: 38/38 Node tests and 115 Chromium checks passed, including 24
real native RPM/load/bass renders and processor-error callback recovery.
Independent review found no blocking issues. Publishing/deployment verification
is the final release gate.
