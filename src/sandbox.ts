import path from "node:path";
import { resolveInWorkspace } from "./tools/workspace.js";

/** 需要用户点头才能执行的工具（有副作用） */
export const TOOLS_NEED_APPROVAL = new Set(["write_file", "run_terminal"]);

/** 禁止写入的相对路径（文件名或相对路径，统一小写比较） */
const BLOCKED_WRITE_NAMES = new Set([
  ".env",
  ".env.local",
  "agents.md", // 防止 Agent 改自己的规则（演示用；可按需放开）
]);

const ALLOWED_COMMAND_PREFIXES = [
  "node ",
  "npm ",
  "npx ",
  "ls",
  "dir",
  "pwd",
  "cd ",
  "type ",
  "cat ",
  "echo ",
  "where ",
  "which ",
];

export type ApprovalRequest = {
  tool: string;
  summary: string;
  args: Record<string, unknown>;
};

export type ApproveFn = (req: ApprovalRequest) => Promise<boolean>;

/** 写文件前：路径必须在工作区，且不在禁止列表 */
export function checkWriteAllowed(workspace: string, relPath: string): string | null {
  const resolved = resolveInWorkspace(workspace, relPath);
  if (!resolved.ok) return resolved.error;

  const base = path.basename(resolved.rel).toLowerCase();
  const full = resolved.rel.toLowerCase();
  if (BLOCKED_WRITE_NAMES.has(base) || BLOCKED_WRITE_NAMES.has(full)) {
    return `沙箱禁止写入: ${resolved.rel}`;
  }
  return null;
}

/** 命令白名单（从 run_terminal 抽到沙箱层，门卫集中） */
export function checkCommandAllowed(command: string): string | null {
  const c = command.trim();
  if (!c) return "command 为空";
  if (/[;&|`$]/.test(c) || c.includes("..")) {
    return `命令含不安全字符或路径逃逸: ${c}`;
  }
  const lower = c.toLowerCase();
  const ok = ALLOWED_COMMAND_PREFIXES.some(
    (p) => lower === p.trim() || lower.startsWith(p.toLowerCase()),
  );
  if (!ok) {
    return `命令未在白名单中: ${c}。允许: ${ALLOWED_COMMAND_PREFIXES.map((p) => p.trim()).join(", ")}`;
  }
  return null;
}

export function allowedCommandPrefixes(): string[] {
  return [...ALLOWED_COMMAND_PREFIXES];
}

/** 生成给人看的审批摘要 */
export function approvalSummary(tool: string, args: Record<string, unknown>): string {
  if (tool === "write_file") {
    const p = String(args.path ?? "");
    const n = String(args.content ?? "").length;
    return `写入文件 ${p}（${n} 字符）`;
  }
  if (tool === "run_terminal") {
    return `执行命令: ${String(args.command ?? "")}`;
  }
  return `${tool} ${JSON.stringify(args)}`;
}
