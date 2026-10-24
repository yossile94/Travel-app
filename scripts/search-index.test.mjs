/**
 * The search index (apps/mobile/src/features/search/searchIndex.json) must
 * match its sources: every selectable area, folded with the app's own fold.ts.
 * If this fails after changing the countries, aliases or fold.ts, run
 * `npm run build:geo` (or `npm run build:search`).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { fold, searchForms } from '../apps/mobile/src/features/search/fold.ts';

const readJson = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const meta = readJson('../apps/mobile/src/features/globe/countryMeta.json');
const index = readJson('../apps/mobile/src/features/search/searchIndex.json');
const { _comment, ...aliases } = readJson('./data/country-aliases.json');

describe('country search index', () => {
  it('has exactly the selectable areas', () => {
    assert.deepEqual(index.map((e) => e.adm0).sort(), Object.keys(meta).sort());
  });

  it('is folded with the current fold.ts', () => {
    for (const entry of index) {
      const names = [...new Set([...searchForms(entry.nameHe), ...searchForms(entry.nameEn)])];
      assert.deepEqual(entry.names, names, entry.adm0);
      assert.equal(entry.sortKey, fold(entry.nameHe), entry.adm0);
    }
  });

  it('includes every alias in the aliases file', () => {
    for (const [adm0, list] of Object.entries(aliases)) {
      const entry = index.find((e) => e.adm0 === adm0);
      for (const alias of list) {
        for (const form of searchForms(alias)) {
          assert.ok(
            entry.names.includes(form) || entry.aliases?.includes(form),
            `${adm0}: ${alias}`,
          );
        }
      }
    }
  });

  it('names the sovereign of a territory, only of territories, and not twice', () => {
    const parentOf = (adm0) => index.find((e) => e.adm0 === adm0).parentHe;
    for (const entry of index) {
      if (!meta[entry.adm0].parent) assert.equal(entry.parentHe, undefined, entry.adm0);
    }
    assert.equal(parentOf('GIB'), 'הממלכה המאוחדת');
    assert.equal(parentOf('IOA'), 'אוסטרליה');
    // A short name for China; none where the name already says it.
    assert.equal(parentOf('HKG'), 'סין');
    assert.equal(parentOf('VIR'), undefined);
    assert.equal(parentOf('UMI'), undefined);
    assert.equal(parentOf('FRA'), undefined);
  });

  it('is sorted by the folded Hebrew name', () => {
    const keys = index.map((e) => e.sortKey);
    assert.deepEqual(keys, [...keys].sort());
  });
});
