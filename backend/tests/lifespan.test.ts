import { createServer } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';
import { start } from '../src/core/lifespan.ts';

vi.mock('../src/core/database.ts', () => ({ createDatabase: vi.fn(), initialize: vi.fn() }));

const originalEnv = { ...process.env };

async function freePort() {
  return new Promise<number>((resolve) => {
    const probe = createServer().listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

function fakeDatabase() {
  return {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: vi.fn().mockResolvedValue(undefined),
    todo: { findFirst: vi.fn().mockResolvedValue(null) },
  };
}

function captureSignalHandlers() {
  const handlers = new Map<string, (signal: NodeJS.Signals) => Promise<void>>();
  vi.spyOn(process, 'once').mockImplementation(((event: string, handler: never) => {
    handlers.set(event, handler);
    return process;
  }) as typeof process.once);
  return handlers;
}

beforeEach(async () => {
  process.env = { ...originalEnv, NODE_ENV: 'test', LOG_LEVEL: 'silent', API_PORT: String(await freePort()), DATABASE_URL: 'postgresql://t:t@localhost:5432/t' };
});

afterEach(() => {
  process.env = { ...originalEnv };
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('start', () => {
  it('connects, prepares the schema and serves the API on the configured port', async () => {
    const database = fakeDatabase();
    vi.mocked(createDatabase).mockReturnValue(database as any);
    vi.mocked(initialize).mockResolvedValue(undefined);
    const handlers = captureSignalHandlers();

    const { server } = await start();
    try {
      expect(createDatabase).toHaveBeenCalledWith('postgresql://t:t@localhost:5432/t');
      expect(database.$connect).toHaveBeenCalledOnce();
      expect(initialize).toHaveBeenCalledWith(database);
      expect((server.address() as { port: number }).port).toBe(Number(process.env.API_PORT));
      expect((await request(server).get('/api/health')).body).toEqual({ status: 'ok' });
      expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
    } finally {
      await handlers.get('SIGTERM')?.('SIGTERM');
    }
  });

  it('applies the configured CORS allowlist and rate limit', async () => {
    process.env.CORS_ORIGINS = 'https://app.example.com';
    process.env.RATE_LIMIT_MAX = '1';
    const database = { ...fakeDatabase(), todo: { findMany: vi.fn().mockResolvedValue([]) } };
    vi.mocked(createDatabase).mockReturnValue(database as any);
    vi.mocked(initialize).mockResolvedValue(undefined);
    const handlers = captureSignalHandlers();

    const { server } = await start();
    try {
      const first = await request(server).get('/api/todos').set('Origin', 'https://app.example.com');
      const second = await request(server).get('/api/todos');
      expect(first.headers['access-control-allow-origin']).toBe('https://app.example.com');
      expect(second.status).toBe(429);
    } finally {
      await handlers.get('SIGTERM')?.('SIGTERM');
    }
  });

  it('closes the server and disconnects the database on shutdown', async () => {
    const database = fakeDatabase();
    vi.mocked(createDatabase).mockReturnValue(database as any);
    vi.mocked(initialize).mockResolvedValue(undefined);
    const handlers = captureSignalHandlers();

    const { server } = await start();
    await handlers.get('SIGINT')!('SIGINT');

    expect(server.listening).toBe(false);
    expect(database.$disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
  });

  it('marks the process as failed when the database cannot be closed', async () => {
    const database = fakeDatabase();
    database.$disconnect.mockRejectedValue(new Error('socket hang up'));
    vi.mocked(createDatabase).mockReturnValue(database as any);
    vi.mocked(initialize).mockResolvedValue(undefined);
    const handlers = captureSignalHandlers();

    await start();
    await handlers.get('SIGTERM')!('SIGTERM');

    expect(process.exitCode).toBe(1);
  });

  it('disconnects and rethrows when startup fails', async () => {
    const database = fakeDatabase();
    const failure = new Error('Database schema mismatch: the todos table does not exist.');
    vi.mocked(createDatabase).mockReturnValue(database as any);
    vi.mocked(initialize).mockRejectedValue(failure);

    await expect(start()).rejects.toBe(failure);
    expect(database.$disconnect).toHaveBeenCalledOnce();
  });

  it('refuses to start with an invalid configuration', async () => {
    process.env.API_PORT = '70000';
    vi.mocked(createDatabase).mockClear();
    await expect(start()).rejects.toThrow('Invalid application configuration');
    expect(createDatabase).not.toHaveBeenCalled();
  });
});
