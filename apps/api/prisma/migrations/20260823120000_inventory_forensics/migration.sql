-- Additive inventory-forensics metadata and physical verification records.
-- Existing documents, lots, movements, credentials and balances are not modified.

ALTER TABLE "InventoryOperation" ADD COLUMN "sourceChannel" TEXT;
ALTER TABLE "InventoryOperation" ADD COLUMN "sourceDeviceCode" TEXT;
ALTER TABLE "InventoryOperation" ADD COLUMN "appVersion" TEXT;
ALTER TABLE "InventoryOperation" ADD COLUMN "correlationId" TEXT;
ALTER TABLE "InventoryOperation" ADD COLUMN "requestIp" TEXT;

CREATE INDEX "InventoryOperation_sourceDeviceCode_occurredAt_idx" ON "InventoryOperation"("sourceDeviceCode", "occurredAt");
CREATE INDEX "InventoryOperation_correlationId_idx" ON "InventoryOperation"("correlationId");

CREATE TABLE "InventoryVerificationSession" (
  "id" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "note" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryVerificationSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryVerificationProduct" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "selectionReason" TEXT,
  "precisionBase" DECIMAL(18,4) NOT NULL DEFAULT 0.0001,
  "openingConfirmedQuantity" DECIMAL(18,4),
  "closingConfirmedQuantity" DECIMAL(18,4),
  "expectedClosingQuantity" DECIMAL(18,4),
  "systemQuantityAtClose" DECIMAL(18,4),
  "classification" TEXT,
  "discrepancy" DECIMAL(18,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryVerificationProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryPhysicalCountEntry" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "sessionProductId" TEXT NOT NULL,
  "checkpointKey" TEXT NOT NULL,
  "checkpointType" TEXT NOT NULL,
  "cutoffAt" TIMESTAMP(3) NOT NULL,
  "counterUserId" TEXT NOT NULL,
  "quantityBase" DECIMAL(18,4) NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryPhysicalCountEntry_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryVerificationProduct" ADD CONSTRAINT "InventoryVerificationProduct_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InventoryVerificationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryPhysicalCountEntry" ADD CONSTRAINT "InventoryPhysicalCountEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InventoryVerificationSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryPhysicalCountEntry" ADD CONSTRAINT "InventoryPhysicalCountEntry_sessionProductId_fkey" FOREIGN KEY ("sessionProductId") REFERENCES "InventoryVerificationProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "InventoryVerificationSession_warehouseId_status_idx" ON "InventoryVerificationSession"("warehouseId", "status");
CREATE INDEX "InventoryVerificationSession_startedAt_idx" ON "InventoryVerificationSession"("startedAt");
CREATE UNIQUE INDEX "InventoryVerificationProduct_sessionId_productId_key" ON "InventoryVerificationProduct"("sessionId", "productId");
CREATE INDEX "InventoryVerificationProduct_productId_idx" ON "InventoryVerificationProduct"("productId");
CREATE INDEX "InventoryVerificationProduct_classification_idx" ON "InventoryVerificationProduct"("classification");
CREATE UNIQUE INDEX "InventoryPhysicalCountEntry_sessionProductId_checkpointKey_counterUserId_key" ON "InventoryPhysicalCountEntry"("sessionProductId", "checkpointKey", "counterUserId");
CREATE INDEX "InventoryPhysicalCountEntry_sessionId_checkpointKey_idx" ON "InventoryPhysicalCountEntry"("sessionId", "checkpointKey");
CREATE INDEX "InventoryPhysicalCountEntry_counterUserId_createdAt_idx" ON "InventoryPhysicalCountEntry"("counterUserId", "createdAt");
CREATE INDEX "InventoryPhysicalCountEntry_cutoffAt_idx" ON "InventoryPhysicalCountEntry"("cutoffAt");
