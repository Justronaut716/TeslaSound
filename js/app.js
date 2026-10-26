import { DrivingModel, speedFromPosition, clamp } from './driving-model.js?v=20261025-clock';
import { GPS_LIMITS, readGPSPosition } from './gps-input.js?v=20261025-clock';
import { Drivetrain } from './drivetrain.js?v=20261026-combustion';
import { AudioEngine } from './audio-engine.js?v=20261026-combustion';
import { PhonePlaybackSession } from './phone-playback.js';
import { ENGINE_PRESETS, getPreset } from './engine-presets.js?v=20261026-combustion';

const el = id => document.getElementById(id);
const model = new DrivingModel(), drivetrain = new Drivetrain();
const states = { unknown: 'Keine aktuellen Fahrdaten', idle: 'Stand · Leerlauf', accelerating: 'Beschleunigen', cruising: 'Konstante Fahrt', decelerating: 'Verzögern / Ausrollen' };
let engine = null, phase = 'stopped', test = false, hold = false;
let operation = 0, watch = null, gpsGeneration = 0, positions = [], timer = null;
let simulationSpeed = 0, lastTick = null, latestDriving = model.snapshot(0);
let latestEngine = { rpm: 850, gear: 1, load: 0.035, overrun: 0 };
let lastRender = 0;
let gpsReceived = 0, gpsAccepted = 0;
function reportGPS(text) {
  el('gps').textContent = text;
  el('gpsSummary').textContent = text;
}
let preset = getPreset();
try { preset = getPreset(localStorage.getItem('teslasound-engine-preset')); } catch { /* Optional preference. */ }
for (const option of ENGINE_PRESETS) el('enginePreset').add(new Option(option.name, option.id));
el('enginePreset').value = preset.id;
function showPreset() {
  el('presetDescription').textContent = preset.description;
  el('presetRange').textContent = `${preset.cylinders} Zylinder · ${preset.idle}–${preset.redline} RPM`;
}
drivetrain.setPreset(preset.id); drivetrain.reset(); showPreset();
latestEngine.rpm = preset.idle;
el('enginePreset').onchange = () => {
  preset = getPreset(el('enginePreset').value);
  drivetrain.setPreset(preset.id); engine?.setPreset(preset.id);
  try { localStorage.setItem('teslasound-engine-preset', preset.id); } catch { /* Best-effort preference only. */ }
  if (phase === 'stopped') { drivetrain.reset(); latestEngine.rpm = preset.idle; }
  showPreset(); tick();
};
let endSpeakerTest = null, speakerToken = 0;

function stopSpeakerTest() {
  speakerToken++;
  endSpeakerTest?.(); endSpeakerTest = null;
  el('beep').disabled = false;
}
let deviceMode = /Tesla/i.test(navigator.userAgent) ? 'tesla'
  : /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'phone' : 'tesla';
try { const saved = localStorage.getItem('teslasound-device-mode'); if (saved === 'phone' || saved === 'tesla') deviceMode = saved; } catch { /* Storage may be disabled. */ }
const phoneSession = new PhonePlaybackSession({
  wakeLock: navigator.wakeLock, audioSession: navigator.audioSession,
  visible: () => !document.hidden, report: text => { el('phoneStatus').textContent = text; }
});
el('deviceMode').value = deviceMode;
el('phoneHelp').hidden = deviceMode !== 'phone';
el('deviceMode').onchange = () => {
  deviceMode = el('deviceMode').value;
  el('phoneHelp').hidden = deviceMode !== 'phone';
  try { localStorage.setItem('teslasound-device-mode', deviceMode); } catch { /* Best-effort preference only. */ }
  if (deviceMode === 'phone' && phase === 'running') void phoneSession.activate();
  else void phoneSession.deactivate();
};

function resetDriving() {
  model.reset(); drivetrain.reset(); positions = [];
  simulationSpeed = 0; lastTick = null; hold = false;
  latestDriving = model.snapshot(performance.now());
  latestEngine = { rpm: preset.idle, gear: 1, load: 0.035, overrun: 0 };
  el('hold').setAttribute('aria-pressed', 'false');
}

function stopGPS() {
  gpsGeneration++;
  if (watch !== null) { navigator.geolocation.clearWatch(watch); watch = null; }
  positions = [];
  gpsReceived = 0; gpsAccepted = 0;
  el('gpsRaw').textContent = '—';
}

function startGPS() {
  stopGPS();
  if (!navigator.geolocation) { reportGPS('GPS wird von diesem Browser nicht unterstützt. Der Testmodus ist verfügbar.'); return; }
  if (!window.isSecureContext) { reportGPS('GPS benötigt HTTPS. Bitte die GitHub-Pages-Adresse mit https:// öffnen.'); return; }
  reportGPS('GPS wird gesucht. Standortzugriff im Browser erlauben.');
  const generation = gpsGeneration;
  try {
    watch = navigator.geolocation.watchPosition(position => {
      if (generation !== gpsGeneration || (phase !== 'running' && phase !== 'starting') || test) return;
      gpsReceived++;
      const now = performance.now();
      const input = readGPSPosition(position, now);
      el('gpsRaw').textContent = input.diagnostic;
      if (input.error) { reportGPS(input.error); return; }
      const current = input.position;
      let fix = input.fix, windowMs = 0;
      if (current) {
        const lastPosition = positions[positions.length - 1];
        if (lastPosition && Boolean(lastPosition.timeEstimated) !== Boolean(current.timeEstimated)) positions = [];
        else if (current.timeEstimated && lastPosition?.timeEstimated && Number.isFinite(current.rawTimestamp)
          && Number.isFinite(lastPosition.rawTimestamp) && current.rawTimestamp <= lastPosition.rawTimestamp) {
          reportGPS(`GPS: Zeitstempel unverändert oder rückwärts. ${input.diagnostic}`); return;
        }
        // An out-of-order fix must not erase newer history. The loop below
        // skips negative/short intervals and only newer positions are appended.
        positions = positions.filter(p => current.timestamp - p.timestamp <= GPS_LIMITS.positionWindowMs);
        if (!fix) {
          // Prefer the shortest resolvable window; coarse positions may need
          // more travel, while precise GPS keeps its responsive short window.
          for (let i = positions.length - 1; i >= 0; i--) {
            const dt = current.timestamp - positions[i].timestamp;
            if (dt < 800) continue;
            const speed = speedFromPosition(positions[i], current);
            if (speed !== null) {
              fix = { ...input.base, speed, source: 'position' }; windowMs = dt; break;
            }
          }
        }
        if (!positions.length || current.timestamp > positions[positions.length - 1].timestamp) positions.push(current);
        if (positions.length > 128) positions.shift();
      }
      if (!fix || !model.pushGPS(fix, now)) {
        reportGPS(!fix
          ? `GPS aktiv · noch keine verlässliche Geschwindigkeit. Bewegung muss die Positionsunsicherheit übersteigen. ${input.diagnostic}`
          : `GPS: Messwert verworfen (doppelt, Reihenfolge oder Geschwindigkeitssprung). ${input.diagnostic}`);
        return;
      }
      gpsAccepted++;
      reportGPS(fix.source === 'speed'
        ? `GPS-Geschwindigkeit aktiv · ${input.diagnostic}`
        : `Geschwindigkeit aus Positionen geschätzt (über ${(windowMs / 1000).toFixed(1)} s) · ${input.diagnostic}`);
      tick(now); // Sensor-to-audio path bypasses the screen and the timer.
    }, error => {
      if (generation !== gpsGeneration || test || (phase !== 'running' && phase !== 'starting')) return;
      if (error.code === 1) {
        stopGPS(); model.reset();
        reportGPS('Bitte den Standortzugriff für diese Website im Browser freigeben. Alternativ den Testmodus nutzen.');
        tick(performance.now());
      } else {
        reportGPS(error.code === 3
          ? 'GPS wartet auf ein Signal. Noch keine neuen Standortdaten; bei Bedarf „GPS neu verbinden“ antippen.'
          : 'GPS vorübergehend nicht verfügbar. Standortempfang prüfen; die Suche läuft weiter.');
      }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
  } catch (error) { reportGPS(`GPS konnte nicht gestartet werden: ${error.message}`); }
}

function tick(now = performance.now()) {
  if (phase !== 'running') return;
  const dt = lastTick === null ? 0.02 : clamp((now - lastTick) / 1000, 0, 0.1);
  lastTick = now;
  if (test) {
    const gas = Number(el('pedal').value) / 100, brake = Number(el('brake').value) / 100;
    const previous = simulationSpeed;
    if (!hold) {
      const drag = simulationSpeed > 0 ? 0.08 + simulationSpeed * 0.018 + simulationSpeed ** 2 * 0.0008 : 0;
      simulationSpeed = clamp(simulationSpeed + (gas * 4.2 - brake * 9.5 - drag) * dt, 0, 65);
    }
    const acceleration = dt > 0 ? (simulationSpeed - previous) / dt : 0;
    latestDriving = { speed: simulationSpeed, acceleration, state: simulationSpeed < 0.2 ? 'idle'
      : acceleration > 0.2 ? 'accelerating' : acceleration < -0.2 ? 'decelerating' : 'cruising',
      stale: false, age: 0, interval: 20, source: 'test' };
  } else latestDriving = model.snapshot(now);
  latestEngine = drivetrain.update(latestDriving, now);
  engine?.update({ ...latestEngine, volume: Number(el('volume').value) / 100, bass: Number(el('bass').value) / 100 });
}

function render(now) {
  if (now - lastRender >= 100) {
    lastRender = now;
    const fresh = phase === 'running' && !latestDriving.stale;
    el('speed').textContent = fresh ? Math.round(latestDriving.speed * 3.6) : '—';
    el('rpm').textContent = Math.round(latestEngine.rpm / 50) * 50;
    el('gear').textContent = fresh && latestDriving.speed > 0.45 ? latestEngine.gear : 'N';
    el('acceleration').textContent = fresh ? latestDriving.acceleration.toFixed(1) : '—';
    const state = phase === 'running' ? latestDriving.state : 'unknown';
    el('driveState').textContent = states[state]; el('driveState').dataset.state = state;
    const diag = engine?.diagnostics();
    const latency = value => value === null || value === undefined ? 'Nicht gemeldet' : `${(value * 1000).toFixed(1)} ms`;
    el('audioBackend').textContent = diag?.backend ?? '—';
    el('audioBuffer').textContent = diag ? latency(diag.baseLatency) : '—';
    el('audioOutput').textContent = diag ? latency(diag.outputLatency) : '—';
    el('gpsInterval').textContent = test ? 'Testmodus' : latestDriving.interval === null ? '—' : `${Math.round(latestDriving.interval)} ms`;
    el('gpsAge').textContent = test ? 'Testmodus' : latestDriving.timeEstimated
      ? `Messzeit unbekannt · Empfang vor ${Math.round(latestDriving.receptionAge)} ms${latestDriving.stale ? ' · veraltet' : ''}`
      : Number.isFinite(latestDriving.age) ? `${Math.round(latestDriving.age)} ms${latestDriving.stale ? ' · veraltet' : ''}` : '—';
    el('gpsReceived').textContent = `${gpsReceived} / ${gpsAccepted}`;
    el('gpsRetry').disabled = test || (phase !== 'running' && phase !== 'starting');
  }
  requestAnimationFrame(render);
}

async function start() {
  if (phase === 'running' && engine?.ctx?.state !== 'running') {
    try { await engine.ctx.resume(); el('status').textContent = 'Motor läuft · Audio fortgesetzt'; }
    catch (error) { el('status').textContent = `Audio konnte nicht fortgesetzt werden: ${error.message}`; }
    return;
  }
  if (phase !== 'stopped') return;
  const token = ++operation;
  phase = 'starting'; el('start').disabled = true; el('stop').disabled = false;
  el('deviceMode').disabled = true;
  el('status').textContent = 'Sound-Engine wird gestartet …';
  const instance = new AudioEngine(preset.id); engine = instance;
  resetDriving();
  if (!test) startGPS();
  else reportGPS('Testmodus · GPS ist ausgeschaltet.');
  try {
    if (deviceMode === 'phone') void phoneSession.activate();
    const ready = await instance.start();
    if (token !== operation || !ready) { await instance.stop(); return; }
    phase = 'running';
    el('deviceMode').disabled = false;
    el('status').textContent = 'Motor läuft · ' + (test ? 'Testmodus' : 'GPS-Modus');
    instance.ctx.onstatechange = () => {
      if (phase !== 'running' || engine !== instance) return;
      const paused = instance.ctx?.state !== 'running';
      el('start').disabled = !paused;
      el('start').textContent = paused ? '▶ Audio fortsetzen' : '▶ Motor starten';
      el('status').textContent = paused ? 'Audio pausiert. Zum Fortsetzen tippen.' : 'Motor läuft · ' + (test ? 'Testmodus' : 'GPS-Modus');
    };
    tick(); timer = setInterval(tick, 20);
  } catch (error) {
    await instance.stop();
    if (token !== operation) return;
    stopGPS(); model.reset();
    reportGPS('GPS gestoppt, weil der Audiostart fehlgeschlagen ist. Motor erneut starten.');
    engine = null; phase = 'stopped'; el('start').disabled = false; el('stop').disabled = true;
    el('deviceMode').disabled = false; void phoneSession.deactivate();
    el('status').textContent = `Audiofehler: ${error.message}`;
  }
}

async function stop() {
  stopSpeakerTest();
  if (phase === 'stopped' || phase === 'stopping') return;
  ++operation; phase = 'stopping';
  clearInterval(timer); timer = null; stopGPS();
  el('start').disabled = true; el('stop').disabled = true;
  el('deviceMode').disabled = true;
  const instance = engine; engine = null;
  try { await Promise.all([instance?.stop(), phoneSession.deactivate()]); }
  finally {
    phase = 'stopped'; resetDriving();
    el('start').disabled = false; el('start').textContent = '▶ Motor starten';
    el('deviceMode').disabled = false;
    el('status').textContent = 'Motor gestoppt';
    reportGPS(test ? 'Testmodus · GPS ist ausgeschaltet.' : 'GPS gestoppt.');
  }
}

el('start').onclick = start;
el('stop').onclick = stop;
el('gpsRetry').onclick = () => {
  if (test || (phase !== 'running' && phase !== 'starting')) return;
  model.reset(); startGPS(); tick();
};
el('test').onclick = () => {
  test = !test; stopGPS(); resetDriving();
  el('test').textContent = test ? 'Testmodus deaktivieren' : 'Testmodus aktivieren';
  el('test').setAttribute('aria-pressed', String(test));
  el('mode').textContent = test ? 'Testmodus · GPS aus' : 'GPS-Modus';
  for (const id of ['pedal', 'brake', 'hold']) el(id).disabled = !test;
  el('pedal').value = el('brake').value = 0;
  el('gasLabel').textContent = el('brakeLabel').textContent = '0%';
  if (phase === 'running' || phase === 'starting') {
    if (!test) startGPS(); else reportGPS('Testmodus · GPS ist ausgeschaltet.');
    if (phase === 'running') el('status').textContent = 'Motor läuft · ' + (test ? 'Testmodus' : 'GPS-Modus');
    tick();
  }
};
el('hold').onclick = () => {
  hold = !hold; el('hold').setAttribute('aria-pressed', String(hold)); tick();
};
for (const [input, output] of [['volume', 'volLabel'], ['bass', 'bassLabel'], ['pedal', 'gasLabel'], ['brake', 'brakeLabel']]) {
  el(input).oninput = () => {
    el(output).textContent = el(input).value + '%';
    if (input === 'pedal' || input === 'brake') { hold = false; el('hold').setAttribute('aria-pressed', 'false'); }
    if (input === 'volume') engine?.setVolume(Number(el('volume').value) / 100);
    tick();
  };
}
el('beep').onclick = async () => {
  stopSpeakerTest();
  const token = speakerToken;
  el('beep').disabled = true;
  let ac, tone, gain, owned = false;
  const temporaryPhone = deviceMode === 'phone' && phase === 'stopped';
  try {
    if (temporaryPhone) void phoneSession.activate();
    const Context = window.AudioContext || window.webkitAudioContext;
    ac = engine?.ctx;
    if (!ac || ac.state === 'closed') { ac = new Context({ latencyHint: 'interactive' }); owned = true; }
    endSpeakerTest = () => {
      if (tone) { tone.onended = null; try { tone.stop(); } catch {} tone.disconnect(); }
      gain?.disconnect();
      if (owned && ac.state !== 'closed') void ac.close().catch(() => {});
      if (temporaryPhone && phase === 'stopped') void phoneSession.deactivate();
    };
    await ac.resume();
    if (token !== speakerToken) return;
    tone = ac.createOscillator(); gain = ac.createGain();
    tone.frequency.value = 220;
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(0.09, ac.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.35);
    tone.connect(gain); gain.connect(ac.destination);
    tone.onended = () => { if (token === speakerToken) stopSpeakerTest(); };
    tone.start(); tone.stop(ac.currentTime + 0.36);
  } catch (error) {
    if (token !== speakerToken) return;
    stopSpeakerTest();
    if (temporaryPhone && phase === 'stopped') void phoneSession.deactivate();
    el('status').textContent = `Lautsprechertest fehlgeschlagen: ${error.message}`;
  }
};
window.addEventListener('pagehide', stop);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && phase === 'running') {
    tick();
    if (deviceMode === 'phone') void phoneSession.ensureAwake();
  }
});
requestAnimationFrame(render);
