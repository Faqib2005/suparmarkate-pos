-- This migration is additive. Existing sales and returns remain unchanged.
CREATE TABLE "SaleExchange" (
    "id" TEXT NOT NULL,
    "exchangeNo" TEXT NOT NULL,
    "sourceSaleId" TEXT NOT NULL,
    "replacementSaleId" TEXT NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "cashPaidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "creditApplied" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleExchange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SaleExchange_exchangeNo_key" ON "SaleExchange"("exchangeNo");
CREATE UNIQUE INDEX "SaleExchange_replacementSaleId_key" ON "SaleExchange"("replacementSaleId");
CREATE UNIQUE INDEX "SaleExchange_saleReturnId_key" ON "SaleExchange"("saleReturnId");
CREATE INDEX "SaleExchange_sourceSaleId_idx" ON "SaleExchange"("sourceSaleId");
CREATE INDEX "SaleExchange_createdAt_idx" ON "SaleExchange"("createdAt");

ALTER TABLE "SaleExchange"
  ADD CONSTRAINT "SaleExchange_sourceSaleId_fkey"
  FOREIGN KEY ("sourceSaleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleExchange"
  ADD CONSTRAINT "SaleExchange_replacementSaleId_fkey"
  FOREIGN KEY ("replacementSaleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleExchange"
  ADD CONSTRAINT "SaleExchange_saleReturnId_fkey"
  FOREIGN KEY ("saleReturnId") REFERENCES "SaleReturn"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
