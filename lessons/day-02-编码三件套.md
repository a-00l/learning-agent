# Day 2：编码三件套（grep / write_file / run_terminal）

> 对应学习路径：C0.3–C0.4、C1.4、M2  
> 代码：`src/tools/*`、`src/loop.ts`、`playground/hello.js`

---

## 本节目标

从「只会读文件的问答 Agent」变成「能搜、能改、能跑」的最小编码 Agent。

---

## 知识点

### 1. 编码 Agent 的最小工具集

| 工具 | 副作用 | 典型用途 |
|------|--------|----------|
| `read_file` | 无 | 看清再改 |
| `grep` | 无 | 先定位，再精确 read |
| `write_file` | **有**（改盘） | 落盘新内容 |
| `run_terminal` | **有**（执行） | 用 `node`/`npm` 验证 |

只读工具可以大胆重试；写/执行工具要更谨慎（白名单、审批留给 F2）。

### 2. 工具要「注册表分发」，不要在 loop 里堆 if/else

- `tools/index.ts`：`toolDefs`（给模型看的 schema）+ `executeTool`（按名字分发）
- `loop.ts` 只负责：调模型 → 拿 `tool_calls` → 调用 `executeTool` → 回灌

工具变多时，loop 稳定，扩展只加文件 + 注册一行。

### 3. 统一错误返回格式（C0.3）

所有工具约定：

```json
{ "ok": true, ... }
{ "ok": false, "error": "可读的原因" }
```

模型下一轮能根据 `error` 改路径、换命令或向用户说明——这叫 **错误回灌**，不是只 `console.error`。

### 4. 整文件覆写的代价（write_file）

本节的 `write_file` 写入的是 **完整文件内容**，不是 patch。

因此正确用法是：

1. `grep` / `read_file` 拿到原文  
2. 在上下文里改好  
3. `write_file` 整份写回  

风险：上下文丢了半截 → 写回去会丢代码。  
后续课用 `apply_patch` 做精细修改。

### 5. 命令白名单 = 沙箱雏形（F2 预告）

`run_terminal` 用代码限制：

- 只允许 `node` / `npm` / `ls` / `dir` 等前缀  
- 拒绝 `;` `|` `` ` `` `$`、`..` 等链式/逃逸  

**安全靠门卫代码，不靠 system prompt 写「请不要删文件」。**

### 6. 步数上限要随任务变

Day1 读一个文件，`MAX_STEPS=3` 够用。  
Day2「搜→读→写→跑」经常 4～6 步，提到 `8`。  
上限太小会表现为：文件改了但没跑到验证，或中途被截断。

### 7. 路径解析抽公共模块

`workspace.ts` 的 `resolveInWorkspace`：所有读写工具共用，避免每个工具复制越界检查。

---

## 关键文件怎么读

1. `tools/workspace.ts`：路径护栏 + `toolJson` / `toolError`  
2. `tools/grep.ts`：递归搜索、跳过 `node_modules`、限制匹配数  
3. `tools/write_file.ts`：`mkdir` + 整文件写入  
4. `tools/run_terminal.ts`：白名单 + 超时 + stdout/stderr 截断  
5. `tools/index.ts`：注册与分发  
6. `loop.ts`：system 提示词如何告诉模型「先读再写再跑」

---

## 建议练习

1. `package.json 里有哪些依赖？`（只读）  
2. `用 grep 找 hello`  
3. `把 hello.js 的输出改成 hello mini-cursor，然后用 node 跑一下确认`  
4. 故意让它执行不在白名单的命令，观察返回的 `error`

---

## 自测题（当日应能答出）

1. 为什么改小段代码也要先 `read_file`？整文件覆写有什么风险？  
2. 试跑 `rm -rf /`（或任意未允许命令），门卫在哪个文件、凭什么拒绝？  
3. 把 `MAX_STEPS` 改回 3，再跑「改文件并验证」，通常卡在哪一步？  
4. 新增第五个工具时，应改哪些文件、loop 要不要大改？

---

## 验收标准

- [x] 四个工具均可被模型调用并回灌结果  
- [x] 能完成「改 playground/hello.js + node 验证」类任务  
- [x] 危险/未允许命令被拒绝且错误对模型可见  
- [x] loop 通过注册表分发，而不是写死四个 if

---

## 和下节的衔接

下一节：**F1 项目规则（AGENTS.md）+ F2 写操作审批 / 更严沙箱**。  
今天的白名单和路径护栏，就是 F2 的半成品。
