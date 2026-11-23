use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, error::Error, fs, path::PathBuf};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Index {
    version: String,
    channel: String,
    artifacts: Vec<Artifact>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Artifact {
    target: String,
    file: String,
}

fn run() -> Result<(), Box<dyn Error>> {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.len() != 2 {
        return Err("Usage: tio-release artifacts.json output-directory".into());
    }
    let index_path = PathBuf::from(&arguments[0]);
    let directory = index_path.parent().ok_or("Missing artifact directory")?;
    let index: Index = serde_json::from_slice(&fs::read(&index_path)?)?;
    let version = semver::Version::parse(&index.version)?;
    if std::env::var("GITHUB_REF_TYPE").as_deref() == Ok("tag") {
        let tag = std::env::var("GITHUB_REF_NAME")?;
        if tag != format!("v{version}") {
            return Err("Release tag and application version differ".into());
        }
    }
    let encoded_key = std::env::var("TIO_UPDATER_PUBLIC_KEY")?;
    let key = PublicKey::decode(&String::from_utf8(STANDARD.decode(encoded_key.trim())?)?)?;
    let mut platforms = BTreeMap::new();
    let mut checksums = BTreeMap::new();
    let required: &[&str] = match index.channel.as_str() {
        "macos-direct" => &["darwin-aarch64", "darwin-x86_64"],
        "windows-direct" => &["windows-x86_64"],
        "linux-direct" => &["linux-x86_64"],
        _ => return Err("Unknown desktop channel".into()),
    };
    for artifact in index.artifacts {
        if !required.contains(&artifact.target.as_str()) {
            return Err("Artifact belongs to another channel".into());
        }
        if !matches!(
            artifact.target.as_str(),
            "darwin-aarch64" | "darwin-x86_64" | "windows-x86_64" | "linux-x86_64"
        ) || artifact.file.is_empty()
            || artifact.file == "."
            || artifact.file == ".."
            || !artifact
                .file
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        {
            return Err("Invalid updater target or artifact filename".into());
        }
        let bytes = fs::read(directory.join(&artifact.file))?;
        let encoded_signature =
            fs::read_to_string(directory.join(format!("{}.sig", artifact.file)))?;
        let signature = Signature::decode(&String::from_utf8(
            STANDARD.decode(encoded_signature.trim())?,
        )?)?;
        key.verify(&bytes, &signature, true)?;
        let signed_version = signature
            .trusted_comment()
            .split('\t')
            .find_map(|field| field.strip_prefix("version:"))
            .ok_or("Artifact signature does not bind a version")?;
        if semver::Version::parse(signed_version.trim_start_matches('v'))? != version {
            return Err("Signed artifact version differs from the release version".into());
        }
        let url = format!(
            "https://github.com/glink25/tio/releases/download/dist%2F{version}%2F{}/{}",
            index.channel, artifact.file
        );
        if platforms
            .insert(
                artifact.target,
                json!({"url":url,"signature":encoded_signature.trim()}),
            )
            .is_some()
        {
            return Err("Duplicate updater target".into());
        }
        checksums.insert(artifact.file, format!("{:x}", Sha256::digest(&bytes)));
    }
    for target in required {
        if !platforms.contains_key(*target) {
            return Err(format!("Missing updater artifact for {target}").into());
        }
    }
    let output = PathBuf::from(&arguments[1]);
    fs::create_dir_all(&output)?;
    let manifest = json!({"version":version.to_string(),"platforms":platforms});
    fs::write(
        output.join("desktop-updates.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    let checksum_text = checksums
        .into_iter()
        .map(|(file, sum)| format!("{sum}  {file}\n"))
        .collect::<String>();
    fs::write(output.join("SHA256SUMS"), checksum_text)?;
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
