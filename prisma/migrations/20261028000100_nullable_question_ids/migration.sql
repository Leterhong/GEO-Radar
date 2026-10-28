-- AlterTable
ALTER TABLE "Evidence" ALTER COLUMN "questionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SearchResult" ALTER COLUMN "questionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "SearchTaskItem" ALTER COLUMN "questionId" DROP NOT NULL;

