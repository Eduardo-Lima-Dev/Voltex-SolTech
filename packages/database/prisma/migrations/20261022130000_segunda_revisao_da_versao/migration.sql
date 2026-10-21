ALTER TABLE "engineering_projects" ADD COLUMN "require_second_review" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "engineering_versions" ADD COLUMN "reviewer_id" UUID;
