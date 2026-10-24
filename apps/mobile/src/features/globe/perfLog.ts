/**
 * AC-1 measurement log. On for development and for preview builds
 * (EXPO_PUBLIC_PERF_LOG=1 in eas.json); off in production.
 *
 * AC-1 counts from process start, which JS can't see. The log carries a
 * wall-clock timestamp to pair with the process start time from
 * `adb shell am start -W` (or the "Displayed" line in logcat), plus React
 * Native's own startup timing when the runtime provides it.
 */
const enabled = __DEV__ || process.env.EXPO_PUBLIC_PERF_LOG === '1';

const mountedAt = { wall: 0, mono: 0 };

export function markGlobeMounted() {
  mountedAt.wall = Date.now();
  mountedAt.mono = performance.now();
}

export function logGlobeReady() {
  if (!enabled) return;
  const startup = (performance as { rnStartupTiming?: { startTime?: number } }).rnStartupTiming;
  const sinceMount = mountedAt.mono ? Math.round(performance.now() - mountedAt.mono) : -1;
  console.log(
    `[perf] globe-ready wallClockMs=${Date.now()} sinceScreenMountMs=${sinceMount}` +
      (startup?.startTime ? ` rnStartupStart=${Math.round(startup.startTime)}` : ''),
  );
}

/** Sprint 1 AC-1: keystroke to the frame that shows that query's results. */
export function logSearchResults(query: string, ms: number) {
  if (!enabled) return;
  console.log(`[perf] search-results ms=${Math.round(ms)} length=${query.length}`);
}
