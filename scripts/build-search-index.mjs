#!/usr/bin/env node
/**
 * Builds the country search index (sprint 1 F-002): every selectable area
 * (each entry of countryMeta.json, keyed by adm0) with its display names and
 * its folded search forms, precomputed here so the app only folds the query.
 *
 * Inputs: apps/mobile/src/features/globe/countryMeta.json (run
 * build-country-meta first) and scripts/data/country-aliases.json.
 * Folding comes from the app's own fold.ts (Node 24 strips its types), so the
 * index and the runtime query always fold the same way.
 *
 * Usage: node scripts/build-search-index.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fold, searchForms } from '../apps/mobile/src/features/search/fold.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const metaFile = join(root, 'apps', 'mobile', 'src', 'features', 'globe', 'countryMeta.json');
const aliasesFile = join(root, 'scripts', 'data', 'country-aliases.json');
const outFile = join(root, 'apps', 'mobile', 'src', 'features', 'search', 'searchIndex.json');

const unique = (values) => [...new Set(values)];

async function main() {
  const meta = JSON.parse(await readFile(metaFile, 'utf8'));
  const { _comment, ...aliases } = JSON.parse(await readFile(aliasesFile, 'utf8'));

  for (const [adm0, list] of Object.entries(aliases)) {
    const entry = meta[adm0];
    if (!entry) throw new Error(`country-aliases.json: unknown adm0 ${adm0}`);
    const own = new Set([fold(entry.nameHe), fold(entry.nameEn)]);
    for (const alias of list) {
      if (own.has(fold(alias))) {
        throw new Error(`country-aliases.json: "${alias}" is already ${adm0}'s own name`);
      }
    }
  }

  const index = Object.entries(meta)
    .map(([adm0, entry]) => {
      const names = unique([...searchForms(entry.nameHe), ...searchForms(entry.nameEn)]);
      const aliasForms = unique((aliases[adm0] ?? []).flatMap(searchForms)).filter(
        (form) => !names.includes(form),
      );
      return {
        adm0,
        nameHe: entry.nameHe,
        nameEn: entry.nameEn,
        ...(entry.parent ? { parentHe: meta[entry.parent].nameHe } : {}),
        // Folded Hebrew name: the alphabetical tie-break, compared as plain strings.
        sortKey: fold(entry.nameHe),
        names,
        ...(aliasForms.length ? { aliases: aliasForms } : {}),
      };
    })
    .sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  await writeFile(outFile, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote ${outFile}`);
  console.log(`  areas: ${index.length}, with aliases: ${index.filter((e) => e.aliases).length}`);
  console.log(`  territories (with parent): ${index.filter((e) => e.parentHe).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
