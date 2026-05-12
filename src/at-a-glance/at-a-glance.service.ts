import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractedFieldEntity } from '../document-processing/infrastructure/persistence/relational/entities/extracted-field.entity';
import { DocumentStatus } from '../document-processing/domain/enums/document-status.enum';
import {
  AtAGlanceSummaryDto,
  AtAGlanceCategoriesDto,
} from './dto/at-a-glance-summary.dto';
import { CategoryDataDto, BloodTypeDataDto } from './dto/category-data.dto';
import {
  AT_A_GLANCE_CATEGORIES,
  mapToCategory,
  UNCATEGORIZED,
} from './utils/field-category-map';

interface QueryRow {
  field_key: string;
  field_value: string;
  document_id: string;
  created_at: Date;
}

const SAMPLES_PER_CATEGORY = 3;

@Injectable()
export class AtAGlanceService {
  private readonly logger = new Logger(AtAGlanceService.name);

  constructor(
    @InjectRepository(ExtractedFieldEntity)
    private readonly extractedFieldRepository: Repository<ExtractedFieldEntity>,
  ) {}

  async getSummaryForUser(userId: number): Promise<AtAGlanceSummaryDto> {
    const rows = await this.extractedFieldRepository
      .createQueryBuilder('ef')
      .innerJoin('ef.document', 'd')
      .where('d.user_id = :userId', { userId })
      .andWhere('d.status = :status', { status: DocumentStatus.PROCESSED })
      .andWhere('d.deleted_at IS NULL')
      .select('ef.field_key', 'field_key')
      .addSelect('ef.field_value', 'field_value')
      .addSelect('ef.document_id', 'document_id')
      .addSelect('ef.created_at', 'created_at')
      .orderBy('ef.created_at', 'DESC')
      .getRawMany<QueryRow>();

    return this.buildSummary(rows);
  }

  private buildSummary(rows: QueryRow[]): AtAGlanceSummaryDto {
    const buckets = new Map<string, QueryRow[]>();
    for (const row of rows) {
      const category = mapToCategory(row.field_key);
      if (category === UNCATEGORIZED) {
        this.logger.debug(
          `at-a-glance: uncategorized field_key=${row.field_key}`,
        );
      }
      const list = buckets.get(category) ?? [];
      list.push(row);
      buckets.set(category, list);
    }

    const categories = {} as AtAGlanceCategoriesDto;
    for (const category of AT_A_GLANCE_CATEGORIES) {
      if (category === 'blood_type') {
        categories.blood_type = this.buildBloodType(
          buckets.get('blood_type') ?? [],
        );
      } else {
        categories[category] = this.buildCategoryData(
          buckets.get(category) ?? [],
        );
      }
    }

    // Only rows whose field_key maps to a known category contribute to the
    // surfaced summary. Uncategorized rows are silently ignored — they don't
    // pad the documents_analyzed count or shift last_updated.
    const categorizedRows = rows.filter(
      (r) => mapToCategory(r.field_key) !== UNCATEGORIZED,
    );

    const allTimestamps = categorizedRows
      .map((r) => r.created_at)
      .filter(Boolean);
    const lastUpdated =
      allTimestamps.length > 0
        ? new Date(
            Math.max(...allTimestamps.map((d) => d.getTime())),
          ).toISOString()
        : null;

    const distinctDocs = new Set(categorizedRows.map((r) => r.document_id));

    return {
      categories,
      last_updated: lastUpdated,
      documents_analyzed: distinctDocs.size,
    };
  }

  private buildCategoryData(rows: QueryRow[]): CategoryDataDto {
    const seenValues = new Set<string>();
    const samples: CategoryDataDto['samples'] = [];
    for (const row of rows) {
      // rows are already sorted DESC by created_at
      if (seenValues.has(row.field_value)) continue;
      seenValues.add(row.field_value);
      if (samples.length < SAMPLES_PER_CATEGORY) {
        samples.push({
          value: row.field_value,
          document_id: row.document_id,
        });
      }
    }
    return {
      count: seenValues.size,
      samples,
    };
  }

  private buildBloodType(rows: QueryRow[]): BloodTypeDataDto {
    if (rows.length === 0) {
      return { value: null, source_document_id: null };
    }
    // Sort DESC by created_at so the most-recent value is first
    const sorted = [...rows].sort(
      (a, b) => b.created_at.getTime() - a.created_at.getTime(),
    );
    return {
      value: sorted[0].field_value,
      source_document_id: sorted[0].document_id,
    };
  }
}
