"""Real Chromium integration checks. Requires Python Playwright + Chromium.

Run from the repository root: npm run test:browser
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import os
import shutil

from playwright.sync_api import sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


ROOT = Path(__file__).resolve().parent.parent
server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
Thread(target=server.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{server.server_port}/"
instrument = """(() => {
  window.__contexts = [];
  window.__worklets = [];
  if (window.AudioWorkletNode) {
    const NativeWorklet = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeWorklet {
      constructor(...args) { super(...args); window.__worklets.push(this); }
    };
  }
  const NativeContext = window.AudioContext;
  window.AudioContext = class extends NativeContext {
    constructor(options) { super(options); window.__contexts.push(this); }
  };
  window.__watches = 0;
  window.__clears = 0;
  Object.defineProperty(navigator, 'geolocation', { value: {
    watchPosition(success, error) {
      window.__gps = success; window.__gpsError = error; window.__watches++; return window.__watches;
    },
    clearWatch() { window.__clears++; }
  }});
  window.__fix = (speed, age = 0, accuracy = 5) => window.__gps({
    timestamp: Date.now() - age,
    coords: { speed, accuracy, latitude: 52.52, longitude: 13.405, heading: 0, altitude: null, altitudeAccuracy: null }
  });
})();"""


def check(page, expression, message):
    try:
        page.wait_for_function(expression, timeout=8000)
    except Exception:
        print('DIAGNOSTICS', page.locator('main').inner_text())
        raise
    print("PASS", message)


def slider(page, selector, value):
    page.locator(selector).evaluate("(input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }", str(value))


try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=os.environ.get("CHROMIUM_PATH") or shutil.which("chromium"),
                                    headless=True, args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"])
        # Exact numerical fixture from the Tesla photo: seconds interpreted as
        # milliseconds previously produced "1752186186.7 s" of bogus age.
        clock_page = browser.new_page()
        clock_page.add_init_script(instrument)
        clock_page.add_init_script('window.__vehicleWall = 1753940126826; Date.now = () => window.__vehicleWall;')
        clock_page.goto(url)
        clock_page.click('#start')
        check(clock_page, "document.querySelector('#status').textContent.includes('Motor läuft')", "Tesla timestamp reproduction starts")
        clock_page.evaluate('window.__gps({timestamp:1753940126,coords:{speed:12,accuracy:120,latitude:52.52,longitude:13.405}})')
        check(clock_page, "document.querySelector('#gpsReceived').textContent === '1 / 1' && Number(document.querySelector('#speed').textContent) >= 40", "photographed seconds timestamp supplies live speed")
        check(clock_page, "document.querySelector('#gpsRaw').textContent.includes('Sekunden normalisiert') && document.querySelector('#gpsRaw').textContent.includes('0.8 s')", "55-year error normalizes to 0.8 seconds")
        clock_page.click('#gpsRetry')
        clock_page.evaluate('window.__gps({timestamp:4321,coords:{speed:12,accuracy:5,latitude:52.52,longitude:13.405}})')
        check(clock_page, "document.querySelector('#gpsReceived').textContent === '1 / 1' && document.querySelector('#gpsRaw').textContent.includes('Zeitbasis unbekannt')", "relative timestamp works with an explicit unknown-age label")
        clock_page.evaluate('window.__gps({timestamp:4321,coords:{speed:12,accuracy:5,latitude:52.5202,longitude:13.405}})')
        check(clock_page, "document.querySelector('#gpsReceived').textContent === '2 / 1'", "duplicate relative timestamp is rejected")
        clock_page.wait_for_timeout(1000)
        clock_page.evaluate('window.__gps({timestamp:4322,coords:{speed:12,accuracy:5,latitude:52.5202,longitude:13.405}})')
        check(clock_page, "document.querySelector('#gpsReceived').textContent === '3 / 2'", "advancing relative timestamp continues tracking")
        clock_page.click('#gpsRetry')
        clock_page.evaluate('window.__gps({timestamp:1753940114,coords:{speed:12,accuracy:5,latitude:52.52,longitude:13.405}})')
        check(clock_page, "document.querySelector('#gpsSummary').textContent.includes('zu alt') && document.querySelector('#gpsSummary').textContent.includes('12.8 s')", "genuinely old seconds-based measurement still rejects")
        clock_page.click('#stop')
        check(clock_page, "window.__contexts.every(ctx => ctx.state === 'closed')", "timestamp compatibility closes cleanly")
        clock_page.close()
        # Some embedded Chromium releases support our audio and module APIs but
        # predate Array.prototype.at. A second GPS fix must still be processed.
        compatibility = browser.new_page()
        compatibility.add_init_script(instrument)
        compatibility.add_init_script("Object.defineProperty(Array.prototype, 'at', { value: undefined, configurable: true });")
        compatibility.goto(url)
        compatibility.click('#start')
        check(compatibility, "document.querySelector('#status').textContent.includes('Motor läuft')", "GPS starts without Array.at support")
        compatibility.evaluate("window.__fix(0)")
        compatibility.wait_for_timeout(1000)
        compatibility.evaluate("window.__fix(3)")
        check(compatibility, "Number(document.querySelector('#speed').textContent) >= 8", "successive GPS fixes work on older embedded browser")
        check(compatibility, "document.querySelector('#gpsReceived').textContent === '2 / 2'", "GPS diagnosis counts received and accepted fixes")
        compatibility.wait_for_timeout(120)
        compatibility.evaluate('window.__fix(3.5, 0, 600)')
        check(compatibility, "document.querySelector('#gpsReceived').textContent === '3 / 3'", "reported speed survives coarse position accuracy")
        check(compatibility, "document.querySelector('#gpsRaw').textContent.includes('600 m')", "raw GPS position precision is visible")
        compatibility.click('#gpsRetry')
        check(compatibility, "window.__watches === 2 && window.__clears === 1", "GPS retry replaces the previous watch")
        check(compatibility, "document.querySelector('#gpsReceived').textContent === '0 / 0'", "GPS retry resets diagnostics")
        compatibility.evaluate('window.__fix(12, 3500, 600)')
        check(compatibility, "Number(document.querySelector('#speed').textContent) >= 40 && document.querySelector('#gpsAge').textContent.includes('ms')", "delayed speed is processed with its real age")
        compatibility.evaluate("window.__gps({timestamp:0,coords:{speed:12,accuracy:null,latitude:52.52,longitude:13.405}})")
        check(compatibility, "document.querySelector('#gpsRaw').textContent.includes('Messzeit unbekannt') && document.querySelector('#gpsAge').textContent.includes('Messzeit unbekannt')", "unknown timestamp is explicitly marked in GPS diagnosis")
        compatibility.evaluate('window.__fix(12, 9000)')
        check(compatibility, "document.querySelector('#gpsSummary').textContent.includes('9.0 s')", "old data reports actual age instead of an ambiguous rejection")
        compatibility.click('#gpsRetry')
        compatibility.evaluate("window.__gps({timestamp:Date.now()-3000,coords:{speed:null,accuracy:3,latitude:52.52,longitude:13.405}})")
        compatibility.wait_for_timeout(1000)
        compatibility.evaluate("window.__gps({timestamp:0,coords:{speed:null,accuracy:3,latitude:52.52009,longitude:13.405}})")
        check(compatibility, "document.querySelector('#gpsReceived').textContent === '2 / 0'", "position fallback waits for matching timestamp sources")
        compatibility.wait_for_timeout(1000)
        compatibility.evaluate("window.__gps({timestamp:0,coords:{speed:null,accuracy:3,latitude:52.52018,longitude:13.405}})")
        check(compatibility, "document.querySelector('#gpsReceived').textContent === '3 / 1' && Math.abs(Number(document.querySelector('#acceleration').textContent)) < 0.1", "position timebase switch does not invent acceleration")
        compatibility.click('#stop')
        check(compatibility, "window.__contexts.every(ctx => ctx.state === 'closed')", "embedded browser GPS/audio stop cleanly")
        compatibility.close()
        for fallback in (False, True):
            page = browser.new_page(viewport={"width": 1100, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.add_init_script(instrument)
            if fallback:
                # AudioWorklet fetches are not reliably intercepted by Page.route.
                # Exercise the real compatibility graph with the API unavailable.
                page.add_init_script("Object.defineProperty(AudioContext.prototype, 'audioWorklet', { get() { return undefined; } });")
            page.goto(url)
            if not fallback:
                page.select_option('#deviceMode', 'phone')
                assert page.locator('#phoneHelp').is_visible()
                check(page, "localStorage.getItem('teslasound-device-mode') === 'phone'", "phone/Bluetooth profile saves selected device")
            page.click("#test")
            page.click("#start")
            check(page, "document.querySelector('#status').textContent.includes('Motor läuft')", "engine starts")
            check(page, "window.__watches === 0", "test mode does not request GPS")
            check(page, "document.querySelector('#audioBackend').textContent !== '—'", "audio diagnostics appear")
            backend = page.locator("#audioBackend").inner_text()
            assert ("Kompatibilität" in backend) if fallback else ("AudioWorklet" in backend), backend
            print("PASS backend", backend)
            slider(page, "#pedal", 75)
            check(page, "document.querySelector('#driveState').textContent.includes('Beschleunigen')", "test pedal produces acceleration")
            check(page, "Number(document.querySelector('#rpm').textContent) > 1200", "RPM responds")
            check(page, "Number(document.querySelector('#speed').textContent) >= 12", "simulation gains speed")
            page.click("#hold")
            check(page, "document.querySelector('#driveState').textContent.includes('Konstante')", "hold simulates cruising")
            assert page.locator('#enginePreset option').count() == 4
            speed_before = page.locator('#speed').inner_text()
            for index, preset in enumerate(['v8-muscle', 'i6-turbo', 'v10-supercar', 'v12-gt']):
                page.select_option('#enginePreset', preset)
                check(page, f"localStorage.getItem('teslasound-engine-preset') === '{preset}'", f"{preset} selection persists")
                assert page.locator('#presetDescription').inner_text()
                assert page.locator('#speed').inner_text() == speed_before, 'preset change reset speed'
                assert page.evaluate('window.__contexts.length') == 1, 'preset switch recreated AudioContext'
                if not fallback:
                    check(page, f"window.__worklets.at(-1).parameters.get('preset').value === {index}", f"{preset} reaches actual Worklet parameter")
            # Rapid clicks are coalesced by the Worklet; only the final choice wins.
            page.evaluate("for (const id of ['i6-turbo','v10-supercar','v8-muscle','v12-gt']) { const select = document.querySelector('#enginePreset'); select.value = id; select.dispatchEvent(new Event('change')); }")
            check(page, "document.querySelector('#enginePreset').value === 'v12-gt' && window.__contexts.at(-1).state === 'running'", "rapid preset switching keeps audio running")
            slider(page, "#brake", 90)
            check(page, "document.querySelector('#driveState').textContent.includes('Verzögern')", "brake overrides throttle")
            slider(page, "#volume", 0)
            check(page, "document.querySelector('#volLabel').textContent === '0%'", "volume input updates immediately")
            page.click("#test")
            check(page, "window.__watches === 1 && document.querySelector('#pedal').disabled", "GPS mode isolates simulation controls")
            page.evaluate("window.__fix(0)")
            check(page, "document.querySelector('#driveState').textContent.includes('Stand')", "GPS zero is valid")
            page.wait_for_timeout(1000)
            page.evaluate("window.__fix(3)")
            check(page, "document.querySelector('#driveState').textContent.includes('Beschleunigen')", "live GPS updates sound state")
            page.evaluate("window.__fix(40, 6000)")
            check(page, "document.querySelector('#gps').textContent.includes('zu alt')", "old fixes are rejected")
            check(page, "document.querySelector('#driveState').textContent.includes('Keine aktuellen')", "GPS loss releases driving state")
            # A mode round-trip clears old positions and model history.
            page.click("#test")
            page.click("#test")
            page.evaluate("window.__fix(null)")
            check(page, "document.querySelector('#gps').textContent.includes('keine verlässliche')", "null speed needs a second usable position")
            page.wait_for_timeout(1000)
            page.evaluate("window.__gps({ timestamp: Date.now(), coords: { speed: null, accuracy: 5, latitude: 52.52009, longitude: 13.405, heading: 0, altitude: null, altitudeAccuracy: null } })")
            check(page, "document.querySelector('#gps').textContent.includes('aus Positionen') && Number(document.querySelector('#speed').textContent) > 5", "position fallback supplies an explicitly estimated speed")
            page.evaluate("window.__gpsError({code: 1, message: 'permission denied'})")
            check(page, "document.querySelector('#gps').textContent.includes('freigeben')", "GPS denial is actionable")
            check(page, "window.__clears >= 1", "GPS watch is removed after permission denial")
            # Resume a genuinely suspended context through the UI.
            page.evaluate("window.__contexts.at(-1).suspend()")
            check(page, "!document.querySelector('#start').disabled", "suspended audio exposes resume")
            page.click("#start")
            check(page, "window.__contexts.at(-1).state === 'running'", "gesture resumes same audio context")
            page.click("#stop")
            check(page, "window.__contexts.every(ctx => ctx.state === 'closed')", "stop closes audio contexts")
            page.click("#test")
            page.click("#start")
            check(page, "document.querySelector('#status').textContent.includes('Motor läuft')", "restart succeeds")
            assert page.locator('#enginePreset').input_value() == 'v12-gt', 'restart lost preset'
            page.click("#beep")
            page.click("#stop")
            check(page, "window.__contexts.every(ctx => ctx.state === 'closed')", "restart/stop cleans all contexts")
            check(page, "!document.querySelector('#beep').disabled", "stop during speaker test restores test button")
            if not fallback:
                check(page, "document.querySelector('#phoneStatus').textContent.includes('Motorstart')", "stopping releases phone playback session")
            assert not errors, json.dumps(errors)
            if not fallback:
                (ROOT / "artifacts").mkdir(exist_ok=True)
                page.screenshot(path=str(ROOT / "artifacts" / "teslasound-desktop.png"), full_page=True)
                page.set_viewport_size({"width": 390, "height": 844})
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "mobile overflow"
                page.screenshot(path=str(ROOT / "artifacts" / "teslasound-mobile.png"), full_page=True)
            page.reload()
            check(page, "document.querySelector('#enginePreset').value === 'v12-gt'", "reload restores selected engine")
            page.click('#test')
            page.click('#start')
            check(page, "document.querySelector('#status').textContent.includes('Motor läuft')", "saved engine finishes asynchronous startup")
            check(page, "document.querySelector('#rpm').textContent === '900'", "saved V12 starts at its own idle RPM")
            if not fallback:
                check(page, "window.__worklets.at(-1).parameters.get('preset').value === 3", "saved V12 initializes actual Worklet")
            page.click('#stop')
            check(page, "window.__contexts.every(ctx => ctx.state === 'closed')", "saved engine closes cleanly")
            page.close()

        # Render the real native fallback graph offline: labels and browser
        # callbacks alone would not prove its four voices actually differ.
        page = browser.new_page()
        page.goto(url)
        native = page.evaluate("""async () => {
          const { AudioEngine } = await import('./js/audio-engine.js');
          const result = [];
          for (const [id, hz] of [['i6-turbo',150],['v8-muscle',200],['v10-supercar',250],['v12-gt',300]]) {
            const engine = new AudioEngine(id);
            const ctx = new OfflineAudioContext(1, 96000, 48000);
            engine.ctx = ctx; engine.master = ctx.createGain(); engine.master.connect(ctx.destination);
            engine.createFallback();
            engine.update({rpm:3000,load:0.7,overrun:0,volume:0.5,bass:0.7});
            const audio = (await ctx.startRendering()).getChannelData(0).subarray(48000);
            let peak = 0, sum = 0;
            const energy = frequency => {
              let re=0, im=0;
              for (let i=0; i<audio.length; i++) { re+=audio[i]*Math.cos(i*2*Math.PI*frequency/48000); im+=audio[i]*Math.sin(i*2*Math.PI*frequency/48000); }
              return re*re+im*im;
            };
            for (const x of audio) { peak=Math.max(peak,Math.abs(x)); sum+=x*x; }
            result.push({id, peak, rms:Math.sqrt(sum/audio.length), ratio:energy(hz)/Math.max(1e-12,energy(hz+11))});
          }
          return result;
        }""")
        for signal in native:
            assert 0.01 < signal['rms'] and signal['peak'] < 0.96 and signal['ratio'] > 100, signal
            print('PASS native preset signal', signal['id'])
        page.close()

        # Module failure and cancellation during asynchronous startup use actual
        # AudioContexts; only the external module loading boundary is controlled.
        for mode in ('reject', 'delay', 'gps-delay'):
            page = browser.new_page()
            extra = """
      const nativeWorklet = this.audioWorklet;
      Object.defineProperty(this, 'audioWorklet', { value: {
        addModule: (...args) => MODE === 'gps-delay' ? new Promise(resolve => { window.__releaseWorklet = resolve; }).then(() => nativeWorklet.addModule(...args))
          : MODE === 'reject' ? Promise.reject(new Error('module unavailable'))
          : new Promise(resolve => setTimeout(resolve, 500)).then(() => nativeWorklet.addModule(...args))
      }});
""".replace('MODE', json.dumps(mode))
            page.add_init_script(instrument.replace('window.__contexts.push(this);', 'window.__contexts.push(this);' + extra))
            page.goto(url)
            if mode != 'gps-delay':
                page.click('#test')
            page.click('#start')
            if mode == 'gps-delay':
                assert page.evaluate('window.__watches === 1'), 'GPS was gated on async audio startup'
                page.evaluate('window.__fix(0)')
                check(page, "document.querySelector('#gpsReceived').textContent === '1 / 1'", "GPS receives data while audio is still loading")
                check(page, "document.querySelector('#gpsSummary').textContent.includes('GPS-Geschwindigkeit aktiv')", "GPS status is visible beside engine controls")
                page.evaluate('window.__releaseWorklet()')
                check(page, "document.querySelector('#status').textContent.includes('Motor läuft')", "audio starts after independent GPS")
                check(page, "document.querySelector('#driveState').textContent.includes('Stand')", "audio startup preserves earlier GPS measurements")
                page.click('#stop')
                check(page, "window.__contexts.every(ctx => ctx.state === 'closed') && window.__clears === 1", "GPS acquired during startup closes cleanly")
            elif mode == 'delay':
                page.click('#stop')
                check(page, "window.__contexts.every(ctx => ctx.state === 'closed') && !document.querySelector('#start').disabled", "stop cancels pending Worklet startup")
                page.wait_for_timeout(700)
                check(page, "window.__contexts.every(ctx => ctx.state === 'closed') && document.querySelector('#status').textContent === 'Motor gestoppt'", "cancelled startup cannot resurrect engine")
            else:
                check(page, "document.querySelector('#audioBackend').textContent.includes('Kompatibilität')", "Worklet module rejection recovers to native audio")
                page.click('#stop')
                check(page, "window.__contexts.every(ctx => ctx.state === 'closed')", "failed-module fallback closes cleanly")
            page.close()
        browser.close()
finally:
    server.shutdown()
