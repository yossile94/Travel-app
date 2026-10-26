import { assertEquals } from '@std/assert';

import { advisoriesFrom, nscLevel, officialLink } from './advisories.ts';

Deno.test('reads the NSC level however it is written', () => {
  assertEquals(nscLevel('רמת איום מזדמן (2): המלצה לנקוט באמצעי זהירות מוגברים.'), 2);
  assertEquals(nscLevel('מומלץ לנקוט באמצעי זהירות רגילים. אין אזהרת מסע (רמה 1).'), 1);
  assertEquals(nscLevel('אין אזהרות'), 1);
  assertEquals(nscLevel('רמת איום משולבת (3/4): איום גבוה: הימנעו...'), 4);
  assertEquals(nscLevel('מומלץ להימנע מנסיעות שאינן חיוניות (רמת סיכון 3 ו-4).'), 4);
  assertEquals(nscLevel('הימנעו מהגעה למאלי (איום גבוה 4)'), 4);
  assertEquals(
    nscLevel(
      'רמת איום גבוהה (רמה 4) מומלץ להימנע מהגעה דרום המדינה. איום מזדמן (רמה 2): שאר שטחי תאילנד.',
    ),
    4,
  );
  assertEquals(nscLevel('עלייה משמעותית בעוינות. איום בינוני: הימנעו מנסיעות שאינן חיוניות.'), 3);
  assertEquals(nscLevel('מצב משתנה, עקבו אחרי הודעות.'), null);
  assertEquals(nscLevel(null), null);
});

Deno.test('keeps only https links on gov.il', () => {
  assertEquals(
    officialLink('<a href="https://www.gov.il/he/pages/thailand1" target="_blank">להמלצה</a>'),
    'https://www.gov.il/he/pages/thailand1',
  );
  assertEquals(officialLink('<a href="http://www.gov.il/x">x</a>'), null);
  assertEquals(officialLink('<a href="https://evil.example/x">x</a>'), null);
  assertEquals(officialLink(null), null);
});

Deno.test(
  'one advisory per area: NSC text and level, MFA rows together; health rows skipped',
  () => {
    const { advisories, unmapped } = advisoriesFrom([
      {
        country: 'תאילנד',
        משרד: 'בריאות',
        recommendations: null,
        details: '<a href="https://www.gov.il/h">x</a>',
      },
      {
        country: 'תאילנד',
        משרד: 'מל"ל',
        recommendations: 'איום מזדמן (רמה 2)',
        details: '<a href="https://www.gov.il/he/pages/thailand1">x</a>',
      },
      {
        country: 'תאילנד',
        משרד: 'חוץ',
        recommendations: 'שימרו על עירנות.',
        details: '<a href="https://www.gov.il/a">x</a>',
      },
      {
        country: 'תאילנד',
        משרד: 'חוץ',
        recommendations: 'בדקו את הגבול.',
        details: '<a href="https://www.gov.il/b">x</a>',
      },
      { country: 'סומלילנד', משרד: 'מל"ל', recommendations: 'רמה 4', details: null },
    ]);
    assertEquals(unmapped, ['סומלילנד']);
    assertEquals(advisories, [
      {
        adm0: 'THA',
        nsc_level: 2,
        nsc_text: 'איום מזדמן (רמה 2)',
        nsc_url: 'https://www.gov.il/he/pages/thailand1',
        mfa_text: 'שימרו על עירנות.\n\nבדקו את הגבול.',
        mfa_url: 'https://www.gov.il/a',
      },
    ]);
  },
);

Deno.test('two spellings of one area: texts together, the highest level (Dudi, d5)', () => {
  const { advisories } = advisoriesFrom([
    { country: 'מקדוניה', משרד: 'מל"ל', recommendations: 'רמה 3', details: null },
    { country: 'צפון מקדוניה', משרד: 'מל"ל', recommendations: 'אין אזהרות', details: null },
  ]);
  assertEquals(advisories.length, 1);
  assertEquals(advisories[0]!.nsc_level, 3);
  assertEquals(advisories[0]!.nsc_text, 'רמה 3\n\nאין אזהרות');
});

Deno.test('the names map covers both spellings the dataset uses', () => {
  const { advisories } = advisoriesFrom([
    { country: 'צפון מקדוניה', משרד: 'מל"ל', recommendations: 'אין אזהרות', details: null },
    { country: 'תורכיה', משרד: 'מל"ל', recommendations: 'רמה 3', details: null },
  ]);
  assertEquals(
    advisories.map((a) => [a.adm0, a.nsc_level]),
    [
      ['MKD', 1],
      ['TUR', 3],
    ],
  );
});
