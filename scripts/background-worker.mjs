const siteUrl = (process.env.BACKGROUND_SITE_URL || "http://localhost:5173").replace(/\/+$/, "");
const secret = process.env.BACKGROUND_WORKER_SECRET || "";
const interval = Math.max(2_000, Number(process.env.BACKGROUND_WORKER_INTERVAL_MS || 5_000));

if (!secret) {
  console.error("缺少 BACKGROUND_WORKER_SECRET，请在 .env.local 中配置。");
  process.exit(1);
}

console.log(`小说后台工作器已启动：${siteUrl}`);
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

while (!stopping) {
  try {
    const response = await fetch(`${siteUrl}/api/automation/worker`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `工作器返回 ${response.status}`);
    if (payload.checked) console.log(`[${new Date().toLocaleString("zh-CN")}] 检查 ${payload.checked} 个后台响应`);
  } catch (error) {
    console.error(`[${new Date().toLocaleString("zh-CN")}] ${error instanceof Error ? error.message : "后台轮询失败"}`);
  }
  await new Promise((resolve) => setTimeout(resolve, interval));
}

console.log("小说后台工作器已停止。");
