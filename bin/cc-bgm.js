#!/usr/bin/env node
'use strict';

const { main } = require('../src/cli');

main(process.argv.slice(2)).catch((e) => {
  // Never let an error escape as a nonzero crash for the `event` path; for other
  // commands, surface it.
  if (process.argv[2] === 'event') {
    process.exit(0);
  }
  console.error('cc-bgm: ' + (e && e.message ? e.message : e));
  process.exit(1);
});
