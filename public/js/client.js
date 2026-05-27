'use strict';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const lobbyScreen  = $('lobby-screen');
const gameScreen   = $('game-screen');
const canvas       = $('game-canvas');
const ctx          = canvas.getContext('2d');
const teamBadge    = $('team-badge');
const turnLabel    = $('turn-label');
const periodLabel  = $('period-label');
const phaseLabel   = $('phase-label');
const myTurnBanner = $('my-turn-banner');
const unitPanel    = $('unit-panel');
const endPhaseBtn  = $('end-phase-btn');
const combatBtn    = $('combat-btn');
const undoStepBtn  = $('undo-step-btn');
const cancelBtn    = $('cancel-btn');
const fleetBlue    = $('fleet-blue');
const fleetRed     = $('fleet-red');
const logEl        = $('battle-log');
const gameOver     = $('game-over');
const winnerMsg    = $('winner-msg');
const disconnected = $('disconnected');
const lobbyMenu    = $('lobby-menu');
const lobbyWaiting = $('lobby-waiting');
const lobbyErr     = $('lobby-err');
const roomDisplay  = $('room-display');
const roomInput    = $('room-input');
const btnCreate    = $('btn-create');
const btnJoin      = $('btn-join');
const terrainTip   = $('terrain-tip');
const stackPicker  = $('stack-picker');
const spList       = $('sp-list');
const spGroupBtn   = $('sp-group-btn');

// ─── Canvas setup ─────────────────────────────────────────────────────────────
canvas.width  = CVS_W;
canvas.height = CVS_H;

// ─── Map background image ─────────────────────────────────────────────────────
const mapImg  = new Image();
let   mapReady = false;
mapImg.onload  = () => { mapReady = true;  if (gameState) render(); };
mapImg.onerror = () => { mapReady = false; if (gameState) render(); };
mapImg.src = '/mapa.jpeg';

// ─── Game state ───────────────────────────────────────────────────────────────
let myTeam      = null;
let gameState   = null;
let selUnitId   = null;
let moveHexes   = [];   // valid next-step neighbors for selected unit
let atkHexes    = [];
let pendingAtks = [];
let hoverHex    = null;
let activePath   = [];          // [{col,row},...] path being traced; [0] = unit start
let plannedMoves = new Map();   // unitId → [{col,row},...] committed trajectories
let selGroupIds  = [];          // unit ids acting together as a group (empty = single)

// ─── Socket ───────────────────────────────────────────────────────────────────
const socket = io();

function rangeAgainst(rangeTable, targetCategory) {
  if (!rangeTable) return 0;
  return Number(rangeTable[targetCategory] || 0);
}

socket.on('connect', () => {
  const action = sessionStorage.getItem('pendingAction');
  if (action === 'create') {
    sessionStorage.removeItem('pendingAction');
    socket.emit('create_room');
  } else if (action === 'join') {
    const code = sessionStorage.getItem('pendingCode');
    sessionStorage.removeItem('pendingAction');
    sessionStorage.removeItem('pendingCode');
    if (code) socket.emit('join_room', { roomId: code });
  }
});

socket.on('room_created', ({roomId, team}) => {
  myTeam = team;
  roomDisplay.textContent = roomId;
  lobbyMenu.classList.add('hidden');
  lobbyWaiting.classList.remove('hidden');
});
socket.on('join_error', msg => showLobbyErr(msg));

socket.on('game_start', ({team, state}) => {
  myTeam = team; gameState = state;
  selUnitId = null; selGroupIds = []; moveHexes = []; atkHexes = []; pendingAtks = [];
  activePath = []; plannedMoves.clear(); hideStackPicker();
  closeBrPanel();
  lobbyScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  gameOver.classList.add('hidden');
  updateUI(); render();
});

socket.on('game_update', state => {
  const prevTurn   = gameState?.turn;
  const prevPhase  = gameState?.phase;
  const prevMyDone = myTeam && gameState
    ? (myTeam === 'blue' ? gameState.blueDone : gameState.redDone)
    : false;
  gameState = state;
  const myDoneNow = myTeam === 'blue' ? state.blueDone : state.redDone;
  // Reset on: new turn, combat→movement, or my done flag was reset (new round)
  if (state.turn !== prevTurn
      || (prevPhase === 'combat' && state.phase === 'movement')
      || (state.phase === 'movement' && prevMyDone && !myDoneNow)) {
    activePath = []; plannedMoves.clear(); selGroupIds = [];
    selUnitId = null; moveHexes = []; atkHexes = [];
    hideStackPicker();
    closeBrPanel(); // hide BR panel when new movement phase begins
  } else if (selUnitId) {
    const u = gameState.units.find(u => u.id === selUnitId && u.hp > 0);
    if (u) {
      if (selGroupIds.length > 0) {
        const gUnits = gameState.units.filter(u => selGroupIds.includes(u.id) && u.hp > 0);
        if (gUnits.length > 0) recalcHighlightsGroup(gUnits); else deselect();
      } else {
        recalcHighlights(u);
      }
    } else { deselect(); }
  }
  updateUI(); render();
});

socket.on('game_over', ({winner, state}) => {
  gameState = state; updateUI(); render();
  const mine = winner === myTeam;
  winnerMsg.textContent = mine ? '🏆 VITÓRIA! Sua força prevaleceu.' : '💀 DERROTA. Sua frota foi afundada.';
  winnerMsg.className   = mine ? 'victory' : 'defeat';
  gameOver.classList.remove('hidden');
});
socket.on('opponent_disconnected', () => disconnected.classList.remove('hidden'));
socket.on('action_error', msg => {
  flashError(msg);
  // Reverse optimistic done flag so the button becomes available again
  if (gameState?.phase === 'movement') {
    if (myTeam === 'blue') gameState.blueDone = false; else gameState.redDone = false;
    updateUI();
  }
});
socket.on('battle_round_result', data => handleBrResult(data));
socket.on('fuel_alert', ({ name, type }) => {
  const msg = type === 'air_lost'
    ? `✈ ${name} perdida por falta de combustível!`
    : `⛽ ${name} sem combustível — imóvel e indefesa até reabastecimento.`;
  flashError(msg);
});

// ─── Lobby actions ────────────────────────────────────────────────────────────
btnCreate.addEventListener('click', () => socket.emit('create_room'));
btnJoin.addEventListener('click', () => {
  const code = roomInput.value.trim().toUpperCase();
  if (code) socket.emit('join_room', {roomId: code});
});
roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnJoin.click(); });

// ─── Game actions ─────────────────────────────────────────────────────────────
endPhaseBtn.addEventListener('click', () => {
  if (!isMyTurn()) return;
  // Save active path (individual or group) before submitting
  if (selUnitId !== null && activePath.length > 1) {
    const ids = selGroupIds.length > 0 ? selGroupIds : [selUnitId];
    for (const id of ids) plannedMoves.set(id, [...activePath]);
  }
  const moves = [];
  for (const [unitId, path] of plannedMoves) {
    if (path.length > 1) moves.push({ unitId, path });
  }
  socket.emit('commit_moves', { moves });
  // Optimistically mark done to prevent double-submission; reversed on action_error
  if (myTeam === 'blue') gameState.blueDone = true; else gameState.redDone = true;
  activePath = []; plannedMoves.clear(); selGroupIds = [];
  selUnitId = null; moveHexes = []; atkHexes = [];
  hideStackPicker();
  updateUI(); render();
});

combatBtn.addEventListener('click', () => {
  if (!isMyTurn()) return;
  socket.emit('declare_attacks', pendingAtks);
  pendingAtks = []; deselect();
});

undoStepBtn.addEventListener('click', () => undoStep());

cancelBtn.addEventListener('click', () => { hideStackPicker(); deselect(false); });

$('btn-restart').addEventListener('click', () => { socket.emit('restart'); gameOver.classList.add('hidden'); });
$('br-btn-continue').addEventListener('click', () => sendBrDecision('continue'));
$('br-btn-stop'    ).addEventListener('click', () => sendBrDecision('stop'));
$('br-btn-ok'      ).addEventListener('click', () => onBrOk());
$('btn-back').addEventListener('click', () => location.reload());

// Amount +/- controls in unit panel (event delegation)
$('unit-panel').addEventListener('click', e => {
  const btn = e.target.closest('[data-atk-adj]');
  if (!btn) return;
  const attackerId = btn.dataset.attacker;
  const targetId   = btn.dataset.target;
  const delta      = Number(btn.dataset.atk_adj);
  const atk = pendingAtks.find(a => a.attackerId === attackerId && a.targetId === targetId);
  if (!atk) return;
  const maxAmt = Number(btn.dataset.max) || 4;
  atk.amount = Math.max(1, Math.min(maxAmt, (atk.amount || 1) + delta));
  updateUI(); render();
});

// ─── Canvas input ─────────────────────────────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  const r  = canvas.getBoundingClientRect();
  const sx = canvas.width  / r.width;
  const sy = canvas.height / r.height;
  const h  = pixelToHex((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
  hoverHex = h;
  if (h.col >= 0 && h.col < GRID_W && h.row >= 0 && h.row < GRID_H) {
    const t = TERRAIN_MAP[h.row][h.col];
    const inf = INFRA.filter(i => i.col === h.col && i.row === h.row);
    let tip = `${hexLabel(h.col)}${h.row + 1} · ${T_NAME[t]}`;
    if (inf.length) tip += ' · ' + inf.map(i => i.name).join(', ');
    terrainTip.textContent = tip;
    terrainTip.style.display = 'block';
  } else {
    terrainTip.style.display = 'none';
  }
  render();
});
canvas.addEventListener('mouseleave', () => {
  hoverHex = null;
  terrainTip.style.display = 'none';
  render();
});
canvas.addEventListener('click', e => {
  if (!gameState) return;
  const r  = canvas.getBoundingClientRect();
  const sx = canvas.width  / r.width;
  const sy = canvas.height / r.height;
  const h  = pixelToHex((e.clientX - r.left) * sx, (e.clientY - r.top) * sy);
  handleClick(h.col, h.row);
});

// ─── Click logic ──────────────────────────────────────────────────────────────
function handleClick(col, row) {
  if (!gameState || gameState.winner) return;
  if (col < 0 || col >= GRID_W || row < 0 || row >= GRID_H) return;
  const {phase} = gameState;

  // Dismiss open picker
  if (!stackPicker.classList.contains('hidden')) { hideStackPicker(); return; }

  // ── Combat phase ──
  if (phase === 'combat') {
    if (isMyTurn() && selUnitId !== null) {
      const atk = atkHexes.find(h => h.col === col && h.row === row);
      if (atk) {
        if (selGroupIds.length > 0) {
          // Toggle attacks for all group units that can reach this target
          const allDeclared = selGroupIds.every(id =>
            pendingAtks.some(a => a.attackerId === id && a.targetId === atk.unitId));
          if (allDeclared) {
            pendingAtks = pendingAtks.filter(a =>
              !(selGroupIds.includes(a.attackerId) && a.targetId === atk.unitId));
          } else {
            for (const id of selGroupIds) {
              const gu = gameState.units.find(u => u.id === id && u.hp > 0);
              if (!gu) continue;
              if (rangeAgainst(gu.attackRange, atk.category) >= 1 && hexDist(gu.col, gu.row, atk.col, atk.row) <= rangeAgainst(gu.attackRange, atk.category)
                  && !pendingAtks.some(a => a.attackerId === id && a.targetId === atk.unitId)) {
                pendingAtks.push({attackerId: id, targetId: atk.unitId, amount: 1});
              }
            }
          }
        } else {
          const idx = pendingAtks.findIndex(a => a.attackerId === selUnitId && a.targetId === atk.unitId);
          if (idx >= 0) pendingAtks.splice(idx, 1);
          else pendingAtks.push({attackerId: selUnitId, targetId: atk.unitId, amount: 1});
        }
        updateUI(); render(); return;
      }
    }
    const ownUnits = gameState.units.filter(u => u.col === col && u.row === row && u.hp > 0 && u.team === myTeam);
    if (ownUnits.length > 1) { showStackPicker(col, row, ownUnits); return; }
    if (ownUnits.length === 1) {
      selGroupIds = []; selUnitId = ownUnits[0].id;
      recalcHighlights(ownUnits[0]); updateUI(); render();
    } else { deselect(); }
    return;
  }

  // ── Movement phase ──
  if (phase === 'movement' && isMyTurn()) {
    // Extend current path with a valid next step
    if (selUnitId !== null) {
      const move = moveHexes.find(h => h.col === col && h.row === row);
      if (move) {
        activePath.push({col, row});
        if (selGroupIds.length > 0) {
          const gUnits = gameState.units.filter(u => selGroupIds.includes(u.id) && u.hp > 0);
          recalcHighlightsGroup(gUnits);
        } else {
          const u = gameState.units.find(u => u.id === selUnitId && u.hp > 0);
          if (u) recalcHighlights(u);
        }
        updateUI(); render(); return;
      }
    }
    // Click on own unit(s)
    const ownUnits = gameState.units.filter(u => u.col === col && u.row === row && u.hp > 0 && u.team === myTeam);
    if (ownUnits.length === 0) { deselect(true); return; }
    if (ownUnits.length > 1) { deselect(true); showStackPicker(col, row, ownUnits); return; }
    const unit = ownUnits[0];
    if (selUnitId === unit.id && selGroupIds.length === 0) return; // already selected alone
    deselect(true);
    selUnitId = unit.id; selGroupIds = [];
    const saved = plannedMoves.get(unit.id);
    activePath = saved ? [...saved] : [{col: unit.col, row: unit.row}];
    recalcHighlights(unit); updateUI(); render();
    return;
  }
}

// save=true saves activePath to plannedMoves; save=false discards it
function deselect(save = true) {
  if (selUnitId !== null) {
    const ids = selGroupIds.length > 0 ? selGroupIds : [selUnitId];
    if (save && activePath.length > 1) {
      for (const id of ids) plannedMoves.set(id, [...activePath]);
    } else if (!save) {
      for (const id of ids) plannedMoves.delete(id);
    }
  }
  selUnitId = null; selGroupIds = []; activePath = []; moveHexes = []; atkHexes = [];
  updateUI(); render();
}

function undoStep() {
  if (activePath.length <= 1) return;
  activePath.pop();
  if (selGroupIds.length > 0) {
    const gUnits = gameState?.units.filter(u => selGroupIds.includes(u.id) && u.hp > 0) || [];
    if (gUnits.length > 0) recalcHighlightsGroup(gUnits);
  } else {
    const u = gameState?.units.find(u => u.id === selUnitId && u.hp > 0);
    if (u) recalcHighlights(u);
  }
  updateUI(); render();
}

// ─── Group recalc ─────────────────────────────────────────────────────────────
function recalcHighlightsGroup(units) {
  const {phase} = gameState;
  if (phase === 'movement' && isMyTurn()) {
    const minMov     = Math.min(...units.map(u => u.movement));
    const stepsTaken = activePath.length - 1;
    if (stepsTaken < minMov) {
      const lastHex = activePath[activePath.length - 1];
      const inPath  = new Set(activePath.map(h => `${h.col},${h.row}`));
      moveHexes = hexNeighbors(lastHex.col, lastHex.row).filter(nb => {
        if (inPath.has(`${nb.col},${nb.row}`)) return false;
        return units.every(u => canEnterTerrain(u.category, TERRAIN_MAP[nb.row][nb.col]));
      });
    } else { moveHexes = []; }
  } else { moveHexes = []; }

  if (phase === 'combat' && isMyTurn()) {
    atkHexes = [];
    const enemies = gameState.units.filter(u => u.team !== myTeam && u.hp > 0 && u.detected);
    for (const e of enemies) {
      if (units.some(u => hexDist(u.col, u.row, e.col, e.row) <= rangeAgainst(u.attackRange, e.category))) {
        atkHexes.push({col: e.col, row: e.row, unitId: e.id, category: e.category});
      }
    }
  } else { atkHexes = []; }
}

// ─── Stack picker ─────────────────────────────────────────────────────────────
function showStackPicker(col, row, units) {
  spList.innerHTML = '';
  for (const u of units) {
    const btn = document.createElement('button');
    btn.className = 'sp-unit-btn';
    const c = u.team === 'blue' ? 'var(--blue-l)' : 'var(--red-l)';
    btn.innerHTML = `<span style="color:${c}">${u.name}</span> · ${u.hp}/${u.maxHp}SP`;
    btn.addEventListener('click', () => { hideStackPicker(); _selectUnit(u); });
    spList.appendChild(btn);
  }
  spGroupBtn.onclick = () => { hideStackPicker(); _selectGroup(units); };

  const {x, y} = hexToPixel(col, row);
  const rect  = canvas.getBoundingClientRect();
  const wrap  = canvas.parentElement.getBoundingClientRect();
  const scale = rect.width / canvas.width;
  const sx = rect.left - wrap.left + x * scale;
  const sy = rect.top  - wrap.top  + (y + HEX_R) * scale + 6;
  stackPicker.style.left = `${Math.round(sx - 85)}px`;
  stackPicker.style.top  = `${Math.round(sy)}px`;
  stackPicker.classList.remove('hidden');
}

function hideStackPicker() { stackPicker.classList.add('hidden'); }

function _selectUnit(unit) {
  selGroupIds = [];
  if (gameState.phase === 'movement') {
    deselect(true);
    selUnitId = unit.id;
    const saved = plannedMoves.get(unit.id);
    activePath = saved ? [...saved] : [{col: unit.col, row: unit.row}];
    recalcHighlights(unit);
  } else {
    selUnitId = unit.id; recalcHighlights(unit);
  }
  updateUI(); render();
}

function _selectGroup(units) {
  const ids = units.map(u => u.id);
  if (gameState.phase === 'movement') {
    deselect(true);
    selGroupIds = ids; selUnitId = ids[0];
    for (const id of ids) plannedMoves.delete(id);
    const lead = units[0];
    activePath = [{col: lead.col, row: lead.row}];
    recalcHighlightsGroup(units);
  } else {
    selGroupIds = ids; selUnitId = ids[0];
    recalcHighlightsGroup(units);
  }
  updateUI(); render();
}

function recalcHighlights(unit) {
  const {phase} = gameState;

  if (phase === 'movement' && isMyTurn()) {
    const stepsTaken = activePath.length - 1;
    if (stepsTaken < unit.movement) {
      const lastHex = activePath[activePath.length - 1];
      const inPath  = new Set(activePath.map(h => `${h.col},${h.row}`));
      moveHexes = hexNeighbors(lastHex.col, lastHex.row).filter(nb => {
        if (inPath.has(`${nb.col},${nb.row}`)) return false;
        return canEnterTerrain(unit.category, TERRAIN_MAP[nb.row][nb.col]);
      });
    } else {
      moveHexes = [];
    }
  } else {
    moveHexes = [];
  }

  if (phase === 'combat' && isMyTurn()) {
    atkHexes = [];
    const enemies = gameState.units.filter(u => u.team !== myTeam && u.hp > 0 && u.detected);
    for (const e of enemies) {
      if (hexDist(unit.col, unit.row, e.col, e.row) <= rangeAgainst(unit.attackRange, e.category)) {
        atkHexes.push({col: e.col, row: e.row, unitId: e.id, category: e.category});
      }
    }
  } else {
    atkHexes = [];
  }
}

function isMyTurn() {
  if (!gameState) return false;
  const {phase, blueDone, redDone} = gameState;
  if (phase === 'movement') return myTeam === 'blue' ? !blueDone : !redDone;
  if (phase === 'combat')   return myTeam === 'blue' ? gameState.blueAttacks === null : gameState.redAttacks === null;
  return false;
}

function fuelRow(unit) {
  const f = unit.fuel;
  if (!f || !f.usesFuel) {
    return `<span>Combustível</span><span class="fp-inf">∞</span>`;
  }
  if (unit.category === 'air') {
    const STATUS = { ready: 'Pronta', airborne: 'Em voo', recovering: 'Reabastecendo' };
    const statusLabel = STATUS[unit.airStatus] || unit.airStatus || '—';
    const fpLabel = unit.airStatus === 'ready' || unit.airStatus === 'recovering'
      ? `${f.max} FP` : `${f.current ?? 0}/${f.max} FP`;
    const fpClass = (f.current ?? f.max) <= Math.ceil(f.max * 0.25) ? 'fp-low' : 'fp-ok';
    return `<span>Status</span><span>${statusLabel}</span>
            <span>Combustível</span><span class="${fpClass}">${fpLabel}</span>`;
  }
  // Naval
  const cur = f.current ?? 0;
  const pct = f.max > 0 ? cur / f.max : 0;
  const cls = cur <= 0 ? 'fp-empty' : pct <= 0.25 ? 'fp-low' : 'fp-ok';
  return `<span>Combustível</span><span class="${cls}">${cur}/${f.max} FP</span>`;
}

function buildAtkListHtml(atks) {
  if (!atks.length) return '';
  const items = atks.map(a => {
    const tgt = gameState?.units.find(u => u.id === a.targetId);
    const tgtName = tgt?.name || a.targetId;
    // Max amount: largest weapon quantity on the attacker (server will cap anyway)
    const attUnit = gameState?.units.find(u => u.id === a.attackerId);
    const maxAmt  = attUnit ? Math.max(1, ...Object.values(attUnit.weapons || {}).map(w => w.quantity || 0)) : 4;
    const amt = a.amount || 1;
    return `<div class="atk-entry">
      <span class="atk-target">→ ${tgtName}</span>
      <span class="atk-amt-ctrl">
        <button class="atk-adj-btn" data-atk-adj data-attacker="${a.attackerId}" data-target="${a.targetId}" data-atk_adj="-1" data-max="${maxAmt}">−</button>
        <span class="atk-amt-val">${amt}</span>
        <button class="atk-adj-btn" data-atk-adj data-attacker="${a.attackerId}" data-target="${a.targetId}" data-atk_adj="1" data-max="${maxAmt}">+</button>
      </span>
    </div>`;
  }).join('');
  return `<div class="atk-list"><div class="atk-list-title">Ataques declarados:</div>${items}</div>`;
}

// ─── UI update ────────────────────────────────────────────────────────────────
function updateUI() {
  if (!gameState) return;
  const {turn, period, phase, units, log, winner} = gameState;

  teamBadge.textContent  = myTeam === 'blue' ? 'FORÇA AZUL' : 'FORÇA VERMELHA';
  teamBadge.className    = `team-badge ${myTeam}`;
  turnLabel.textContent  = `Turno ${turn}`;
  periodLabel.textContent= period === 'day' ? '☀ Diurno' : '🌙 Noturno';
  phaseLabel.textContent = phase === 'movement' ? 'Movimentação' : 'Combate';

  myTurnBanner.classList.toggle('visible', isMyTurn() && !winner);

  endPhaseBtn.classList.add('hidden');
  combatBtn.classList.add('hidden');
  undoStepBtn.classList.add('hidden');
  cancelBtn.classList.toggle('hidden', selUnitId === null);

  if (isMyTurn() && !winner) {
    if (phase === 'movement') {
      endPhaseBtn.classList.remove('hidden');
      const n = plannedMoves.size + (selUnitId !== null && activePath.length > 1 && !plannedMoves.has(selUnitId) ? 1 : 0);
      endPhaseBtn.textContent = n > 0 ? `Encerrar Movimentação (${n})` : 'Encerrar Movimentação';
      if (selUnitId !== null && activePath.length > 1) {
        undoStepBtn.classList.remove('hidden');
      }
    }
    if (phase === 'combat') combatBtn.classList.remove('hidden');
  }
  combatBtn.textContent = `Confirmar Ataques (${pendingAtks.length})`;

  const b = units.filter(u => u.team === 'blue' && u.hp > 0).length;
  const r = units.filter(u => u.team === 'red'  && u.hp > 0).length;
  fleetBlue.textContent = `Azul: ${b}`;
  fleetRed.textContent  = `Verm: ${r}`;

  const sel = selUnitId ? gameState.units.find(u => u.id === selUnitId && u.hp > 0) : null;
  if (sel) {
    const hpPct = sel.hp / sel.maxHp * 100;
    const bar   = hpPct > 60 ? '#69f0ae' : hpPct > 30 ? '#ffca28' : '#ff5252';
    const t     = sel.col >= 0 ? TERRAIN_MAP[sel.row][sel.col] : 3;
    const pathSteps    = activePath.length - 1;
    const pathStepsMov = selGroupIds.length > 0
      ? Math.min(...selGroupIds.map(id => { const u2 = gameState.units.find(u => u.id === id); return u2 ? u2.movement : 99; }))
      : sel.movement;
    const pathHint  = pathSteps > 0
      ? `<div class="u-hint">Caminho: ${pathSteps}/${pathStepsMov} passo(s)</div>` : '';
    const groupHint = selGroupIds.length > 1
      ? `<div class="u-hint">Grupo: ${selGroupIds.length} unidades em conjunto</div>` : '';
    const myAtks = selGroupIds.length > 0
      ? pendingAtks.filter(a => selGroupIds.includes(a.attackerId))
      : pendingAtks.filter(a => a.attackerId === sel.id);
    const det  = sel.detectionRange || {};
    const comp = (sel.composition||[]).map(c=>`${c.quantity}× ${c.type}`).join(' · ');

    // Weapons inventory
    const wpns = sel.weapons || {};
    const initW = sel.initWeapons || {};
    const wpnLines = Object.entries(wpns)
      .filter(([, w]) => w.quantity > 0 || (initW[w]?.quantity ?? 0) > 0)
      .map(([k, w]) => `${k.toUpperCase()}: <b>${w.quantity}</b>/${initW[k]?.quantity ?? w.quantity}`);

    // Persistent capabilities
    const caps = sel.capabilities || {};
    const capLines = Object.entries(caps)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${k.toUpperCase()}: ${v}`);

    unitPanel.innerHTML = `
      <div class="u-name ${sel.team}">${sel.name}</div>
      <div class="hp-bar"><div class="hp-fill" style="width:${hpPct}%;background:${bar}"></div></div>
      <div class="u-stats">
        <span>SP</span><span>${sel.hp}/${sel.maxHp}</span>
        <span>MOV</span><span>${sel.movement}</span>
        <span>Categoria</span><span>${sel.category}</span>
        ${fuelRow(sel)}
        <span>Det S/Aé/Sb/T</span><span>${det.surface||0}/${det.air||0}/${det.submarine||0}/${det.land||0}</span>
        <span>Terreno</span><span style="font-size:0.7em">${T_NAME[t]}</span>
      </div>
      ${wpnLines.length ? `<div class="u-hint" style="font-size:0.67rem;line-height:1.7">🚀 ${wpnLines.join(' · ')}</div>` : ''}
      ${capLines.length ? `<div class="u-hint" style="color:var(--text-dim);font-size:0.67rem;line-height:1.7">⚙ ${capLines.join(' · ')}</div>` : ''}
      ${comp ? `<div class="u-hint" style="color:var(--dim);font-size:0.67rem;line-height:1.5">${comp}</div>` : ''}
      ${groupHint}
      ${pathHint}
      ${atkHexes.length ? '<div class="u-hint">Clique em alvos vermelhos p/ declarar ataque</div>' : ''}
      ${myAtks.length ? buildAtkListHtml(myAtks) : ''}
    `;
  } else {
    unitPanel.innerHTML = '<p class="no-sel">Clique em uma unidade sua</p>';
  }
  logEl.innerHTML = (log||[]).map(l=>`<p>${l}</p>`).join('');
}

// ═══ RENDERING ════════════════════════════════════════════════════════════════
function render() {
  if (!gameState) return;
  ctx.clearRect(0, 0, CVS_W, CVS_H);
  drawBackground();
  drawHighlights();
  drawGrid();
  drawInfrastructure();
  drawUnits();
  drawCoordLabels();
  if (hoverHex) drawHover();
}

// ── Layer 1: Background ───────────────────────────────────────────────────────
function drawBackground() {
  if (mapReady) {
    ctx.drawImage(mapImg, 0, 0, CVS_W, CVS_H);
  } else {
    const g = ctx.createLinearGradient(0, 0, CVS_W, CVS_H);
    g.addColorStop(0.0, '#0d2a45');
    g.addColorStop(0.2, '#0a2238');
    g.addColorStop(1.0, '#071520');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CVS_W, CVS_H);
  }
}

// ── Layer 2: Terrain colored hexes (disabled — map image provides art) ────────
function drawTerrainLayer() {
  for (let r = 0; r < GRID_H; r++) {
    for (let c = 0; c < GRID_W; c++) {
      const t = TERRAIN_MAP[r][c];
      const {x, y} = hexToPixel(c, r);
      const fill = mapReady ? T_COLOR_OVERLAY[t] : T_COLOR_SOLID[t];
      drawHex(ctx, x, y, null, 'rgba(255,255,255,0.55)', 1.4);
    }
  }
}

// ── Layer 3: Highlights ───────────────────────────────────────────────────────
function drawHighlights() {
  // Other units' planned paths (blue tint)
  for (const [unitId, path] of plannedMoves) {
    if (unitId === selUnitId) continue;
    drawPathTrail(path,
      'rgba(100,180,255,0.18)', 'rgba(100,180,255,0.55)',
      'rgba(100,180,255,0.35)', 'rgba(100,180,255,0.85)');
  }
  // Active path (yellow)
  if (selUnitId !== null && activePath.length > 1) {
    drawPathTrail(activePath,
      'rgba(255,220,0,0.20)', 'rgba(255,220,0,0.65)',
      'rgba(255,220,0,0.40)', 'rgba(255,220,0,0.95)');
  }
  // Valid next steps (green)
  for (const h of moveHexes) {
    const {x, y} = hexToPixel(h.col, h.row);
    drawHex(ctx, x, y, 'rgba(0,230,118,0.22)', 'rgba(0,230,118,0.70)', 1.8);
  }
  // Attack hexes (red)
  for (const h of atkHexes) {
    const {x, y} = hexToPixel(h.col, h.row);
    const declared = pendingAtks.some(a => a.targetId === h.unitId);
    drawHex(ctx, x, y,
      declared ? 'rgba(255,60,60,0.50)'  : 'rgba(255,60,60,0.22)',
      declared ? 'rgba(255,120,120,1.0)' : 'rgba(255,80,80,0.75)', 2.0);
  }
}

// Draw a step-numbered path trail (skips index 0 = starting hex)
function drawPathTrail(path, fillMid, strokeMid, fillLast, strokeLast) {
  for (let i = 1; i < path.length; i++) {
    const {col, row} = path[i];
    const {x, y}     = hexToPixel(col, row);
    const isLast     = i === path.length - 1;
    drawHex(ctx, x, y,
      isLast ? fillLast  : fillMid,
      isLast ? strokeLast : strokeMid,
      isLast ? 2.2 : 1.6);
    ctx.save();
    ctx.fillStyle    = 'rgba(255,255,255,0.92)';
    ctx.font         = `bold ${Math.round(HEX_R * 0.30)}px sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur   = 3;
    ctx.fillText(String(i), x, y);
    ctx.restore();
  }
}

// ── Layer 4: Hex grid ─────────────────────────────────────────────────────────
function drawGrid() {
  for (let r = 0; r < GRID_H; r++) {
    for (let c = 0; c < GRID_W; c++) {
      const t = TERRAIN_MAP[r][c];
      const {x, y} = hexToPixel(c, r);
      drawHex(ctx, x, y, null, T_BORDER[t], 0.8);
    }
  }
}

// ── Layer 5: Infrastructure ───────────────────────────────────────────────────
const INFRA_COLORS = { naval:'#82b1ff', port:'#80cbc4', aero:'#b0bec5', oil:'#ffcc02' };

function drawInfrastructure() {
  for (const inf of INFRA) {
    const {x, y} = hexToPixel(inf.col, inf.row);
    const col = INFRA_COLORS[inf.type] || '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur  = 4;
    ctx.fillStyle   = col;
    ctx.font        = `bold ${Math.round(HEX_R * 0.38)}px sans-serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.fillText(inf.label, x, y - HEX_R * 0.1);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = 'rgba(255,255,200,0.7)';
    ctx.font        = `${Math.round(HEX_R * 0.2)}px 'Courier New', monospace`;
    ctx.fillText(inf.name, x, y + HEX_R * 0.38);
  }
}

// ── Layer 6: Units ────────────────────────────────────────────────────────────
function drawUnits() {
  if (!gameState) return;

  // Ghost units at planned destinations (semi-transparent)
  for (const [unitId, path] of plannedMoves) {
    if (path.length <= 1) continue;
    const unit = gameState.units.find(u => u.id === unitId && u.hp > 0);
    if (!unit) continue;
    const dest = path[path.length - 1];
    const {x, y} = hexToPixel(dest.col, dest.row);
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(x, y, HEX_R * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    drawUnitCounter(ctx, unit, x, y, false);
    ctx.restore();
  }
  // Ghost for the currently-being-traced path (if not yet saved)
  if (selUnitId !== null && activePath.length > 1) {
    const unit = gameState.units.find(u => u.id === selUnitId && u.hp > 0);
    if (unit) {
      const dest = activePath[activePath.length - 1];
      const {x, y} = hexToPixel(dest.col, dest.row);
      ctx.save();
      ctx.globalAlpha = 0.40;
      ctx.beginPath();
      ctx.arc(x, y, HEX_R * 0.58, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fill();
      drawUnitCounter(ctx, unit, x, y, false);
      ctx.restore();
    }
  }

  // Actual units at current (server-confirmed) positions
  for (const u of gameState.units) {
    if (u.hp <= 0) continue;
    const {x, y} = hexToPixel(u.col, u.row);
    ctx.beginPath();
    ctx.arc(x, y, HEX_R * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    const isSelected = u.id === selUnitId || selGroupIds.includes(u.id);
    drawUnitCounter(ctx, u, x, y, isSelected);
  }

  // Stack count badges (shown on hexes with 2+ alive units)
  const hexStacks = {};
  for (const u of gameState.units) {
    if (u.hp <= 0) continue;
    const k = `${u.col},${u.row}`;
    if (!hexStacks[k]) hexStacks[k] = {col: u.col, row: u.row, count: 0};
    hexStacks[k].count++;
  }
  for (const {col, row, count} of Object.values(hexStacks)) {
    if (count < 2) continue;
    const {x, y} = hexToPixel(col, row);
    const r  = HEX_R * 0.22;
    const bx = x + HEX_R * 0.38;
    const by = y - HEX_R * 0.38;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle   = 'rgba(255,200,0,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.fillStyle   = '#000';
    ctx.font        = `bold ${Math.round(r * 1.3)}px sans-serif`;
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.fillText(String(count), bx, by);
  }
}

// ── Layer 7: Coordinate labels ────────────────────────────────────────────────
function drawCoordLabels() {
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur  = 3;
  const fs        = Math.round(HEX_R * 0.27);
  ctx.fillStyle   = 'rgba(200,220,240,0.55)';
  ctx.font        = `${fs}px 'Courier New', monospace`;

  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  for (let c = 0; c < GRID_W; c++) {
    const {x} = hexToPixel(c, 0);
    ctx.fillText(hexLabel(c), x, OY / 2 - 6);
  }
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  for (let r = 0; r < GRID_H; r++) {
    const {y} = hexToPixel(0, r);
    ctx.fillText(r + 1, OX - 6, y);
  }
  ctx.shadowBlur = 0;
}

// ── Layer 8: Hover ────────────────────────────────────────────────────────────
function drawHover() {
  const {col, row} = hoverHex;
  if (col < 0 || col >= GRID_W || row < 0 || row >= GRID_H) return;
  const {x, y} = hexToPixel(col, row);
  drawHex(ctx, x, y, 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.35)', 1.2);
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function flashError(msg) {
  const el = $('error-flash');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(flashError._t);
  flashError._t = setTimeout(() => el.classList.add('hidden'), 3500);
}
function showLobbyErr(msg) {
  lobbyErr.textContent = msg;
  lobbyErr.classList.remove('hidden');
  setTimeout(() => lobbyErr.classList.add('hidden'), 4000);
}

// ─── Battle Round Panel ───────────────────────────────────────────────────────
let brDecisionMade = false;
let brQueue = [];  // buffer for back-to-back mustDecide:false events

function closeBrPanel() {
  $('br-panel').classList.add('hidden');
  brDecisionMade = false;
  brQueue = [];
}

// Advance to next queued result, or close the panel when the queue is empty
function onBrOk() {
  if (brQueue.length > 0) {
    renderBrPanel(brQueue.shift());
  } else {
    closeBrPanel();
  }
}

// Enqueue result; show immediately if panel is hidden or in "waiting" state
function handleBrResult(data) {
  brQueue.push(data);
  const panelHidden = $('br-panel').classList.contains('hidden');
  const isWaiting   = !$('br-waiting').classList.contains('hidden');
  if (panelHidden || isWaiting) {
    renderBrPanel(brQueue.shift());
  }
}

function sendBrDecision(decision) {
  if (brDecisionMade) return;
  brDecisionMade = true;
  socket.emit('battle_round_decision', { decision });
  // Show waiting state while opponent decides
  $('br-decision').classList.add('hidden');
  $('br-waiting').classList.remove('hidden');
  const chosen = decision === 'continue' ? 'Você escolheu CONTINUAR.' : 'Você escolheu PARAR.';
  $('br-panel-body').insertAdjacentHTML('beforeend',
    `<div class="br-row br-decision-made">${chosen}</div>`);
}

function buildResultHtml(eng) {
  if (!eng) return '';
  if (!eng.ok) {
    return `<div class="br-row br-miss">⚠ ${eng.reason || 'Sem armamento válido.'}</div>`;
  }

  const aC = eng.attackerId ? '' : '';  // attacker colour resolved server-side per team
  const intStr = eng.interception?.intercepted > 0
    ? `<span class="br-int"> [${eng.interception.intercepted} intercept.]</span>` : '';
  const wpnTag = eng.weaponLabel ? `<span class="br-wpn">[${eng.weaponLabel}]</span> ` : '';

  const rollsDesc = (eng.attackRolls || []).map(r => {
    if (r.reroll != null) return `d6=${r.roll}→${r.reroll}(${r.damage}SP)`;
    return `d6=${r.roll}(${r.damage}SP)`;
  }).join('  ') || '—';

  const advTag = eng.advantage ? '<span class="br-adv"> ★iniciativa</span>' : '';

  let cls, icon, detail;
  if (eng.destroyed) {
    cls = 'br-destroyed'; icon = '💥';
    detail = `−${eng.totalDamage}SP <strong>DESTRUÍDO!</strong>`;
  } else if (eng.totalDamage > 0) {
    cls = 'br-hit'; icon = '✓';
    detail = `−${eng.totalDamage}SP  (restante: ${eng.remainingHp}SP)`;
  } else {
    cls = 'br-miss'; icon = '✗';
    detail = `sem dano  (restante: ${eng.remainingHp}SP)`;
  }

  return `
    <div class="br-row ${cls}">
      ${icon} ${wpnTag}${advTag}
      <span class="br-launched">Lançados: ${eng.launched}</span>${intStr}
      <span class="br-impacts"> Impactos: ${eng.effectiveShots}</span>
      <div class="br-detail">${detail}</div>
      <div class="br-rolls">${rollsDesc}</div>
    </div>`;
}

function renderBrPanel({ engagement, result, mustDecide, decisions, initiativeBonusTeam, counterResult }) {
  brDecisionMade = false;

  const brLabel = `${engagement.id} · Battle Round ${engagement.battleRound}`;
  const singleRound = engagement.maxBattleRounds === 1;

  $('br-panel-header').textContent = `── ${brLabel} ──`;

  let html = '';

  // Show attacker/target info
  const att = gameState?.units.find(u => u.id === engagement.attackerId);
  const def = gameState?.units.find(u => u.id === engagement.targetId);
  const attName = att?.name || engagement.attackerId;
  const defName = def?.name || engagement.targetId;
  const attCls  = att?.team === 'blue' ? 'cm-blue' : 'cm-red';
  const defCls  = def?.team === 'blue' ? 'cm-blue' : 'cm-red';

  html += `<div class="br-combatants">
    <span class="${attCls}">${attName}</span>
    <span class="br-arrow"> → </span>
    <span class="${defCls}">${defName}</span>
    <span class="br-wpn-tag"> [${engagement.weaponType.toUpperCase()}]</span>
  </div>`;

  if (singleRound) {
    html += `<div class="br-single-label">Arma estratégica — rodada única</div>`;
  }

  if (initiativeBonusTeam) {
    const bonusTeamLabel = initiativeBonusTeam === myTeam ? 'SUA FORÇA' : 'FORÇA ADVERSÁRIA';
    html += `<div class="br-init-bonus">★ Bônus de iniciativa: ${bonusTeamLabel} (2d6, maior valor)</div>`;
  }

  // Result block
  if (result === null && decisions) {
    const blueDecided = decisions.blue === 'stop' ? 'PAROU' : 'CONTINUOU';
    const redDecided  = decisions.red  === 'stop' ? 'PAROU' : 'CONTINUOU';
    html += `<div class="br-row br-decision-summary">
      Azul: ${blueDecided} · Vermelho: ${redDecided} — combate encerrado.
    </div>`;
  } else if (result === null) {
    html += `<div class="br-row br-miss">⚠ Unidade já destruída — engajamento cancelado.</div>`;
  } else {
    html += buildResultHtml(result);
  }

  // Counter-attack block (BR#2 only)
  if (counterResult) {
    const cAtt = gameState?.units.find(u => u.id === counterResult.attackerId);
    const cDef = gameState?.units.find(u => u.id === counterResult.defenderId);
    const cAttName = cAtt?.name || counterResult.attackerId;
    const cDefName = cDef?.name || counterResult.defenderId;
    const cAttCls  = cAtt?.team === 'blue' ? 'cm-blue' : 'cm-red';
    const cDefCls  = cDef?.team === 'blue' ? 'cm-blue' : 'cm-red';

    html += `<div class="br-counter-header">── Contrataque ──</div>`;
    html += `<div class="br-combatants">
      <span class="${cAttCls}">${cAttName}</span>
      <span class="br-arrow"> ↩ </span>
      <span class="${cDefCls}">${cDefName}</span>
      <span class="br-wpn-tag"> [${(counterResult.weaponType || '').toUpperCase()}]</span>
    </div>`;
    if (counterResult.advantage) {
      const cBonusLabel = cAtt?.team === myTeam ? 'SUA FORÇA' : 'FORÇA ADVERSÁRIA';
      html += `<div class="br-init-bonus">★ Bônus de iniciativa: ${cBonusLabel} (2d6, maior valor)</div>`;
    }
    html += buildResultHtml(counterResult);
  }

  $('br-panel-body').innerHTML = html;

  // Decision / OK UI
  const decisionEl = $('br-decision');
  const waitingEl  = $('br-waiting');
  const okAreaEl   = $('br-ok-area');
  decisionEl.classList.add('hidden');
  waitingEl.classList.add('hidden');
  okAreaEl.classList.add('hidden');

  if (mustDecide && !singleRound && !result?.destroyed) {
    decisionEl.classList.remove('hidden');        // show CONTINUAR / PARAR
  } else {
    const label = brQueue.length > 0 ? 'Próximo ▶' : 'OK ✓';
    $('br-btn-ok').textContent = label;
    okAreaEl.classList.remove('hidden');          // show OK / Próximo
  }

  $('br-panel').classList.remove('hidden');
}
