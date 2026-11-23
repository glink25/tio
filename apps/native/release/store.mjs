import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { apple, list } from './apple-api.mjs';
import { hash, readJSON } from './lib.mjs';
const directory = process.argv[2];
const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
if (receipt.sourceCommit !== process.env.TIO_SOURCE_COMMIT || receipt.mode !== 'host')
  throw new Error('Store receipt mismatch');
for (const [name, digest] of Object.entries(receipt.checksums))
  if (!/^[\w.-]+$/.test(name) || hash(await readFile(join(directory, name))) !== digest)
    throw new Error('Store artifact changed');
if (receipt.channel === 'android-play') {
  const bundles = (await readdir(directory)).filter((n) => n.endsWith('.aab'));
  if (bundles.length !== 1) throw new Error('Expected one signed Play bundle');
  execFileSync('jarsigner', ['-verify', join(directory, bundles[0])], { stdio: 'inherit' });
  execFileSync(
    'node',
    [
      'apps/native/release/play.mjs',
      join(directory, bundles[0]),
      join(directory, 'store-state.json'),
    ],
    { stdio: 'inherit' },
  );
} else if (receipt.channel === 'ios-store') {
  const app = process.env.ASC_APP_ID;
  if (!app) throw new Error('Configure ASC_APP_ID');
  const deadline = Date.now() + 30 * 60 * 1000;
  let build;
  while (!build) {
    const builds = await list(
      `/v1/builds?filter[app]=${app}&filter[version]=${receipt.hostBuild}&limit=200`,
    );
    for (const candidate of builds) {
      const prerelease = (await apple('/v1/builds/' + candidate.id + '/preReleaseVersion')).data;
      if (
        prerelease.attributes.version !== receipt.version.split('-')[0] ||
        prerelease.attributes.platform !== 'IOS'
      )
        continue;
      if (candidate.attributes.processingState === 'VALID') {
        build = candidate;
        break;
      }
      if (['FAILED', 'INVALID'].includes(candidate.attributes.processingState))
        throw new Error('App Store rejected the binary');
    }
    if (!build) {
      if (Date.now() > deadline)
        throw new Error('App Store binary is not ready; retry the platform release');
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  if (receipt.track === 'stable') {
    const versionString = receipt.version.split('-')[0];
    let version = (
      await list(
        `/v1/apps/${app}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${versionString}`,
      )
    )[0];
    if (!version)
      version = (
        await apple('/v1/appStoreVersions', {
          data: {
            type: 'appStoreVersions',
            attributes: { platform: 'IOS', versionString, releaseType: 'AFTER_APPROVAL' },
            relationships: { app: { data: { type: 'apps', id: app } } },
          },
        })
      ).data;
    const state = version.attributes.appVersionState;
    if (['REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY', 'DEVELOPER_REJECTED'].includes(state))
      throw new Error('Resolve the store rejection before retrying submission');
    if (['PREPARE_FOR_SUBMISSION', 'READY_FOR_REVIEW'].includes(state)) {
      const notes = readJSON('apps/native/release-plan.json').storeNotes['ios-store'];
      const locales = await list(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
      let localized = false;
      for (const locale of locales)
        if (typeof notes[locale.attributes.locale] === 'string') {
          await apple(
            '/v1/appStoreVersionLocalizations/' + locale.id,
            {
              data: {
                type: 'appStoreVersionLocalizations',
                id: locale.id,
                attributes: { whatsNew: notes[locale.attributes.locale] },
              },
            },
            'PATCH',
          );
          localized = true;
        }
      if (!localized) throw new Error('Configure release notes for the App Store listing locales');
      await apple(
        `/v1/appStoreVersions/${version.id}/relationships/build`,
        { data: { type: 'builds', id: build.id } },
        'PATCH',
      );
      const reviews = await list(
        `/v1/apps/${app}/reviewSubmissions?include=appStoreVersionForReview,items&limit=200`,
      );
      let review = reviews.find(
        (r) =>
          r.relationships.appStoreVersionForReview?.data?.id === version.id &&
          !['COMPLETE', 'CANCELING', 'COMPLETING'].includes(r.attributes.state),
      );
      if (!review)
        review = reviews.find(
          (r) =>
            r.attributes.state === 'READY_FOR_REVIEW' &&
            (!r.attributes.platform || r.attributes.platform === 'IOS') &&
            Array.isArray(r.relationships.items?.data) &&
            r.relationships.items.data.length === 0,
        );
      const hasVersion = review?.relationships.appStoreVersionForReview?.data?.id === version.id;
      if (!review) {
        review = (
          await apple('/v1/reviewSubmissions', {
            data: {
              type: 'reviewSubmissions',
              relationships: { app: { data: { type: 'apps', id: app } } },
            },
          })
        ).data;
      }
      if (!hasVersion) {
        await apple('/v1/reviewSubmissionItems', {
          data: {
            type: 'reviewSubmissionItems',
            relationships: {
              reviewSubmission: { data: { type: 'reviewSubmissions', id: review.id } },
              appStoreVersion: { data: { type: 'appStoreVersions', id: version.id } },
            },
          },
        });
      }
      const items = await list(
        '/v1/reviewSubmissions/' + review.id + '/items?include=appStoreVersion',
      );
      if (items.length !== 1 || items[0].relationships.appStoreVersion?.data?.id !== version.id)
        throw new Error('Review contains unrelated items; refusing to submit them');
      if (review.attributes.state === 'READY_FOR_REVIEW')
        await apple(
          '/v1/reviewSubmissions/' + review.id,
          { data: { type: 'reviewSubmissions', id: review.id, attributes: { submitted: true } } },
          'PATCH',
        );
    }
    const assigned = (await apple('/v1/appStoreVersions/' + version.id + '/build')).data;
    if (assigned?.id !== build.id)
      throw new Error('App Store version is assigned to another build');
  }
  await writeFile(
    join(directory, 'store-state.json'),
    JSON.stringify({
      format: 1,
      channel: receipt.channel,
      version: receipt.version,
      build: receipt.hostBuild,
      status: 'processing',
      buildId: build.id,
    }),
  );
} else throw new Error('Not a store channel');
receipt.checksums['store-state.json'] = hash(await readFile(join(directory, 'store-state.json')));
await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
