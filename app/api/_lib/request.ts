import { NextResponse } from "next/server";

export function requestOwner(request: Request) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (email) return `chatgpt:${email}`;
  const hostname = new URL(request.url).hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "terminal.local"].includes(hostname)) return "local-development";
  return null;
}

export function rejectCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin && origin !== new URL(request.url).origin
    ? NextResponse.json({ error: "拒绝跨站写入请求" }, { status: 403 })
    : null;
}

export async function readJsonBody(request: Request, maxBytes = 15_000_000) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("REQUEST_TOO_LARGE");
  return JSON.parse(text) as unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
