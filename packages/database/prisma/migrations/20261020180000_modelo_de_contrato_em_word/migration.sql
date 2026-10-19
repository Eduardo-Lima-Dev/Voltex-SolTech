-- Modelo de contrato enviado pela empresa (.docx).
-- AlterTable
ALTER TABLE "contract_templates" ADD COLUMN     "document_id" UUID,
ADD COLUMN     "file_name" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'TEXT';

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "file_kind" TEXT NOT NULL DEFAULT 'PDF';

