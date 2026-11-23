#!/bin/sh
set -eu
: "${CI_TAG:?Release tags only}"
cd "$CI_PRIMARY_REPOSITORY_PATH"
export HOMEBREW_NO_AUTO_UPDATE=1
brew install node@24 rustup xcodegen gh
export PATH="$(brew --prefix node@24)/bin:$(brew --prefix rustup)/bin:$HOME/.cargo/bin:$PATH"
command -v corepack >/dev/null || npm install --global corepack
corepack enable
rustup toolchain install 1.93.1 --profile minimal
rustup default 1.93.1
rustup target add aarch64-apple-ios aarch64-apple-darwin x86_64-apple-darwin
node scripts/install-ci.mjs
export GITHUB_REF_TYPE=tag
export GITHUB_REF_NAME="${CI_TAG:?Release tag required}"
node apps/native/version.mjs --prepare-host --prepare-apple --check-tag
node apps/native/updates/prepare-key.mjs
case "${CI_PRODUCT_PLATFORM:?}" in
  iOS)
    corepack pnpm --filter @tio/native build:kernel
    VITE_TIO_PLATFORM=ios VITE_TIO_CHANNEL=ios-store corepack pnpm --filter @tio/native build --emptyOutDir --outDir dist/ios
    ;;
  macOS)
    corepack pnpm --filter @tio/native build:kernel
    VITE_TIO_CHANNEL=macos-direct corepack pnpm --filter @tio/native build --emptyOutDir --outDir dist/desktop
    ;;
  *) exit 1 ;;
esac
