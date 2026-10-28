-- Add fields that were introduced in the Prisma schema but missing from earlier migrations.
-- This keeps a fresh database (CI / new clone) consistent with the application schema.

ALTER TABLE "Brand"
  ADD COLUMN "lastAnalyzedAt" TIMESTAMP(3);

ALTER TABLE "ConversationMessage"
  ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "Evidence"
  ADD COLUMN "relevance" "EvidenceRelevance" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "tags" TEXT[];
