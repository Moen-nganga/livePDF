import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { documentsRepo } from './db.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' })); // generous: documents embed base64 images

function requireDeviceId(req: express.Request, res: express.Response): string | null {
  const deviceId = req.header('x-device-id');
  if (!deviceId) {
    res.status(400).json({ error: 'Missing X-Device-Id header' });
    return null;
  }
  return deviceId;
}

// List documents for the current device (metadata only, not full content)
app.get('/api/documents', (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  const rows = documentsRepo.listForDevice(deviceId);
  res.json(rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  })));
});

// Fetch one full document
app.get('/api/documents/:id', (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  const row = documentsRepo.get(req.params.id, deviceId);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(row.data));
});

// Create or update (auto-save calls this repeatedly with the same id)
app.put('/api/documents/:id', (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  const doc = req.body;
  if (!doc || typeof doc !== 'object') {
    return res.status(400).json({ error: 'Invalid document body' });
  }
  const now = Date.now();
  documentsRepo.upsert({
    id: req.params.id,
    device_id: deviceId,
    title: doc.title ?? 'Untitled document',
    data: JSON.stringify(doc),
    created_at: doc.createdAt ?? now,
    updated_at: now,
  });
  res.json({ ok: true, updatedAt: now });
});

app.delete('/api/documents/:id', (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  documentsRepo.remove(req.params.id, deviceId);
  res.json({ ok: true });
});

// Convenience endpoint for the client to mint a new document id
app.post('/api/documents', (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  res.json({ id: nanoid() });
});

const port = process.env.PORT ? Number(process.env.PORT) : 8787;
app.listen(port, () => {
  console.log(`PDF editor API listening on http://localhost:${port}`);
});
