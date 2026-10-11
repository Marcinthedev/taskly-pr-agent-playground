import { describe, expect, it, vi } from 'vitest';
import { createDatabase, ensureTodoTable, initialize } from '../src/core/database.ts';

const validColumns = [
  { column_name: 'id', data_type: 'integer', is_nullable: 'NO' },
  { column_name: 'title', data_type: 'character varying', is_nullable: 'NO' },
  { column_name: 'description', data_type: 'character varying', is_nullable: 'NO' },
  { column_name: 'priority', data_type: 'character varying', is_nullable: 'NO' },
  { column_name: 'due_date', data_type: 'date', is_nullable: 'YES' },
  { column_name: 'completed', data_type: 'boolean', is_nullable: 'NO' },
  { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
  { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
];

function fakeDatabase(columns: object[]) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(columns),
    $executeRaw: vi.fn().mockResolvedValue(0),
  } as any;
}

function sqlOf(call: unknown[]) {
  return (call[0] as TemplateStringsArray).join('?').replace(/\s+/g, ' ');
}

describe('createDatabase', () => {
  it('builds a Prisma client exposing the todo delegate without connecting', () => {
    const database = createDatabase('postgresql://test:test@localhost:5432/test');
    expect(typeof database.todo.findMany).toBe('function');
  });
});

describe('ensureTodoTable', () => {
  it('accepts the expected schema', async () => {
    await expect(ensureTodoTable(fakeDatabase(validColumns))).resolves.toBeUndefined();
  });

  it('accepts a legacy timestamp due_date column', async () => {
    const legacy = validColumns.map((column) =>
      column.column_name === 'due_date' ? { ...column, data_type: 'timestamp without time zone' } : column,
    );
    await expect(ensureTodoTable(fakeDatabase(legacy))).resolves.toBeUndefined();
  });

  it('inspects only the todos table of the current schema', async () => {
    const database = fakeDatabase(validColumns);
    await ensureTodoTable(database);
    const sql = sqlOf(database.$queryRaw.mock.calls[0]);
    expect(sql).toContain("table_name = 'todos'");
    expect(sql).toContain('table_schema = current_schema()');
  });

  it('fails when the table does not exist', async () => {
    await expect(ensureTodoTable(fakeDatabase([]))).rejects.toThrow(
      'Database schema mismatch: the todos table does not exist.',
    );
  });

  it('names every missing, retyped or wrongly nullable column', async () => {
    const broken = validColumns
      .filter((column) => column.column_name !== 'priority')
      .map((column) => {
        if (column.column_name === 'completed') return { ...column, data_type: 'integer' };
        if (column.column_name === 'title') return { ...column, is_nullable: 'YES' };
        return column;
      });
    await expect(ensureTodoTable(fakeDatabase(broken))).rejects.toThrow(
      'Database schema mismatch: missing or invalid columns in todos table (title, priority, completed).',
    );
  });
});

describe('initialize', () => {
  it('creates the table if needed, then validates it', async () => {
    const database = fakeDatabase(validColumns);
    await initialize(database);
    expect(sqlOf(database.$executeRaw.mock.calls[0])).toContain('CREATE TABLE IF NOT EXISTS todos');
    expect(database.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(database.$queryRaw.mock.invocationCallOrder[0]);
  });

  it('propagates a schema mismatch found after creation', async () => {
    await expect(initialize(fakeDatabase([]))).rejects.toThrow('the todos table does not exist');
  });
});
