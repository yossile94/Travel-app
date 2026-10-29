// Sprint 10 AC-12, AC-13 (D9, design 7): the passport's local notifications —
// once per state, no date, no number, no name in them, and never a moment
// already past.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import type { Holder } from '@/features/passport/passportModel';

import {
  cancelAllPassportAlerts,
  checkTripPassports,
  passportOpenOf,
  reminderPlan,
  syncExpiryReminders,
  type PassportTexts,
} from './passportAlerts';

const n = jest.mocked(Notifications);
const me = (expiry: string | null): Holder => ({
  id: 'me',
  isMe: true,
  name: '',
  expiry,
  last4: '1234',
  hasPhoto: false,
});
const noa: Holder = {
  id: '0f0e0d0c-0000-4000-8000-000000000001',
  isMe: false,
  name: 'Noa',
  expiry: '2029-01-01',
  last4: null,
  hasPhoto: false,
};
const thailand = {
  id: '10000000-0000-4000-8000-000000000001',
  countryAdm0: 'THA',
  startDate: '2026-12-20',
  endDate: '2027-01-03',
  travelers: [],
};
const texts: PassportTexts = {
  channel: 'Passport expiry',
  tripRed: () => ({ title: 'red', body: 'open the trip' }),
  tripOrange: (_t, months) => ({ title: 'orange', body: `fewer than ${months}` }),
  soon: (months, isMe) => ({ title: `${isMe ? 'mine' : 'other'} ${months}`, body: 'check' }),
};
const none = () => undefined;
const now = new Date('2026-10-28T12:00:00');

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  n.getPermissionsAsync.mockResolvedValue({ granted: true } as never);
});

const sentIds = () => n.scheduleNotificationAsync.mock.calls.map(([req]) => req.identifier);

describe('a trip against the passports (AC-12)', () => {
  it('orange at once, on the passport channel, with the trip only in the data (Dana: Thailand)', async () => {
    const sent = await checkTripPassports([thailand], [me('2027-06-01')], none, none, texts, now);
    expect(sent).toEqual([thailand.id]);
    const [req] = n.scheduleNotificationAsync.mock.calls[0]!;
    expect(req).toMatchObject({
      identifier: `passport-trip:${thailand.id}`,
      content: {
        title: 'orange',
        body: 'fewer than 6',
        data: { v: 1, type: 'passport_trip', tripId: thailand.id },
      },
      trigger: { channelId: 'passport' },
    });
    expect(JSON.stringify(req)).not.toMatch(/2027-06-01|1234/);
  });

  it('once per state: the same state again sends nothing; worse sends again', async () => {
    await checkTripPassports([thailand], [me('2027-06-01')], none, none, texts, now);
    await checkTripPassports([thailand], [me('2027-06-01')], none, none, texts, now);
    expect(n.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    await checkTripPassports([thailand], [me('2026-12-01')], none, none, texts, now);
    expect(n.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(n.scheduleNotificationAsync.mock.calls[1]![0].content.title).toBe('red');
  });

  it('back to fine: the shown notification goes, and a later problem is told again', async () => {
    await checkTripPassports([thailand], [me('2027-06-01')], none, none, texts, now);
    await checkTripPassports([thailand], [me('2030-01-01')], none, none, texts, now);
    expect(n.dismissNotificationAsync).toHaveBeenCalledWith(`passport-trip:${thailand.id}`);
    await checkTripPassports([thailand], [me('2027-06-01')], none, none, texts, now);
    expect(n.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('a deleted trip: its shown notification goes with its record (Dana bug 3)', async () => {
    await checkTripPassports([thailand], [me('2027-06-01')], none, none, texts, now);
    n.dismissNotificationAsync.mockClear();
    await checkTripPassports([], [me('2027-06-01')], none, none, texts, now);
    expect(n.dismissNotificationAsync).toHaveBeenCalledWith(`passport-trip:${thailand.id}`);
    expect(await AsyncStorage.getItem('passport.lastNotified')).toBe('{}');
  });

  it("the country's rule: 0 months and valid on the return day is fine (Dana)", async () => {
    const zero = (adm0: string) => (adm0 === 'THA' ? 0 : null);
    expect(
      await checkTripPassports([thailand], [me('2027-01-04')], zero, none, texts, now),
    ).toEqual([]);
  });

  it('without permission nothing is sent, and nothing is marked as told (AC-12)', async () => {
    n.getPermissionsAsync.mockResolvedValue({ granted: false } as never);
    expect(
      await checkTripPassports([thailand], [me('2027-06-01')], none, none, texts, now),
    ).toEqual([]);
    expect(n.requestPermissionsAsync).not.toHaveBeenCalled();
    n.getPermissionsAsync.mockResolvedValue({ granted: true } as never);
    expect(
      await checkTripPassports([thailand], [me('2027-06-01')], none, none, texts, now),
    ).toEqual([thailand.id]);
  });
});

describe('9, 6 and 3 months before (AC-13)', () => {
  it('09:00 local on each day still ahead', () => {
    const plan = reminderPlan('2027-08-15', now);
    expect(plan.map((p) => p.months)).toEqual([9, 6, 3]);
    const at = plan[0]!.at;
    expect([at.getFullYear(), at.getMonth() + 1, at.getDate(), at.getHours()]).toEqual([
      2026, 11, 15, 9,
    ]);
  });

  it('a moment already past is not planned (D9)', () => {
    expect(reminderPlan('2027-03-01', now).map((p) => p.months)).toEqual([3]);
  });

  it('cancels the old ones and plans again; "me" and others say different things, no name', async () => {
    n.getAllScheduledNotificationsAsync.mockResolvedValueOnce([
      { identifier: 'passport-expiry:me:9' },
      { identifier: 'insurance-reminder:x' },
    ] as never);
    const count = await syncExpiryReminders([me('2027-08-15'), noa], texts, now);
    expect(n.cancelScheduledNotificationAsync).toHaveBeenCalledWith('passport-expiry:me:9');
    expect(n.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('insurance-reminder:x');
    expect(count).toBe(6);
    expect(sentIds()).toContain(`passport-expiry:${noa.id}:3`);
    const other = n.scheduleNotificationAsync.mock.calls.find(([r]) =>
      r.identifier!.startsWith(`passport-expiry:${noa.id}`),
    )!;
    expect(other[0].content.title).toBe('other 9');
    expect(JSON.stringify(other[0].content)).not.toContain('Noa');
  });

  it('nothing without permission', async () => {
    n.getPermissionsAsync.mockResolvedValue({ granted: false } as never);
    expect(await syncExpiryReminders([me('2027-08-15')], texts, now)).toBe(0);
  });
});

describe('sign-out and taps (D9, design 7.3)', () => {
  it('sign-out cancels every passport notification and the record', async () => {
    await AsyncStorage.setItem('passport.lastNotified', '{"x":"red"}');
    n.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'passport-expiry:me:3' },
      { identifier: 'insurance-reminder:x' },
    ] as never);
    await cancelAllPassportAlerts();
    expect(n.cancelScheduledNotificationAsync).toHaveBeenCalledWith('passport-expiry:me:3');
    expect(n.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('insurance-reminder:x');
    expect(await AsyncStorage.getItem('passport.lastNotified')).toBeNull();
  });

  it('reads a tap', () => {
    const tap = (data: unknown) => ({ notification: { request: { content: { data } } } }) as never;
    expect(passportOpenOf(tap({ v: 1, type: 'passport_trip', tripId: 't' }))).toEqual({
      type: 'trip',
      tripId: 't',
    });
    expect(passportOpenOf(tap({ v: 1, type: 'passport_expiry' }))).toEqual({ type: 'expiry' });
    expect(passportOpenOf(tap({ v: 2, type: 'passport_expiry' }))).toBeNull();
    expect(passportOpenOf(tap({ v: 1, type: 'flight_delay' }))).toBeNull();
  });
});
