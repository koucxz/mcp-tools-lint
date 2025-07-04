import readline from "node:readline";
const tools = [
  { name: "good_tool", description: "A valid tool", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"] } },
  { name: "Bad.Tool", description: "", inputSchema: { type: "string", properties: { present: { type: "string" } }, required: ["missing"] } }
];
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "lint-fixture", version: "0.1.0" } } }) + "\n");
  if (request.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools } }) + "\n");
});