import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractedFieldEntity } from '../document-processing/infrastructure/persistence/relational/entities/extracted-field.entity';
import { AtAGlanceService } from './at-a-glance.service';

type Row = {
  field_key: string;
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

  it('should return an empty summary when the user has no extracted fields', async () => {
    await setup([]);
    const result = await service.getSummaryForUser(1);
    expect(result.documents_analyzed).toBe(0);
    expect(result.last_updated).toBeNull();
    expect(result.categories.medications.count).toBe(0);
    expect(result.categories.medications.samples).toEqual([]);
    expect(result.categories.blood_type.value).toBeNull();
    expect(result.categories.blood_type.source_document_id).toBeNull();
  });

  it('should group field_type into categories and count distinct values', async () => {
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

  it('should return at most 3 samples per category, most-recent first by createdAt', async () => {
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
    expect(result.categories.medications.samples[0].value).toBe('Drug5');
    expect(result.categories.medications.samples[0].document_id).toBe('doc-5');
    expect(JSON.stringify(result.categories.medications.samples)).not.toContain(
      'Drug0',
    );
  });

  it('should special-case blood_type as a singleton value', async () => {
    await setup([
      makeRow('blood_type', 'A+', 'doc-1', '2026-05-01T10:00:00Z'),
      makeRow('blood_type', 'O+', 'doc-2', '2026-05-02T10:00:00Z'), // newer wins
    ]);
    const result = await service.getSummaryForUser(1);
    expect(result.categories.blood_type.value).toBe('O+');
    expect(result.categories.blood_type.source_document_id).toBe('doc-2');
  });

  it('should drop unknown field_types into uncategorized (not surfaced in DTO)', async () => {
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

  it('should set last_updated to the most recent extracted field timestamp', async () => {
    await setup([
      makeRow('medication', 'A', 'doc-1', '2026-05-01T10:00:00Z'),
      makeRow('medication', 'B', 'doc-2', '2026-05-05T15:30:00Z'),
      makeRow('medication', 'C', 'doc-3', '2026-05-03T08:00:00Z'),
    ]);
    const result = await service.getSummaryForUser(1);
    expect(result.last_updated).toBe(
      new Date('2026-05-05T15:30:00Z').toISOString(),
    );
  });

  it('should pass userId to the repository query (isolation)', async () => {
    await setup([]);
    await service.getSummaryForUser(42);
    const qb = (repo.createQueryBuilder as jest.Mock).mock.results[0].value;
    // At least one .where or .andWhere call should include the userId binding
    const whereCalls = [...qb.where.mock.calls, ...qb.andWhere.mock.calls];
    const flat = whereCalls.map((args) => JSON.stringify(args)).join('\n');
    expect(flat).toMatch(/42|:userId/);
  });

  it('should add a deleted_at IS NULL filter to the query', async () => {
    await setup([]);
    await service.getSummaryForUser(1);
    const qb = (repo.createQueryBuilder as jest.Mock).mock.results[0].value;
    const whereCalls = [...qb.where.mock.calls, ...qb.andWhere.mock.calls];
    const flat = whereCalls.map((args) => JSON.stringify(args)).join('\n');
    expect(flat).toMatch(/deleted_at IS NULL/);
  });

  it('should exclude documents with only uncategorized fields from documents_analyzed and last_updated', async () => {
    await setup([
      // doc-1 has a known medication
      makeRow('medication', 'Lisinopril', 'doc-1', '2026-05-01T10:00:00Z'),
      // doc-2 has only uncategorized fields and should NOT pad the count
      makeRow('weird_thing', 'foo', 'doc-2', '2026-05-10T12:00:00Z'),
    ]);
    const result = await service.getSummaryForUser(1);
    expect(result.documents_analyzed).toBe(1);
    // last_updated should be the medication's timestamp, not the uncategorized one
    expect(result.last_updated).toBe(
      new Date('2026-05-01T10:00:00Z').toISOString(),
    );
  });
});

function makeRow(
  field_key: string,
  field_value: string,
  document_id: string,
  isoDate: string,
): Row {
  return {
    field_key,
    field_value,
    document_id,
    created_at: new Date(isoDate),
  };
}
