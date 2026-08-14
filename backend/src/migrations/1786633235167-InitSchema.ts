import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1786633235167 implements MigrationInterface {
    name = 'InitSchema1786633235167'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "accounts" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "org_name" character varying NOT NULL, "api_key_hash" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e013da33171d5362732be6ac504" UNIQUE ("org_name"), CONSTRAINT "UQ_64edc7020d05b3f9f18c1f6bdf8" UNIQUE ("api_key_hash"), CONSTRAINT "PK_5a7a02c20412299d198e097a8fe" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "repos" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "account_id" uuid NOT NULL, "repo_id" character varying NOT NULL, "visibility" character varying(7) NOT NULL DEFAULT 'public', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_f2ae9a09dda4a417a946f4d4665" UNIQUE ("repo_id"), CONSTRAINT "CHK_7ca1ffbf7fa5d5091bf73e9f00" CHECK ("visibility" IN ('public', 'private')), CONSTRAINT "PK_50f4cdbc4e114515f41760400ba" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "submissions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "repo_id" uuid NOT NULL, "score" numeric(5,2) NOT NULL, "level" jsonb NOT NULL, "dimensions" jsonb NOT NULL, "framework_mapping" jsonb NOT NULL, "commit_sha" character varying(40) NOT NULL, "scanned_at" TIMESTAMP WITH TIME ZONE NOT NULL, "verified" boolean NOT NULL DEFAULT false, "signature" character varying, "key_id" character varying, "submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_10b3be95b8b2fb1e482e07d706b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fc7c60abdc39730210fe36334e" ON "submissions" ("repo_id", "scanned_at") `);
        await queryRunner.query(`CREATE TABLE "rejected_submissions" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "payload_hash" character varying NOT NULL, "reason" character varying NOT NULL, "rejected_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_03a45312f43cf323287299c9325" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "signing_keys" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "account_id" uuid NOT NULL, "public_key" character varying NOT NULL, "key_id" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "revoked_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_e02f744a41c3ffa8340aa850638" UNIQUE ("key_id"), CONSTRAINT "PK_ab7d78cf6e61dc3904133b4cd55" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "repos" ADD CONSTRAINT "FK_5dd1da384093530eb5c877f1601" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "submissions" ADD CONSTRAINT "FK_6874a6ee07fd71fc26baeb9c814" FOREIGN KEY ("repo_id") REFERENCES "repos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "signing_keys" ADD CONSTRAINT "FK_6e7769521dccaee9f9e76968fbb" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "signing_keys" DROP CONSTRAINT "FK_6e7769521dccaee9f9e76968fbb"`);
        await queryRunner.query(`ALTER TABLE "submissions" DROP CONSTRAINT "FK_6874a6ee07fd71fc26baeb9c814"`);
        await queryRunner.query(`ALTER TABLE "repos" DROP CONSTRAINT "FK_5dd1da384093530eb5c877f1601"`);
        await queryRunner.query(`DROP TABLE "signing_keys"`);
        await queryRunner.query(`DROP TABLE "rejected_submissions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fc7c60abdc39730210fe36334e"`);
        await queryRunner.query(`DROP TABLE "submissions"`);
        await queryRunner.query(`DROP TABLE "repos"`);
        await queryRunner.query(`DROP TABLE "accounts"`);
    }

}
