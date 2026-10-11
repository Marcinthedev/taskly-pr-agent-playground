import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import type { Database } from "../features/todos/types.js";

const requiredColumns = [
  { name: "id", type: "integer", nullable: false },
  { name: "title", type: "character varying", nullable: false },
  { name: "description", type: "character varying", nullable: false },
  { name: "priority", type: "character varying", nullable: false },
  { name: "due_date", type: "date", nullable: true },
  { name: "completed", type: "boolean", nullable: false },
  { name: "created_at", type: "timestamp with time zone", nullable: false },
  { name: "updated_at", type: "timestamp with time zone", nullable: false },
] as const;

export function createDatabase(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 10000,
    max: 25,
  });
  return new PrismaClient({ adapter });
}

export async function ensureTodoTable(database: Database): Promise<void> {
  const existing = await database.$queryRaw<
    Array<{ column_name: string; data_type: string; is_nullable: string }>
  >`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'todos' AND table_schema = current_schema()
    ORDER BY ordinal_position
  `;

  if (existing.length === 0) {
    throw new Error(
      "Database schema mismatch: the todos table does not exist.",
    );
  }

  const columnMap = new Map(
    existing.map((column) => [column.column_name, column]),
  );
  const missing = requiredColumns.filter((column) => {
    const current = columnMap.get(column.name);
    if (!current) {
      return true;
    }

    const nullableMatch = column.nullable
      ? current.is_nullable === "YES"
      : current.is_nullable === "NO";
    const dataTypeMatch =
      current.data_type === column.type ||
      (column.name === "due_date" &&
        current.data_type === "timestamp without time zone");
    return !nullableMatch || !dataTypeMatch;
  });

  if (missing.length > 0) {
    const names = missing.map((column) => column.name).join(", ");
    throw new Error(
      `Database schema mismatch: missing or invalid columns in todos table (${names}).`,
    );
  }
}

export async function initialize(database: Database): Promise<void> {
  await database.$executeRaw`CREATE TABLE IF NOT EXISTS todos (
    id SERIAL PRIMARY KEY,
    title VARCHAR(120) NOT NULL CHECK (length(trim(title)) > 0),
    description VARCHAR(2000) NOT NULL DEFAULT '',
    priority VARCHAR(6) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
    due_date DATE,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  )`;

  await ensureTodoTable(database);
}
