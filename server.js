const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = __dirname;
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const CHARACTERS_FILE = path.join(DATA_DIR, 'characters.json');

// Utilities

async function readJSON(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJSON(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function nowISO() {
  return new Date().toISOString();
}

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  try {
    return require('crypto').randomUUID();
  } catch {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }
}

// Load presets (from file) and normalize keys to wrestling-specific names
async function loadPresets() {
  const raw = await readJSON(PRESETS_FILE, null);
  if (!raw) {
    throw new Error('Presets file missing. Ensure presets.json exists.');
  }

  // Normalize legacy keys to new names for backward compatibility
  const presets = Object.assign({}, raw);

  if (!presets.archetypes && presets.classes) {
    presets.archetypes = presets.classes;
  }
  if (!presets.attire && presets.weapons) {
    presets.attire = presets.weapons;
  }
  if (!presets.masks && presets.armors) {
    presets.masks = presets.armors;
  }
  if (!presets.accessories && presets.items) {
    presets.accessories = presets.items;
  }

  // Validate presence of required sets
  const required = ['archetypes', 'attire', 'masks', 'accessories', 'heights', 'bodyTypes', 'skinColors'];
  for (const key of required) {
    if (!presets[key]) {
      throw new Error(`Presets file must include ${required.join(', ')}. Missing: ${key}`);
    }
  }

  return presets;
}

// Simple validation helpers
function findById(list = [], id) {
  return list.find((i) => String(i.id) === String(id));
}

function validateSelection(presets, selection) {
  // selection: { archetypeId, attireId, maskId, accessoryIds: [], heightId, bodyTypeId, skinColorId }
  const errors = [];

  if (!selection || typeof selection !== 'object') {
    errors.push('Selection must be an object');
    return errors;
  }

  const archetype = findById(presets.archetypes, selection.archetypeId);
  if (!archetype) errors.push('Invalid archetypeId');

  const attire = findById(presets.attire, selection.attireId);
  if (!attire) errors.push('Invalid attireId');

  const mask = findById(presets.masks, selection.maskId);
  if (!mask) errors.push('Invalid maskId');

  if (selection.accessoryIds && !Array.isArray(selection.accessoryIds)) {
    errors.push('accessoryIds must be an array');
  } else if (selection.accessoryIds) {
    for (const id of selection.accessoryIds) {
      if (!findById(presets.accessories, id)) {
        errors.push(`Invalid accessoryId: ${id}`);
      }
    }
  }

  const height = findById(presets.heights, selection.heightId);
  if (!height) errors.push('Invalid heightId');

  const bodyType = findById(presets.bodyTypes, selection.bodyTypeId);
  if (!bodyType) errors.push('Invalid bodyTypeId');

  const skin = findById(presets.skinColors, selection.skinColorId);
  if (!skin) errors.push('Invalid skinColorId');

  return errors;
}

// Derived stats example: combine archetype base stats with attire/mask/accessory/height/bodyType bonuses
function deriveStats(presets, selection) {
  const archetype = findById(presets.archetypes, selection.archetypeId);
  const attire = findById(presets.attire, selection.attireId);
  const mask = findById(presets.masks, selection.maskId);
  const accessories = (selection.accessoryIds || []).map((id) => findById(presets.accessories, id));
  const height = findById(presets.heights, selection.heightId);
  const bodyType = findById(presets.bodyTypes, selection.bodyTypeId);

  // Start with archetype base stats
  const stats = Object.assign({}, archetype.baseStats);

  // Apply attire bonuses
  if (attire && attire.statBonuses) {
    for (const [k, v] of Object.entries(attire.statBonuses)) {
      stats[k] = (stats[k] || 0) + v;
    }
  }

  // Apply mask bonuses
  if (mask && mask.statBonuses) {
    for (const [k, v] of Object.entries(mask.statBonuses)) {
      stats[k] = (stats[k] || 0) + v;
    }
  }

  // Apply accessory bonuses
  for (const it of accessories) {
    if (it && it.statBonuses) {
      for (const [k, v] of Object.entries(it.statBonuses)) {
        stats[k] = (stats[k] || 0) + v;
      }
    }
  }

  // Apply height bonuses
  if (height && height.statBonuses) {
    for (const [k, v] of Object.entries(height.statBonuses)) {
      stats[k] = (stats[k] || 0) + v;
    }
  }

  // Apply body type bonuses
  if (bodyType && bodyType.statBonuses) {
    for (const [k, v] of Object.entries(bodyType.statBonuses)) {
      stats[k] = (stats[k] || 0) + v;
    }
  }

  // Example derived wrestling metrics
  stats.showmanship = (stats.charisma || 0) * 2 + (stats.technique || 0);
  stats.finishPower = (stats.strength || 0) * 2 + (attire?.damage || 0);
  stats.resilience = (stats.stamina || 0) * 2 + (mask?.armor || 0) + (stats.vitality || 0);

  return stats;
}

// Ensure characters file exists
async function ensureCharactersFile() {
  const existing = await readJSON(CHARACTERS_FILE, null);
  if (!existing) {
    await writeJSON(CHARACTERS_FILE, { characters: [] });
  }
}

// Routes

// GET /api/presets
app.get('/api/presets', async (req, res) => {
  try {
    const presets = await loadPresets();
    res.json(presets);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load presets' });
  }
});

// GET /api/characters
app.get('/api/characters', async (req, res) => {
  try {
    await ensureCharactersFile();
    const data = await readJSON(CHARACTERS_FILE);
    res.json(data.characters || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load characters' });
  }
});

// GET /api/characters/:id
app.get('/api/characters/:id', async (req, res) => {
  try {
    await ensureCharactersFile();
    const data = await readJSON(CHARACTERS_FILE);
    const character = (data.characters || []).find((c) => c.id === req.params.id);
    if (!character) return res.status(404).json({ error: 'Not found' });
    res.json(character);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load character' });
  }
});

// POST /api/characters
app.post('/api/characters', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || !payload.name || !payload.selection) {
      return res.status(400).json({ error: 'Missing name or selection' });
    }

    const presets = await loadPresets();
    const validation = validateSelection(presets, payload.selection);
    if (validation.length) {
      return res.status(400).json({ error: 'Invalid selection', details: validation });
    }

    const derivedStats = deriveStats(presets, payload.selection);

    const newChar = {
      id: generateId(),
      name: String(payload.name),
      selection: payload.selection,
      derivedStats,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      notes: payload.notes || ''
    };

    await ensureCharactersFile();
    const data = await readJSON(CHARACTERS_FILE);
    data.characters = data.characters || [];
    data.characters.push(newChar);
    await writeJSON(CHARACTERS_FILE, data);

    res.status(201).json(newChar);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save character' });
  }
});

// PUT /api/characters/:id - update a character (replace name/selection/notes)
app.put('/api/characters/:id', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || (!payload.name && !payload.selection && payload.notes === undefined)) {
      return res.status(400).json({ error: 'Provide at least one of name, selection, or notes to update' });
    }

    const presets = await loadPresets();
    if (payload.selection) {
      const validation = validateSelection(presets, payload.selection);
      if (validation.length) {
        return res.status(400).json({ error: 'Invalid selection', details: validation });
      }
    }

    await ensureCharactersFile();
    const data = await readJSON(CHARACTERS_FILE);
    const chars = data.characters || [];
    const idx = chars.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Character not found' });

    if (payload.name) chars[idx].name = String(payload.name);
    if (payload.selection) {
      chars[idx].selection = payload.selection;
      chars[idx].derivedStats = deriveStats(presets, payload.selection);
    }
    if (payload.notes !== undefined) chars[idx].notes = payload.notes;
    chars[idx].updatedAt = nowISO();

    await writeJSON(CHARACTERS_FILE, data);
    res.json(chars[idx]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update character' });
  }
});

// DELETE /api/characters/:id
app.delete('/api/characters/:id', async (req, res) => {
  try {
    await ensureCharactersFile();
    const data = await readJSON(CHARACTERS_FILE);
    const chars = data.characters || [];
    const idx = chars.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Character not found' });
    const [removed] = chars.splice(idx, 1);
    await writeJSON(CHARACTERS_FILE, data);
    res.json({ deleted: removed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete character' });
  }
});

// Fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  await ensureCharactersFile().catch((e) => console.error('Failed to init characters file:', e));
  console.log(`Wrestling Character Creator API listening on http://localhost:${PORT}`);
});
