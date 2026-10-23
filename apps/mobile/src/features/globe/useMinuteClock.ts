import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { millisecondsToNextMinute } from './localTime';

/**
 * The current time, re-rendered exactly on each minute boundary (not on a
 * fixed interval, so the card never shows a minute late) and as soon as the
 * app returns to the foreground.
 */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, millisecondsToNextMinute(new Date()));
    };
    schedule();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      clearTimeout(timer);
      setNow(new Date());
      schedule();
    });

    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return now;
}
