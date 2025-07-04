import type { ToolInfo } from "./types.js";

export interface LintIssue {
  tool: string;
  rule: string;
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function lintTools(tools: ToolInfo[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const tool of tools) {
    const name = typeof tool.name === "string" ? tool.name : "<unknown>";
    if (typeof tool.name !== "string" || !/^[a-z][a-z0-9_-]*$/.test(tool.name)) {
      issues.push({ tool: name, rule: "name-format", message: "tool name must start with a lowercase letter and contain only lowercase letters, numbers, _ or -" });
    }
    if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
      issues.push({ tool: name, rule: "description-required", message: "tool description must be a non-empty string" });
    }
    const schema = tool.inputSchema;
    if (!isRecord(schema)) {
      issues.push({ tool: name, rule: "input-schema-object", message: "inputSchema must be an object" });
      continue;
    }
    if (schema.type !== "object") issues.push({ tool: name, rule: "input-schema-type", message: "inputSchema.type must be object" });
    if (schema.properties !== undefined && !isRecord(schema.properties)) {
      issues.push({ tool: name, rule: "input-schema-properties", message: "inputSchema.properties must be an object" });
    }
    if (schema.required !== undefined) {
      if (!Array.isArray(schema.required) || schema.required.some(item => typeof item !== "string")) {
        issues.push({ tool: name, rule: "input-schema-required", message: "inputSchema.required must be an array of strings" });
      } else if (isRecord(schema.properties)) {
        const properties = schema.properties;
        for (const required of schema.required) {
          if (!Object.prototype.hasOwnProperty.call(properties, required)) {
            issues.push({ tool: name, rule: "input-schema-required-property", message: `required property ${JSON.stringify(required)} is not declared in properties` });
          }
        }
      }
    }
  }
  return issues;
}

export function prettyLint(issues: LintIssue[]): string {
  if (issues.length === 0) return "mcp-tools-lint lint\n\n0 issues";
  return ["mcp-tools-lint lint", "", ...issues.map(issue => `FAIL  ${issue.tool}  [${issue.rule}] ${issue.message}`), "", `${issues.length} issue${issues.length === 1 ? "" : "s"}`].join("\n");
}