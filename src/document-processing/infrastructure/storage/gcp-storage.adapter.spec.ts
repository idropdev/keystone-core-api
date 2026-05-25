import { GcpStorageAdapter } from './gcp-storage.adapter';

const mockConfigService = {
  getOrThrow: jest.fn().mockImplementation((key: string) => {
    const config: Record<string, string> = {
      'documentProcessing.gcp.storage.bucket': 'test-bucket',
      'documentProcessing.gcp.storage.rawPrefix': 'raw/',
      'documentProcessing.gcp.storage.processedPrefix': 'processed/',
    };
    if (key in config) return config[key];
    throw new Error(`Config key not found: ${key}`);
  }),
};

describe('GcpStorageAdapter.readRaw', () => {
  let adapter: GcpStorageAdapter;
  let mockStorage: any;
  let mockBucket: any;
  let mockFile: any;

  beforeEach(() => {
    mockFile = {
      download: jest.fn().mockResolvedValue([Buffer.from('pdf-bytes')]),
      exists: jest.fn().mockResolvedValue([true]),
    };
    mockBucket = { file: jest.fn().mockReturnValue(mockFile) };
    mockStorage = { bucket: jest.fn().mockReturnValue(mockBucket) };

    adapter = new GcpStorageAdapter(mockConfigService as any);
    (adapter as any).storage = mockStorage;
    (adapter as any).bucketName = 'test-bucket';
  });

  it('should download file bytes from a gs:// URI', async () => {
    const buf = await adapter.readRaw(
      'gs://test-bucket/raw/user-1/doc-abc.pdf',
    );

    expect(mockStorage.bucket).toHaveBeenCalledWith('test-bucket');
    expect(mockBucket.file).toHaveBeenCalledWith('raw/user-1/doc-abc.pdf');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe('pdf-bytes');
  });

  it('should throw if URI is not gs://', async () => {
    await expect(
      adapter.readRaw('https://example.com/foo.pdf'),
    ).rejects.toThrow(/Invalid GCS URI/);
  });

  it('should throw if file does not exist', async () => {
    mockFile.exists.mockResolvedValue([false]);
    await expect(
      adapter.readRaw('gs://test-bucket/raw/missing.pdf'),
    ).rejects.toThrow(/not found/);
  });
});
