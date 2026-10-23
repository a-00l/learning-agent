# Day 5：H1 Trace 落盘

> 对应学习路径：H1.1（部分 H1.4）  
> 代码：`src/trace.ts`、`src/replay.ts`、`src/loop.ts`、`src/cli.ts`、`traces/`

---

## 本节目标

把一次 Agent 运行的步骤写成 **可回放的结构化文件**，翻车时能回答：调了什么、裁没裁、批没批。

本质是日志；形态是 **一条问题一条轨迹（trace / trajectory）**。

---

## 知识点

### 1. Trace 是旁路，不是决策器

```
loop 编排 → 真正调 LLM / 工具
         ↘ trace.record(...) → 结束时写 traces/*.json
```

改 trace **不应改变** Agent 行为；不传 `trace` 时 loop 仍可跑。

### 2. 记什么（最小字段）

- 元信息：`id`、`userText`、`model`、`workspace`、起止时间  
- 事件：`llm` / `tool` / `deny` / `trim` / `error`  
- tool：名字、参数摘要、**结果摘要**（截断，防 big.txt 再存一遍）  
- trim：before/after chars  
- 结尾 `result`：回复、步数、trims  

### 3. 和 `console.log` / `onStep` 的关系

| 出口 | 用途 |
|------|------|
| 终端 `[llm]`… | 盯着看（易逝） |
| `traces/*.json` | 事后回放、对比、归档难例 |

可以同源事件、两个出口。

### 4. 回放

```bash
npm run replay -- traces/20251023-….json
```

只读文件打印时间线，**不再调模型**。

---

## 架构

```
cli  创建 TraceRecorder
  → runAgentLoop({ trace })
       每步 trace.record
  → trace.finish(result) 写盘
  → 打印 trace 路径
```

新增文件：`trace.ts`（记录器）、`replay.ts`（读盘打印）。  
工具 / sandbox / context **算法不改**，只在 loop 埋点。

---

## 建议练习

1. 跑一句读文件任务，打开生成的 JSON 看 `events`  
2. 读 `big.txt`，确认 `resultSummary` 被截断、文件体积可控  
3. 故意拒绝一次 `write_file`，在 trace 里找到 `kind: "deny"`  
4. `npm run replay -- <该文件>` 对照终端记忆  

---

## 自测题

1. 为什么 tool 结果只存摘要？  
2. 若把 trace 写进工具函数内部、而不是 loop，有什么缺点？  
3. `finish` 放在 cli 而不是 loop 末尾，对「中途抛错」有什么好处？（看 cli 的 catch）  
4. Trace 和评测集（回归）下一步怎么接？  

---

## 验收标准

- [x] 每次提问生成 `traces/*.json`  
- [x] 含 trim / tool / deny / llm 事件（按实际发生）  
- [x] `npm run replay` 可打印时间线  
- [x] 不传 `trace` 时 loop 行为不变  

---

## 和下节的衔接

可选：**简单回归集**（固定提问 + 期望调用了某工具）、或 **apply_patch**、或 **checkpoint 持久化**。
