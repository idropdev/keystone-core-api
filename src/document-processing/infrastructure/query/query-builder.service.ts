import { Injectable, Logger } from '@nestjs/common';
import { SelectQueryBuilder, Brackets } from 'typeorm';
import { DocumentEntity } from '../persistence/relational/entities/document.entity';
import {
  FieldFilterDto,
  ExtractedFieldFilterDto,
  BooleanQueryDto,
  QueryOperator,
} from '../../dto/document-query.dto';
import { DocumentStatus } from '../../domain/enums/document-status.enum';
import { DocumentType } from '../../domain/enums/document-type.enum';

/**
 * QueryBuilderService
 *
 * Converts JSON query DSL to TypeORM QueryBuilder conditions.
 * Handles field filters, extracted field queries, boolean combinators, and full-text search.
 *
 * HIPAA Compliance:
 * - No PHI in logs (only field names and operators, not values)
 * - All queries use parameterized statements to prevent SQL injection
 */
@Injectable()
export class QueryBuilderService {
  private readonly logger = new Logger(QueryBuilderService.name);

  /**
   * Apply query filters to a QueryBuilder
   *
   * @param queryBuilder - TypeORM SelectQueryBuilder
   * @param query - Query DTO (BooleanQueryDto, FieldFilterDto, or ExtractedFieldFilterDto)
   * @param paramPrefix - Prefix for parameter names (to avoid conflicts)
   * @returns QueryBuilder with filters applied
   */
  applyQueryFilters(
    queryBuilder: SelectQueryBuilder<DocumentEntity>,
    query: BooleanQueryDto | FieldFilterDto | ExtractedFieldFilterDto | undefined,
    paramPrefix: string = 'param',
  ): SelectQueryBuilder<DocumentEntity> {
    if (!query) {
      return queryBuilder;
    }

    // Handle boolean query (AND/OR)
    if (this.isBooleanQuery(query)) {
      return this.applyBooleanQuery(queryBuilder, query, paramPrefix);
    }

    // Handle extracted field filter
    if (this.isExtractedFieldFilter(query)) {
      return this.applyExtractedFieldFilter(
        queryBuilder,
        query,
        paramPrefix,
      );
    }

    // Handle field filter
    if (this.isFieldFilter(query)) {
      return this.applyFieldFilter(queryBuilder, query, paramPrefix);
    }

    return queryBuilder;
  }

  /**
   * Apply full-text search to QueryBuilder
   *
   * @param queryBuilder - TypeORM SelectQueryBuilder
   * @param fullText - Full-text search query
   * @returns QueryBuilder with full-text search applied
   */
  applyFullTextSearch(
    queryBuilder: SelectQueryBuilder<DocumentEntity>,
    fullText: string | undefined,
  ): SelectQueryBuilder<DocumentEntity> {
    if (!fullText || fullText.trim().length === 0) {
      return queryBuilder;
    }

    const searchTerm = `%${fullText.trim()}%`;
    const paramName = 'fullText';

    return queryBuilder.andWhere(
      new Brackets((qb) => {
        qb.where('document.fileName ILIKE :fullText', { fullText: searchTerm })
          .orWhere('document.description ILIKE :fullText', {
            fullText: searchTerm,
          })
          .orWhere('document.extractedText ILIKE :fullText', {
            fullText: searchTerm,
          });
      }),
    );
  }

  /**
   * Apply boolean query (AND/OR combinators)
   */
  private applyBooleanQuery(
    queryBuilder: SelectQueryBuilder<DocumentEntity>,
    query: BooleanQueryDto,
    paramPrefix: string,
  ): SelectQueryBuilder<DocumentEntity> {
    if (query.and && query.and.length > 0) {
      queryBuilder.andWhere(
        new Brackets((qb) => {
          query.and!.forEach((condition, index) => {
            const conditionParamPrefix = `${paramPrefix}_and_${index}`;
            if (index === 0) {
              this.applySingleCondition(qb as any, condition, conditionParamPrefix);
            } else {
              qb.andWhere(
                new Brackets((subQb) => {
                  this.applySingleCondition(
                    subQb as any,
                    condition,
                    conditionParamPrefix,
                  );
                }),
              );
            }
          });
        }),
      );
    }

    if (query.or && query.or.length > 0) {
      queryBuilder.andWhere(
        new Brackets((qb) => {
          query.or!.forEach((condition, index) => {
            const conditionParamPrefix = `${paramPrefix}_or_${index}`;
            if (index === 0) {
              this.applySingleCondition(qb as any, condition, conditionParamPrefix);
            } else {
              qb.orWhere(
                new Brackets((subQb) => {
                  this.applySingleCondition(
                    subQb as any,
                    condition,
                    conditionParamPrefix,
                  );
                }),
              );
            }
          });
        }),
      );
    }

    return queryBuilder;
  }

  /**
   * Apply a single condition (field filter or extracted field filter)
   */
  private applySingleCondition(
    queryBuilder: SelectQueryBuilder<DocumentEntity>,
    condition: FieldFilterDto | ExtractedFieldFilterDto | BooleanQueryDto,
    paramPrefix: string,
  ): void {
    if (this.isBooleanQuery(condition)) {
      // Recursive handling of nested boolean queries
      this.applyBooleanQuery(queryBuilder, condition, paramPrefix);
    } else if (this.isExtractedFieldFilter(condition)) {
      this.applyExtractedFieldFilter(queryBuilder, condition, paramPrefix);
    } else if (this.isFieldFilter(condition)) {
      this.applyFieldFilter(queryBuilder, condition, paramPrefix);
    }
  }

  /**
   * Apply field filter to QueryBuilder
   */
  private applyFieldFilter(
    queryBuilder: SelectQueryBuilder<DocumentEntity>,
    filter: FieldFilterDto,
    paramPrefix: string,
  ): SelectQueryBuilder<DocumentEntity> {
    const fieldName = this.mapFieldToColumn(filter.field);
    const paramName = `${paramPrefix}_${filter.field}`;

    switch (filter.op) {
      case QueryOperator.EQ:
        queryBuilder.andWhere(`document.${fieldName} = :${paramName}`, {
          [paramName]: filter.value,
        });
        break;

      case QueryOperator.NE:
        queryBuilder.andWhere(`document.${fieldName} != :${paramName}`, {
          [paramName]: filter.value,
        });
        break;

      case QueryOperator.GT:
        queryBuilder.andWhere(`document.${fieldName} > :${paramName}`, {
          [paramName]: filter.value,
        });
        break;

      case QueryOperator.GTE:
        queryBuilder.andWhere(`document.${fieldName} >= :${paramName}`, {
          [paramName]: filter.value,
        });
        break;

      case QueryOperator.LT:
        queryBuilder.andWhere(`document.${fieldName} < :${paramName}`, {
          [paramName]: filter.value,
        });
        break;

      case QueryOperator.LTE:
        queryBuilder.andWhere(`document.${fieldName} <= :${paramName}`, {
          [paramName]: filter.value,
        });
        break;

      case QueryOperator.CONTAINS:
        queryBuilder.andWhere(`document.${fieldName} ILIKE :${paramName}`, {
          [paramName]: `%${filter.value}%`,
        });
        break;

      case QueryOperator.STARTS_WITH:
        queryBuilder.andWhere(`document.${fieldName} ILIKE :${paramName}`, {
          [paramName]: `${filter.value}%`,
        });
        break;

      case QueryOperator.ENDS_WITH:
        queryBuilder.andWhere(`document.${fieldName} ILIKE :${paramName}`, {
          [paramName]: `%${filter.value}`,
        });
        break;

      case QueryOperator.IN:
        queryBuilder.andWhere(`document.${fieldName} IN (:...${paramName})`, {
          [paramName]: Array.isArray(filter.value)
            ? filter.value
            : [filter.value],
        });
        break;

      case QueryOperator.BETWEEN:
        const [start, end] = Array.isArray(filter.value)
          ? filter.value
          : [filter.value, filter.value];
        queryBuilder.andWhere(
          `document.${fieldName} BETWEEN :${paramName}_start AND :${paramName}_end`,
          {
            [`${paramName}_start`]: start,
            [`${paramName}_end`]: end,
          },
        );
        break;
    }

    return queryBuilder;
  }

  /**
   * Apply extracted field filter to QueryBuilder
   * Requires JOIN with extracted_fields table
   */
  private applyExtractedFieldFilter(
    queryBuilder: SelectQueryBuilder<DocumentEntity>,
    filter: ExtractedFieldFilterDto,
    paramPrefix: string,
  ): SelectQueryBuilder<DocumentEntity> {
    // Ensure extracted_fields table is joined
    const joinAlias = 'extractedField';
    const existingJoin = queryBuilder.expressionMap.joinAttributes.find(
      (join) => join.alias.name === joinAlias,
    );

    if (!existingJoin) {
      queryBuilder.leftJoin('document.extractedFields', joinAlias);
    }

    const keyParamName = `${paramPrefix}_key`;
    const valueParamName = `${paramPrefix}_value`;

    // Filter by field key
    queryBuilder.andWhere(`${joinAlias}.fieldKey = :${keyParamName}`, {
      [keyParamName]: filter.key,
    });

    // Filter by field value based on operator
    switch (filter.op) {
      case QueryOperator.EQ:
        queryBuilder.andWhere(`${joinAlias}.fieldValue = :${valueParamName}`, {
          [valueParamName]: String(filter.value),
        });
        break;

      case QueryOperator.NE:
        queryBuilder.andWhere(
          `${joinAlias}.fieldValue != :${valueParamName}`,
          {
            [valueParamName]: String(filter.value),
          },
        );
        break;

      case QueryOperator.CONTAINS:
        queryBuilder.andWhere(
          `${joinAlias}.fieldValue ILIKE :${valueParamName}`,
          {
            [valueParamName]: `%${filter.value}%`,
          },
        );
        break;

      case QueryOperator.STARTS_WITH:
        queryBuilder.andWhere(
          `${joinAlias}.fieldValue ILIKE :${valueParamName}`,
          {
            [valueParamName]: `${filter.value}%`,
          },
        );
        break;

      case QueryOperator.ENDS_WITH:
        queryBuilder.andWhere(
          `${joinAlias}.fieldValue ILIKE :${valueParamName}`,
          {
            [valueParamName]: `%${filter.value}`,
          },
        );
        break;

      case QueryOperator.IN:
        queryBuilder.andWhere(
          `${joinAlias}.fieldValue IN (:...${valueParamName})`,
          {
            [valueParamName]: Array.isArray(filter.value)
              ? filter.value.map((v) => String(v))
              : [String(filter.value)],
          },
        );
        break;

      default:
        // For other operators (GT, GTE, LT, LTE, BETWEEN), convert to numeric comparison if possible
        const numValue = Number(filter.value);
        if (!isNaN(numValue)) {
          switch (filter.op) {
            case QueryOperator.GT:
              queryBuilder.andWhere(
                `CAST(${joinAlias}.fieldValue AS DECIMAL) > :${valueParamName}`,
                {
                  [valueParamName]: numValue,
                },
              );
              break;
            case QueryOperator.GTE:
              queryBuilder.andWhere(
                `CAST(${joinAlias}.fieldValue AS DECIMAL) >= :${valueParamName}`,
                {
                  [valueParamName]: numValue,
                },
              );
              break;
            case QueryOperator.LT:
              queryBuilder.andWhere(
                `CAST(${joinAlias}.fieldValue AS DECIMAL) < :${valueParamName}`,
                {
                  [valueParamName]: numValue,
                },
              );
              break;
            case QueryOperator.LTE:
              queryBuilder.andWhere(
                `CAST(${joinAlias}.fieldValue AS DECIMAL) <= :${valueParamName}`,
                {
                  [valueParamName]: numValue,
                },
              );
              break;
            case QueryOperator.BETWEEN:
              const [start, end] = Array.isArray(filter.value)
                ? filter.value
                : [filter.value, filter.value];
              const numStart = Number(start);
              const numEnd = Number(end);
              if (!isNaN(numStart) && !isNaN(numEnd)) {
                queryBuilder.andWhere(
                  `CAST(${joinAlias}.fieldValue AS DECIMAL) BETWEEN :${valueParamName}_start AND :${valueParamName}_end`,
                  {
                    [`${valueParamName}_start`]: numStart,
                    [`${valueParamName}_end`]: numEnd,
                  },
                );
              }
              break;
          }
        }
        break;
    }

    return queryBuilder;
  }

  /**
   * Map field name to database column name
   */
  private mapFieldToColumn(field: string): string {
    const fieldMap: Record<string, string> = {
      id: 'id',
      status: 'status',
      documentType: 'documentType',
      fileName: 'fileName',
      mimeType: 'mimeType',
      fileSize: 'fileSize',
      pageCount: 'pageCount',
      confidence: 'confidence',
      uploadedAt: 'uploadedAt',
      processedAt: 'processedAt',
      createdAt: 'createdAt',
    };

    return fieldMap[field] || field;
  }

  /**
   * Type guards
   */
  private isBooleanQuery(
    query: any,
  ): query is BooleanQueryDto {
    return (
      query &&
      typeof query === 'object' &&
      (Array.isArray(query.and) || Array.isArray(query.or))
    );
  }

  private isExtractedFieldFilter(
    query: any,
  ): query is ExtractedFieldFilterDto {
    return (
      query &&
      typeof query === 'object' &&
      typeof query.key === 'string' &&
      'op' in query &&
      'value' in query &&
      !('field' in query)
    );
  }

  private isFieldFilter(query: any): query is FieldFilterDto {
    return (
      query &&
      typeof query === 'object' &&
      typeof query.field === 'string' &&
      'op' in query &&
      'value' in query &&
      !('key' in query)
    );
  }
}
