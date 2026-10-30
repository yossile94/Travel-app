/**
 * Sprint 12 design 1.4 (Raz 9): the globe tells the launch overlay it is ready,
 * or that it never will be. A module-level emitter and not a context: the
 * overlay sits beside the screens, not above them. A signal sent before the
 * overlay subscribes is kept and delivered on subscribe.
 */
export type LaunchSignal = 'ready' | 'error';

let pending: LaunchSignal | null = null;
let listener: ((signal: LaunchSignal) => void) | null = null;

export const launchSignals = {
  send(signal: LaunchSignal): void {
    if (listener) listener(signal);
    else pending ??= signal;
  },
  subscribe(next: (signal: LaunchSignal) => void): () => void {
    listener = next;
    if (pending) {
      const signal = pending;
      pending = null;
      next(signal);
    }
    return () => {
      if (listener === next) listener = null;
    };
  },
};

/** Design 1.5: shown once while the JS lives; a warm start shows no overlay. */
let shown = false;
export const launchShown = {
  get: (): boolean => shown,
  mark: (): void => {
    shown = true;
  },
};

/** Tests start each case from a cold launch. */
export function resetLaunchForTests(): void {
  pending = null;
  listener = null;
  shown = false;
}
