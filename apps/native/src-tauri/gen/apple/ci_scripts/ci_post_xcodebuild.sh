#!/bin/bash
set -euo pipefail
[[ "${CI_XCODEBUILD_EXIT_CODE:?}" == "0" ]] || exit 1
[[ "${CI_XCODEBUILD_ACTION:?}" == "archive" ]] || exit 0
if [[ "${CI_PRODUCT_PLATFORM:?}" == "iOS" ]]; then
  cd "$CI_PRIMARY_REPOSITORY_PATH"
  tio_output="$CI_WORKSPACE_PATH/tio-release"
  mkdir -p "$tio_output"
  node apps/native/release/cloud-upload.mjs "$tio_output"
  exit 0
fi
[[ "$CI_PRODUCT_PLATFORM" == "macOS" ]] || exit 1
cd "$CI_PRIMARY_REPOSITORY_PATH"
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:$PATH"
node apps/native/version.mjs --check-tag
tio_version=$(node -p 'require("./apps/native/package.json").version')
tio_build=$(node -p 'require("./apps/native/package.json").buildNumber')
tio_root="${CI_DEVELOPER_ID_SIGNED_APP_PATH:?Developer ID export is required}"
if [[ "$tio_root" == *.app && -d "$tio_root" ]]; then
  tio_app="$tio_root"
else
  shopt -s nullglob
  tio_apps=("$tio_root/"*.app)
  [[ ${#tio_apps[@]} == 1 ]] || { echo "Expected one Developer ID application"; exit 1; }
  tio_app="${tio_apps[0]}"
fi
tio_actual_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$tio_app/Contents/Info.plist")
tio_actual_build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$tio_app/Contents/Info.plist")
[[ "$tio_actual_version" == "${tio_version%%-*}" && "$tio_actual_build" == "$tio_build" ]] || {
  echo "Exported application version differs from the native package"; exit 1;
}
codesign --verify --deep --strict "$tio_app"
tio_output="$CI_WORKSPACE_PATH/tio-release"
mkdir -p "$tio_output"
umask 077
tio_key=""
trap '[[ -z "$tio_key" ]] || rm -f "$tio_key"' EXIT
if ! xcrun stapler validate "$tio_app"; then
  tio_key=$(mktemp "$CI_WORKSPACE_PATH/tio-notary.XXXXXX")
  printf '%s' "${TIO_NOTARY_KEY_BASE64:?}" | base64 --decode > "$tio_key"
  ditto -c -k --keepParent "$tio_app" "$CI_WORKSPACE_PATH/tio-notarization.zip"
  xcrun notarytool submit "$CI_WORKSPACE_PATH/tio-notarization.zip"     --key "$tio_key" --key-id "${TIO_NOTARY_KEY_ID:?}" --issuer "${TIO_NOTARY_ISSUER:?}"     --wait --output-format json > "$tio_output/notarization.json"
  xcrun stapler staple "$tio_app"
fi
xcrun stapler validate "$tio_app"
spctl --assess --type execute --verbose "$tio_app"
tio_archive="Tio_${tio_version}_macos.app.tar.gz"
tar -czf "$tio_output/$tio_archive" -C "$(dirname "$tio_app")" "$(basename "$tio_app")"
corepack pnpm --filter @tio/native exec tauri signer sign --app-version "$tio_version" "$tio_output/$tio_archive"
ditto -c -k --keepParent "$tio_app" "$tio_output/Tio_${tio_version}_macos.zip"
tio_executable=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$tio_app/Contents/Info.plist")
tio_architectures=$(lipo -archs "$tio_app/Contents/MacOS/$tio_executable")
node --input-type=module - "$tio_version" "$tio_archive" "$tio_architectures" "$tio_output/macos-artifacts.json" <<'JS'
import { writeFileSync } from 'node:fs';
const [version, file, architectures, output] = process.argv.slice(2);
const targets = { arm64: 'darwin-aarch64', x86_64: 'darwin-x86_64' };
const artifacts = architectures.trim().split(/\s+/).map((arch) => {
  if (!targets[arch]) throw new Error('Unsupported macOS architecture');
  return { target: targets[arch], file };
});
writeFileSync(output, JSON.stringify({ version, artifacts }, null, 2));
JS

node apps/native/release/cloud-upload.mjs "$tio_output"
