#!/usr/bin/env node

import { reportKnoloMcpFailure, startKnoloMcpCli } from '../dist/cli.js';

startKnoloMcpCli().catch((error) => {
  reportKnoloMcpFailure(error);
});
