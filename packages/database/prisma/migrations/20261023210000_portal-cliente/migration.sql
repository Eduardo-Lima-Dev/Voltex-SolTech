-- CreateTable
CREATE TABLE "portal_accesses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_magic_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_accesses_account_id_email_key" ON "portal_accesses"("account_id", "email");

-- CreateIndex
CREATE INDEX "portal_accesses_tenant_id_account_id_idx" ON "portal_accesses"("tenant_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_magic_links_token_hash_key" ON "portal_magic_links"("token_hash");

-- CreateIndex
CREATE INDEX "portal_magic_links_tenant_id_account_id_expires_at_idx" ON "portal_magic_links"("tenant_id", "account_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_token_hash_key" ON "portal_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "portal_sessions_tenant_id_account_id_revoked_at_idx" ON "portal_sessions"("tenant_id", "account_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "portal_accesses" ADD CONSTRAINT "portal_accesses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_magic_links" ADD CONSTRAINT "portal_magic_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
