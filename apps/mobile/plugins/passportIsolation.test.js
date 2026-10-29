/**
 * @jest-environment node
 *
 * Sprint 10 AC-8 (D8): the ESLint rule that keeps the passport module off the
 * network really fails a file that reaches for it, and passes one that doesn't.
 */
const path = require('path');
const { ESLint } = require('eslint');

const root = path.join(__dirname, '..');
const lint = async (code) => {
  // The config is required here: ESLint's own loader needs dynamic import, which Jest lacks.
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: require('../eslint.config.js'),
  });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(root, 'src/features/passport/probe.ts'),
  });
  return result.messages.map((m) => m.ruleId);
};

describe('passport isolation (D8)', () => {
  it('refuses Supabase, NetInfo, notifications and fetch', async () => {
    expect(
      await lint("import { supabase } from '@/lib/supabase';\nexport const x = supabase;\n"),
    ).toContain('no-restricted-imports');
    expect(
      await lint(
        "import NetInfo from '@react-native-community/netinfo';\nexport const x = NetInfo;\n",
      ),
    ).toContain('no-restricted-imports');
    expect(await lint("import * as N from 'expo-notifications';\nexport const x = N;\n")).toContain(
      'no-restricted-imports',
    );
    expect(await lint("export const x = () => fetch('https://example.test');\n")).toContain(
      'no-restricted-globals',
    );
  }, 60_000);

  it('refuses globalThis.fetch and axios too (Raz review)', async () => {
    expect(
      await lint("export const y = () => globalThis.fetch('https://example.test');\n"),
    ).toContain('no-restricted-properties');
    expect(await lint("import axios from 'axios';\nexport const z = axios;\n")).toContain(
      'no-restricted-imports',
    );
  }, 60_000);

  it('lets a plain file through', async () => {
    expect(await lint('export const x = 1;\n')).toEqual([]);
  }, 60_000);
});
