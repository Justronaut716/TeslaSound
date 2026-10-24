import test from 'node:test';
import assert from 'node:assert/strict';
import { PhonePlaybackSession } from '../js/phone-playback.js';

test('phone playback remains usable when screen wake lock is unavailable or denied', async () => {
  for (const wakeLock of [undefined, { request: async () => { throw new Error('denied'); } }]) {
    let status;
    const audioSession = { type: 'auto' };
    const session = new PhonePlaybackSession({ wakeLock, audioSession, visible: () => true, report: value => { status = value; } });
    await session.activate();
    assert.equal(audioSession.type, 'playback');
    assert(status.includes('Bildschirm aktiv lassen'));
    await session.deactivate();
    assert.equal(audioSession.type, 'auto');
  }
});

test('stopping while a wake-lock request is pending releases its late result', async () => {
  let resolveLock, released = false;
  const pending = new Promise(resolve => { resolveLock = resolve; });
  const session = new PhonePlaybackSession({ wakeLock: { request: () => pending }, visible: () => true, report: () => {} });
  const starting = session.activate();
  await session.deactivate();
  resolveLock({ release: async () => { released = true; }, addEventListener() {} });
  await starting;
  assert(released, 'late wake lock leaked after stop');
});

test('phone session deduplicates wake-lock requests and restores audio category on stop', async () => {
  let requests = 0, releases = 0;
  const audioSession = { type: 'ambient' };
  const session = new PhonePlaybackSession({
    wakeLock: { request: async () => { requests++; return { release: async () => { releases++; }, addEventListener() {} }; } },
    audioSession, visible: () => true, report: () => {}
  });
  await Promise.all([session.activate(), session.ensureAwake()]);
  await session.ensureAwake();
  assert.equal(requests, 1);
  await session.deactivate();
  assert.equal(releases, 1);
  assert.equal(audioSession.type, 'ambient');
});
