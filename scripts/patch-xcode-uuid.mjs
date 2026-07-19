import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packagePath = require.resolve('xcode/package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const installedRange = packageJson.dependencies?.uuid;

if (installedRange === '^11.1.1') process.exit(0);
if (installedRange !== '^7.0.3') {
  throw new Error(`Unexpected xcode uuid range: ${String(installedRange)}`);
}

packageJson.dependencies.uuid = '^11.1.1';
writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
