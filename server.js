const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

if (pool) pool.on('error', err => console.error('Pool error:', err.message));

async function initDB() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      account_number TEXT DEFAULT '',
      review_date TEXT DEFAULT '',
      data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

app.get('/api/clients', async (req, res) => {
  if (!pool) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, name, account_number, review_date, updated_at
       FROM clients WHERE name ILIKE $1 ORDER BY updated_at DESC`,
      [`%${req.query.search || ''}%`]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clients/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database configured' });
  try {
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clients', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database configured' });
  try {
    const { name, account_number, review_date, data } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO clients (name, account_number, review_date, data)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, account_number || '', review_date || '', data]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database configured' });
  try {
    const { name, account_number, review_date, data } = req.body;
    const { rows } = await pool.query(
      `UPDATE clients SET name=$1, account_number=$2, review_date=$3, data=$4, updated_at=NOW()
       WHERE id=$5 RETURNING *`,
      [name, account_number || '', review_date || '', data, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'No database configured' });
  try {
    await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Listening on port ${PORT}`);
  initDB()
    .then(() => console.log('DB ready'))
    .catch(err => console.error('DB init error:', err.message));
});
