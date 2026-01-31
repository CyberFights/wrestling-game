/**
 * server.js
 * - No external `nanoid` dependency (uses internal uid()).
 * - Uses express.json() (no body-parser package).
 * - Robust read/write for presets and characters files.
 * - Presets no longer require skinColors.
 *
 * Save as server.js and run (ensure express is installed):
 *   npm install express
 *   node server.js
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// File paths
const PRESETS_PATH = path.join(__dirname, 'presets.json');
const DATA_DIR = path.join(__dirname, 'data');
const CHARACTERS_PATH = path.join(DATA_DIR, 'characters.json');

// Simple uid generator (uses crypto if available)
function uid(len = 10) {
  try {
    const { randomBytes } = require('crypto');
    return randomBytes(Math.ceil(len / 2)).toString('hex').slice(0, len);
  } catch {
    return (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, len);
  }
}

// Safe JSON read helper
function readJSONSafe(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return defaultValue;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`readJSONSafe: failed to read/parse ${filePath}:`, err.message);
    return defaultValue;
  }
}

// Atomic-ish JSON write
function writeJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// Load presets, allow missing skinColors
function loadPresets() {
  const presets = readJSONSafe(PRESETS_PATH, null);
  if (!presets) {
    throw new Error(`Presets file not found or invalid JSON at ${PRESETS_PATH}`);
  }
  const required = ['archetypes', 'attire', 'masks', 'accessories', 'heights', 'bodyTypes'];
  const missing = required.filter(k => !Object.prototype.hasOwnProperty.call(presets, k));
  if (missing.length) {
    throw new Error(`Presets file must include archetypes, attire, masks, accessories, heights, bodyTypes. Missing: ${missing.join(', ')}`);
  }
  // Ensure optional arrays exist for simpler client-side handling
  if (!Array.isArray(presets.skinColors)) presets.skinColors = [];
  return presets;
}

// Ensure characters file exists and is an array
function ensureCharactersFileSync() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const raw = fs.existsSync(CHARACTERS_PATH) ? fs.readFileSync(CHARACTERS_PATH, 'utf8').trim() : '';
    if (!raw) {
      writeJSON(CHARACTERS_PATH, []);
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      writeJSON(CHARACTERS_PATH, []);
      return [];
    }
    return parsed;
  } catch (err) {
    console.warn('ensureCharactersFileSync: error, initializing empty array:', err.message);
    try { writeJSON(CHARACTERS_PATH, []); } catch (werr) { console.error('Failed to write characters file:', werr); }
    return [];
  }
}

// Load presets at startup (allow server to start even if presets invalid, but endpoints will report)
let PRESETS = null;
try {
  PRESETS = loadPresets();
  console.info('Presets loaded OK');
} catch (err) {
  console.error('Presets load error:', err.message);
  PRESETS = null;
}

// Initialize characters file
ensureCharactersFileSync();

// Serve static public directory
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/presets
app.get('/api/presets', (req, res) => {
  if (!PRESETS) {
    try {
      PRESETS = loadPresets();
    } catch (err) {
      return res.status(500).json({ error: 'Presets unavailable: ' + err.message });
    }
  }
  res.json(PRESETS);
});

// GET /api/characters
app.get('/api/characters', (req, res) => {
  const chars = readJSONSafe(CHARACTERS_PATH, []);
  res.json(Array.isArray(chars) ? chars : []);
});

// POST /api/characters
app.post('/api/characters', (req, res) => {
  try {
    const body = req.body;
    if (!body || !body.name || !body.selection) {
      return res.status(400).json({ error: 'Invalid payload. Expect { name, selection }' });
    }
    const record = {
      id: uid(10),
      name: String(body.name),
      notes: body.notes || '',
      selection: Object.assign({}, body.selection),
      created_at: new Date().toISOString()
    };
    const current = readJSONSafe(CHARACTERS_PATH, []);
    if (!Array.isArray(current)) {
      writeJSON(CHARACTERS_PATH, [record]);
    } else {
      current.push(record);
      writeJSON(CHARACTERS_PATH, current);
    }
    res.status(201).json(record);
  } catch (err) {
    console.error('POST /api/characters error', err);
    res.status(500).json({ error: 'Failed to save character' });
  }
});

// Debug endpoint to inspect raw presets file
app.get('/api/_debug/presets', (req, res) => {
  const p = readJSONSafe(PRESETS_PATH, null);
  res.json({ ok: true, presets: p });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Wrestling Character Creator API listening on http://localhost:${PORT}`);
});
