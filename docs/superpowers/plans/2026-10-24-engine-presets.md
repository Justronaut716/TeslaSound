# Four engine presets

Goal: Four distinct synthetic engine sounds selectable without restarting audio,
available in both Tesla and phone/Bluetooth profiles. Keep V8 Muscle as default;
add inline-six turbo, V10 supercar and V12 GT. No runtime dependencies or samples.

Design: Share preset metadata and physical/spectral settings across the Worklet,
native fallback and drivetrain. Cylinder count determines combustion frequency;
bank pattern, pulse duration, resonances, intake, turbo/whine and RPM range give
each engine its character. Changing labels or pitch alone is insufficient.
Use a short bounded crossfade on changes, retain the last choice locally, and
leave GPS/test speed and the audio context running during a preset change.
Presets are fictional syntheses, not recordings of specific vehicles.

Alternatives: Recorded loops require assets, loop editing and pitch artifacts;
the existing continuous synthesis is already local and responsive. Extend it.

- [x] Add failing tests for four distinct bounded signals, combustion frequency,
  per-preset RPM behavior and switching continuity.
- [x] Implement shared presets, synthesis/Worklet crossfade and native wave/filter
  changes. Use the same current preset after Worklet failure and restart.
- [x] Add accessible selector, description and persisted preference; update docs.
- [x] Run complete unit and Chromium checks for both backends, phone mode, rapid
  preset changes, persistence, context continuity, mode changes and restarts.
- [x] Review the diff and prepare verified files for the previously authorized
  GitHub live-site workflow; verify Pages and served modules during publication.
