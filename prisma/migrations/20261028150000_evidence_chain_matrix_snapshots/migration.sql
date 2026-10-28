-- CreateEnum
CREATE TYPE "PageType" AS ENUM ('OFFICIAL_HOMEPAGE', 'PRODUCT_PAGE', 'DOCS_PAGE', 'BLOG_NEWS', 'THIRD_PARTY_MEDIA', 'ECOMMERCE_PAGE', 'COMMUNITY_FORUM', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceRole" AS ENUM ('OFFICIAL', 'THIRD_PARTY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('ANALYSIS', 'SEARCH_EVIDENCE', 'COMPARISON');

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduleRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- DropForeignKey
ALTER TABLE "SearchResult" DROP CONSTRAINT "SearchResult_questionId_fkey";

-- DropForeignKey
ALTER TABLE "SearchTaskItem" DROP CONSTRAINT "SearchTaskItem_questionId_fkey";

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "matchConfig" JSONB,
ADD COLUMN     "officialSubdomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "productAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "products" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "brandMatchBasis" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "normalizedUrl" TEXT,
ADD COLUMN     "officialDomainMatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pageType" "PageType" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "pageTypeRule" TEXT,
ADD COLUMN     "pageTypeSource" "DetectionMethod" NOT NULL DEFAULT 'RULE',
ADD COLUMN     "rawResponseId" TEXT,
ADD COLUMN     "ruleVersion" TEXT NOT NULL DEFAULT 'evidence-v1',
ADD COLUMN     "sourceRole" "SourceRole" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "thirdPartyMention" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "QuestionSet" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "currentVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "RawSearchResponse" ADD COLUMN     "requestMeta" JSONB;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "baselineTaskId" TEXT,
ADD COLUMN     "kind" "ReportKind" NOT NULL DEFAULT 'ANALYSIS',
ADD COLUMN     "retestTaskId" TEXT,
ADD COLUMN     "searchTaskId" TEXT;

-- AlterTable
ALTER TABLE "SearchTask" ADD COLUMN     "baselineTaskId" TEXT,
ADD COLUMN     "brandSnapshot" JSONB,
ADD COLUMN     "emptyItems" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "parseErrorItems" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "questionSetId" TEXT,
ADD COLUMN     "questionSetVersion" INTEGER,
ADD COLUMN     "questionSetVersionId" TEXT,
ADD COLUMN     "scheduleId" TEXT,
ADD COLUMN     "scheduleRunId" TEXT;

-- AlterTable
ALTER TABLE "SearchTaskItem" ADD COLUMN     "categorySnapshot" TEXT,
ADD COLUMN     "parseErrorCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "QuestionSetVersion" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "questionSetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "questions" JSONB NOT NULL,
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "enabledCount" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionSetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceReview" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "reviewerId" TEXT,
    "action" TEXT NOT NULL,
    "previous" JSONB,
    "next" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisSnapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COLLECTION',
    "ruleVersion" TEXT NOT NULL,
    "questionSetVersionId" TEXT,
    "questionSetVersion" INTEGER,
    "summary" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "matrix" JSONB NOT NULL,
    "pageTypeDistribution" JSONB NOT NULL,
    "questionSnapshot" JSONB NOT NULL,
    "evidenceSnapshot" JSONB NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT,
    "name" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "contentChanged" TEXT,
    "pageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "baselineTaskId" TEXT,
    "retestTaskId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimizationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brandId" TEXT,
    "questionSetId" TEXT NOT NULL,
    "questionSetVersionId" TEXT,
    "name" TEXT NOT NULL,
    "frequency" "ScheduleFrequency" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "hour" INTEGER NOT NULL DEFAULT 9,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "weekday" INTEGER,
    "executionMode" "ExecutionMode" NOT NULL DEFAULT 'REAL',
    "params" JSONB,
    "confirmedCost" BOOLEAN NOT NULL DEFAULT false,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" "ScheduleRunStatus",
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "plannedAt" TIMESTAMP(3) NOT NULL,
    "status" "ScheduleRunStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "errorCategory" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionSetVersion_workspaceId_idx" ON "QuestionSetVersion"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSetVersion_questionSetId_version_key" ON "QuestionSetVersion"("questionSetId", "version");

-- CreateIndex
CREATE INDEX "EvidenceReview_workspaceId_createdAt_idx" ON "EvidenceReview"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceReview_evidenceId_idx" ON "EvidenceReview"("evidenceId");

-- CreateIndex
CREATE INDEX "AnalysisSnapshot_workspaceId_createdAt_idx" ON "AnalysisSnapshot"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisSnapshot_taskId_idx" ON "AnalysisSnapshot"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisSnapshot_taskId_kind_ruleVersion_key" ON "AnalysisSnapshot"("taskId", "kind", "ruleVersion");

-- CreateIndex
CREATE INDEX "OptimizationEvent_workspaceId_occurredAt_idx" ON "OptimizationEvent"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "OptimizationEvent_brandId_idx" ON "OptimizationEvent"("brandId");

-- CreateIndex
CREATE INDEX "Schedule_workspaceId_status_idx" ON "Schedule"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Schedule_nextRunAt_idx" ON "Schedule"("nextRunAt");

-- CreateIndex
CREATE INDEX "ScheduleRun_workspaceId_status_idx" ON "ScheduleRun"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "ScheduleRun_scheduleId_createdAt_idx" ON "ScheduleRun"("scheduleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRun_scheduleId_plannedAt_key" ON "ScheduleRun"("scheduleId", "plannedAt");

-- CreateIndex
CREATE INDEX "Evidence_taskId_questionId_idx" ON "Evidence"("taskId", "questionId");

-- CreateIndex
CREATE INDEX "Evidence_normalizedUrl_idx" ON "Evidence"("normalizedUrl");

-- CreateIndex
CREATE INDEX "Evidence_pageType_idx" ON "Evidence"("pageType");

-- CreateIndex
CREATE INDEX "QuestionSet_workspaceId_archivedAt_idx" ON "QuestionSet"("workspaceId", "archivedAt");

-- CreateIndex
CREATE INDEX "Report_kind_idx" ON "Report"("kind");

-- CreateIndex
CREATE INDEX "Report_searchTaskId_idx" ON "Report"("searchTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchTask_scheduleRunId_key" ON "SearchTask"("scheduleRunId");

-- CreateIndex
CREATE INDEX "SearchTask_questionSetId_idx" ON "SearchTask"("questionSetId");

-- CreateIndex
CREATE INDEX "SearchTask_baselineTaskId_idx" ON "SearchTask"("baselineTaskId");

-- CreateIndex
CREATE INDEX "SearchTask_scheduleId_idx" ON "SearchTask"("scheduleId");

-- CreateIndex
CREATE INDEX "SearchTask_createdAt_idx" ON "SearchTask"("createdAt");

-- CreateIndex
CREATE INDEX "SearchTaskItem_taskId_status_idx" ON "SearchTaskItem"("taskId", "status");

-- AddForeignKey
ALTER TABLE "QuestionSetVersion" ADD CONSTRAINT "QuestionSetVersion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSetVersion" ADD CONSTRAINT "QuestionSetVersion_questionSetId_fkey" FOREIGN KEY ("questionSetId") REFERENCES "QuestionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchTask" ADD CONSTRAINT "SearchTask_questionSetId_fkey" FOREIGN KEY ("questionSetId") REFERENCES "QuestionSet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchTask" ADD CONSTRAINT "SearchTask_questionSetVersionId_fkey" FOREIGN KEY ("questionSetVersionId") REFERENCES "QuestionSetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchTask" ADD CONSTRAINT "SearchTask_baselineTaskId_fkey" FOREIGN KEY ("baselineTaskId") REFERENCES "SearchTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchTask" ADD CONSTRAINT "SearchTask_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchTask" ADD CONSTRAINT "SearchTask_scheduleRunId_fkey" FOREIGN KEY ("scheduleRunId") REFERENCES "ScheduleRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchTaskItem" ADD CONSTRAINT "SearchTaskItem_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchResult" ADD CONSTRAINT "SearchResult_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_rawResponseId_fkey" FOREIGN KEY ("rawResponseId") REFERENCES "RawSearchResponse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceReview" ADD CONSTRAINT "EvidenceReview_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceReview" ADD CONSTRAINT "EvidenceReview_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceReview" ADD CONSTRAINT "EvidenceReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisSnapshot" ADD CONSTRAINT "AnalysisSnapshot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisSnapshot" ADD CONSTRAINT "AnalysisSnapshot_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "SearchTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationEvent" ADD CONSTRAINT "OptimizationEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationEvent" ADD CONSTRAINT "OptimizationEvent_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_questionSetId_fkey" FOREIGN KEY ("questionSetId") REFERENCES "QuestionSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRun" ADD CONSTRAINT "ScheduleRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleRun" ADD CONSTRAINT "ScheduleRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────
-- 数据回填（非破坏性）：
-- 1) 为既有问题集创建版本 1 的不可变快照；
-- 2) 尝试为既有任务回填问题集版本引用（仅当任务的问题都来自同一问题集）；
-- 3) 回填空结果/解析异常计数。
-- 既有 Evidence 的页面类型与规范化 URL 保持 UNKNOWN/NULL，由「重新分析」或新采集生成。
-- ─────────────────────────────────────────────────────────────

INSERT INTO "QuestionSetVersion" (
  "id", "workspaceId", "questionSetId", "version", "name", "description",
  "questions", "questionCount", "enabledCount", "note", "createdAt"
)
SELECT
  'qsver_' || substr(md5(qs."id"), 1, 20),
  qs."workspaceId",
  qs."id",
  1,
  qs."name",
  qs."description",
  COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', q."id",
        'text', q."text",
        'category', q."category",
        'intent', q."intent",
        'priority', q."priority",
        'enabled', q."enabled",
        'version', 1
      )
      ORDER BY q."createdAt"
    ) FILTER (WHERE q."id" IS NOT NULL),
    '[]'::jsonb
  ),
  COUNT(q."id")::int,
  COUNT(q."id") FILTER (WHERE q."enabled")::int,
  '迁移初始化快照（基于迁移时的问题内容）',
  qs."createdAt"
FROM "QuestionSet" qs
LEFT JOIN "Question" q ON q."questionSetId" = qs."id"
GROUP BY qs."id"
ON CONFLICT ("questionSetId", "version") DO NOTHING;

WITH single_set AS (
  SELECT ti."taskId", MIN(q."questionSetId") AS "questionSetId", COUNT(DISTINCT q."questionSetId") AS "setCount"
  FROM "SearchTaskItem" ti
  JOIN "Question" q ON q."id" = ti."questionId"
  GROUP BY ti."taskId"
)
UPDATE "SearchTask" t
SET "questionSetId" = s."questionSetId",
    "questionSetVersionId" = v."id",
    "questionSetVersion" = v."version"
FROM single_set s
JOIN "QuestionSetVersion" v
  ON v."questionSetId" = s."questionSetId" AND v."version" = 1
WHERE t."id" = s."taskId"
  AND s."setCount" = 1
  AND t."questionSetId" IS NULL;

UPDATE "SearchTask" t
SET "emptyItems" = sub."emptyItems",
    "parseErrorItems" = sub."parseErrorItems"
FROM (
  SELECT "taskId",
         COUNT(*) FILTER (WHERE "status" = 'SUCCESS' AND "resultCount" = 0)::int AS "emptyItems",
         COUNT(*) FILTER (WHERE "errorCategory" = 'PARTIAL_PARSE')::int AS "parseErrorItems"
  FROM "SearchTaskItem"
  GROUP BY "taskId"
) sub
WHERE t."id" = sub."taskId";
