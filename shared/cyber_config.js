'use strict';

// ─── Guerra Cibernética: catálogo de efeitos, decks e utilidades ──────────────
// Inspirado em War at Sea, adaptado para um ambiente com Facilitador.

const CYBER_CATEGORY_LABELS = {
  isr:       'ISR',
  navegacao: 'Navegação',
  comando:   'Comando e Controle',
  combate:   'Combate',
  logistica: 'Logística',
  enganoso:  'Engano',
};

const CYBER_LEVEL_LABELS = {
  1: 'Cyber Tático',
  2: 'Cyber Operacional',
  3: 'Cyber Estratégico',
};

const RESULT_TIERS  = ['fail', 'partial', 'success', 'critical'];
const RESULT_LABELS = {
  fail:     'Falha',
  partial:  'Sucesso Parcial',
  success:  'Sucesso',
  critical: 'Sucesso Crítico',
};

// ─── Biblioteca de efeitos cibernéticos ───────────────────────────────────────
// kind: 'modifier' | 'fake_contact' | 'message'
// targetType: 'unit' | 'infrastructure' | 'team'
// scope: 'unit' | 'team'  (alcance do efeito quando aplicado)
const CYBER_EFFECTS = {
  // ── Nível 1 — Cyber Tático (alvo: unidade específica) ────────────────────────
  falso_contato: {
    id: 'falso_contato', name: 'Falso Contato', level: 1, category: 'enganoso',
    targetType: 'unit', baseChance: 65, duration: 1, scope: 'unit',
    description: 'Cria contatos falsos próximos à unidade-alvo, visíveis ao oponente.',
    kind: 'fake_contact', fakeContactCount: 2,
  },
  radar_degradado: {
    id: 'radar_degradado', name: 'Radar Degradado', level: 1, category: 'isr',
    targetType: 'unit', baseChance: 60, duration: 2, scope: 'unit',
    description: 'Reduz o alcance de detecção da unidade-alvo.',
    kind: 'modifier', modifiers: { detectionRange: -1 },
  },
  ais_corrompido: {
    id: 'ais_corrompido', name: 'AIS Corrompido', level: 1, category: 'navegacao',
    targetType: 'unit', baseChance: 60, duration: 1, scope: 'unit',
    description: 'Corrompe o sinal AIS da unidade-alvo, dificultando sua detecção pelo oponente.',
    kind: 'modifier', modifiers: { stealthBonus: 1 },
  },
  bloqueio_link: {
    id: 'bloqueio_link', name: 'Bloqueio de Enlace de Dados', level: 1, category: 'combate',
    targetType: 'unit', baseChance: 55, duration: 1, scope: 'unit',
    description: 'Interrompe o enlace de dados da unidade-alvo, impedindo-a de declarar ataques.',
    kind: 'modifier', modifiers: { attackDisabled: 1 },
  },
  degradacao_ecm: {
    id: 'degradacao_ecm', name: 'Degradar ECM', level: 1, category: 'combate',
    targetType: 'unit', baseChance: 55, duration: 2, scope: 'unit',
    description: 'Degrada as contramedidas eletrônicas da unidade-alvo, anulando sua interceptação de ataques recebidos.',
    kind: 'modifier', modifiers: { ecmDegraded: 1 },
  },
  degradacao_targeting: {
    id: 'degradacao_targeting', name: 'Degradação de Targeting', level: 1, category: 'combate',
    targetType: 'unit', baseChance: 55, duration: 2, scope: 'unit',
    description: 'Degrada o sistema de mira da unidade-alvo, reduzindo a quantidade de munição empregada por ataque.',
    kind: 'modifier', modifiers: { attackAmountMalus: 1 },
  },

  // ── Nível 2 — Cyber Operacional (alvo: formação / infraestrutura) ────────────
  interrupcao_c2: {
    id: 'interrupcao_c2', name: 'Interrupção de C2', level: 2, category: 'comando',
    targetType: 'team', baseChance: 50, duration: 1, scope: 'team',
    description: 'Interrompe o comando e controle da força-alvo: nenhuma unidade pode se mover ou atacar no próximo turno.',
    kind: 'modifier', modifiers: { moveDisabled: 1, attackDisabled: 1 },
  },
  perda_consciencia: {
    id: 'perda_consciencia', name: 'Perda de Consciência Situacional', level: 2, category: 'isr',
    targetType: 'team', baseChance: 55, duration: 2, scope: 'team',
    description: 'Reduz o alcance de detecção de toda a força-alvo.',
    kind: 'modifier', modifiers: { detectionRange: -1 },
  },
  interferencia_logistica: {
    id: 'interferencia_logistica', name: 'Interferência Logística', level: 2, category: 'logistica',
    targetType: 'team', baseChance: 55, duration: 2, scope: 'team',
    description: 'Interrompe a rede logística da força-alvo: nenhum reabastecimento permitido.',
    kind: 'modifier', modifiers: { resupplyBlocked: 1, fuelRecoveryBlocked: 1 },
  },
  ataque_porto: {
    id: 'ataque_porto', name: 'Ataque a Porto/Base', level: 2, category: 'logistica',
    targetType: 'infrastructure', baseChance: 50, duration: 2, scope: 'unit',
    description: 'Ataca a infraestrutura portuária/aérea-alvo: a instalação não pode reabastecer unidades.',
    kind: 'modifier', modifiers: { resupplyBlocked: 1 },
  },
  ataque_rede_combustivel: {
    id: 'ataque_rede_combustivel', name: 'Ataque à Rede de Combustível', level: 2, category: 'logistica',
    targetType: 'team', baseChance: 50, duration: 2, scope: 'team',
    description: 'Compromete a rede de combustível da força-alvo: recuperação de combustível naval/aéreo bloqueada.',
    kind: 'modifier', modifiers: { fuelRecoveryBlocked: 1 },
  },

  // ── Nível 3 — Cyber Estratégico (alvo: força / teatro) ───────────────────────
  ataque_satelite: {
    id: 'ataque_satelite', name: 'Ataque a Satélites', level: 3, category: 'isr',
    targetType: 'team', baseChance: 45, duration: 2, scope: 'team',
    description: 'Degrada significativamente a capacidade de ISR de toda a força-alvo.',
    kind: 'modifier', modifiers: { detectionRange: -2 },
  },
  ataque_rede_eletrica: {
    id: 'ataque_rede_eletrica', name: 'Ataque à Rede Elétrica', level: 3, category: 'logistica',
    targetType: 'team', baseChance: 45, duration: 2, scope: 'team',
    description: 'Ataca a infraestrutura energética: portos e bases aéreas da força-alvo não reabastecem unidades, e a recuperação de combustível é bloqueada.',
    kind: 'modifier', modifiers: { resupplyBlocked: 1, fuelRecoveryBlocked: 1 },
  },
  ataque_telecom: {
    id: 'ataque_telecom', name: 'Ataque a Telecomunicações', level: 3, category: 'comando',
    targetType: 'team', baseChance: 40, duration: 1, scope: 'team',
    description: 'Colapsa as telecomunicações da força-alvo: nenhuma unidade pode se mover ou atacar no próximo turno.',
    kind: 'modifier', modifiers: { moveDisabled: 1, attackDisabled: 1 },
  },
  campanha_desinformacao: {
    id: 'campanha_desinformacao', name: 'Campanha de Desinformação', level: 3, category: 'enganoso',
    targetType: 'team', baseChance: 60, duration: 1, scope: 'team',
    description: 'Envia uma mensagem de inteligência (verdadeira, parcial ou falsa) ao oponente, definida pelo Facilitador.',
    kind: 'message',
  },
};

// ─── Cartas defensivas ─────────────────────────────────────────────────────────
// Quando ativas no turno, reduzem a chance de sucesso de operações ofensivas
// inimigas da mesma categoria contra a equipe. Retornam ao estoque a cada turno.
const CYBER_DEFENSE_EFFECTS = {
  escudo_isr: {
    id: 'escudo_isr', name: 'Escudo de ISR', counters: 'isr', reduction: 25,
    description: 'Reduz a chance de operações cibernéticas de ISR contra sua força.',
  },
  contramedida_combate: {
    id: 'contramedida_combate', name: 'Contramedida de Combate', counters: 'combate', reduction: 25,
    description: 'Reduz a chance de operações cibernéticas de Combate contra sua força.',
  },
  redundancia_logistica: {
    id: 'redundancia_logistica', name: 'Redundância Logística', counters: 'logistica', reduction: 25,
    description: 'Reduz a chance de operações cibernéticas de Logística contra sua força.',
  },
};

// Mãos iniciais (iguais para as duas equipes)
const STARTING_OFFENSIVE = [
  'radar_degradado', 'falso_contato', 'interrupcao_c2',
  'interferencia_logistica', 'ataque_satelite',
];
const STARTING_DEFENSIVE = [
  'escudo_isr', 'contramedida_combate', 'redundancia_logistica',
];

function buildStartingHand(team) {
  return {
    offensiveCards: STARTING_OFFENSIVE.map((effectId, i) => ({ id: `${team.toUpperCase()}-OFF-${i + 1}`, effectId, used: false })),
    defensiveCards: STARTING_DEFENSIVE.map((effectId, i) => ({ id: `${team.toUpperCase()}-DEF-${i + 1}`, effectId, active: false })),
    submitted: false,
  };
}

// ─── Escala o efeito conforme o resultado decidido pelo Facilitador ───────────
function scaleCyberEffect(effectDef, resultTier) {
  if (resultTier === 'fail') return null;
  let duration = effectDef.duration;
  const modifiers = { ...(effectDef.modifiers || {}) };
  let fakeContactCount = effectDef.fakeContactCount;

  if (resultTier === 'partial') {
    duration = Math.max(1, Math.ceil(duration / 2));
    for (const k of Object.keys(modifiers)) {
      const v = modifiers[k];
      if (Math.abs(v) > 1) modifiers[k] = Math.sign(v) * Math.ceil(Math.abs(v) / 2);
    }
    if (fakeContactCount) fakeContactCount = Math.max(1, Math.ceil(fakeContactCount / 2));
  } else if (resultTier === 'critical') {
    duration += 1;
    for (const k of Object.keys(modifiers)) {
      modifiers[k] += Math.sign(modifiers[k]);
    }
    if (fakeContactCount) fakeContactCount += 1;
  }

  return { duration, modifiers, fakeContactCount };
}

// ─── Sugestão automática de resultado (chance % + sorteio) ────────────────────
function computeCyberSuggestion(cyberState, attackerTeam, defenderTeam, effectDef) {
  let chance = effectDef.baseChance;
  const defense = cyberState?.[defenderTeam];
  if (defense) {
    for (const card of defense.defensiveCards || []) {
      if (!card.active) continue;
      const defEffect = CYBER_DEFENSE_EFFECTS[card.effectId];
      if (defEffect && defEffect.counters === effectDef.category) chance -= defEffect.reduction;
    }
  }
  chance = Math.max(10, Math.min(95, chance));
  const roll = Math.random() * 100;
  let result;
  if (roll > chance) result = 'fail';
  else if (roll <= chance / 3) result = 'critical';
  else if (roll <= (chance * 2) / 3) result = 'success';
  else result = 'partial';
  return { chance: Math.round(chance), result };
}

module.exports = {
  CYBER_EFFECTS,
  CYBER_DEFENSE_EFFECTS,
  CYBER_CATEGORY_LABELS,
  CYBER_LEVEL_LABELS,
  RESULT_TIERS,
  RESULT_LABELS,
  STARTING_OFFENSIVE,
  STARTING_DEFENSIVE,
  buildStartingHand,
  scaleCyberEffect,
  computeCyberSuggestion,
};
