import { Document } from '../entities/document.entity';
import { ExtractedField } from '../entities/extracted-field.entity';
import { DocumentStatus } from '../enums/document-status.enum';
import { NullableType } from '../../../utils/types/nullable.type';

export interface DocumentRepositoryPort {
  // Create/Update
  save(document: Document): Promise<Document>;
  update(id: string, partial: Partial<Document>): Promise<void>;
  updateStatus(
    id: string,
    status: DocumentStatus,
    fields?: Partial<Document>,
  ): Promise<void>;

  // Read
  findById(id: string): Promise<NullableType<Document>>;
  findByIdAndUserId(
    id: string,
    userId: string | number,
  ): Promise<NullableType<Document>>;
  findByUserId(
    userId: string | number,
    options?: { skip?: number; limit?: number; status?: DocumentStatus[] },
  ): Promise<{ data: Document[]; total: number }>;
  findByOriginManagerId(
    managerId: number,
    options?: { skip?: number; limit?: number; status?: DocumentStatus[] },
  ): Promise<{ data: Document[]; total: number }>;

  // Cleanup
  findExpired(): Promise<Document[]>; // Where scheduledDeletionAt < now
  hardDelete(id: string): Promise<void>;

  // Extracted fields
  saveExtractedFields(fields: ExtractedField[]): Promise<void>;
  findExtractedFieldsByDocumentId(
    documentId: string,
  ): Promise<ExtractedField[]>;
}
