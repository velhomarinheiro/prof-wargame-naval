#!/usr/bin/env node
'use strict';

/**
 * apply-calibration.js
 *
 * Applies the Bacia de Campos / naval_salvo calibrated d6 damage tables
 * to any wargame combat_config.js (or structurally compatible file).
 *
 * Calibration source:
 *   naval_salvo project (velhomarinheiro/naval_salvo)
 *   Scenario: Bacia de Campos (SIGE 2026)
 *   Method: η (composite effectiveness) → d6 faces
 *           HP_per_unit / staying_power → damage per hit
 *
 * Usage:
 *   node apply-calibration.js <path>
 *
 *   <path> may be:
 *     - a directory  → script searches for a compatible config file inside
 *     - a .js file   → applied directly
 *
 * What the script does:
 *   1. Finds the damageTables block (supports blue/red or single-team)
 *   2. Creates a backup at <file>.bak
 *   3. Replaces ONLY the known damage profiles (profile-by-profile)
 *      — navalGun and any unknown profiles are left completely untouched
 *   4. Reports every profile matched / skipped
 *
 * Safe to run multiple times (idempotent after first run).
 */

const fs   = require('fs');
const path = require('path');

// ─── Calibrated tables ─────────────────────────────────────────────────────
//
// Profile         η (Bacia)   faces   P(hit)   damage/hit
// ─────────────── ─────────── ─────── ──────── ───────────
// ascm vs surface  0.85        5       0.833    2 SP + crit
// mss  vs surface  0.85        5       0.833    1 SP + crit
// torpedo vs surf  0.90        5       0.833    2 SP + crit
// torpedo vs sub   0.90        5       0.833    1 SP + crit
// lacm  vs land    0.85        5       0.833    2 SP + crit
// asbm  vs surface 0.70        4       0.667    2 SP + crit
// airDef vs any    0.85        5       0.833    1 (intercept)
// bmd   vs any     0.50        3       0.500    1 (intercept)
// asw   vs sub     0.70        4       0.667    1 SP + crit
// airAttack vs sf  0.75        4       0.667    2 SP + crit
// airAttack vs air 0.75        4       0.667    1 SP + crit
// airAttack vs lnd 0.75        4       0.667    1 SP + crit
// navalGun: intentionally omitted — preserved unchanged from the target file

const CALIBRATION = {
  ascmSurface: {
    surface:    { '1':0, '2':2, '3':2, '4':2, '5':2, '6':'1d6' },
  },
  mssSurface: {
    surface:    { '1':0, '2':1, '3':1, '4':1, '5':1, '6':'1d6' },
  },
  torpedo: {
    surface:    { '1':0, '2':2, '3':2, '4':2, '5':2, '6':'1d6' },
    submarine:  { '1':0, '2':1, '3':1, '4':1, '5':1, '6':'1d6' },
  },
  lacm: {
    land:       { '1':0, '2':2, '3':2, '4':2, '5':2, '6':'1d6' },
  },
  asbmSurface: {
    surface:    { '1':0, '2':0, '3':2, '4':2, '5':2, '6':'1d6' },
  },
  // navalGun intentionally omitted → preserved as-is in the target file
  airDefense: {
    air:        { '1':0, '2':1, '3':1, '4':1, '5':1, '6':1 },
    missile:    { '1':0, '2':1, '3':1, '4':1, '5':1, '6':1 },
  },
  bmd: {
    air:        { '1':0, '2':0, '3':0, '4':1, '5':1, '6':1 },
    missile:    { '1':0, '2':0, '3':0, '4':1, '5':1, '6':1 },
  },
  asw: {
    submarine:  { '1':0, '2':0, '3':1, '4':1, '5':1, '6':'1d6' },
  },
  airAttack: {
    surface:    { '1':0, '2':0, '3':2, '4':2, '5':2, '6':'1d6' },
    air:        { '1':0, '2':0, '3':1, '4':1, '5':1, '6':'1d6' },
    land:       { '1':0, '2':0, '3':1, '4':1, '5':1, '6':'1d6' },
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Format a single d6 row as a JS literal (single-line, quoted keys). */
function fmtRow(obj) {
  const pairs = Object.entries(obj)
    .map(([k, v]) => `'${k}':${typeof v === 'string' ? `'${v}'` : v}`)
    .join(', ');
  return `{ ${pairs} }`;
}

/**
 * Build the replacement text for one profile block.
 * indent = whitespace prefix of the profile key line.
 */
function fmtProfileBlock(profile, targets, indent) {
  const inner = Object.entries(targets)
    .map(([cat, row]) => `${indent}  ${cat}:${' '.repeat(Math.max(1, 12 - cat.length))}${fmtRow(row)},`)
    .join('\n');
  return `${profile}: {\n${inner}\n${indent}}`;
}

/**
 * Locate a JS property block `propName: { ... }` in `content`.
 * Only searches between `searchFrom` and `searchTo` (inclusive) for the
 * property key; the block body may extend further.
 *
 * Returns { keyStart, braceStart, braceEnd } or null.
 *   keyStart  = index of the first char of `propName`
 *   braceStart= index of the opening `{`
 *   braceEnd  = index of the matching closing `}`
 */
function findBlock(content, propName, searchFrom = 0, searchTo = content.length) {
  const re = new RegExp(`(?<![\\w$])${propName}\\s*:`);
  const slice = content.slice(searchFrom, searchTo);
  const m = re.exec(slice);
  if (!m) return null;

  const keyStart   = searchFrom + m.index;
  const afterColon = searchFrom + m.index + m[0].length;

  let braceStart = -1;
  for (let i = afterColon; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') { braceStart = i; break; }
    if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') break;
  }
  if (braceStart === -1) return null;

  let depth = 0;
  let inStr = false;
  let strCh = '';

  for (let i = braceStart; i < content.length; i++) {
    const ch = content[i];
    if (inStr) {
      if (ch === strCh && content[i - 1] !== '\\') inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = true; strCh = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { keyStart, braceStart, braceEnd: i };
    }
  }
  return null;
}

/** Detect the whitespace indentation before position `pos` on its line. */
function detectIndent(content, pos) {
  let lineStart = pos;
  while (lineStart > 0 && content[lineStart - 1] !== '\n') lineStart--;
  let indent = '';
  for (let i = lineStart; i < pos; i++) {
    if (content[i] === ' ' || content[i] === '\t') indent += content[i];
    else break;
  }
  return indent;
}

// ─── Core replacement logic ─────────────────────────────────────────────────

/**
 * Given a JS source string, applies the calibration profile-by-profile.
 * Profiles NOT in CALIBRATION (e.g. navalGun) are left untouched.
 *
 * Strategy:
 *   1. Locate the damageTables block.
 *   2. If it has blue/red sub-objects, process each team separately.
 *   3. For each (team, profile), locate the profile block within the
 *      appropriate search range.
 *   4. Collect all replacement patches (keyed by absolute position).
 *   5. Apply patches from last-to-first so offsets stay valid.
 */
function applyCalibration(content) {
  const dtBlock = findBlock(content, 'damageTables');
  if (!dtBlock) {
    return {
      newContent: content,
      method:     'none',
      message:    'damageTables not found — no changes made.',
      log:        [],
    };
  }

  const dtText  = content.slice(dtBlock.braceStart, dtBlock.braceEnd + 1);
  const hasTeams = /\bblue\s*:/.test(dtText) || /\bred\s*:/.test(dtText);
  const teams   = hasTeams ? ['blue', 'red'] : [null];

  const patches = [];  // { start, end, replacement, label }
  const log     = [];

  for (const team of teams) {
    // Determine the search range for profiles
    let rangeStart, rangeEnd;

    if (team) {
      const teamB = findBlock(content, team, dtBlock.braceStart, dtBlock.braceEnd);
      if (!teamB || teamB.braceStart > dtBlock.braceEnd) {
        log.push(`  SKIP team '${team}' — not found in damageTables`);
        continue;
      }
      rangeStart = teamB.braceStart;
      rangeEnd   = teamB.braceEnd;
    } else {
      rangeStart = dtBlock.braceStart;
      rangeEnd   = dtBlock.braceEnd;
    }

    for (const [profile, targets] of Object.entries(CALIBRATION)) {
      const profB = findBlock(content, profile, rangeStart, rangeEnd);
      if (!profB || profB.braceEnd > rangeEnd) {
        log.push(`  SKIP ${team ? team + '.' : ''}${profile} — not found`);
        continue;
      }

      const indent      = detectIndent(content, profB.keyStart);
      const replacement = fmtProfileBlock(profile, targets, indent);
      const label       = `${team ? team + '.' : ''}${profile}`;

      // Avoid duplicate patches (same position patched by blue & red loop)
      if (!patches.some(p => p.start === profB.keyStart)) {
        patches.push({
          start:       profB.keyStart,
          end:         profB.braceEnd + 1,
          replacement,
          label,
        });
      }
    }
  }

  if (patches.length === 0) {
    return {
      newContent: content,
      method:     'none',
      message:    'No known profiles found in damageTables — no changes made.',
      log,
    };
  }

  // Apply patches from last to first so earlier offsets remain valid
  patches.sort((a, b) => b.start - a.start);

  let result = content;
  for (const p of patches) {
    result = result.slice(0, p.start) + p.replacement + result.slice(p.end);
    log.push(`  OK  ${p.label}`);
  }

  return {
    newContent: result,
    method:     'targeted',
    message:    `${patches.length} profile(s) updated; navalGun and unknowns preserved.`,
    log,
  };
}

// ─── File discovery ─────────────────────────────────────────────────────────

const CANDIDATE_NAMES = [
  'combat_config.js',
  path.join('shared', 'combat_config.js'),
  path.join('js',     'combat_config.js'),
  path.join('src',    'combat_config.js'),
  'combat.js',
  path.join('shared', 'combat.js'),
  path.join('js',     'combat.js'),
  path.join('src',    'combat.js'),
  path.join('config', 'combat.js'),
];

function findConfigFile(dir) {
  for (const rel of CANDIDATE_NAMES) {
    const full = path.join(dir, rel);
    if (fs.existsSync(full)) return full;
  }

  function walk(d, depth) {
    if (depth > 4) return null;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch (_) { return null; }

    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) {
        const found = walk(full, depth + 1);
        if (found) return found;
      } else if (e.name.endsWith('.js')) {
        try {
          if (fs.readFileSync(full, 'utf8').includes('damageTables')) return full;
        } catch (_) { /* skip */ }
      }
    }
    return null;
  }

  return walk(dir, 0);
}

// ─── Entry point ────────────────────────────────────────────────────────────

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node apply-calibration.js <directory-or-file>');
    process.exit(1);
  }

  const resolved = path.resolve(arg);
  const stat = fs.statSync(resolved, { throwIfNoEntry: false });
  if (!stat) {
    console.error(`Path not found: ${resolved}`);
    process.exit(1);
  }

  let filePath;
  if (stat.isDirectory()) {
    filePath = findConfigFile(resolved);
    if (!filePath) {
      console.error(
        `No combat config file with damageTables found under:\n  ${resolved}\n` +
        `Searched: ${CANDIDATE_NAMES.join(', ')}, then recursively.`
      );
      process.exit(1);
    }
    console.log(`Config file found: ${filePath}`);
  } else {
    filePath = resolved;
  }

  const original = fs.readFileSync(filePath, 'utf8');

  const backupPath = filePath + '.bak';
  fs.writeFileSync(backupPath, original, 'utf8');
  console.log(`Backup written:    ${backupPath}`);

  const { newContent, method, message, log } = applyCalibration(original);

  if (method === 'none') {
    fs.unlinkSync(backupPath);
    console.error(`\n${message}`);
    process.exit(1);
  }

  fs.writeFileSync(filePath, newContent, 'utf8');
  console.log(`\nResult: ${message}`);
  log.forEach(l => console.log(l));

  // Syntax check via require()
  try {
    delete require.cache[require.resolve(filePath)];
    require(filePath);
    console.log('\nSyntax check: OK');
  } catch (e) {
    console.error(`\nWARNING: syntax check failed — ${e.message}`);
    console.error(`Restore with:\n  cp "${backupPath}" "${filePath}"`);
    process.exit(1);
  }

  console.log(`\nDone. Review changes with:\n  diff "${backupPath}" "${filePath}"`);
}

main();
