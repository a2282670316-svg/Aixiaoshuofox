/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    OPENAI_WEBHOOK_SECRET?: string;
    BACKGROUND_AI_BASE_URL?: string;
    BACKGROUND_AI_API_KEY?: string;
    BACKGROUND_AI_MODEL?: string;
    BACKGROUND_WORKER_SECRET?: string;
  }
}
