/**
 * Minimal server.js patched to:
 * - not require `skinColors` in presets.json (it's optional now)
 * - robustly handle empty / invalid JSON for characters file
 *
 * Drop this into your project (replace existing server.js) and restart the server.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
const { nanoid } = require('nanoid');

const app = express();
app.use(bodyParser.json());

// File locations (adjust if your project stores them elsewhere)
const PRESETS_PATH = path.join(__dirname, 'presets.json');
const DATA_DIR = path.join(__dirname, 'data');
const CHARACTERS_PATH = path.join(DATA_DIR, 'characters.json');

// Utility: safe JSON read, returns defaultValue on error / missing / empty
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

// Utility: write JSON with atomic-ish replace
function writeJSON(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.error('writeJSON error', err);
    throw err;
  }
}

// Load and validate presets; skinColors is optional
function loadPresets() {
  const presets = readJSONSafe(PRESETS_PATH, null);
  if (!presets) {
    throw new Error(`Presets file not found or invalid JSON at ${PRESETS_PATH}`);
  }

  // Required keys (skinColors intentionally omitted)
  const required = ['archetypes', 'attire', 'masks', 'accessories', 'heights', 'bodyTypes'];
  const missing = required.filter(k => !Object.prototype.hasOwnProperty.call(presets, k));
  if (missing.length) {
    throw new Error(`Presets file must include archetypes, attire, masks, accessories, heights, bodyTypes. Missing: ${missing.join(', ')}`);
  }

  // Ensure optional arrays exist for easier client logic
  if (!Array.isArray(presets.skinColors)) presets.skinColors = [];

  return presets;
}

// Ensure characters file exists and is valid JSON array
async function ensureCharactersFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const chars = readJSONSafe(CHARACTERS_PATH, null);
    if (!Array.isArray(chars)) {
      // If file exists but invalid or not an array, overwrite with empty array
      writeJSON(CHARACTERS_PATH, []);
      return [];
    }
    return chars;
  } catch (err) {
    console.warn('ensureCharactersFile: initializing new characters file due to error:', err.message);
    writeJSON(CHARACTERS_PATH, []);
    return [];
  }
}

/* --- Load presets at startup (fail fast if invalid) --- */
let PRESETS;
try {
  PRESETS = loadPresets();
  console.info('Presets loaded OK');
} catch (err) {
  console.error('Error: ' + err.message);
  // We still start server to allow debugging, but endpoints will report error
  PRESETS = null;
}

/* --- Initialize characters file (safe) --- */
let CHARACTERS = [];
ensureCharactersFile().then(list => {
  CHARACTERS = list;
}).catch(err => {
  console.error('Failed to initialize characters file:', err);
  CHARACTERS = [];
});

// Serve static files from 'public' if present
app.use(express.static(path.join(__dirname, 'public')));

// API: GET presets
app.get('/api/presets', (req, res) => {
  if (!PRESETS) {
    // Try to reload (in case file was added after startup)
    try {
      PRESETS = loadPresets();
    } catch (err) {
      return res.status(500).json({ error: 'Presets unavailable: ' + err.message });
    }
  }
  res.json(PRESETS);
});

// API: list characters
app.get('/api/characters', (req, res) => {
  // Read file fresh each request to avoid stale in-memory state if external edits happen
  const chars = readJSONSafe(CHARACTERS_PATH, []);
  // Ensure it's an array
  res.json(Array.isArray(chars) ? chars : []);
});

// API: save character (append)
app.post('/api/characters', (req, res) => {
  try {
    const body = req.body;
    if (!body || !body.name || !body.selection) {
      return res.status(400).json({ error: 'Invalid payload. Expect { name, selection }' });
    }

    // Minimal validation / sanitization - keep compatible with previous server
    const record = {
      id: nanoid(10),
      name: String(body.name),
      notes: body.notes || '',
      selection: Object.assign({}, body.selection),
      created_at: new Date().toISOString()
    };

    // Load current characters, append, save
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

// Helpful debug endpoint to validate presets shape
app.get('/api/_debug/presets', (req, res) => {
  try {
    const p = readJSONSafe(PRESETS_PATH, null);
    res.json({ ok: true, presets: p });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Wrestling Character Creator API listening on http://localhost:${PORT}`);
});
