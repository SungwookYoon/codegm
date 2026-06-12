'use strict';

// Central path resolution for cc-bgm.
//
// Two distinct roots:
//   packageRoot  — where the npm package is installed (READ-ONLY at runtime).
//                  Holds bin/, daemon/, assets/ (bundled defaults), config/.
//   dataRoot     — %LOCALAPPDATA%\cc-bgm (WRITABLE). Holds config, command
//                  channel, user asset overrides, logs, daemon state.
//
// Everything mutable lives under dataRoot so `npm update` replacing the package
// dir never loses state, and so the daemon never tries to write where it can't.

const os = require('os');
const path = require('path');

// __dirname here is <packageRoot>/src/core, so go up two levels.
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

function dataRoot() {
  // %LOCALAPPDATA% on Windows; fall back to a sane location elsewhere so the
  // module at least loads (non-Windows is a guarded no-op at the command layer).
  const base =
    process.env.LOCALAPPDATA ||
    (process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local')
      : path.join(os.homedir(), '.local', 'share'));
  return path.join(base, 'cc-bgm');
}

function claudeSettingsPath() {
  // Resolve dynamically — never hardcode a username.
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function paths() {
  const root = dataRoot();
  return {
    packageRoot: PACKAGE_ROOT,
    dataRoot: root,

    // package-bundled (read-only)
    daemonScript: path.join(PACKAGE_ROOT, 'daemon', 'cc-bgm-daemon.ps1'),
    bundledAssets: path.join(PACKAGE_ROOT, 'assets'),
    bundledBgm: path.join(PACKAGE_ROOT, 'assets', 'bgm'),
    bundledSfx: path.join(PACKAGE_ROOT, 'assets', 'sfx'),
    bundledManifest: path.join(PACKAGE_ROOT, 'assets', 'manifest.json'),
    defaultTriggerMap: path.join(PACKAGE_ROOT, 'config', 'triggermap.default.json'),

    // user data (writable)
    config: path.join(root, 'config.json'),
    userTriggerMap: path.join(root, 'triggermap.json'),
    userAssets: path.join(root, 'assets'),
    userBgm: path.join(root, 'assets', 'bgm'),
    userSfx: path.join(root, 'assets', 'sfx'),
    userManifest: path.join(root, 'assets', 'manifest.json'),
    cmdDir: path.join(root, 'cmd'),
    stateDir: path.join(root, 'state'),
    stateFile: path.join(root, 'state', 'daemon.json'),
    logsDir: path.join(root, 'logs'),

    // claude code
    claudeSettings: claudeSettingsPath(),
  };
}

// Resolve the Windows PowerShell 5.1 (Desktop) executable explicitly.
// MUST be powershell.exe, NOT pwsh — WPF MediaPlayer lives in .NET Framework.
// Do not trust PATH; build the path from %WINDIR%.
function powershellExe() {
  const windir = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  return path.join(windir, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

module.exports = { paths, powershellExe, PACKAGE_ROOT };
