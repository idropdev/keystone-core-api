import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VertexAI, SchemaType, GenerativeModel } from '@google-cloud/vertexai';
import { AllConfigType } from '../../../config/config.type';
import { mapGeminiResponseToEntities } from './gemini-response-mapper';
import {
  ExtractedEntity,
  GeminiExtractionResponse,
} from './gemini-entity-extractor.types';

const MIN_OCR_LENGTH = 1; // skip the LLM call below this; >0 means non-empty after trim.
const FIXED_TEMPERATURE = 0;

const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    medications: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    allergies: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    conditions: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    doctors: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    pharmacies: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    insurance_providers: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    policy_numbers: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    emergency_contacts: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
    },
    blood_type: { type: SchemaType.STRING, nullable: true },
  },
  required: [
    'medications',
    'allergies',
    'conditions',
    'doctors',
    'pharmacies',
    'insurance_providers',
    'policy_numbers',
    'emergency_contacts',
  ],
};

const SYSTEM_PROMPT = `You extract structured medical information from the text of a medical document.

Rules:
- Extract only information explicitly present in the document text. Never infer, guess, or invent.
- If a category has no information in the text, return an empty array (or null for blood_type).
- Preserve original wording — for example, a medication with its dose as written.
- Doctors should be returned with title and name as written (e.g. "Dr. Sarah Smith, MD").
- Insurance providers are the carriers (e.g. "Blue Cross Blue Shield"). Policy numbers are the identifiers (e.g. "BCBS-12345-67890").
- Emergency contacts should include name, relationship if available, and phone number.
- Blood type should be a single short string like "O+" or "A-" if explicitly stated, otherwise null.

Return JSON matching the provided schema.`;

/**
 * Calls Vertex AI Gemini to extract structured medical entities from OCR text.
 *
 * Authentication uses the Cloud Run service account via Application Default
 * Credentials — no API key is required. The service account needs
 * `roles/aiplatform.user` on the project.
 *
 * Failure modes (see spec section "Failure modes"):
 *   - Empty/whitespace OCR text → return [] without calling Gemini.
 *   - Network/quota failure → retry once, then return [] on continued failure.
 *   - Malformed JSON → catch parse error, return [].
 *
 * In every failure mode the caller still completes successfully with zero
 * extracted entities; the document reaches PROCESSED with an empty
 * at-a-glance for that doc.
 *
 * HIPAA-safe logging: counts and types only, never field_value contents.
 */
@Injectable()
export class GeminiEntityExtractorService {
  private readonly logger = new Logger(GeminiEntityExtractorService.name);
  private readonly model: GenerativeModel;
  private readonly modelName: string;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    const projectId = this.configService.getOrThrow(
      'documentProcessing.gcp.projectId',
      { infer: true },
    );
    const location = this.configService.getOrThrow(
      'documentProcessing.gcp.vertexAi.location',
      { infer: true },
    );
    this.modelName = this.configService.getOrThrow(
      'documentProcessing.gcp.vertexAi.modelName',
      { infer: true },
    );

    const vertexAi = new VertexAI({ project: projectId, location });
    this.model = vertexAi.getGenerativeModel({
      model: this.modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: FIXED_TEMPERATURE,
      },
    });

    this.logger.log(
      `Gemini entity extractor initialized (model=${this.modelName}, location=${location})`,
    );
  }

  async extractEntities(ocrText: string): Promise<ExtractedEntity[]> {
    const trimmed = ocrText?.trim() ?? '';
    if (trimmed.length < MIN_OCR_LENGTH) {
      this.logger.debug(
        '[GEMINI EXTRACTOR] OCR text is empty; skipping Gemini call',
      );
      return [];
    }

    const json = await this.callGeminiWithRetry(trimmed);
    if (json === null) return [];

    const entities = mapGeminiResponseToEntities(json);
    this.logger.log(
      `[GEMINI EXTRACTOR] Extracted ${entities.length} entities (${this.summarizeTypes(entities)})`,
    );
    return entities;
  }

  private async callGeminiWithRetry(
    ocrText: string,
  ): Promise<GeminiExtractionResponse | null> {
    try {
      return await this.callGemini(ocrText);
    } catch (firstError) {
      this.logger.warn(
        `[GEMINI EXTRACTOR] First attempt failed (${this.sanitize(firstError)}); retrying once`,
      );
      try {
        return await this.callGemini(ocrText);
      } catch (secondError) {
        this.logger.error(
          `[GEMINI EXTRACTOR] Retry also failed (${this.sanitize(secondError)}); returning empty entities`,
        );
        return null;
      }
    }
  }

  private async callGemini(
    ocrText: string,
  ): Promise<GeminiExtractionResponse | null> {
    const result = await this.model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: SYSTEM_PROMPT },
            { text: `Document text:\n\n${ocrText}` },
          ],
        },
      ],
    });

    const raw = result?.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      this.logger.warn('[GEMINI EXTRACTOR] Response had no text payload');
      return null;
    }

    try {
      return JSON.parse(raw) as GeminiExtractionResponse;
    } catch (parseError) {
      this.logger.warn(
        `[GEMINI EXTRACTOR] Failed to parse JSON response (${this.sanitize(parseError)})`,
      );
      return null;
    }
  }

  private summarizeTypes(entities: ExtractedEntity[]): string {
    const counts: Record<string, number> = {};
    for (const e of entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
    return Object.entries(counts)
      .map(([t, c]) => `${t}:${c}`)
      .join(', ');
  }

  private sanitize(error: unknown): string {
    const message = (error as Error)?.message ?? String(error);
    return message.substring(0, 200);
  }
}
