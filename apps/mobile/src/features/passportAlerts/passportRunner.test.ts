// Sprint 10 AC-12, AC-13, AC-6 (Dana): when the passports are checked, and
// that a save in the wallet never reaches the network (Dana bug 1).
import type { Holder } from '@/features/passport/passportModel';

import {
  passportTripsLoaded,
  resetPassportRunnerForTests,
  startPassportAlerts,
  wipePassportDevice,
} from './passportRunner';

const mockDestination = {
  advisories: new Map([['THA', { passportValidityMonths: 6 }]]),
};
jest.mock('@/features/destination/destinationData', () => ({
  loadDestination: jest.fn(async () => mockDestination),
  cachedDestination: jest.fn(async () => mockDestination),
}));
const holder: Holder = {
  id: 'me',
  isMe: true,
  name: '',
  expiry: '2027-01-01',
  last4: null,
  hasPhoto: false,
};
const mockPassports = {
  listeners: [] as ((h: Holder[]) => void)[],
};
jest.mock('@/features/passport/passportStore', () => ({
  onPassportsChanged: jest.fn((l: (h: Holder[]) => void) => {
    mockPassports.listeners.push(l);
    return () => {
      mockPassports.listeners = mockPassports.listeners.filter((x) => x !== l);
    };
  }),
  passportsSnapshot: jest.fn(() => ({ status: 'ready', holders: [holder] })),
  loadPassports: jest.fn(async () => {}),
  wipePassports: jest.fn(async () => {}),
}));
jest.mock('./passportAlerts', () => ({
  cancelAllPassportAlerts: jest.fn(async () => {}),
  checkTripPassports: jest.fn(async () => []),
  syncExpiryReminders: jest.fn(async () => {}),
}));

const destination = jest.requireMock<Record<'loadDestination' | 'cachedDestination', jest.Mock>>(
  '@/features/destination/destinationData',
);
const store = jest.requireMock<Record<'onPassportsChanged' | 'wipePassports', jest.Mock>>(
  '@/features/passport/passportStore',
);
const alerts =
  jest.requireMock<
    Record<'cancelAllPassportAlerts' | 'checkTripPassports' | 'syncExpiryReminders', jest.Mock>
  >('./passportAlerts');

const trip = {
  id: '10000000-0000-4000-8000-000000000001',
  countryAdm0: 'THA',
  startDate: '2026-12-20',
  endDate: '2027-01-03',
  travelers: [],
};
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  resetPassportRunnerForTests();
  mockPassports.listeners = [];
});

describe('the passport runner', () => {
  it('a trips load checks the trips with the country rule, then plans the reminders', async () => {
    await passportTripsLoaded([trip]);
    expect(destination.loadDestination).toHaveBeenCalled();
    const [trips, holders, monthsOf] = alerts.checkTripPassports.mock.calls[0]!;
    expect(trips).toEqual([trip]);
    expect(holders).toEqual([holder]);
    expect(monthsOf('THA')).toBe(6);
    expect(alerts.syncExpiryReminders).toHaveBeenCalledWith([holder], expect.any(Object));
    expect(alerts.checkTripPassports.mock.invocationCallOrder[0]).toBeLessThan(
      alerts.syncExpiryReminders.mock.invocationCallOrder[0]!,
    );
  });

  it('a save in the wallet reads the cached country rules only: no network (Dana bug 1)', async () => {
    startPassportAlerts();
    await passportTripsLoaded([trip]);
    jest.clearAllMocks();
    mockPassports.listeners.forEach((l) => l([holder]));
    await settle();
    await settle();
    expect(destination.cachedDestination).toHaveBeenCalled();
    expect(destination.loadDestination).not.toHaveBeenCalled();
    expect(alerts.checkTripPassports).toHaveBeenCalledTimes(1);
    expect(alerts.syncExpiryReminders).toHaveBeenCalledTimes(1);
  });

  it('before any trips load, a save plans the reminders but checks no trip', async () => {
    startPassportAlerts();
    mockPassports.listeners.forEach((l) => l([holder]));
    await settle();
    await settle();
    expect(alerts.checkTripPassports).not.toHaveBeenCalled();
    expect(alerts.syncExpiryReminders).toHaveBeenCalledTimes(1);
  });

  it('starts listening once, however many times the root mounts', () => {
    startPassportAlerts();
    startPassportAlerts();
    expect(store.onPassportsChanged).toHaveBeenCalledTimes(1);
  });

  it('wiping cancels the notifications, then the passports; later saves check no trip (AC-6)', async () => {
    await passportTripsLoaded([trip]);
    await wipePassportDevice();
    expect(alerts.cancelAllPassportAlerts).toHaveBeenCalled();
    expect(store.wipePassports).toHaveBeenCalled();
    expect(alerts.cancelAllPassportAlerts.mock.invocationCallOrder[0]).toBeLessThan(
      store.wipePassports.mock.invocationCallOrder[0]!,
    );
    jest.clearAllMocks();
    startPassportAlerts();
    mockPassports.listeners.forEach((l) => l([holder]));
    await settle();
    await settle();
    expect(alerts.checkTripPassports).not.toHaveBeenCalled();
  });

  it('one failing run does not stop the next', async () => {
    alerts.checkTripPassports.mockRejectedValueOnce(new Error('boom'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await passportTripsLoaded([trip]);
    await passportTripsLoaded([trip]);
    expect(alerts.checkTripPassports).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('[passport] alerts failed', 'Error');
    warn.mockRestore();
  });
});
