import { fromBuffer } from 'file-type';

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
 * @param buffer - The full file buffer or at least the first ~4KB
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

  const detected = await fromBuffer(buffer);
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
