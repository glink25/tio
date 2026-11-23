use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
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
    VerifyingKey::from_bytes(&bytes).map_err(|_| "invalid")
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
    let signature =
        Signature::from_slice(&STANDARD.decode(envelope.signature).map_err(|_| "invalid")?)
            .map_err(|_| "invalid")?;
    key.verify_strict(&payload, &signature)
        .map_err(|_| "signature")?;
    serde_json::from_slice(&payload).map_err(|_| "invalid")
}
pub fn channel() -> Option<&'static str> {
    Some(env!("TIO_COMPILED_CHANNEL"))
}
