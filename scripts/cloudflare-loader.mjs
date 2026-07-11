const shim = `export const env = globalThis.__CLOUDFLARE_ENV__ || {};`;
const shimUrl = `data:text/javascript,${encodeURIComponent(shim)}`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return { url: shimUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
