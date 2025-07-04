import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist", "cli.js");
const server = path.join(root, "tests", "fixtures", "server.mjs");

async function project() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mcp-tools-lint-"));
  await writeFile(path.join(dir, "config.json"), JSON.stringify({ server: { command: process.execPath, args: [server] }, testDir: "mcp-tests", startupTimeout: 1000, testTimeout: 500 }));
  await import("node:fs/promises").then(fs => fs.mkdir(path.join(dir, "mcp-tests")));
  return dir;
}

async function projectWithServer(serverPath, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mcp-tools-lint-"));
  await writeFile(path.join(dir, "config.json"), JSON.stringify({ server: { command: process.execPath, args: [serverPath], env: options.env ?? {} }, testDir: "mcp-tests", startupTimeout: options.startupTimeout ?? 1000, testTimeout: options.testTimeout ?? 500 }));
  await import("node:fs/promises").then(fs => fs.mkdir(path.join(dir, "mcp-tests")));
  return dir;
}

async function projectWithHttpServer(options = {}) {
  const requests = [];
  const httpServer = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    requests.push({ method: request.method, headers: request.headers, body: raw });
    if (request.method === "DELETE") { response.statusCode = 204; response.end(); return; }
    if (options.status && options.status !== 200) { response.statusCode = options.status; response.end("failure"); return; }
    const message = raw ? JSON.parse(raw) : {};
    if (message.method === "notifications/initialized") { response.statusCode = 202; response.end(); return; }
    response.setHeader("Mcp-Session-Id", "http-test-session");
    let result;
    if (message.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "http-fixture", version: "0.1.0" } };
    else if (message.method === "tools/list") result = { tools: [{ name: "weather", description: "Return structured weather", inputSchema: { type: "object", properties: {} } }] };
    else if (message.method === "tools/call") result = { content: [{ type: "text", text: "Weather loaded" }], structuredContent: { city: "Shanghai", temperatureC: 26 } };
    const payload = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
    if (options.sseList && message.method === "tools/list") {
      response.setHeader("Content-Type", "text/event-stream");
      response.end(`event: message\ndata: ${payload}\n\n`);
    } else {
      response.setHeader("Content-Type", "application/json");
      response.end(payload);
    }
  });
  await new Promise((resolve, reject) => { httpServer.once("error", reject); httpServer.listen(0, "127.0.0.1", resolve); });
  const address = httpServer.address();
  const dir = await mkdtemp(path.join(os.tmpdir(), "mcp-tools-lint-http-"));
  await writeFile(path.join(dir, "config.json"), JSON.stringify({ server: { transport: "streamable-http", url: `http://127.0.0.1:${address.port}/mcp` }, testDir: "mcp-tests", startupTimeout: 1000, testTimeout: 500 }));
  await import("node:fs/promises").then(fs => fs.mkdir(path.join(dir, "mcp-tests")));
  return { dir, httpServer, requests };
}

async function run(args, cwd) {
  try { return { ...(await exec(process.execPath, [cli, ...args], { cwd })), code: 0 }; }
  catch (error) { return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", code: error.code }; }
}

test("runs passing and expected-error tool cases", async () => {
  const dir = await project();
  try {
    await writeFile(path.join(dir, "mcp-tests", "calculator.yaml"), `suite: calculator\ntests:\n  - name: adds\n    tool: add\n    arguments: { a: 1, b: 2 }\n    expect:\n      isError: false\n      text:\n        equals: "3"\n  - name: rejects\n    tool: add\n    arguments: { a: 1 }\n    expect:\n      isError: true\n      text:\n        contains: required\n`);
    const result = await run(["test", "--config", "config.json"], dir);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /2 passed, 0 failed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("treats omitted isError as false and redacts short secrets", async () => {
  const secret = "x";
  const previous = process.env.MCP_TEST_SECRET;
  process.env.MCP_TEST_SECRET = secret;
  const dir = await project();
  try {
    await writeFile(path.join(dir, "config.json"), JSON.stringify({ server: { command: process.execPath, args: [server], envFrom: { API_TOKEN: "MCP_TEST_SECRET" } }, testDir: "mcp-tests", startupTimeout: 1000, testTimeout: 500 }));
    await writeFile(path.join(dir, "mcp-tests", "redaction.yaml"), `suite: redaction\ntests:\n  - name: omitted error flag\n    tool: echo\n    arguments: { text: hello }\n    expect:\n      text:\n        equals: hello\n  - name: secret failure\n    tool: echo\n    arguments: { text: ${secret} }\n    expect:\n      text:\n        equals: different\n`);
    const result = await run(["test", "--config", "config.json", "--format", "json"], dir);
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.stdout, /"x"/);
  } finally {
    if (previous === undefined) delete process.env.MCP_TEST_SECRET;
    else process.env.MCP_TEST_SECRET = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("list discovers tools without calling them", async () => {
  const dir = await project();
  try {
    const result = await run(["list", "--config", "config.json"], dir);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /add - Add two numbers/);
    assert.match(result.stdout, /sleep - Wait before returning/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("lint passes valid tool metadata", async () => {
  const dir = await project();
  try {
    const result = await run(["lint", "--config", "config.json"], dir);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /0 issues/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("lint reports deterministic tool metadata issues", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "lint-server.mjs"));
  try {
    const result = await run(["lint", "--config", "config.json", "--format", "json"], dir);
    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    assert.ok(report.issues.some(issue => issue.rule === "name-format"));
    assert.ok(report.issues.some(issue => issue.rule === "input-schema-required-property"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("asserts MCP 2025-06-18 structuredContent", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "structured-server.mjs"));
  try {
    await writeFile(path.join(dir, "mcp-tests", "structured.yaml"), `suite: structured\ntests:\n  - name: reads weather\n    tool: weather\n    expect:\n      text:\n        equals: Weather loaded\n      structuredContent:\n        city: Shanghai\n        temperatureC: 26\n        forecast: [sunny]\n`);
    const result = await run(["test", "--config", "config.json"], dir);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /1 passed, 0 failed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("runs list and test over Streamable HTTP with JSON and SSE responses", async () => {
  const fixture = await projectWithHttpServer({ sseList: true });
  try {
    const listResult = await run(["list", "--config", "config.json"], fixture.dir);
    assert.equal(listResult.code, 0, listResult.stderr);
    assert.match(listResult.stdout, /weather - Return structured weather/);
    await writeFile(path.join(fixture.dir, "mcp-tests", "http.yaml"), `suite: http\ntests:\n  - name: reads weather\n    tool: weather\n    expect:\n      structuredContent:\n        city: Shanghai\n        temperatureC: 26\n`);
    const testResult = await run(["test", "--config", "config.json"], fixture.dir);
    assert.equal(testResult.code, 0, testResult.stderr);
    assert.match(testResult.stdout, /1 passed, 0 failed/);
    const initialized = fixture.requests.find(item => JSON.parse(item.body).method === "initialize");
    const listed = fixture.requests.find(item => JSON.parse(item.body).method === "tools/list");
    assert.equal(initialized.headers["mcp-protocol-version"], "2025-06-18");
    assert.equal(listed.headers["mcp-session-id"], "http-test-session");
  } finally {
    await new Promise(resolve => fixture.httpServer.close(resolve));
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("returns two for a Streamable HTTP status error", async () => {
  const fixture = await projectWithHttpServer({ status: 503 });
  try {
    const result = await run(["list", "--config", "config.json"], fixture.dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /status 503/);
  } finally {
    await new Promise(resolve => fixture.httpServer.close(resolve));
    await rm(fixture.dir, { recursive: true, force: true });
  }
});

test("returns two for a repeated tools/list cursor", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "repeated-cursor-server.mjs"));
  try {
    const result = await run(["list", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /repeated cursor/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("returns two for invalid JSON-RPC output", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "invalid-json-server.mjs"));
  try {
    const result = await run(["list", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /invalid JSON-RPC/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("returns two after 100 tools/list pages", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "many-pages-server.mjs"));
  try {
    const result = await run(["list", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /exceeded 100 pages/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("returns one for assertion failure and supports json output", async () => {
  const dir = await project();
  try {
    await writeFile(path.join(dir, "mcp-tests", "bad.yaml"), `suite: bad\ntests:\n  - name: wrong\n    tool: echo\n    arguments: { text: hello }\n    expect:\n      text:\n        equals: goodbye\n`);
    const report = path.join(dir, "reports", "result.json");
    const result = await run(["test", "--config", "config.json", "--format", "json", "--output", report], dir);
    assert.equal(result.code, 1);
    const json = JSON.parse(await readFile(report, "utf8"));
    assert.equal(json.summary.failed, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rejects invalid matches before starting a server", async () => {
  const dir = await project();
  try {
    await writeFile(path.join(dir, "mcp-tests", "invalid.yaml"), `suite: invalid\ntests:\n  - name: bad regex\n    tool: echo\n    arguments: { text: hello }\n    expect:\n      text:\n        matches: "["\n`);
    const result = await run(["test", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Invalid matches regex/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("returns two for missing configuration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mcp-tools-lint-"));
  try {
    const result = await run(["list", "--config", "missing.json"], dir);
    assert.equal(result.code, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("discovers tools across tools/list pages", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "paged-server.mjs"));
  try {
    const result = await run(["list", "--config", "config.json"], dir);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /first - First tool/);
    assert.match(result.stdout, /second - Second tool/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("returns two when startup hangs during tools/list", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "hanging-server.mjs"), { startupTimeout: 100 });
  try {
    const result = await run(["list", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /timed out/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("returns two for initialize JSON-RPC errors", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "initialize-error-server.mjs"));
  try {
    const result = await run(["list", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /initialize failed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rejects unsupported initialize protocol versions", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "protocol-version-server.mjs"));
  try {
    const result = await run(["list", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Unsupported MCP protocol version/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("returns two for tools/list JSON-RPC errors", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "tools-list-error-server.mjs"));
  try {
    const result = await run(["list", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /tools unavailable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("applies startupTimeout to initialize and tools/list together", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "two-phase-hanging-server.mjs"), { startupTimeout: 150 });
  try {
    const result = await run(["list", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /timed out/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rejects non-object arguments and non-boolean isError", async () => {
  const dir = await project();
  try {
    await writeFile(path.join(dir, "mcp-tests", "invalid.yaml"), `suite: invalid\ntests:\n  - name: bad arguments\n    tool: echo\n    arguments: hello\n    expect:\n      isError: false\n  - name: bad flag\n    tool: echo\n    arguments: {}\n    expect:\n      isError: yes\n`);
    const result = await run(["test", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /arguments must be an object|expect\.isError must be boolean/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rejects unknown YAML fields and empty suite names", async () => {
  const dir = await project();
  try {
    await writeFile(path.join(dir, "mcp-tests", "invalid.yaml"), `suite: ""\ntests:\n  - name: bad\n    tool: echo\n    expect: {}\n    extra: true\n`);
    const result = await run(["test", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Unknown field|suite must be a non-empty string/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("returns two when the test directory has no YAML files", async () => {
  const dir = await project();
  try {
    const result = await run(["test", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /No YAML test files/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("returns two when the Server exits during tools/call", async () => {
  const dir = await projectWithServer(path.join(root, "tests", "fixtures", "call-exit-server.mjs"));
  try {
    await writeFile(path.join(dir, "mcp-tests", "exit.yaml"), `suite: exit\ntests:\n  - name: server exits\n    tool: explode\n    expect: {}\n`);
    const result = await run(["test", "--config", "config.json"], dir);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /MCP server exited|session is closed/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});