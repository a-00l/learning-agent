# Day 7：Checkpoint 断点续跑 + SSE 流式

> 对应：G3.1–G3.2、A4（流式）、部分 G2  
> 代码：`checkpoint.ts`、`llm.ts`（`chatStream`）、`loop.ts`、`server.ts`、`cli.ts`

---

## 本节目标

1. **Checkpoint**：每轮工具后把 `messages` 存盘；下次 `resume` 加载回 messages 继续（不是贴进一句 user prompt）。  
2. **SSE**：HTTP 服务用 `text/event-stream` 把 step / token / done 推给浏览器。

---

## Checkpoint 知识点

- 存的是 **可恢复状态**（messages + steps + status），不是 Trace 流水账。  
- 写盘时机：每轮 tools 跑完；任务结束标 `done`；异常标 `failed`。  
- 续跑：读 JSON → 塞回 `messages` → 刷新 system → 再进 while。

## SSE 知识点

- 响应头：`Content-Type: text/event-stream`  
- 帧格式：`event: xxx\ndata: {...}\n\n`  
- 本课事件：`step` / `token` / `done` / `error`  
- LLM 侧：`chatStream` 读上游 SSE，拼 content / tool_calls，并 `onToken` 外抛。

---

## 怎么用

```bash
# 终端（自动存 checkpoint + 流式打字）
npm start
you> cps                    # 列出存档
you> resume cp-...          # 续跑

# 浏览器 SSE
npm run server
# 打开 http://127.0.0.1:8787
```

---

## 架构

```
cli / server
    → runAgentLoop
         → chatStream (上游 SSE) → onToken
         → tools → CheckpointStore.save(messages)
         → TraceRecorder（旁路）

server 另把 onStep/onToken 写成 HTTP SSE 帧
```

---

## 自测题

1. Checkpoint 和 Trace 各解决什么问题？  
2. 为什么续跑要恢复 messages，而不是写一段「进度说明」给 user？  
3. SSE 的 `token` 事件和 `step` 事件分别给谁看？  

---

## 验收

- [x] 任务中途有 `checkpoints/*.json`  
- [x] `resume <id>` 能继续  
- [x] `npm run server` 能流式看到 token/step  
