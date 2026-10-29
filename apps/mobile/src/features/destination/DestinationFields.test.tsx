import i18n from '@/i18n';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TextInput } from 'react-native';

import type { Advisory } from './destinationData';
import {
  advisoryState,
  CalculatorSheet,
  EntryTag,
  TravelInfoSheet,
  TripStatusLine,
} from './DestinationFields';
import type { Rate } from './rateFormat';

const t = i18n.t.bind(i18n);
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

const advisory = (over: Partial<Advisory> = {}): Advisory => ({
  adm0: 'GRC',
  entryStatus: null,
  entryNote: null,
  entrySourceUrl: null,
  entryVerifiedAt: null,
  nscLevel: 2,
  nscLevels: [2],
  nscText: 'טקסט',
  nscUrl: null,
  mfaText: null,
  mfaUrl: null,
  fetchedAt: daysAgo(1),
  ...over,
});

const rate = (over: Partial<Rate> = {}): Rate => ({
  currency: 'EUR',
  rateToIls: 4,
  rateToUsd: 0.9,
  source: 'erapi',
  rateDate: '2026-10-26',
  fetchedAt: daysAgo(1),
  ...over,
});

describe('advisoryState (AC-7)', () => {
  it('names each state', async () => {
    expect(advisoryState(undefined)).toEqual({ kind: 'pending' });
    expect(advisoryState(advisory({ fetchedAt: null }))).toEqual({ kind: 'pending' });
    expect(advisoryState(advisory({ nscLevel: 4, nscLevels: [4] }))).toEqual({
      kind: 'level',
      level: 4,
      mixed: false,
    });
    expect(advisoryState(advisory({ nscLevel: 4, nscLevels: [2, 4] }))).toEqual({
      kind: 'level',
      level: 4,
      mixed: true,
    });
    expect(advisoryState(advisory({ nscLevel: null, nscLevels: [] }))).toEqual({
      kind: 'unrecognized',
    });
    // Checked, but no NSC text: not "being completed" (Raz, S4-m4).
    expect(advisoryState(advisory({ nscLevel: null, nscLevels: [], nscText: null }))).toEqual({
      kind: 'noNsc',
    });
  });
});

describe('the Safety sheet states (country card fix 6.1)', () => {
  const sheet = (over: Partial<Parameters<typeof TravelInfoSheet>[0]>) =>
    render(
      <TravelInfoSheet
        visible
        countryName="יוון"
        advisory={advisory()}
        colorScheme="light"
        reduceMotion
        insetsBottom={0}
        onClose={jest.fn()}
        {...over}
      />,
    );

  it('the threat level is here, with its check date', async () => {
    await sheet({ advisory: advisory({ nscLevel: 4, nscLevels: [4] }) });
    expect(screen.getByTestId('advisory-bar-4', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(t('advisory.levelOf', { n: 4 }))).toBeTruthy();
    expect(screen.queryByTestId('travel-info-stale')).toBeNull();
  });

  it('first offline launch and an online error say so, never "pending"', async () => {
    await sheet({ advisory: undefined, failed: true, offline: true });
    expect(screen.getByText(t('advisory.firstOffline'))).toBeTruthy();
    expect(screen.queryByText(t('advisory.pendingSheet'))).toBeNull();
    await screen.unmount();
    await sheet({ advisory: undefined, failed: true, offline: false });
    expect(screen.getByText(t('advisory.error'))).toBeTruthy();
    expect(screen.queryByText(t('advisory.pendingSheet'))).toBeNull();
  });

  it('while loading, no level and no "pending"', async () => {
    await sheet({ advisory: undefined, loading: true });
    expect(screen.queryByText(t('advisory.pendingSheet'))).toBeNull();
    expect(screen.queryByTestId('advisory-bar-2')).toBeNull();
  });

  it('stale data says it may be out of date', async () => {
    await sheet({ stale: true });
    expect(screen.getByTestId('travel-info-stale')).toBeTruthy();
  });
});

describe('the currency sheet without a rate (country card fix 6.3)', () => {
  const sheet = (over: Partial<Parameters<typeof CalculatorSheet>[0]>) =>
    render(
      <CalculatorSheet
        visible
        rate={null}
        usdIls={3.6}
        currencyName="אירו"
        colorScheme="light"
        reduceMotion
        insetsBottom={0}
        onClose={jest.fn()}
        {...over}
      />,
    );

  it('opens anyway: none, first offline, or failed', async () => {
    await sheet({});
    expect(screen.getByText(t('rate.none'))).toBeTruthy();
    expect(screen.queryByTestId('calc-local')).toBeNull();
    await screen.unmount();
    await sheet({ failed: true, offline: true });
    expect(screen.getByText(t('rate.firstOffline'))).toBeTruthy();
    await screen.unmount();
    await sheet({ failed: true, offline: false });
    expect(screen.getByText(t('rate.error'))).toBeTruthy();
  });

  it('shows the rate, its date and its source, stale after 3 days', async () => {
    await sheet({ rate: rate({ fetchedAt: daysAgo(4), source: 'erapi' }) });
    expect(screen.getByTestId('money-sheet-rate')).toBeTruthy();
    expect(screen.getByText(t('common.maybeStale'))).toBeTruthy();
    expect(screen.getByTestId('rate-attribution')).toBeTruthy();
    await screen.unmount();
    await sheet({ rate: rate({ fetchedAt: daysAgo(2), source: 'boi' }) });
    expect(screen.queryByText(t('common.maybeStale'))).toBeNull();
    expect(screen.getByText(t('rate.attrBoi'))).toBeTruthy();
  });

  it('keeps the rate it opened with while open: a refresh never resets the typing (Raz)', async () => {
    const props = {
      visible: true,
      usdIls: 3.6,
      currencyName: 'אירו',
      colorScheme: 'light' as const,
      reduceMotion: true,
      insetsBottom: 0,
      onClose: jest.fn(),
    };
    await render(<CalculatorSheet {...props} rate={rate()} />);
    await fireEvent.changeText(screen.getByTestId('calc-local'), '10');
    await screen.rerender(
      <CalculatorSheet {...props} rate={rate({ rateToIls: 5, fetchedAt: daysAgo(0) })} />,
    );
    expect(screen.getByTestId('calc-local').props.value).toBe('10');
    expect(screen.getByTestId('calc-ils').props.value).toBe('40.00');
    // The next opening takes the new rate.
    await screen.rerender(
      <CalculatorSheet {...props} visible={false} rate={rate({ rateToIls: 5 })} />,
    );
    await screen.rerender(<CalculatorSheet {...props} rate={rate({ rateToIls: 5 })} />);
    expect(screen.getByTestId('calc-ils').props.value).toBe('5.00');
  });

  it('takes the first rate that arrives while open after loading', async () => {
    const props = {
      visible: true,
      usdIls: 3.6,
      currencyName: 'אירו',
      colorScheme: 'light' as const,
      reduceMotion: true,
      insetsBottom: 0,
      onClose: jest.fn(),
    };
    await render(<CalculatorSheet {...props} rate={null} loading />);
    expect(screen.queryByTestId('calc-local')).toBeNull();
    await screen.rerender(<CalculatorSheet {...props} rate={rate()} />);
    expect(screen.getByTestId('calc-local').props.value).toBe('1');
  });
});

describe('EntryTag (AC-6)', () => {
  it('only for banned and restricted', async () => {
    for (const status of [null, 'allowed'] as const) {
      await render(<EntryTag status={status} colorScheme="light" onPress={jest.fn()} />);
      expect(screen.queryByTestId('card-entry-tag')).toBeNull();
      await screen.unmount();
    }
    await render(<EntryTag status="banned" colorScheme="light" onPress={jest.fn()} />);
    expect(screen.getByTestId('card-entry-tag').props.accessibilityLabel).toBe(
      t('entry.bannedA11y'),
    );
    await screen.unmount();
    await render(<EntryTag status="restricted" colorScheme="light" onPress={jest.fn()} />);
    expect(screen.getByTestId('card-entry-tag').props.accessibilityLabel).toBe(
      t('entry.restrictedA11y'),
    );
  });
});

describe('CalculatorSheet (AC-2)', () => {
  const show = (r: Rate = rate()) =>
    render(
      <CalculatorSheet
        visible
        rate={r}
        usdIls={3.6}
        currencyName="אירו"
        colorScheme="light"
        reduceMotion
        insetsBottom={0}
        onClose={jest.fn()}
      />,
    );

  it("starts from the line's amount and converts both ways", async () => {
    await show();
    expect(screen.getByTestId('calc-local').props.value).toBe('1');
    expect(screen.getByTestId('calc-ils').props.value).toBe('4.00');
    await fireEvent.changeText(screen.getByTestId('calc-ils'), '8');
    expect(screen.getByTestId('calc-local').props.value).toBe('2.00');
    expect(screen.getByTestId('calc-usd').props.value).toBe('2.22');
  });

  it('takes a comma, ignores a third decimal, and refuses a pasted word', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('calc-local'), '2,5');
    expect(screen.getByTestId('calc-local').props.value).toBe('2.5');
    await fireEvent.changeText(screen.getByTestId('calc-local'), '2.55');
    // One more key: a third decimal is just ignored.
    await fireEvent.changeText(screen.getByTestId('calc-local'), '2.555');
    expect(screen.getByTestId('calc-local').props.value).toBe('2.55');
    expect(screen.queryByTestId('calc-invalid')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('calc-local'), 'hello world');
    expect(screen.getByTestId('calc-invalid')).toBeTruthy();
    expect(screen.getByTestId('calc-local').props.value).toBe('2.55');
  });

  it('empty clears the others', async () => {
    await show();
    await fireEvent.changeText(screen.getByTestId('calc-local'), '');
    expect(screen.getByTestId('calc-ils').props.value).toBe('');
  });

  it('USD has no dollar field', async () => {
    await show(rate({ currency: 'USD', rateToIls: 3.6, rateToUsd: 1 }));
    expect(screen.queryByTestId('calc-usd')).toBeNull();
  });
});

describe('TravelInfoSheet texts (QA S4 #4)', () => {
  const sheet = (nscText: string) =>
    render(
      <TravelInfoSheet
        visible
        countryName="תאילנד"
        advisory={advisory({ nscText, nscLevel: 4, nscLevels: [4] })}
        colorScheme="light"
        reduceMotion
        insetsBottom={0}
        onClose={jest.fn()}
      />,
    );

  it('caps a long text at 8 lines until "עוד" is tapped', async () => {
    await sheet('מילה '.repeat(120));
    expect(screen.getByTestId('sheet-nsc-text').props.numberOfLines).toBe(8);
    await fireEvent.press(screen.getByTestId('sheet-nsc-text-more'));
    expect(screen.getByTestId('sheet-nsc-text').props.numberOfLines).toBeUndefined();
    expect(screen.queryByTestId('sheet-nsc-text-more')).toBeNull();
  });

  it('shows a short text whole, without "עוד"', async () => {
    await sheet('קצר');
    expect(screen.getByTestId('sheet-nsc-text').props.numberOfLines).toBeUndefined();
    expect(screen.queryByTestId('sheet-nsc-text-more')).toBeNull();
  });
});

describe('focus and labels (QA S4 #3, #7)', () => {
  it('no autofocus: the keyboard would hide the rate and its source (Raz Q4)', async () => {
    jest.useFakeTimers();
    try {
      const focus = jest.spyOn(TextInput.prototype, 'focus');
      await render(
        <CalculatorSheet
          visible
          rate={rate()}
          usdIls={3.6}
          currencyName="יורו"
          colorScheme="light"
          reduceMotion={false}
          insetsBottom={0}
          onClose={jest.fn()}
        />,
      );
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(focus).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('the trip line says the full level (the one place on the card besides the sheet)', async () => {
    await render(
      <TripStatusLine advisory={advisory({ nscLevel: 4, nscLevels: [4] })} colorScheme="light" />,
    );
    const line = screen.getByTestId('trip-status-line').props.accessibilityLabel as string;
    expect(line).toContain(t('advisory.levelOf', { n: 4 }));
    expect(line).toContain(t('advisory.word.4'));
  });
});
