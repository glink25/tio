#!/bin/bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:$PATH"
cd "$PROJECT_DIR/../.."
[[ "${PLATFORM_NAME:?}" == iphoneos && "${ARCHS:?}" == arm64 && "${CONFIGURATION:?}" == release ]]
export IPHONEOS_DEPLOYMENT_TARGET
cargo build --locked --lib --release --target aarch64-apple-ios --features tauri/custom-protocol
tio_target_dir="${CARGO_TARGET_DIR:-target}"
mkdir -p "$PROJECT_DIR/Externals/arm64/release"
cp "$tio_target_dir/aarch64-apple-ios/release/libtio_native.a" "$PROJECT_DIR/Externals/arm64/release/libapp.a"
