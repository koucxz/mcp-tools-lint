import type { CaseResult, TestReport } from "./types.js";

export function makeReport(results: CaseResult[], durationMs: number): TestReport {
  const passed = results.filter(result => result.status === "passed").length;
  return { schemaVersion: 1, command: "test", status: passed === results.length ? "passed" : "failed", cases: results, summary: { passed, failed: results.length - passed, total: results.length, durationMs } };
}

export function prettyReport(report: TestReport): string {
  const lines = ["mcp-tools-lint 0.3.0", ""];
  let suite = "";
  for (const result of report.cases) {
    if (result.suite !== suite) { suite = result.suite; lines.push(suite); }
    lines.push(`  ${result.status === "passed" ? "PASS" : "FAIL"}  ${result.name}${result.error ? ` - ${result.error}` : ""}`);
  }
  lines.push("", `${report.summary.passed} passed, ${report.summary.failed} failed`);
  return lines.join("\n");
}