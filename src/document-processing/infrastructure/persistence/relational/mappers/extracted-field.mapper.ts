import { ExtractedField } from '../../../../domain/entities/extracted-field.entity';
import { ExtractedFieldEntity } from '../entities/extracted-field.entity';
import { DocumentEntity } from '../entities/document.entity';

export class ExtractedFieldMapper {
  static toDomain(entity: ExtractedFieldEntity): ExtractedField {
    const domain = new ExtractedField();
    domain.id = entity.id;
    domain.documentId = entity.documentId || entity.document?.id;
    domain.fieldKey = entity.fieldKey;
    domain.fieldValue = entity.fieldValue;
    domain.fieldType = entity.fieldType;
    domain.confidence = entity.confidence
      ? parseFloat(entity.confidence.toString())
      : undefined;
    domain.startIndex = entity.startIndex;
    domain.endIndex = entity.endIndex;
    domain.createdAt = entity.createdAt;
    domain.updatedAt = entity.updatedAt;
    return domain;
  }

  static toPersistence(domain: ExtractedField): ExtractedFieldEntity {
    const entity = new ExtractedFieldEntity();
    if (domain.id) entity.id = domain.id;

    const doc = new DocumentEntity();
    doc.id = domain.documentId;
    entity.document = doc;
    entity.documentId = domain.documentId;

    entity.fieldKey = domain.fieldKey;
    entity.fieldValue = domain.fieldValue;
    entity.fieldType = domain.fieldType;
    entity.confidence = domain.confidence;
    entity.startIndex = domain.startIndex;
    entity.endIndex = domain.endIndex;
    return entity;
  }
}
