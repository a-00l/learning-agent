import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { CheckpointStore } from "./checkpoint.js";
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
  console.log("mini-cursor · Day 7（Checkpoint + 流式）");
  console.log(`工作区: ${workspace}`);
  console.log(`模型: ${model}`);
  console.log(`checkpoints: ${checkpointsDir}`);
  console.log("命令: 直接输入问题 | resume <id> | cps | exit");
  console.log("SSE 服务: npm run server  → http://127.0.0.1:8787\n");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (prompt: string) =>
    new Promise<string>((resolve) => rl.question(prompt, resolve));

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
      const result = await runAgentLoop(workspace, userText, {
        trace,
        checkpoint: { store: cpStore, resumeId },
        onToken: (delta) => process.stdout.write(delta),
        onStep: ({ kind, detail }) => {
          // 步骤日志换行打印，避免和流式 token 搅在一起
          console.log(`\n  [${kind}] ${detail}`);
        },
        onApprove: async ({ summary }) => {
          console.log();
          const ans = (await ask(`  [approve?] ${summary}  [y/N] `))
            .trim()
            .toLowerCase();
          return ans === "y" || ans === "yes";
        },
      });

      console.log();
      const file = await trace.finish(result);
      console.log(
        `  (steps=${result.steps}${result.hitStepLimit ? ", hit limit" : ""}, rules=${result.rulesLoaded ? "on" : "off"}, trims=${result.trimEvents}, cp=${result.checkpointId ?? "-"})`,
      );
      console.log(`  (trace: ${file})\n`);
    } catch (err) {
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

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
