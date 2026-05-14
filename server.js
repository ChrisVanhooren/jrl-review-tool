const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

process.on('uncaughtException', err => console.error('Uncaught:', err.message));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));
process.on('exit', code => console.log('Process exit code:', code));
process.on('SIGTERM', () => { console.log('SIGTERM received'); process.exit(0); });
process.on('SIGINT', () => { console.log('SIGINT received'); process.exit(0); });

const app = express();

app.get('/health', (req, res) => res.send('ok'));

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

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

app.post('/api/chat', async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'AI not configured — set ANTHROPIC_API_KEY env var.' });
  try {
    const { messages, portfolio } = req.body;
    const systemPrompt = portfolio
      ? `You are a knowledgeable financial advisor assistant helping a wealth manager at JRL Private Wealth review client portfolios. You are direct, practical, and specific — no generic disclaimers unless truly needed.

Current client portfolio:
Client: ${portfolio.client || 'Unknown'}
Date: ${portfolio.date || 'Unknown'}
Total Market Value: $${(portfolio.totalMV || 0).toLocaleString('en-CA', { maximumFractionDigits: 0 })}

Holdings:
${(portfolio.holdings || []).map(h => `- ${h.desc}${h.symbol ? ' ('+h.symbol+')' : ''}: ${h.pct ? h.pct.toFixed(2)+'%' : '—'} of portfolio, MV $${(h.mv||0).toLocaleString('en-CA', { maximumFractionDigits: 0 })}, Asset Class: ${h.assetClass || '—'}`).join('\n')}

Advisor notes: ${portfolio.notes || 'None'}

Give concise, actionable advice. When asked about a specific holding (like "is now a good time to leave MCD?"), consider valuation, sector context, and portfolio fit. Keep responses under 200 words unless the advisor asks for more detail.`
      : 'You are a financial advisor assistant at JRL Private Wealth. Be concise and practical.';

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    });

    res.json({ reply: response.content[0].text });
  } catch (err) {
    console.error('Chat error:', err.message);
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
