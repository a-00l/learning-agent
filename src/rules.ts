import fs from "node:fs/promises";
import path from "node:path";
import {
  builtInSystemLines,
  resolvePromptProfile,
  type PromptProfile,
} from "./prompts.js";

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

export type BuildSystemOptions = {
  /** 默认读环境变量 PROMPT_PROFILE */
  profile?: PromptProfile;
};

/** 把内置说明 + 项目规则拼成最终 system */
export function buildSystemPrompt(
  workspace: string,
  projectRules: string | null,
  opts: BuildSystemOptions = {},
): string {
  const profile = opts.profile ?? resolvePromptProfile();
  const base = builtInSystemLines(workspace, profile);

  // sloppy 档：故意弱化项目规则，模拟「不读 AGENTS.md」的糟糕助手
  if (profile === "sloppy") {
    return base.join("\n");
  }

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
