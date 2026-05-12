import { fromBuffer } from 'file-type';

// Note: `file-type` v16.5.4 is pinned because v17+ is ESM-only and would
// require a TypeScript build retargeting. A separate v21 may be installed
// transitively via @nestjs/common — we deliberately use the top-level v16
// here and ignore the transitive copy. Do NOT consolidate versions without
// first verifying the ESM compatibility story.

export interface MimeValidationResult {
  ok: boolean;
  detectedMime: string | null;
  reason?: string;
}

/**
 * Validate that a file's actual bytes match an expected MIME type from
 * a fixed allow-list.
 *
 * Uses `file-type` to read magic bytes from the start of the buffer. This
 * defends against clients sending a spoofed `Content-Type` header (the
 * multipart-declared MIME, which arrives as `file.mimetype` via Multer).
 *
 * @param buffer - The file buffer. Only the first ~64 bytes are typically read,
 *                 but pass the full buffer when memory permits.
 * @param declaredMime - The MIME declared in the multipart Content-Type
 * @param allowed - List of MIME strings we're willing to accept at all
 */
export async function validateFileMime(
  buffer: Buffer,
  declaredMime: string,
  allowed: string[],
): Promise<MimeValidationResult> {
  if (buffer.length === 0) {
    return {
      ok: false,
      detectedMime: null,
      reason: 'File is empty',
    };
  }

  let detected;
  try {
    detected = await fromBuffer(buffer);
  } catch (err) {
    return {
      ok: false,
      detectedMime: null,
      reason: `MIME detection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!detected) {
    return {
      ok: false,
      detectedMime: null,
      reason: 'File MIME type could not be detected from contents',
    };
  }

  if (!allowed.includes(detected.mime)) {
    return {
      ok: false,
      detectedMime: detected.mime,
      reason: `Detected MIME ${detected.mime} is not allowed`,
    };
  }

  if (detected.mime !== declaredMime) {
    return {
      ok: false,
      detectedMime: detected.mime,
      reason: `Declared MIME ${declaredMime} does not match detected ${detected.mime} (mismatch)`,
    };
  }

  return {
    ok: true,
    detectedMime: detected.mime,
  };
}
