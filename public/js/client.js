'use strict';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const lobbyScreen    = $('lobby-screen');
const configScreen   = $('config-screen');
const gameScreen     = $('game-screen');
const canvas         = $('game-canvas');
const ctx            = canvas.getContext('2d');
const teamBadge      = $('team-badge');
const turnLabel      = $('turn-label');
const periodLabel    = $('period-label');
const phaseLabel     = $('phase-label');
const myTurnBanner   = $('my-turn-banner');
const unitPanel      = $('unit-panel');
const endPhaseBtn    = $('end-phase-btn');
const combatBtn      = $('combat-btn');
const undoStepBtn    = $('undo-step-btn');
const cancelBtn      = $('cancel-btn');
const fleetBlue      = $('fleet-blue');
const fleetRed       = $('fleet-red');
const logEl          = $('battle-log');
const gameOver       = $('game-over');
const winnerMsg      = $('winner-msg');
const disconnected   = $('disconnected');
const roomInput      = $('room-input');
const terrainTip     = $('terrain-tip');
const stackPicker    = $('stack-picker');
const spList         = $('sp-list');
const spGroupBtn     = $('sp-group-btn');
const enemyStackPicker = $('enemy-stack-picker');
const espList          = $('esp-list');
const weaponPicker     = $('weapon-picker');
const wpList           = $('wp-list');

// ─── Canvas setup ─────────────────────────────────────────────────────────────
canvas.width  = CVS_W;
canvas.height = CVS_H;

const mapImg   = new Image();
let   mapReady = false;
mapImg.onload  = () => { mapReady = true;  if (gameState) render(); };
mapImg.onerror = () => { mapReady = false; if (gameState) render(); };
mapImg.src = '/mapa.jpeg';

// ─── Game state ───────────────────────────────────────────────────────────────
let myRole      = null;   // 'blue' | 'red' | 'facilitator'
let gameState   = null;
let selUnitId   = null;
let moveHexes   = [];
let atkHexes    = [];
let pendingAtks = [];
let hoverHex    = null;
let activePath   = [];
let plannedMoves = new Map();
let selGroupIds  = [];

// ─── Guerra Cibernética: estado do jogador ───────────────────────────────────
let cyberQueue        = [];   // { cardId, effectId, targetType, targetId, targetLabel, justification, secret }
let cyberTargetingCard = null; // carta ofensiva aguardando seleção de alvo no mapa
let cyberDefenseActive = new Set(); // ids de cartas defensivas marcadas para ativar

// ─── Zoom / pan state ────────────────────────────────────────────────────────
let zoomLevel = 1.0, panX = 0, panY = 0;
let _dragOrigin = null, _dragging = false;
let _pinch0 = null;
const Z_MIN = 1.0, Z_MAX = 3.5, Z_STEP = 0.2;
// ─── Animation state ─────────────────────────────────────────────────────────
let _unitHits = {}, _animRaf = null, _phaseFlashTimer = null;
// ─── Tooltip state ────────────────────────────────────────────────────────────
let _tooltipTimer = null, _tooltipUnitId = null;

// ─── Socket ───────────────────────────────────────────────────────────────────
const socket = io();

// Client-side weapon profile info (mirrors combat_config.js)
const WEAPON_INFO = {
  ascm:          { targets: ['surface'],               label: 'ASCM',      expendable: true  },
  mss:           { targets: ['surface'],               label: 'MSS',       expendable: true  },
  torpedo:       { targets: ['surface','submarine'],   label: 'TORPEDO',   expendable: true  },
  lacm:          { targets: ['land'],                  label: 'LACM',      expendable: true  },
  asbm:          { targets: ['surface'],               label: 'ASBM',      expendable: true  },
  navalGun:      { targets: ['surface','land'],        label: 'CANHÃO',    expendable: false },
  airDefense:    { targets: ['air'],                   label: 'DEFA',      expendable: false },
  bmd:           { targets: ['air'],                   label: 'BMD',       expendable: false },
  asw:           { targets: ['submarine'],             label: 'ASW',       expendable: false },
  airAttack:     { targets: ['surface','air','land'],  label: 'AT.AÉR',    expendable: false },
  opEspSabotage: { targets: ['surface','land'],        label: 'SABOTAGEM', expendable: false },
};
const WEAPON_RANGE = {
  ascm:10, mss:3, torpedo:2, lacm:10, asbm:10,
  navalGun:1, airDefense:1, bmd:1, asw:2, airAttack:4, opEspSabotage:1,
};
const SALVO_DEFAULTS = { ascm:2, mss:2, torpedo:1, lacm:1, asbm:1 };

function getAvailableWeapons(attacker, targetCategory, dist) {
  const result = [];
  if (!attacker) return result;
  const weapons = attacker.weapons || {};
  const caps    = attacker.capabilities || {};
  // Expendable weapons
  for (const [wpnType, wpnData] of Object.entries(weapons)) {
    if ((wpnData.quantity || 0) <= 0) continue;
    const info = WEAPON_INFO[wpnType];
    if (!info) continue;
    if (!info.targets.includes(targetCategory)) continue;
    const range = wpnData.range || WEAPON_RANGE[wpnType] || 1;
    if (dist > range) continue;
    result.push({ type: wpnType, label: info.label, qty: wpnData.quantity, expendable: true });
  }
  // Non-expendable capabilities
  for (const [capType, capVal] of Object.entries(caps)) {
    if ((capVal || 0) <= 0) continue;
    if (weapons[capType]) continue;
    const info = WEAPON_INFO[capType];
    if (!info) continue;
    if (!info.targets.includes(targetCategory)) continue;
    const range = WEAPON_RANGE[capType] || 1;
    if (dist > range) continue;
    result.push({ type: capType, label: info.label, qty: capVal, expendable: false });
  }
  return result;
}

function rangeAgainst(rangeTable, targetCategory) {
  if (!rangeTable) return 0;
  return Number(rangeTable[targetCategory] || 0);
}

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('connect', () => {
  const action = sessionStorage.getItem('pendingAction');
  if (action === 'create') {
    sessionStorage.removeItem('pendingAction');
    socket.emit('create_room');
  } else if (action === 'join') {
    const code = sessionStorage.getItem('pendingCode');
    const team = sessionStorage.getItem('pendingTeam');
    sessionStorage.removeItem('pendingAction');
    sessionStorage.removeItem('pendingCode');
    sessionStorage.removeItem('pendingTeam');
    if (code && team) socket.emit('join_room', { roomId: code, team });
  }
});

// Facilitador: sala criada
socket.on('room_created', ({ roomId, role, ob }) => {
  myRole = role || 'facilitator';
  if (myRole === 'facilitator') {
    lobbyScreen.classList.add('hidden');
    configScreen.classList.remove('hidden');
    facInit(roomId, ob);
  }
});

// Jogador: entrou com sucesso
socket.on('join_success', ({ role, roomId }) => {
  myRole = role;
  lobbyScreen.classList.add('hidden');
  showWaitingForFacilitator(role);
});

socket.on('join_error', msg => showLobbyErr(msg));

// Facilitador: jogador conectou
socket.on('player_joined', data => {
  facUpdatePlayerStatus(data);
});

// Jogo iniciado
socket.on('game_start', ({ role, state }) => {
  myRole = role;
  gameState = state;
  selUnitId = null; selGroupIds = []; moveHexes = []; atkHexes = []; pendingAtks = [];
  activePath = []; plannedMoves.clear(); hideStackPicker(); hideEnemyStackPicker(); hideWeaponPicker();
  closeBrPanel();
  lobbyScreen.classList.add('hidden');
  configScreen.classList.add('hidden');
  $('waiting-screen').classList.add('hidden');
  gameScreen.classList.remove('hidden');
  gameOver.classList.add('hidden');
  if (myRole === 'facilitator') { setupFacilitatorUI(); facRenderCyberPanel(state); }
  else renderCyberPanel();
  updateUI(); render();
});

socket.on('game_update', state => {
  // Qualquer atualização de estado significa que o jogo progrediu — limpa aviso de desconexão transitório
  if (_graceInterval) { clearInterval(_graceInterval); _graceInterval = null; }
  const notice = $('grace-notice'); if (notice) notice.classList.add('hidden');

  const prevTurn   = gameState?.turn;
  const prevPhase  = gameState?.phase;
  const prevMyDone = myRole && gameState && myRole !== 'facilitator'
    ? (myRole === 'blue' ? gameState.blueDone : gameState.redDone)
    : false;

  // Detect HP decreases for hit animation (compare before updating gameState)
  if (gameState?.units && state.units) {
    for (const newU of state.units) {
      const oldU = gameState.units.find(u => u.id === newU.id);
      if (oldU && newU.hp < oldU.hp) triggerUnitHit(newU.id);
    }
  }

  gameState = state;

  // Phase change flash
  if (prevPhase && prevPhase !== state.phase) {
    const PF = {
      combat:            ['⚔ FASE DE COMBATE',           '#ff8a80'],
      movement:          [`⚡ TURNO ${state.turn} · MOVIMENTAÇÃO`, '#82b1ff'],
      movement_approval: ['✔ MOVIMENTOS CONCLUÍDOS',      '#ffd54f'],
      combat_approval:   ['📋 COMBATE RESOLVIDO',          '#a5d6a7'],
      cyber:             [`🛡 TURNO ${state.turn} · GUERRA CIBERNÉTICA`, '#ce93d8'],
      cyber_approval:    ['🛡 OPERAÇÕES CIBERNÉTICAS DECLARADAS', '#ce93d8'],
    };
    const f = PF[state.phase];
    if (f) showPhaseFlash(f[0], f[1]);
  }

  const myDoneNow = myRole === 'blue' ? state.blueDone : state.redDone;
  const shouldReset = state.turn !== prevTurn
    || (prevPhase === 'combat' && state.phase === 'movement')
    || (state.phase === 'movement' && prevMyDone && !myDoneNow);

  if (shouldReset) {
    activePath = []; plannedMoves.clear(); selGroupIds = [];
    selUnitId = null; moveHexes = []; atkHexes = []; pendingAtks = [];
    hideStackPicker(); closeBrPanel();
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

  // Facilitador: atualiza painéis
  if (myRole === 'facilitator') {
    facUpdatePhaseUI(state.phase);
    facRenderMessages(state.messages || []);
    facRenderUnitManager(state);
    facRenderLog(state);
    facRenderCyberPanel(state);
  }

  // Aprovação de combate: abre painel automaticamente
  if (myRole === 'facilitator' && state.phase === 'combat_approval') {
    facShowCombatApproval(state);
  }

  // Aprovação cibernética: abre painel automaticamente
  if (myRole === 'facilitator' && state.phase === 'cyber_approval') {
    facShowCyberApproval(state);
  }

  // Jogador: atualiza painel de Guerra Cibernética
  if (myRole !== 'facilitator') renderCyberPanel();

  updateUI(); render();
});

// Facilitador: aprovação de movimentos solicitada
socket.on('movement_approval_needed', state => {
  gameState = state;
  if (myRole === 'facilitator') {
    facShowMovementApproval(state);
    facRenderUnitManager(state);
    facRenderLog(state);
  }
  updateUI(); render();
});

// Facilitador: aprovação de combate solicitada
socket.on('combat_approval_needed', state => {
  gameState = state;
  if (myRole === 'facilitator') {
    facShowCombatApproval(state);
    facRenderUnitManager(state);
    facRenderLog(state);
  }
  updateUI(); render();
});

// Facilitador: aprovação de operações cibernéticas solicitada
socket.on('cyber_approval_needed', state => {
  gameState = state;
  if (myRole === 'facilitator') {
    facShowCyberApproval(state);
    facRenderUnitManager(state);
    facRenderLog(state);
    facRenderCyberPanel(state);
  }
  updateUI(); render();
});

socket.on('game_over', ({ winner, state }) => {
  if (state) gameState = state;
  if (gameState) gameState.winner = winner;
  updateUI(); render();
  if (winner === 'draw') {
    winnerMsg.textContent = '🚩 Jogo encerrado pelo Facilitador.';
    winnerMsg.className   = 'victory';
  } else if (myRole !== 'facilitator') {
    const mine = winner === myRole;
    winnerMsg.textContent = mine ? '🏆 VITÓRIA! Sua força prevaleceu.' : '💀 DERROTA. Sua frota foi afundada.';
    winnerMsg.className   = mine ? 'victory' : 'defeat';
  } else {
    winnerMsg.textContent = winner === 'blue' ? '🏆 Força Azul venceu.' : '🏆 Força Vermelha venceu.';
    winnerMsg.className   = 'victory';
  }
  gameOver.classList.remove('hidden');
});

let _graceInterval = null;
socket.on('player_disconnected', ({ role, graceSeconds }) => {
  const label = role === 'blue' ? 'Azul' : role === 'red' ? 'Vermelho' : 'Facilitador';
  const notice = $('grace-notice');
  if (!notice) { flashError(`${label} desconectou.`); return; }

  if (_graceInterval) clearInterval(_graceInterval);
  let remaining = graceSeconds || 75;
  const update = () => {
    notice.textContent = `⚠ ${label} desconectou — aguardando reconexão (${remaining}s)`;
    notice.classList.remove('hidden');
    if (remaining <= 0) { clearInterval(_graceInterval); _graceInterval = null; }
    remaining--;
  };
  update();
  _graceInterval = setInterval(update, 1000);
});
socket.on('player_reconnected', ({ role }) => {
  if (_graceInterval) { clearInterval(_graceInterval); _graceInterval = null; }
  const notice = $('grace-notice');
  if (notice) notice.classList.add('hidden');
  const label = role === 'blue' ? 'Azul' : role === 'red' ? 'Vermelho' : 'Facilitador';
  flashError(`${label} reconectou.`);
});
socket.on('player_timeout', ({ role, msg }) => {
  if (_graceInterval) { clearInterval(_graceInterval); _graceInterval = null; }
  const notice = $('grace-notice');
  if (notice) notice.classList.add('hidden');
  flashError(msg || `${role} atingiu o tempo limite.`);
});
socket.on('opponent_disconnected', () => disconnected.classList.remove('hidden'));

socket.on('action_error', msg => {
  flashError(msg);
  if (gameState?.phase === 'movement' && myRole !== 'facilitator') {
    if (myRole === 'blue') gameState.blueDone = false; else gameState.redDone = false;
    updateUI();
  }
});

socket.on('battle_round_result', data => handleBrResult(data));

// Facilitador: resultado de batalha aguardando aprovação
socket.on('br_result_pending', data => {
  if (myRole !== 'facilitator') return;
  // Force-render the new engagement immediately, discarding any stale queued content
  brQueue = [];
  renderBrPanel(data);
  // Replace OK button with fac approval area
  const okArea  = $('br-ok-area');
  const facArea = $('br-fac-area');
  if (okArea)  okArea.classList.add('hidden');
  if (facArea) {
    facArea.classList.remove('hidden');
    const hpEl = $('br-fac-hp-changes');
    if (hpEl && gameState) {
      const eng  = data.engagement || {};
      const seen = new Set();
      const involved = [eng.attackerId, eng.targetId]
        .filter(Boolean)
        .map(id => gameState.units.find(u => u.id === id && u.hp > 0))
        .filter(u => u && !seen.has(u.id) && seen.add(u.id));
      hpEl.innerHTML = involved.map(u => {
        const tc = u.team === 'blue' ? 'cm-blue' : u.team === 'red' ? 'cm-red' : '';
        return `<div class="fac-hp-row">
          <span class="${tc}">${u.name}</span>
          <input class="fac-hp-input" type="number" min="0" max="${u.maxHp}"
            value="${u.hp}" data-uid="${u.id}" data-maxhp="${u.maxHp}"
            data-currhp="${u.hp}" data-name="${u.name.replace(/"/g,'&quot;')}"
            style="width:46px;margin-left:8px">
          <span style="font-size:0.68rem;color:var(--dim)"> / ${u.maxHp}</span>
        </div>`;
      }).join('');
    }
  }
});

socket.on('fuel_alert', ({ name, type }) => {
  const msg = type === 'air_lost'
    ? `✈ ${name} perdida por falta de combustível!`
    : `⛽ ${name} sem combustível — imóvel e indefesa.`;
  flashError(msg);
});

// Mensagem do facilitador (para jogadores)
socket.on('facilitator_message', msg => {
  if (myRole === 'facilitator') return;
  showPlayerMessage(msg);
});

// Resposta de jogador (para facilitador)
socket.on('player_reply', ({ messageId, reply }) => {
  if (myRole !== 'facilitator') return;
  if (gameState?.messages) {
    const m = gameState.messages.find(m => m.id === messageId);
    if (m) m.replies.push(reply);
    facRenderMessages(gameState.messages);
  }
});

// ─── Lobby ────────────────────────────────────────────────────────────────────
$('btn-create-fac').addEventListener('click', () => socket.emit('create_room'));

$('btn-join-blue').addEventListener('click', () => {
  const code = roomInput.value.trim().toUpperCase();
  if (!code) return;
  socket.emit('join_room', { roomId: code, team: 'blue' });
});

$('btn-join-red').addEventListener('click', () => {
  const code = roomInput.value.trim().toUpperCase();
  if (!code) return;
  socket.emit('join_room', { roomId: code, team: 'red' });
});

roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join-blue').click(); });

function showWaitingForFacilitator(role) {
  const el = $('waiting-screen');
  el.classList.remove('hidden');
  const label = role === 'blue' ? 'FORÇA AZUL' : 'FORÇA VERMELHA';
  const cls   = role === 'blue' ? 'blue' : 'red';
  el.querySelector('.waiting-role').textContent  = label;
  el.querySelector('.waiting-role').className    = `waiting-role ${cls}`;
}

// ─── Jogador: popup de mensagem ───────────────────────────────────────────────
let _currentMsgId = null;

function showPlayerMessage(msg) {
  const overlay = $('player-msg-overlay');
  const textEl  = $('player-msg-text');
  const idEl    = $('player-msg-id');
  if (!overlay) return;
  textEl.textContent = msg.text;
  idEl.dataset.msgid = msg.id;
  _currentMsgId = msg.id;
  overlay.classList.remove('hidden');
}

function playerSendReply() {
  const input = $('player-msg-reply');
  const text  = input?.value?.trim();
  if (!text || !_currentMsgId) return;
  socket.emit('player_reply', { messageId: _currentMsgId, text });
  input.value = '';
  $('player-msg-overlay').classList.add('hidden');
  _currentMsgId = null;
}

function playerDismissMessage() {
  $('player-msg-overlay').classList.add('hidden');
  _currentMsgId = null;
}

// ─── Config: tab switching (delegated from HTML onclick) ──────────────────────
function facSwitchTabWrapper(team) { facSwitchTab(team); }

// ─── Facilitador: setup pós game_start ───────────────────────────────────────
function setupFacilitatorUI() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar) sidebar.classList.add('fac-sidebar');
  $('fac-panels').classList.remove('hidden');
  $('player-panels').classList.add('hidden');
  $('fac-header-btns').classList.remove('hidden');
  facRefreshUnitTypeSelect();
}

// ─── Game actions (players only) ──────────────────────────────────────────────
if (endPhaseBtn) endPhaseBtn.addEventListener('click', () => {
  if (!isMyTurn()) return;
  if (selUnitId !== null && activePath.length > 1) {
    const ids = selGroupIds.length > 0 ? selGroupIds : [selUnitId];
    for (const id of ids) plannedMoves.set(id, [...activePath]);
  }
  const moves = [];
  for (const [unitId, path] of plannedMoves) {
    if (path.length > 1) moves.push({ unitId, path });
  }
  socket.emit('commit_moves', { moves });
  if (myRole === 'blue') gameState.blueDone = true; else gameState.redDone = true;
  activePath = []; plannedMoves.clear(); selGroupIds = [];
  selUnitId = null; moveHexes = []; atkHexes = [];
  hideStackPicker(); updateUI(); render();
});

if (combatBtn) combatBtn.addEventListener('click', () => {
  if (!isMyTurn()) return;
  socket.emit('declare_attacks', pendingAtks);
  pendingAtks = []; deselect();
});

if (undoStepBtn) undoStepBtn.addEventListener('click', () => undoStep());
if (cancelBtn)   cancelBtn.addEventListener('click',   () => { hideStackPicker(); deselect(false); });

$('btn-restart')?.addEventListener('click', () => { socket.emit('restart'); gameOver.classList.add('hidden'); });
$('br-btn-continue')?.addEventListener('click', () => sendBrDecision('continue'));
$('br-btn-stop')?.addEventListener('click',     () => sendBrDecision('stop'));
$('wp-cancel-btn')?.addEventListener('click', () => hideWeaponPicker());
$('br-btn-ok')?.addEventListener('click',       () => onBrOk());
$('btn-back')?.addEventListener('click',        () => location.reload());

$('unit-panel')?.addEventListener('click', e => {
  const adjBtn = e.target.closest('[data-atk-adj]');
  if (adjBtn) {
    const attackerId = adjBtn.dataset.attacker;
    const targetId   = adjBtn.dataset.target;
    const delta      = Number(adjBtn.dataset.atk_adj);
    const atk = pendingAtks.find(a => a.attackerId === attackerId && a.targetId === targetId);
    if (!atk) return;
    const maxAmt = Number(adjBtn.dataset.max) || 4;
    atk.amount = Math.max(1, Math.min(maxAmt, (atk.amount || 1) + delta));
    updateUI(); render(); return;
  }
  const wpnBtn = e.target.closest('[data-atk-wpn]');
  if (wpnBtn) {
    const attackerId = wpnBtn.dataset.attacker;
    const targetId   = wpnBtn.dataset.target;
    const delta      = Number(wpnBtn.dataset.delta);
    const atk = pendingAtks.find(a => a.attackerId === attackerId && a.targetId === targetId);
    if (!atk) return;
    const attUnit = gameState?.units.find(u => u.id === attackerId && u.hp > 0);
    const tgtUnit = gameState?.units.find(u => u.id === targetId && u.hp > 0);
    if (!attUnit || !tgtUnit) return;
    const dist = hexDist(attUnit.col, attUnit.row, tgtUnit.col, tgtUnit.row);
    const avail = getAvailableWeapons(attUnit, tgtUnit.category, dist);
    if (avail.length <= 1) return;
    const curIdx = avail.findIndex(w => w.type === atk.weaponType);
    const nxtIdx = ((curIdx === -1 ? 0 : curIdx) + delta + avail.length) % avail.length;
    atk.weaponType = avail[nxtIdx].type;
    const wpnInfo = WEAPON_INFO[atk.weaponType];
    if (wpnInfo?.expendable) {
      const maxQ = attUnit.weapons?.[atk.weaponType]?.quantity || 1;
      atk.amount = Math.min(atk.amount || 1, maxQ);
    }
    updateUI(); render(); return;
  }
});

// ─── Canvas input ─────────────────────────────────────────────────────────────
// ─── helpers for zoomed coordinate transform ─────────────────────────────────
function _canvasXY(e) {
  const r = canvas.getBoundingClientRect();
  return { cx: (e.clientX - r.left) * (canvas.width / r.width),
           cy: (e.clientY - r.top)  * (canvas.height / r.height) };
}
function _worldHex(cx, cy) {
  return pixelToHex((cx - panX) / zoomLevel, (cy - panY) / zoomLevel);
}

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const {cx, cy} = _canvasXY(e);
  _dragOrigin = { clientX: e.clientX, clientY: e.clientY, panX, panY };
  _dragging = false;
});

canvas.addEventListener('mousemove', e => {
  const {cx, cy} = _canvasXY(e);
  if (_dragOrigin) {
    const r  = canvas.getBoundingClientRect();
    const sx = canvas.width / r.width, sy = canvas.height / r.height;
    const dx = (e.clientX - _dragOrigin.clientX) * sx;
    const dy = (e.clientY - _dragOrigin.clientY) * sy;
    if (!_dragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) _dragging = true;
    if (_dragging) {
      panX = _dragOrigin.panX + dx; panY = _dragOrigin.panY + dy;
      clampPan();
      canvas.style.cursor = 'grabbing';
      hoverHex = _worldHex(cx, cy);
      hideUnitTooltip();
      render(); return;
    }
  }
  canvas.style.cursor = 'crosshair';
  const h = _worldHex(cx, cy);
  hoverHex = h;
  if (h.col >= 0 && h.col < GRID_W && h.row >= 0 && h.row < GRID_H) {
    const t = TERRAIN_MAP[h.row][h.col];
    const inf = INFRA.filter(i => i.col === h.col && i.row === h.row);
    let tip = `${hexLabel(h.col)}${h.row+1} · ${T_NAME[t]}`;
    if (inf.length) tip += ' · ' + inf.map(i => i.name).join(', ');
    terrainTip.textContent = tip;
    terrainTip.style.display = 'block';
  } else { terrainTip.style.display = 'none'; }
  // Unit hover tooltip (appears after 400 ms of stable hover)
  if (gameState) {
    const topUnit = gameState.units.find(u => u.col === h.col && u.row === h.row && u.hp > 0);
    if (topUnit) {
      if (_tooltipUnitId !== topUnit.id) {
        clearTimeout(_tooltipTimer);
        const tel = $('unit-tooltip'); if (tel) tel.classList.add('hidden');
        _tooltipUnitId = topUnit.id;
        _tooltipTimer = setTimeout(() => showUnitTooltip(topUnit, e.clientX, e.clientY), 400);
      }
    } else { hideUnitTooltip(); }
  }
  render();
});

canvas.addEventListener('mouseup', () => { _dragOrigin = null; canvas.style.cursor = 'crosshair'; });

canvas.addEventListener('mouseleave', () => {
  _dragOrigin = null; _dragging = false;
  hoverHex = null; terrainTip.style.display = 'none';
  hideUnitTooltip();
  render();
});

canvas.addEventListener('dblclick', () => { if (!_dragging) resetZoom(); });

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const {cx, cy} = _canvasXY(e);
  zoomTo(zoomLevel + (e.deltaY < 0 ? Z_STEP : -Z_STEP), cx, cy);
}, { passive: false });

canvas.addEventListener('click', e => {
  if (_dragging) { _dragging = false; return; }
  if (!gameState) return;
  const {cx, cy} = _canvasXY(e);
  const {col, row} = _worldHex(cx, cy);
  handleClick(col, row);
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  hideUnitTooltip();
  if (!gameState) return;
  const {cx, cy} = _canvasXY(e);
  const {col, row} = _worldHex(cx, cy);
  const hits = gameState.units.filter(u => u.col === col && u.row === row && u.hp > 0);
  if (!hits.length) { closeUnitDetail(); return; }
  showUnitDetail(hits.find(u => u.id === selUnitId) || hits[0], e.clientX, e.clientY);
});

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeUnitDetail(); });
document.addEventListener('click',   e => {
  const d = $('unit-detail');
  if (d && !d.classList.contains('hidden') && !d.contains(e.target)) closeUnitDetail();
});

// ─── Touch: drag + pinch-to-zoom ─────────────────────────────────────────────
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  if (e.touches.length === 1) {
    const t = e.touches[0];
    _dragOrigin = { clientX: t.clientX, clientY: t.clientY, panX, panY };
    _dragging = false; _pinch0 = null;
  } else if (e.touches.length === 2) {
    _dragOrigin = null;
    const t0 = e.touches[0], t1 = e.touches[1];
    const r = canvas.getBoundingClientRect();
    _pinch0 = { dist: Math.hypot(t1.clientX-t0.clientX, t1.clientY-t0.clientY),
      zoom: zoomLevel, panX, panY,
      mx: ((t0.clientX+t1.clientX)/2 - r.left) * (canvas.width/r.width),
      my: ((t0.clientY+t1.clientY)/2 - r.top)  * (canvas.height/r.height) };
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 1 && _dragOrigin && !_pinch0) {
    const t = e.touches[0];
    const r = canvas.getBoundingClientRect();
    const dx = (t.clientX - _dragOrigin.clientX) * (canvas.width/r.width);
    const dy = (t.clientY - _dragOrigin.clientY) * (canvas.height/r.height);
    if (!_dragging && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) _dragging = true;
    if (_dragging) { panX = _dragOrigin.panX + dx; panY = _dragOrigin.panY + dy; clampPan(); render(); }
  } else if (e.touches.length === 2 && _pinch0) {
    const t0 = e.touches[0], t1 = e.touches[1];
    const dist = Math.hypot(t1.clientX-t0.clientX, t1.clientY-t0.clientY);
    const newZ = Math.max(Z_MIN, Math.min(Z_MAX, _pinch0.zoom * (dist / _pinch0.dist)));
    panX = _pinch0.mx - (_pinch0.mx - _pinch0.panX) * (newZ / _pinch0.zoom);
    panY = _pinch0.my - (_pinch0.my - _pinch0.panY) * (newZ / _pinch0.zoom);
    zoomLevel = newZ; clampPan(); updateZoomLabel(); render();
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  e.preventDefault();
  if (e.touches.length < 2) _pinch0 = null;
  if (e.touches.length === 0) {
    if (!_dragging && _dragOrigin && gameState) {
      const t = e.changedTouches[0];
      const {cx, cy} = { cx: (t.clientX - canvas.getBoundingClientRect().left) * (canvas.width / canvas.getBoundingClientRect().width),
                         cy: (t.clientY - canvas.getBoundingClientRect().top)  * (canvas.height / canvas.getBoundingClientRect().height) };
      const {col, row} = _worldHex(cx, cy);
      handleClick(col, row);
    }
    _dragOrigin = null; _dragging = false;
  }
}, { passive: false });

// ─── Click logic ──────────────────────────────────────────────────────────────
function handleClick(col, row) {
  if (!gameState || gameState.winner) return;
  if (col < 0 || col >= GRID_W || row < 0 || row >= GRID_H) return;

  // Facilitador: reposicionamento de unidade
  if (myRole === 'facilitator') {
    if (facRepoUnitId) {
      socket.emit('facilitator_reposition', { unitId: facRepoUnitId, col, row });
      facRepoUnitId = null;
      showFacNotice(`Unidade movida para ${String.fromCharCode(65+col)}${row+1}`);
      return;
    }
    // Selecionar unidade para reposicionar
    const anyUnit = gameState.units.filter(u => u.col === col && u.row === row && u.hp > 0);
    if (anyUnit.length > 0) {
      facRepoUnitId = anyUnit[0].id;
      showFacNotice(`${anyUnit[0].name} selecionada. Clique no mapa para mover.`);
    }
    return;
  }

  // Jogadores
  const {phase} = gameState;
  if (!stackPicker.classList.contains('hidden'))      { hideStackPicker();      return; }
  if (!enemyStackPicker.classList.contains('hidden')) { hideEnemyStackPicker(); return; }
  if (!weaponPicker.classList.contains('hidden'))     { hideWeaponPicker();     return; }

  if (phase === 'movement_approval' || phase === 'combat_approval' || phase === 'cyber_approval') return; // aguardando facilitador

  if (phase === 'cyber') {
    if (cyberTargetingCard) handleCyberTargetClick(col, row);
    return;
  }

  if (phase === 'combat') {
    if (isMyTurn() && selUnitId !== null) {
      const allAtk = atkHexes.filter(h => h.col === col && h.row === row);
      if (allAtk.length > 0) {
        hideWeaponPicker(); hideEnemyStackPicker();
        if (allAtk.length > 1) {
          const enemyUnits = allAtk.map(h => gameState.units.find(u => u.id === h.unitId && u.hp > 0)).filter(Boolean);
          const unique = enemyUnits.filter((u, i, arr) => arr.findIndex(x => x.id === u.id) === i);
          if (unique.length > 1) { showEnemyStackPicker(col, row, unique); return; }
        }
        handleAttackDeclaration(col, row, allAtk[0].unitId, allAtk[0].category);
        return;
      }
    }
    const ownUnits = gameState.units.filter(u => u.col === col && u.row === row && u.hp > 0 && u.team === myRole);
    if (ownUnits.length > 1) { showStackPicker(col, row, ownUnits); return; }
    if (ownUnits.length === 1) {
      selGroupIds = []; selUnitId = ownUnits[0].id;
      recalcHighlights(ownUnits[0]); updateUI(); render();
    } else { deselect(); }
    return;
  }

  if (phase === 'movement' && isMyTurn()) {
    if (selUnitId !== null) {
      const move = moveHexes.find(h => h.col === col && h.row === row);
      if (move) {
        activePath.push({ col, row });
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
    const ownUnits = gameState.units.filter(u => u.col === col && u.row === row && u.hp > 0 && u.team === myRole);
    if (ownUnits.length === 0) { deselect(true); return; }
    if (ownUnits.length > 1)   { deselect(true); showStackPicker(col, row, ownUnits); return; }
    const unit = ownUnits[0];
    if (selUnitId === unit.id && selGroupIds.length === 0) return;
    deselect(true);
    selUnitId = unit.id; selGroupIds = [];
    const saved = plannedMoves.get(unit.id);
    activePath = saved ? [...saved] : [{ col: unit.col, row: unit.row }];
    recalcHighlights(unit); updateUI(); render();
  }
}

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

function recalcHighlightsGroup(units) {
  const {phase} = gameState;
  if (phase === 'movement' && isMyTurn()) {
    const minMov    = Math.min(...units.map(u => u.movement));
    const stepsTaken= activePath.length - 1;
    if (stepsTaken < minMov) {
      const lastHex = activePath[activePath.length - 1];
      const inPath  = new Set(activePath.map(h => `${h.col},${h.row}`));
      moveHexes = hexNeighbors(lastHex.col, lastHex.row).filter(nb => {
        if (inPath.has(`${nb.col},${nb.row}`)) return false;
        return units.every(u => u.subtype === 'op_esp' || canEnterTerrain(u.category, TERRAIN_MAP[nb.row][nb.col]));
      });
    } else { moveHexes = []; }
  } else { moveHexes = []; }

  if (phase === 'combat' && isMyTurn()) {
    atkHexes = [];
    const enemies = gameState.units.filter(u => u.team !== myRole && u.team !== 'neutral' && u.hp > 0 && u.detected);
    for (const e of enemies) {
      if (units.some(u => hexDist(u.col, u.row, e.col, e.row) <= rangeAgainst(u.attackRange, e.category))) {
        atkHexes.push({ col: e.col, row: e.row, unitId: e.id, category: e.category });
      }
    }
  } else { atkHexes = []; }
}

function showStackPicker(col, row, units) {
  spList.innerHTML = '';
  for (const u of units) {
    const btn = document.createElement('button');
    btn.className = 'sp-unit-btn';
    const c = u.team === 'blue' ? 'var(--blue-l)' : u.team === 'red' ? 'var(--red-l)' : '#aaffaa';
    btn.innerHTML = `<span style="color:${c}">${u.name}</span> · ${u.hp}/${u.maxHp}SP`;
    btn.addEventListener('click', () => { hideStackPicker(); _selectUnit(u); });
    spList.appendChild(btn);
  }
  spGroupBtn.onclick = () => { hideStackPicker(); _selectGroup(units); };
  const {x, y} = hexToPixel(col, row);
  const rect   = canvas.getBoundingClientRect();
  const wrap   = canvas.parentElement.getBoundingClientRect();
  const scale  = rect.width / canvas.width;
  const sx = rect.left - wrap.left + x * scale;
  const sy = rect.top  - wrap.top  + (y + HEX_R) * scale + 6;
  stackPicker.style.left = `${Math.round(sx - 85)}px`;
  stackPicker.style.top  = `${Math.round(sy)}px`;
  stackPicker.classList.remove('hidden');
}

function hideStackPicker() { stackPicker.classList.add('hidden'); }

function showEnemyStackPicker(col, row, units) {
  espList.innerHTML = '';
  for (const u of units) {
    const btn = document.createElement('button');
    btn.className = 'sp-unit-btn';
    const c = u.team === 'blue' ? 'var(--blue-l)' : 'var(--red-l)';
    btn.innerHTML = `<span style="color:${c}">${u.name}</span> · ${u.hp}/${u.maxHp}SP`;
    btn.addEventListener('click', () => { hideEnemyStackPicker(); handleAttackDeclaration(col, row, u.id, u.category); });
    espList.appendChild(btn);
  }
  const {x, y} = hexToPixel(col, row);
  const rect = canvas.getBoundingClientRect();
  const wrap = canvas.parentElement.getBoundingClientRect();
  const scale = rect.width / canvas.width;
  const sx = rect.left - wrap.left + x * scale;
  const sy = rect.top  - wrap.top  + (y + HEX_R) * scale + 6;
  enemyStackPicker.style.left = `${Math.round(sx - 85)}px`;
  enemyStackPicker.style.top  = `${Math.round(sy)}px`;
  enemyStackPicker.classList.remove('hidden');
}
function hideEnemyStackPicker() { enemyStackPicker.classList.add('hidden'); }

function showWeaponPicker(col, row, attackerId, targetId, weapons) {
  wpList.innerHTML = '';
  for (const w of weapons) {
    const btn = document.createElement('button');
    btn.className = 'sp-unit-btn';
    const qtyStr = w.expendable ? ` (${w.qty} disp.)` : ' (∞)';
    btn.textContent = `${w.label}${qtyStr}`;
    btn.addEventListener('click', () => { hideWeaponPicker(); commitAttackDeclaration(attackerId, targetId, w.type); });
    wpList.appendChild(btn);
  }
  const {x, y} = hexToPixel(col, row);
  const rect = canvas.getBoundingClientRect();
  const wrap = canvas.parentElement.getBoundingClientRect();
  const scale = rect.width / canvas.width;
  const sx = rect.left - wrap.left + x * scale;
  const sy = rect.top  - wrap.top  + (y + HEX_R) * scale + 6;
  weaponPicker.style.left = `${Math.round(sx - 85)}px`;
  weaponPicker.style.top  = `${Math.round(sy)}px`;
  weaponPicker.classList.remove('hidden');
}
function hideWeaponPicker() { weaponPicker.classList.add('hidden'); }

function commitAttackDeclaration(attackerId, targetId, weaponType) {
  const idx = pendingAtks.findIndex(a => a.attackerId === attackerId && a.targetId === targetId);
  if (idx >= 0) { pendingAtks.splice(idx, 1); updateUI(); render(); return; }
  const attUnit = gameState?.units.find(u => u.id === attackerId && u.hp > 0);
  const wpnData = attUnit?.weapons?.[weaponType];
  const maxQty  = wpnData?.quantity ?? (attUnit?.capabilities?.[weaponType] || 1);
  const amount  = Math.min(maxQty, SALVO_DEFAULTS[weaponType] || 1);
  pendingAtks.push({ attackerId, targetId, amount, weaponType });
  updateUI(); render();
}

function handleAttackDeclaration(col, row, targetId, targetCategory) {
  const attackerIds = selGroupIds.length > 0 ? selGroupIds : (selUnitId ? [selUnitId] : []);
  for (const attackerId of attackerIds) {
    const attUnit = gameState?.units.find(u => u.id === attackerId && u.hp > 0);
    const tgtUnit = gameState?.units.find(u => u.id === targetId && u.hp > 0);
    if (!attUnit || !tgtUnit) continue;
    const dist = hexDist(attUnit.col, attUnit.row, tgtUnit.col, tgtUnit.row);
    if (dist > rangeAgainst(attUnit.attackRange, targetCategory)) continue;
    // Toggle existing attack off
    const existingIdx = pendingAtks.findIndex(a => a.attackerId === attackerId && a.targetId === targetId);
    if (existingIdx >= 0) { pendingAtks.splice(existingIdx, 1); continue; }
    const avail = getAvailableWeapons(attUnit, targetCategory, dist);
    if (avail.length === 0) continue;
    if (avail.length === 1 || selGroupIds.length > 1) {
      commitAttackDeclaration(attackerId, targetId, avail[0].type);
    } else {
      showWeaponPicker(col, row, attackerId, targetId, avail);
    }
  }
  updateUI(); render();
}

function _selectUnit(unit) {
  selGroupIds = [];
  if (gameState.phase === 'movement') {
    deselect(true);
    selUnitId = unit.id;
    const saved = plannedMoves.get(unit.id);
    activePath = saved ? [...saved] : [{ col: unit.col, row: unit.row }];
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
    activePath = [{ col: lead.col, row: lead.row }];
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
        if (unit.subtype === 'op_esp') return true;
        return canEnterTerrain(unit.category, TERRAIN_MAP[nb.row][nb.col]);
      });
    } else { moveHexes = []; }
  } else { moveHexes = []; }

  if (phase === 'combat' && isMyTurn()) {
    atkHexes = [];
    const enemies = gameState.units.filter(u => u.team !== myRole && u.team !== 'neutral' && u.hp > 0 && u.detected);
    for (const e of enemies) {
      if (unit.subtype === 'op_esp') {
        const isInfra = e.composition?.some(c => ['plataforma','porto','aeroporto'].includes(c.type));
        if (!isInfra) continue;
      }
      if (hexDist(unit.col, unit.row, e.col, e.row) <= rangeAgainst(unit.attackRange, e.category)) {
        atkHexes.push({ col: e.col, row: e.row, unitId: e.id, category: e.category });
      }
    }
  } else { atkHexes = []; }
}

function isMyTurn() {
  if (!gameState || myRole === 'facilitator') return false;
  const {phase, blueDone, redDone} = gameState;
  if (phase === 'movement') return myRole === 'blue' ? !blueDone : !redDone;
  if (phase === 'combat')   return myRole === 'blue' ? gameState.blueAttacks === null : gameState.redAttacks === null;
  return false;
}

// ─── UI update ────────────────────────────────────────────────────────────────
function updateUI() {
  if (!gameState) return;
  const {turn, period, phase, units, log, winner} = gameState;

  if (myRole === 'facilitator') {
    teamBadge.textContent = 'FACILITADOR';
    teamBadge.className   = 'team-badge fac';
  } else {
    teamBadge.textContent = myRole === 'blue' ? 'FORÇA AZUL' : 'FORÇA VERMELHA';
    teamBadge.className   = `team-badge ${myRole}`;
  }

  turnLabel.textContent  = `Turno ${turn}`;
  periodLabel.textContent= period === 'day' ? '☀ Diurno' : '🌙 Noturno';

  const phaseLabels = {
    cyber: 'Guerra Cibernética',
    cyber_approval: 'Avaliação Cibernética',
    movement: 'Movimentação',
    movement_approval: 'Aprovação de Movimentos',
    combat: 'Combate',
    combat_approval: 'Aprovação de Combate',
  };
  phaseLabel.textContent = phaseLabels[phase] || phase;

  myTurnBanner.classList.toggle('visible', isMyTurn() && !winner);

  // Painel de Guerra Cibernética: visível apenas para jogadores na fase 'cyber'
  const cyberPanelEl = $('cyber-panel');
  if (cyberPanelEl) cyberPanelEl.classList.toggle('hidden', myRole === 'facilitator' || phase !== 'cyber');

  // Esconder botões de ação para facilitador e para fases de aprovação
  const isApprovalPhase = phase === 'movement_approval' || phase === 'combat_approval' || phase === 'cyber_approval';
  if (endPhaseBtn) endPhaseBtn.classList.add('hidden');
  if (combatBtn)   combatBtn.classList.add('hidden');
  if (undoStepBtn) undoStepBtn.classList.add('hidden');
  if (cancelBtn)   cancelBtn.classList.toggle('hidden', selUnitId === null);

  if (myRole !== 'facilitator' && isMyTurn() && !winner && !isApprovalPhase) {
    if (phase === 'movement') {
      endPhaseBtn.classList.remove('hidden');
      const n = plannedMoves.size + (selUnitId !== null && activePath.length > 1 && !plannedMoves.has(selUnitId) ? 1 : 0);
      endPhaseBtn.textContent = n > 0 ? `Encerrar Movimentação (${n})` : 'Encerrar Movimentação';
      if (selUnitId !== null && activePath.length > 1) undoStepBtn.classList.remove('hidden');
    }
    if (phase === 'combat') combatBtn.classList.remove('hidden');
  }
  if (combatBtn) combatBtn.textContent = `Confirmar Ataques (${pendingAtks.length})`;

  // Mensagem de espera: fases de aprovação e combate já declarado
  const myAtksState = myRole === 'blue' ? gameState.blueAttacks : gameState.redAttacks;
  const hasDeclared = phase === 'combat' && myAtksState !== null && myAtksState !== undefined;
  const waitBanner = $('waiting-approval-banner');
  if (waitBanner) {
    const showWait = (isApprovalPhase || hasDeclared) && myRole !== 'facilitator';
    waitBanner.classList.toggle('hidden', !showWait);
    if (showWait) {
      waitBanner.textContent = hasDeclared && !isApprovalPhase
        ? '⌛ Ataques declarados — aguardando adversário...'
        : phase === 'movement_approval'
        ? '⌛ Aguardando aprovação do Facilitador (movimentos)...'
        : phase === 'cyber_approval'
        ? '⌛ Aguardando avaliação do Facilitador (guerra cibernética)...'
        : '⌛ Aguardando aprovação do Facilitador (combate)...';
    }
  }

  const b = units.filter(u => u.team === 'blue'    && u.hp > 0).length;
  const r = units.filter(u => u.team === 'red'     && u.hp > 0).length;
  const n = units.filter(u => u.team === 'neutral' && u.hp > 0).length;
  fleetBlue.textContent = `Azul: ${b}`;
  fleetRed.textContent  = `Verm: ${r}`;
  const fleetNeu = $('fleet-neutral');
  if (fleetNeu) fleetNeu.textContent = `Neut: ${n}`;

  // Unit info panel
  const sel = selUnitId ? gameState.units.find(u => u.id === selUnitId && u.hp > 0) : null;
  if (sel && unitPanel) {
    const hpPct = sel.hp / sel.maxHp * 100;
    const bar   = hpPct > 60 ? '#69f0ae' : hpPct > 30 ? '#ffca28' : '#ff5252';
    const t     = sel.col >= 0 ? TERRAIN_MAP[sel.row][sel.col] : 3;
    const pathSteps    = activePath.length - 1;
    const pathStepsMov = selGroupIds.length > 0
      ? Math.min(...selGroupIds.map(id => { const u2=gameState.units.find(u=>u.id===id); return u2?u2.movement:99; }))
      : sel.movement;
    const pathHint   = pathSteps > 0 ? `<div class="u-hint">Caminho: ${pathSteps}/${pathStepsMov} passo(s)</div>` : '';
    const groupHint  = selGroupIds.length > 1 ? `<div class="u-hint">Grupo: ${selGroupIds.length} unidades</div>` : '';
    const myAtks     = selGroupIds.length > 0
      ? pendingAtks.filter(a => selGroupIds.includes(a.attackerId))
      : pendingAtks.filter(a => a.attackerId === sel.id);
    const det  = sel.detectionRange || {};
    const comp = (sel.composition||[]).map(c=>`${c.quantity}× ${c.type}`).join(' · ');
    const wpns = sel.weapons || {};
    const initW= sel.initWeapons || {};
    const wpnLines = Object.entries(wpns)
      .filter(([,w])=>w.quantity>0||(initW[w]?.quantity??0)>0)
      .map(([k,w])=>`${k.toUpperCase()}: <b>${w.quantity}</b>/${initW[k]?.quantity??w.quantity}`);
    const caps = sel.capabilities || {};
    const capLines = Object.entries(caps).filter(([,v])=>v>0).map(([k,v])=>`${k.toUpperCase()}: ${v}`);
    const teamColor = sel.team === 'blue' ? 'blue' : sel.team === 'red' ? 'red' : 'neutral';

    // Botão de gerenciamento rápido para facilitador
    const facBtn = myRole === 'facilitator'
      ? `<div style="margin-top:6px;display:flex;gap:4px;">
          <button class="fac-small-btn" style="flex:1" onclick="facQuickEditUnit('${sel.id}','${sel.name}',${sel.hp},${sel.maxHp})">✏ Editar SP</button>
          <button class="fac-small-btn" style="flex:1" onclick="facSelectRepoUnit('${sel.id}')">📍 Mover</button>
         </div>` : '';

    unitPanel.innerHTML = `
      <div class="u-name ${teamColor}">${sel.name}</div>
      <div class="hp-bar"><div class="hp-fill" style="width:${hpPct}%;background:${bar}"></div></div>
      <div class="u-stats">
        <span>SP</span><span>${sel.hp}/${sel.maxHp}</span>
        <span>MOV</span><span>${sel.movement}</span>
        <span>Equipe</span><span>${sel.team}</span>
        ${fuelRow(sel)}
        <span>Det S/Aé/Sb/T</span><span>${det.surface||0}/${det.air||0}/${det.submarine||0}/${det.land||0}</span>
        <span>Terreno</span><span style="font-size:0.7em">${T_NAME[t]}</span>
      </div>
      ${wpnLines.length ? `<div class="u-hint" style="font-size:0.67rem;line-height:1.7">🚀 ${wpnLines.join(' · ')}</div>` : ''}
      ${capLines.length ? `<div class="u-hint" style="color:var(--text-dim);font-size:0.67rem;line-height:1.7">⚙ ${capLines.join(' · ')}</div>` : ''}
      ${comp ? `<div class="u-hint" style="color:var(--dim);font-size:0.67rem;line-height:1.5">${comp}</div>` : ''}
      ${(() => {
        const warns = [
          clientCyberModifier(sel.id, sel.team, 'moveDisabled')         > 0 && '⚠ Movimento bloqueado (cyber)',
          clientCyberModifier(sel.id, sel.team, 'attackDisabled')        > 0 && '⚠ Ataque bloqueado (cyber)',
          clientCyberModifier(sel.id, sel.team, 'fuelRecoveryBlocked')   > 0 && '⚠ Recuperação de FP bloqueada (cyber)',
          clientCyberModifier(sel.id, sel.team, 'ecmDegraded')           > 0 && '⚠ ECM degradado (cyber)',
          clientCyberModifier(sel.id, sel.team, 'attackAmountMalus')     > 0 && '⚠ Targeting degradado (cyber)',
          clientCyberModifier(sel.id, sel.team, 'stealthBonus')          > 0 && '✔ AIS corrompido (oculto do inimigo)',
        ].filter(Boolean);
        return warns.map(w => `<div class="u-hint" style="color:#ffb74d;font-size:0.67rem">${w}</div>`).join('');
      })()}
      ${groupHint}${pathHint}
      ${atkHexes.length && myRole !== 'facilitator' ? '<div class="u-hint">Clique em alvos vermelhos p/ declarar ataque</div>' : ''}
      ${myAtks.length ? buildAtkListHtml(myAtks) : ''}
      ${facBtn}
    `;
  } else if (unitPanel) {
    const hint = myRole === 'facilitator'
      ? '<p class="no-sel">Clique em qualquer unidade para ver detalhes</p>'
      : '<p class="no-sel">Clique em uma unidade sua</p>';
    unitPanel.innerHTML = hint;
  }

  logEl.innerHTML = (log||[]).map(l=>`<p>${l}</p>`).join('');
}

// Soma modificadores cibernéticos ativos no cliente (espelha activeCyberModifier do servidor)
function clientCyberModifier(unitId, team, key) {
  let total = 0;
  for (const eff of gameState?.cyber?.activeEffects || []) {
    if (eff.affectedTeam !== team) continue;
    if (!eff.modifiers?.[key]) continue;
    if (eff.scope === 'unit' && eff.targetId !== unitId) continue;
    total += Number(eff.modifiers[key]);
  }
  return total;
}

function activeCyberEffectsHtml(team) {
  const effs = (gameState?.cyber?.activeEffects || []).filter(e => e.affectedTeam === team);
  if (!effs.length) return '';
  const fuelBlocked = effs.some(e => e.modifiers?.fuelRecoveryBlocked);
  let html = '<div class="cyber-section-title" style="margin-top:6px;color:#ffb74d">⚠ Efeitos Ativos na Sua Força</div>';
  if (fuelBlocked) html += '<div class="cyber-def-row" style="color:#ffb74d">⛽ Recuperação de combustível bloqueada</div>';
  for (const eff of effs) {
    const def = eff.effectId ? CYBER_EFFECTS[eff.effectId] : null;
    const name = def?.name || eff.name || 'Anomalia Não Identificada';
    const tgt = eff.scope === 'team' ? 'toda a força' : (() => {
      const u = gameState?.units?.find(u => u.id === eff.targetId);
      return u ? u.name : eff.targetId;
    })();
    const turns = eff.turnsRemaining > 0 ? `${eff.turnsRemaining}t` : 'último turno';
    html += `<div class="cyber-def-row" style="color:#ce93d8;font-size:0.72rem">⚠ ${escHtml(name)} → ${escHtml(tgt)} (${turns})</div>`;
  }
  return html;
}

function fuelRow(unit) {
  const f = unit.fuel;
  if (!f || !f.usesFuel) return `<span>Combustível</span><span class="fp-inf">∞</span>`;
  if (unit.category === 'air') {
    const STATUS = { ready:'Pronta', airborne:'Em voo', recovering:'Reabastecendo' };
    const statusLabel = STATUS[unit.airStatus] || unit.airStatus || '—';
    const fpLabel = unit.airStatus === 'ready' || unit.airStatus === 'recovering'
      ? `${f.max} FP` : `${f.current??0}/${f.max} FP`;
    const fpClass = (f.current??f.max) <= Math.ceil(f.max*0.25) ? 'fp-low' : 'fp-ok';
    return `<span>Status</span><span>${statusLabel}</span>
            <span>Combustível</span><span class="${fpClass}">${fpLabel}</span>`;
  }
  const cur = f.current ?? 0;
  const pct = f.max > 0 ? cur / f.max : 0;
  const cls = cur <= 0 ? 'fp-empty' : pct <= 0.25 ? 'fp-low' : 'fp-ok';
  return `<span>Combustível</span><span class="${cls}">${cur}/${f.max} FP</span>`;
}

function buildAtkListHtml(atks) {
  if (!atks.length) return '';
  const items = atks.map(a => {
    const tgt     = gameState?.units.find(u => u.id === a.targetId);
    const tgtName = tgt?.name || a.targetId;
    const attUnit = gameState?.units.find(u => u.id === a.attackerId);
    const wpnInfo = WEAPON_INFO[a.weaponType];
    const wpnLabel = wpnInfo?.label || (a.weaponType?.toUpperCase() || '?');
    const wpnQty  = (a.weaponType && attUnit?.weapons?.[a.weaponType]?.quantity)
      ?? (a.weaponType && attUnit?.capabilities?.[a.weaponType]) ?? 4;
    const maxAmt  = wpnInfo?.expendable ? (wpnQty || 1) : 1;
    const amt     = Math.min(a.amount || 1, maxAmt);
    const tgtCat  = tgt?.category || 'surface';
    const dist    = (attUnit && tgt) ? hexDist(attUnit.col, attUnit.row, tgt.col, tgt.row) : 0;
    const availLen = attUnit ? getAvailableWeapons(attUnit, tgtCat, dist).length : 1;
    const cycleBtns = availLen > 1
      ? `<span class="atk-wpn-cycle">
           <button class="atk-adj-btn" data-atk-wpn data-attacker="${a.attackerId}" data-target="${a.targetId}" data-delta="-1">◀</button>
           <span class="atk-wpn-lbl">${wpnLabel}</span>
           <button class="atk-adj-btn" data-atk-wpn data-attacker="${a.attackerId}" data-target="${a.targetId}" data-delta="1">▶</button>
         </span>`
      : `<span class="atk-wpn-lbl-fixed">${wpnLabel}</span>`;
    return `<div class="atk-entry">
      <span class="atk-target">→ ${tgtName}</span>
      ${cycleBtns}
      ${wpnInfo?.expendable !== false ? `<span class="atk-amt-ctrl">
        <button class="atk-adj-btn" data-atk-adj data-attacker="${a.attackerId}" data-target="${a.targetId}" data-atk_adj="-1" data-max="${maxAmt}">−</button>
        <span class="atk-amt-val">${amt}</span>
        <button class="atk-adj-btn" data-atk-adj data-attacker="${a.attackerId}" data-target="${a.targetId}" data-atk_adj="1" data-max="${maxAmt}">+</button>
      </span>` : ''}
    </div>`;
  }).join('');
  return `<div class="atk-list"><div class="atk-list-title">Ataques declarados:</div>${items}</div>`;
}

// ─── Tooltip / detail popup ───────────────────────────────────────────────────
function _renderUnitPreview(canvasEl, unit, w, h) {
  if (!canvasEl) return;
  const pCtx = canvasEl.getContext('2d');
  pCtx.clearRect(0, 0, w, h);
  const scale = (w * 0.65) / HEX_R;
  pCtx.save();
  pCtx.translate(w / 2, h / 2);
  pCtx.scale(scale, scale);
  pCtx.beginPath(); pCtx.arc(0, 0, HEX_R * 0.58, 0, Math.PI * 2);
  pCtx.fillStyle = 'rgba(0,0,0,0.45)'; pCtx.fill();
  drawUnitCounter(pCtx, unit, 0, 0, false);
  pCtx.restore();
}

function showUnitTooltip(unit, screenX, screenY) {
  const el = $('unit-tooltip');
  if (!el || !unit) return;
  _renderUnitPreview($('utt-canvas'), unit, 70, 70);
  const teamCls = unit.team === 'blue' ? 'blue' : unit.team === 'red' ? 'red' : 'neutral';
  const teamLbl = unit.team === 'blue' ? 'AZL' : unit.team === 'red' ? 'VRM' : 'NEU';
  $('utt-name').textContent = unit.name;
  const badge = $('utt-badge');
  badge.textContent = teamLbl;
  badge.className = `team-badge ${teamCls}`;
  badge.style.cssText = 'font-size:0.57rem;padding:1px 5px';
  const pct = unit.maxHp > 0 ? unit.hp / unit.maxHp * 100 : 0;
  const col = pct > 60 ? '#69f0ae' : pct > 30 ? '#ffca28' : '#ff5252';
  $('utt-sp-fill').style.cssText = `width:${pct}%;background:${col}`;
  $('utt-sp-val').textContent = `${unit.hp}/${unit.maxHp} SP`;
  const det = unit.detectionRange || {};
  const stats = [['MOV',unit.movement],['Sup',det.surface||0],['Aé',det.air||0],['Sub',det.submarine||0]]
    .filter(([k,v])=>v>0||k==='MOV')
    .map(([k,v])=>`<span><span class="utt-sk">${k}</span>${v}</span>`).join('');
  $('utt-stats').innerHTML = stats;
  el.classList.remove('hidden');
  el.style.visibility = 'hidden'; el.style.left = '0'; el.style.top = '0';
  const ew = el.offsetWidth, eh = el.offsetHeight, m = 14;
  const vw = window.innerWidth, vh = window.innerHeight;
  let tx = screenX + m, ty = screenY + m;
  if (tx + ew > vw - m) tx = screenX - ew - m;
  if (ty + eh > vh - m) ty = screenY - eh - m;
  el.style.left = `${tx}px`; el.style.top = `${ty}px`; el.style.visibility = '';
}

function hideUnitTooltip() {
  clearTimeout(_tooltipTimer); _tooltipTimer = null; _tooltipUnitId = null;
  const el = $('unit-tooltip'); if (el) el.classList.add('hidden');
}

function showUnitDetail(unit, screenX, screenY) {
  const el = $('unit-detail');
  if (!el || !unit) return;
  const teamCls = unit.team === 'blue' ? 'blue' : unit.team === 'red' ? 'red' : 'neutral';
  const teamLbl = unit.team === 'blue' ? 'FORÇA AZUL' : unit.team === 'red' ? 'FORÇA VERMELHA' : 'NEUTRO';
  const catLbl  = {surface:'Superfície',submarine:'Submarino',air:'Aéreo',land:'Terrestre'}[unit.category] || unit.category;
  const abbr    = (typeof TYPE_ABBR !== 'undefined' && TYPE_ABBR[unit.type]) || unit.type.slice(0,2).toUpperCase();
  const det = unit.detectionRange || {}, atk = unit.attackRange || {};
  const wpns = unit.weapons || {}, initW = unit.initWeapons || {}, caps = unit.capabilities || {};
  const pct = unit.maxHp > 0 ? unit.hp / unit.maxHp * 100 : 0;
  const hpCol = pct > 60 ? '#69f0ae' : pct > 30 ? '#ffca28' : '#ff5252';
  const wpnRows = Object.entries(wpns)
    .filter(([k,w]) => w.quantity > 0 || (initW[k]?.quantity ?? 0) > 0)
    .map(([k,w]) => `<div class="udr"><span class="udk">${k.toUpperCase()}</span><span class="udv">${w.quantity}/${initW[k]?.quantity ?? w.quantity}</span></div>`)
    .join('') || '<div class="ud-dim">Sem armamento registrado</div>';
  const capText  = Object.entries(caps).filter(([,v])=>v>0).map(([k,v])=>`${k.toUpperCase()}:${v}`).join(' · ');
  const compText = (unit.composition||[]).map(c=>`${c.quantity}× ${c.type}`).join(' · ');
  const f = unit.fuel;
  const fuelHtml = f?.usesFuel
    ? `<div class="udr"><span class="udk">Combustível</span><span class="udv">${unit.category==='air'?(f.current??f.max):(f.current??0)}/${f.max} FP</span></div>` : '';
  $('ud-header').innerHTML = `
    <canvas id="ud-canvas" width="110" height="110" class="ud-canvas"></canvas>
    <div class="ud-hinfo">
      <div class="ud-hname ${teamCls}">${unit.name}</div>
      <div class="ud-hsub">${abbr} · ${catLbl}</div>
      <span class="team-badge ${teamCls}" style="font-size:0.58rem;padding:2px 7px">${teamLbl}</span>
    </div>`;
  $('ud-body').innerHTML = `
    <div class="ud-sect">
      <div class="ud-sp-bar"><div class="ud-sp-fill" style="width:${pct}%;background:${hpCol}"></div></div>
      <div class="ud-grid">
        <div class="udr"><span class="udk">SP</span><span class="udv">${unit.hp}/${unit.maxHp}</span></div>
        <div class="udr"><span class="udk">MOV</span><span class="udv">${unit.movement}</span></div>
        ${fuelHtml}
      </div>
    </div>
    <div class="ud-sep"></div>
    <div class="ud-2col">
      <div>
        <div class="ud-stitle">DETECÇÃO</div>
        <div class="udr"><span class="udk">Sup</span><span class="udv">${det.surface||0}</span></div>
        <div class="udr"><span class="udk">Aé</span><span class="udv">${det.air||0}</span></div>
        <div class="udr"><span class="udk">Sub</span><span class="udv">${det.submarine||0}</span></div>
        <div class="udr"><span class="udk">Ter</span><span class="udv">${det.land||0}</span></div>
      </div>
      <div>
        <div class="ud-stitle">ALCANCE ATQ.</div>
        <div class="udr"><span class="udk">Sup</span><span class="udv">${atk.surface||0}</span></div>
        <div class="udr"><span class="udk">Aé</span><span class="udv">${atk.air||0}</span></div>
        <div class="udr"><span class="udk">Sub</span><span class="udv">${atk.submarine||0}</span></div>
        <div class="udr"><span class="udk">Ter</span><span class="udv">${atk.land||0}</span></div>
      </div>
    </div>
    <div class="ud-sep"></div>
    <div class="ud-stitle">ARMAMENTO</div>${wpnRows}
    ${capText?`<div class="ud-sep"></div><div class="ud-stitle">CAPACIDADES</div><div class="ud-dim">${capText}</div>`:''}
    ${compText?`<div class="ud-sep"></div><div class="ud-stitle">COMPOSIÇÃO</div><div class="ud-dim">${compText}</div>`:''}
    ${unit.notes?`<div class="ud-note">📝 ${unit.notes}</div>`:''}`;
  el.classList.remove('hidden');
  _renderUnitPreview($('ud-canvas'), unit, 110, 110);
  el.style.visibility = 'hidden'; el.style.left = '0'; el.style.top = '0';
  const ew = el.offsetWidth, eh = el.offsetHeight, m = 10;
  const vw = window.innerWidth, vh = window.innerHeight;
  let tx = screenX + m, ty = screenY + m;
  if (tx + ew > vw - m) tx = screenX - ew - m;
  if (ty + eh > vh - m) ty = Math.max(m, screenY - eh - m);
  el.style.left = `${tx}px`; el.style.top = `${ty}px`; el.style.visibility = '';
}

function closeUnitDetail() { const el=$('unit-detail'); if(el) el.classList.add('hidden'); }

// ─── Zoom / pan helpers ───────────────────────────────────────────────────────
function clampPan() {
  if (zoomLevel <= 1) { panX = 0; panY = 0; return; }
  panX = Math.max(CVS_W * (1 - zoomLevel), Math.min(0, panX));
  panY = Math.max(CVS_H * (1 - zoomLevel), Math.min(0, panY));
}
function zoomTo(level, pivotX = CVS_W / 2, pivotY = CVS_H / 2) {
  const newZ = Math.max(Z_MIN, Math.min(Z_MAX, level));
  panX = pivotX - (pivotX - panX) * (newZ / zoomLevel);
  panY = pivotY - (pivotY - panY) * (newZ / zoomLevel);
  zoomLevel = newZ; clampPan(); updateZoomLabel(); render();
}
function zoomIn()    { zoomTo(zoomLevel + Z_STEP); }
function zoomOut()   { zoomTo(zoomLevel - Z_STEP); }
function resetZoom() { zoomLevel = 1; panX = 0; panY = 0; updateZoomLabel(); render(); }
function updateZoomLabel() {
  const el = $('zoom-label');
  if (el) el.textContent = `${Math.round(zoomLevel * 100)}%`;
}

// ─── Unit hit pulse animation ─────────────────────────────────────────────────
function triggerUnitHit(unitId) {
  _unitHits[unitId] = { endMs: Date.now() + 1400 };
  if (_animRaf) return;
  (function frame() {
    render();
    if (Object.values(_unitHits).some(h => Date.now() < h.endMs)) _animRaf = requestAnimationFrame(frame);
    else { _unitHits = {}; _animRaf = null; }
  })();
}
function drawHitAnimations() {
  const now = Date.now();
  for (const [uid, anim] of Object.entries(_unitHits)) {
    if (now >= anim.endMs) continue;
    const unit = gameState?.units.find(u => u.id === uid);
    if (!unit) continue;
    const {x, y} = hexToPixel(unit.col, unit.row);
    const t = (anim.endMs - now) / 1400;
    const pulse = Math.abs(Math.sin(t * Math.PI * 5));
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, HEX_R * (0.62 + 0.26 * (1 - t)), 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255,50,50,${(pulse * 0.92).toFixed(2)})`;
    ctx.lineWidth = 4 / zoomLevel;
    ctx.stroke();
    ctx.restore();
  }
}

// ─── Phase flash overlay ──────────────────────────────────────────────────────
function showPhaseFlash(text, color) {
  const el = $('phase-flash');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  el.style.borderColor = color + '99';
  el.classList.remove('hidden', 'pf-in', 'pf-out');
  void el.offsetWidth;
  el.classList.add('pf-in');
  clearTimeout(_phaseFlashTimer);
  _phaseFlashTimer = setTimeout(() => {
    el.classList.remove('pf-in');
    el.classList.add('pf-out');
    setTimeout(() => { el.classList.add('hidden'); el.classList.remove('pf-out'); }, 500);
  }, 1800);
}

// ═══ RENDERING ════════════════════════════════════════════════════════════════
function render() {
  if (!gameState) return;
  ctx.clearRect(0, 0, CVS_W, CVS_H);
  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoomLevel, zoomLevel);
  drawBackground();
  drawHighlights();
  drawGrid();
  drawInfrastructure();
  drawUnits();
  drawHitAnimations();
  drawCoordLabels();
  if (hoverHex) drawHover();
  ctx.restore();
}

function drawBackground() {
  if (mapReady) ctx.drawImage(mapImg, 0, 0, CVS_W, CVS_H);
  else {
    const g = ctx.createLinearGradient(0,0,CVS_W,CVS_H);
    g.addColorStop(0.0,'#0d2a45'); g.addColorStop(0.2,'#0a2238'); g.addColorStop(1.0,'#071520');
    ctx.fillStyle=g; ctx.fillRect(0,0,CVS_W,CVS_H);
  }
}

function drawHighlights() {
  for (const [unitId, path] of plannedMoves) {
    if (unitId === selUnitId) continue;
    drawPathTrail(path,'rgba(100,180,255,0.18)','rgba(100,180,255,0.55)','rgba(100,180,255,0.35)','rgba(100,180,255,0.85)');
  }
  if (selUnitId !== null && activePath.length > 1) {
    drawPathTrail(activePath,'rgba(255,220,0,0.20)','rgba(255,220,0,0.65)','rgba(255,220,0,0.40)','rgba(255,220,0,0.95)');
  }
  for (const h of moveHexes) {
    const {x,y}=hexToPixel(h.col,h.row);
    drawHex(ctx,x,y,'rgba(0,230,118,0.22)','rgba(0,230,118,0.70)',1.8);
  }
  for (const h of atkHexes) {
    const {x,y}=hexToPixel(h.col,h.row);
    const declared=pendingAtks.some(a=>a.targetId===h.unitId);
    drawHex(ctx,x,y,
      declared?'rgba(255,60,60,0.50)':'rgba(255,60,60,0.22)',
      declared?'rgba(255,120,120,1.0)':'rgba(255,80,80,0.75)',2.0);
  }
  // Facilitador: trilhas de movimentação durante aprovação
  if (myRole === 'facilitator' && gameState.phase === 'movement_approval' && gameState.pendingPaths) {
    for (const [unitId, path] of Object.entries(gameState.pendingPaths)) {
      if (!Array.isArray(path) || path.length < 2) continue;
      const unit = gameState.units.find(u => u.id === unitId && u.hp > 0);
      if (!unit) continue;
      const isBlue = unit.team === 'blue';
      drawPathTrail(path,
        isBlue ? 'rgba(130,177,255,0.18)' : 'rgba(255,138,128,0.18)',
        isBlue ? 'rgba(130,177,255,0.55)' : 'rgba(255,138,128,0.55)',
        isBlue ? 'rgba(130,177,255,0.35)' : 'rgba(255,138,128,0.35)',
        isBlue ? 'rgba(130,177,255,0.85)' : 'rgba(255,138,128,0.85)',
      );
    }
  }
  // Destacar unidade selecionada para reposicionamento (facilitador)
  if (myRole === 'facilitator' && facRepoUnitId) {
    const repoUnit = gameState?.units.find(u => u.id === facRepoUnitId && u.hp > 0);
    if (repoUnit) {
      const {x,y} = hexToPixel(repoUnit.col, repoUnit.row);
      drawHex(ctx,x,y,'rgba(255,200,0,0.30)','rgba(255,200,0,1.0)',3.0);
    }
  }
}

function drawPathTrail(path, fillMid, strokeMid, fillLast, strokeLast) {
  for (let i = 1; i < path.length; i++) {
    const {col,row}=path[i];
    const {x,y}=hexToPixel(col,row);
    const isLast=i===path.length-1;
    drawHex(ctx,x,y,isLast?fillLast:fillMid,isLast?strokeLast:strokeMid,isLast?2.2:1.6);
    ctx.save();
    ctx.fillStyle='rgba(255,255,255,0.92)';
    ctx.font=`bold ${Math.round(HEX_R*0.30)}px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=3;
    ctx.fillText(String(i),x,y);
    ctx.restore();
  }
}

function drawGrid() {
  for (let r=0;r<GRID_H;r++) for (let c=0;c<GRID_W;c++) {
    const t=TERRAIN_MAP[r][c];
    const {x,y}=hexToPixel(c,r);
    drawHex(ctx,x,y,null,T_BORDER[t],0.8);
  }
}

const INFRA_COLORS={naval:'#82b1ff',port:'#80cbc4',aero:'#b0bec5',oil:'#ffcc02'};
function drawInfrastructure() {
  for (const inf of INFRA) {
    const {x,y}=hexToPixel(inf.col,inf.row);
    const col=INFRA_COLORS[inf.type]||'#fff';
    ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=4;
    ctx.fillStyle=col;
    ctx.font=`bold ${Math.round(HEX_R*0.38)}px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(inf.label,x,y-HEX_R*0.1);
    ctx.shadowBlur=0;
    ctx.fillStyle='rgba(255,255,200,0.7)';
    ctx.font=`${Math.round(HEX_R*0.2)}px 'Courier New',monospace`;
    ctx.fillText(inf.name,x,y+HEX_R*0.38);
  }
}

function drawUnits() {
  if (!gameState) return;
  // Ghost destinations
  for (const [unitId,path] of plannedMoves) {
    if (path.length<=1) continue;
    const unit=gameState.units.find(u=>u.id===unitId&&u.hp>0);
    if (!unit) continue;
    const dest=path[path.length-1];
    const {x,y}=hexToPixel(dest.col,dest.row);
    ctx.save(); ctx.globalAlpha=0.35;
    ctx.beginPath(); ctx.arc(x,y,HEX_R*0.58,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fill();
    drawUnitCounter(ctx,unit,x,y,false);
    ctx.restore();
  }
  if (selUnitId!==null&&activePath.length>1) {
    const unit=gameState.units.find(u=>u.id===selUnitId&&u.hp>0);
    if (unit) {
      const dest=activePath[activePath.length-1];
      const {x,y}=hexToPixel(dest.col,dest.row);
      ctx.save(); ctx.globalAlpha=0.40;
      ctx.beginPath(); ctx.arc(x,y,HEX_R*0.58,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fill();
      drawUnitCounter(ctx,unit,x,y,false);
      ctx.restore();
    }
  }
  // Actual units
  for (const u of gameState.units) {
    if (u.hp<=0) continue;
    const {x,y}=hexToPixel(u.col,u.row);
    ctx.beginPath(); ctx.arc(x,y,HEX_R*0.58,0,Math.PI*2); ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fill();
    const isSelected=u.id===selUnitId||selGroupIds.includes(u.id);
    drawUnitCounter(ctx,u,x,y,isSelected);
  }
  // Stack badges
  const hexStacks={};
  for (const u of gameState.units) {
    if (u.hp<=0) continue;
    const k=`${u.col},${u.row}`;
    if (!hexStacks[k]) hexStacks[k]={col:u.col,row:u.row,count:0};
    hexStacks[k].count++;
  }
  for (const {col,row,count} of Object.values(hexStacks)) {
    if (count<2) continue;
    const {x,y}=hexToPixel(col,row);
    const r=HEX_R*0.22,bx=x+HEX_R*0.38,by=y-HEX_R*0.38;
    ctx.beginPath(); ctx.arc(bx,by,r,0,Math.PI*2);
    ctx.fillStyle='rgba(255,200,0,0.92)'; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=1; ctx.stroke();
    ctx.fillStyle='#000';
    ctx.font=`bold ${Math.round(r*1.3)}px sans-serif`;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(String(count),bx,by);
  }
}

function drawCoordLabels() {
  ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=3;
  const fs=Math.round(HEX_R*0.27);
  ctx.fillStyle='rgba(200,220,240,0.55)';
  ctx.font=`${fs}px 'Courier New',monospace`;
  ctx.textAlign='center'; ctx.textBaseline='top';
  for (let c=0;c<GRID_W;c++){const {x}=hexToPixel(c,0);ctx.fillText(hexLabel(c),x,OY/2-6);}
  ctx.textAlign='right'; ctx.textBaseline='middle';
  for (let r=0;r<GRID_H;r++){const {y}=hexToPixel(0,r);ctx.fillText(r+1,OX-6,y);}
  ctx.shadowBlur=0;
}

function drawHover() {
  const {col,row}=hoverHex;
  if (col<0||col>=GRID_W||row<0||row>=GRID_H) return;
  const {x,y}=hexToPixel(col,row);
  drawHex(ctx,x,y,'rgba(255,255,255,0.08)','rgba(255,255,255,0.35)',1.2);
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function flashError(msg) {
  const el=$('error-flash');
  el.textContent=msg; el.classList.remove('hidden');
  clearTimeout(flashError._t);
  flashError._t=setTimeout(()=>el.classList.add('hidden'),3500);
}
function showLobbyErr(msg) {
  const lobbyErr=$('lobby-err');
  lobbyErr.textContent=msg; lobbyErr.classList.remove('hidden');
  setTimeout(()=>lobbyErr.classList.add('hidden'),4000);
}

// ─── Battle Round Panel ───────────────────────────────────────────────────────
let brDecisionMade=false, brQueue=[];

function closeBrPanel() {
  $('br-panel').classList.add('hidden');
  brDecisionMade=false; brQueue=[];
}
function onBrOk() {
  if (brQueue.length>0) renderBrPanel(brQueue.shift());
  else closeBrPanel();
}
function handleBrResult(data) {
  brQueue.push(data);
  const panelHidden=$('br-panel').classList.contains('hidden');
  const isWaiting=!$('br-waiting').classList.contains('hidden');
  if (panelHidden||isWaiting) renderBrPanel(brQueue.shift());
}
function sendBrDecision(decision) {
  if (brDecisionMade) return;
  brDecisionMade=true;
  socket.emit('battle_round_decision',{decision});
  $('br-decision').classList.add('hidden');
  $('br-waiting').classList.remove('hidden');
  const chosen=decision==='continue'?'Você escolheu CONTINUAR.':'Você escolheu PARAR.';
  $('br-panel-body').insertAdjacentHTML('beforeend',`<div class="br-row br-decision-made">${chosen}</div>`);
}
function buildResultHtml(eng) {
  if (!eng) return '';
  if (!eng.ok) return `<div class="br-row br-miss">⚠ ${eng.reason||'Sem armamento válido.'}</div>`;
  const intStr=eng.interception?.intercepted>0?`<span class="br-int"> [${eng.interception.intercepted} intercept.]</span>`:'';
  const wpnTag=eng.weaponLabel?`<span class="br-wpn">[${eng.weaponLabel}]</span> `:'';
  const rollsDesc=(eng.attackRolls||[]).map(r=>r.reroll!=null?`d6=${r.roll}→${r.reroll}(${r.damage}SP)`:`d6=${r.roll}(${r.damage}SP)`).join('  ')||'—';
  const advTag=eng.advantage?'<span class="br-adv"> ★iniciativa</span>':'';
  let cls,icon,detail;
  if (eng.destroyed){cls='br-destroyed';icon='💥';detail=`−${eng.totalDamage}SP <strong>DESTRUÍDO!</strong>`;}
  else if (eng.totalDamage>0){cls='br-hit';icon='✓';detail=`−${eng.totalDamage}SP  (restante: ${eng.remainingHp}SP)`;}
  else{cls='br-miss';icon='✗';detail=`sem dano  (restante: ${eng.remainingHp}SP)`;}
  return `<div class="br-row ${cls}">${icon} ${wpnTag}${advTag}
    <span class="br-launched">Lançados: ${eng.launched}</span>${intStr}
    <span class="br-impacts"> Impactos: ${eng.effectiveShots}</span>
    <div class="br-detail">${detail}</div>
    <div class="br-rolls">${rollsDesc}</div>
  </div>`;
}
function renderBrPanel({engagement,result,mustDecide,decisions,initiativeBonusTeam,counterResult,facilitatorNote}) {
  brDecisionMade=false;
  const brLabel=`${engagement.id} · Battle Round ${engagement.battleRound}`;
  const singleRound=engagement.maxBattleRounds===1;
  $('br-panel-header').textContent=`── ${brLabel} ──`;
  let html='';
  const att=gameState?.units.find(u=>u.id===engagement.attackerId);
  const def=gameState?.units.find(u=>u.id===engagement.targetId);
  const attName=att?.name||engagement.attackerId,defName=def?.name||engagement.targetId;
  const attCls=att?.team==='blue'?'cm-blue':'cm-red';
  const defCls=def?.team==='blue'?'cm-blue':'cm-red';
  html+=`<div class="br-combatants"><span class="${attCls}">${attName}</span><span class="br-arrow"> → </span><span class="${defCls}">${defName}</span><span class="br-wpn-tag"> [${engagement.weaponType.toUpperCase()}]</span></div>`;
  if (singleRound) html+=`<div class="br-single-label">Arma estratégica — rodada única</div>`;
  if (initiativeBonusTeam) {
    const bonusLabel=initiativeBonusTeam===myRole?'SUA FORÇA':'FORÇA ADVERSÁRIA';
    html+=`<div class="br-init-bonus">★ Bônus de iniciativa: ${bonusLabel} (2d6, maior valor)</div>`;
  }
  if (result===null&&decisions) {
    html+=`<div class="br-row br-decision-summary">Azul: ${decisions.blue==='stop'?'PAROU':'CONTINUOU'} · Vermelho: ${decisions.red==='stop'?'PAROU':'CONTINUOU'} — combate encerrado.</div>`;
  } else if (result===null) {
    html+=`<div class="br-row br-miss">⚠ Unidade já destruída — engajamento cancelado.</div>`;
  } else {
    html+=buildResultHtml(result);
  }
  if (counterResult) {
    const cAtt=gameState?.units.find(u=>u.id===counterResult.attackerId);
    const cDef=gameState?.units.find(u=>u.id===counterResult.defenderId);
    const cAttName=cAtt?.name||counterResult.attackerId,cDefName=cDef?.name||counterResult.defenderId;
    const cAttCls=cAtt?.team==='blue'?'cm-blue':'cm-red';
    const cDefCls=cDef?.team==='blue'?'cm-blue':'cm-red';
    html+=`<div class="br-counter-header">── Contrataque ──</div>`;
    html+=`<div class="br-combatants"><span class="${cAttCls}">${cAttName}</span><span class="br-arrow"> ↩ </span><span class="${cDefCls}">${cDefName}</span><span class="br-wpn-tag"> [${(counterResult.weaponType||'').toUpperCase()}]</span></div>`;
    if (counterResult.advantage) {
      const cBonusLabel=cAtt?.team===myRole?'SUA FORÇA':'FORÇA ADVERSÁRIA';
      html+=`<div class="br-init-bonus">★ Bônus de iniciativa: ${cBonusLabel} (2d6, maior valor)</div>`;
    }
    html+=buildResultHtml(counterResult);
  }
  if (facilitatorNote) {
    html+=`<div class="br-row br-fac-note">${facilitatorNote}</div>`;
  }
  $('br-panel-body').innerHTML=html;
  $('br-decision').classList.add('hidden');
  $('br-waiting').classList.add('hidden');
  $('br-ok-area').classList.add('hidden');
  if (mustDecide&&!singleRound&&!result?.destroyed&&myRole!=='facilitator') {
    $('br-decision').classList.remove('hidden');
  } else {
    const label=brQueue.length>0?'Próximo ▶':'OK ✓';
    $('br-btn-ok').textContent=label;
    $('br-ok-area').classList.remove('hidden');
  }
  const brEl = $('br-panel');
  brEl.classList.remove('hidden', 'br-anim');
  void brEl.offsetWidth;
  brEl.classList.add('br-anim');
}

// ─── Guerra Cibernética: painel do jogador ───────────────────────────────────
function cyberEnemyTeam() { return myRole === 'blue' ? 'red' : 'blue'; }
function cyberEnemyTeamLabel() { return myRole === 'blue' ? 'Força Vermelha' : 'Força Azul'; }

function cyberUseCard(cardId) {
  if (!gameState) return;
  const hand = gameState.cyber?.[myRole];
  const card = hand?.offensiveCards.find(c => c.id === cardId);
  if (!card || card.used) return;
  if (cyberQueue.some(op => op.cardId === cardId)) return; // já na fila
  const effectDef = CYBER_EFFECTS[card.effectId];
  if (!effectDef) return;

  if (effectDef.targetType === 'team') {
    cyberQueue.push({
      cardId: card.id, effectId: card.effectId, targetType: 'team',
      targetId: cyberEnemyTeam(), targetLabel: cyberEnemyTeamLabel(),
      justification: '', secret: false,
    });
    cyberTargetingCard = null;
    renderCyberPanel();
    return;
  }

  cyberTargetingCard = card;
  renderCyberPanel();
}

function cyberCancelTargeting() {
  cyberTargetingCard = null;
  renderCyberPanel();
}

function handleCyberTargetClick(col, row) {
  const card = cyberTargetingCard;
  if (!card || !gameState) return;
  const effectDef = CYBER_EFFECTS[card.effectId];
  if (!effectDef) return;
  const enemyTeam = cyberEnemyTeam();
  const target = gameState.units.find(u => u.col === col && u.row === row && u.hp > 0 && u.team === enemyTeam && !u.isFakeContact);
  if (!target) { flashError('Selecione uma unidade inimiga detectada.'); return; }
  if (effectDef.targetType === 'infrastructure' && !INFRA_TYPES.includes(target.type)) {
    flashError('Selecione uma infraestrutura (porto, base, etc.) inimiga.');
    return;
  }
  cyberQueue.push({
    cardId: card.id, effectId: card.effectId, targetType: effectDef.targetType,
    targetId: target.id, targetLabel: target.name, justification: '', secret: false,
  });
  cyberTargetingCard = null;
  renderCyberPanel();
}

function cyberRemoveQueueItem(idx) {
  cyberQueue.splice(idx, 1);
  renderCyberPanel();
}

function cyberUpdateJustification(idx, value) {
  if (cyberQueue[idx]) cyberQueue[idx].justification = value.slice(0, 300);
}

function cyberToggleSecret(idx, checked) {
  if (cyberQueue[idx]) cyberQueue[idx].secret = checked;
}

function cyberToggleDefense(cardId, checked) {
  if (checked) cyberDefenseActive.add(cardId); else cyberDefenseActive.delete(cardId);
}

function cyberSubmit() {
  const operations = cyberQueue.map(op => ({
    cardId: op.cardId, effectId: op.effectId, targetId: op.targetId,
    justification: op.justification, secret: op.secret,
  }));
  socket.emit('cyber_submit', { operations, defenseCardIds: [...cyberDefenseActive] });
  cyberQueue = []; cyberTargetingCard = null; cyberDefenseActive.clear();
}

function renderCyberPanel() {
  if (myRole === 'facilitator' || !gameState) return;
  const statusEl  = $('cyber-status');
  const contentEl = $('cyber-content');
  if (!statusEl || !contentEl) return;

  const cyber = gameState.cyber;
  const hand  = cyber?.[myRole];
  if (!hand) { statusEl.textContent = ''; contentEl.innerHTML = ''; return; }

  if (gameState.phase !== 'cyber') {
    statusEl.textContent = '';
    contentEl.innerHTML = '';
    return;
  }

  if (hand.submitted) {
    statusEl.innerHTML = '✔ Operações cibernéticas declaradas. Aguardando o oponente / Facilitador...' +
      activeCyberEffectsHtml(myRole);
    contentEl.innerHTML = '';
    return;
  }

  const usedCount = hand.offensiveCards.filter(c => c.used || cyberQueue.some(op => op.cardId === c.id)).length;
  statusEl.innerHTML = `Cartas ofensivas usadas: ${usedCount}/${hand.offensiveCards.length}` +
    activeCyberEffectsHtml(myRole);

  let html = '';

  if (cyberTargetingCard) {
    const effectDef = CYBER_EFFECTS[cyberTargetingCard.effectId];
    html += `<div class="cyber-targeting-hint">
      🎯 Selecione no mapa o alvo para "${escHtml(effectDef?.name || '')}".
      <button class="fac-small-btn" style="margin-top:4px" onclick="cyberCancelTargeting()">Cancelar</button>
    </div>`;
  }

  // Operações na fila
  if (cyberQueue.length > 0) {
    html += '<div class="cyber-section-title">Operações na Fila</div>';
    cyberQueue.forEach((op, idx) => {
      const effectDef = CYBER_EFFECTS[op.effectId];
      html += `<div class="cyber-queue-item">
        <div class="cyq-row">
          <span><b>${escHtml(effectDef?.name || op.effectId)}</b> → ${escHtml(op.targetLabel)}</span>
          <button class="fac-small-btn red" onclick="cyberRemoveQueueItem(${idx})">✕</button>
        </div>
        <textarea class="fac-input fac-input-sm" rows="2" placeholder="Justificativa (opcional)..."
          onchange="cyberUpdateJustification(${idx}, this.value)">${escHtml(op.justification || '')}</textarea>
        <label class="cyber-def-row"><input type="checkbox" ${op.secret ? 'checked' : ''}
          onchange="cyberToggleSecret(${idx}, this.checked)"> Operação Secreta</label>
      </div>`;
    });
  }

  // Cartas ofensivas
  html += '<div class="cyber-section-title">Cartas Ofensivas</div>';
  hand.offensiveCards.forEach(card => {
    const effectDef = CYBER_EFFECTS[card.effectId];
    if (!effectDef) return;
    const queued = cyberQueue.some(op => op.cardId === card.id);
    const disabled = card.used || queued;
    html += `<div class="cyber-card${disabled ? ' used' : ''}">
      <div class="cyber-card-name">${escHtml(effectDef.name)}</div>
      <div class="cyber-card-badges">
        <span class="cyber-badge lvl-${effectDef.level}">${escHtml(CYBER_LEVEL_LABELS[effectDef.level] || '')}</span>
        <span class="cyber-badge">${escHtml(CYBER_CATEGORY_LABELS[effectDef.category] || '')}</span>
      </div>
      <div class="cyber-card-desc">${escHtml(effectDef.description)}</div>
      ${disabled ? '' : `<button class="act-btn blue fac-small-btn cyber-card-btn" onclick="cyberUseCard('${card.id}')">Usar</button>`}
      ${queued ? '<div class="cyber-card-desc">Na fila para envio.</div>' : ''}
      ${card.used && !queued ? '<div class="cyber-card-desc">Já utilizada.</div>' : ''}
    </div>`;
  });

  // Cartas defensivas
  html += '<div class="cyber-section-title">Cartas Defensivas (este turno)</div>';
  hand.defensiveCards.forEach(card => {
    const effectDef = CYBER_DEFENSE_EFFECTS[card.effectId];
    if (!effectDef) return;
    html += `<label class="cyber-def-row">
      <input type="checkbox" ${cyberDefenseActive.has(card.id) ? 'checked' : ''}
        onchange="cyberToggleDefense('${card.id}', this.checked)">
      <span class="cyber-card-desc"><b>${escHtml(effectDef.name)}</b> — ${escHtml(effectDef.description)}</span>
    </label>`;
  });

  html += `<button class="act-btn yellow cyber-submit-btn" onclick="cyberSubmit()">✔ Concluir Fase Cibernética</button>`;

  contentEl.innerHTML = html;
}
