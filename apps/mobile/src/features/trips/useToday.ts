/**
 * Today's local date, kept current while the app is open (sprint 3 AC-6,
 * design 3.4): a timer to the next local midnight, and a check whenever the
 * app returns to the front. One event, "the day changed", drives the status
 * tags, the pin and the active-trip decision.
 */
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { todayPg } from './tripDates';

/** Milliseconds from `now` to just after the next local midnight. */
export function msToNextMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  return next.getTime() - now.getTime();
}

export function useToday(): string {
  const [today, setToday] = useState(todayPg);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        setToday(todayPg());
        schedule();
      }, msToNextMidnight(new Date()));
    };
    schedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setToday(todayPg());
      clearTimeout(timer);
      schedule();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  return today;
}
