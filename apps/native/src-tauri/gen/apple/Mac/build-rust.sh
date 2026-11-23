#!/bin/bash
set -euo pipefail
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:$PATH"
tio_crate="$PROJECT_DIR/../.."
tio_archives=()
tio_profile="$CONFIGURATION"
if [[ "$CONFIGURATION" == "debug" ]]; then tio_profile=dev; fi
for tio_arch in $ARCHS; do
  case "$tio_arch" in
    arm64) tio_target=aarch64-apple-darwin ;;
    x86_64) tio_target=x86_64-apple-darwin ;;
    *) exit 1 ;;
  esac
  MACOSX_DEPLOYMENT_TARGET="$MACOSX_DEPLOYMENT_TARGET" cargo build     --manifest-path "$tio_crate/Cargo.toml" --locked --lib --features tauri/custom-protocol --target "$tio_target"     --profile "$tio_profile"
  tio_archives+=("$tio_crate/target/$tio_target/$CONFIGURATION/libtio_native.a")
done
mkdir -p "$PROJECT_DIR/Externals/macos/$CONFIGURATION"
lipo -create "${tio_archives[@]}" -output "$PROJECT_DIR/Externals/macos/$CONFIGURATION/libapp_macos.a"
