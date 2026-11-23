import { readFileSync, writeFileSync } from 'node:fs';
let metadata = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
const product = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const plan = JSON.parse(readFileSync(new URL('release-plan.json', import.meta.url), 'utf8'));
if (process.argv.includes('--prepare-host')) {
  const cloudBuild =
    process.env.CI_XCODE_CLOUD === 'TRUE' ? Number(process.env.CI_BUILD_NUMBER) : undefined;
  metadata = { ...metadata, version: product.version, buildNumber: cloudBuild ?? plan.hostBuild };
  writeFileSync(new URL('package.json', import.meta.url), JSON.stringify(metadata, null, 2) + '\n');
}
if (
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version) ||
  !Number.isInteger(metadata.buildNumber) ||
  metadata.buildNumber < 1 ||
  metadata.buildNumber > 2100000000
)
  throw new Error('Invalid native application version or build number');
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== 'v' + product.version)
  throw new Error('Release tag must match the native application version');
if (process.argv.includes('--prepare-apple')) {
  writeFileSync(
    new URL('src-tauri/gen/apple/Version.xcconfig', import.meta.url),
    'MARKETING_VERSION = ' +
      metadata.version.split('-')[0] +
      '\nCURRENT_PROJECT_VERSION = ' +
      metadata.buildNumber +
      '\n',
  );
}
