import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { runIntegrityAudit } from "./integrity-audit";

const databaseUrl = process.env.DATABASE_URL || "";

if (!/[/_]supermarket_test(?:\?|$)/.test(databaseUrl)) {
  throw new Error(
    "Integration tests require the isolated supermarket_test database."
  );
}

describe("integrity audit database integration", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("audits the isolated database without changing business data", async () => {
    const before = await prisma.$queryRaw<Array<{ transactions: bigint }>>`
      SELECT COUNT(*)::bigint AS transactions
      FROM "MoneyTransaction"
    `;
    const report = await runIntegrityAudit(prisma, { label: "integration" });
    const after = await prisma.$queryRaw<Array<{ transactions: bigint }>>`
      SELECT COUNT(*)::bigint AS transactions
      FROM "MoneyTransaction"
    `;

    expect(report.database.name).toMatch(/(?:^|_)supermarket_test$/);
    expect(report.summary.status).toBe("pass");
    expect(after[0]?.transactions).toBe(before[0]?.transactions);
  });
});
