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
            check(page, "document.querySelector('#gps').textContent.includes('verworfen')", "old fixes are rejected")
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
            page.close()

        # Module failure and cancellation during asynchronous startup use actual
        # AudioContexts; only the external module loading boundary is controlled.
        for mode in ('reject', 'delay'):
            page = browser.new_page()
            extra = """
      const nativeWorklet = this.audioWorklet;
      Object.defineProperty(this, 'audioWorklet', { value: {
        addModule: (...args) => MODE === 'reject' ? Promise.reject(new Error('module unavailable'))
          : new Promise(resolve => setTimeout(resolve, 500)).then(() => nativeWorklet.addModule(...args))
      }});
""".replace('MODE', json.dumps(mode))
            page.add_init_script(instrument.replace('window.__contexts.push(this);', 'window.__contexts.push(this);' + extra))
            page.goto(url)
            page.click('#test')
            page.click('#start')
            if mode == 'delay':
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
