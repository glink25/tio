#!/bin/bash
set -euo pipefail
[[ "${CI_XCODEBUILD_EXIT_CODE:?}" == "0" ]] || exit 1
[[ "${CI_XCODEBUILD_ACTION:?}" == "archive" ]] || exit 0
# Xcode Cloud retains signed App Store archives and handles TestFlight upload.
# No Apple installation artifact or credential is sent to GitHub.
[[ -d "${CI_APP_STORE_SIGNED_APP_PATH:?App Store Connect export is required}" ]] || {
  echo "Signed store export missing"; exit 1;
}
printf 'App Store archive prepared by Xcode Cloud: build %s\n' "${CI_BUILD_NUMBER:?}"
