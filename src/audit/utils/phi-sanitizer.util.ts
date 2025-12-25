/**
 * PHI Sanitizer Utility
 * 
 * HIPAA Compliance: Ensures no Protected Health Information (PHI) is logged.
 * 
 * PHI Exclusion Rules:
 * - ❌ Never log: document contents, OCR text, extracted field values, user names, emails, addresses
 * - ✅ Always log: documentId, userId, managerId, eventType, timestamp, success, action
 * - ✅ Optional metadata: fileSize, documentType, grantType (non-PHI metadata only)
 * 
 * This utility provides functions to sanitize data before logging to ensure HIPAA compliance.
 */

/**
 * Sanitize error messages to remove PHI and sensitive data
 * 
 * Removes:
 * - Email addresses
 * - Tokens (Bearer tokens, API keys)
 * - SSN patterns
 * - Long numbers (potential medical record numbers)
 * - Phone numbers
 * 
 * @param error - Error message to sanitize
 * @returns Sanitized error message (max 500 chars)
 */
export function sanitizeErrorMessage(error: string): string {
  if (!error) {
    return '';
  }

  let sanitized = error;

  // Remove email addresses
  sanitized = sanitized.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    '[EMAIL_REDACTED]',
  );

  // Remove tokens
  sanitized = sanitized.replace(/Bearer\s+[^\s]+/gi, 'Bearer [TOKEN_REDACTED]');
  sanitized = sanitized.replace(/token[:\s]+[^\s]+/gi, 'token: [REDACTED]');
  sanitized = sanitized.replace(/api[_-]?key[:\s]+[^\s]+/gi, 'api_key: [REDACTED]');

  // Remove SSN patterns (XXX-XX-XXXX)
  sanitized = sanitized.replace(/\d{3}-\d{2}-\d{4}/g, '[SSN_REDACTED]');

  // Remove phone numbers (various formats)
  sanitized = sanitized.replace(
    /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    '[PHONE_REDACTED]',
  );

  // Remove long numbers (potential medical record numbers, account numbers)
  sanitized = sanitized.replace(/\d{10,}/g, '[NUMBER_REDACTED]');

  // Remove potential names (capitalized words that might be names)
  // This is conservative - only remove if it looks like "FirstName LastName" pattern
  sanitized = sanitized.replace(
    /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
    '[NAME_REDACTED]',
  );

  // Truncate to prevent excessive logging
  return sanitized.substring(0, 500);
}

/**
 * Sanitize user agent string
 * 
 * Truncates to 200 characters to prevent excessive logging.
 * User agent strings don't typically contain PHI, but truncation prevents
 * potential information leakage.
 * 
 * @param userAgent - User agent string
 * @returns Sanitized user agent (max 200 chars)
 */
export function sanitizeUserAgent(userAgent: string): string {
  if (!userAgent) {
    return '';
  }

  // Truncate very long user agent strings
  return userAgent.substring(0, 200);
}

/**
 * Sanitize metadata object to remove PHI
 * 
 * Removes:
 * - Field values (fieldValue, editedValue, ocrText, extractedText)
 * - User names (userName, patientName, firstName, lastName)
 * - Email addresses
 * - Phone numbers
 * - Any nested objects that might contain PHI
 * 
 * Keeps:
 * - Field keys (identifiers like "patient_name")
 * - Counts (fieldCount, entityCount)
 * - IDs (documentId, userId, managerId)
 * - Status values
 * - Document types (categories, not content)
 * - File sizes (bytes, not PHI)
 * 
 * @param metadata - Metadata object to sanitize
 * @returns Sanitized metadata object (no PHI)
 */
export function sanitizeMetadata(
  metadata: Record<string, any> | undefined,
): Record<string, any> {
  if (!metadata) {
    return {};
  }

  const sanitized: Record<string, any> = { ...metadata };

  // Remove field values (PHI)
  const phiFieldKeys = [
    'fieldValue',
    'editedValue',
    'ocrText',
    'extractedText',
    'text',
    'content',
    'value',
    'data',
  ];

  phiFieldKeys.forEach((key) => {
    if (sanitized[key] !== undefined) {
      delete sanitized[key];
    }
  });

  // Remove user names (PHI)
  const nameFieldKeys = [
    'userName',
    'patientName',
    'firstName',
    'lastName',
    'fullName',
    'name',
  ];

  nameFieldKeys.forEach((key) => {
    if (sanitized[key] !== undefined) {
      delete sanitized[key];
    }
  });

  // Remove email addresses
  Object.keys(sanitized).forEach((key) => {
    const value = sanitized[key];
    if (typeof value === 'string' && value.includes('@')) {
      // Check if it looks like an email
      if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(value)) {
        delete sanitized[key];
      }
    }
  });

  // Remove phone numbers
  Object.keys(sanitized).forEach((key) => {
    const value = sanitized[key];
    if (typeof value === 'string') {
      // Check if it looks like a phone number
      if (/(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(value)) {
        delete sanitized[key];
      }
    }
  });

  // Sanitize nested objects recursively
  Object.keys(sanitized).forEach((key) => {
    const value = sanitized[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeMetadata(value as Record<string, any>);
    } else if (Array.isArray(value)) {
      // Sanitize array elements if they're objects
      sanitized[key] = value.map((item) =>
        item && typeof item === 'object'
          ? sanitizeMetadata(item as Record<string, any>)
          : item,
      );
    }
  });

  return sanitized;
}

/**
 * Validate that metadata does not contain PHI
 * 
 * Performs a final check to ensure no PHI slipped through.
 * Throws an error if PHI is detected (should never happen in production).
 * 
 * @param metadata - Metadata to validate
 * @throws Error if PHI is detected
 */
export function validateNoPhi(metadata: Record<string, any>): void {
  const phiPatterns = [
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // Email
    /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/, // Phone
    /\d{3}-\d{2}-\d{4}/, // SSN
  ];

  const checkValue = (value: any, path: string = ''): void => {
    if (typeof value === 'string') {
      phiPatterns.forEach((pattern) => {
        if (pattern.test(value)) {
          throw new Error(
            `PHI detected in metadata at path: ${path}. Value contains potential PHI.`,
          );
        }
      });
    } else if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          checkValue(item, `${path}[${index}]`);
        });
      } else {
        Object.keys(value).forEach((key) => {
          checkValue(value[key], path ? `${path}.${key}` : key);
        });
      }
    }
  };

  checkValue(metadata);
}

