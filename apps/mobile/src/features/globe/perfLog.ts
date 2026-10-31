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

/** Sprint 12 AC-6 (Raz): the launch overlay has left; gfxinfo is read right after. */
export function logLaunchGone() {
  if (!enabled) return;
  console.log(`[launch] gone wallClockMs=${Date.now()}`);
}

export function logGlobeReady(reason: 'idle' | 'fallback' = 'idle') {
  if (!enabled) return;
  const startup = (performance as { rnStartupTiming?: { startTime?: number } }).rnStartupTiming;
  const sinceMount = mountedAt.mono ? Math.round(performance.now() - mountedAt.mono) : -1;
  console.log(
    `[perf] globe-ready wallClockMs=${Date.now()} sinceScreenMountMs=${sinceMount} reason=${reason}` +
      (startup?.startTime ? ` rnStartupStart=${Math.round(startup.startTime)}` : ''),
  );
}

let myTripsOpenedAt = 0;

/** Sprint 2 AC-10: the tap on "My trips" (design 17.5). */
export function markMyTripsOpened() {
  myTripsOpenedAt = performance.now();
}

/**
 * Sprint 2 AC-10: from the tap until the first page of both sections (or the
 * empty or error state) is on screen. Logged once per opening.
 */
export function logMyTripsShown(state: 'rows' | 'empty' | 'error' | 'offline') {
  if (!enabled || !myTripsOpenedAt) return;
  const ms = Math.round(performance.now() - myTripsOpenedAt);
  myTripsOpenedAt = 0;
  console.log(`[perf] my-trips-shown ms=${ms} state=${state}`);
}

/** Sprint 1 AC-1: keystroke to the frame that shows that query's results. */
export function logSearchResults(query: string, ms: number) {
  if (!enabled) return;
  console.log(`[perf] search-results ms=${Math.round(ms)} length=${query.length}`);
}

/** Sprint 9 AC-11: the discovery computation; counts only, no month, type or countries (design 19.9). */
export function logDiscover(ms: number, chips: number, results: number) {
  if (!enabled) return;
  console.log(`[perf] discover_compute_ms=${Math.round(ms)} chips=${chips} results=${results}`);
}

/**
 * Sprint 13 AC-9 (spec 11.1, 300ms): from the tap to the first layout of what
 * it opens. A mark older than 5s is a tap that opened nothing new; dropped.
 */
export type Transition = 'card' | 'trip' | 'itinerary' | 'flight' | 'places';
const transitions = new Map<Transition, number>();

/** `at`: when the tap began, if the mark is set later (Raz: only once it opens something). */
export function markTransition(name: Transition, at = performance.now()) {
  if (!enabled) return;
  transitions.set(name, at);
}

export function logTransition(name: Transition) {
  if (!enabled) return;
  const start = transitions.get(name);
  if (start === undefined) return;
  transitions.delete(name);
  const ms = Math.round(performance.now() - start);
  if (ms <= 5000) console.log(`[perf] transition ${name} ms=${ms}`);
}

/**
 * Sprint 13 AC-3: the first flight sheet of this run (a cold start from an
 * alert), paired with the tap time from adb; later sheets aren't logged (Raz 3).
 */
let flightSheetLogged = false;
export function logFlightSheetShown() {
  if (!enabled || flightSheetLogged) return;
  flightSheetLogged = true;
  console.log(`[perf] flight-sheet wallClockMs=${Date.now()}`);
}
