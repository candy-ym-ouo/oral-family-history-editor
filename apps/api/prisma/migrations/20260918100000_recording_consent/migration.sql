-- CreateEnum
CREATE TYPE "RecordingConsentStatus" AS ENUM ('ACTIVE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "RecordingConsentEventType" AS ENUM ('GRANTED', 'UPDATED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "RecordingConsent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "intervieweeName" TEXT NOT NULL,
    "intervieweeContact" TEXT NOT NULL DEFAULT '',
    "grantedAt" TIMESTAMP(3) NOT NULL,
    "expiresOn" TIMESTAMP(3),
    "scopeJson" JSONB NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" "RecordingConsentStatus" NOT NULL DEFAULT 'ACTIVE',
    "withdrawnAt" TIMESTAMP(3),
    "withdrawReason" TEXT,
    "withdrawnById" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecordingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingConsentEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" "RecordingConsentEventType" NOT NULL,
    "detailJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecordingConsent_recordingId_createdAt_idx" ON "RecordingConsent"("recordingId", "createdAt");

-- CreateIndex
CREATE INDEX "RecordingConsent_workspaceId_status_idx" ON "RecordingConsent"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "RecordingConsentEvent_consentId_createdAt_idx" ON "RecordingConsentEvent"("consentId", "createdAt");

-- CreateIndex
CREATE INDEX "RecordingConsentEvent_recordingId_createdAt_idx" ON "RecordingConsentEvent"("recordingId", "createdAt");

-- CreateIndex
CREATE INDEX "RecordingConsentEvent_workspaceId_createdAt_idx" ON "RecordingConsentEvent"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "RecordingConsent" ADD CONSTRAINT "RecordingConsent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingConsent" ADD CONSTRAINT "RecordingConsent_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingConsent" ADD CONSTRAINT "RecordingConsent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingConsent" ADD CONSTRAINT "RecordingConsent_withdrawnById_fkey" FOREIGN KEY ("withdrawnById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingConsentEvent" ADD CONSTRAINT "RecordingConsentEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingConsentEvent" ADD CONSTRAINT "RecordingConsentEvent_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "RecordingConsent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingConsentEvent" ADD CONSTRAINT "RecordingConsentEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
