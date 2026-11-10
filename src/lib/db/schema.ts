import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const users = sqliteTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the cookie token; the raw token is never stored. */
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const folders = sqliteTable(
  "folders",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("blue"),
    createdAt: createdAt(),
  },
  (t) => [index("folders_user_idx").on(t.userId)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** What the student wants to learn; may be the only input (no materials). */
    topic: text("topic").notNull().default(""),
    tier: text("tier", { enum: ["standard", "deep_dive"] }).notNull().default("standard"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index("projects_user_idx").on(t.userId), index("projects_folder_idx").on(t.folderId)],
);

export const materials = sqliteTable(
  "materials",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["text", "file", "recording"] }).notNull(),
    name: text("name").notNull(),
    content: text("content").notNull(),
    wordCount: integer("word_count").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("materials_project_idx").on(t.projectId)],
);

export const OUTPUT_TYPE_VALUES = ["notes", "cheatsheet", "flashcards", "quiz", "mindmap", "terms"] as const;
export const GENERATION_STATUS_VALUES = ["queued", "running", "done", "error", "cancelled"] as const;

/** One row per (project, output type); regenerating reuses the row and keeps old content until replaced. */
export const generations = sqliteTable(
  "generations",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    type: text("type", { enum: OUTPUT_TYPE_VALUES }).notNull(),
    status: text("status", { enum: GENERATION_STATUS_VALUES }).notNull().default("queued"),
    /** JSON payload whose shape depends on `type`. */
    content: text("content"),
    error: text("error"),
    queuedAt: integer("queued_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (t) => [uniqueIndex("generations_project_type_idx").on(t.projectId, t.type), index("generations_status_idx").on(t.status)],
);

export const flashcards = sqliteTable(
  "flashcards",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    position: integer("position").notNull(),
    // Spaced-repetition state
    dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
    intervalDays: real("interval_days").notNull().default(0),
    ease: real("ease").notNull().default(2.5),
    reps: integer("reps").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    lastReviewedAt: integer("last_reviewed_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [index("flashcards_project_idx").on(t.projectId), index("flashcards_due_idx").on(t.dueAt)],
);

export const quizAttempts = sqliteTable(
  "quiz_attempts",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    total: integer("total").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("quiz_attempts_project_idx").on(t.projectId)],
);

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: id(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_project_idx").on(t.projectId)],
);

export type User = typeof users.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Material = typeof materials.$inferSelect;
export type Generation = typeof generations.$inferSelect;
export type FlashcardRow = typeof flashcards.$inferSelect;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
