use base64::{engine::general_purpose::STANDARD, Engine};
#[cfg(not(target_os = "ios"))]
use ed25519_dalek::Signature;
#[cfg(not(target_os = "ios"))]
pub use ed25519_dalek::VerifyingKey;
#[cfg(target_os = "ios")]
pub struct VerifyingKey([u8; 32]);
use serde::{de::DeserializeOwned, Deserialize};

#[derive(Deserialize)]
pub struct Envelope {
    pub payload: String,
    pub signature: String,
}

pub fn public_key() -> Result<VerifyingKey, &'static str> {
    let bytes: [u8; 32] = STANDARD
        .decode(env!("TIO_COMPILED_RESOURCE_KEY"))
        .map_err(|_| "invalid")?
        .try_into()
        .map_err(|_| "invalid")?;
    #[cfg(not(target_os = "ios"))]
    return VerifyingKey::from_bytes(&bytes).map_err(|_| "invalid");
    #[cfg(target_os = "ios")]
    Ok(VerifyingKey(bytes))
}
pub fn decode<T: DeserializeOwned>(
    data: &str,
    limit: usize,
    key: &VerifyingKey,
) -> Result<T, &'static str> {
    if data.len() > limit {
        return Err("invalid");
    }
    let envelope: Envelope = serde_json::from_str(data).map_err(|_| "invalid")?;
    let payload = STANDARD.decode(envelope.payload).map_err(|_| "invalid")?;
    let signature: [u8; 64] = STANDARD
        .decode(envelope.signature)
        .map_err(|_| "invalid")?
        .try_into()
        .map_err(|_| "invalid")?;
    verify_signature(key, &signature, &payload)?;
    serde_json::from_slice(&payload).map_err(|_| "invalid")
}
#[cfg(not(target_os = "ios"))]
fn verify_signature(
    key: &VerifyingKey,
    signature: &[u8; 64],
    payload: &[u8],
) -> Result<(), &'static str> {
    key.verify_strict(payload, &Signature::from_bytes(signature))
        .map_err(|_| "signature")
}

#[cfg(target_os = "ios")]
type Verify = unsafe extern "C" fn(*const u8, *const u8, *const u8, usize) -> bool;

#[cfg(target_os = "ios")]
static VERIFY: std::sync::OnceLock<Verify> = std::sync::OnceLock::new();

#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn tio_register_update_verifier(verify: Verify) {
    let _ = VERIFY.set(verify);
}

#[cfg(target_os = "ios")]
fn verify_signature(
    key: &VerifyingKey,
    signature: &[u8; 64],
    payload: &[u8],
) -> Result<(), &'static str> {
    let verify = VERIFY.get().ok_or("unavailable")?;
    // These buffers stay alive for the synchronous CryptoKit verification.
    unsafe {
        verify(
            key.0.as_ptr(),
            signature.as_ptr(),
            payload.as_ptr(),
            payload.len(),
        )
    }
    .then_some(())
    .ok_or("signature")
}

pub fn channel() -> Option<&'static str> {
    Some(env!("TIO_COMPILED_CHANNEL"))
}
