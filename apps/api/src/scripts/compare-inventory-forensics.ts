import { readFile } from "node:fs/promises";
import type { IntegrityAuditReport, IntegrityMetrics } from "../lib/integrity-audit";
import { readCliArgument } from "../lib/cli-arguments";
import { writeJsonArtifact } from "../lib/json-artifact";

async function readReport(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as IntegrityAuditReport;
}

const beforePath = readCliArgument("before");
const afterPath = readCliArgument("after");
const output = readCliArgument("output");

if (!beforePath || !afterPath) {
  throw new Error("--before and --after integrity report paths are required.");
}

const before = await readReport(beforePath);
const after = await readReport(afterPath);
if (before.database.name !== after.database.name) {
  throw new Error("Preflight and postflight reports belong to different databases.");
}

const metricKeys = Object.keys(before.metrics) as Array<keyof IntegrityMetrics>;
const findings = metricKeys.map((key) => {
  const baseline = Number(before.metrics[key]);
  const current = Number(after.metrics[key]);
  return {
    key,
    baseline,
    current,
    delta: current - baseline,
    classification: current > baseline ? "NEW_ISSUE" : current < baseline ? "REDUCED" : "HISTORICAL",
  };
});
const newIssues = findings.filter((finding) => finding.delta > 0);
const invariantChanges = {
  baseCurrencyCountChanged:
    before.metrics.activeBaseCurrencies !== after.metrics.activeBaseCurrencies,
  afnBaseCurrencyCountChanged:
    before.metrics.activeAfnBaseCurrencies !== after.metrics.activeAfnBaseCurrencies,
};
const passed =
  newIssues.length === 0 &&
  !invariantChanges.baseCurrencyCountChanged &&
  !invariantChanges.afnBaseCurrencyCountChanged;

const report = {
  formatVersion: 1,
  generatedAt: new Date().toISOString(),
  database: after.database.name,
  passed,
  historicalIssues: findings.filter((finding) => finding.baseline > 0 && finding.delta === 0),
  reducedIssues: findings.filter((finding) => finding.delta < 0),
  newIssues,
  invariantChanges,
  beforeSnapshot: before.businessSnapshot,
  afterSnapshot: after.businessSnapshot,
};

if (output) {
  console.log(`Inventory forensic comparison written to ${await writeJsonArtifact(output, report)}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}

if (!passed) process.exitCode = 2;
