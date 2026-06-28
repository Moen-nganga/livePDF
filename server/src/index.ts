import express from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { documentsRepo, sharesRepo } from './db.js';

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

// Create a share link for one of the current device's own documents.
// Only the owning device can mint new share tokens for a document —
// otherwise anyone with a view link could create their own edit link
// for the same doc, defeating the point of choosing an access level.
app.post('/api/documents/:id/shares', (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;

  const owned = documentsRepo.get(req.params.id, deviceId);
  if (!owned) return res.status(404).json({ error: 'Not found' });

  const access = req.body?.access;
  if (access !== 'view' && access !== 'edit') {
    return res.status(400).json({ error: "access must be 'view' or 'edit'" });
  }

  const token = nanoid(21); // longer than the default device/document ids — this token IS the credential
  sharesRepo.create({
    token,
    document_id: req.params.id,
    access,
    created_at: Date.now(),
  });
  res.json({ token, access });
});

app.get('/api/documents/:id/shares', (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  const owned = documentsRepo.get(req.params.id, deviceId);
  if (!owned) return res.status(404).json({ error: 'Not found' });
  const shares = sharesRepo.listForDocument(req.params.id);
  res.json(shares.map((s) => ({ token: s.token, access: s.access, createdAt: s.created_at })));
});

app.delete('/api/shares/:token', (req, res) => {
  const deviceId = requireDeviceId(req, res);
  if (!deviceId) return;
  const share = sharesRepo.getByToken(req.params.token);
  if (!share) return res.json({ ok: true }); // already gone, nothing to do
  const owned = documentsRepo.get(share.document_id, deviceId);
  if (!owned) return res.status(403).json({ error: 'Not the owner of this share' });
  sharesRepo.revoke(req.params.token);
  res.json({ ok: true });
});

// Resolve a share token to its document — no device id required, since
// the token itself grants access. This is the route a recipient's browser
// calls when opening a shared link.
app.get('/api/shared/:token', (req, res) => {
  const share = sharesRepo.getByToken(req.params.token);
  if (!share) return res.status(404).json({ error: 'This share link is invalid or has been revoked' });
  const doc = documentsRepo.getById(share.document_id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json({ document: JSON.parse(doc.data), access: share.access });
});

// Save via a share token — only valid for 'edit' tokens. A 'view' token
// hitting this route is rejected even though it successfully resolved the
// GET above, since read access and write access are different grants.
app.put('/api/shared/:token', (req, res) => {
  const share = sharesRepo.getByToken(req.params.token);
  if (!share) return res.status(404).json({ error: 'This share link is invalid or has been revoked' });
  if (share.access !== 'edit') {
    return res.status(403).json({ error: 'This link is view-only' });
  }
  const doc = documentsRepo.getById(share.document_id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Invalid document body' });
  }
  const now = Date.now();
  documentsRepo.upsert({
    id: doc.id,
    device_id: doc.device_id, // preserve original owner, the editor via link doesn't become the owner
    title: body.title ?? doc.title,
    data: JSON.stringify(body),
    created_at: doc.created_at,
    updated_at: now,
  });
  res.json({ ok: true, updatedAt: now });
});

const port = process.env.PORT ? Number(process.env.PORT) : 8787;
app.listen(port, () => {
  console.log(`PDF editor API listening on http://localhost:${port}`);
});