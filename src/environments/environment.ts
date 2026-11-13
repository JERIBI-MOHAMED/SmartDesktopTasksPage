// Production build settings (used by `ng build`, which is what GitHub Pages serves).
//
// TODO: replace the placeholder below with the public HTTPS address of your
// Smart Desktop API before you deploy, e.g. 'https://tasks-api.example.com'.
// Users can still override it at runtime in the Settings dialog, so leaving the
// placeholder in place simply means everyone is asked for the URL on first run.
//
// Never put the API key here: this repository is public. The key is entered by
// the user in the browser and kept in localStorage only.
export const environment = {
  production: true,
  apiBaseUrl: 'https://smartdesktop-api.onrender.com',
};
