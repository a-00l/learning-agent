import fs from "node:fs/promises";
import path from "node:path";
import { checkWriteAllowed } from "../sandbox.js";
import type { ToolDefinition } from "../types.js";
import { resolveInWorkspace, toolError, toolJson } from "./workspace.js";

/** 给 LLM 看的 schema：覆盖写入完整文件（有副作用） */
export const writeFileToolDef: ToolDefinition = {
  type: "function",
  function: {
    name: "write_file",
    description:
      "整文件覆盖写入（或新建）工作区内文本文件；有副作用，可能需用户批准。" +
      "适用：用户明确要求修改/创建，且路径已确定。" +
      "不适用：只读问答、路径不清（应 ask_user）、尚未 read 过原文就改小段。" +
      "流程：先 read_file → 在完整内容上修改 → 再 write_file。",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "相对工作区的目标文件路径",
        },
        content: {
          type: "string",
          description: "写入后的完整文件文本（不是 diff 片段）",
        },
      },
      required: ["path", "content"],
    },
  },
};

/**
 * 整文件覆盖写；父目录不存在则自动创建。
 * 不做局部 patch——改前应先 read_file，再交回完整新内容。
 */
export async function writeFile(
  workspace: string,
  relPath: string,
  content: string,
): Promise<string> {
  const blocked = checkWriteAllowed(workspace, relPath);
  if (blocked) return toolError(blocked);

  const resolved = resolveInWorkspace(workspace, relPath);
  if (!resolved.ok) return toolError(resolved.error);
  if (typeof content !== "string") return toolError("content 必须是字符串");

  try {
    await fs.mkdir(path.dirname(resolved.abs), { recursive: true });
    await fs.writeFile(resolved.abs, content, "utf8");
    return toolJson({
      ok: true,
      path: resolved.rel,
      bytes: Buffer.byteLength(content, "utf8"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(message);
  }
}
