const request = require('supertest');
const app = require('../src/app');

describe('Health Check', () => {
  it('GET /health should return status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('Users API', () => {
  it('GET /api/users should return list of users', async () => {
    const res = await request(app).get('/api/users');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('id');
    expect(res.body[0]).toHaveProperty('name');
    expect(res.body[0]).toHaveProperty('email');
  });

  it('GET /api/users/:id should return a user', async () => {
    const res = await request(app).get('/api/users/1');
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it('GET /api/users/:id with invalid id should return 400', async () => {
    const res = await request(app).get('/api/users/abc');
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Invalid user ID');
  });

  it('POST /api/users should create a user', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ name: 'Charlie', email: 'charlie@example.com' });
    expect(res.statusCode).toBe(201);
    expect(res.body.name).toBe('Charlie');
  });

  it('POST /api/users without name should return 400', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ email: 'test@example.com' });
    expect(res.statusCode).toBe(400);
  });
});
