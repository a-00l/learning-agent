import type { ToolDefinition } from "../types.js";
import { grep, grepToolDef } from "./grep.js";
import { readFile, readFileToolDef } from "./read_file.js";
import { runTerminal, runTerminalToolDef } from "./run_terminal.js";
import { writeFile, writeFileToolDef } from "./write_file.js";

/** 发给 LLM 的工具清单（schema）；真正执行见 executeTool */
export const toolDefs: ToolDefinition[] = [
  readFileToolDef,
  grepToolDef,
  writeFileToolDef,
  runTerminalToolDef,
];

/**
 * 按 tool_calls[].function.name 分发到具体实现。
 * loop 只认名字 + args，不关心每个工具内部细节。
 * 返回值一律是 JSON 字符串（成功或 { ok:false, error }）。
 */
export async function executeTool(
  workspace: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "read_file":
      return readFile(workspace, String(args.path ?? ""));
    case "grep":
      return grep(
        workspace,
        String(args.query ?? ""),
        args.path != null ? String(args.path) : ".",
        typeof args.max_matches === "number" ? args.max_matches : 30,
      );
    case "write_file":
      return writeFile(workspace, String(args.path ?? ""), String(args.content ?? ""));
    case "run_terminal":
      return runTerminal(workspace, String(args.command ?? ""));
    default:
      return JSON.stringify({ ok: false, error: `未知工具: ${name}` });
  }
}
