import { validateFileMime } from './mime-validator';

// Minimal valid PNG: 8-byte signature + IHDR chunk (4-byte length, 4-byte
// type, 13-byte data, 4-byte CRC). file-type v16 reads into the first chunk
// header, so the bare 8-byte signature is too short.
const MINIMAL_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG sig
  Buffer.from([0x00, 0x00, 0x00, 0x0d]), // IHDR chunk length = 13
  Buffer.from([0x49, 0x48, 0x44, 0x52]), // 'IHDR'
  Buffer.alloc(13), // IHDR data (width/height/bit-depth etc.)
  Buffer.alloc(4), // CRC placeholder
]);

describe('validateFileMime', () => {
  const ALLOWED = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'image/gif',
  ];

  it('should accept a PDF buffer with matching Content-Type', async () => {
    const buffer = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
    ]);
    const result = await validateFileMime(buffer, 'application/pdf', ALLOWED);
    expect(result.ok).toBe(true);
    expect(result.detectedMime).toBe('application/pdf');
  });

  it('should accept a JPEG buffer with matching Content-Type', async () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = await validateFileMime(buffer, 'image/jpeg', ALLOWED);
    expect(result.ok).toBe(true);
  });

  it('should accept a PNG buffer with matching Content-Type', async () => {
    const result = await validateFileMime(MINIMAL_PNG, 'image/png', ALLOWED);
    expect(result.ok).toBe(true);
  });

  it('should reject when declared Content-Type does not match detected', async () => {
    // PNG bytes, but declared as PDF
    const result = await validateFileMime(
      MINIMAL_PNG,
      'application/pdf',
      ALLOWED,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('mismatch');
    expect(result.detectedMime).toBe('image/png');
  });

  it('should reject when detected MIME is not in the allow list', async () => {
    // ZIP magic bytes (PK\x03\x04) — detected but not allowed
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const result = await validateFileMime(buffer, 'application/zip', ALLOWED);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not allowed');
  });

  it('should reject when no MIME could be detected (unknown bytes)', async () => {
    const buffer = Buffer.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    ]);
    const result = await validateFileMime(buffer, 'application/pdf', ALLOWED);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('could not be detected');
  });

  it('should reject when buffer is empty', async () => {
    const result = await validateFileMime(
      Buffer.alloc(0),
      'application/pdf',
      ALLOWED,
    );
    expect(result.ok).toBe(false);
  });
});
