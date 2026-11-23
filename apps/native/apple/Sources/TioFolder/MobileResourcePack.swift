import CryptoKit
import Foundation

/// The host supplies its compiled-in verification key and persists the highest activated
/// revision per channel and ABI. Only bundled translation keys may receive new values.
public struct MobileResourcePack: Decodable, Sendable {
    public enum UpdateError: Error { case invalidSignature, unsupportedFormat, wrongChannel, incompatibleHost, staleRevision, unsupportedResource }
    public let revision: Int
    public let translations: [String: [String: String]]
    private let format: Int
    private let kind: String
    private let channel: String
    private let abi: Int

    private struct Envelope: Decodable {
        let payload: Data
        let signature: Data
    }

    public static func verified(_ data: Data, publicKey: Data, channel: String, hostABI: Int,
                                activeRevision: Int, bundledKeys: Set<String>) throws -> Self {
        let decoder = JSONDecoder()
        let envelope = try decoder.decode(Envelope.self, from: data)
        let key = try Curve25519.Signing.PublicKey(rawRepresentation: publicKey)
        guard key.isValidSignature(envelope.signature, for: envelope.payload) else {
            throw UpdateError.invalidSignature
        }
        let pack = try decoder.decode(Self.self, from: envelope.payload)
        guard pack.format == 1, pack.kind == "translations" else { throw UpdateError.unsupportedFormat }
        guard pack.channel == channel else { throw UpdateError.wrongChannel }
        guard pack.abi == hostABI else { throw UpdateError.incompatibleHost }
        guard pack.revision > activeRevision else { throw UpdateError.staleRevision }
        guard pack.translations.allSatisfy({ language, entries in
            ["en", "zh"].contains(language) && Set(entries.keys).isSubset(of: bundledKeys)
        }) else { throw UpdateError.unsupportedResource }
        return pack
    }
}
