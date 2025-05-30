import type { CallToolResult, TestCase } from "./types.js";
import { isDeepStrictEqual } from "node:util";

export function assertResult(result: CallToolResult, test: TestCase): string | undefined {
  const expectedError = test.expect.isError ?? false;
  const actualError = result.isError ?? false;
  if (expectedError !== actualError) return `expected isError=${expectedError}, got ${actualError}`;
  const assertion = test.expect.text;
  if (assertion) {
    const text = result.content?.find(item => item.type === "text")?.text;
    if (text === undefined) return "result has no text content";
    if (assertion.equals !== undefined && text !== assertion.equals) return `text was ${JSON.stringify(text)}, expected ${JSON.stringify(assertion.equals)}`;
    if (assertion.contains !== undefined && !text.includes(assertion.contains)) return `text does not contain ${JSON.stringify(assertion.contains)}`;
    if (assertion.matches !== undefined && !new RegExp(assertion.matches).test(text)) return `text does not match ${JSON.stringify(assertion.matches)}`;
  }
  if (test.expect.structuredContent !== undefined && !isDeepStrictEqual(result.structuredContent, test.expect.structuredContent)) {
    return `structuredContent was ${JSON.stringify(result.structuredContent)}, expected ${JSON.stringify(test.expect.structuredContent)}`;
  }
  return undefined;
}