/**
 * Day7：HTTP + SSE
 * POST /api/run  { "prompt": "...", "resumeId"?: "...", "autoApprove"?: true }
 * 响应：text/event-stream（step / token / done / error）
 * GET  /         简易演示页
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CheckpointStore } from "./checkpoint.js";
import { runAgentLoop } from "./loop.js";
import { TraceRecorder } from "./trace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

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
const tracesDir = path.join(root, "traces");
const checkpointsDir = path.join(root, "checkpoints");
const port = Number(process.env.PORT || 8787);

type SseWrite = (event: string, data: unknown) => void;

function attachSse(res: http.ServerResponse): SseWrite {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  res.write(": ok\n\n");
  return (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

const demoHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>mini-cursor SSE</title>
  <style>
    body { font-family: ui-sans-serif, system-ui; max-width: 720px; margin: 2rem auto; padding: 0 1rem; }
    #log { white-space: pre-wrap; background: #111; color: #d7ffd7; padding: 1rem; border-radius: 8px; min-height: 200px; }
    #out { white-space: pre-wrap; border: 1px solid #ddd; padding: 1rem; border-radius: 8px; min-height: 80px; }
    input, button { font-size: 1rem; padding: 0.4rem 0.6rem; }
    input { width: 70%; }
  </style>
</head>
<body>
  <h1>mini-cursor · SSE</h1>
  <p>POST /api/run 流式推送 step / token / done</p>
  <p>
    <input id="prompt" value="读取 package.json 里有哪些依赖？" />
    <button id="go">Run</button>
    <label><input type="checkbox" id="auto" checked /> autoApprove</label>
  </p>
  <h3>tokens</h3>
  <div id="out"></div>
  <h3>events</h3>
  <div id="log"></div>
  <script>
    const log = (s) => { document.getElementById('log').textContent += s + '\\n'; };
    document.getElementById('go').onclick = async () => {
      document.getElementById('log').textContent = '';
      document.getElementById('out').textContent = '';
      const prompt = document.getElementById('prompt').value;
      const autoApprove = document.getElementById('auto').checked;
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, autoApprove }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let event = 'message';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const chunks = buf.split(/\\n\\n/);
        buf = chunks.pop() || '';
        for (const chunk of chunks) {
          const lines = chunk.split(/\\n/);
          let dataLine = '';
          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            if (line.startsWith('data:')) dataLine = line.slice(5).trim();
          }
          if (!dataLine) continue;
          let data; try { data = JSON.parse(dataLine); } catch { continue; }
          if (event === 'token') {
            document.getElementById('out').textContent += data.text || '';
          } else {
            log('[' + event + '] ' + JSON.stringify(data));
          }
        }
      }
    };
  </script>
</body>
</html>`;

async function handleRun(
  body: { prompt?: string; resumeId?: string; autoApprove?: boolean },
  send: SseWrite,
  res: http.ServerResponse,
) {
  const prompt = (body.prompt ?? "").trim();
  const resumeId = body.resumeId?.trim();
  if (!prompt && !resumeId) {
    send("error", { message: "需要 prompt 或 resumeId" });
    res.end();
    return;
  }

  const store = new CheckpointStore(checkpointsDir);
  const trace = new TraceRecorder({
    workspace,
    model,
    userText: resumeId ? `[resume:${resumeId}] ${prompt || ""}` : prompt,
    tracesDir,
  });

  try {
    const result = await runAgentLoop(workspace, prompt || "(resume)", {
      trace,
      checkpoint: { store, resumeId },
      onApprove: async () => Boolean(body.autoApprove),
      onStep: (info) => send("step", info),
      onToken: (text) => send("token", { text }),
    });
    const traceFile = await trace.finish(result);
    send("done", { ...result, traceFile });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    trace.record({ step: 0, kind: "error", detail: message });
    try {
      await trace.finish({
        reply: `(error) ${message}`,
        steps: 0,
        hitStepLimit: false,
        rulesLoaded: false,
        trimEvents: 0,
      });
    } catch {
      /* ignore */
    }
    send("error", { message });
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(demoHtml);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/checkpoints") {
    const store = new CheckpointStore(checkpointsDir);
    const list = await store.list();
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(list, null, 2));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    let body: { prompt?: string; resumeId?: string; autoApprove?: boolean } = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid json" }));
      return;
    }
    const send = attachSse(res);
    await handleRun(body, send, res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(port, () => {
  console.log(`mini-cursor SSE server http://127.0.0.1:${port}`);
  console.log(`  GET  /                 演示页`);
  console.log(`  POST /api/run          SSE 跑任务`);
  console.log(`  GET  /api/checkpoints  列出存档`);
});
