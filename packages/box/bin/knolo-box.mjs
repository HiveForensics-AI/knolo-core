#!/usr/bin/env node

import { main } from '../dist/cli.js';

main(process.argv.slice(2))
  .then((code) => {
    if (code) process.exitCode = code;
  })
  .catch(() => {
    process.exitCode = 1;
  });
