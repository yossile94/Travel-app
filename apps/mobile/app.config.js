/**
 * The static config is app.json; this adds what depends on the machine
 * (sprint 6, Raz 16): Firebase's google-services.json from GOOGLE_SERVICES_JSON
 * (a path outside Git, set by whoever builds), for Push on Android. Without it
 * the app builds and runs; only Push has no FCM.
 */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
  },
});
