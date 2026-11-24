use sha2::{Digest, Sha256};
fn main() {
    println!("cargo:rerun-if-env-changed=TIO_RESOURCE_PUBLIC_KEY");
    println!("cargo:rerun-if-changed=resource-public-key");
    let key = std::env::var("TIO_RESOURCE_PUBLIC_KEY")
        .or_else(|_| std::fs::read_to_string("resource-public-key"))
        .unwrap_or_default();
    println!("cargo:rustc-env=TIO_COMPILED_RESOURCE_KEY={}", key.trim());
    println!("cargo:rerun-if-env-changed=VITE_TIO_CHANNEL");
    let channel = match std::env::var("CARGO_CFG_TARGET_OS").as_deref() {
        Ok("ios") => "ios-store",
        Ok("macos") => "macos-direct",
        Ok("windows") => "windows-direct",
        Ok("linux") => "linux-direct",
        Ok("android") => "android-play",
        _ => panic!("Unsupported host target"),
    };
    println!("cargo:rustc-env=TIO_COMPILED_CHANNEL={channel}");
    println!("cargo:rerun-if-changed=../host-contract.json");
    let config: serde_json::Value =
        serde_json::from_slice(&std::fs::read("../host-contract.json").expect("host contract"))
            .expect("host contract JSON");
    let contract = serde_json::json!({
        "format":config["format"], "channel":channel,
        "bridgeApiVersion":config["bridgeApiVersion"], "storageEpoch":config["storageEpoch"],
        "reviewEpoch":config["reviewEpochs"][channel].as_u64().unwrap_or(0),
        "capabilities":config["capabilities"], "runtimeTarget":config["runtimeTargets"][channel]
    });
    let contract_id = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&contract).expect("contract bytes"))
    );
    println!("cargo:rustc-env=TIO_COMPILED_CONTRACT_ID={contract_id}");
    println!("cargo:rerun-if-changed=../../../package.json");
    let product: serde_json::Value =
        serde_json::from_slice(&std::fs::read("../../../package.json").expect("product metadata"))
            .expect("product JSON");
    let product_version = product["version"].as_str().expect("product version");
    println!("cargo:rustc-env=TIO_COMPILED_PRODUCT_VERSION={product_version}");
    println!("cargo:rerun-if-changed=../release-plan.json");
    let release: serde_json::Value =
        serde_json::from_slice(&std::fs::read("../release-plan.json").expect("release plan"))
            .expect("release plan JSON");
    println!(
        "cargo:rustc-env=TIO_COMPILED_RUNTIME_REVISION={}",
        release["revision"].as_u64().expect("release revision")
    );
    println!("cargo:rerun-if-env-changed=TIO_UPDATE_TRACK");
    let track = std::env::var("TIO_UPDATE_TRACK").unwrap_or_else(|_| {
        if product_version.split_once('-').is_some() {
            "preview".into()
        } else {
            "stable".into()
        }
    });
    assert!(matches!(track.as_str(), "stable" | "preview"));
    println!("cargo:rustc-env=TIO_COMPILED_UPDATE_TRACK={track}");
    println!("cargo:rerun-if-env-changed=TIO_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-changed=updater-public-key");
    println!(
        "cargo:rustc-env=TIO_COMPILED_UPDATER_KEY={}",
        std::env::var("TIO_UPDATER_PUBLIC_KEY")
            .or_else(|_| std::fs::read_to_string("updater-public-key"))
            .unwrap_or_default()
    );
    println!("cargo:rerun-if-env-changed=VITE_GITHUB_AUTH_URL");
    println!(
        "cargo:rustc-env=TIO_COMPILED_AUTH_URL={}",
        std::env::var("VITE_GITHUB_AUTH_URL")
            .unwrap_or_else(|_| "https://tio-api.linkai.work".into())
    );
    println!("cargo:rerun-if-changed=../package.json");
    let metadata: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string("../package.json").expect("native package metadata"),
    )
    .expect("native package metadata");
    println!(
        "cargo:rustc-env=TIO_COMPILED_APP_VERSION={}",
        metadata["version"].as_str().expect("native version")
    );
    println!(
        "cargo:rustc-env=TIO_COMPILED_BUILD_NUMBER={}",
        metadata["buildNumber"]
            .as_u64()
            .expect("native build number")
    );
    println!("cargo:rerun-if-changed=gen/apple/assets/headless.js");
    let kernel = std::fs::read("gen/apple/assets/headless.js");
    if matches!(
        std::env::var("CARGO_CFG_TARGET_OS").as_deref(),
        Ok("ios" | "android")
    ) {
        assert!(
            kernel.is_ok(),
            "Build the shared native kernel before the mobile host"
        );
    }
    println!(
        "cargo:rustc-env=TIO_COMPILED_KERNEL_HASH={}",
        kernel
            .map(|bytes| format!("{:x}", Sha256::digest(bytes)))
            .unwrap_or_default()
    );
    let platform = match channel {
        "ios-store" => "ios",
        "android-play" => "android",
        _ => "desktop",
    };
    let path = format!("../dist/{platform}/native-contract.json");
    println!("cargo:rerun-if-changed={path}");
    let runtime: Option<serde_json::Value> = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok());
    let identity = runtime
        .as_ref()
        .filter(|meta| meta["contractId"].as_str() == Some(&contract_id))
        .and_then(|meta| meta["runtimeId"].as_str())
        .unwrap_or("");
    if std::env::var("CI").is_ok() {
        assert!(
            !identity.is_empty(),
            "Build the matching native frontend before the host"
        );
    }
    println!("cargo:rustc-env=TIO_COMPILED_RUNTIME_ID={identity}");
    tauri_build::build()
}
