import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  title: text("title").notNull(),
  genre: text("genre").notNull().default(""),
  status: text("status").notNull().default("筹备中"),
  workspaceJson: text("workspace_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("projects_owner_updated_idx").on(table.ownerId, table.updatedAt),
]);

export const automationRuns = sqliteTable("automation_runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  status: text("status").notNull(),
  phase: text("phase").notNull(),
  currentChapter: integer("current_chapter").notNull().default(0),
  currentSegment: integer("current_segment").notNull().default(0),
  requestCount: integer("request_count").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("automation_runs_project_updated_idx").on(table.projectId, table.updatedAt),
  index("automation_runs_owner_status_idx").on(table.ownerId, table.status),
]);

export const generationSteps = sqliteTable("generation_steps", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => automationRuns.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  stepKey: text("step_key").notNull(),
  kind: text("kind").notNull(),
  chapterNumber: integer("chapter_number"),
  segmentNumber: integer("segment_number"),
  status: text("status").notNull(),
  attempts: integer("attempts").notNull().default(1),
  contextHash: text("context_hash"),
  outputExcerpt: text("output_excerpt"),
  error: text("error"),
  usageJson: text("usage_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("generation_steps_run_step_key_uidx").on(table.runId, table.stepKey),
  index("generation_steps_project_chapter_idx").on(table.projectId, table.chapterNumber),
]);

export const canonStates = sqliteTable("canon_states", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  stateJson: text("state_json").notNull(),
  lastAuditedChapter: integer("last_audited_chapter").notNull().default(0),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workspaceSnapshots = sqliteTable("workspace_snapshots", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  label: text("label").notNull(),
  workspaceJson: text("workspace_json").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("workspace_snapshots_project_created_idx").on(table.projectId, table.createdAt),
]);

export const backgroundResponses = sqliteTable("background_responses", {
  id: text("id").primaryKey(),
  responseId: text("response_id").notNull(),
  runId: text("run_id").notNull().references(() => automationRuns.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  stepKey: text("step_key").notNull(),
  kind: text("kind").notNull(),
  chapterNumber: integer("chapter_number"),
  segmentNumber: integer("segment_number"),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(1),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("background_responses_response_id_uidx").on(table.responseId),
  uniqueIndex("background_responses_run_step_key_uidx").on(table.runId, table.stepKey),
  index("background_responses_project_status_idx").on(table.projectId, table.status),
]);

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  responseId: text("response_id"),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
