import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
} from 'typeorm';

export class AddManagerInstanceProfileFields1735000005000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add display_name column
    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'display_name',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );

    // Add phone column
    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'phone',
        type: 'varchar',
        length: '50',
        isNullable: true,
      }),
    );

    // Add operating_hours column
    await queryRunner.addColumn(
      'manager_instances',
      new TableColumn({
        name: 'operating_hours',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('manager_instances', 'operating_hours');
    await queryRunner.dropColumn('manager_instances', 'phone');
    await queryRunner.dropColumn('manager_instances', 'display_name');
  }
}






