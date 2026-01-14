import { BadRequestException } from '@nestjs/common';
import { DocumentStatus } from '../enums/document-status.enum';

/**
 * Document State Machine Utility
 *
 * Enforces valid state transitions according to Phase 2 design.
 *
 * Valid Transitions:
 * - UPLOADED → STORED (automatic, system)
 * - UPLOADED → ERROR (automatic, system)
 * - STORED → PROCESSING (origin manager only)
 * - STORED → ERROR (automatic, system)
 * - PROCESSING → PROCESSED (automatic, system)
 * - PROCESSING → ERROR (automatic, system)
 * - ERROR → PROCESSING (retry - origin manager or system)
 * - ERROR → STORED (manual reset - origin manager)
 * - PROCESSED → PROCESSING (re-process - origin manager only)
 */
export class DocumentStateMachine {
  /**
   * Valid state transitions map
   * Key: from state, Value: array of valid to states
   */
  private static readonly VALID_TRANSITIONS: Map<
    DocumentStatus,
    DocumentStatus[]
  > = new Map([
    [DocumentStatus.UPLOADED, [DocumentStatus.STORED, DocumentStatus.FAILED]],
    [DocumentStatus.STORED, [DocumentStatus.PROCESSING, DocumentStatus.FAILED]],
    [
      DocumentStatus.PROCESSING,
      [DocumentStatus.PROCESSED, DocumentStatus.FAILED],
    ],
    [DocumentStatus.PROCESSED, [DocumentStatus.PROCESSING]], // Re-processing
    [DocumentStatus.FAILED, [DocumentStatus.PROCESSING, DocumentStatus.STORED]], // Retry or reset
    [DocumentStatus.QUEUED, [DocumentStatus.PROCESSING, DocumentStatus.FAILED]],
    // ARCHIVED is terminal (no transitions allowed)
  ]);

  /**
   * Check if a state transition is valid
   *
   * @param fromStatus - Current document status
   * @param toStatus - Target document status
   * @returns true if transition is valid, false otherwise
   */
  static isValidTransition(
    fromStatus: DocumentStatus,
    toStatus: DocumentStatus,
  ): boolean {
    // Same state is always valid (idempotent)
    if (fromStatus === toStatus) {
      return true;
    }

    // ARCHIVED is terminal - no transitions allowed
    if (fromStatus === DocumentStatus.ARCHIVED) {
      return false;
    }

    const validTargets = this.VALID_TRANSITIONS.get(fromStatus);
    if (!validTargets) {
      return false;
    }

    return validTargets.includes(toStatus);
  }

  /**
   * Validate a state transition and throw if invalid
   *
   * @param fromStatus - Current document status
   * @param toStatus - Target document status
   * @throws BadRequestException if transition is invalid
   */
  static validateTransition(
    fromStatus: DocumentStatus,
    toStatus: DocumentStatus,
  ): void {
    if (!this.isValidTransition(fromStatus, toStatus)) {
      throw new BadRequestException(
        `Invalid state transition: ${fromStatus} → ${toStatus}. ` +
          `Valid transitions from ${fromStatus}: ${this.VALID_TRANSITIONS.get(fromStatus)?.join(', ') || 'none'}`,
      );
    }
  }

  /**
   * Get all valid target states for a given source state
   *
   * @param fromStatus - Source document status
   * @returns Array of valid target states
   */
  static getValidTargetStates(fromStatus: DocumentStatus): DocumentStatus[] {
    return this.VALID_TRANSITIONS.get(fromStatus) || [];
  }

  /**
   * Check if a state is terminal (no transitions allowed)
   *
   * @param status - Document status
   * @returns true if status is terminal
   */
  static isTerminal(status: DocumentStatus): boolean {
    return status === DocumentStatus.ARCHIVED;
  }

  /**
   * Check if a state allows processing
   *
   * @param status - Document status
   * @returns true if status allows OCR processing
   */
  static canProcess(status: DocumentStatus): boolean {
    return (
      status === DocumentStatus.STORED ||
      status === DocumentStatus.PROCESSED ||
      status === DocumentStatus.FAILED
    );
  }

  /**
   * Check if a state allows retry
   *
   * @param status - Document status
   * @returns true if status allows retry
   */
  static canRetry(status: DocumentStatus): boolean {
    return status === DocumentStatus.FAILED;
  }
}
