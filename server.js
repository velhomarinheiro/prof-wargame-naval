'use strict';
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const { ORDER_OF_BATTLE }  = require('./shared/order_of_battle');
const { COMBAT_CONFIG }    = require('./shared/combat_config');
const { resolveEngagement, getWeaponQuantity, getWeaponRange } = require('./shared/combat_engine');
const {
  initializeFuel, isFuelDisabled,
  canMove, canAttack, canDefend,
  navalMoveCost, spendNavalFuel, spendAirFuel,
  spendEngagementFuel, spendDamageFuel,
  markRefuelEligibility, recoverNavalFuel,
  checkNavalFuelZero, checkAirFuelLosses,
  recoverAircraft, resetFuelTurnCounters,
} = require('./fuel_model');

const PORT   = process.env.PORT || 3000;
const GRID_W = 16;
const GRID_H = 10;

// ─── Terrain (mirror of public/js/terrain.js) ────────────────────────────────
const T_LAND = 0, T_SHALLOW = 1, T_SHELF = 2, T_DEEP = 3, T_OIL = 4;
const TERRAIN_MAP = [
  [0,0,0,0,0,0,1,2,3,3,3,3,3,3,3,3],
  [0,0,0,0,0,1,1,2,3,3,3,3,3,3,3,3],
  [0,0,0,0,1,1,2,4,3,3,3,3,3,3,3,3],
  [0,0,0,1,1,2,4,4,3,3,3,3,3,3,3,3],
  [0,0,1,1,2,4,4,2,3,3,3,3,3,3,3,3],
  [0,1,1,2,4,4,2,3,3,3,3,3,3,3,3,3],
  [1,1,2,4,4,2,3,3,3,3,3,3,3,3,3,3],
  [1,2,2,4,2,2,3,3,3,3,3,3,3,3,3,3],
  [1,2,2,2,2,3,3,3,3,3,3,3,3,3,3,3],
  [1,2,2,2,3,3,3,3,3,3,3,3,3,3,3,3],
];
function getTerrain(col, row) {
  if (row < 0 || row >= GRID_H || col < 0 || col >= GRID_W) return T_LAND;
  return TERRAIN_MAP[row][col];
}
function canEnterTerrain(category, terrain) {
  if (category === 'air')       return true;
  if (category === 'land')      return terrain === T_LAND || terrain === T_SHALLOW;
  if (category === 'submarine') return terrain !== T_LAND && terrain !== T_SHALLOW;
  return terrain !== T_LAND; // surface
}

// ─── Display type: primary composition type → counter icon type ───────────────
const COMP_DISPLAY_TYPE = {
  'navio_aeródromo':       'carrier',
  'navio_doca':            'amphib',
  'navio_desembarque':     'amphib',
  'fragata':               'fragata',
  'corveta':               'corveta',
  'destroier':             'destroier',
  'destroyer':             'destroier',
  'cruzador':              'cruzador',
  'navio_patoc':           'patrulha_oc',
  'navio_patrulha':        'patrulha_c',
  'navio_logistico':       'logistico',
  'navio_tanque':          'tanque',
  'submarino_nuclear':     'sub_nuclear',
  'submarino_convencional':'submarino',
  'patrulha_maritima':     'patrulha',
  'caca':                  'caca',
  'ataque':                'ataque',
  'aew':                   'aew',
  'helicoptero_ASW':       'helicoptero',
  'helicoptero_ASup':      'helicoptero',
  'bateria_costeira':      'bateria_costeira',
  'bateria_ada':           'bateria_ada',
  'base_naval':            'bateria_ada',
  'plataforma':            'fpso',
  'porto':                 'porto',
  'aeroporto':             'aeroporto',
};
const DISPLAY_TYPE_FALLBACK = { surface: 'fragata', submarine: 'submarino', air: 'patrulha', land: 'corveta' };

// ─── Range helper ─────────────────────────────────────────────────────────────
function rangeAgainst(rangeTable, targetCategory) {
  if (!rangeTable) return 0;
  return Number(rangeTable[targetCategory] || 0);
}

// ─── Hex math (odd-q offset, flat-top) — matches client hex.js ──────────────
function oddqToCube(col, row) {
  const x = col;
  const z = row - (col - (col & 1)) / 2;
  return { x, y: -x - z, z };
}
function cubeToOddq(x, z) { return { col: x, row: z + (x - (x & 1)) / 2 }; }
const CUBE_DIRS = [
  {dx:+1,dy:-1,dz:0},{dx:+1,dy:0,dz:-1},{dx:0,dy:+1,dz:-1},
  {dx:-1,dy:+1,dz:0},{dx:-1,dy:0,dz:+1},{dx:0,dy:-1,dz:+1},
];
function hexNeighbors(col, row) {
  const c = oddqToCube(col, row);
  return CUBE_DIRS.map(d => cubeToOddq(c.x+d.dx, c.z+d.dz))
    .filter(({col:nc,row:nr}) => nc>=0 && nc<GRID_W && nr>=0 && nr<GRID_H);
}
function hexDist(c1,r1,c2,r2) {
  const a=oddqToCube(c1,r1), b=oddqToCube(c2,r2);
  return Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y), Math.abs(a.z-b.z));
}

// ─── Air refuel location check ────────────────────────────────────────────────
// An aircraft may recover fuel when it ends its turn here without moving.
// Blue: any T_LAND hex (land air base) or a friendly carrier unit in the same hex.
// Red:  only a friendly carrier unit in the same hex.
function isAirRefuelLocation(unit, state) {
  return state.units.some(o =>
    o.id !== unit.id &&
    o.team === unit.team &&
    (o.hp ?? 0) > 0 &&
    (o.type === 'aeroporto' || o.type === 'carrier') &&
    o.col === unit.col && o.row === unit.row
  );
}

// ─── Fog of war ──────────────────────────────────────────────────────────────
function saveMovementSnapshot(state) {
  state.movementSnapshot = {};
  for (const u of state.units) {
    state.movementSnapshot[u.id] = { col: u.col, row: u.row };
  }
}

function stateFor(state, team) {
  const night = state.period === 'night';

  // Strip server-internal combat queue fields — clients don't need them
  const { combatQueue: _cq, battleRoundDecisions: _brd, ...stateRest } = state;

  // During movement phase, show enemy units at their pre-movement positions
  // so moves are hidden until both sides commit (simultaneous movement reveal).
  const enemyActual = state.units.filter(u => u.team !== team && u.hp > 0);
  const enemies = (state.phase === 'movement' && state.movementSnapshot)
    ? enemyActual.map(u => {
        const snap = state.movementSnapshot[u.id];
        return snap ? { ...u, col: snap.col, row: snap.row } : u;
      })
    : enemyActual;

  const mine = state.units.filter(u => u.team === team && u.hp > 0);

  // Detection during movement uses pre-movement positions for both sides so the
  // first player to commit cannot see enemies they only approached this turn.
  const mineForDetection = (state.phase === 'movement' && state.movementSnapshot)
    ? mine.map(u => {
        const snap = state.movementSnapshot[u.id];
        return snap ? { ...u, col: snap.col, row: snap.row } : u;
      })
    : mine;

  const detected = enemies.filter(enemy => {
    const stealthy  = !!enemy.stealthy;
    const deepBonus = getTerrain(enemy.col, enemy.row) === T_DEEP ? 1 : 0;
    return mineForDetection.some(f => {
      let range = stealthy
        ? rangeAgainst(f.detectionRange, 'submarine') - deepBonus
        : rangeAgainst(f.detectionRange, enemy.category);
      // Submarines use sonar — unaffected by daylight
      if (night && f.category !== 'submarine') range -= stealthy ? 1 : 2;
      return range >= 1 && hexDist(f.col, f.row, enemy.col, enemy.row) <= range;
    });
  }).map(e => ({ ...e, detected: true }));

  return {
    ...stateRest,
    units:       [...state.units.filter(u => u.team === team), ...detected],
    blueAttacks: team === 'blue' ? state.blueAttacks : (state.blueAttacks !== null ? '✓' : null),
    redAttacks:  team === 'red'  ? state.redAttacks  : (state.redAttacks  !== null ? '✓' : null),
  };
}

// ─── Weapon priority per target category ─────────────────────────────────────
const WEAPON_PRIORITY = {
  surface:   ['ascm', 'asbm', 'mss', 'torpedo', 'airAttack', 'navalGun'],
  submarine: ['asw', 'torpedo'],
  air:       ['airDefense', 'airAttack'],
  land:      ['lacm', 'airAttack', 'navalGun'],
};

function selectBestWeapon(attacker, target, dist) {
  const priority = WEAPON_PRIORITY[target.category] || [];
  for (const wpnType of priority) {
    const qty = getWeaponQuantity(attacker, wpnType);
    if (qty <= 0) continue;
    const profile = COMBAT_CONFIG.weaponProfiles?.[wpnType];
    if (!profile) continue;
    if (!profile.targets.includes(target.category)) continue;
    const range = getWeaponRange(attacker, wpnType);
    if (dist <= range) return wpnType;
  }
  return null;
}

// ─── Unit factory ─────────────────────────────────────────────────────────────
function makeUnit(team, spec) {
  const pos     = spec.position || spec.start || { col: 0, row: 0 };
  const weapons = spec.weapons ? JSON.parse(JSON.stringify(spec.weapons)) : {};
  const unit = {
    id:            spec.id,
    team,
    name:          spec.name,
    category:      spec.category,
    type:          (spec.composition && spec.composition[0] && COMP_DISPLAY_TYPE[spec.composition[0].type]) || DISPLAY_TYPE_FALLBACK[spec.category] || 'fragata',
    composition:   spec.composition || [],
    movement:      spec.movement,
    detectionRange: spec.detectionRange,
    attackRange:   spec.attackRange,
    col:           pos.col,
    row:           pos.row,
    hp:            spec.stayingPower,
    maxHp:         spec.stayingPower,
    stealthy:      spec.category === 'submarine',
    moved:         false,
    weapons,
    initWeapons:   JSON.parse(JSON.stringify(weapons)),
    capabilities:  spec.capabilities ? { ...spec.capabilities } : {},
  };
  initializeFuel(unit);
  return unit;
}

function initialUnits() {
  const units = [];
  for (const spec of ORDER_OF_BATTLE.forces.blue) {
    units.push(makeUnit('blue', spec));
  }
  for (const spec of ORDER_OF_BATTLE.forces.red) {
    units.push(makeUnit('red', spec));
  }
  return units;
}

function newGame() {
  const state = {
    turn: 1, period: 'day', phase: 'movement',
    blueDone: false, redDone: false,
    blueAttacks: null, redAttacks: null,
    units: initialUnits(),
    log: ['──── Turno 1 · Período Diurno ────', 'Fase de Movimentação iniciada.'],
    winner: null,
    movementSnapshot: {},
    combatQueue: [],
    currentEngagementIndex: 0,
    battleRoundDecisions: { blue: null, red: null },
  };
  saveMovementSnapshot(state);
  markRefuelEligibility(state);
  return state;
}

// ─── Battle-round system ─────────────────────────────────────────────────────
// Default salvo sizes (conservative); client may request a specific amount
const SALVO_SIZE = { ascm: 2, mss: 2, torpedo: 1, lacm: 1, asbm: 1 };

function isSingleRoundWeapon(weaponType) {
  return ['lacm', 'asbm'].includes(weaponType);
}

function buildCombatQueue(state) {
  const all = [...(state.blueAttacks || []), ...(state.redAttacks || [])];
  return all.map((atk, i) => {
    const att = state.units.find(u => u.id === atk.attackerId && u.hp > 0);
    const def = state.units.find(u => u.id === atk.targetId   && u.hp > 0);
    if (!att || !def) return null;
    const dist      = hexDist(att.col, att.row, def.col, def.row);
    const wpnType   = selectBestWeapon(att, def, dist);
    if (!wpnType) return null;
    const profile   = COMBAT_CONFIG.weaponProfiles?.[wpnType];
    const qty       = getWeaponQuantity(att, wpnType);
    // Use client-requested amount if provided, capped at available quantity
    const requested = atk.amount ?? (SALVO_SIZE[wpnType] || 1);
    const amount    = profile?.expendable ? Math.min(qty, Math.max(1, requested)) : 1;
    return {
      id:              `ENG-${String(i + 1).padStart(2, '0')}`,
      attackerId:      atk.attackerId,
      targetId:        atk.targetId,
      weaponType:      wpnType,
      amount,
      battleRound:     1,
      maxBattleRounds: isSingleRoundWeapon(wpnType) ? 1 : 2,
      status:          'pending',
      results:         [],
    };
  }).filter(Boolean);
}

function resolveBattleRound(state, engagement, initiativeBonusTeam = null) {
  const att = state.units.find(u => u.id === engagement.attackerId && u.hp > 0);
  const def = state.units.find(u => u.id === engagement.targetId   && u.hp > 0);
  const brTag = `${engagement.id}·BR${engagement.battleRound}`;

  if (!att || !def) {
    engagement.status = 'ended';
    state.log.unshift(`[${brTag}] Unidade destruída — engajamento encerrado.`);
    return null;
  }

  // Skip attack if attacker is fuel-disabled
  if (!canAttack(att)) {
    state.log.unshift(`⛽ ${att.name} não pode atacar: sem combustível.`);
    return { ok: false, reason: 'Atacante sem combustível' };
  }

  const initLabel = initiativeBonusTeam ? ` ★${initiativeBonusTeam.toUpperCase()}` : '';
  state.log.unshift(`──── ${brTag}${initLabel} ────`);

  const dist = hexDist(att.col, att.row, def.col, def.row);
  const eng  = resolveEngagement({
    attacker: att, defender: def,
    weaponType: engagement.weaponType,
    amount:     engagement.amount,
    distance:   dist,
    initiativeBonusTeam,
    defenderDisabled: isFuelDisabled(def),  // 0-FP naval unit has no interception
  });

  if (!eng.ok) {
    state.log.unshift(`⚠ ${att.name} → ${def.name}: ${eng.reason}`);
  } else {
    // Spend engagement FP for attacker
    spendEngagementFuel(att);

    if (eng.destroyed) {
      state.log.unshift(`💥 ${def.name} DESTRUÍDO por ${att.name} [${eng.weaponLabel}]`);
    } else if (eng.totalDamage > 0) {
      const intStr = eng.interception?.intercepted > 0 ? ` (${eng.interception.intercepted} intercept.)` : '';
      state.log.unshift(`✓ ${att.name} → ${def.name} −${eng.totalDamage}SP [${eng.weaponLabel}${intStr}]`);
      spendDamageFuel(def);    // defender burns extra FP absorbing the hit
    } else {
      const intStr = eng.interception?.intercepted > 0 ? ` (${eng.interception.intercepted} intercept.)` : '';
      state.log.unshift(`✗ ${att.name} → ${def.name} falhou [${eng.weaponLabel}${intStr}]`);
    }
  }

  if (state.log.length > 80) state.log = state.log.slice(0, 80);
  engagement.results.push({ battleRound: engagement.battleRound, initiativeBonusTeam, result: eng });
  return eng;
}

function emitBrResult(room, engagement, result, mustDecide, extra = {}) {
  const payload = { engagement, result, mustDecide, ...extra };
  if (room.players.blue) io.to(room.players.blue).emit('battle_round_result', payload);
  if (room.players.red)  io.to(room.players.red ).emit('battle_round_result', payload);
}

function startCurrentEngagement(room) {
  const state      = room.state;
  const engagement = state.combatQueue[state.currentEngagementIndex];
  engagement.battleRound = 1;

  const result = resolveBattleRound(state, engagement);

  // Immediate resolution: single-round weapon, invalid result, OR target destroyed in BR#1.
  // If destroyed, server must NOT request decisions — client shows OK but never sends
  // battle_round_decision, causing a permanent stall.
  if (!result || !result.ok || engagement.maxBattleRounds === 1 || result.destroyed) {
    emitBrResult(room, engagement, result, false);
    finishCurrentEngagement(room);
    return;
  }

  // Multi-round weapon, target survived: ask both players
  state.battleRoundDecisions = { blue: null, red: null };
  emitBrResult(room, engagement, result, true);
}

function resolveCounterAttack(state, engagement, blue, red) {
  // Original defender fires back at the original attacker in BR#2.
  // Restricted to close-range weapons (no LACM / ASBM strategic strikes).
  const att = state.units.find(u => u.id === engagement.attackerId && u.hp > 0);
  const def = state.units.find(u => u.id === engagement.targetId   && u.hp > 0);
  if (!att || !def) return null;

  const dist       = hexDist(def.col, def.row, att.col, att.row);
  const counterWpn = selectBestWeapon(def, att, dist);
  if (!counterWpn || isSingleRoundWeapon(counterWpn)) return null;

  const profile      = COMBAT_CONFIG.weaponProfiles?.[counterWpn];
  const qty          = getWeaponQuantity(def, counterWpn);
  const counterAmt   = profile?.expendable ? Math.min(qty, SALVO_SIZE[counterWpn] || 1) : 1;

  // Initiative for the counter: if the defending team chose continue and attacker chose stop
  const defDecision  = def.team === 'blue' ? blue : red;
  const attDecision  = att.team === 'blue' ? blue : red;
  const counterInit  = (defDecision === 'continue' && attDecision === 'stop') ? def.team : null;

  const counterEng = {
    id: `${engagement.id}-CTR`,
    attackerId:      def.id,
    targetId:        att.id,
    weaponType:      counterWpn,
    amount:          counterAmt,
    battleRound:     2,
    maxBattleRounds: 2,
    status:          'pending',
    results:         [],
  };

  return resolveBattleRound(state, counterEng, counterInit);
}

function processBattleRoundDecision(room) {
  const state      = room.state;
  const engagement = state.combatQueue[state.currentEngagementIndex];
  const { blue, red } = state.battleRoundDecisions;

  const bothStop   = blue === 'stop' && red === 'stop';
  const maxReached = engagement.battleRound >= engagement.maxBattleRounds;

  if (bothStop || maxReached) {
    emitBrResult(room, engagement, null, false, { decisions: { blue, red } });
    finishCurrentEngagement(room);
    return;
  }

  // BR#2: determine initiative advantage
  let initiativeBonusTeam = null;
  if (blue === 'continue' && red === 'stop')  initiativeBonusTeam = 'blue';
  if (red  === 'continue' && blue === 'stop') initiativeBonusTeam = 'red';

  engagement.battleRound = 2;
  const result        = resolveBattleRound(state, engagement, initiativeBonusTeam);
  const counterResult = resolveCounterAttack(state, engagement, blue, red);

  emitBrResult(room, engagement, result, false,
    { decisions: { blue, red }, initiativeBonusTeam, counterResult });
  finishCurrentEngagement(room);
}

function finishCurrentEngagement(room) {
  const state = room.state;
  state.combatQueue[state.currentEngagementIndex].status = 'ended';
  state.currentEngagementIndex += 1;

  if (state.currentEngagementIndex < state.combatQueue.length) {
    startCurrentEngagement(room);
  } else {
    finishCombatPhase(room);
  }
}

function finishCombatPhase(room) {
  const state = room.state;
  state.log.unshift('── Fase de Combate encerrada. ──');

  state.combatQueue             = [];
  state.currentEngagementIndex  = 0;
  state.battleRoundDecisions    = { blue: null, red: null };

  const winner = checkWinner(state);
  if (winner) {
    state.winner = winner;
    state.log.unshift(`🏆 ${winner === 'blue' ? 'Força Azul' : 'Força Vermelha'} VENCEU!`);
    if (room.players.blue) io.to(room.players.blue).emit('game_over', { winner, state: stateFor(state, 'blue') });
    if (room.players.red)  io.to(room.players.red ).emit('game_over', { winner, state: stateFor(state, 'red')  });
    return;
  }

  nextTurn(state);
  broadcast(room);
}

function checkWinner(state) {
  const hasOffense = u =>
    Object.values(u.attackRange || {}).some(v => v > 0) ||
    Object.values(u.weapons      || {}).some(w => w.quantity > 0) ||
    Object.values(u.capabilities || {}).some(v => v > 0);
  const isCombatant = u => hasOffense(u);
  const b = state.units.some(u => u.team === 'blue' && u.hp > 0 && isCombatant(u));
  const r = state.units.some(u => u.team === 'red'  && u.hp > 0 && isCombatant(u));
  if (!b) return 'red'; if (!r) return 'blue'; return null;
}

function nextTurn(state) {
  // ── Reload check (before moved flags are cleared) ────────────────────────────
  const portHexes = new Set(
    state.units.filter(u => u.team === 'blue' && u.hp > 0 && u.type === 'porto')
               .map(u => `${u.col},${u.row}`)
  );
  for (const u of state.units) {
    if (u.hp <= 0) continue;
    if (!u.initWeapons || Object.keys(u.initWeapons).length === 0) continue;

    const hexKey = `${u.col},${u.row}`;
    let reload = false;

    if (u.team === 'blue') {
      if (u.category === 'land') {
        reload = true;
      } else if (u.category === 'air') {
        reload = u.fuel?.wasAtRefuelLocation === true;
      } else if (!u.moved) {
        if (u.category === 'surface' || u.category === 'submarine') {
          reload = portHexes.has(hexKey);
        }
      }
    } else if (u.team === 'red') {
      if (u.category === 'air') {
        reload = u.fuel?.wasAtRefuelLocation === true;
      }
    }

    if (reload) {
      const restored = [];
      for (const [wpn, init] of Object.entries(u.initWeapons)) {
        const cur = u.weapons[wpn]?.quantity ?? 0;
        if (cur < init.quantity) {
          u.weapons[wpn] = { ...init };
          restored.push(wpn.toUpperCase());
        }
      }
      if (restored.length > 0) {
        state.log.unshift(`🔄 ${u.name} recompletou: ${restored.join(', ')}`);
      }
    }
  }

  // ── Fuel: naval refuel for units stacked all turn with a provider ────────────
  const fuelReports = recoverNavalFuel(state);
  for (const { unit: u } of fuelReports) {
    state.log.unshift(`⛽ ${u.name}(${u.team}) reabasteceu: ${u.fuel.current}/${u.fuel.max} FP.`);
  }

  // ── Fuel: aircraft that landed last turn become ready ─────────────────────
  recoverAircraft(state);

  // ── Advance turn ────────────────────────────────────────────────────────────
  state.units.forEach(u => { u.moved = false; });
  resetFuelTurnCounters(state);

  state.period    = state.period === 'day' ? 'night' : 'day';
  if (state.period === 'day') state.turn++;
  state.phase     = 'movement';
  state.blueDone  = state.redDone = false;
  state.blueAttacks = state.redAttacks = null;
  const per = state.period === 'day' ? 'Diurno' : 'Noturno';
  state.log.unshift(`──── Turno ${state.turn} · Período ${per} ────`);
  state.log.unshift('Fase de Movimentação iniciada.');
  if (state.log.length > 50) state.log = state.log.slice(0, 50);
  saveMovementSnapshot(state);
  markRefuelEligibility(state);   // mark who is stacked at the start of the new turn
}

// ─── Server ───────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/',     (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/game', (_, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));

const rooms = new Map();
function genId() { return Math.random().toString(36).slice(2,8).toUpperCase(); }
function broadcast(room) {
  if (!room.state) return;
  if (room.players.blue) io.to(room.players.blue).emit('game_update', stateFor(room.state,'blue'));
  if (room.players.red)  io.to(room.players.red ).emit('game_update', stateFor(room.state,'red'));
}

io.on('connection', socket => {
  console.log('+ connect', socket.id);

  socket.on('create_room', () => {
    const id = genId();
    rooms.set(id, { id, players:{blue:socket.id,red:null}, state:null });
    socket.data.roomId=id; socket.data.team='blue';
    socket.join(id);
    socket.emit('room_created',{roomId:id,team:'blue'});
  });

  socket.on('join_room', ({roomId}) => {
    const room=rooms.get(roomId?.toUpperCase?.());
    if (!room)           { socket.emit('join_error','Sala não encontrada.'); return; }
    if (room.players.red){ socket.emit('join_error','Sala cheia.');          return; }
    room.players.red=socket.id; socket.data.roomId=room.id; socket.data.team='red';
    socket.join(room.id);
    room.state=newGame();
    io.to(room.players.blue).emit('game_start',{team:'blue',state:stateFor(room.state,'blue')});
    socket.emit('game_start',{team:'red',state:stateFor(room.state,'red')});
  });

  // ── Movement ──────────────────────────────────────────────────────────────
  socket.on('commit_moves', ({moves}) => {
    const room=rooms.get(socket.data.roomId);
    if (!room?.state) return;
    const {state}=room, {team}=socket.data;

    if (state.phase!=='movement')                  { socket.emit('action_error','Não é a fase de movimentação.'); return; }
    if (state[team==='blue'?'blueDone':'redDone']) { socket.emit('action_error','Você já encerrou a movimentação.'); return; }

    // Validate all paths before applying any
    for (const {unitId, path} of (moves||[])) {
      if (!Array.isArray(path)||path.length<2) continue;
      const unit=state.units.find(u=>u.id===unitId&&u.team===team&&u.hp>0);
      if (!unit) { socket.emit('action_error',`Unidade ${unitId} inválida.`); return; }
      if (unit.movement === 0) { socket.emit('action_error',`${unit.name}: unidade fixa.`); return; }
      if (isFuelDisabled(unit)) { socket.emit('action_error',`${unit.name}: sem combustível — não pode se mover.`); return; }
      if (path[0].col!==unit.col||path[0].row!==unit.row) { socket.emit('action_error',`Caminho inválido para ${unit.name}.`); return; }
      if (path.length-1>unit.movement) { socket.emit('action_error',`${unit.name}: caminho excede alcance máximo.`); return; }
      for (let i=1;i<path.length;i++) {
        const {col,row}=path[i];
        if (col<0||col>=GRID_W||row<0||row>=GRID_H) { socket.emit('action_error',`${unit.name}: posição fora do tabuleiro.`); return; }
        if (hexDist(path[i-1].col,path[i-1].row,col,row)!==1) { socket.emit('action_error',`${unit.name}: passo não adjacente.`); return; }
        if (!canEnterTerrain(unit.category,getTerrain(col,row))) { socket.emit('action_error',`${unit.name}: terreno intransponível em ${String.fromCharCode(65+col)}${row+1}.`); return; }
      }
    }

    // Apply all moves and charge movement fuel
    for (const {unitId, path} of (moves||[])) {
      if (!Array.isArray(path)||path.length<2) continue;
      const unit=state.units.find(u=>u.id===unitId&&u.team===team&&u.hp>0);
      if (!unit) continue;
      const dest=path[path.length-1];
      unit.col=dest.col; unit.row=dest.row; unit.moved=true;
      state.log.unshift(`${unit.name}(${team}) → ${String.fromCharCode(65+dest.col)}${dest.row+1}`);
      const dist = path.length - 1;
      if (unit.category !== 'air') {
        spendNavalFuel(unit, navalMoveCost(dist));
      } else {
        // Aircraft that moved: become airborne, spend distance FP
        unit.airStatus = 'airborne';
        spendAirFuel(unit, dist);
        // If they flew to a base, mark for refuel next turn
        if (isAirRefuelLocation(unit, state)) {
          unit.fuel.wasAtRefuelLocation = true;
        }
      }
    }

    // Fuel for stationary units of this team
    for (const u of state.units) {
      if (u.hp <= 0 || u.team !== team || u.moved) continue;
      if (u.category === 'air') {
        if (u.airStatus === 'airborne') {
          if (isAirRefuelLocation(u, state)) {
            u.fuel.wasAtRefuelLocation = true;  // landed — ready next turn
          } else {
            spendAirFuel(u, 1);                 // patrol fuel cost
          }
        }
        // 'ready' aircraft: stay ready, no fuel cost
      } else {
        spendNavalFuel(u, navalMoveCost(0)); // stationary = 1 FP
      }
    }

    if (team==='blue') state.blueDone=true; else state.redDone=true;
    if (state.blueDone&&state.redDone) {
      // ── End-of-movement fuel alerts ────────────────────────────────────────
      const navalEmpty = checkNavalFuelZero(state);
      for (const u of navalEmpty) {
        const pid = room.players[u.team];
        if (pid) io.to(pid).emit('fuel_alert', { unitId: u.id, name: u.name, type: 'naval_empty' });
        state.log.unshift(`⛽ ${u.name}(${u.team}) sem combustível: não pode mover, atacar ou se defender.`);
      }
      const airLost = checkAirFuelLosses(state);
      for (const u of airLost) {
        const pid = room.players[u.team];
        if (pid) io.to(pid).emit('fuel_alert', { unitId: u.id, name: u.name, type: 'air_lost' });
        state.log.unshift(`✈ ${u.name}(${u.team}) perdida por falta de combustível.`);
      }

      state.phase='combat';
      state.log.unshift('Fase de Combate iniciada. Declare seus ataques.');
    } else {
      const waiting=team==='blue'?'Força Vermelha':'Força Azul';
      state.log.unshift(`${team==='blue'?'Força Azul':'Força Vermelha'} encerrou a movimentação. Aguardando ${waiting}...`);
    }
    if (state.log.length>50) state.log=state.log.slice(0,50);
    broadcast(room);
  });

  // ── Combat ────────────────────────────────────────────────────────────────
  socket.on('declare_attacks', attacks => {
    const room=rooms.get(socket.data.roomId);
    if (!room?.state) return;
    const {state}=room, {team}=socket.data;
    if (state.phase!=='combat') { socket.emit('action_error','Não é a fase de combate.'); return; }
    if (team==='blue') state.blueAttacks=attacks||[]; else state.redAttacks=attacks||[];
    state.log.unshift(`${team==='blue'?'Força Azul':'Força Vermelha'} confirmou ${(attacks||[]).length} ataque(s).`);
    if (state.blueAttacks!==null && state.redAttacks!==null) {
      state.log.unshift('── Resolução de Combate ──');
      state.combatQueue            = buildCombatQueue(state);
      state.currentEngagementIndex = 0;
      state.battleRoundDecisions   = { blue: null, red: null };
      broadcast(room); // show "confirmed" status to both before first engagement
      if (state.combatQueue.length === 0) {
        finishCombatPhase(room);
      } else {
        startCurrentEngagement(room);
      }
    } else {
      broadcast(room);
    }
  });

  socket.on('battle_round_decision', ({ decision }) => {
    const room=rooms.get(socket.data.roomId);
    if (!room?.state) return;
    const {state}=room, {team}=socket.data;
    if (state.phase !== 'combat') return;
    state.battleRoundDecisions[team] = decision;
    const { blue, red } = state.battleRoundDecisions;
    if (blue && red) processBattleRoundDecision(room);
  });

  socket.on('restart', () => {
    const room=rooms.get(socket.data.roomId);
    if (!room) return;
    room.state=newGame();
    io.to(room.players.blue).emit('game_start',{team:'blue',state:stateFor(room.state,'blue')});
    io.to(room.players.red ).emit('game_start',{team:'red', state:stateFor(room.state,'red')});
  });

  socket.on('disconnect', () => {
    const {roomId,team}=socket.data; if (!roomId) return;
    const room=rooms.get(roomId); if (!room) return;
    const other=team==='blue'?room.players.red:room.players.blue;
    if (other) io.to(other).emit('opponent_disconnected');
    rooms.delete(roomId);
  });
});

server.listen(PORT, () => console.log(`Servidor em http://localhost:${PORT}`));
