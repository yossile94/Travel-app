const { backupXml, extractionXml, setRules } = require('./withPassportBackupRules');

const manifest = (attrs = {}) => ({
  manifest: { application: [{ $: { 'android:name': '.MainApplication', ...attrs } }] },
});

describe('withPassportBackupRules (sprint 10 D6)', () => {
  it('excludes the passport folder from backup and from device transfer', () => {
    expect(backupXml).toContain('<exclude domain="file" path="passport/"/>');
    const both = extractionXml.match(/<exclude domain="file" path="passport\/"\/>/g);
    expect(both).toHaveLength(2);
    expect(extractionXml.indexOf('<cloud-backup>')).toBeLessThan(
      extractionXml.indexOf('<device-transfer>'),
    );
  });

  it("keeps SecureStore's own rule (no clash with expo-secure-store)", () => {
    expect(backupXml).toContain('<exclude domain="sharedpref" path="SecureStore"/>');
    expect(extractionXml.match(/path="SecureStore"/g)).toHaveLength(2);
    // Only shared preferences are backed up at all: no file domain is included.
    expect(backupXml).not.toMatch(/<include domain="file"/);
  });

  it('points the application at these rules', () => {
    const app = setRules(manifest()).manifest.application[0].$;
    expect(app['android:fullBackupContent']).toBe('@xml/passport_backup_rules');
    expect(app['android:dataExtractionRules']).toBe('@xml/passport_data_extraction_rules');
  });

  it('fails loudly when another plugin set rules of its own', () => {
    expect(() =>
      setRules(manifest({ 'android:fullBackupContent': '@xml/secure_store_backup_rules' })),
    ).toThrow(/merge it here/);
  });
});
