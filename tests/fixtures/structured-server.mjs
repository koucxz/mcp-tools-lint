import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", line => {
  const request = JSON.parse(line);
  if (request.method === "initialize") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "structured-fixture", version: "0.1.0" } } }) + "\n");
  if (request.method === "tools/list") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [{ name: "weather", description: "Return structured weather", inputSchema: { type: "object", properties: {} } }] } }) + "\n");
  if (request.method === "tools/call") process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "Weather loaded" }], structuredContent: { city: "Shanghai", temperatureC: 26, forecast: ["sunny"] } } }) + "\n");
});