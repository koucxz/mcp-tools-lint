import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { TestCase, TestSuite } from "./types.js";
import { McpToolsLintError } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function rejectUnknown(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown) throw new McpToolsLintError(`Unknown field ${unknown}: ${context}`);
}

function requireNonEmptyString(value: unknown, field: string, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new McpToolsLintError(`${field} must be a non-empty string: ${context}`);
  return value;
}

function validateCase(value: unknown, file: string, index: number): TestCase {
  const context = `${file}#${index}`;
  if (!isRecord(value)) throw new McpToolsLintError(`Invalid test at ${context}`);
  const item = value;
  rejectUnknown(item, ["name", "tool", "arguments", "timeout", "expect"], context);
  const name = requireNonEmptyString(item.name, "name", context);
  const tool = requireNonEmptyString(item.tool, "tool", context);
  if (item.arguments !== undefined && !isRecord(item.arguments)) throw new McpToolsLintError(`arguments must be an object: ${context}`);
  const expect = item.expect;
  if (!isRecord(expect)) throw new McpToolsLintError(`Test requires expect: ${context}`);
  rejectUnknown(expect, ["isError", "text", "structuredContent"], `${file}#${name}`);
  if (expect.isError !== undefined && typeof expect.isError !== "boolean") throw new McpToolsLintError(`expect.isError must be boolean: ${file}#${name}`);
  const text = expect.text;
  if (text !== undefined) {
    if (!isRecord(text)) throw new McpToolsLintError(`expect.text must be an object: ${file}#${name}`);
    rejectUnknown(text, ["equals", "contains", "matches"], `${file}#${name}`);
    const keys = ["equals", "contains", "matches"].filter(key => Object.prototype.hasOwnProperty.call(text, key));
    if (keys.length !== 1 || typeof text[keys[0]] !== "string") throw new McpToolsLintError(`Test must define one valid text assertion: ${file}#${name}`);
    if (keys[0] === "matches") {
      try { new RegExp(text.matches as string); } catch { throw new McpToolsLintError(`Invalid matches regex: ${file}#${name}`); }
    }
  }
  const structuredContent = expect.structuredContent;
  if (structuredContent !== undefined && !isRecord(structuredContent)) throw new McpToolsLintError(`expect.structuredContent must be an object: ${file}#${name}`);
  if (item.timeout !== undefined && (!Number.isInteger(item.timeout) || (item.timeout as number) <= 0)) throw new McpToolsLintError(`Invalid timeout: ${file}#${name}`);
  return {
    name,
    tool,
    arguments: (item.arguments as Record<string, unknown> | undefined) ?? {},
    timeout: item.timeout as number | undefined,
    expect: { isError: expect.isError as boolean | undefined, text: text as TestCase["expect"]["text"] | undefined, structuredContent }
  };
}

export async function loadSuites(files: string[]): Promise<TestSuite[]> {
  if (files.length === 0) throw new McpToolsLintError("No YAML test files found");
  const suites: TestSuite[] = [];
  const names = new Set<string>();
  for (const file of files.sort()) {
    const absolute = path.resolve(file);
    const raw = await readFile(absolute, "utf8");
    let parsed: unknown;
    try { parsed = parse(raw, { schema: "core" }); } catch { throw new McpToolsLintError(`Invalid YAML: ${absolute}`); }
    if (!isRecord(parsed)) throw new McpToolsLintError(`Invalid suite: ${absolute}`);
    rejectUnknown(parsed, ["suite", "tests"], absolute);
    const suite = requireNonEmptyString(parsed.suite, "suite", absolute);
    if (!Array.isArray(parsed.tests)) throw new McpToolsLintError(`Suite requires suite and tests: ${absolute}`);
    const tests = parsed.tests.map((item, index) => validateCase(item, absolute, index));
    for (const test of tests) {
      if (names.has(test.name)) throw new McpToolsLintError(`Duplicate test name: ${test.name}`);
      names.add(test.name);
    }
    suites.push({ suite, tests, file: absolute });
  }
  return suites;
}