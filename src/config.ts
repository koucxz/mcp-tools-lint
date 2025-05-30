import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Config } from "./types.js";
import { McpToolsLintError } from "./types.js";

const schema = z.object({
  server: z.object({
    transport: z.enum(["stdio", "streamable-http"]).default("stdio"),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    cwd: z.string().default("."),
    env: z.record(z.string()).default({}),
    envFrom: z.record(z.string()).default({}),
    url: z.string().url().optional(),
    headers: z.record(z.string()).default({})
  }).strict(),
  testDir: z.string().default("mcp-tests"),
  startupTimeout: z.number().int().positive().default(5000),
  testTimeout: z.number().int().positive().default(10000)
}).strict().superRefine((value, ctx) => {
  if (value.server.transport === "stdio" && !value.server.command) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["server", "command"], message: "command is required for stdio transport" });
  if (value.server.transport === "streamable-http" && !value.server.url) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["server", "url"], message: "url is required for streamable-http transport" });
});

export async function loadConfig(inputPath = ".mcp-tools-lint.json"): Promise<Config> {
  const configPath = path.resolve(inputPath);
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    throw new McpToolsLintError(`Cannot read config: ${configPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new McpToolsLintError(`Invalid JSON config: ${configPath}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw new McpToolsLintError(`Invalid config: ${result.error.issues[0]?.message ?? "unknown error"}`);
  const base = path.dirname(configPath);
  const env: Record<string, string> = { ...result.data.server.env };
  const secrets: string[] = [];
  for (const [target, source] of Object.entries(result.data.server.envFrom)) {
    const value = process.env[source];
    if (value === undefined || value.length === 0) throw new McpToolsLintError(`Missing or empty envFrom variable: ${source}`);
    env[target] = value;
    secrets.push(value);
  }
  return {
    configPath,
    server: {
      transport: result.data.server.transport,
      command: result.data.server.command ?? "",
      args: result.data.server.args,
      cwd: path.resolve(base, result.data.server.cwd),
      env,
      envFrom: result.data.server.envFrom,
      url: result.data.server.url,
      headers: result.data.server.headers
    },
    testDir: path.resolve(base, result.data.testDir),
    startupTimeout: result.data.startupTimeout,
    testTimeout: result.data.testTimeout
  };
}