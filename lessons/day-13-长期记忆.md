# Day 13：短期 vs 长期记忆（D2.1 / D2.2 起步）

> 对应：D2.1、D2.2（文件记忆；RAG 留待 D2.3）  
> 代码：`src/memory.ts`、`src/cli.ts`、`src/loop.ts`、`src/demo_day13.ts`

---

## 本节目标

实现**跨会话**长期记忆：用户说「记住：…」写入 JSON；新开对话在 `LONG_TERM_MEMORY=1` 时读出并拼进 messages。

---

## 知识点

### 1. 三层对照（落到本仓库）

| 层 | 本仓库 |
|----|--------|
| 短期 | `messages` / Day12 `facts` |
| 中期 | `checkpoints/*.json`（要 resume） |
| 长期 | `memory/user.json`（新开会话可 load） |

### 2. 写入（用户决定内容）

```text
you> 记住：回复使用中文
```

→ `rememberFromUser` → 追加到 JSON。

### 3. 读取（新会话拼 prompt）

```text
LONG_TERM_MEMORY=1 npm start
you> 帮我看看代码
```

→ `loadMemory` → `pickForPrompt` → `[long-term memory]…` 钉在 system 后。

### 4. 还不是 RAG

无 embedding；按 tag / 子串 / 新旧打分取最近几条。大文档检索见后续 D2.3。

---

## 怎么跑

```bash
npm run demo:day13
```

```bash
# Windows CMD
set LONG_TERM_MEMORY=1
npm start
```

命令：`记住：…` / `忘记：关键词` / `mem`

---

## 验收

- [x] `memory.ts` 读写与 pick  
- [x] CLI 记住/忘记/列表  
- [x] loop 开场注入 + trim 后重钉  
- [x] `demo:day13`  
