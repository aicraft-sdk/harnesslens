import { MigrationInterface, QueryRunner } from "typeorm";

export class AddChecksToSubmissions1787124757663 implements MigrationInterface {
    name = 'AddChecksToSubmissions1787124757663'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "submissions" ADD "checks" jsonb`);
        await queryRunner.query(`ALTER TABLE "repos" DROP CONSTRAINT "FK_5dd1da384093530eb5c877f1601"`);
        await queryRunner.query(`ALTER TABLE "signing_keys" DROP CONSTRAINT "FK_6e7769521dccaee9f9e76968fbb"`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "id" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
        await queryRunner.query(`ALTER TABLE "submissions" DROP CONSTRAINT "FK_6874a6ee07fd71fc26baeb9c814"`);
        await queryRunner.query(`ALTER TABLE "repos" ALTER COLUMN "id" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "repos" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
        await queryRunner.query(`ALTER TABLE "submissions" ALTER COLUMN "id" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "submissions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
        await queryRunner.query(`ALTER TABLE "rejected_submissions" ALTER COLUMN "id" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "rejected_submissions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
        await queryRunner.query(`ALTER TABLE "signing_keys" ALTER COLUMN "id" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "signing_keys" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
        await queryRunner.query(`ALTER TABLE "repos" ADD CONSTRAINT "FK_5dd1da384093530eb5c877f1601" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "submissions" ADD CONSTRAINT "FK_6874a6ee07fd71fc26baeb9c814" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "signing_keys" ADD CONSTRAINT "FK_6e7769521dccaee9f9e76968fbb" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "signing_keys" DROP CONSTRAINT "FK_6e7769521dccaee9f9e76968fbb"`);
        await queryRunner.query(`ALTER TABLE "submissions" DROP CONSTRAINT "FK_6874a6ee07fd71fc26baeb9c814"`);
        await queryRunner.query(`ALTER TABLE "repos" DROP CONSTRAINT "FK_5dd1da384093530eb5c877f1601"`);
        await queryRunner.query(`ALTER TABLE "signing_keys" ALTER COLUMN "id" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "signing_keys" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4()`);
        await queryRunner.query(`ALTER TABLE "rejected_submissions" ALTER COLUMN "id" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "rejected_submissions" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4()`);
        await queryRunner.query(`ALTER TABLE "submissions" ALTER COLUMN "id" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "submissions" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4()`);
        await queryRunner.query(`ALTER TABLE "repos" ALTER COLUMN "id" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "repos" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4()`);
        await queryRunner.query(`ALTER TABLE "submissions" ADD CONSTRAINT "FK_6874a6ee07fd71fc26baeb9c814" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "id" DROP DEFAULT`);
        await queryRunner.query(`ALTER TABLE "accounts" ALTER COLUMN "id" SET DEFAULT uuid_generate_v4()`);
        await queryRunner.query(`ALTER TABLE "signing_keys" ADD CONSTRAINT "FK_6e7769521dccaee9f9e76968fbb" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "repos" ADD CONSTRAINT "FK_5dd1da384093530eb5c877f1601" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "submissions" DROP COLUMN "checks"`);
    }

}
