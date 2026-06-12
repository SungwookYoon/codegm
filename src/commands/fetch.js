'use strict';

// `cc-bgm fetch [pack]`
// Downloads a curated CC0 audio pack into the USER assets dir
// (%LOCALAPPDATA%\cc-bgm\assets\{bgm,sfx}\), where it overrides the bundled
// placeholder tones by logical name. Default pack: "starter".
//
// Packs are JSON manifests in config/packs/<name>.json listing
// { kind, name, url } entries pointing at raw GitHub (or any https) audio.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { paths } = require('../core/paths');
const { ensureDataDirs } = require('../core/config');

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'cc-bgm' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(download(res.headers.location, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const tmp = dest + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => {
        try {
          fs.renameSync(tmp, dest);
          resolve(fs.statSync(dest).size);
        } catch (e) {
          reject(e);
        }
      }));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  });
}

function loadPack(packName) {
  const p = paths();
  const file = path.join(p.packageRoot, 'config', 'packs', `${packName}.json`);
  if (!fs.existsSync(file)) {
    const dir = path.join(p.packageRoot, 'config', 'packs');
    const avail = fs.existsSync(dir)
      ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
      : [];
    throw new Error(`unknown pack '${packName}'. Available: ${avail.join(', ') || '(none)'}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = async function fetch(args) {
  const packName = args.find((a) => !a.startsWith('--')) || 'starter';
  const p = ensureDataDirs();

  let pack;
  try {
    pack = loadPack(packName);
  } catch (e) {
    console.error(`cc-bgm: ${e.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`cc-bgm fetch: ${pack.name} — ${pack.description}`);
  console.log(`  license: ${pack.license}`);
  console.log('');

  const extByKind = { bgm: '.ogg', sfx: '.wav' };
  let okCount = 0;
  let failCount = 0;

  for (const f of pack.files) {
    const dir = f.kind === 'bgm' ? p.userBgm : p.userSfx;
    // Preserve the source extension when present in the URL.
    const urlExt = path.extname(new URL(f.url).pathname) || extByKind[f.kind] || '.wav';
    const dest = path.join(dir, f.name + urlExt);
    process.stdout.write(`  ${f.kind}/${f.name}${urlExt} ... `);
    try {
      const size = await download(f.url, dest);
      console.log(`ok (${(size / 1024).toFixed(0)} KB)`);
      okCount++;
    } catch (e) {
      console.log(`FAILED (${e.message})`);
      failCount++;
    }
  }

  // Write a credits file alongside the user assets.
  try {
    const credit = `${pack.name} pack (${pack.license})\n${pack.credits}\n`;
    fs.writeFileSync(path.join(p.userAssets, 'CREDITS.txt'), credit);
  } catch {
    /* non-fatal */
  }

  console.log('');
  console.log(`cc-bgm: downloaded ${okCount} file(s)${failCount ? `, ${failCount} failed` : ''} to ${p.userAssets}`);
  console.log('These override the bundled defaults. Try: cc-bgm play quest');
  if (failCount) process.exitCode = 1;
};
