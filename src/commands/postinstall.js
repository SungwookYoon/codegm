'use strict';

// Runs on `npm install`. Deliberately does NOT touch settings.json — modifying
// Claude config silently on install is hostile. It only pre-creates the writable
// data dirs (on Windows) and prints a one-line opt-in banner.

module.exports = function postinstall() {
  try {
    if (process.platform === 'win32') {
      require('../core/config').ensureDataDirs();
    }
  } catch {
    /* non-fatal */
  }
  if (process.platform !== 'win32') {
    console.log('cc-bgm: Phase 1 is Windows-only; installed but inert on this platform.');
    return;
  }
  console.log('cc-bgm installed. Run `cc-bgm init` to enable, `cc-bgm doctor` to verify.');
};
