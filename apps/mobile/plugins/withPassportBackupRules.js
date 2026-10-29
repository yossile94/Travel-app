/**
 * Sprint 10 D6 (ADR-015): the passport folder never leaves the device in an
 * Android backup or a device-to-device transfer.
 *
 * expo-secure-store's own rules are turned off (configureAndroidBackup: false
 * in app.json) and written here instead, together with ours, so there is one
 * set of rules and no plugin overwrites another (Raz: "merged with
 * SecureStore's"). As in SecureStore's, only shared preferences are backed up,
 * its own excluded; the passport folder is excluded by name as well, so a
 * future "include files" can't bring it back by accident.
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const BACKUP = 'passport_backup_rules';
const EXTRACTION = 'passport_data_extraction_rules';

const rules = `  <include domain="sharedpref" path="."/>
  <exclude domain="sharedpref" path="SecureStore"/>
  <exclude domain="file" path="passport/"/>`;

const backupXml = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto Backup, Android 11 and lower (plugins/withPassportBackupRules.js) -->
<full-backup-content>
${rules}
</full-backup-content>
`;

const indent = (text) => text.replace(/^/gm, '  ');
const extractionXml = `<?xml version="1.0" encoding="utf-8"?>
<!-- Auto Backup and device transfer, Android 12 and higher (plugins/withPassportBackupRules.js) -->
<data-extraction-rules>
  <cloud-backup>
${indent(rules)}
  </cloud-backup>
  <device-transfer>
${indent(rules)}
  </device-transfer>
</data-extraction-rules>
`;

/** Points the application at our rules; fails loudly on rules from elsewhere. */
function setRules(manifest) {
  const app = manifest.manifest.application?.[0];
  if (!app) throw new Error('withPassportBackupRules: no <application> in AndroidManifest.xml');
  for (const [attr, value] of [
    ['android:fullBackupContent', `@xml/${BACKUP}`],
    ['android:dataExtractionRules', `@xml/${EXTRACTION}`],
  ]) {
    const current = app.$[attr];
    if (current && current !== value) {
      throw new Error(`withPassportBackupRules: ${attr} is already ${current}; merge it here`);
    }
    app.$[attr] = value;
  }
  return manifest;
}

const withPassportBackupRules = (config) => {
  config = withAndroidManifest(config, (c) => {
    c.modResults = setRules(c.modResults);
    return c;
  });
  return withDangerousMod(config, [
    'android',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${BACKUP}.xml`), backupXml);
      fs.writeFileSync(path.join(dir, `${EXTRACTION}.xml`), extractionXml);
      return c;
    },
  ]);
};

module.exports = withPassportBackupRules;
module.exports.setRules = setRules;
module.exports.backupXml = backupXml;
module.exports.extractionXml = extractionXml;
