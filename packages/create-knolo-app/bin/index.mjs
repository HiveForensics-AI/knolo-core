#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.resolve(__dirname, '../template');

function printUsage() {
  console.log('Usage: create-knolo-app <project-name>');
}

function validateName(name) {
  return /^[a-z0-9][a-z0-9-_]*$/i.test(name);
}

function scaffold(projectName) {
  const destination = path.resolve(process.cwd(), projectName);
  if (existsSync(destination)) {
    throw new Error(`Target directory already exists: ${projectName}`);
  }

  mkdirSync(destination, { recursive: true });
  cpSync(TEMPLATE_DIR, destination, { recursive: true });

  const packageJsonPath = path.join(destination, 'package.json');
  const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  parsed.name = projectName;
  writeFileSync(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

  console.log(`\n✔ Created ${projectName}`);
  console.log('\nNext steps:');
  console.log(`  cd ${projectName}`);
  console.log('  npm install');
  console.log('  npm run dev');
  console.log('\nIf this is your first run, build the knowledge pack once:');
  console.log('  npm run knolo:build\n');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(args.length === 1 ? 0 : 1);
  }

  const [projectName] = args;
  if (!validateName(projectName)) {
    console.error('Project name must start with a letter/number and only include letters, numbers, - or _.');
    process.exit(1);
  }

  try {
    scaffold(projectName);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
