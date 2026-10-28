import fs from "node:fs/promises";
import type { ToolDefinition } from "../types.js";
import { resolveInWorkspace, toolError, toolJson } from "./workspace.js";

/** 给 LLM 看的 schema：只读一个文本文件 */
export const readFileToolDef: ToolDefinition = {
  type: "function",
  function: {
    name: "read_file",
    description:
      "读取工作区内【已知路径】的单个文本文件。" +
      "适用：已知道确切相对路径（如 package.json、hello.js）。" +
      "不适用：还不知道文件在哪——应先用 grep 搜索，不要对一堆候选路径盲目 read。" +
      "path 相对工作区根目录。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "相对工作区的文件路径，例如 package.json 或 hello.js",
        },
      },
      required: ["path"],
    },
  },
};

/**
 * 实际读盘。模型不会自己读文件，只点名本工具。
 * 超长内容截断，避免一次塞爆上下文。
 */
export async function readFile(workspace: string, relPath: string): Promise<string> {
  const resolved = resolveInWorkspace(workspace, relPath);
  if (!resolved.ok) return toolError(resolved.error);

  try {
    const content = await fs.readFile(resolved.abs, "utf8");
    const max = 20_000;
    const truncated = content.length > max;
    return toolJson({
      ok: true,
      path: resolved.rel,
      truncated,
      content: truncated ? content.slice(0, max) : content,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(message);
  }
}
