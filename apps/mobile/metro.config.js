const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Country borders ship as an asset loaded by URL (scripts/build-countries.mjs),
// not as a module compiled into the JS bundle.
config.resolver.assetExts.push('geojson');
// The city list (scripts/build-cities.mjs) loads only when the city search opens (sprint 3 AC-4).
config.resolver.assetExts.push('dat');

module.exports = config;
