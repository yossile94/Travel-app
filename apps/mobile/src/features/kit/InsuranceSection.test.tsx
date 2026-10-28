import '@/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { syncInsuranceReminder } from './insuranceReminder';
import { InsuranceSection } from './InsuranceSection';
import { deleteInsurance } from './kitApi';
import { removePolicy } from './policyFile';

jest.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ recheckConsent: jest.fn() }),
}));
jest.mock('./kitApi', () => ({
  deleteInsurance: jest.fn(async () => 'ok'),
  saveInsurance: jest.fn(),
}));
jest.mock('./kitStore', () => ({ refreshTripKit: jest.fn() }));
jest.mock('./insuranceReminder', () => ({
  syncInsuranceReminder: jest.fn(async () => 'scheduled'),
}));
jest.mock('./policyFile', () => ({
  policyMeta: jest.fn(() => null),
  removePolicy: jest.fn(),
  clearViews: jest.fn(),
  openPolicy: jest.fn(),
  savePolicy: jest.fn(),
}));

const metrics = {
  frame: { x: 0, y: 0, width: 411, height: 900 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};
const trip = {
  id: 't1',
  title: 'תאילנד',
  countryAdm0: 'THA',
  startDate: '2027-01-10',
  endDate: '2027-01-20',
};
const insurance = {
  tripId: 't1',
  provider: 'הראל',
  policyNumber: 'P-1',
  validUntil: '2027-01-15',
  emergencyPhone: null,
  notes: null,
};

const show = (ins: typeof insurance | null, status: 'ready' | 'error' = 'ready') =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <InsuranceSection
        trip={trip}
        insurance={ins}
        status={status}
        offline={false}
        colorScheme="light"
        onToast={jest.fn()}
      />
    </SafeAreaProvider>,
  );

describe('InsuranceSection (AC-7 to AC-10)', () => {
  it('without a hotline, asks for one instead of a dial button (AC-8); warns it ends early (AC-7)', async () => {
    await show(insurance);
    expect(screen.getByTestId('card-insurance-no-hotline')).toBeTruthy();
    expect(screen.queryByTestId('card-insurance-dial')).toBeNull();
    expect(screen.getByTestId('card-insurance-ends-early')).toBeTruthy();
  });

  it('a failed read offers a retry, not "add" (Raz review 6)', async () => {
    await show(null, 'error');
    expect(screen.getByTestId('card-insurance-retry')).toBeTruthy();
    expect(screen.queryByTestId('card-insurance-add')).toBeNull();
  });

  it('deleting removes the file on this device and brings the reminder back (AC-9, AC-10)', async () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await show(insurance);
    await fireEvent.press(screen.getByTestId('card-insurance-row'));
    await fireEvent.press(screen.getByTestId('insurance-sheet-delete'));
    await waitFor(() => expect(deleteInsurance).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(removePolicy).toHaveBeenCalledWith('t1'));
    expect(syncInsuranceReminder).toHaveBeenCalledWith(trip, false, expect.any(Object));
  });
});
