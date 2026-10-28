-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('SEARCH_ANSWER', 'SEARCH_EVIDENCE', 'GEO_ANALYSIS');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'SEARCHING', 'GENERATING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ModelProviderName" AS ENUM ('OPENAI_COMPATIBLE');

-- CreateEnum
CREATE TYPE "ModelCredentialStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING_VERIFICATION', 'CONNECTED', 'FAILED', 'DISABLED');

-- AlterTable
ALTER TABLE "SearchTask" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'LAB';

-- CreateTable
CREATE TABLE "ModelProviderCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "ModelProviderName" NOT NULL DEFAULT 'OPENAI_COMPATIBLE',
    "displayName" TEXT,
    "baseUrl" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "publicParams" JSONB,
    "encryptedSecret" TEXT,
    "maskedSecret" TEXT,
    "status" "ModelCredentialStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestDurationMs" INTEGER,
    "lastTestOk" BOOLEAN,
    "lastErrorMessage" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelProviderCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新对话',
    "currentMode" "ConversationMode" NOT NULL DEFAULT 'SEARCH_ANSWER',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "mode" "ConversationMode" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'COMPLETED',
    "errorCode" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationRun" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userMessageId" TEXT NOT NULL,
    "assistantMessageId" TEXT,
    "mode" "ConversationMode" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "searchTaskId" TEXT,
    "searchItemId" TEXT,
    "searchError" TEXT,
    "modelProvider" TEXT,
    "modelName" TEXT,
    "modelError" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "brandId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchSourceReference" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "searchResultId" TEXT NOT NULL,
    "citationIndex" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchSourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelProviderCredential_workspaceId_key" ON "ModelProviderCredential"("workspaceId");

-- CreateIndex
CREATE INDEX "Conversation_workspaceId_idx" ON "Conversation"("workspaceId");

-- CreateIndex
CREATE INDEX "Conversation_userId_idx" ON "Conversation"("userId");

-- CreateIndex
CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_idx" ON "ConversationMessage"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationMessage_createdAt_idx" ON "ConversationMessage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationRun_userMessageId_key" ON "ConversationRun"("userMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationRun_assistantMessageId_key" ON "ConversationRun"("assistantMessageId");

-- CreateIndex
CREATE INDEX "ConversationRun_conversationId_idx" ON "ConversationRun"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationRun_status_idx" ON "ConversationRun"("status");

-- CreateIndex
CREATE INDEX "SearchSourceReference_runId_idx" ON "SearchSourceReference"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "SearchSourceReference_runId_citationIndex_key" ON "SearchSourceReference"("runId", "citationIndex");

-- AddForeignKey
ALTER TABLE "ModelProviderCredential" ADD CONSTRAINT "ModelProviderCredential_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ConversationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRun" ADD CONSTRAINT "ConversationRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRun" ADD CONSTRAINT "ConversationRun_userMessageId_fkey" FOREIGN KEY ("userMessageId") REFERENCES "ConversationMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRun" ADD CONSTRAINT "ConversationRun_assistantMessageId_fkey" FOREIGN KEY ("assistantMessageId") REFERENCES "ConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRun" ADD CONSTRAINT "ConversationRun_searchTaskId_fkey" FOREIGN KEY ("searchTaskId") REFERENCES "SearchTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSourceReference" ADD CONSTRAINT "SearchSourceReference_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ConversationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSourceReference" ADD CONSTRAINT "SearchSourceReference_searchResultId_fkey" FOREIGN KEY ("searchResultId") REFERENCES "SearchResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

