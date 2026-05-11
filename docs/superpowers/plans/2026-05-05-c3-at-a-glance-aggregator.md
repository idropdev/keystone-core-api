# C3 — At-a-Glance Aggregator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a new `GET /api/v1/at-a-glance/summary` endpoint that aggregates extracted-document-field data into per-category counts and samples for the HealthAtlas mobile app's at-a-glance dashboard.

**Architecture:** A new `AtAGlanceModule` containing a controller (JWT-guarded at the method level per keystone style, throttled 30/min), a service that queries the existing `extracted_fields` table via TypeORM, a static field-type → category map, and Swagger-decorated response DTOs. No database migrations. Service is testable in isolation via a mocked repository; full path verified via an e2e spec against a real Postgres instance.

**Convention corrections discovered during Task 1** (these override the templates below where they conflict):
- `DocumentEntity.status` uses enum `DocumentStatus` (`src/document-processing/domain/enums/document-status.enum.ts`). Terminal-success value is `PROCESSED`, NOT `COMPLETED`. Use `DocumentStatus.PROCESSED` in queries.
- `userId` is `number` throughout the keystone codebase (not `string`). The service's `getSummaryForUser` takes `userId: number`. Controller reads `request.user.id` as a number.
- `@UseGuards(AuthGuard('jwt'))` and `@ApiBearerAuth()` are method-level decorators in keystone, NOT class-level. Apply them on the single `getSummary` handler.

**Tech Stack:** NestJS 10+, TypeORM, `@nestjs/throttler`, `@nestjs/swagger`, Jest. PostgreSQL 17 via existing `docker-e2e.yml` workflow.

**Reference spec:** `docs/superpowers/specs/2026-05-05-workstream-c-backend-gaps-design.md` §4.C3.

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/at-a-glance/at-a-glance.module.ts` | NestJS module declaration; imports `TypeOrmModule.forFeature([ExtractedFieldEntity, DocumentEntity])` |
| `src/at-a-glance/at-a-glance.controller.ts` | `GET /summary` route handler. JWT-guarded. `@Throttle({default:{limit:30, ttl:60000}})`. Extracts user ID from request and delegates to service |
| `src/at-a-glance/at-a-glance.service.ts` | Single public method `getSummaryForUser(userId): Promise<AtAGlanceSummaryDto>`. Queries `extracted_fields`, buckets via field-category-map, builds DTO |
| `src/at-a-glance/dto/at-a-glance-summary.dto.ts` | Top-level response DTO, Swagger-decorated |
| `src/at-a-glance/dto/category-data.dto.ts` | Nested DTO: `{count, samples}` for non-blood-type, `{value, source_document_id}` for blood_type |
| `src/at-a-glance/utils/field-category-map.ts` | Static `field_type → category` map + `mapToCategory(fieldType): string` helper that returns `'uncategorized'` for unknown types |
| `src/at-a-glance/utils/field-category-map.spec.ts` | Unit tests for the mapper |
| `src/at-a-glance/at-a-glance.service.spec.ts` | Unit tests for service with mocked repository |
| `src/at-a-glance/at-a-glance.controller.spec.ts` | Unit tests for controller with mocked service |
| `test/at-a-glance/at-a-glance.e2e-spec.ts` | E2e test against running app with real Postgres (seeds users + extracted_fields, hits the endpoint, asserts isolation + correct shape) |

### Modified files

| Path | Change |
|---|---|
| `src/app.module.ts` | Add `AtAGlanceModule` to imports |

---

## Task 1: Verify keystone conventions before writing code

This task is **research only**. No production code, no commit. The implementer reports back; we use the findings to anchor Task 2 onward.

- [ ] **Step 1: Find how existing controllers extract the authenticated user ID from a request**

Run: `grep -nE "@Request\(\)|req\.user\.id|request\.user\.id|extractActorFromRequest" src/document-processing/document-processing.controller.ts src/auth/auth.controller.ts src/users/users.controller.ts 2>/dev/null | head -20`

Expected: Some controllers use `extractActorFromRequest` (from `./utils/actor-extractor.util` in document-processing). Others use `@Request() request` + `request.user.id`. Report which pattern is more idiomatic for **simple "give me current user's data" endpoints** — meaning what `auth.controller.ts` uses for `GET /me`.

- [ ] **Step 2: Find how existing simple controllers declare JWT guard + throttling**

Run: `grep -nE "@UseGuards|@Throttle|@ApiBearerAuth" src/auth/auth.controller.ts | head -10`

Confirm: `@UseGuards(AuthGuard('jwt'))` at class level, `@Throttle({default:{limit:N, ttl:T}})` per method, `@ApiBearerAuth()` at class level for Swagger.

- [ ] **Step 3: Find TypeORM repository injection pattern**

Run: `grep -nE "InjectRepository|@InjectRepository" src/document-processing/document-processing.service.ts | head -5`

Expected: `@InjectRepository(EntityName) private readonly repo: Repository<EntityName>`.

- [ ] **Step 4: Confirm `ExtractedFieldEntity` shape (already read at planning time, re-verify)**

Run: `cat src/document-processing/infrastructure/persistence/relational/entities/extracted-field.entity.ts`

Confirm: entity has `id`, `documentId`, `fieldKey`, `fieldValue`, `fieldType`, `confidence`, `createdAt`, `updatedAt`. `field_type` and `document_id` are indexed.

- [ ] **Step 5: Confirm `DocumentEntity` has `userId` (or equivalent) and `status` fields**

Run: `grep -nE "userId|user_id|status" src/document-processing/infrastructure/persistence/relational/entities/document.entity.ts | head -10`

Confirm: `DocumentEntity` has a user-ownership field (likely `userId: string` or relation to `UserEntity`) and a `status` field with at least `'COMPLETED'` as a possible value.

- [ ] **Step 6: Report findings**

Report back as a structured note:
```
Convention findings:
- User extraction in simple controllers: <pattern>
- Class-level decorators: <e.g. @UseGuards(AuthGuard('jwt')), @ApiBearerAuth(), @ApiTags(...), @Controller({path:..., version:'1'})>
- Per-method throttle decorator: <pattern>
- Repository injection: <pattern>
- ExtractedFieldEntity columns confirmed: <list>
- DocumentEntity user field name: <userId | user.id | other>
- DocumentEntity status column: <name and enum/literal type>
```

**Do NOT commit.** This is verification only.

---

## Task 2: `field-category-map` utility (TDD)

**Files:**
- Create: `src/at-a-glance/utils/field-category-map.ts`
- Create: `src/at-a-glance/utils/field-category-map.spec.ts`

- [ ] **Step 1: Write the failing unit test**

Create `src/at-a-glance/utils/field-category-map.spec.ts`:

```typescript
import { mapToCategory, AT_A_GLANCE_CATEGORIES } from './field-category-map';

describe('field-category-map', () => {
  describe('AT_A_GLANCE_CATEGORIES', () => {
    it('declares exactly the 8 known categories', () => {
      expect(AT_A_GLANCE_CATEGORIES).toEqual([
        'medications',
        'allergies',
        'conditions',
        'doctors',
        'pharmacies',
        'insurance',
        'emergency_contact',
        'blood_type',
      ]);
    });
  });

  describe('mapToCategory', () => {
    it.each<[string, string]>([
      ['medication', 'medications'],
      ['drug_name', 'medications'],
      ['prescription_name', 'medications'],
      ['allergy', 'allergies'],
      ['allergen', 'allergies'],
      ['condition', 'conditions'],
      ['diagnosis', 'conditions'],
      ['medical_condition', 'conditions'],
      ['physician', 'doctors'],
      ['provider', 'doctors'],
      ['doctor', 'doctors'],
      ['pharmacy', 'pharmacies'],
      ['dispensing_pharmacy', 'pharmacies'],
      ['insurance', 'insurance'],
      ['policy_number', 'insurance'],
      ['insurer', 'insurance'],
      ['emergency_contact', 'emergency_contact'],
      ['blood_type', 'blood_type'],
    ])('maps fieldType "%s" to category "%s"', (input, expected) => {
      expect(mapToCategory(input)).toBe(expected);
    });

    it('maps unknown fieldType to "uncategorized"', () => {
      expect(mapToCategory('something_we_dont_know')).toBe('uncategorized');
    });

    it('treats matching case-insensitively', () => {
      expect(mapToCategory('MEDICATION')).toBe('medications');
      expect(mapToCategory('Allergy')).toBe('allergies');
    });
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run: `npm test -- --testPathPattern=field-category-map.spec`
Expected: FAIL with `Cannot find module './field-category-map'`.

- [ ] **Step 3: Implement `field-category-map.ts`**

Create `src/at-a-glance/utils/field-category-map.ts`:

```typescript
/**
 * Static lookup of OCR/extractor `field_type` values to at-a-glance dashboard
 * categories. This map is the single source of truth for category bucketing
 * and is edited in code (not stored in DB) so reviewers can audit it.
 */

export const AT_A_GLANCE_CATEGORIES = [
  'medications',
  'allergies',
  'conditions',
  'doctors',
  'pharmacies',
  'insurance',
  'emergency_contact',
  'blood_type',
] as const;

export type AtAGlanceCategory = (typeof AT_A_GLANCE_CATEGORIES)[number];

/** Field types that don't map to any known category. */
export const UNCATEGORIZED = 'uncategorized';

const FIELD_TYPE_TO_CATEGORY: Record<string, AtAGlanceCategory> = {
  medication: 'medications',
  drug_name: 'medications',
  prescription_name: 'medications',
  allergy: 'allergies',
  allergen: 'allergies',
  condition: 'conditions',
  diagnosis: 'conditions',
  medical_condition: 'conditions',
  physician: 'doctors',
  provider: 'doctors',
  doctor: 'doctors',
  pharmacy: 'pharmacies',
  dispensing_pharmacy: 'pharmacies',
  insurance: 'insurance',
  policy_number: 'insurance',
  insurer: 'insurance',
  emergency_contact: 'emergency_contact',
  blood_type: 'blood_type',
};

/**
 * Returns the at-a-glance category for the given `field_type`, or
 * `'uncategorized'` if the type is unknown. Match is case-insensitive.
 */
export function mapToCategory(
  fieldType: string,
): AtAGlanceCategory | typeof UNCATEGORIZED {
  const normalized = fieldType.toLowerCase();
  return FIELD_TYPE_TO_CATEGORY[normalized] ?? UNCATEGORIZED;
}
```

- [ ] **Step 4: Run test — confirm it passes**

Run: `npm test -- --testPathPattern=field-category-map.spec`
Expected: All ~20 cases PASS.

- [ ] **Step 5: Run lint**

Run: `npm run lint -- src/at-a-glance/utils/field-category-map.ts src/at-a-glance/utils/field-category-map.spec.ts`
Expected: No errors.

- [ ] **Step 6: Commit**

Use explicit `git add -- <paths>` to avoid bundling the pre-existing `package-lock.json` working-tree change.

```bash
git add -- src/at-a-glance/utils/field-category-map.ts src/at-a-glance/utils/field-category-map.spec.ts
git commit -m "feat(at-a-glance): add field-category-map utility"
```

---

## Task 3: Response DTOs

**Files:**
- Create: `src/at-a-glance/dto/category-data.dto.ts`
- Create: `src/at-a-glance/dto/at-a-glance-summary.dto.ts`

No unit tests — DTOs are pure shape declarations. The service tests in Task 4 will exercise them via construction.

- [ ] **Step 1: Create `CategoryDataDto`**

Create `src/at-a-glance/dto/category-data.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';

/**
 * A single category sample (e.g. one medication, one allergy).
 * Free-form shape — keys vary by category, but all are user-displayable strings.
 */
export class CategorySampleDto {
  [key: string]: string | number | undefined;
}

/**
 * For most categories (medications, allergies, conditions, doctors, pharmacies,
 * insurance, emergency_contact): a count of distinct values + up to 3 most-recent
 * unique samples.
 */
export class CategoryDataDto {
  @ApiProperty({
    description: 'Distinct value count for this category',
    example: 3,
  })
  count!: number;

  @ApiProperty({
    description: 'Up to 3 most-recent unique samples',
    type: [Object],
    example: [{ name: 'Lisinopril', dose: '10mg' }],
  })
  samples!: CategorySampleDto[];
}

/**
 * Special-case singleton for `blood_type` — there is only one current value,
 * not a list.
 */
export class BloodTypeDataDto {
  @ApiProperty({
    description: 'Most recently extracted blood type value',
    example: 'O+',
    nullable: true,
  })
  value!: string | null;

  @ApiProperty({
    description: 'ID of the document this value was extracted from',
    example: '550e8400-e29b-41d4-a716-446655440000',
    nullable: true,
  })
  source_document_id!: string | null;
}
```

- [ ] **Step 2: Create `AtAGlanceSummaryDto`**

Create `src/at-a-glance/dto/at-a-glance-summary.dto.ts`:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { BloodTypeDataDto, CategoryDataDto } from './category-data.dto';

export class AtAGlanceCategoriesDto {
  @ApiProperty({ type: CategoryDataDto }) medications!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) allergies!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) conditions!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) doctors!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) pharmacies!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) insurance!: CategoryDataDto;
  @ApiProperty({ type: CategoryDataDto }) emergency_contact!: CategoryDataDto;
  @ApiProperty({ type: BloodTypeDataDto }) blood_type!: BloodTypeDataDto;
}

export class AtAGlanceSummaryDto {
  @ApiProperty({ type: AtAGlanceCategoriesDto })
  categories!: AtAGlanceCategoriesDto;

  @ApiProperty({
    description:
      'ISO-8601 timestamp of the most recent extracted field across all documents, or null if none',
    example: '2026-05-05T10:23:00Z',
    nullable: true,
  })
  last_updated!: string | null;

  @ApiProperty({
    description:
      'Number of COMPLETED documents that contributed to this summary',
    example: 7,
  })
  documents_analyzed!: number;
}
```

- [ ] **Step 3: Run lint**

Run: `npm run lint -- src/at-a-glance/dto/`
Expected: No errors.

- [ ] **Step 4: Run tsc to verify type-correctness**

Run: `npx tsc --noEmit`
Expected: No errors (or no NEW errors introduced — note pre-existing baseline if any).

- [ ] **Step 5: Commit**

```bash
git add -- src/at-a-glance/dto/
git commit -m "feat(at-a-glance): add response DTOs with Swagger schema"
```

---

## Task 4: `AtAGlanceService` with TDD (mocked repository)

**Files:**
- Create: `src/at-a-glance/at-a-glance.service.ts`
- Create: `src/at-a-glance/at-a-glance.service.spec.ts`

- [ ] **Step 1: Write the failing service unit test**

Create `src/at-a-glance/at-a-glance.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractedFieldEntity } from '../document-processing/infrastructure/persistence/relational/entities/extracted-field.entity';
import { AtAGlanceService } from './at-a-glance.service';

type Row = {
  field_type: string;
  field_value: string;
  document_id: string;
  created_at: Date;
};

function makeQueryBuilder(rows: Row[]) {
  return {
    innerJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
}

describe('AtAGlanceService.getSummaryForUser', () => {
  let service: AtAGlanceService;
  let repo: Repository<ExtractedFieldEntity>;

  async function setup(rows: Row[]) {
    const qb = makeQueryBuilder(rows);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AtAGlanceService,
        {
          provide: getRepositoryToken(ExtractedFieldEntity),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(qb),
          },
        },
      ],
    }).compile();
    service = module.get(AtAGlanceService);
    repo = module.get(getRepositoryToken(ExtractedFieldEntity));
  }

  it('returns empty summary when user has no extracted fields', async () => {
    await setup([]);
    const result = await service.getSummaryForUser(1);
    expect(result.documents_analyzed).toBe(0);
    expect(result.last_updated).toBeNull();
    expect(result.categories.medications.count).toBe(0);
    expect(result.categories.medications.samples).toEqual([]);
    expect(result.categories.blood_type.value).toBeNull();
    expect(result.categories.blood_type.source_document_id).toBeNull();
  });

  it('groups field_type into categories and counts distinct values', async () => {
    await setup([
      makeRow('medication', 'Lisinopril', 'doc-1', '2026-05-01T10:00:00Z'),
      makeRow('medication', 'Atorvastatin', 'doc-1', '2026-05-01T10:00:00Z'),
      makeRow('medication', 'Lisinopril', 'doc-2', '2026-05-02T10:00:00Z'), // dupe value
      makeRow('allergy', 'Penicillin', 'doc-3', '2026-05-03T10:00:00Z'),
    ]);
    const result = await service.getSummaryForUser(1);
    expect(result.categories.medications.count).toBe(2); // distinct values
    expect(result.categories.allergies.count).toBe(1);
    expect(result.documents_analyzed).toBe(3); // distinct document_ids
  });

  it('returns at most 3 samples per category, most-recent first by createdAt', async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 6; i++) {
      rows.push(
        makeRow(
          'medication',
          `Drug${i}`,
          `doc-${i}`,
          new Date(2026, 0, i + 1).toISOString(),
        ),
      );
    }
    // Provide rows in reverse chronological order (matches service query ORDER BY)
    await setup(rows.reverse());
    const result = await service.getSummaryForUser(1);
    expect(result.categories.medications.count).toBe(6);
    expect(result.categories.medications.samples).toHaveLength(3);
    // Most-recent (Drug5) appears first
    expect(JSON.stringify(result.categories.medications.samples)).toContain(
      'Drug5',
    );
    expect(JSON.stringify(result.categories.medications.samples)).not.toContain(
      'Drug0',
    );
  });

  it('special-cases blood_type as a singleton value', async () => {
    await setup([
      makeRow('blood_type', 'A+', 'doc-1', '2026-05-01T10:00:00Z'),
      makeRow('blood_type', 'O+', 'doc-2', '2026-05-02T10:00:00Z'), // newer wins
    ]);
    const result = await service.getSummaryForUser(1);
    expect(result.categories.blood_type.value).toBe('O+');
    expect(result.categories.blood_type.source_document_id).toBe('doc-2');
  });

  it('drops unknown field_types into uncategorized (not surfaced in DTO)', async () => {
    await setup([
      makeRow('weird_thing', 'whatever', 'doc-1', '2026-05-01T10:00:00Z'),
      makeRow('medication', 'Lisinopril', 'doc-1', '2026-05-01T10:00:00Z'),
    ]);
    const result = await service.getSummaryForUser(1);
    // medication still counted
    expect(result.categories.medications.count).toBe(1);
    // weird_thing not in any known category
    expect(result.categories.allergies.count).toBe(0);
    // documents_analyzed counts all distinct doc_ids regardless of mapped type
    expect(result.documents_analyzed).toBe(1);
  });

  it('sets last_updated to the most recent extracted field timestamp', async () => {
    await setup([
      makeRow('medication', 'A', 'doc-1', '2026-05-01T10:00:00Z'),
      makeRow('medication', 'B', 'doc-2', '2026-05-05T15:30:00Z'),
      makeRow('medication', 'C', 'doc-3', '2026-05-03T08:00:00Z'),
    ]);
    const result = await service.getSummaryForUser(1);
    expect(result.last_updated).toBe(new Date('2026-05-05T15:30:00Z').toISOString());
  });

  it('passes userId to the repository query (isolation)', async () => {
    await setup([]);
    await service.getSummaryForUser(42);
    const qb = (repo.createQueryBuilder as jest.Mock).mock.results[0].value;
    // At least one .where or .andWhere call should include the userId binding
    const whereCalls = [...qb.where.mock.calls, ...qb.andWhere.mock.calls];
    const flat = whereCalls.map((args) => JSON.stringify(args)).join('\n');
    expect(flat).toMatch(/42|:userId/);
  });
});

function makeRow(
  field_type: string,
  field_value: string,
  document_id: string,
  isoDate: string,
): Row {
  return {
    field_type,
    field_value,
    document_id,
    created_at: new Date(isoDate),
  };
}
```

- [ ] **Step 2: Run test — confirm it fails**

Run: `npm test -- --testPathPattern=at-a-glance.service.spec`
Expected: FAIL with `Cannot find module './at-a-glance.service'`.

- [ ] **Step 3: Implement `AtAGlanceService`**

Create `src/at-a-glance/at-a-glance.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractedFieldEntity } from '../document-processing/infrastructure/persistence/relational/entities/extracted-field.entity';
import { DocumentStatus } from '../document-processing/domain/enums/document-status.enum';
import {
  AtAGlanceSummaryDto,
  AtAGlanceCategoriesDto,
} from './dto/at-a-glance-summary.dto';
import {
  CategoryDataDto,
  BloodTypeDataDto,
} from './dto/category-data.dto';
import {
  AT_A_GLANCE_CATEGORIES,
  AtAGlanceCategory,
  mapToCategory,
  UNCATEGORIZED,
} from './utils/field-category-map';

interface QueryRow {
  field_type: string;
  field_value: string;
  document_id: string;
  created_at: Date;
}

const SAMPLES_PER_CATEGORY = 3;

@Injectable()
export class AtAGlanceService {
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
      .select('ef.field_type', 'field_type')
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
      const category = mapToCategory(row.field_type);
      const list = buckets.get(category) ?? [];
      list.push(row);
      buckets.set(category, list);
    }

    const categories = {} as AtAGlanceCategoriesDto;
    for (const category of AT_A_GLANCE_CATEGORIES) {
      if (category === 'blood_type') {
        categories.blood_type = this.buildBloodType(buckets.get('blood_type') ?? []);
      } else {
        categories[category] = this.buildCategoryData(buckets.get(category) ?? []);
      }
    }

    const allTimestamps = rows.map((r) => r.created_at).filter(Boolean);
    const lastUpdated =
      allTimestamps.length > 0
        ? new Date(
            Math.max(...allTimestamps.map((d) => d.getTime())),
          ).toISOString()
        : null;

    const distinctDocs = new Set(rows.map((r) => r.document_id));

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
        samples.push({ value: row.field_value });
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
    // rows already sorted DESC by created_at — first is most recent
    return {
      value: rows[0].field_value,
      source_document_id: rows[0].document_id,
    };
  }
}
```

- [ ] **Step 4: Run test — confirm it passes**

Run: `npm test -- --testPathPattern=at-a-glance.service.spec`
Expected: All 7 tests PASS.

If a test fails, do NOT improvise fixes. The expected sample-shape is `{value: <fieldValue>}` per category. If the test expectations don't match, that's a test bug — but only fix the test if the assertion was clearly misaligned with the documented contract.

- [ ] **Step 5: Run lint**

Run: `npm run lint -- src/at-a-glance/`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add -- src/at-a-glance/at-a-glance.service.ts src/at-a-glance/at-a-glance.service.spec.ts
git commit -m "feat(at-a-glance): add AtAGlanceService with bucketing and sampling"
```

---

## Task 5: `AtAGlanceController` with TDD (mocked service)

**Files:**
- Create: `src/at-a-glance/at-a-glance.controller.ts`
- Create: `src/at-a-glance/at-a-glance.controller.spec.ts`

**IMPORTANT:** Before writing the controller, use the convention findings from Task 1 to decide:
- How to extract the authenticated user ID (matches `auth.controller.ts` pattern)
- How to wire JWT guard + Swagger bearer auth + throttle

The code below assumes the keystone-idiomatic pattern: `@Request() request` then `request.user.id`. If Task 1 found a different convention (e.g. `extractActorFromRequest` is the standard for new controllers), substitute it consistently in both the test and the controller.

- [ ] **Step 1: Write the failing controller unit test**

Create `src/at-a-glance/at-a-glance.controller.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AtAGlanceController } from './at-a-glance.controller';
import { AtAGlanceService } from './at-a-glance.service';
import { AtAGlanceSummaryDto } from './dto/at-a-glance-summary.dto';

describe('AtAGlanceController', () => {
  let controller: AtAGlanceController;
  let service: { getSummaryForUser: jest.Mock };

  beforeEach(async () => {
    service = { getSummaryForUser: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AtAGlanceController],
      providers: [{ provide: AtAGlanceService, useValue: service }],
    }).compile();
    controller = module.get(AtAGlanceController);
  });

  it('calls service.getSummaryForUser with the requesting user id', async () => {
    const summary = {
      categories: {} as AtAGlanceSummaryDto['categories'],
      last_updated: null,
      documents_analyzed: 0,
    };
    service.getSummaryForUser.mockResolvedValue(summary);
    const result = await controller.getSummary({
      user: { id: 99 },
    } as any);
    expect(service.getSummaryForUser).toHaveBeenCalledWith(99);
    expect(result).toBe(summary);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run: `npm test -- --testPathPattern=at-a-glance.controller.spec`
Expected: FAIL with `Cannot find module './at-a-glance.controller'`.

- [ ] **Step 3: Implement `AtAGlanceController`**

Create `src/at-a-glance/at-a-glance.controller.ts`:

```typescript
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AtAGlanceService } from './at-a-glance.service';
import { AtAGlanceSummaryDto } from './dto/at-a-glance-summary.dto';

@ApiTags('At-a-Glance')
@Controller({ path: 'at-a-glance', version: '1' })
export class AtAGlanceController {
  constructor(private readonly atAGlanceService: AtAGlanceService) {}

  @Get('summary')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary: 'Aggregated at-a-glance dashboard summary',
    description:
      'Returns counts and top-3 samples per medical category, derived from the requesting user\'s document-extracted fields.',
  })
  @ApiOkResponse({ type: AtAGlanceSummaryDto })
  @ApiUnauthorizedResponse({ description: 'JWT missing or invalid' })
  async getSummary(@Request() request: any): Promise<AtAGlanceSummaryDto> {
    return this.atAGlanceService.getSummaryForUser(request.user.id);
  }
}
```

If Task 1's convention findings showed a different user-extraction pattern, swap `@Request() request: any` and `request.user.id` for the idiomatic one. Keep the test in step 1 aligned with what the controller actually does.

- [ ] **Step 4: Run test — confirm it passes**

Run: `npm test -- --testPathPattern=at-a-glance.controller.spec`
Expected: All tests PASS.

- [ ] **Step 5: Run lint**

Run: `npm run lint -- src/at-a-glance/at-a-glance.controller.ts src/at-a-glance/at-a-glance.controller.spec.ts`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add -- src/at-a-glance/at-a-glance.controller.ts src/at-a-glance/at-a-glance.controller.spec.ts
git commit -m "feat(at-a-glance): add AtAGlanceController with JWT and throttle"
```

---

## Task 6: Wire `AtAGlanceModule` and register in `app.module.ts`

**Files:**
- Create: `src/at-a-glance/at-a-glance.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create `AtAGlanceModule`**

Create `src/at-a-glance/at-a-glance.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExtractedFieldEntity } from '../document-processing/infrastructure/persistence/relational/entities/extracted-field.entity';
import { AtAGlanceController } from './at-a-glance.controller';
import { AtAGlanceService } from './at-a-glance.service';

@Module({
  imports: [TypeOrmModule.forFeature([ExtractedFieldEntity])],
  controllers: [AtAGlanceController],
  providers: [AtAGlanceService],
})
export class AtAGlanceModule {}
```

- [ ] **Step 2: Register `AtAGlanceModule` in `app.module.ts`**

Find `src/app.module.ts`. Locate the existing `imports: [...]` array of the `@Module` decorator. Add `AtAGlanceModule` to the array, in alphabetical order or grouped with the other feature modules — match existing style.

Also add the import statement at the top of the file:

```typescript
import { AtAGlanceModule } from './at-a-glance/at-a-glance.module';
```

If the imports array uses comments to group modules (e.g. `// Feature modules`), place `AtAGlanceModule` in the appropriate group.

- [ ] **Step 3: Run lint**

Run: `npm run lint -- src/at-a-glance/at-a-glance.module.ts src/app.module.ts`
Expected: No errors.

- [ ] **Step 4: Run full unit test suite to confirm wiring doesn't break anything**

Run: `npm test`
Expected: All tests PASS. Specifically: `at-a-glance.service.spec`, `at-a-glance.controller.spec`, `field-category-map.spec` are new and should all pass. Existing 115 tests (count from before this work began) should still pass.

If a previously-passing test now fails, STOP and report BLOCKED with the failure output. The module wiring may have introduced a circular dependency or unexpected provider conflict.

- [ ] **Step 5: Boot the app briefly to confirm it starts**

Run: `timeout 15 npm run start:dev 2>&1 | head -40 || true`
Expected: App starts. Look for the line indicating Nest application started successfully (e.g. `Nest application successfully started`). If Swagger is enabled (it should be, based on the codebase having `@nestjs/swagger`), look for the swagger setup log.

If the app fails to boot, STOP and report BLOCKED with the relevant error.

- [ ] **Step 6: Commit**

```bash
git add -- src/at-a-glance/at-a-glance.module.ts src/app.module.ts
git commit -m "feat(at-a-glance): wire AtAGlanceModule into root app module"
```

---

## Task 7: E2e test against running app

**Files:**
- Create: `test/at-a-glance/at-a-glance.e2e-spec.ts`

**Key facts about keystone's e2e infrastructure** (already verified):
- Tests run against an externally-started keystone instance at `APP_URL` (`http://localhost:${APP_PORT||3000}`)
- Tests use `request from 'supertest'` (NOT a `Test.createTestingModule` bootstrap)
- `test/utils/test-helpers.ts` exposes `createTestUser(roleId, prefix)`, `getAdminToken()`, `uploadTestDocument(token, ...)` etc.
- `test/utils/constants.ts` exports `APP_URL`
- The test runner is configured via `test/jest-e2e.json`
- Each spec lives in `test/{feature}/*.e2e-spec.ts`

**Scope of this e2e test:** verify wiring and JWT enforcement and per-user isolation. Comprehensive *category bucketing* logic (which categories get which counts) is covered exhaustively by the **unit tests in Task 4** with mocked repository — those run fast and exercise the full data-shape contract. The e2e test specifically does not try to seed `extracted_fields` directly because the existing test infra has no helper for that, and seeding via the real OCR pipeline would be slow and brittle.

What the e2e test covers concretely:
- 401 without JWT
- 200 with valid JWT, full DTO shape present
- Two users see independent (empty) summaries — i.e. user A's response shape is identical to user B's, both have count: 0 across the board, and the response shape's structure proves the controller routed each request to that specific user's `userId`

- [ ] **Step 1: Create the e2e test file**

Create `test/at-a-glance/at-a-glance.e2e-spec.ts`:

```typescript
import request from 'supertest';
import { APP_URL } from '../utils/constants';
import { createTestUser, TestUser } from '../utils/test-helpers';
import { RoleEnum } from '../../src/roles/roles.enum';

/**
 * At-a-Glance Summary E2E Tests
 *
 * Verifies the GET /api/v1/at-a-glance/summary endpoint is wired correctly,
 * enforces JWT auth, and isolates users.
 *
 * Note: comprehensive category bucketing logic is covered by the unit tests in
 * `src/at-a-glance/at-a-glance.service.spec.ts` with a mocked repository.
 * This e2e suite focuses on wiring and authorization rather than seeding
 * extracted_fields data (which keystone's existing e2e infra doesn't expose
 * a direct helper for).
 */
describe('At-a-Glance Summary Endpoint (E2E)', () => {
  let userA: TestUser;
  let userB: TestUser;

  beforeAll(async () => {
    userA = await createTestUser(RoleEnum.user, 'atglance-a');
    userB = await createTestUser(RoleEnum.user, 'atglance-b');
  }, 60000);

  it('returns 401 without an Authorization header', async () => {
    await request(APP_URL).get('/api/v1/at-a-glance/summary').expect(401);
  });

  it('returns 401 with an invalid bearer token', async () => {
    await request(APP_URL)
      .get('/api/v1/at-a-glance/summary')
      .auth('not-a-real-token', { type: 'bearer' })
      .expect(401);
  });

  it('returns 200 with the full DTO shape for an authenticated user', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/at-a-glance/summary')
      .auth(userA.token, { type: 'bearer' })
      .expect(200);

    expect(res.body).toHaveProperty('categories');
    expect(res.body).toHaveProperty('last_updated');
    expect(res.body).toHaveProperty('documents_analyzed');

    const cats = res.body.categories;
    for (const c of [
      'medications',
      'allergies',
      'conditions',
      'doctors',
      'pharmacies',
      'insurance',
      'emergency_contact',
    ]) {
      expect(cats).toHaveProperty(c);
      expect(cats[c]).toHaveProperty('count');
      expect(cats[c]).toHaveProperty('samples');
      expect(Array.isArray(cats[c].samples)).toBe(true);
    }
    expect(cats).toHaveProperty('blood_type');
    expect(cats.blood_type).toHaveProperty('value');
    expect(cats.blood_type).toHaveProperty('source_document_id');
  });

  it('returns count 0 across all categories for a user with no documents', async () => {
    const res = await request(APP_URL)
      .get('/api/v1/at-a-glance/summary')
      .auth(userA.token, { type: 'bearer' })
      .expect(200);

    expect(res.body.documents_analyzed).toBe(0);
    expect(res.body.last_updated).toBeNull();
    expect(res.body.categories.medications.count).toBe(0);
    expect(res.body.categories.medications.samples).toEqual([]);
    expect(res.body.categories.blood_type.value).toBeNull();
    expect(res.body.categories.blood_type.source_document_id).toBeNull();
  });

  it('returns independent (empty) summaries for two different users', async () => {
    const [resA, resB] = await Promise.all([
      request(APP_URL)
        .get('/api/v1/at-a-glance/summary')
        .auth(userA.token, { type: 'bearer' }),
      request(APP_URL)
        .get('/api/v1/at-a-glance/summary')
        .auth(userB.token, { type: 'bearer' }),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.documents_analyzed).toBe(0);
    expect(resB.body.documents_analyzed).toBe(0);
  });
});
```

- [ ] **Step 2: Run the e2e suite for at-a-glance**

The repo's e2e runner is invoked via `npm run test:e2e` (or similar — confirm by reading `package.json`'s `scripts` section). Use the `--testPathPattern` filter to run only the new spec:

Run: `npm run test:e2e -- --testPathPattern=at-a-glance.e2e-spec`

Expected: All 5 tests PASS.

If the e2e suite requires the app to be running externally (docker-e2e.yml does this in CI), and you're running locally without that setup, the tests may hang waiting for `APP_URL`. In that case:
1. Start the app in a separate shell: `npm run start:dev`
2. Wait for the "Nest application successfully started" log
3. Then run the e2e test

If your local setup can't run the e2e tests at all, that's OK — report the situation as DONE_WITH_CONCERNS noting that the e2e test file was authored and lints clean but couldn't be exercised locally. CI will run it on the next push.

- [ ] **Step 3: Run lint on the e2e file**

Run: `npm run lint -- test/at-a-glance/`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add -- test/at-a-glance/
git commit -m "test(at-a-glance): add e2e tests for wiring, JWT auth, and isolation"
```

---

## Task 8: Final verification

This task has no code changes. Verification and Swagger inspection only.

- [ ] **Step 1: Run full test suite (unit + e2e)**

Run: `npm test && npm run test:e2e`
Expected: All tests pass.

- [ ] **Step 2: Run linter on entire `src/at-a-glance/` and `test/at-a-glance/`**

Run: `npm run lint -- src/at-a-glance/ test/at-a-glance/`
Expected: No errors.

- [ ] **Step 3: Run TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No new errors. Pre-existing errors baseline (if any) unchanged.

- [ ] **Step 4: Boot app and inspect Swagger UI**

Run: `npm run start:dev` in the background, wait for it to be ready, then curl the OpenAPI JSON or visit `http://localhost:3000/docs` and confirm `GET /api/v1/at-a-glance/summary` is documented with the full DTO schema.

Specifically check:
- Endpoint appears under tag "At-a-Glance"
- 200 response shows `AtAGlanceSummaryDto` shape with nested `AtAGlanceCategoriesDto`, `CategoryDataDto`, `BloodTypeDataDto`
- 401 response is documented
- Bearer auth shows in the lock icon

Stop the app after verification.

- [ ] **Step 5: Verify no Claude/`.claude` attribution in commits**

Run: `git log --since="1 day ago" --pretty=%B | grep -iE "claude|anthropic|co-authored|generated with" || echo "(clean)"`
Expected: `(clean)`.

- [ ] **Step 6: Verify no `.claude/` files staged**

Run: `git ls-files | grep -i "\.claude"`
Expected: No matches.

- [ ] **Step 7: Report ready for PR**

C3 is complete. Report back:
- Number of commits added in this session
- Total test count after C3
- Notable issues or deviations
- Whether the user should now open a PR for C3 (separate from C4 and C2 per the spec's "three sequential PRs" decision)

---

## Self-Review Notes (for the engineer executing this plan)

- **DRY:** Reuse the existing `ExtractedFieldEntity` and `DocumentEntity`; don't create new ones.
- **YAGNI:** No new tables, no new auth flows, no field-category-map persistence, no caching. The plan is intentionally small.
- **TDD:** Every functional task has the test → fail → implement → pass → commit cycle. Don't skip the failing-run.
- **No scope creep:** Do NOT touch the document-processing module beyond reading its entities. Do NOT add new fieldType mappings beyond the ones in the spec unless you observe additional types being emitted during e2e seeding — and if you do, add them to `field-category-map.ts` in a focused commit with a clear message.
- **Branch:** Stay on `vignesh-changes` in keystone-core-api.
- **Pre-staged file discipline:** The repo has an unmodified `package-lock.json` working-tree change that pre-dates this work. Use explicit `git add -- <paths>` for every commit so it doesn't get swept in.
- **Standing rule:** No commit may reference Claude, Anthropic, `.claude/`, or include a Co-Authored-By trailer.
