ALTER TABLE "quotes" ADD COLUMN "engineering_snapshot_id" UUID;

CREATE INDEX "quotes_tenant_id_engineering_snapshot_id_idx"
  ON "quotes"("tenant_id", "engineering_snapshot_id");

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_engineering_snapshot_id_fkey"
  FOREIGN KEY ("engineering_snapshot_id") REFERENCES "engineering_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
