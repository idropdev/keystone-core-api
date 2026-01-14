import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../../config/config.type';
import { MergeMetadata } from './ocr-merge.service';

/**
 * Post-processing correction
 */
export interface PostProcessingCorrection {
  original: string;
  corrected: string;
  confidence: number;
  correctionType: 'lexical' | 'regex' | 'format' | 'context';
  position: { start: number; end: number };
}

/**
 * Post-processed result
 */
export interface PostProcessedResult {
  text: string;
  corrections: PostProcessingCorrection[];
  qualityScore: number;
}

/**
 * OCR Post-Processor Service
 *
 * Optional post-processing layer for refining merged OCR text.
 * Includes regex corrections, format validation, and optional language model scoring.
 */
@Injectable()
export class OcrPostProcessorService {
  private readonly logger = new Logger(OcrPostProcessorService.name);
  private readonly enabled: boolean;
  private readonly useLanguageModel: boolean;
  private readonly useRegex: boolean;
  private readonly confidenceThreshold: number;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.enabled =
      this.configService.get('documentProcessing.ocrPostProcessing.enabled', {
        infer: true,
      }) || false;
    this.useLanguageModel =
      this.configService.get(
        'documentProcessing.ocrPostProcessing.useLanguageModel',
        { infer: true },
      ) || false;
    this.useRegex =
      this.configService.get('documentProcessing.ocrPostProcessing.useRegex', {
        infer: true,
      }) !== false; // Default true
    this.confidenceThreshold =
      this.configService.get(
        'documentProcessing.ocrPostProcessing.confidenceThreshold',
        { infer: true },
      ) || 0.8;
  }

  /**
   * Post-process merged text
   */
  async postProcessMergedText(
    text: string,
    metadata: MergeMetadata,
  ): Promise<PostProcessedResult> {
    if (!this.enabled) {
      return {
        text,
        corrections: [],
        qualityScore: 0,
      };
    }

    this.logger.log('Starting post-processing');

    const corrections: PostProcessingCorrection[] = [];
    let processedText = text;

    // Apply regex corrections
    if (this.useRegex) {
      const regexCorrections = this.applyRegexCorrections(processedText);
      corrections.push(...regexCorrections);

      // Apply corrections to text
      for (const correction of regexCorrections) {
        if (correction.confidence >= this.confidenceThreshold) {
          processedText = this.applyCorrection(processedText, correction);
        }
      }
    }

    // Apply format corrections
    if (this.useRegex) {
      const formatCorrections = this.applyFormatCorrections(processedText);
      corrections.push(...formatCorrections);

      for (const correction of formatCorrections) {
        if (correction.confidence >= this.confidenceThreshold) {
          processedText = this.applyCorrection(processedText, correction);
        }
      }
    }

    // Apply language model scoring (if enabled)
    if (this.useLanguageModel) {
      const lmCorrections =
        await this.applyLanguageModelCorrections(processedText);
      corrections.push(...lmCorrections);

      for (const correction of lmCorrections) {
        if (correction.confidence >= this.confidenceThreshold) {
          processedText = this.applyCorrection(processedText, correction);
        }
      }
    }

    // Calculate quality improvement score
    const qualityScore = this.calculateQualityScore(
      text,
      processedText,
      corrections,
    );

    this.logger.log(
      `Post-processing complete: ${corrections.length} corrections, quality score: ${qualityScore.toFixed(2)}`,
    );

    return {
      text: processedText,
      corrections,
      qualityScore,
    };
  }

  /**
   * Apply regex corrections for common OCR confusions
   */
  private applyRegexCorrections(text: string): PostProcessingCorrection[] {
    const corrections: PostProcessingCorrection[] = [];

    // Common OCR confusion patterns
    const patterns: Array<{
      pattern: RegExp;
      replacement: string;
      confidence: number;
      type: PostProcessingCorrection['correctionType'];
    }> = [
      // I/l/1 confusion (context-dependent)
      {
        pattern: /\b([a-z]+)l([a-z]+)\b/gi,
        replacement: '$1I$2',
        confidence: 0.6,
        type: 'regex',
      },
      // O/0 confusion (in alphanumeric contexts)
      {
        pattern: /\b([A-Z]+)0([A-Z]+)\b/g,
        replacement: '$1O$2',
        confidence: 0.7,
        type: 'regex',
      },
      // rn/m confusion
      {
        pattern: /\b([a-z]+)rn([a-z]+)\b/gi,
        replacement: '$1m$2',
        confidence: 0.8,
        type: 'regex',
      },
      // Common word corrections
      {
        pattern: /\bteh\b/gi,
        replacement: 'the',
        confidence: 0.9,
        type: 'context',
      },
      {
        pattern: /\badn\b/gi,
        replacement: 'and',
        confidence: 0.9,
        type: 'context',
      },
      {
        pattern: /\btaht\b/gi,
        replacement: 'that',
        confidence: 0.9,
        type: 'context',
      },
    ];

    for (const { pattern, replacement, confidence, type } of patterns) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);

      while ((match = regex.exec(text)) !== null) {
        const original = match[0];
        const corrected = original.replace(pattern, replacement);

        if (original !== corrected) {
          corrections.push({
            original,
            corrected,
            confidence,
            correctionType: type,
            position: {
              start: match.index,
              end: match.index + original.length,
            },
          });
        }
      }
    }

    return corrections;
  }

  /**
   * Apply format corrections (dates, phones, etc.)
   */
  private applyFormatCorrections(text: string): PostProcessingCorrection[] {
    const corrections: PostProcessingCorrection[] = [];

    // Date format normalization
    const datePatterns: Array<{
      pattern: RegExp;
      formatter: (match: RegExpMatchArray) => string;
      confidence: number;
    }> = [
      // MM/DD/YYYY or M/D/YYYY
      {
        pattern: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
        formatter: (m) => {
          const month = m[1].padStart(2, '0');
          const day = m[2].padStart(2, '0');
          const year = m[3];
          return `${month}/${day}/${year}`;
        },
        confidence: 0.9,
      },
      // YYYY-MM-DD
      {
        pattern: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g,
        formatter: (m) => {
          const month = m[2].padStart(2, '0');
          const day = m[3].padStart(2, '0');
          return `${m[1]}-${month}-${day}`;
        },
        confidence: 0.9,
      },
    ];

    for (const { pattern, formatter, confidence } of datePatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const original = match[0];
        const corrected = formatter(match);

        if (original !== corrected) {
          corrections.push({
            original,
            corrected,
            confidence,
            correctionType: 'format',
            position: {
              start: match.index,
              end: match.index + original.length,
            },
          });
        }
      }
    }

    // Phone number format normalization
    const phonePattern = /\b(\d{3})[.\s-]?(\d{3})[.\s-]?(\d{4})\b/g;
    let phoneMatch;
    while ((phoneMatch = phonePattern.exec(text)) !== null) {
      const original = phoneMatch[0];
      const corrected = `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}`;

      if (original !== corrected) {
        corrections.push({
          original,
          corrected,
          confidence: 0.95,
          correctionType: 'format',
          position: {
            start: phoneMatch.index,
            end: phoneMatch.index + original.length,
          },
        });
      }
    }

    return corrections;
  }

  /**
   * Apply language model corrections (placeholder - would use actual LM if enabled)
   */
  private async applyLanguageModelCorrections(
    text: string,
  ): Promise<PostProcessingCorrection[]> {
    // Placeholder implementation
    // In a real implementation, this would use a language model to:
    // 1. Score word/phrase likelihood
    // 2. Suggest corrections for low-likelihood sequences
    // 3. Use context to disambiguate OCR errors

    // For now, return empty array
    // This would be implemented with a lightweight LM or dictionary lookup
    return [];
  }

  /**
   * Apply a correction to text
   */
  private applyCorrection(
    text: string,
    correction: PostProcessingCorrection,
  ): string {
    const before = text.substring(0, correction.position.start);
    const after = text.substring(correction.position.end);
    return before + correction.corrected + after;
  }

  /**
   * Calculate quality improvement score
   */
  private calculateQualityScore(
    originalText: string,
    processedText: string,
    corrections: PostProcessingCorrection[],
  ): number {
    if (corrections.length === 0) return 0;

    // Calculate average confidence of applied corrections
    const appliedCorrections = corrections.filter(
      (c) => c.confidence >= this.confidenceThreshold,
    );

    if (appliedCorrections.length === 0) return 0;

    const avgConfidence =
      appliedCorrections.reduce((sum, c) => sum + c.confidence, 0) /
      appliedCorrections.length;

    // Calculate improvement ratio (how much text was corrected)
    const totalOriginalLength = corrections.reduce(
      (sum, c) => sum + c.original.length,
      0,
    );
    const improvementRatio =
      originalText.length > 0 ? totalOriginalLength / originalText.length : 0;

    // Quality score is combination of confidence and improvement ratio
    return avgConfidence * Math.min(1.0, improvementRatio * 2);
  }
}
