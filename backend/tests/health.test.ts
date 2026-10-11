import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';

function setup(findFirst: ReturnType<typeof vi.fn>) {
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const app = express();
  app.use('/api', createHealthRouter({ todo: { findFirst } } as any, logger));
  return { app, logger };
}

describe.each(['/api/health', '/api/health/ready'])('readiness probe %s', (path) => {
  it('reports ok when the database answers', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const { app } = setup(findFirst);

    const response = await request(app).get(path);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
  });

  it('reports 503 and logs the cause when the database is unreachable', async () => {
    const failure = new Error('ECONNREFUSED');
    const { app, logger } = setup(vi.fn().mockRejectedValue(failure));

    const response = await request(app).get(path);

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'unavailable' });
    expect(logger.error).toHaveBeenCalledWith('Health check failed', { route: path, error: failure });
  });
});

describe('liveness probe /api/health/live', () => {
  it('reports ok without touching the database, even when it is down', async () => {
    const findFirst = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const { app } = setup(findFirst);

    const response = await request(app).get('/api/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(findFirst).not.toHaveBeenCalled();
  });
});
