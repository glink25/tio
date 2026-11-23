import { apple, list } from './apple-api.mjs';
import { googleToken } from './google-api.mjs';
import { changeIndex } from './index-github.mjs';
for (const track of ['stable', 'preview'])
  for (const channel of ['ios-store', 'android-play']) {
    await changeIndex(track, channel, async (current) => {
      if (!current?.host || ['available', 'rejected'].includes(current.host.status)) return null;
      let status = 'processing';
      if (channel === 'ios-store') {
        if (!process.env.ASC_APP_ID || !process.env.ASC_PRIVATE_KEY_BASE64) return null;
        if (track === 'preview') {
          if (!current.host.storeBuildId) return null;
          const build = (await apple('/v1/builds/' + current.host.storeBuildId)).data;
          if (String(build.attributes.version) !== String(current.host.build)) return null;
          if (build.attributes.processingState === 'VALID') {
            const details = (await apple('/v1/builds/' + build.id + '/betaBuildDetails')).data;
            if (
              details.attributes.internalBuildState === 'IN_BETA_TESTING' ||
              details.attributes.externalBuildState === 'IN_BETA_TESTING'
            )
              status = 'available';
          }
        } else {
          const versions = await list(
            `/v1/apps/${process.env.ASC_APP_ID}/appStoreVersions?filter[platform]=IOS&filter[versionString]=${current.host.version.split('-')[0]}`,
          );
          const version = versions[0];
          if (!version) return null;
          const relation = (await apple('/v1/appStoreVersions/' + version.id + '/build')).data;
          if (String(relation?.attributes.version) !== String(current.host.build)) return null;
          if (version.attributes.appVersionState === 'READY_FOR_DISTRIBUTION') status = 'available';
          else if (
            ['REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY', 'DEVELOPER_REJECTED'].includes(
              version.attributes.appVersionState,
            )
          )
            status = 'rejected';
          else if (['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(version.attributes.appVersionState))
            status = 'review';
        }
      } else {
        const servingType =
          track === 'stable'
            ? process.env.PLAY_PRODUCTION_TRACK_TYPE
            : process.env.PLAY_PREVIEW_TRACK_TYPE;
        if (!process.env.ANDROID_PLAY_SERVICE_ACCOUNT_BASE64 || !servingType) return null;
        const token = await googleToken('https://www.googleapis.com/auth/playdeveloperreporting');
        const response = await fetch(
          'https://playdeveloperreporting.googleapis.com/v1beta1/apps/com.glink25.tio:fetchReleaseFilterOptions',
          { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) },
        );
        if (!response.ok)
          throw new Error('Cannot verify serving Play releases: ' + response.status);
        const body = await response.json();
        if (
          body.tracks?.some(
            (t) =>
              t.type === servingType &&
              t.servingReleases?.some((r) => r.versionCodes?.includes(String(current.host.build))),
          )
        )
          status = 'available';
      }
      return current.host.status === status
        ? null
        : { ...current, host: { ...current.host, status } };
    });
  }
