-- CreateEnum
CREATE TYPE "ai_message_role" AS ENUM ('USER', 'ASSISTANT');
-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "pseudonyms" JSONB NOT NULL DEFAULT '[]',
    "facts" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "ai_message_role" NOT NULL,
    "text" TEXT NOT NULL,
    "masked_text" TEXT,
    "kind" TEXT,
    "cannot_answer_reason" TEXT,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "facts" JSONB NOT NULL DEFAULT '[]',
    "followUps" JSONB NOT NULL DEFAULT '[]',
    "removed" JSONB NOT NULL DEFAULT '{}',
    "model" TEXT,
    "neurons" DOUBLE PRECISION,
    "duration_ms" INTEGER,
    "helpful" BOOLEAN,
    "feedback_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ai_conversations_tenant_id_user_id_updated_at_idx" ON "ai_conversations"("tenant_id", "user_id", "updated_at");
-- CreateIndex
CREATE INDEX "ai_messages_tenant_id_conversation_id_created_at_idx" ON "ai_messages"("tenant_id", "conversation_id", "created_at");
-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
