import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OcrResult } from '../domain/ports/ocr.service.port';
import { AllConfigType } from '../../config/config.type';
import {
  extractLinesWithBoundingBoxes,
  LineWithBoundingBox,
} from './ocr-alignment';
import * as crypto from 'crypto';

/**
 * Constants for merge algorithm
 */
const LINE_VERTICAL_OVERLAP_MIN = 0.5; // Minimum vertical overlap to pair lines
const SIMILARITY_WINDOW = 5; // Number of nearby lines to check for similarity
const SIMILARITY_MIN = 0.7; // Minimum similarity score to pair lines
const LINE_MIX_THRESHOLD = 0.55; // Minimum line agreement to mix character-by-character

/**
 * Merge metadata interface
 */
export interface MergeMetadata {
  docAgreement: number; // Document-level agreement (weighted average of PAIRED lines only)
  lineAgreementThreshold: number; // LINE_MIX_THRESHOLD used
  linePairingSuccessRate: number; // % of lines successfully paired
  averageLineConfidence: number; // Average confidence across all lines
  lowAgreementFlag: boolean; // True if docAgreement < MIN_AGREEMENT
  perLineConfidence: Array<{
    lineIndex: number;
    confidence: number;
    lineAgreement: number;
    winningEngine?: 'vision' | 'documentAi' | 'merged';
    wholeLineChosen?: boolean;
    engineContributions?: {
      vision?: number;
      documentAi?: number;
    };
  }>;
  postProcessingCorrections?: Array<{
    original: string;
    corrected: string;
    confidence: number;
    correctionType: 'lexical' | 'regex' | 'format' | 'context';
    position: { start: number; end: number };
  }>;
  qualityImprovementScore?: number;
  // Coverage metrics (additive merge)
  visionCoverage?: number; // % of Vision lines that were paired
  documentAiCoverage?: number; // % of Document AI lines that were paired
  totalLines?: number; // Total lines in merged result
  pairedLines?: number; // Number of lines that were paired
  uniqueVisionLines?: number; // Lines only found by Vision AI
  uniqueDocumentAiLines?: number; // Lines only found by Document AI
}

/**
 * OCR Merge Service
 *
 * Merges results from Vision AI and Document AI OCR using hierarchical alignment
 * and evidence-based voting to produce higher-quality results.
 */
@Injectable()
export class OcrMergeService {
  private readonly logger = new Logger(OcrMergeService.name);
  private readonly minAgreement: number;
  private readonly forceMergeOnLowAgreement: boolean;
  private readonly lineMixThreshold: number;
  private readonly storeSources: boolean;

  constructor(private readonly configService: ConfigService<AllConfigType>) {
    this.minAgreement =
      this.configService.get('documentProcessing.ocrMerge.minAgreement', {
        infer: true,
      }) || 0.7;
    this.forceMergeOnLowAgreement =
      this.configService.get(
        'documentProcessing.ocrMerge.forceMergeOnLowAgreement',
        { infer: true },
      ) || false;
    this.lineMixThreshold =
      this.configService.get('documentProcessing.ocrMerge.lineMixThreshold', {
        infer: true,
      }) || LINE_MIX_THRESHOLD;
    this.storeSources =
      this.configService.get('documentProcessing.debug.storeOcrSources', {
        infer: true,
      }) || false;
  }

  /**
   * Merge OCR results from Vision AI and Document AI
   */
  async mergeOcrResults(
    visionResult: OcrResult,
    documentAiResult: OcrResult,
    options?: {
      enablePostProcessing?: boolean;
      minAgreement?: number;
    },
  ): Promise<OcrResult> {
    this.logger.log('Starting OCR merge process');

    // Debug: Log response structures
    this.logger.debug(
      `[MERGE DEBUG] Vision result fullResponse keys: ${visionResult.fullResponse ? Object.keys(visionResult.fullResponse).join(', ') : 'null'}`,
    );
    this.logger.debug(
      `[MERGE DEBUG] Vision result fullResponse type: ${typeof visionResult.fullResponse}`,
    );
    if (visionResult.fullResponse) {
      this.logger.debug(
        `[MERGE DEBUG] Vision has fullTextAnnotation: ${!!visionResult.fullResponse.fullTextAnnotation}`,
      );
      this.logger.debug(
        `[MERGE DEBUG] Vision has pages: ${!!visionResult.fullResponse.pages}`,
      );
      if (visionResult.fullResponse.fullTextAnnotation) {
        this.logger.debug(
          `[MERGE DEBUG] Vision fullTextAnnotation keys: ${Object.keys(visionResult.fullResponse.fullTextAnnotation).join(', ')}`,
        );
      }
    }

    this.logger.debug(
      `[MERGE DEBUG] Document AI result fullResponse keys: ${documentAiResult.fullResponse ? Object.keys(documentAiResult.fullResponse).join(', ') : 'null'}`,
    );
    this.logger.debug(
      `[MERGE DEBUG] Document AI result fullResponse type: ${typeof documentAiResult.fullResponse}`,
    );
    if (documentAiResult.fullResponse) {
      this.logger.debug(
        `[MERGE DEBUG] Document AI has fullTextAnnotation: ${!!documentAiResult.fullResponse.fullTextAnnotation}`,
      );
      this.logger.debug(
        `[MERGE DEBUG] Document AI has pages: ${!!documentAiResult.fullResponse.pages}`,
      );
      if (documentAiResult.fullResponse.pages) {
        this.logger.debug(
          `[MERGE DEBUG] Document AI pages count: ${Array.isArray(documentAiResult.fullResponse.pages) ? documentAiResult.fullResponse.pages.length : 'not array'}`,
        );
      }
    }

    // Extract lines from both results
    const visionLines = extractLinesWithBoundingBoxes(visionResult);
    const documentAiLines = extractLinesWithBoundingBoxes(documentAiResult);

    this.logger.log(
      `Extracted ${visionLines.length} Vision lines, ${documentAiLines.length} Document AI lines`,
    );

    // Group lines by page
    const visionLinesByPage = this.groupLinesByPage(visionLines);
    const documentAiLinesByPage = this.groupLinesByPage(documentAiLines);

    // Get max page count
    const maxPages = Math.max(
      ...Object.keys(visionLinesByPage).map(Number),
      ...Object.keys(documentAiLinesByPage).map(Number),
    );

    const mergedLines: Array<{
      text: string;
      confidence: number;
      lineAgreement: number;
      winningEngine?: 'vision' | 'documentAi' | 'merged';
      wholeLineChosen?: boolean;
      engineContributions?: { vision?: number; documentAi?: number };
    }> = [];

    const perLineConfidence: MergeMetadata['perLineConfidence'] = [];

    // Process each page
    for (let pageIndex = 0; pageIndex <= maxPages; pageIndex++) {
      const visionPageLines = visionLinesByPage[pageIndex] || [];
      const documentAiPageLines = documentAiLinesByPage[pageIndex] || [];

      // Sort lines by Y position (top to bottom) for proper ordering
      const sortedVisionLines = [...visionPageLines].sort(
        (a, b) => a.boundingBox.y0 - b.boundingBox.y0,
      );
      const sortedDocumentAiLines = [...documentAiPageLines].sort(
        (a, b) => a.boundingBox.y0 - b.boundingBox.y0,
      );

      // Pair lines on this page
      const linePairs = this.pairLines(
        sortedVisionLines,
        sortedDocumentAiLines,
      );

      // Sort pairs by Y position to maintain document order
      const sortedPairs = linePairs.sort((a, b) => {
        const yA =
          a.vision?.boundingBox.y0 ?? a.documentAi?.boundingBox.y0 ?? 0;
        const yB =
          b.vision?.boundingBox.y0 ?? b.documentAi?.boundingBox.y0 ?? 0;
        return yA - yB;
      });

      // Merge each pair
      for (let pairIndex = 0; pairIndex < sortedPairs.length; pairIndex++) {
        const pair = sortedPairs[pairIndex];
        const merged = this.mergeLinePair(pair.vision, pair.documentAi);

        mergedLines.push(merged);
        perLineConfidence.push({
          lineIndex: mergedLines.length - 1,
          confidence: merged.confidence,
          lineAgreement: merged.lineAgreement,
          winningEngine: merged.winningEngine,
          wholeLineChosen: merged.wholeLineChosen,
          engineContributions: merged.engineContributions,
        });
      }
    }

    // Calculate document-level agreement ONLY from paired lines (not unmatched)
    const docAgreement =
      this.calculateDocumentAgreementFromPairedLines(perLineConfidence);

    // Calculate overall confidence
    const overallConfidence = this.calculateOverallConfidence(
      mergedLines,
      perLineConfidence,
    );

    // Calculate line pairing success rate and coverage
    const totalLines = Math.max(visionLines.length, documentAiLines.length);
    const pairedLinesCount = perLineConfidence.filter(
      (line) =>
        line.winningEngine === 'merged' ||
        (line.engineContributions &&
          (line.engineContributions.vision || 0) > 0 &&
          (line.engineContributions.documentAi || 0) > 0),
    ).length;
    const linePairingSuccessRate =
      totalLines > 0 ? (pairedLinesCount / totalLines) * 100 : 0;

    // Calculate unique lines (unmatched)
    const uniqueVisionLinesCount = perLineConfidence.filter(
      (line) =>
        line.winningEngine === 'vision' &&
        (!line.engineContributions ||
          (line.engineContributions.vision || 0) === 100),
    ).length;
    const uniqueDocumentAiLinesCount = perLineConfidence.filter(
      (line) =>
        line.winningEngine === 'documentAi' &&
        (!line.engineContributions ||
          (line.engineContributions.documentAi || 0) === 100),
    ).length;

    // Calculate coverage: how much of each engine's content was paired
    const visionCoverage =
      visionLines.length > 0
        ? (pairedLinesCount / visionLines.length) * 100
        : 0;
    const documentAiCoverage =
      documentAiLines.length > 0
        ? (pairedLinesCount / documentAiLines.length) * 100
        : 0;

    this.logger.log(
      `[MERGE] Coverage - Vision: ${visionCoverage.toFixed(1)}% (${pairedLinesCount}/${visionLines.length} paired, ${uniqueVisionLinesCount} unique), Document AI: ${documentAiCoverage.toFixed(1)}% (${pairedLinesCount}/${documentAiLines.length} paired, ${uniqueDocumentAiLinesCount} unique)`,
    );

    // Check if agreement is too low
    const lowAgreementFlag = docAgreement < this.minAgreement;

    if (lowAgreementFlag && !this.forceMergeOnLowAgreement) {
      this.logger.warn(
        `Document agreement (${docAgreement.toFixed(2)}) below threshold (${this.minAgreement}). Returning best single-engine result.`,
      );

      // Return best single-engine result
      const bestResult = this.chooseBestSingleEngineResult(
        visionResult,
        documentAiResult,
      );

      return bestResult;
    }

    // Build merged text - preserve original formatting
    // Use original text from OCR engines when available, only merge when lines are paired
    const mergedText = this.buildMergedTextPreservingFormat(
      mergedLines,
      visionResult.text,
      documentAiResult.text,
    );

    // Build merge metadata
    const mergeMetadata: MergeMetadata = {
      docAgreement,
      lineAgreementThreshold: this.lineMixThreshold,
      linePairingSuccessRate,
      averageLineConfidence: overallConfidence,
      lowAgreementFlag,
      perLineConfidence,
      // Add coverage metrics
      visionCoverage,
      documentAiCoverage,
      totalLines: mergedLines.length,
      pairedLines: pairedLinesCount,
      uniqueVisionLines: uniqueVisionLinesCount,
      uniqueDocumentAiLines: uniqueDocumentAiLinesCount,
    };

    // Build sources metadata (PHI-safe)
    const sources = this.buildSourcesMetadata(
      visionResult,
      documentAiResult,
      docAgreement,
    );

    this.logger.log(
      `Merge complete: agreement=${docAgreement.toFixed(2)} (from ${pairedLinesCount} paired lines), confidence=${overallConfidence.toFixed(2)}, total lines=${mergedLines.length}`,
    );
    this.logger.log(
      `[MERGE SUMMARY] Vision: ${visionLines.length} lines (${pairedLinesCount} paired, ${uniqueVisionLinesCount} unique), Document AI: ${documentAiLines.length} lines (${pairedLinesCount} paired, ${uniqueDocumentAiLinesCount} unique), Merged: ${mergedLines.length} total lines`,
    );

    return {
      text: mergedText,
      confidence: overallConfidence,
      pageCount: Math.max(visionResult.pageCount, documentAiResult.pageCount),
      entities: this.mergeEntities(
        visionResult.entities,
        documentAiResult.entities,
      ),
      fullResponse: {
        engine: 'merged',
        sources,
        mergeMetadata,
      },
    };
  }

  /**
   * Group lines by page index
   */
  private groupLinesByPage(
    lines: LineWithBoundingBox[],
  ): Record<number, LineWithBoundingBox[]> {
    const grouped: Record<number, LineWithBoundingBox[]> = {};

    for (const line of lines) {
      if (!grouped[line.pageIndex]) {
        grouped[line.pageIndex] = [];
      }
      grouped[line.pageIndex].push(line);
    }

    return grouped;
  }

  /**
   * Pair lines from Vision AI and Document AI using bounding box overlap and text similarity
   */
  private pairLines(
    visionLines: LineWithBoundingBox[],
    documentAiLines: LineWithBoundingBox[],
  ): Array<{ vision?: LineWithBoundingBox; documentAi?: LineWithBoundingBox }> {
    const pairs: Array<{
      vision?: LineWithBoundingBox;
      documentAi?: LineWithBoundingBox;
    }> = [];

    const usedVision = new Set<number>();
    const usedDocumentAi = new Set<number>();

    // Method 1: Bounding box overlap (primary)
    for (let v = 0; v < visionLines.length; v++) {
      if (usedVision.has(v)) continue;

      for (let d = 0; d < documentAiLines.length; d++) {
        if (usedDocumentAi.has(d)) continue;

        const visionLine = visionLines[v];
        const documentAiLine = documentAiLines[d];

        const overlap = this.calculateVerticalOverlap(
          visionLine.boundingBox,
          documentAiLine.boundingBox,
        );

        if (overlap >= LINE_VERTICAL_OVERLAP_MIN) {
          pairs.push({ vision: visionLine, documentAi: documentAiLine });
          usedVision.add(v);
          usedDocumentAi.add(d);
          break;
        }
      }
    }

    // Method 2: Text similarity (fallback for unmatched lines)
    for (let v = 0; v < visionLines.length; v++) {
      if (usedVision.has(v)) continue;

      const visionLine = visionLines[v];
      let bestMatch: { index: number; similarity: number } | null = null;

      // Check nearby lines (within SIMILARITY_WINDOW)
      const startIndex = Math.max(0, v - SIMILARITY_WINDOW);
      const endIndex = Math.min(
        documentAiLines.length,
        v + SIMILARITY_WINDOW + 1,
      );

      for (let d = startIndex; d < endIndex; d++) {
        if (usedDocumentAi.has(d)) continue;

        const documentAiLine = documentAiLines[d];
        const similarity = this.calculateTextSimilarity(
          visionLine.text,
          documentAiLine.text,
        );

        if (
          similarity >= SIMILARITY_MIN &&
          (!bestMatch || similarity > bestMatch.similarity)
        ) {
          bestMatch = { index: d, similarity };
        }
      }

      if (bestMatch) {
        pairs.push({
          vision: visionLine,
          documentAi: documentAiLines[bestMatch.index],
        });
        usedVision.add(v);
        usedDocumentAi.add(bestMatch.index);
      }
    }

    // Add unmatched lines - these are unique content from each engine
    // Sort by Y position to maintain document order
    const unmatchedVision: Array<{ line: LineWithBoundingBox; index: number }> =
      [];
    const unmatchedDocumentAi: Array<{
      line: LineWithBoundingBox;
      index: number;
    }> = [];

    for (let v = 0; v < visionLines.length; v++) {
      if (!usedVision.has(v)) {
        unmatchedVision.push({ line: visionLines[v], index: v });
      }
    }

    for (let d = 0; d < documentAiLines.length; d++) {
      if (!usedDocumentAi.has(d)) {
        unmatchedDocumentAi.push({ line: documentAiLines[d], index: d });
      }
    }

    // Sort unmatched lines by Y position
    unmatchedVision.sort(
      (a, b) => a.line.boundingBox.y0 - b.line.boundingBox.y0,
    );
    unmatchedDocumentAi.sort(
      (a, b) => a.line.boundingBox.y0 - b.line.boundingBox.y0,
    );

    // Add unmatched lines as unique content (additive merge)
    // These represent content that one engine found but the other didn't
    for (const { line } of unmatchedVision) {
      pairs.push({ vision: line });
    }

    for (const { line } of unmatchedDocumentAi) {
      pairs.push({ documentAi: line });
    }

    this.logger.debug(
      `[MERGE] Paired: ${pairs.length - unmatchedVision.length - unmatchedDocumentAi.length}, Unmatched Vision: ${unmatchedVision.length}, Unmatched Document AI: ${unmatchedDocumentAi.length}`,
    );

    return pairs;
  }

  /**
   * Calculate vertical overlap ratio between two bounding boxes
   */
  private calculateVerticalOverlap(
    box1: { y0: number; y1: number },
    box2: { y0: number; y1: number },
  ): number {
    const overlap = Math.min(box1.y1, box2.y1) - Math.max(box1.y0, box2.y0);
    const maxHeight = Math.max(box1.y1 - box1.y0, box2.y1 - box2.y0);

    if (maxHeight === 0) return 0;

    return Math.max(0, overlap / maxHeight);
  }

  /**
   * Calculate text similarity using normalized edit distance
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const editDistance = this.levenshteinDistance(text1, text2);
    const maxLength = Math.max(text1.length, text2.length);

    if (maxLength === 0) return 1;

    return 1 - editDistance / maxLength;
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;

    if (len1 === 0) return len2;
    if (len2 === 0) return len1;

    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1, // deletion
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j - 1] + cost, // substitution
        );
      }
    }

    return matrix[len1][len2];
  }

  /**
   * Merge a pair of lines
   */
  private mergeLinePair(
    visionLine?: LineWithBoundingBox,
    documentAiLine?: LineWithBoundingBox,
  ): {
    text: string;
    confidence: number;
    lineAgreement: number;
    winningEngine?: 'vision' | 'documentAi' | 'merged';
    wholeLineChosen?: boolean;
    engineContributions?: { vision?: number; documentAi?: number };
  } {
    // If only one line available, return it
    if (!visionLine && documentAiLine) {
      return {
        text: documentAiLine.text,
        confidence: documentAiLine.confidence || 0.8,
        lineAgreement: 1.0,
        winningEngine: 'documentAi',
        wholeLineChosen: true,
        engineContributions: { documentAi: 100 },
      };
    }

    if (visionLine && !documentAiLine) {
      return {
        text: visionLine.text,
        confidence: visionLine.confidence || 0.8,
        lineAgreement: 1.0,
        winningEngine: 'vision',
        wholeLineChosen: true,
        engineContributions: { vision: 100 },
      };
    }

    if (!visionLine || !documentAiLine) {
      throw new Error('Both lines are undefined');
    }

    // Calculate line agreement
    const lineAgreement = this.calculateTextSimilarity(
      visionLine.text,
      documentAiLine.text,
    );

    // Check if lines are too different - might be unique content from different parts
    // If agreement is very low (< 0.3), they're likely different lines, not the same line with errors
    // In this case, we should include both (additive), but for now we choose the better one
    // TODO: Consider adding both lines when agreement < 0.3 (requires position-based ordering)

    // Line winner rule: if agreement too low, choose whole best line
    // This handles cases where one engine sees content the other doesn't
    if (lineAgreement < this.lineMixThreshold) {
      const visionScore = this.calculateLineScore(visionLine.text);
      const documentAiScore = this.calculateLineScore(documentAiLine.text);

      // Log when lines are very different (might be unique content)
      if (lineAgreement < 0.3) {
        this.logger.debug(
          `[MERGE] Very low agreement (${lineAgreement.toFixed(2)}) - lines likely unique content. Vision: "${visionLine.text.substring(0, 50)}", Document AI: "${documentAiLine.text.substring(0, 50)}"`,
        );
      }

      if (visionScore >= documentAiScore) {
        return {
          text: visionLine.text,
          confidence: visionScore,
          lineAgreement,
          winningEngine: 'vision',
          wholeLineChosen: true,
          engineContributions: { vision: 100 },
        };
      } else {
        return {
          text: documentAiLine.text,
          confidence: documentAiScore,
          lineAgreement,
          winningEngine: 'documentAi',
          wholeLineChosen: true,
          engineContributions: { documentAi: 100 },
        };
      }
    }

    // High agreement: merge character-by-character
    const merged = this.mergeHighAgreementLines(visionLine, documentAiLine);

    return {
      text: merged.text,
      confidence: merged.confidence,
      lineAgreement,
      winningEngine: 'merged',
      wholeLineChosen: false,
      engineContributions: merged.contributions,
    };
  }

  /**
   * Calculate line score for validation (used in line winner rule)
   */
  private calculateLineScore(text: string): number {
    let score = 0.5; // Base score

    // Validation score (format validation)
    if (this.validateFormats(text)) {
      score += 0.2;
    }

    // OCR noise score (penalize weird characters)
    const noiseScore = this.calculateOcrNoiseScore(text);
    score += noiseScore * 0.2;

    // Confidence boost for longer, more structured text
    if (text.length > 10 && text.match(/[A-Za-z]/)) {
      score += 0.1;
    }

    return Math.min(1.0, score);
  }

  /**
   * Validate common formats (dates, phones, etc.)
   */
  private validateFormats(text: string): boolean {
    // Date patterns
    if (/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text)) return true;
    if (/\d{4}-\d{2}-\d{2}/.test(text)) return true;

    // Phone patterns
    if (/\d{3}-\d{3}-\d{4}/.test(text)) return true;
    if (/\(\d{3}\)\s*\d{3}-\d{4}/.test(text)) return true;

    return false;
  }

  /**
   * Calculate OCR noise score (lower is better, so we return negative penalty)
   */
  private calculateOcrNoiseScore(text: string): number {
    let noiseCount = 0;

    // Common OCR confusions
    const confusionPatterns = [
      /[Il1]/g, // I, l, 1 confusion
      /[O0]/g, // O, 0 confusion
      /rn/g, // rn vs m
      /[^A-Za-z0-9\s.,;:!?\-()]/g, // Weird characters
    ];

    for (const pattern of confusionPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        noiseCount += matches.length;
      }
    }

    // Normalize by text length
    const noiseRatio = text.length > 0 ? noiseCount / text.length : 0;

    // Return score (1.0 = no noise, 0.0 = all noise)
    return Math.max(0, 1.0 - noiseRatio * 2);
  }

  /**
   * Merge lines with high agreement (character-by-character voting)
   */
  private mergeHighAgreementLines(
    visionLine: LineWithBoundingBox,
    documentAiLine: LineWithBoundingBox,
  ): {
    text: string;
    confidence: number;
    contributions: { vision?: number; documentAi?: number };
  } {
    // Preserve original spacing - split on single space to maintain spacing patterns
    // This is a simplified approach - for full preservation, we'd need to track original spacing
    const visionWords = visionLine.text.split(/(\s+)/); // Split but keep separators
    const documentAiWords = documentAiLine.text.split(/(\s+)/);

    // Filter out empty strings and whitespace-only tokens for alignment
    const visionWordsOnly = visionWords.filter((w) => w.trim().length > 0);
    const documentAiWordsOnly = documentAiWords.filter(
      (w) => w.trim().length > 0,
    );

    const alignedWords: string[] = [];
    let visionIndex = 0;
    let documentAiIndex = 0;
    let visionChars = 0;
    let documentAiChars = 0;

    while (
      visionIndex < visionWordsOnly.length ||
      documentAiIndex < documentAiWordsOnly.length
    ) {
      const visionWord = visionWordsOnly[visionIndex];
      const documentAiWord = documentAiWordsOnly[documentAiIndex];

      if (!visionWord && documentAiWord) {
        alignedWords.push(documentAiWord);
        documentAiChars += documentAiWord.length;
        documentAiIndex++;
      } else if (visionWord && !documentAiWord) {
        alignedWords.push(visionWord);
        visionChars += visionWord.length;
        visionIndex++;
      } else if (visionWord === documentAiWord) {
        // Words match - use either
        alignedWords.push(visionWord);
        visionChars += visionWord.length;
        documentAiChars += visionWord.length;
        visionIndex++;
        documentAiIndex++;
      } else {
        // Words don't match - use character-level voting
        const mergedWord = this.mergeWords(visionWord, documentAiWord);
        alignedWords.push(mergedWord);
        visionChars += visionWord.length;
        documentAiChars += documentAiWord.length;
        visionIndex++;
        documentAiIndex++;
      }
    }

    const totalChars = visionChars + documentAiChars;
    const visionContribution =
      totalChars > 0 ? (visionChars / totalChars) * 100 : 50;
    const documentAiContribution =
      totalChars > 0 ? (documentAiChars / totalChars) * 100 : 50;

    // Join with single space (preserving word order, spacing normalized)
    // Note: Full spacing preservation would require tracking original spacing patterns
    const mergedText = alignedWords.join(' ');

    // Calculate confidence
    const lineAgreement = this.calculateTextSimilarity(
      visionLine.text,
      documentAiLine.text,
    );
    const confidence =
      lineAgreement * 0.7 + this.calculateLineScore(mergedText) * 0.3;

    return {
      text: mergedText,
      confidence,
      contributions: {
        vision: visionContribution,
        documentAi: documentAiContribution,
      },
    };
  }

  /**
   * Merge two words character-by-character
   */
  private mergeWords(word1: string, word2: string): string {
    // Simple approach: if words are similar, use character voting
    // Otherwise, choose the word with better validation score

    const similarity = this.calculateTextSimilarity(word1, word2);

    if (similarity > 0.7) {
      // Similar words - merge character-by-character
      const maxLen = Math.max(word1.length, word2.length);
      let merged = '';

      for (let i = 0; i < maxLen; i++) {
        const char1 = word1[i];
        const char2 = word2[i];

        if (char1 === char2) {
          merged += char1 || char2 || '';
        } else if (!char1) {
          merged += char2;
        } else if (!char2) {
          merged += char1;
        } else {
          // Choose based on validation heuristics
          const score1 = this.validateChar(char1, word1, i);
          const score2 = this.validateChar(char2, word2, i);

          merged += score1 >= score2 ? char1 : char2;
        }
      }

      return merged;
    } else {
      // Very different words - choose better one
      const score1 = this.calculateLineScore(word1);
      const score2 = this.calculateLineScore(word2);

      return score1 >= score2 ? word1 : word2;
    }
  }

  /**
   * Validate character in context
   */
  private validateChar(char: string, word: string, position: number): number {
    let score = 0.5;

    // Prefer alphanumeric
    if (/[A-Za-z0-9]/.test(char)) {
      score += 0.3;
    }

    // Prefer common characters
    if (/[aeiouAEIOU]/.test(char)) {
      score += 0.1;
    }

    // Penalize OCR confusion characters
    if (/[Il1O0]/.test(char)) {
      score -= 0.2;
    }

    return score;
  }

  /**
   * Calculate document-level agreement ONLY from paired lines (excludes unmatched lines)
   * This prevents unmatched lines from inflating the agreement score
   */
  private calculateDocumentAgreementFromPairedLines(
    perLineConfidence: MergeMetadata['perLineConfidence'],
  ): number {
    if (perLineConfidence.length === 0) return 0;

    let totalWeight = 0;
    let weightedSum = 0;
    let pairedCount = 0;

    for (const line of perLineConfidence) {
      // Only count lines that were actually paired (not unmatched single-engine lines)
      // Unmatched lines have winningEngine='vision' or 'documentAi' but were never compared
      // We identify paired lines by checking if they have a meaningful agreement score
      // AND the winningEngine is 'merged' OR both engines contributed
      const isPaired =
        line.winningEngine === 'merged' ||
        (line.engineContributions &&
          (line.engineContributions.vision || 0) > 0 &&
          (line.engineContributions.documentAi || 0) > 0);

      if (isPaired) {
        pairedCount++;
        // Weight by line length (approximate)
        const weight = 1; // Simplified - could use actual line length
        totalWeight += weight;
        weightedSum += line.lineAgreement * weight;
      }
    }

    this.logger.debug(
      `[MERGE] Agreement calculation: ${pairedCount} paired lines out of ${perLineConfidence.length} total lines`,
    );

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Calculate document-level agreement (weighted average) - DEPRECATED
   * Use calculateDocumentAgreementFromPairedLines instead
   */
  private calculateDocumentAgreement(
    perLineConfidence: MergeMetadata['perLineConfidence'],
  ): number {
    return this.calculateDocumentAgreementFromPairedLines(perLineConfidence);
  }

  /**
   * Calculate overall confidence (weighted by line length)
   */
  private calculateOverallConfidence(
    mergedLines: Array<{ text: string; confidence: number }>,
    perLineConfidence: MergeMetadata['perLineConfidence'],
  ): number {
    if (mergedLines.length === 0) return 0;

    let totalLength = 0;
    let weightedSum = 0;

    for (let i = 0; i < mergedLines.length; i++) {
      const line = mergedLines[i];
      const length = line.text.length;
      totalLength += length;
      weightedSum += line.confidence * length;
    }

    return totalLength > 0 ? weightedSum / totalLength : 0;
  }

  /**
   * Choose best single-engine result when agreement is too low
   */
  private chooseBestSingleEngineResult(
    visionResult: OcrResult,
    documentAiResult: OcrResult,
  ): OcrResult {
    // Compare overall confidence
    if (visionResult.confidence >= documentAiResult.confidence) {
      return visionResult;
    } else {
      return documentAiResult;
    }
  }

  /**
   * Build sources metadata (PHI-safe)
   */
  private buildSourcesMetadata(
    visionResult: OcrResult,
    documentAiResult: OcrResult,
    docAgreement: number,
  ): any {
    const sources: any = {};

    // Vision source
    if (this.storeSources) {
      sources.vision = {
        text: visionResult.text,
        confidence: visionResult.confidence,
        agreementScore: docAgreement,
      };
    } else {
      sources.vision = {
        textHash: this.hashText(visionResult.text),
        textExcerpt: visionResult.text.substring(0, 100),
        confidence: visionResult.confidence,
        agreementScore: docAgreement,
      };
    }

    // Document AI source
    if (this.storeSources) {
      sources.documentAi = {
        text: documentAiResult.text,
        confidence: documentAiResult.confidence,
        agreementScore: docAgreement,
      };
    } else {
      sources.documentAi = {
        textHash: this.hashText(documentAiResult.text),
        textExcerpt: documentAiResult.text.substring(0, 100),
        confidence: documentAiResult.confidence,
        agreementScore: docAgreement,
      };
    }

    return sources;
  }

  /**
   * Hash text using SHA256 (for PHI safety)
   */
  private hashText(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Build merged text preserving original formatting
   * Uses original OCR text when lines are unmatched, merges when paired
   */
  private buildMergedTextPreservingFormat(
    mergedLines: Array<{
      text: string;
      confidence: number;
      lineAgreement: number;
      winningEngine?: 'vision' | 'documentAi' | 'merged';
      wholeLineChosen?: boolean;
      engineContributions?: { vision?: number; documentAi?: number };
    }>,
    visionText: string,
    documentAiText: string,
  ): string {
    // For now, join lines with newlines but preserve the text content as-is
    // This preserves spacing within lines (from the merge process)
    // Future enhancement: could preserve original line breaks from OCR engines
    return mergedLines.map((line) => line.text).join('\n');
  }

  /**
   * Merge entities from both OCR results
   */
  private mergeEntities(
    visionEntities?: OcrResult['entities'],
    documentAiEntities?: OcrResult['entities'],
  ): OcrResult['entities'] {
    const merged: OcrResult['entities'] = [];

    // Add all entities, preferring higher confidence
    const entityMap = new Map<string, any>();

    for (const entity of visionEntities || []) {
      const key = `${entity.type}:${entity.mentionText}`;
      if (
        !entityMap.has(key) ||
        entityMap.get(key).confidence < entity.confidence
      ) {
        entityMap.set(key, entity);
      }
    }

    for (const entity of documentAiEntities || []) {
      const key = `${entity.type}:${entity.mentionText}`;
      if (
        !entityMap.has(key) ||
        entityMap.get(key).confidence < entity.confidence
      ) {
        entityMap.set(key, entity);
      }
    }

    return Array.from(entityMap.values());
  }
}
