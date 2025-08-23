# mcp-tools-lint

一个用于测试 MCP Server Tools 的轻量命令行工具。

`mcp-tools-lint` 通过 stdio 或 Streamable HTTP 连接 MCP Server，读取它提供的 Tools，执行 YAML 中声明的调用，并检查 Tool 返回的 `isError` 和第一个文本内容。它不调用大模型，使用小型 JSON-RPC 客户端校验 initialize、`tools/list` 分页结果和 JSON-RPC 错误。

## 安装

```bash
npm install --save-dev mcp-tools-lint
npx mcp-tools-lint --help
```

## 快速开始

创建 `.mcp-tools-lint.json`：

```json
{
  "server": {
    "command": "node",
    "args": ["build/server.js"],
    "cwd": "."
  },
  "testDir": "mcp-tests",
  "startupTimeout": 5000,
  "testTimeout": 10000
}
```

创建 `mcp-tests/calculator.yaml`：

```yaml
suite: calculator
tests:
  - name: adds two numbers
    tool: add
    arguments: { a: 1, b: 2 }
    expect:
      isError: false
      text:
        equals: "3"
  - name: rejects a missing operand
    tool: add
    arguments: { a: 1 }
    expect:
      isError: true
      text:
        contains: required
```
配置文件使用 JSON，测试用例使用 YAML；`--format json` 只影响输出报告格式。

运行：

```bash
npx mcp-tools-lint test
```

## 命令

```bash
mcp-tools-lint test
mcp-tools-lint test mcp-tests/calculator.yaml
mcp-tools-lint test --config config/mcp-test.json
mcp-tools-lint list
mcp-tools-lint lint
mcp-tools-lint lint --format json
mcp-tools-lint test --format json --output reports/result.json
```

`list` 只执行握手和完整的 `tools/list` 分页，不调用 Tool。`test` 不传文件时读取 `testDir` 第一层的 `.yaml`/`.yml` 文件，传入文件时只运行指定文件。输出目录不存在时会自动创建。

`lint` 读取 Tool 列表并执行基础确定性检查：工具名格式、非空描述、`inputSchema.type`、`properties` 和 `required` 引用。发现规则问题时返回 `1`，协议或配置错误返回 `2`。

## 使用方式

这是一个命令行工具，通过终端命令或 CI 脚本运行。它没有单独的图形界面，也没有承诺稳定的 JavaScript/TypeScript 编程 API；项目的公开入口是命令行。

本地源码运行：

```bash
npm install
npm run build
node dist/cli.js test --config .mcp-tools-lint.json
```

安装到其他项目后，可以使用包提供的命令：

```bash
npx mcp-tools-lint test --config .mcp-tools-lint.json
```

Streamable HTTP 配置示例：

```json
{
  "server": {
    "transport": "streamable-http",
    "url": "http://127.0.0.1:8787/mcp",
    "headers": { "Authorization": "Bearer example" }
  },
  "testDir": "mcp-tests",
  "startupTimeout": 5000,
  "testTimeout": 10000
}
```

HTTP 模式使用 POST JSON-RPC，保存服务端返回的 `Mcp-Session-Id`，支持 JSON 和基础 SSE 响应；命令结束时会尝试发送 DELETE 关闭会话。

## 配置

`server.command` 和 `server.args` 直接传给子进程，不经过 shell。`server.cwd` 与 `testDir` 相对于配置文件目录解析。

```json
{
  "server": {
    "command": "python",
    "args": ["-m", "weather_server"],
    "env": { "LOG_LEVEL": "error" },
    "envFrom": { "WEATHER_API_KEY": "MCP_TEST_WEATHER_API_KEY" }
  },
  "testDir": "mcp-tests",
  "startupTimeout": 5000,
  "testTimeout": 10000
}
```

`envFrom` 的 key 是传给 Server 的变量名，value 是父进程环境变量名。来源变量不存在或为空字符串时，命令在启动前退出 `2`；非空值会从工具自己的输出和 JSON 报告中脱敏。

## 测试和断言

每个 YAML 文件包含 `suite` 和 `tests`。文件按名称排序，测试按声明顺序串行执行，一次命令只启动一个 Server 进程。`suite`、测试 `name`/`tool` 不能为空；未知字段会被拒绝；`arguments` 必须是对象；`expect.isError` 必须是布尔值；测试目录至少要有一个 YAML 文件。

```yaml
suite: notes
tests:
  - name: creates a note
    tool: create_note
    arguments:
      title: Draft
    timeout: 3000
    expect:
      isError: false
      text:
        matches: "created|updated"
```

支持三种文本断言：`equals`、`contains`、`matches`，每个测试最多选择一种。断言读取第一个 `text` content；没有文本时失败。`isError` 省略时按 `false` 处理。非法 `matches` 正则在启动 Server 前被判定为测试文件错误并退出 `2`。

Tool 返回 `isError: true` 可以是预期结果，不等同于 JSON-RPC 或传输错误。

## 退出码

| 代码 | 含义 |
| --- | --- |
| `0` | 所有测试通过。 |
| `1` | Tool 不存在、测试调用超时、结果错误或文本断言失败。 |
| `2` | 配置、Server 启动、MCP 通信、测试文件或报告写入失败。 |

`startupTimeout` 限制从创建 Server 进程到完整 `tools/list` 分页结束的启动窗口；MCP JSON-RPC error、协议版本不兼容、无效响应或 Server 在调用期间退出都属于通信错误并返回 `2`。

## CI

```yaml
- run: npm ci
- run: npm run check
- run: npx mcp-tools-lint test --format json --output reports/mcp-tools.json
```

## 支持范围

| 项目 | 支持内容 |
| --- | --- |
| 协议 | MCP initialize、tools/list、tools/call |
| Transport | stdio、Streamable HTTP |
| 报告 | pretty、JSON |

支持基础 lint、structuredContent 断言和 Streamable HTTP；不包含快照、SARIF、JUnit、LLM 评测或并发压测。

## 开发

```bash
npm install
npm run check
```