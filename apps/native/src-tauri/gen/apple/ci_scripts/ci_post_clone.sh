#!/bin/sh
set -eu
case "${CI_PRODUCT_PLATFORM:?}" in
  iOS) tio_channel=ios-store ;;
  *) exit 1 ;;
esac
case "${CI_TAG:?Apple host tags only}" in
  host/"$tio_channel"/v*) tio_source_tag="${CI_TAG#host/$tio_channel/}" ;;
  *) echo "Use the platform host tag"; exit 1 ;;
esac
cd "$CI_PRIMARY_REPOSITORY_PATH"
export HOMEBREW_NO_AUTO_UPDATE=1
brew install node@24 rustup xcodegen gh
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix rustup)/bin:$HOME/.cargo/bin:$PATH"
command -v corepack >/dev/null || npm install --global corepack
corepack enable
rustup toolchain install 1.93.1 --profile minimal
rustup default 1.93.1
rustup target add aarch64-apple-ios
node scripts/install-ci.mjs
export GITHUB_REF_TYPE=tag
export GITHUB_REF_NAME="$tio_source_tag"
node apps/native/version.mjs --prepare-host --prepare-apple --check-tag
node apps/native/updates/prepare-key.mjs
corepack pnpm --filter @tio/native build:kernel
VITE_TIO_PLATFORM=ios VITE_TIO_CHANNEL=ios-store corepack pnpm --filter @tio/native build --emptyOutDir --outDir dist/ios
