export const GPS_LIMITS = Object.freeze({ maxAgeMs: 5000, futureToleranceMs: 100, maxPositionAccuracy: 250, positionWindowMs: 10000 });
const finite = value => typeof value === 'number' && Number.isFinite(value);

// coords.accuracy is a horizontal POSITION uncertainty, not a speed error.
// Keep raw reception diagnostics even when a measurement cannot be used.
export function readGPSPosition(position, now, wallTime = Date.now()) {
  const c = position?.coords;
  const timestampKnown = finite(position?.timestamp) && position.timestamp > 0;
  const age = timestampKnown ? wallTime - position.timestamp : null;
  const accuracy = finite(c?.accuracy) && c.accuracy >= 0 ? c.accuracy : null;
  const diagnostic = (age === null ? 'Messzeit unbekannt · Empfangszeit verwendet' : `Messwertalter ${(Math.max(0, age) / 1000).toFixed(1)} s`)
    + (accuracy === null ? ' · Positionsgenauigkeit unbekannt' : ` · Position ±${Math.round(accuracy)} m`);
  const result = { fix: null, position: null, base: null, error: null, diagnostic };
  if (!c || !finite(now) || !finite(wallTime)) return { ...result, error: 'GPS: ungültiger Standortdatensatz.' };
  if (age !== null && age > GPS_LIMITS.maxAgeMs) return { ...result, error: `GPS: Messwert zu alt (${(age / 1000).toFixed(1)} s; Grenze ${GPS_LIMITS.maxAgeMs / 1000} s).` };
  if (age !== null && age < -GPS_LIMITS.futureToleranceMs) return { ...result, error: `GPS: Zeitstempel liegt ${(-age / 1000).toFixed(1)} s in der Zukunft.` };
  const base = { timestamp: timestampKnown ? now - age : now, accuracy, timeEstimated: !timestampKnown };
  result.base = base;
  if ([c.latitude, c.longitude].every(finite) && Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180
    && accuracy !== null && accuracy <= GPS_LIMITS.maxPositionAccuracy) {
    result.position = { latitude: c.latitude, longitude: c.longitude, accuracy, timestamp: base.timestamp, timeEstimated: base.timeEstimated };
  }
  if (finite(c.speed) && c.speed >= 0 && c.speed <= 90) {
    result.fix = { ...base, speed: c.speed, source: 'speed' };
  } else if (!result.position) {
    result.error = `GPS empfangen, aber keine nutzbare Geschwindigkeit oder Positionsgenauigkeit. ${diagnostic}`;
  }
  return result;
}
