import '@/i18n';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { DeleteAccountScreen } from './AccountScreens';

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ deleteAccount: jest.fn(async () => 'cancelled') }),
}));
jest.mock('@/lib/supabase', () => ({ supabase: null }));

const props = {
  user: { id: 'user-1', name: 'דנה', email: 'dana@example.test' },
  colorScheme: 'light' as const,
  reduceMotion: true,
  insetsTop: 0,
  insetsBottom: 0,
};

describe('DeleteAccountScreen (sprint 2 design 11)', () => {
  it('back from step 2 returns to step 1 on the same screen, without leaving it (review)', async () => {
    const onBack = jest.fn();
    await render(<DeleteAccountScreen {...props} onBack={onBack} />);
    expect(screen.getByText('שלב 1 מתוך 2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('delete-account-continue'));
    expect(screen.getByText('שלב 2 מתוך 2')).toBeTruthy();
    expect(screen.getByText('אימות עם Google')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('delete-account-screen-back'));
    expect(screen.getByText('שלב 1 מתוך 2')).toBeTruthy();
    expect(screen.getByTestId('delete-account-continue')).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();
  });
});
