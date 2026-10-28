import * as Notifications from 'expo-notifications';

import {
  cancelAllInsuranceReminders,
  pruneInsuranceReminders,
  reminderAt,
  reminderTripOf,
  syncInsuranceReminder,
} from './insuranceReminder';

const n = jest.mocked(Notifications);
const text = {
  title: 'אין ביטוח לנסיעה לתאילנד',
  body: 'b',
  channel: { name: 'n', description: 'd' },
};
const trip = { id: '10000000-0000-4000-8000-000000000001', startDate: '2027-01-10' };
const now = new Date('2026-12-01T10:00:00');

beforeEach(() => {
  jest.clearAllMocks();
  n.getPermissionsAsync.mockResolvedValue({ granted: true } as never);
});

describe('the insurance reminder (AC-10, design 11)', () => {
  it('fires at 09:00 a week before departure', () => {
    const at = reminderAt('2027-01-10', now)!;
    expect([at.getFullYear(), at.getMonth() + 1, at.getDate(), at.getHours()]).toEqual([
      2027, 1, 3, 9,
    ]);
  });

  it('no reminder for a trip created less than a week before departure', () => {
    expect(reminderAt('2026-12-05', now)).toBeNull();
  });

  it('schedules one per trip, with its fixed id, channel and payload', async () => {
    expect(await syncInsuranceReminder(trip, false, text, now)).toBe('scheduled');
    expect(n.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        identifier: `insurance-reminder:${trip.id}`,
        content: expect.objectContaining({
          data: { v: 1, type: 'insurance_reminder', tripId: trip.id },
        }),
        trigger: expect.objectContaining({ channelId: 'trip-reminders' }),
      }),
    );
  });

  it('insurance added: cancelled, not scheduled', async () => {
    expect(await syncInsuranceReminder(trip, true, text, now)).toBe('cancelled');
    expect(n.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      `insurance-reminder:${trip.id}`,
    );
    expect(n.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('never asks for permission: without it, nothing is scheduled', async () => {
    n.getPermissionsAsync.mockResolvedValue({ granted: false } as never);
    expect(await syncInsuranceReminder(trip, false, text, now)).toBe('skipped');
    expect(n.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(n.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('prunes reminders of insured trips, and of trips gone from a complete list', async () => {
    n.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'insurance-reminder:a' },
      { identifier: 'insurance-reminder:b' },
      { identifier: 'insurance-reminder:c' },
      { identifier: 'other' },
    ] as never);
    const trips = new Map([
      ['a', { insured: true }],
      ['b', { insured: false }],
    ]);
    await pruneInsuranceReminders(trips, true);
    expect(n.cancelScheduledNotificationAsync.mock.calls.map((c) => c[0])).toEqual([
      'insurance-reminder:a',
      'insurance-reminder:c',
    ]);
  });

  it("an incomplete list never cancels a trip just because it isn't there", async () => {
    n.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'insurance-reminder:c' },
    ] as never);
    await pruneInsuranceReminders(new Map(), false);
    expect(n.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('sign-out cancels every reminder', async () => {
    n.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'insurance-reminder:a' },
      { identifier: 'other' },
    ] as never);
    await cancelAllInsuranceReminders();
    expect(n.cancelScheduledNotificationAsync.mock.calls).toEqual([['insurance-reminder:a']]);
  });

  it("reads a tapped reminder's trip, and nothing else", () => {
    const response = (data: unknown) =>
      ({ notification: { request: { content: { data } } } }) as never;
    expect(reminderTripOf(response({ v: 1, type: 'insurance_reminder', tripId: 't1' }))).toBe('t1');
    expect(reminderTripOf(response({ v: 1, type: 'flight_change', flightId: 'f' }))).toBeNull();
  });
});
