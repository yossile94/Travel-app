import i18n from '@/i18n';

import { layoverLabel } from './ConnectionParts';

// Device QA (sprint 7): the wait line said "ב-ב-K U L"; `where` already has its preposition.
describe('layoverLabel', () => {
  const where = (lang: string) =>
    i18n.getFixedT(lang)('layover.a11y.where', { apt: 'K U L', city: 'Kuala Lumpur' });

  it('says the airport once in Hebrew', async () => {
    await i18n.changeLanguage('he');
    const label = layoverLabel(
      { minutes: 90, mct: 60, status: 'ok' },
      where('he'),
      'MH781',
      i18n.t,
    );
    expect(label).toContain('המתנה של');
    expect(label).toContain('ב-K U L');
    expect(label).not.toContain('ב-ב-');
  });

  it('says the airport once in English', async () => {
    await i18n.changeLanguage('en');
    const label = layoverLabel(
      { minutes: 90, mct: 60, status: 'ok' },
      where('en'),
      'MH781',
      i18n.t,
    );
    expect(label).toMatch(/layover at K U L/);
    expect(label).not.toMatch(/at at/);
  });
});
