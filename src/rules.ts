import fs from "node:fs/promises";
import path from "node:path";

/**
 * F1：加载工作区 AGENTS.md，拼进 system prompt。
 * 规则不是魔法——就是「每次请求都在场的硬约束文本」。
 */
export async function loadProjectRules(workspace: string): Promise<string | null> {
  const file = path.join(workspace, "AGENTS.md");
  try {
    const text = await fs.readFile(file, "utf8");
    const trimmed = text.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

/** 把内置说明 + 项目规则拼成最终 system（项目规则优先约束行为） */
export function buildSystemPrompt(workspace: string, projectRules: string | null): string {
  const base = [
    "你是一个编码助手（mini-cursor Day8）。",
    "可用工具：read_file、grep、write_file、run_terminal、ask_user。",
    "改代码前先 grep/read；写完可用 run_terminal 验证（如 node xxx.js）。",
    "需求不清或需用户二选一时，调用 ask_user，不要瞎猜。",
    "不要假装读过或跑过；必须通过工具拿到真实结果。",
    "write_file / run_terminal 可能需要用户批准；若被拒绝，根据错误说明调整或再 ask_user。",
    "若出现 [运行中指令] 开头的用户消息，视为中途改需求，优先遵守。",
    `工作区：${workspace}`,
    "用简洁中文回答。",
  ];

  if (!projectRules) {
    return base.join("\n");
  }

  return [
    ...base,
    "",
    "# 项目规则（AGENTS.md）——必须遵守，优先级高于用户的随意风格偏好",
    projectRules,
  ].join("\n");
}
