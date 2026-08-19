import { MigrationInterface, QueryRunner } from "typeorm";

export class AddChecksToSubmissions1787126020558 implements MigrationInterface {
    name = 'AddChecksToSubmissions1787126020558'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "submissions" ADD "checks" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "submissions" DROP COLUMN "checks"`);
    }

}
