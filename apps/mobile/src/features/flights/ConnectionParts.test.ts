import i18n from '@/i18n';

import { layoverLabel, layoverWhere } from './ConnectionParts';
import { airportOf } from './airportsData';

// Device QA (sprint 7): the wait line said "ב-ב-K U L". Both layover rows (the card and
// the flight screen) build `where` with layoverWhere, so the preposition comes once.
describe('layoverLabel with layoverWhere', () => {
  const kul = airportOf([
    'KUL',
    'MYS',
    'MY',
    'Asia/Kuala_Lumpur',
    'קואלה לומפור',
    'Kuala Lumpur',
    'KLIA',
    0,
    '',
  ]);
  const ok = { minutes: 90, mct: 60, status: 'ok' } as const;
  const original = i18n.language;
  afterEach(() => i18n.changeLanguage(original));

  it('says the airport once in Hebrew, with or without the city', async () => {
    await i18n.changeLanguage('he');
    for (const airports of [[kul], null]) {
      const label = layoverLabel(ok, layoverWhere('KUL', airports, 'he', i18n.t), 'MH781', i18n.t);
      expect(label.match(/ב-K U L/g)).toHaveLength(1);
      expect(label).not.toContain('ב-ב-');
    }
  });

  it('says the airport once in English', async () => {
    await i18n.changeLanguage('en');
    const label = layoverLabel(ok, layoverWhere('KUL', [kul], 'en', i18n.t), 'MH781', i18n.t);
    expect(label).toMatch(/layover at K U L, Kuala Lumpur/);
    expect(label).not.toMatch(/at at/);
  });
});
