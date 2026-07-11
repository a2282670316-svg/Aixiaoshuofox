import assert from "node:assert/strict";
import test from "node:test";
import { register } from "node:module";

register("../scripts/cloudflare-loader.mjs", import.meta.url);

const developmentPreviewMeta = /<meta[^>]*\bname=["']codex-preview["'][^>]*>/i;

const workerUrl = new URL("../dist/server/index.js", import.meta.url);
workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
const workerPromise = import(workerUrl.href).then((module) => module.default);

const env = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const context = {
  waitUntil() {},
  passThroughOnException() {},
};

test("renders the complete novel workspace", async () => {
  const worker = await workerPromise;
  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    env,
    context,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /万象小说工坊/);
  assert.match(html, /AI 全书/);
  assert.match(html, /创作助手/);
  assert.match(html, /一致性/);
  assert.match(html, /素材库/);
});

test("rejects incomplete AI proxy requests", async () => {
  const worker = await workerPromise;
  const response = await worker.fetch(
    new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /接口地址|API Key|模型名称/);
});

test("validates AI proxy field types at runtime", async () => {
  const worker = await workerPromise;
  const response = await worker.fetch(
    new Request("http://localhost/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ baseUrl: 123, apiKey: true, model: [], prompt: {} }),
    }),
    env,
    context,
  );

  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.match(payload.error, /必须是文本/);
});

test("proxies local HTTP model endpoints without requiring an API key", async () => {
  const worker = await workerPromise;
  const originalFetch = globalThis.fetch;
  let upstreamUrl = "";
  let upstreamAuthorization = "unset";
  globalThis.fetch = async (input, init) => {
    upstreamUrl = String(input);
    upstreamAuthorization = new Headers(init?.headers).get("authorization") || "";
    return new Response(JSON.stringify({ choices: [{ message: { content: "连接成功" }, finish_reason: "stop" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: "http://127.0.0.1:11434/v1", apiKey: "", model: "qwen3", prompt: "测试" }),
      }),
      env,
      context,
    );
    assert.equal(response.status, 200);
    assert.equal(upstreamUrl, "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal(upstreamAuthorization, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("uses valid Responses API text input and parses output text", async () => {
  const worker = await workerPromise;
  const originalFetch = globalThis.fetch;
  let requestBody = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || "{}"));
    return new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "连接成功" }] }],
      usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const response = await worker.fetch(
      new Request("http://localhost/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: "http://127.0.0.1:11434/v1/responses", apiKey: "", model: "qwen3", apiMode: "auto", prompt: "测试" }),
      }),
      env,
      context,
    );
    assert.equal(response.status, 200);
    assert.equal(requestBody.input, "测试");
    assert.equal(requestBody.output_text, undefined);
    assert.equal(requestBody.temperature, undefined);
    assert.equal((await response.json()).text, "连接成功");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("blocks private and malformed AI proxy endpoints", async () => {
  const worker = await workerPromise;
  const endpoints = [
    "https://localhost./v1",
    "https://172.20.0.1/v1",
    "https://100.64.0.1/v1",
    "https://[fc00::1]/v1",
    "https://api.example.com/v1?redirect=1",
  ];

  for (const baseUrl of endpoints) {
    const response = await worker.fetch(
      new Request("https://novel.example/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl,
          apiKey: "test-key",
          model: "test-model",
          temperature: 0.8,
          prompt: "test prompt",
        }),
      }),
      env,
      context,
    );
    assert.equal(response.status, 400, baseUrl);
  }
});

test("requires an authenticated owner for hosted cloud projects", async () => {
  const worker = await workerPromise;
  const response = await worker.fetch(
    new Request("https://novel.example/api/projects"),
    env,
    context,
  );
  assert.equal(response.status, 401);
});

test("rejects cross-origin automation checkpoints", async () => {
  const worker = await workerPromise;
  const response = await worker.fetch(
    new Request("https://novel.example/api/automation/checkpoint", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({}),
    }),
    env,
    context,
  );
  assert.equal(response.status, 403);
});

test("reports background automation configuration without exposing secrets", async () => {
  const worker = await workerPromise;
  const response = await worker.fetch(
    new Request("http://localhost/api/automation/background"),
    env,
    context,
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.configuration, { apiKey: false, model: "", webhookSecret: false });
});

test("rejects unsigned webhooks when the signing secret is not configured", async () => {
  const worker = await workerPromise;
  const response = await worker.fetch(
    new Request("http://localhost/api/openai/webhook", { method: "POST", body: "{}" }),
    env,
    context,
  );
  assert.equal(response.status, 503);
});
