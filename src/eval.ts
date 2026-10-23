/**
 * Day6：回归评测入口（npm run eval）
 *
 * 流程：读 evals/cases.json → 每题跑一遍 Agent Loop + Trace
 *      → 从 Trace 抽出实际用过的工具 → 对照 expect 判 PASS/FAIL
 *      → 写出 evals/last-report.json，全部通过则 exit 0
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runAgentLoop } from "./loop.js";
import { TraceRecorder, type TraceEvent } from "./trace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** mini-cursor 仓库根目录（src 的上一级） */
const root = path.resolve(__dirname, "..");

/** 极简加载 .env（与 cli 相同，避免评测另装 dotenv） */
function loadDotEnv(file: string) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // 不覆盖已在 shell 里 export 的变量
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv(path.join(root, ".env"));

/** 与 cases.json 里 expect 字段对齐 */
type Expect = {
  /** 实际工具集合中至少命中一个 */
  tools_any_of?: string[];
  /** 列出的工具必须全部出现过 */
  tools_all_of?: string[];
  /** 这些工具一次都不能成功执行过 */
  tools_none_of?: string[];
  /** 最终 reply 至少包含其中一个子串（忽略大小写） */
  reply_includes_any?: string[];
};

/** 一道考题的定义 */
type CaseDef = {
  id: string;
  prompt: string;
  /** true：写文件/跑命令自动批准；缺省/false：一律拒绝（适合只读题） */
  auto_approve?: boolean;
  expect: Expect;
};

/** 单题跑完后的结构化结果（也会写进 last-report.json） */
type CaseResult = {
  id: string;
  pass: boolean;
  failures: string[];
  toolsUsed: string[];
  steps: number;
  traceFile: string;
  replyPreview: string;
};

/** 只统计「真正执行成功进 Trace 的 tool」；deny 不算使用 */
function toolsFromEvents(events: TraceEvent[]): string[] {
  const names: string[] = [];
  for (const e of events) {
    if (e.kind === "tool" && e.tool) names.push(e.tool);
  }
  return names;
}

/**
 * 对照期望做判定，返回失败原因列表（空数组 = 通过）。
 * 这里不做 LLM-as-judge，只做可重复的规则检查。
 */
function judge(
  expect: Expect,
  toolsUsed: string[],
  reply: string,
): string[] {
  const failures: string[] = [];
  const set = new Set(toolsUsed);

  if (expect.tools_any_of?.length) {
    const hit = expect.tools_any_of.some((t) => set.has(t));
    if (!hit) {
      failures.push(
        `期望至少使用其一: [${expect.tools_any_of.join(", ")}]，实际: [${toolsUsed.join(", ") || "无"}]`,
      );
    }
  }

  if (expect.tools_all_of?.length) {
    const missing = expect.tools_all_of.filter((t) => !set.has(t));
    if (missing.length) {
      failures.push(
        `期望全部使用: 缺少 [${missing.join(", ")}]，实际: [${toolsUsed.join(", ") || "无"}]`,
      );
    }
  }

  if (expect.tools_none_of?.length) {
    const bad = expect.tools_none_of.filter((t) => set.has(t));
    if (bad.length) {
      failures.push(`不应使用: [${bad.join(", ")}]`);
    }
  }

  if (expect.reply_includes_any?.length) {
    const lower = reply.toLowerCase();
    const hit = expect.reply_includes_any.some((s) =>
      lower.includes(s.toLowerCase()),
    );
    if (!hit) {
      failures.push(
        `回复应包含其一: [${expect.reply_includes_any.join(", ")}]`,
      );
    }
  }

  return failures;
}

/** 跑单题：Agent + Trace → 判定 */
async function runCase(
  c: CaseDef,
  workspace: string,
  model: string,
  tracesDir: string,
): Promise<CaseResult> {
  const trace = new TraceRecorder({
    workspace,
    model,
    userText: `[eval:${c.id}] ${c.prompt}`,
    tracesDir,
  });

  const result = await runAgentLoop(workspace, c.prompt, {
    trace,
    // 无人值守：写题自动放行；只读题拒绝一切副作用，防止评测改坏仓库
    onApprove: c.auto_approve ? async () => true : async () => false,
    onStep: () => {
      // 安静模式；细节去看生成的 trace 文件
    },
  });

  const traceFile = await trace.finish(result);

  // TraceRecorder 未暴露内存中的 events，读刚落盘的 JSON 最简单
  const saved = JSON.parse(fs.readFileSync(traceFile, "utf8")) as {
    events: TraceEvent[];
  };
  const toolsUsed = toolsFromEvents(saved.events);
  const failures = judge(c.expect, toolsUsed, result.reply);

  return {
    id: c.id,
    pass: failures.length === 0,
    failures,
    toolsUsed,
    steps: result.steps,
    traceFile,
    replyPreview:
      result.reply.length > 160
        ? result.reply.slice(0, 160) + "…"
        : result.reply,
  };
}

async function main() {
  const workspace = path.resolve(
    process.env.WORKSPACE?.trim() || path.join(root, "playground"),
  );
  const model = process.env.OPENAI_MODEL || "deepseek-chat";
  const tracesDir = path.join(root, "traces");
  const casesPath = path.join(root, "evals", "cases.json");

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.error("缺少 OPENAI_API_KEY，请配置 .env");
    process.exit(1);
  }

  const cases = JSON.parse(fs.readFileSync(casesPath, "utf8")) as CaseDef[];
  console.log(`mini-cursor eval · ${cases.length} cases`);
  console.log(`workspace: ${workspace}`);
  console.log(`model: ${model}\n`);

  const results: CaseResult[] = [];

  // 串行跑题：避免并发打爆 API 限流，也方便对照终端顺序
  for (const c of cases) {
    process.stdout.write(`▸ ${c.id} ... `);
    try {
      const r = await runCase(c, workspace, model, tracesDir);
      results.push(r);
      console.log(r.pass ? "PASS" : "FAIL");
      if (!r.pass) {
        for (const f of r.failures) console.log(`    - ${f}`);
      }
      console.log(
        `    tools=[${r.toolsUsed.join(", ") || "无"}] steps=${r.steps}`,
      );
      console.log(`    trace=${r.traceFile}`);
    } catch (err) {
      // LLM/网络异常也算该题 FAIL，不中断后面的题
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        id: c.id,
        pass: false,
        failures: [`运行异常: ${message}`],
        toolsUsed: [],
        steps: 0,
        traceFile: "",
        replyPreview: "",
      });
      console.log("FAIL");
      console.log(`    - 运行异常: ${message}`);
    }
    console.log();
  }

  const passed = results.filter((r) => r.pass).length;
  const report = {
    finishedAt: new Date().toISOString(),
    model,
    workspace,
    passed,
    total: results.length,
    results,
  };
  const reportPath = path.join(root, "evals", "last-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`合计: ${passed}/${results.length} 通过`);
  console.log(`报告: ${reportPath}`);
  // CI 友好：有失败则非 0 退出码
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
