import express from 'express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createTodosRouter } from '../src/features/todos/router.ts';
import { todo } from './fixture.ts';

function setup() {
  const repository = { list: vi.fn().mockResolvedValue([todo]), create: vi.fn().mockResolvedValue(todo), get: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteCompleted: vi.fn() };
  const app = express();
  app.use(express.json());
  app.use('/api/todos', createTodosRouter(repository));
  return { app, repository };
}
it('lists tasks from the repository', async () => {
  const { app, repository } = setup();
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
  expect(repository.list).toHaveBeenCalledOnce();
});
it('creates tasks with trimmed input and defaults', async () => {
  const { app, repository } = setup();
  const response = await request(app).post('/api/todos').send({ title: '  Plan the sprint  ', priority: 'high' });
  expect(response.status).toBe(201);
  expect(response.body).toEqual(todo);
  expect(repository.create).toHaveBeenCalledWith({ title: 'Plan the sprint', description: '', priority: 'high', due_date: null, completed: false });
});
it.each([{ title: '  ' }, { title: 'x'.repeat(121) }, { title: 'Task', priority: 'urgent' }, { title: 'Task', due_date: '2026-02-30' }])(
  'rejects invalid create input without calling the repository: %j', async (payload) => {
    const { app, repository } = setup();
    expect((await request(app).post('/api/todos').send(payload)).status).toBe(422);
    expect(repository.create).not.toHaveBeenCalled();
  },
);

describe('GET /api/todos/:id', () => {
  it('returns the task', async () => {
    const { app, repository } = setup();
    repository.get.mockResolvedValue(todo);
    const response = await request(app).get('/api/todos/1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(todo);
    expect(repository.get).toHaveBeenCalledWith(1);
  });

  it('returns 404 for a missing task', async () => {
    const { app, repository } = setup();
    repository.get.mockResolvedValue(null);
    const response = await request(app).get('/api/todos/42');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: 'Task not found.' });
  });

  it.each(['abc', '0', '-1', '1.5', '9007199254740992'])('rejects the invalid id %s with 422', async (id) => {
    const { app, repository } = setup();
    const response = await request(app).get(`/api/todos/${id}`);
    expect(response.status).toBe(422);
    expect(repository.get).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/todos/:id', () => {
  it('updates only the provided fields', async () => {
    const { app, repository } = setup();
    repository.update.mockResolvedValue({ ...todo, completed: true });
    const response = await request(app).patch('/api/todos/1').send({ completed: true });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ...todo, completed: true });
    expect(repository.update).toHaveBeenCalledWith(1, { completed: true });
  });

  it('returns 404 when the task does not exist', async () => {
    const { app, repository } = setup();
    repository.update.mockResolvedValue(null);
    const response = await request(app).patch('/api/todos/9').send({ title: 'Renamed' });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: 'Task not found.' });
  });

  it.each([{}, { id: 2 }, { completed: 'yes' }, { title: '' }])('rejects the invalid update %j with 422', async (payload) => {
    const { app, repository } = setup();
    const response = await request(app).patch('/api/todos/1').send(payload);
    expect(response.status).toBe(422);
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/todos/completed', () => {
  it('clears completed tasks and returns how many were deleted', async () => {
    const { app, repository } = setup();
    repository.deleteCompleted.mockResolvedValue(3);
    const response = await request(app).delete('/api/todos/completed');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: 3 });
    expect(repository.deleteCompleted).toHaveBeenCalledOnce();
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('returns zero when there are no completed tasks', async () => {
    const { app, repository } = setup();
    repository.deleteCompleted.mockResolvedValue(0);
    const response = await request(app).delete('/api/todos/completed');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deleted: 0 });
  });
});

describe('DELETE /api/todos/:id', () => {
  it('deletes the task and returns 204 without a body', async () => {
    const { app, repository } = setup();
    repository.delete.mockResolvedValue(true);
    const response = await request(app).delete('/api/todos/3');
    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(repository.delete).toHaveBeenCalledWith(3);
  });

  it('returns 404 when nothing was deleted', async () => {
    const { app, repository } = setup();
    repository.delete.mockResolvedValue(false);
    const response = await request(app).delete('/api/todos/3');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ detail: 'Task not found.' });
  });
});
