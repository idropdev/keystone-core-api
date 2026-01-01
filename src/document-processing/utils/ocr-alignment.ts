import { Logger } from '@nestjs/common';
import { OcrResult } from '../domain/ports/ocr.service.port';

const logger = new Logger('OcrAlignment');

/**
 * Line with normalized bounding box
 */
export interface LineWithBoundingBox {
  text: string; // Line text content
  boundingBox: {
    // Normalized bounding box [0, 1]
    x0: number; // Left edge (0 = leftmost, 1 = rightmost)
    y0: number; // Top edge (0 = top, 1 = bottom)
    x1: number; // Right edge
    y1: number; // Bottom edge
  };
  pageIndex: number; // Zero-based page index
  lineIndex: number; // Zero-based line index within page
  confidence?: number; // Line-level confidence (0-1) if available
}

/**
 * Extract lines with normalized bounding boxes from OCR result
 *
 * Works for both Vision AI and Document AI response structures.
 * All bounding boxes are normalized to [0, 1] range.
 */
export function extractLinesWithBoundingBoxes(
  ocrResult: OcrResult,
): LineWithBoundingBox[] {
  const fullResponse = ocrResult.fullResponse;

  logger.debug(
    `[LINE EXTRACTION] Starting extraction - PageCount: ${ocrResult.pageCount}, Text length: ${ocrResult.text?.length || 0}`,
  );
  logger.debug(
    `[LINE EXTRACTION] fullResponse type: ${typeof fullResponse}, keys: ${fullResponse ? Object.keys(fullResponse).join(', ') : 'null'}`,
  );

  // Detect engine type by checking response structure
  if (fullResponse?.fullTextAnnotation) {
    logger.debug(
      `[LINE EXTRACTION] Detected Vision AI structure - fullTextAnnotation found`,
    );
    logger.debug(
      `[LINE EXTRACTION] fullTextAnnotation keys: ${Object.keys(fullResponse.fullTextAnnotation || {}).join(', ')}`,
    );
    const lines = extractLinesFromVisionAi(fullResponse);
    logger.log(
      `[LINE EXTRACTION] Vision AI extraction complete - ${lines.length} lines extracted`,
    );
    return lines;
  } else if (fullResponse?.pages) {
    logger.debug(
      `[LINE EXTRACTION] Detected Document AI structure - pages found`,
    );
    logger.debug(
      `[LINE EXTRACTION] pages count: ${Array.isArray(fullResponse.pages) ? fullResponse.pages.length : 'not array'}`,
    );
    const lines = extractLinesFromDocumentAi(fullResponse);
    logger.log(
      `[LINE EXTRACTION] Document AI extraction complete - ${lines.length} lines extracted`,
    );
    return lines;
  } else {
    logger.warn(
      `[LINE EXTRACTION] Unknown structure - falling back to plain text extraction`,
    );
    logger.debug(
      `[LINE EXTRACTION] fullResponse structure: ${JSON.stringify({
        hasFullTextAnnotation: !!fullResponse?.fullTextAnnotation,
        hasPages: !!fullResponse?.pages,
        topLevelKeys: fullResponse ? Object.keys(fullResponse) : [],
        fullResponseType: typeof fullResponse,
      })}`,
    );
    // Fallback: treat as plain text, no bounding boxes
    const lines = extractLinesFromPlainText(
      ocrResult.text,
      ocrResult.pageCount || 1,
    );
    logger.log(
      `[LINE EXTRACTION] Plain text extraction complete - ${lines.length} lines extracted`,
    );
    return lines;
  }
}

/**
 * Extract lines from Vision AI fullTextAnnotation
 */
function extractLinesFromVisionAi(fullResponse: any): LineWithBoundingBox[] {
  const lines: LineWithBoundingBox[] = [];
  const fullTextAnnotation = fullResponse.fullTextAnnotation;

  logger.debug(
    `[VISION AI EXTRACTION] fullTextAnnotation keys: ${fullTextAnnotation ? Object.keys(fullTextAnnotation).join(', ') : 'null'}`,
  );

  if (!fullTextAnnotation) {
    logger.warn(`[VISION AI EXTRACTION] No fullTextAnnotation found`);
    return lines;
  }

  if (!fullTextAnnotation.pages) {
    logger.warn(
      `[VISION AI EXTRACTION] No pages in fullTextAnnotation. Available keys: ${Object.keys(fullTextAnnotation).join(', ')}`,
    );
    return lines;
  }

  if (!fullTextAnnotation.text) {
    logger.warn(`[VISION AI EXTRACTION] No text in fullTextAnnotation`);
    return lines;
  }

  const pages = fullTextAnnotation.pages;
  const text = fullTextAnnotation.text;

  logger.debug(
    `[VISION AI EXTRACTION] Processing ${pages.length} pages, text length: ${text.length}`,
  );

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const pageWidth = page.width || 1;
    const pageHeight = page.height || 1;

    logger.debug(
      `[VISION AI EXTRACTION] Page ${pageIndex}: width=${pageWidth}, height=${pageHeight}, blocks=${page.blocks?.length || 0}`,
    );

    // Vision AI provides blocks, paragraphs, words structure
    // We need to reconstruct lines by grouping words with similar Y coordinates
    const words: Array<{
      text: string;
      boundingBox: any;
      y0: number;
      y1: number;
    }> = [];

    // Collect all words from the page
    let wordCount = 0;
    for (const block of page.blocks || []) {
      logger.debug(
        `[VISION AI EXTRACTION] Block has ${block.paragraphs?.length || 0} paragraphs`,
      );
      for (const paragraph of block.paragraphs || []) {
        logger.debug(
          `[VISION AI EXTRACTION] Paragraph has ${paragraph.words?.length || 0} words`,
        );
        for (const word of paragraph.words || []) {
          const wordText = extractWordText(word, text);
          if (!wordText || !wordText.trim()) {
            logger.debug(
              `[VISION AI EXTRACTION] Skipping empty word - has symbols: ${!!word.symbols}`,
            );
            continue;
          }

          const boundingBox = word.boundingBox;
          // Vision AI can use either 'vertices' (absolute) or 'normalizedVertices' (normalized)
          const vertices =
            boundingBox?.vertices || boundingBox?.normalizedVertices;

          if (!vertices || vertices.length < 4) {
            logger.debug(
              `[VISION AI EXTRACTION] Skipping word without valid bounding box - has boundingBox: ${!!boundingBox}, vertices: ${boundingBox?.vertices?.length || 0}, normalizedVertices: ${boundingBox?.normalizedVertices?.length || 0}`,
            );
            continue;
          }

          wordCount++;

          // Check if coordinates are already normalized (values in [0, 1])
          const firstX = vertices[0]?.x || 0;
          const firstY = vertices[0]?.y || 0;
          const isNormalized = firstX <= 1 && firstY <= 1;

          let x0: number, y0: number, x1: number, y1: number;

          if (isNormalized) {
            // Already normalized
            x0 = Math.max(
              0,
              Math.min(1, Math.min(...vertices.map((v: any) => v.x || 0))),
            );
            y0 = Math.max(
              0,
              Math.min(1, Math.min(...vertices.map((v: any) => v.y || 0))),
            );
            x1 = Math.max(
              0,
              Math.min(1, Math.max(...vertices.map((v: any) => v.x || 0))),
            );
            y1 = Math.max(
              0,
              Math.min(1, Math.max(...vertices.map((v: any) => v.y || 0))),
            );
          } else {
            // Absolute coordinates - normalize
            x0 = Math.min(...vertices.map((v: any) => v.x || 0)) / pageWidth;
            y0 = Math.min(...vertices.map((v: any) => v.y || 0)) / pageHeight;
            x1 = Math.max(...vertices.map((v: any) => v.x || 0)) / pageWidth;
            y1 = Math.max(...vertices.map((v: any) => v.y || 0)) / pageHeight;
          }

          words.push({
            text: wordText,
            boundingBox: { x0, y0, x1, y1 },
            y0,
            y1,
          });
        }
      }
    }

    logger.debug(
      `[VISION AI EXTRACTION] Page ${pageIndex}: Collected ${wordCount} words`,
    );

    // Group words into lines by Y-coordinate clustering
    const linesByY = groupWordsIntoLines(words);
    logger.debug(
      `[VISION AI EXTRACTION] Page ${pageIndex}: Grouped into ${linesByY.length} lines`,
    );

    // Sort lines by Y position
    linesByY.sort((a, b) => a.y0 - b.y0);

    for (let lineIndex = 0; lineIndex < linesByY.length; lineIndex++) {
      const line = linesByY[lineIndex];
      lines.push({
        text: line.text,
        boundingBox: line.boundingBox,
        pageIndex,
        lineIndex,
        confidence: line.confidence,
      });
    }
  }

  return lines;
}

/**
 * Group words into lines based on Y-coordinate overlap
 */
function groupWordsIntoLines(
  words: Array<{
    text: string;
    boundingBox: { x0: number; y0: number; x1: number; y1: number };
    y0: number;
    y1: number;
  }>,
): Array<{
  text: string;
  boundingBox: { x0: number; y0: number; x1: number; y1: number };
  confidence?: number;
  y0: number;
  y1: number;
}> {
  if (words.length === 0) return [];

  // Sort words by Y position
  words.sort((a, b) => a.y0 - b.y0);

  const lines: Array<{
    text: string;
    boundingBox: { x0: number; y0: number; x1: number; y1: number };
    confidence?: number;
    y0: number;
    y1: number;
  }> = [];

  for (const word of words) {
    // Find line with overlapping Y coordinates
    let foundLine = false;
    for (const line of lines) {
      const overlap = Math.min(line.y1, word.y1) - Math.max(line.y0, word.y0);
      const lineHeight = line.y1 - line.y0;
      const wordHeight = word.y1 - word.y0;
      const overlapRatio = overlap / Math.max(lineHeight, wordHeight);

      if (overlapRatio > 0.3) {
        // Same line - append word
        line.text += ' ' + word.text;
        line.boundingBox.x0 = Math.min(
          line.boundingBox.x0,
          word.boundingBox.x0,
        );
        line.boundingBox.y0 = Math.min(
          line.boundingBox.y0,
          word.boundingBox.y0,
        );
        line.boundingBox.x1 = Math.max(
          line.boundingBox.x1,
          word.boundingBox.x1,
        );
        line.boundingBox.y1 = Math.max(
          line.boundingBox.y1,
          word.boundingBox.y1,
        );
        line.y0 = Math.min(line.y0, word.y0);
        line.y1 = Math.max(line.y1, word.y1);
        foundLine = true;
        break;
      }
    }

    if (!foundLine) {
      // New line
      lines.push({
        text: word.text,
        boundingBox: { ...word.boundingBox },
        y0: word.y0,
        y1: word.y1,
      });
    }
  }

  return lines;
}

/**
 * Extract word text from Vision AI word object
 */
function extractWordText(word: any, fullText: string): string {
  if (!word.symbols || word.symbols.length === 0) {
    return '';
  }

  let wordText = '';
  for (const symbol of word.symbols) {
    if (symbol.text) {
      wordText += symbol.text;
    } else if (symbol.property?.detectedBreak) {
      // Handle line breaks
      if (
        symbol.property.detectedBreak.type === 'SPACE' ||
        symbol.property.detectedBreak.type === 'SURE_SPACE'
      ) {
        wordText += ' ';
      }
    }
  }

  return wordText.trim();
}

/**
 * Extract lines from Document AI response
 */
function extractLinesFromDocumentAi(fullResponse: any): LineWithBoundingBox[] {
  const lines: LineWithBoundingBox[] = [];

  logger.debug(
    `[DOCUMENT AI EXTRACTION] fullResponse keys: ${Object.keys(fullResponse || {}).join(', ')}`,
  );

  if (!fullResponse.pages) {
    logger.warn(
      `[DOCUMENT AI EXTRACTION] No pages found. Available keys: ${Object.keys(fullResponse || {}).join(', ')}`,
    );
    return lines;
  }

  logger.debug(
    `[DOCUMENT AI EXTRACTION] Processing ${fullResponse.pages.length} pages`,
  );

  for (let pageIndex = 0; pageIndex < fullResponse.pages.length; pageIndex++) {
    const page = fullResponse.pages[pageIndex];

    logger.debug(
      `[DOCUMENT AI EXTRACTION] Page ${pageIndex}: has paragraphs: ${!!page.paragraphs}, paragraph count: ${page.paragraphs?.length || 0}`,
    );

    // Document AI provides structured layout: pages -> paragraphs -> lines
    let lineIndex = 0;
    let totalLinesInPage = 0;

    for (const paragraph of page.paragraphs || []) {
      logger.debug(
        `[DOCUMENT AI EXTRACTION] Paragraph has ${paragraph.lines?.length || 0} lines, has layout: ${!!paragraph.layout}`,
      );

      // Check if paragraph has lines array
      if (paragraph.lines && paragraph.lines.length > 0) {
        // Standard structure: paragraph -> lines
        for (const line of paragraph.lines) {
          totalLinesInPage++;
          const lineText = extractLineTextFromDocumentAi(
            line,
            fullResponse.text,
          );
          logger.debug(
            `[DOCUMENT AI EXTRACTION] Line ${lineIndex}: text length=${lineText.length}, has layout: ${!!line.layout}, has boundingPoly: ${!!line.layout?.boundingPoly}`,
          );

          const boundingBox = normalizeDocumentAiBoundingBox(
            line.layout?.boundingPoly?.normalizedVertices ||
              line.layout?.boundingPoly?.vertices,
            page.dimension,
          );

          lines.push({
            text: lineText,
            boundingBox,
            pageIndex,
            lineIndex,
            confidence: line.layout?.confidence,
          });

          lineIndex++;
        }
      } else if (paragraph.layout) {
        // Fallback: paragraph has layout but no lines - extract text directly from paragraph
        const paragraphText = extractParagraphTextFromDocumentAi(
          paragraph,
          fullResponse.text,
        );
        if (paragraphText && paragraphText.trim()) {
          totalLinesInPage++;
          logger.debug(
            `[DOCUMENT AI EXTRACTION] Paragraph text extracted: length=${paragraphText.length}, has boundingPoly: ${!!paragraph.layout?.boundingPoly}`,
          );

          const boundingBox = normalizeDocumentAiBoundingBox(
            paragraph.layout?.boundingPoly?.normalizedVertices ||
              paragraph.layout?.boundingPoly?.vertices,
            page.dimension,
          );

          lines.push({
            text: paragraphText,
            boundingBox,
            pageIndex,
            lineIndex,
            confidence: paragraph.layout?.confidence,
          });

          lineIndex++;
        }
      } else {
        logger.debug(
          `[DOCUMENT AI EXTRACTION] Paragraph has no lines and no layout - skipping`,
        );
      }
    }

    logger.debug(
      `[DOCUMENT AI EXTRACTION] Page ${pageIndex}: Extracted ${totalLinesInPage} lines`,
    );
  }

  logger.log(`[DOCUMENT AI EXTRACTION] Total lines extracted: ${lines.length}`);

  return lines;
}

/**
 * Extract line text from Document AI line object
 */
function extractLineTextFromDocumentAi(line: any, fullText: string): string {
  if (line.layout?.textAnchor?.textSegments) {
    // Extract text using text segments
    let lineText = '';
    for (const segment of line.layout.textAnchor.textSegments) {
      const startIndex = parseInt(segment.startIndex || '0', 10);
      const endIndex = parseInt(segment.endIndex || '0', 10);
      if (
        fullText &&
        startIndex < fullText.length &&
        endIndex <= fullText.length
      ) {
        lineText += fullText.substring(startIndex, endIndex);
      }
    }
    return lineText.trim();
  }

  // Fallback: use detected text if available
  return (line.layout?.text || '').trim();
}

/**
 * Extract paragraph text from Document AI paragraph object (when no lines are present)
 */
function extractParagraphTextFromDocumentAi(
  paragraph: any,
  fullText: string,
): string {
  if (paragraph.layout?.textAnchor?.textSegments) {
    // Extract text using text segments
    let paragraphText = '';
    for (const segment of paragraph.layout.textAnchor.textSegments) {
      const startIndex = parseInt(segment.startIndex || '0', 10);
      const endIndex = parseInt(segment.endIndex || '0', 10);
      if (
        fullText &&
        startIndex < fullText.length &&
        endIndex <= fullText.length
      ) {
        paragraphText += fullText.substring(startIndex, endIndex);
      }
    }
    return paragraphText.trim();
  }

  // Fallback: use detected text if available
  return (paragraph.layout?.text || '').trim();
}

/**
 * Normalize Document AI bounding box to [0, 1] range
 */
function normalizeDocumentAiBoundingBox(
  vertices: any[],
  pageDimension?: { width?: number; height?: number },
): { x0: number; y0: number; x1: number; y1: number } {
  if (!vertices || vertices.length < 4) {
    // Default: entire page
    return { x0: 0, y0: 0, x1: 1, y1: 1 };
  }

  // Check if already normalized (values in [0, 1])
  const firstX = vertices[0].x || 0;
  const firstY = vertices[0].y || 0;

  if (firstX <= 1 && firstY <= 1) {
    // Already normalized
    const xCoords = vertices.map((v) => v.x || 0);
    const yCoords = vertices.map((v) => v.y || 0);
    return {
      x0: Math.max(0, Math.min(1, Math.min(...xCoords))),
      y0: Math.max(0, Math.min(1, Math.min(...yCoords))),
      x1: Math.max(0, Math.min(1, Math.max(...xCoords))),
      y1: Math.max(0, Math.min(1, Math.max(...yCoords))),
    };
  } else {
    // Absolute coordinates - need to normalize
    const pageWidth = pageDimension?.width || 1;
    const pageHeight = pageDimension?.height || 1;

    const xCoords = vertices.map((v) => (v.x || 0) / pageWidth);
    const yCoords = vertices.map((v) => (v.y || 0) / pageHeight);

    return {
      x0: Math.max(0, Math.min(1, Math.min(...xCoords))),
      y0: Math.max(0, Math.min(1, Math.min(...yCoords))),
      x1: Math.max(0, Math.min(1, Math.max(...xCoords))),
      y1: Math.max(0, Math.min(1, Math.max(...yCoords))),
    };
  }
}

/**
 * Fallback: Extract lines from plain text (no bounding boxes)
 */
function extractLinesFromPlainText(
  text: string,
  pageCount: number,
): LineWithBoundingBox[] {
  const lines: LineWithBoundingBox[] = [];
  const textLines = text.split('\n');

  // Distribute lines across pages (rough estimate)
  const linesPerPage = Math.max(1, Math.floor(textLines.length / pageCount));

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const startLine = pageIndex * linesPerPage;
    const endLine =
      pageIndex === pageCount - 1
        ? textLines.length
        : (pageIndex + 1) * linesPerPage;

    for (let i = startLine; i < endLine; i++) {
      const lineText = textLines[i]?.trim() || '';
      if (lineText) {
        lines.push({
          text: lineText,
          boundingBox: { x0: 0, y0: 0, x1: 1, y1: 1 }, // Default: entire page
          pageIndex,
          lineIndex: i - startLine,
        });
      }
    }
  }

  return lines;
}
