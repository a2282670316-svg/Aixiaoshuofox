function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const bytes = parts.map(Number);
  if (bytes.some((part) => part > 255)) return true;
  const [a, b] = bytes;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224;
}

export function isPrivateAIHostname(rawHostname: string) {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname) return true;
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan")) return true;
  if (isPrivateIpv4(hostname)) return true;
  if (!hostname.includes(":")) return false;
  if (hostname === "::" || hostname === "::1") return true;
  if (/^(?:fc|fd|fe[89ab]|ff)/i.test(hostname)) return true;
  const mapped = hostname.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const firstHextet = Number.parseInt(hostname.split(":")[0], 16);
  return !Number.isFinite(firstHextet) || firstHextet < 0x2000 || firstHextet > 0x3fff;
}

export type AIEndpointMode = "auto" | "chat" | "responses";

export function resolveAIEndpoint(baseUrl: string, options: { allowPrivateNetwork?: boolean; mode?: AIEndpointMode } = {}) {
  const value = baseUrl.trim().replace(/\/+$/, "");
  const url = new URL(value);

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("接口地址必须使用 HTTP 或 HTTPS");
  }
  if (url.username || url.password) throw new Error("接口地址中不能包含账号或密钥");
  if (url.search || url.hash) throw new Error("接口地址不能包含查询参数或片段");
  if (!options.allowPrivateNetwork && isPrivateAIHostname(url.hostname)) {
    throw new Error("云端代理不能连接本地或内网地址；请在本地运行项目后使用该地址");
  }

  url.hostname = url.hostname.replace(/\.$/, "");
  url.pathname = url.pathname.replace(/\/+$/, "");
  const explicitResponses = url.pathname.endsWith("/responses");
  const explicitChat = url.pathname.endsWith("/chat/completions");
  const mode = explicitResponses ? "responses" : explicitChat ? "chat" : options.mode === "responses" ? "responses" : "chat";
  if (mode === "responses" && !explicitResponses) {
    url.pathname = `${url.pathname}/responses`.replace(/\/{2,}/g, "/");
  } else if (mode === "chat" && !explicitChat) {
    url.pathname = `${url.pathname}/chat/completions`.replace(/\/{2,}/g, "/");
  }
  return { url: url.toString(), mode, automatic: (options.mode || "auto") === "auto" && !explicitResponses && !explicitChat } as const;
}

export function normalizeAIEndpoint(baseUrl: string, options: { allowPrivateNetwork?: boolean; mode?: AIEndpointMode } = {}) {
  return resolveAIEndpoint(baseUrl, options).url;
}
