// Sprint 10 F-025, F-026 (design 3–6): the wallet on the device, its screens,
// and the banners in the trip kit. SecureStore and the native vault are
// stand-ins: the device keeps everything in memory here.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';
import { PassportBanners } from '@/features/kit/PassportBanners';

import { PassportsScreen } from './PassportScreens';
import {
  deleteHolder,
  dismissedReminders,
  loadPassports,
  resetPassportsForTests,
  saveHolder,
  wipePassports,
} from './passportStore';
import { vault } from './vault';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: () => `0f0e0d0c-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [null, jest.fn()],
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));

const mockSecure = { value: true };
jest.mock('./vault', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    vaultAvailable: true,
    SecureWindow: View,
    vault: {
      isDeviceSecure: jest.fn(async () => mockSecure.value),
      reconcile: jest.fn(async () => ({ secure: mockSecure.value, reset: false })),
      clearCaptures: jest.fn(async () => undefined),
      recognize: jest.fn(),
      savePhoto: jest.fn(async () => undefined),
      discard: jest.fn(async () => undefined),
      openPhoto: jest.fn(async () => ({ ok: false, error: 'cancelled' })),
      hasPhoto: jest.fn(async () => false),
      deletePhoto: jest.fn(async () => undefined),
      wipe: jest.fn(async () => undefined),
    },
  };
});

// The first render loads the screens' modules: slower than the 5 s default on CI.
jest.setTimeout(20_000);

const base = { colorScheme: 'light' as const, insetsTop: 0, insetsBottom: 0 };
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

beforeEach(async () => {
  mockStore.clear();
  mockSecure.value = true;
  resetPassportsForTests();
  jest.clearAllMocks();
  await loadPassports();
});

describe('the device store (AC-1, AC-4, AC-6)', () => {
  it('keeps a holder in SecureStore, with 4 digits at most, and reads it back', async () => {
    await saveHolder({
      id: 'me',
      isMe: true,
      name: 'x',
      expiry: '2029-03-14',
      last4: '1234',
      hasPhoto: false,
    });
    resetPassportsForTests();
    await loadPassports();
    const stored = JSON.parse(mockStore.get('passport.h.me')!);
    expect(stored).toEqual({ name: '', expiry: '2029-03-14', last4: '1234', hasPhoto: false });
    expect(JSON.parse(mockStore.get('passport.index')!)).toEqual(['me']);
  });

  it('never stores an id that could be a path', async () => {
    await expect(
      saveHolder({
        id: '../x',
        isMe: false,
        name: 'a',
        expiry: null,
        last4: null,
        hasPhoto: false,
      }),
    ).rejects.toThrow();
  });

  it('a delete removes the details and the photo; wipe removes all and the key', async () => {
    const id = '0f0e0d0c-0000-4000-8000-0000000000aa';
    await saveHolder({ id, isMe: false, name: 'Noa', expiry: null, last4: null, hasPhoto: true });
    await deleteHolder(id);
    expect(vault.deletePhoto).toHaveBeenCalledWith(id);
    expect(mockStore.has(`passport.h.${id}`)).toBe(false);
    await saveHolder({
      id: 'me',
      isMe: true,
      name: '',
      expiry: '2029-01-01',
      last4: null,
      hasPhoto: false,
    });
    await wipePassports();
    expect(vault.wipe).toHaveBeenCalled();
    expect([...mockStore.keys()]).toEqual([]);
  });

  it('a read that fails deletes nothing (design 3.4)', async () => {
    mockStore.set('passport.index', '["me"]');
    mockStore.set('passport.h.me', '{not json');
    resetPassportsForTests();
    await loadPassports();
    expect(mockStore.has('passport.h.me')).toBe(true);
  });
});

describe('the screens (design 3, 4, 5)', () => {
  it('"me" is always first; suggestions open a new passport with the name; save says so', async () => {
    const onToast = jest.fn();
    await render(
      <PassportsScreen
        {...base}
        suggestions={['Noa', 'Yoav']}
        onToast={onToast}
        onBack={jest.fn()}
      />,
    );
    expect(screen.getByTestId('passport-holder-me').props.accessibilityValue.text).toBe('no-date');
    await fireEvent.press(screen.getByTestId('passport-suggest-0'));
    await flush();
    expect(screen.getByTestId('passport-name').props.value).toBe('Noa');
    expect(screen.getByTestId('passport-notice')).toHaveTextContent(
      /הצילום נשמר רק במכשיר הזה ומוצפן/,
    );
    await fireEvent.changeText(screen.getByTestId('passport-last4'), 'AB12345678');
    expect(screen.getByTestId('passport-last4').props.value).toBe('5678');
    expect(screen.getByText('שמרנו רק את 4 הספרות האחרונות.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('passport-save'));
    await flush();
    expect(onToast).toHaveBeenCalledWith('שמרנו את הדרכון של Noa');
    expect(screen.getByText(/Noa/)).toBeOnTheScreen();
  });

  it('a name already on the list is refused', async () => {
    await saveHolder({
      id: '0f0e0d0c-0000-4000-8000-0000000000bb',
      isMe: false,
      name: 'Noa',
      expiry: null,
      last4: null,
      hasPhoto: false,
    });
    await render(
      <PassportsScreen {...base} suggestions={[]} onToast={jest.fn()} onBack={jest.fn()} />,
    );
    await fireEvent.press(screen.getByTestId('passport-add-person'));
    await flush();
    await fireEvent.changeText(screen.getByTestId('passport-name'), ' noa ');
    await fireEvent.press(screen.getByTestId('passport-save'));
    expect(screen.getByText('כבר יש ברשימה מישהו בשם הזה.')).toBeOnTheScreen();
  });

  it('a device with no screen lock keeps the date only (AC-4, D5)', async () => {
    mockSecure.value = false;
    await render(
      <PassportsScreen {...base} suggestions={[]} onToast={jest.fn()} onBack={jest.fn()} />,
    );
    await fireEvent.press(screen.getByTestId('passport-holder-me'));
    await flush();
    expect(screen.getByTestId('passport-no-lock')).toBeOnTheScreen();
    expect(screen.queryByTestId('passport-take')).toBeNull();
    expect(screen.queryByTestId('passport-last4')).toBeNull();
    expect(screen.queryByTestId('passport-notice')).toBeNull();
  });

  it('a lock removed later drops the photo and the 4 digits for everyone, and says so once (D5, Raz)', async () => {
    await saveHolder({
      id: 'me',
      isMe: true,
      name: '',
      expiry: '2029-01-01',
      last4: '1234',
      hasPhoto: true,
    });
    await saveHolder({
      id: '0f0e0d0c-0000-4000-8000-0000000000cc',
      isMe: false,
      name: 'Noa',
      expiry: null,
      last4: '9876',
      hasPhoto: true,
    });
    mockSecure.value = false;
    await render(
      <PassportsScreen {...base} suggestions={[]} onToast={jest.fn()} onBack={jest.fn()} />,
    );
    await flush();
    expect(
      screen.getByText('הנעילה במכשיר הוסרה, ולכן הצילום ו-4 הספרות נמחקו. תאריך התפוגה נשמר.'),
    ).toBeOnTheScreen();
    for (const key of ['passport.h.me', 'passport.h.0f0e0d0c-0000-4000-8000-0000000000cc']) {
      expect(JSON.parse(mockStore.get(key)!)).toMatchObject({ hasPhoto: false, last4: null });
    }
    expect(JSON.parse(mockStore.get('passport.h.me')!).expiry).toBe('2029-01-01');
  });

  it('delete asks first, then removes (AC-6)', async () => {
    const spy = jest.spyOn(Alert, 'alert');
    await saveHolder({
      id: 'me',
      isMe: true,
      name: '',
      expiry: '2029-01-01',
      last4: null,
      hasPhoto: false,
    });
    const onToast = jest.fn();
    await render(
      <PassportsScreen {...base} suggestions={[]} onToast={onToast} onBack={jest.fn()} />,
    );
    expect(screen.getByTestId('passport-holder-me').props.accessibilityValue.text).toBe('ok');
    await fireEvent.press(screen.getByTestId('passport-holder-me'));
    await flush();
    await fireEvent.press(screen.getByTestId('passport-delete'));
    const buttons = spy.mock.calls.at(-1)![2]!;
    await act(async () => buttons.find((b) => b.style === 'destructive')!.onPress!());
    await flush();
    expect(onToast).toHaveBeenCalledWith('מחקנו את הדרכון');
    expect(mockStore.has('passport.h.me')).toBe(false);
    spy.mockRestore();
  });

  it('the photo opens only through the vault; a lost key deletes it and explains (design 11)', async () => {
    await saveHolder({
      id: 'me',
      isMe: true,
      name: '',
      expiry: '2029-01-01',
      last4: '1234',
      hasPhoto: true,
    });
    jest.mocked(vault.openPhoto).mockResolvedValueOnce({ ok: false, error: 'invalidated' });
    await render(
      <PassportsScreen {...base} suggestions={[]} onToast={jest.fn()} onBack={jest.fn()} />,
    );
    await fireEvent.press(screen.getByTestId('passport-holder-me'));
    await flush();
    expect(screen.getByTestId('passport-photo-tile')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('passport-show'));
    await flush();
    expect(vault.openPhoto).toHaveBeenCalledWith(
      'me',
      expect.objectContaining({ title: 'פתיחת צילום הדרכון' }),
    );
    expect(vault.reconcile).toHaveBeenCalled();
    expect(screen.getByText('הצילום כבר לא זמין')).toBeOnTheScreen();
    expect(JSON.parse(mockStore.get('passport.h.me')!)).toMatchObject({
      hasPhoto: false,
      last4: '1234',
    });
  });
});

describe('the banners in the trip kit (AC-11, AC-14, design 6)', () => {
  const trip = {
    id: '10000000-0000-4000-8000-000000000001',
    countryAdm0: 'THA',
    startDate: '2026-12-20',
    endDate: '2027-01-03',
    travelers: [{ name: 'נועה' }],
  };
  const show = (advisories?: Map<string, never>) =>
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 400, height: 800 },
          insets: { top: 0, left: 0, right: 0, bottom: 0 },
        }}
      >
        <PassportBanners
          trip={trip}
          advisories={advisories}
          today="2026-10-28"
          colorScheme="light"
          onToast={jest.fn()}
        />
      </SafeAreaProvider>,
    );

  it('me under 6 months on return: orange, the default rule; Noa missing: the reminder (Dana data)', async () => {
    await saveHolder({
      id: 'me',
      isMe: true,
      name: '',
      expiry: '2027-06-01',
      last4: null,
      hasPhoto: false,
    });
    await show();
    await flush();
    expect(screen.getByTestId('card-passport-orange')).toHaveTextContent(
      /לדרכון שלך יישאר תוקף קצר ביום החזרה/,
    );
    expect(screen.getByTestId('card-passport-orange')).toHaveTextContent(
      /מדינות רבות דורשות 6 חודשים/,
    );
    expect(screen.queryByTestId('card-passport-red')).toBeNull();
    expect(screen.getByTestId('card-passport-reminder')).toHaveTextContent(/נועה/);
  });

  it('expires before departure: red, with the departure date', async () => {
    await saveHolder({
      id: 'me',
      isMe: true,
      name: '',
      expiry: '2026-12-01',
      last4: null,
      hasPhoto: false,
    });
    await show();
    await flush();
    expect(screen.getByTestId('card-passport-red')).toHaveTextContent(/20\.12\.2026/);
    expect(screen.getByTestId('card-passport-row-me')).toBeOnTheScreen();
  });

  it("the country's 0 months: valid until the return day is fine (AC-14)", async () => {
    await saveHolder({
      id: 'me',
      isMe: true,
      name: '',
      expiry: '2027-01-04',
      last4: null,
      hasPhoto: false,
    });
    await show(new Map([['THA', { passportValidityMonths: 0 } as never]]));
    await flush();
    expect(screen.queryByTestId('card-passport-orange')).toBeNull();
    expect(screen.queryByTestId('card-passport-red')).toBeNull();
  });

  it('"not now" hides the reminder for this trip, for good (D1)', async () => {
    await saveHolder({
      id: 'me',
      isMe: true,
      name: '',
      expiry: '2030-01-01',
      last4: null,
      hasPhoto: false,
    });
    await show();
    await flush();
    await fireEvent.press(screen.getByTestId('card-passport-reminder-later'));
    await flush();
    expect(screen.queryByTestId('card-passport-reminder')).toBeNull();
    expect((await dismissedReminders()).has(trip.id)).toBe(true);
  });
});
