import { spawn } from "node:child_process";
import { checkCommandAllowed } from "../sandbox.js";
import type { ToolDefinition } from "../types.js";
import { toolError, toolJson } from "./workspace.js";

/** 给 LLM 看的 schema：在工作区跑白名单命令（有副作用） */
export const runTerminalToolDef: ToolDefinition = {
  type: "function",
  function: {
    name: "run_terminal",
    description:
      "在工作区根目录执行一条被允许的 shell 命令。仅用于查看目录、跑 node/npm 等安全操作。不要尝试删文件或访问工作区外路径。",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "完整命令行，例如: node hello.js 或 npm test",
        },
      },
      required: ["command"],
    },
  },
};

/**
 * cwd = workspace；shell 执行白名单命令（白名单在 sandbox.ts）。
 * 收集 stdout/stderr，15s 超时杀进程，输出截断防撑爆上下文。
 */
export async function runTerminal(workspace: string, command: string): Promise<string> {
  const cmd = command.trim();
  const denied = checkCommandAllowed(cmd);
  if (denied) return toolError(denied);

  return new Promise((resolve) => {
    const child = spawn(cmd, {
      cwd: workspace,
      shell: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    const max = 12_000;

    child.stdout?.on("data", (buf: Buffer) => {
      if (stdout.length < max) stdout += buf.toString("utf8");
    });
    child.stderr?.on("data", (buf: Buffer) => {
      if (stderr.length < max) stderr += buf.toString("utf8");
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(
        toolJson({
          ok: false,
          error: "命令超时（15s）",
          stdout: stdout.slice(0, max),
          stderr: stderr.slice(0, max),
        }),
      );
    }, 15_000);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(
        toolJson({
          ok: code === 0,
          exit_code: code,
          stdout: stdout.slice(0, max),
          stderr: stderr.slice(0, max),
          truncated: stdout.length >= max || stderr.length >= max,
        }),
      );
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(toolError(err.message));
    });
  });
}
