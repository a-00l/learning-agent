# Day 12：关键事实抽取（D1.3）

> 对应：D1.3  
> 代码：`src/facts.ts`、`src/loop.ts`、`src/demo_day12.ts`、`src/checkpoint.ts`

---

## 本节目标

摘要是有损散文；把 **goal / paths / notes / todos / failures** 抽成旁路结构，裁剪后仍钉在 system 后面，兜住 `ALPHA-42` 这类关键值。

---

## 知识点

### 1. 事实卡长什么样

```text
[task facts] …
- goal: …
- paths: notes/secret.md, …
- notes: secret_token=ALPHA-42; …
- todos: …
- failures: …
```

### 2. 两种更新方式

| 方式 | 开关 | 特点 |
|------|------|------|
| 启发式扫 messages | `TASK_FACTS=1` | 正则抓 path、`key=value`、错误行；免费、可复现 |
| LLM 合并 JSON | 再加 `TASK_FACTS_LLM=1` | 更懂语义；多一次调用 |

### 3. 和裁剪的时序

```
刷新事实卡 → trimMessages → 再 upsert 事实卡 → 调主模型
```

裁剪可能删掉旧的 `[task facts]` 或早期 tool 结果；**内存里的 `facts` 对象还在**，所以要再次 `upsertFactsMessage`。

### 4. Checkpoint

`facts` 写入 checkpoint JSON，resume 时一并恢复。

---

## 怎么跑

```bash
npm run demo:day12
```

交互：

```bash
set TASK_FACTS=1
set CONTEXT_MAX_CHARS=4000
npm start
```

---

## 自测题

1. 为什么事实卡要用独立对象，而不是只靠摘要文本？  
2. 裁剪后为什么必须再 `upsert` 一次？  
3. 启发式漏抽时，`TASK_FACTS_LLM` 补的是什么？  

---

## 验收

- [x] `TaskFacts` + 启发式 / 可选 LLM  
- [x] loop 钉卡 + checkpoint 持久化  
- [x] `demo:day12` 对照  
