import readline from "node:readline";

const tools = [
  { name: "add", description: "Add two numbers", inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
  { name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "fail", description: "Return a tool error", inputSchema: { type: "object", properties: {} } },
  { name: "sleep", description: "Wait before returning", inputSchema: { type: "object", properties: { ms: { type: "number" } } } }
];

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async line => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  if (request.method === "notifications/initialized") return;
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "0.1.0" } } }) + "\n");
    return;
  }
  if (request.method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools } }) + "\n");
    return;
  }
  if (request.method === "tools/call") {
    const { name, arguments: args = {} } = request.params;
    if (name === "add") {
      const valid = typeof args.a === "number" && typeof args.b === "number";
      const result = valid ? { content: [{ type: "text", text: String(args.a + args.b) }] } : { content: [{ type: "text", text: "required operands" }], isError: true };
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\n");
    } else if (name === "echo") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: String(args.text ?? "") }] } }) + "\n");
    } else if (name === "fail") {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "not found" }], isError: true } }) + "\n");
    } else if (name === "sleep") {
      await new Promise(resolve => setTimeout(resolve, Number(args.ms ?? 100)));
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: "awake" }] } }) + "\n");
    }
  }
});