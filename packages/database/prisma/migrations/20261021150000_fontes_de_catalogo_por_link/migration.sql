CREATE TABLE "catalog_source_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "last_analyzed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "pages_read" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_source_links_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "catalog_source_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "doc_type" TEXT NOT NULL,
    "equipment_hint" TEXT NOT NULL,
    "product_url" TEXT,
    "page_url" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "catalog_source_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_source_links_tenant_id_url_key" ON "catalog_source_links"("tenant_id", "url");

CREATE UNIQUE INDEX "catalog_source_documents_link_id_url_key" ON "catalog_source_documents"("link_id", "url");

CREATE INDEX "catalog_source_documents_tenant_id_equipment_hint_idx" ON "catalog_source_documents"("tenant_id", "equipment_hint");

ALTER TABLE "catalog_source_links" ADD CONSTRAINT "catalog_source_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "catalog_source_documents" ADD CONSTRAINT "catalog_source_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "catalog_source_documents" ADD CONSTRAINT "catalog_source_documents_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "catalog_source_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;
