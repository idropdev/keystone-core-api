import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeminiEntityExtractorService } from './gemini-entity-extractor.service';
import { GeminiExtractionResponse } from './gemini-entity-extractor.types';

// Mock the Vertex AI SDK before importing anything that uses it.
const generateContentMock = jest.fn();
jest.mock('@google-cloud/vertexai', () => ({
  VertexAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: generateContentMock,
    }),
  })),
  SchemaType: {
    OBJECT: 'object',
    ARRAY: 'array',
    STRING: 'string',
  },
}));

const EMPTY_RESPONSE: GeminiExtractionResponse = {
  medications: [],
  allergies: [],
  conditions: [],
  doctors: [],
  pharmacies: [],
  insurance_providers: [],
  policy_numbers: [],
  emergency_contacts: [],
  blood_type: null,
};

function geminiResponse(partial: Partial<GeminiExtractionResponse> = {}) {
  return {
    response: {
      candidates: [
        {
          content: {
            parts: [
              { text: JSON.stringify({ ...EMPTY_RESPONSE, ...partial }) },
            ],
          },
        },
      ],
    },
  };
}

describe('GeminiEntityExtractorService', () => {
  let service: GeminiEntityExtractorService;

  beforeEach(async () => {
    generateContentMock.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeminiEntityExtractorService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              const map: Record<string, string> = {
                'documentProcessing.gcp.projectId': 'test-project',
                'documentProcessing.gcp.vertexAi.location': 'us-central1',
                'documentProcessing.gcp.vertexAi.modelName': 'gemini-2.5-flash',
              };
              return map[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get(GeminiEntityExtractorService);
  });

  it('should return an empty array when OCR text is empty', async () => {
    const result = await service.extractEntities('');
    expect(result).toEqual([]);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('should return an empty array when OCR text is whitespace only', async () => {
    const result = await service.extractEntities('   \n  ');
    expect(result).toEqual([]);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('should map a successful Gemini response into ExtractedEntity[]', async () => {
    generateContentMock.mockResolvedValueOnce(
      geminiResponse({
        medications: ['Lisinopril 10mg'],
        conditions: ['Hypertension'],
        blood_type: 'O+',
      }),
    );

    const result = await service.extractEntities('A long medical document.');

    expect(result).toEqual([
      { type: 'medication', mentionText: 'Lisinopril 10mg', confidence: 0.9 },
      { type: 'condition', mentionText: 'Hypertension', confidence: 0.9 },
      { type: 'blood_type', mentionText: 'O+', confidence: 0.9 },
    ]);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('should retry once on transient failure then return mapped entities', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('transient network error'))
      .mockResolvedValueOnce(geminiResponse({ medications: ['Metformin'] }));

    const result = await service.extractEntities('A long medical document.');

    expect(result).toEqual([
      { type: 'medication', mentionText: 'Metformin', confidence: 0.9 },
    ]);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('should return an empty array when Gemini keeps failing after retry', async () => {
    generateContentMock
      .mockRejectedValueOnce(new Error('first failure'))
      .mockRejectedValueOnce(new Error('second failure'));

    const result = await service.extractEntities('A long medical document.');

    expect(result).toEqual([]);
    expect(generateContentMock).toHaveBeenCalledTimes(2);
  });

  it('should return an empty array when Gemini returns malformed JSON', async () => {
    generateContentMock.mockResolvedValueOnce({
      response: {
        candidates: [
          { content: { parts: [{ text: 'this is not json {{{' }] } },
        ],
      },
    });

    const result = await service.extractEntities('A long medical document.');

    expect(result).toEqual([]);
  });

  it('should return an empty array when the first response has no text payload', async () => {
    generateContentMock.mockResolvedValueOnce({
      response: { candidates: [{ content: { parts: [{ text: '' }] } }] },
    });

    const result = await service.extractEntities('A long medical document.');

    expect(result).toEqual([]);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });

  it('should not retry on PERMISSION_DENIED', async () => {
    generateContentMock.mockRejectedValueOnce(new Error('PERMISSION_DENIED'));

    const result = await service.extractEntities('A long medical document.');

    expect(result).toEqual([]);
    expect(generateContentMock).toHaveBeenCalledTimes(1);
  });
});
