import i18n from '@/i18n';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, TextInput } from 'react-native';

import { colors } from '@/theme/tokens';

import type { Advisory } from './destinationData';
import {
  advisoryState,
  CalculatorSheet,
  CardAdvisory,
  CardRate,
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

const colorOf = (element: { props: { style?: unknown } }) =>
  (StyleSheet.flatten(element.props.style as never) as { color?: string }).color;

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

describe('CardAdvisory', () => {
  const show = (over: Partial<Parameters<typeof CardAdvisory>[0]>) =>
    render(
      <CardAdvisory
        advisory={advisory()}
        loading={false}
        failed={false}
        offline={false}
        colorScheme="light"
        onOpen={jest.fn()}
        {...over}
      />,
    );

  it('red only at level 4', async () => {
    await show({ advisory: advisory({ nscLevel: 4, nscLevels: [4] }) });
    const four = screen.getByText(t('advisory.level', { n: 4, word: t('advisory.word.4') }));
    expect(colorOf(four)).toBe(colors.light.textAlert);
    await screen.unmount();
    await show({ advisory: advisory({ nscLevel: 3, nscLevels: [3] }) });
    const three = screen.getByText(t('advisory.level', { n: 3, word: t('advisory.word.3') }));
    expect(colorOf(three)).toBe(colors.light.textPrimary);
  });

  it('"may be out of date" after 30 days', async () => {
    await show({ advisory: advisory({ fetchedAt: daysAgo(31) }) });
    expect(screen.getByText(t('common.maybeStale'))).toBeTruthy();
    await screen.unmount();
    await show({ advisory: advisory({ fetchedAt: daysAgo(29) }) });
    expect(screen.queryByText(t('common.maybeStale'))).toBeNull();
  });

  it('first launch: offline or failed, each with its own words', async () => {
    await show({ advisory: undefined, failed: true, offline: true });
    expect(screen.getByText(t('advisory.firstOffline'))).toBeTruthy();
    await screen.unmount();
    await show({ advisory: undefined, failed: true, offline: false });
    expect(screen.getByText(t('advisory.error'))).toBeTruthy();
  });

  it('a row with nothing to open is not a button (Raz, S4-m6)', async () => {
    await show({ advisory: undefined });
    expect(screen.getByText(t('advisory.pending'))).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a level opens the sheet', async () => {
    const onOpen = jest.fn();
    await show({ onOpen });
    await fireEvent.press(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('CardRate (AC-1א, AC-4)', () => {
  const show = (over: Partial<Parameters<typeof CardRate>[0]>) =>
    render(
      <CardRate
        currency="EUR"
        currencyName="אירו"
        rate={rate()}
        loading={false}
        failed={false}
        offline={false}
        colorScheme="light"
        onOpen={jest.fn()}
        {...over}
      />,
    );

  it('no block for ILS', async () => {
    await show({ currency: 'ILS', rate: undefined });
    expect(screen.queryByTestId('card-rate')).toBeNull();
  });

  it('USD: only the shekels', async () => {
    await show({ currency: 'USD', rate: rate({ currency: 'USD', rateToIls: 3.7, rateToUsd: 1 }) });
    expect(screen.getByRole('button').props.accessibilityLabel).toBe(
      t('rate.rowA11yUsd', { ils: '3.7' }),
    );
  });

  it('no rate: none, first offline, or failed', async () => {
    await show({ rate: undefined });
    expect(screen.getByText(t('rate.none'))).toBeTruthy();
    await screen.unmount();
    await show({ rate: undefined, failed: true, offline: true });
    expect(screen.getByText(t('rate.firstOffline'))).toBeTruthy();
    await screen.unmount();
    await show({ rate: undefined, failed: true, offline: false });
    expect(screen.getByText(t('rate.error'))).toBeTruthy();
  });

  it('a rate over 3 days old may be out of date', async () => {
    await show({ rate: rate({ fetchedAt: daysAgo(4) }) });
    expect(screen.getByText(t('common.maybeStale'))).toBeTruthy();
    await screen.unmount();
    await show({ rate: rate({ fetchedAt: daysAgo(2) }) });
    expect(screen.queryByText(t('common.maybeStale'))).toBeNull();
  });

  it('credits each source', async () => {
    await show({ rate: rate({ source: 'boi' }) });
    expect(screen.getByText(t('rate.attrBoi'))).toBeTruthy();
    await screen.unmount();
    await show({ rate: rate({ source: 'erapi' }) });
    expect(screen.getByTestId('rate-attribution')).toBeTruthy();
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
  it('focuses the local field once the calculator has slid in', async () => {
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
      expect(focus).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(focus).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('the advisory row and the trip line say the full level', async () => {
    await render(
      <>
        <CardAdvisory
          advisory={advisory({ nscLevel: 4, nscLevels: [4] })}
          loading={false}
          failed={false}
          offline={false}
          colorScheme="light"
          onOpen={jest.fn()}
        />
        <TripStatusLine advisory={advisory({ nscLevel: 4, nscLevels: [4] })} colorScheme="light" />
      </>,
    );
    const row = screen.getByTestId('card-advisory-row').props.accessibilityLabel as string;
    expect(row).toContain(t('advisory.levelOf', { n: 4 }));
    expect(row).toContain(t('advisory.checked', { date: '' }).trim().slice(0, 4));
    const line = screen.getByTestId('trip-status-line').props.accessibilityLabel as string;
    expect(line).toContain(t('advisory.levelOf', { n: 4 }));
    expect(line).toContain(t('advisory.word.4'));
  });
});
