//! HTTP request body decompression.
//!
//! Supports gzip, deflate, brotli (`br`), and zstd.
//! Falls back to identity (no decompression) when `Content-Encoding` is absent
//! or unrecognised. Magic byte sniffing is used as a secondary detection method
//! when the header is missing or misleading (e.g. some proxies strip headers).

use bytes::Bytes;

use crate::errors::AppError;

enum Encoding {
    Identity,
    Gzip,
    Deflate,
    Br,
    Zstd,
}

const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];
const ZSTD_MAGIC: [u8; 4] = [0x28, 0xb5, 0x2f, 0xfd];
/// zlib/deflate streams start with 0x78 followed by 0x01, 0x9c, 0xda, or 0x5e.
const DEFLATE_MAGIC: u8 = 0x78;

fn detect(header: Option<&str>, body: &[u8]) -> Encoding {
    // Content-Encoding header takes precedence over magic byte sniffing.
    match header {
        Some(h) => match h.trim().to_lowercase().as_str() {
            "gzip" | "x-gzip" => return Encoding::Gzip,
            "deflate" => return Encoding::Deflate,
            "br" => return Encoding::Br,
            "zstd" => return Encoding::Zstd,
            "identity" | "" => return Encoding::Identity,
            other => {
                tracing::warn!(encoding = other, "Unknown Content-Encoding — treating as identity");
                return Encoding::Identity;
            }
        },
        None => {}
    }

    // Magic byte sniffing fallback when no header is present.
    if body.starts_with(&GZIP_MAGIC) {
        return Encoding::Gzip;
    }
    if body.len() >= 4 && body[..4] == ZSTD_MAGIC {
        return Encoding::Zstd;
    }
    if body.first() == Some(&DEFLATE_MAGIC) {
        return Encoding::Deflate;
    }

    Encoding::Identity
}

/// Decompress `body` based on the `Content-Encoding` header (or magic bytes).
///
/// Returns `AppError::BadRequest` on decompression failure so the caller
/// responds with 400 without leaking internal error details.
pub fn decompress(body: Bytes, content_encoding: Option<&str>) -> Result<Bytes, AppError> {
    let original_len = body.len();
    let result = match detect(content_encoding, &body) {
        Encoding::Identity => return Ok(body),
        Encoding::Gzip => decompress_gzip(body),
        Encoding::Deflate => decompress_deflate(body),
        Encoding::Br => decompress_br(body),
        Encoding::Zstd => decompress_zstd(body),
    }?;

    tracing::debug!(
        compressed_bytes = original_len,
        decompressed_bytes = result.len(),
        "body decompressed"
    );
    Ok(result)
}

fn decompress_gzip(body: Bytes) -> Result<Bytes, AppError> {
    use flate2::read::GzDecoder;
    use std::io::Read;

    let mut out = Vec::new();
    GzDecoder::new(body.as_ref())
        .read_to_end(&mut out)
        .map_err(|e| AppError::BadRequest(format!("gzip decompression failed: {e}")))?;
    Ok(Bytes::from(out))
}

fn decompress_deflate(body: Bytes) -> Result<Bytes, AppError> {
    use flate2::read::DeflateDecoder;
    use std::io::Read;

    let mut out = Vec::new();
    DeflateDecoder::new(body.as_ref())
        .read_to_end(&mut out)
        .map_err(|e| AppError::BadRequest(format!("deflate decompression failed: {e}")))?;
    Ok(Bytes::from(out))
}

fn decompress_br(body: Bytes) -> Result<Bytes, AppError> {
    use std::io::Read;

    let mut out = Vec::new();
    brotli::Decompressor::new(body.as_ref(), 4096)
        .read_to_end(&mut out)
        .map_err(|e| AppError::BadRequest(format!("brotli decompression failed: {e}")))?;
    Ok(Bytes::from(out))
}

fn decompress_zstd(body: Bytes) -> Result<Bytes, AppError> {
    zstd::decode_all(body.as_ref())
        .map(Bytes::from)
        .map_err(|e| AppError::BadRequest(format!("zstd decompression failed: {e}")))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn gzip_compress(input: &[u8]) -> Vec<u8> {
        use flate2::write::GzEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut enc = GzEncoder::new(Vec::new(), Compression::default());
        enc.write_all(input).unwrap();
        enc.finish().unwrap()
    }

    fn deflate_compress(input: &[u8]) -> Vec<u8> {
        use flate2::write::DeflateEncoder;
        use flate2::Compression;
        use std::io::Write;

        let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
        enc.write_all(input).unwrap();
        enc.finish().unwrap()
    }

    const PAYLOAD: &[u8] = br#"{"sent_at":1700000000000,"events":[]}"#;

    #[test]
    fn identity_passthrough_no_header() {
        let input = Bytes::from_static(PAYLOAD);
        let out = decompress(input.clone(), None).unwrap();
        assert_eq!(out, input);
    }

    #[test]
    fn identity_passthrough_explicit_header() {
        let input = Bytes::from_static(PAYLOAD);
        let out = decompress(input.clone(), Some("identity")).unwrap();
        assert_eq!(out, input);
    }

    #[test]
    fn gzip_via_header() {
        let compressed = Bytes::from(gzip_compress(PAYLOAD));
        let out = decompress(compressed, Some("gzip")).unwrap();
        assert_eq!(out.as_ref(), PAYLOAD);
    }

    #[test]
    fn gzip_via_magic_bytes() {
        // No header — detected from magic bytes.
        let compressed = Bytes::from(gzip_compress(PAYLOAD));
        let out = decompress(compressed, None).unwrap();
        assert_eq!(out.as_ref(), PAYLOAD);
    }

    #[test]
    fn gzip_x_gzip_alias() {
        let compressed = Bytes::from(gzip_compress(PAYLOAD));
        let out = decompress(compressed, Some("x-gzip")).unwrap();
        assert_eq!(out.as_ref(), PAYLOAD);
    }

    #[test]
    fn deflate_via_header() {
        let compressed = Bytes::from(deflate_compress(PAYLOAD));
        let out = decompress(compressed, Some("deflate")).unwrap();
        assert_eq!(out.as_ref(), PAYLOAD);
    }

    #[test]
    fn unknown_encoding_returns_identity() {
        let input = Bytes::from_static(PAYLOAD);
        let out = decompress(input.clone(), Some("br-unknown")).unwrap();
        assert_eq!(out, input);
    }

    #[test]
    fn invalid_gzip_returns_bad_request() {
        let bad = Bytes::from_static(b"\x1f\x8b\x00not_real_gzip_data");
        let err = decompress(bad, Some("gzip")).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }

    #[test]
    fn invalid_deflate_returns_bad_request() {
        let bad = Bytes::from_static(b"\x78\x9c\x00invalid_deflate");
        let err = decompress(bad, Some("deflate")).unwrap_err();
        assert!(matches!(err, AppError::BadRequest(_)));
    }
}
