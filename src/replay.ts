import path from "node:path";
import { fileURLToPath } from "node:url";
import { printTraceFile } from "./trace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("用法: npm run replay -- <traces/xxx.json>");
    process.exit(1);
  }
  const file = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
  // 也允许只写文件名
  const resolved = arg.includes("/") || arg.includes("\\")
    ? file
    : path.join(root, "traces", arg);
  await printTraceFile(resolved);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
