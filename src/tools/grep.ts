import fs from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "../types.js";
import { resolveInWorkspace, toolError, toolJson } from "./workspace.js";

/** 给 LLM 看的 schema：按子串搜索（定位用，不是读全文） */
export const grepToolDef: ToolDefinition = {
  type: "function",
  function: {
    name: "grep",
    description:
      "在工作区内按子字符串搜索，返回匹配行（路径/行号/内容）。" +
      "适用：定位「哪里出现了某词/函数名/配置键」，或尚不知道该读哪个文件。" +
      "不适用：已有确切路径且需要全文——请用 read_file。" +
      "比连续盲读多个文件更省 token。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "要搜索的子字符串（区分大小写）",
        },
        path: {
          type: "string",
          description: "限定搜索的相对目录或文件；省略则搜整个工作区",
        },
        max_matches: {
          type: "number",
          description: "最多返回多少条匹配，默认 30",
        },
      },
      required: ["query"],
    },
  },
};

/** 递归时跳过的目录，避免扫依赖和构建产物 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
]);

type Match = { path: string; line: number; text: string };

/**
 * 自实现子串搜索（不用系统 grep）。
 * path 可为目录或单文件；命中后模型通常再调 read_file 细读。
 */
export async function grep(
  workspace: string,
  query: string,
  relPath = ".",
  maxMatches = 30,
): Promise<string> {
  const q = query.trim();
  if (!q) return toolError("query 为空");

  const resolved = resolveInWorkspace(workspace, relPath || ".");
  if (!resolved.ok) return toolError(resolved.error);

  // 夹在 [1, 100]，防止模型传 0 / 过大撑爆上下文
  const limit = Math.min(Math.max(1, maxMatches || 30), 100);
  const matches: Match[] = [];
  const root = path.resolve(workspace);

  /** 深度优先遍历；凑够 limit 条立刻停 */
  async function walk(abs: string) {
    if (matches.length >= limit) return;
    let st;
    try {
      st = await fs.stat(abs);
    } catch {
      return;
    }

    if (st.isDirectory()) {
      const name = path.basename(abs);
      if (SKIP_DIRS.has(name)) return;
      const entries = await fs.readdir(abs);
      for (const ent of entries) {
        await walk(path.join(abs, ent));
        if (matches.length >= limit) return;
      }
      return;
    }

    if (!st.isFile()) return;
    // 跳过过大文件 / 含 NUL 的疑似二进制
    if (st.size > 1_000_000) return;

    let text: string;
    try {
      text = await fs.readFile(abs, "utf8");
    } catch {
      return;
    }
    if (text.includes("\0")) return;

    const rel = path.relative(root, abs).split(path.sep).join("/");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(q)) continue;
      // 单行也截断，避免超长行占满结果
      matches.push({ path: rel, line: i + 1, text: lines[i].slice(0, 200) });
      if (matches.length >= limit) return;
    }
  }

  await walk(resolved.abs);

  return toolJson({
    ok: true,
    query: q,
    match_count: matches.length,
    truncated: matches.length >= limit,
    matches,
  });
}
