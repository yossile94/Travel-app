// Sprint 10 D15: the panel's rules against the shared table of cases; the
// database runs the same table (supabase/tests/database/admin_cases.test.sql).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  entryErrors,
  entryPayload,
  isEmail,
  isHttps,
  mctErrors,
  mctPayload,
  type EntryForm,
  type MctForm,
} from './validate.ts';

const root = path.join(import.meta.dirname, '../../../..');
const cases = JSON.parse(
  fs.readFileSync(path.join(root, 'supabase/tests/fixtures/admin_cases.json'), 'utf8'),
) as {
  today: string;
  entry: { name: string; input: EntryForm; ok: boolean; field?: string }[];
  mct: { name: string; input: MctForm; ok: boolean; field?: string }[];
};
/** "x501" in the table stands for 501 characters. */
const expand = (note: string) => (/^x\d+$/.test(note) ? 'x'.repeat(Number(note.slice(1))) : note);

describe('entry (AC-19, AC-23)', () => {
  for (const c of cases.entry) {
    it(c.name, () => {
      const errors = entryErrors({ ...c.input, note: expand(c.input.note) }, cases.today);
      if (c.ok) assert.deepEqual(errors, {});
      else assert.ok(errors[c.field as keyof typeof errors], `expected an error on ${c.field}`);
    });
  }

  it('a date after today is refused in the panel (no CHECK can say "today")', () => {
    const f: EntryForm = {
      status: 'allowed',
      note: '',
      source: 'https://x.example',
      verified: '2026-10-29',
      months: '',
    };
    assert.equal(entryErrors(f, '2026-10-28').verified, 'verifiedFuture');
  });

  it('empty fields are written as null; "not checked" keeps the source', () => {
    assert.deepEqual(
      entryPayload({
        status: null,
        note: '  ',
        source: 'https://x.example',
        verified: '2026-01-01',
        months: '',
      }),
      {
        entry_status: null,
        entry_note: null,
        entry_source_url: 'https://x.example',
        entry_verified_at: '2026-01-01',
        passport_validity_months: null,
      },
    );
  });
});

describe('MCT (AC-22)', () => {
  for (const c of cases.mct) {
    it(c.name, () => {
      const errors = mctErrors(c.input, cases.today);
      if (c.ok) assert.deepEqual(errors, {});
      else assert.ok(errors[c.field as keyof typeof errors], `expected an error on ${c.field}`);
    });
  }

  it('the code is upper-cased', () => {
    assert.equal(
      mctPayload({
        iata: ' ist',
        minutes: '75',
        source: 'https://x.example',
        verified: '2026-10-01',
      }).iata,
      'IST',
    );
  });
});

describe('small rules', () => {
  it('https only, and a real URL', () => {
    assert.equal(isHttps('https://gov.il/a'), true);
    assert.equal(isHttps('https://'), false);
    assert.equal(isHttps('javascript:alert(1)'), false);
  });
  it('an email', () => {
    assert.equal(isEmail(' dana@example.com '), true);
    assert.equal(isEmail('dana@'), false);
  });
});
