// Sprint 10 AC-9, AC-10 (design 8, 9; Dana): the capture's steps after the
// photo: the OCR with its time limit, the confirm step, a retake and a close,
// and that the unencrypted photo is always discarded on the way out.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import '@/i18n';

import { CaptureScreen, OCR_TIMEOUT_MS, readExpiry } from './CaptureScreen';
import { vault } from './vault';

jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [null, jest.fn()],
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock('./vault', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    SecureWindow: View,
    vault: { recognize: jest.fn(), discard: jest.fn(async () => undefined) },
  };
});

// The ICAO 9303 sample: expiry 15 April 2012.
const MRZ =
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
const picked = { kind: 'picked', uri: 'file:///cache/ImagePicker/a.jpg' } as const;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
const show = async (onDone = jest.fn()) => {
  await render(<CaptureScreen start={picked} insetsTop={0} insetsBottom={0} onDone={onDone} />);
  await flush();
  return onDone;
};

beforeEach(() => jest.clearAllMocks());

describe('reading the expiry (AC-10)', () => {
  it('a readable page: the date, then save hands the photo and the date back', async () => {
    jest.mocked(vault.recognize).mockResolvedValue(MRZ);
    const onDone = await show();
    expect(screen.getByTestId('capture-date')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('capture-save'));
    expect(onDone).toHaveBeenCalledWith({
      kind: 'photo',
      uri: picked.uri,
      expiry: '2012-04-15',
      edited: false,
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('OCR fails: "couldn\'t read", and the photo can still be saved without a date', async () => {
    jest.mocked(vault.recognize).mockRejectedValue(new Error('mlkit'));
    const onDone = await show();
    expect(screen.getByTestId('capture-failed')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('capture-save-photo-only'));
    expect(onDone).toHaveBeenCalledWith({
      kind: 'photo',
      uri: picked.uri,
      expiry: null,
      edited: false,
    });
  });

  it('text without a passport line is a failure too', async () => {
    jest.mocked(vault.recognize).mockResolvedValue('just some words');
    await expect(readExpiry('file:///x.jpg')).resolves.toBeNull();
  });

  it(`gives the OCR ${OCR_TIMEOUT_MS / 1000} s, then it is a failure`, async () => {
    jest.useFakeTimers();
    try {
      jest.mocked(vault.recognize).mockReturnValue(new Promise(() => {}));
      const result = readExpiry('file:///x.jpg');
      jest.advanceTimersByTime(OCR_TIMEOUT_MS - 1);
      let settled = false;
      void result.then(() => (settled = true));
      await Promise.resolve();
      expect(settled).toBe(false);
      jest.advanceTimersByTime(1);
      await expect(result).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('leaving the capture (AC-2: no unencrypted copy stays)', () => {
  it('retake from the gallery discards the photo; cancelling the picker ends as cancelled', async () => {
    jest.mocked(vault.recognize).mockResolvedValue(MRZ);
    const onDone = await show();
    await fireEvent.press(screen.getByTestId('capture-retake'));
    await flush();
    expect(vault.discard).toHaveBeenCalledWith(picked.uri);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith({ kind: 'cancelled' });
  });

  it('retake from the gallery with a new pick reads the new photo', async () => {
    jest.mocked(vault.recognize).mockResolvedValue(MRZ);
    jest
      .mocked(ImagePicker.launchImageLibraryAsync)
      .mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///b.jpg' }] } as never);
    const onDone = await show();
    await fireEvent.press(screen.getByTestId('capture-retake'));
    await flush();
    expect(vault.recognize).toHaveBeenLastCalledWith('file:///b.jpg');
    await fireEvent.press(screen.getByTestId('capture-save'));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ uri: 'file:///b.jpg' }));
  });

  it('close while confirming asks first; discarding deletes the photo, then cancels', async () => {
    jest.mocked(vault.recognize).mockResolvedValue(MRZ);
    const alert = jest.spyOn(Alert, 'alert');
    const onDone = await show();
    await fireEvent.press(screen.getByTestId('capture-close'));
    expect(onDone).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2]!;
    await act(async () => buttons.find((b) => b.style === 'destructive')!.onPress!());
    await flush();
    expect(vault.discard).toHaveBeenCalledWith(picked.uri);
    expect(onDone).toHaveBeenCalledWith({ kind: 'cancelled' });
    alert.mockRestore();
  });
});
