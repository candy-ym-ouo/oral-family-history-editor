-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('TRANSCRIPT', 'FAMILY', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ConsentAuditAction" AS ENUM ('CREATED', 'UPDATED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Chapter" ADD COLUMN "audience" "ConsentScope" NOT NULL DEFAULT 'FAMILY';

-- CreateTable
CREATE TABLE "InterviewConsent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "intervieweeName" TEXT NOT NULL,
    "contactInfo" TEXT NOT NULL DEFAULT '',
    "scope" "ConsentScope" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "agreementText" TEXT NOT NULL DEFAULT '',
    "signature" TEXT NOT NULL DEFAULT '',
    "evidenceRef" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "ConsentStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnById" TEXT,
    "withdrawReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecording" (
    "consentId" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecording_pkey" PRIMARY KEY ("consentId","recordingId")
);

-- CreateTable
CREATE TABLE "ConsentAuditLog" (
    "id" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "action" "ConsentAuditAction" NOT NULL,
    "actorId" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InterviewConsent_workspaceId_status_idx" ON "InterviewConsent"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "InterviewConsent_workspaceId_intervieweeName_idx" ON "InterviewConsent"("workspaceId", "intervieweeName");

-- CreateIndex
CREATE INDEX "InterviewConsent_createdById_idx" ON "InterviewConsent"("createdById");

-- CreateIndex
CREATE INDEX "ConsentRecording_recordingId_idx" ON "ConsentRecording"("recordingId");

-- CreateIndex
CREATE INDEX "ConsentAuditLog_consentId_createdAt_idx" ON "ConsentAuditLog"("consentId", "createdAt");

-- CreateIndex
CREATE INDEX "ConsentAuditLog_workspaceId_createdAt_idx" ON "ConsentAuditLog"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "InterviewConsent" ADD CONSTRAINT "InterviewConsent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecording" ADD CONSTRAINT "ConsentRecording_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "InterviewConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecording" ADD CONSTRAINT "ConsentRecording_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAuditLog" ADD CONSTRAINT "ConsentAuditLog_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "InterviewConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
