import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { CheckpointStore } from "./checkpoint.js";
import { applyControlAction } from "./control.js";
import { runAgentLoop } from "./loop.js";
import { TraceRecorder } from "./trace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const tracesDir = path.join(root, "traces");
const checkpointsDir = path.join(root, "checkpoints");

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
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv(path.join(root, ".env"));

const workspace = path.resolve(
  process.env.WORKSPACE?.trim() || path.join(root, "playground"),
);
const model = process.env.OPENAI_MODEL || "deepseek-chat";
const cpStore = new CheckpointStore(checkpointsDir);

async function main() {
  console.log("mini-cursor · Day 8（运行中干预）");
  console.log(`工作区: ${workspace}`);
  console.log(`模型: ${model}`);
  console.log("任务进行中可输入: !pause | !resume | !cancel | !inject <文字>");
  console.log("其它: cps | resume <id> | exit\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let activeId: string | null = null;
  let ignoreControlLine = false;

  const ask = (prompt: string) =>
    new Promise<string>((resolve) => {
      ignoreControlLine = true;
      rl.question(prompt, (ans) => {
        ignoreControlLine = false;
        resolve(ans);
      });
    });

  const onLine = (line: string) => {
    if (ignoreControlLine) return;
    const t = line.trim();
    if (!t.startsWith("!")) return;
    if (!activeId) {
      console.log("  (当前无运行中任务，忽略控制命令)");
      return;
    }
    if (t === "!pause") {
      applyControlAction(activeId, "pause");
      console.log(`  [control] pause → ${activeId}`);
    } else if (t === "!resume") {
      applyControlAction(activeId, "resume");
      console.log(`  [control] resume → ${activeId}`);
    } else if (t === "!cancel") {
      applyControlAction(activeId, "cancel");
      console.log(`  [control] cancel → ${activeId}`);
    } else if (t.startsWith("!inject ")) {
      const text = t.slice("!inject ".length);
      applyControlAction(activeId, "inject", text);
      console.log(`  [control] inject → ${text.slice(0, 80)}`);
    } else {
      console.log("  用法: !pause | !resume | !cancel | !inject <文字>");
    }
  };
  rl.on("line", onLine);

  while (true) {
    const input = (await ask("you> ")).trim();
    if (!input || input === "exit" || input === "quit") break;

    if (input === "cps" || input === "checkpoints") {
      const list = await cpStore.list();
      if (!list.length) console.log("(暂无 checkpoint)\n");
      else {
        for (const c of list.slice(0, 20)) {
          console.log(
            `  ${c.id}  [${c.status}] steps=${c.steps}  ${c.userText.slice(0, 40)}`,
          );
        }
        console.log();
      }
      continue;
    }

    let resumeId: string | undefined;
    let userText = input;
    if (input.startsWith("resume ")) {
      resumeId = input.slice("resume ".length).trim();
      if (!resumeId) {
        console.log("用法: resume <checkpointId>\n");
        continue;
      }
      userText = "(resume)";
    }

    const trace = new TraceRecorder({
      workspace,
      model,
      userText: resumeId ? `[resume:${resumeId}]` : userText,
      tracesDir,
    });

    try {
      process.stdout.write("assistant> ");
      const loopPromise = runAgentLoop(workspace, userText, {
        trace,
        checkpoint: { store: cpStore, resumeId },
        onToken: (delta) => process.stdout.write(delta),
        onStep: ({ kind, detail }) => {
          console.log(`\n  [${kind}] ${detail}`);
          // 从「控制通道 id=xxx」里抠出 activeId
          if (kind === "checkpoint" && detail.includes("控制通道 id=")) {
            const m = detail.match(/控制通道 id=(\S+)/);
            if (m) activeId = m[1];
          }
        },
        onApprove: async ({ summary }) => {
          console.log();
          const ans = (await ask(`  [approve?] ${summary}  [y/N] `))
            .trim()
            .toLowerCase();
          return ans === "y" || ans === "yes";
        },
        onAskUser: async (question) => {
          console.log();
          return (await ask(`  [ask_user] ${question}\n  answer> `)).trim();
        },
      });

      const result = await loopPromise;
      activeId = null;

      console.log();
      const file = await trace.finish(result);
      console.log(
        `  (steps=${result.steps}${result.hitStepLimit ? ", hit limit" : ""}${result.cancelled ? ", cancelled" : ""}, rules=${result.rulesLoaded ? "on" : "off"}, trims=${result.trimEvents}, cp=${result.checkpointId ?? "-"})`,
      );
      console.log(`  (trace: ${file})\n`);
    } catch (err) {
      activeId = null;
      const message = err instanceof Error ? err.message : String(err);
      console.log();
      trace.record({ step: 0, kind: "error", detail: message });
      try {
        const file = await trace.finish({
          reply: `(error) ${message}`,
          steps: 0,
          hitStepLimit: false,
          rulesLoaded: false,
          trimEvents: 0,
        });
        console.error(`error> ${message}`);
        console.error(`  (trace: ${file})\n`);
      } catch {
        console.error(`error> ${message}\n`);
      }
    }
  }

  rl.off("line", onLine);
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
