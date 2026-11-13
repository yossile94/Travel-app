// Sprint 15 AC-6 (design 6.4): the toast after a flight is saved without tracking.
import { untrackedNotice } from './untrackedNotice';

const t = (key: string, o?: Record<string, unknown>) => (o ? `${key} ${JSON.stringify(o)}` : key);
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

it('concurrent and suspended: their text, the same for the screen reader', () => {
  expect(untrackedNotice({ untracked: 'concurrent', renewsAt: null }, t)).toEqual({
    text: 'flight.untracked.concurrent',
    a11y: 'flight.untracked.concurrent',
  });
  expect(untrackedNotice({ untracked: 'suspended', renewsAt: null }, t).text).toBe(
    'flight.untracked.suspended',
  );
});

it('turnover: the renewal day on the device, read left to right', () => {
  const renewsAt = new Date(2026, 11, 20, 9, 0).toISOString();
  const { text, a11y } = untrackedNotice(
    { untracked: 'turnover', renewsAt },
    t,
    new Date(2026, 10, 13),
  );
  expect(text).toContain(`${LRI}20.12${PDI}`);
  expect(a11y).toContain('date.single');
});

it('turnover in another year: with the year', () => {
  const renewsAt = new Date(2027, 0, 14, 9, 0).toISOString();
  const { text } = untrackedNotice({ untracked: 'turnover', renewsAt }, t, new Date(2026, 10, 13));
  expect(text).toContain(`${LRI}14.1.2027${PDI}`);
});
