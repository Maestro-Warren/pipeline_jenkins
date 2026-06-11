const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'backend', timestamp: new Date().toISOString() });
});

app.get('/api/tasks', (req, res) => {
  res.json([
    { id: 1, title: 'Setup Docker', completed: true },
    { id: 2, title: 'Write Jenkinsfile', completed: false },
    { id: 3, title: 'Configure Nginx', completed: false },
  ]);
});

app.get('/api/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid task ID' });
  }
  res.json({ id, title: 'Setup Docker', completed: true });
});

app.post('/api/tasks', (req, res) => {
  const { title } = req.body;
  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'Title is required' });
  }
  res.status(201).json({ id: 4, title, completed: false });
});

app.put('/api/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid task ID' });
  }
  const { title, completed } = req.body;
  res.json({ id, title: title || 'Updated task', completed: completed || false });
});

app.delete('/api/tasks/:id', (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid task ID' });
  }
  res.status(204).send();
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
  });
}

module.exports = app;
