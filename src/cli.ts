#!/usr/bin/env node
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { loadSuites } from "./load-tests.js";
import { redact } from "./redact.js";
import { assertResult } from "./assertions.js";
import { makeReport, prettyReport } from "./reporter.js";
import { McpToolsLintError, type CaseResult, type Config, type ToolSession } from "./types.js";
import { StdioSession } from "./server.js";
import { lintTools, prettyLint } from "./lint.js";
import { StreamableHttpSession } from "./http.js";

function createSession(config: Config): ToolSession {
  if (config.server.transport === "streamable-http") {
    if (!config.server.url) throw new McpToolsLintError("server.url is required for streamable-http transport");
    return new StreamableHttpSession({ url: config.server.url, headers: config.server.headers });
  }
  return new StdioSession(config.server);
}

async function suiteFiles(configDir: string, testDir: string): Promise<string[]> {
  const entries = await readdir(testDir, { withFileTypes: true });
  return entries.filter(entry => entry.isFile() && /\.ya?ml$/i.test(entry.name)).map(entry => path.resolve(configDir, testDir, entry.name)).sort();
}

async function run(configPath: string, files: string[], format: string, output?: string): Promise<number> {
  const started = Date.now();
  const config = await loadConfig(configPath);
  const selected = files.length > 0 ? files.map(file => path.resolve(path.dirname(config.configPath), file)) : await suiteFiles(path.dirname(config.configPath), config.testDir);
  const suites = await loadSuites(selected);
  const session = createSession(config);
  const tools = await session.start(config.startupTimeout);
  const toolNames = new Set(tools.map(tool => tool.name));
  const results: CaseResult[] = [];
  const secrets = Object.values(config.server.envFrom).map(source => process.env[source]).filter((value): value is string => Boolean(value));
  try {
    for (const suite of suites) {
      for (const test of suite.tests) {
        const caseStart = Date.now();
        let error: string | undefined;
        if (!toolNames.has(test.tool)) error = `tool not found: ${test.tool}`;
        else {
          try {
            const result = await session.callTool(test.tool, test.arguments ?? {}, test.timeout ?? config.testTimeout);
            error = assertResult(result, test);
          } catch (caught) {
            if (caught instanceof McpToolsLintError && caught.exitCode === 2) throw caught;
            error = caught instanceof Error ? caught.message : String(caught);
          }
        }
        results.push({ suite: suite.suite, file: suite.file, name: test.name, tool: test.tool, status: error ? "failed" : "passed", durationMs: Date.now() - caseStart, ...(error ? { error: redact(error, secrets) } : {}) });
      }
    }
  } finally { await session.close(); }
  const report = makeReport(results, Date.now() - started);
  const text = format === "json" ? JSON.stringify(report, null, 2) : prettyReport(report);
  if (output) { await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, text, "utf8"); }
  else process.stdout.write(`${text}\n`);
  return report.summary.failed > 0 ? 1 : 0;
}

async function list(configPath: string): Promise<number> {
  const config = await loadConfig(configPath);
  const session = createSession(config);
  try {
    const tools = await session.start(config.startupTimeout);
    for (const tool of tools) process.stdout.write(`${tool.name}${tool.description ? ` - ${tool.description.split("\n")[0]}` : ""}\n`);
    return 0;
  } finally { await session.close(); }
}

async function lint(configPath: string, format: string): Promise<number> {
  const config = await loadConfig(configPath);
  const session = createSession(config);
  try {
    const issues = lintTools(await session.start(config.startupTimeout));
    process.stdout.write(`${format === "json" ? JSON.stringify({ issues }, null, 2) : prettyLint(issues)}\n`);
    return issues.length > 0 ? 1 : 0;
  } finally { await session.close(); }
}

const program = new Command();
program.name("mcp-tools-lint").description("Test tools exposed by a local MCP server.").version("0.3.0");
program.command("test").argument("[files...]", "YAML test files").option("--config <path>", "config file", ".mcp-tools-lint.json").option("--format <format>", "pretty or json", "pretty").option("--output <path>", "report file").action(async (files: string[], options: { config: string; format: string; output?: string }) => {
  if (!["pretty", "json"].includes(options.format)) throw new McpToolsLintError(`Unsupported format: ${options.format}`);
  process.exitCode = await run(options.config, files, options.format, options.output);
});
program.command("list").option("--config <path>", "config file", ".mcp-tools-lint.json").action(async (options: { config: string }) => { process.exitCode = await list(options.config); });
program.command("lint").option("--config <path>", "config file", ".mcp-tools-lint.json").option("--format <format>", "pretty or json", "pretty").action(async (options: { config: string; format: string }) => {
  if (!["pretty", "json"].includes(options.format)) throw new McpToolsLintError(`Unsupported format: ${options.format}`);
  process.exitCode = await lint(options.config, options.format);
});

try { await program.parseAsync(process.argv); } catch (error) { const message = error instanceof Error ? error.message : String(error); process.stderr.write(`${message}\n`); process.exitCode = error instanceof McpToolsLintError ? error.exitCode : 2; }