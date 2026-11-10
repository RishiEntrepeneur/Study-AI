import "server-only";

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";
import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import { migrate } from "drizzle-orm/sql-js/migrator";
import * as schema from "./schema";

/**
 * Embedded SQLite (sql.js / WebAssembly): no native modules, tiny memory
 * footprint, identical on Windows, macOS and Linux. The database lives in
 * memory and is written atomically to `data/study-suite.db` shortly after
 * every change, and once more when the server exits.
 */

export type AppDb = SQLJsDatabase<typeof schema>;

interface DbState {
  raw: Database;
  db: AppDb;
  file: string;
  timer: ReturnType<typeof setTimeout> | null;
  firstDirtyAt: number | null;
}

const SAVE_DEBOUNCE_MS = 250;
const SAVE_MAX_WAIT_MS = 2_000;

const globalForDb = globalThis as unknown as { __studyDb?: Promise<DbState> };

function dataDir(): string {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(process.cwd(), "data");
}

function enableForeignKeys(raw: Database) {
  raw.run("PRAGMA foreign_keys = ON;");
}

function saveNow(state: DbState) {
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  state.firstDirtyAt = null;
  const bytes = state.raw.export();
  // export() re-opens the database, which resets pragmas.
  enableForeignKeys(state.raw);
  const tmp = `${state.file}.tmp`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, state.file);
}

async function open(): Promise<DbState> {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "study-suite.db");

  const SQL = await initSqlJs();
  const raw = new SQL.Database(existsSync(file) ? readFileSync(file) : undefined);
  enableForeignKeys(raw);

  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  const state: DbState = { raw, db, file, timer: null, firstDirtyAt: null };
  saveNow(state);

  process.once("exit", () => {
    try {
      if (state.firstDirtyAt !== null) saveNow(state);
    } catch {
      /* best effort on shutdown */
    }
  });
  return state;
}

function state(): Promise<DbState> {
  if (!globalForDb.__studyDb) {
    globalForDb.__studyDb = open().catch((err) => {
      globalForDb.__studyDb = undefined;
      throw err;
    });
  }
  return globalForDb.__studyDb;
}

/** Schedule a save to disk (debounced, but never later than SAVE_MAX_WAIT_MS). */
function markDirty(s: DbState) {
  const now = Date.now();
  if (s.firstDirtyAt === null) s.firstDirtyAt = now;
  if (s.timer) clearTimeout(s.timer);
  const wait = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, s.firstDirtyAt + SAVE_MAX_WAIT_MS - now));
  s.timer = setTimeout(() => {
    try {
      saveNow(s);
    } catch (err) {
      console.error("[db] failed to save database:", err);
    }
  }, wait);
}

/** Run read-only queries. */
export async function read<T>(fn: (db: AppDb) => T): Promise<T> {
  const s = await state();
  return fn(s.db);
}

/** Run writes inside a transaction and persist them to disk. */
export async function write<T>(fn: (db: AppDb) => T): Promise<T> {
  const s = await state();
  const result = s.db.transaction((tx) => fn(tx as unknown as AppDb));
  markDirty(s);
  return result;
}

/** Test helper: flush pending writes immediately. */
export async function flushDb(): Promise<void> {
  const s = await state();
  saveNow(s);
}

export { schema };
