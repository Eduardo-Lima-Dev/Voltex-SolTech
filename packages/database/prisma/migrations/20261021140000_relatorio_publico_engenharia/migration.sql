CREATE TABLE "engineering_share_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engineering_share_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "engineering_share_links_token_hash_key" ON "engineering_share_links"("token_hash");

CREATE INDEX "engineering_share_links_tenant_id_snapshot_id_idx" ON "engineering_share_links"("tenant_id", "snapshot_id");

ALTER TABLE "engineering_share_links" ADD CONSTRAINT "engineering_share_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "engineering_share_links" ADD CONSTRAINT "engineering_share_links_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "engineering_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
