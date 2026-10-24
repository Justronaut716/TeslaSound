// Bluetooth pairing and speaker routing belong to the phone's OS. This class
// only manages browser playback capabilities and keeps the visible screen awake.
export class PhonePlaybackSession {
  constructor({ wakeLock, audioSession, visible, report }) {
    this.wakeLock = wakeLock; this.audioSession = audioSession;
    this.visible = visible; this.report = report;
    this.active = false; this.lock = null; this.pending = null;
    this.generation = 0; this.previousType = null;
  }

  activate() {
    if (!this.active) {
      this.active = true;
      try {
        if (this.audioSession) {
          this.previousType = this.audioSession.type;
          this.audioSession.type = 'playback';
        }
      } catch { /* Optional Safari API; Web Audio remains usable without it. */ }
    }
    return this.ensureAwake();
  }

  async ensureAwake() {
    if (!this.active || this.lock) return;
    if (this.pending) return this.pending;
    if (!this.visible()) { this.report('Bildschirmschutz pausiert · Website im Vordergrund lassen.'); return; }
    if (!this.wakeLock) { this.report('Bitte den Bildschirm aktiv lassen · Bildschirmschutz nicht unterstützt.'); return; }
    const generation = this.generation;
    const request = async () => {
      try {
        const lock = await this.wakeLock.request('screen');
        if (!this.active || generation !== this.generation || !this.visible()) { await lock.release(); return; }
        this.lock = lock;
        lock.addEventListener('release', () => {
          if (this.lock !== lock) return;
          this.lock = null;
          if (this.active) this.report('Bildschirmschutz pausiert · Bitte den Bildschirm aktiv lassen.');
        });
        this.report('Bildschirm bleibt während der Wiedergabe an.');
      } catch {
        if (this.active && generation === this.generation) this.report('Bitte den Bildschirm aktiv lassen · Bildschirmschutz nicht verfügbar.');
      }
    };
    this.pending = request();
    try { await this.pending; }
    finally {
      this.pending = null;
      // A previous activation can still be awaiting permission when restarted.
      if (this.active && generation !== this.generation) void this.ensureAwake();
    }
  }

  async deactivate() {
    this.active = false; this.generation++;
    const lock = this.lock; this.lock = null;
    try { if (this.audioSession && this.previousType !== null) this.audioSession.type = this.previousType; }
    catch { /* Optional browser capability. */ }
    this.previousType = null;
    this.report('Bildschirmschutz wird beim Motorstart aktiviert, sofern verfügbar.');
    if (lock) await lock.release().catch(() => {});
  }
}
