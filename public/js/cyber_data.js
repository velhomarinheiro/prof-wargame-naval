'use strict';
// ─── Guerra Cibernética: dados de exibição (espelha shared/cyber_config.js) ───

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

const RESULT_LABELS = {
  fail:     'Falha',
  partial:  'Sucesso Parcial',
  success:  'Sucesso',
  critical: 'Sucesso Crítico',
};

const CYBER_EFFECTS = {
  falso_contato: {
    id: 'falso_contato', name: 'Falso Contato', level: 1, category: 'enganoso',
    targetType: 'unit', kind: 'fake_contact',
    description: 'Cria contatos falsos próximos à unidade-alvo, visíveis ao oponente.',
  },
  radar_degradado: {
    id: 'radar_degradado', name: 'Radar Degradado', level: 1, category: 'isr',
    targetType: 'unit', kind: 'modifier',
    description: 'Reduz o alcance de detecção da unidade-alvo.',
  },
  ais_corrompido: {
    id: 'ais_corrompido', name: 'AIS Corrompido', level: 1, category: 'navegacao',
    targetType: 'unit', kind: 'modifier',
    description: 'Corrompe o sinal AIS da unidade-alvo, dificultando sua detecção pelo oponente.',
  },
  bloqueio_link: {
    id: 'bloqueio_link', name: 'Bloqueio de Enlace de Dados', level: 1, category: 'combate',
    targetType: 'unit', kind: 'modifier',
    description: 'Interrompe o enlace de dados da unidade-alvo, impedindo-a de declarar ataques.',
  },
  degradacao_ecm: {
    id: 'degradacao_ecm', name: 'Degradar ECM', level: 1, category: 'combate',
    targetType: 'unit', kind: 'modifier',
    description: 'Degrada as contramedidas eletrônicas da unidade-alvo, anulando sua interceptação de ataques recebidos.',
  },
  degradacao_targeting: {
    id: 'degradacao_targeting', name: 'Degradação de Targeting', level: 1, category: 'combate',
    targetType: 'unit', kind: 'modifier',
    description: 'Degrada o sistema de mira da unidade-alvo, reduzindo a quantidade de munição empregada por ataque.',
  },
  interrupcao_c2: {
    id: 'interrupcao_c2', name: 'Interrupção de C2', level: 2, category: 'comando',
    targetType: 'team', kind: 'modifier',
    description: 'Interrompe o comando e controle da força-alvo: nenhuma unidade pode se mover ou atacar no próximo turno.',
  },
  perda_consciencia: {
    id: 'perda_consciencia', name: 'Perda de Consciência Situacional', level: 2, category: 'isr',
    targetType: 'team', kind: 'modifier',
    description: 'Reduz o alcance de detecção de toda a força-alvo.',
  },
  interferencia_logistica: {
    id: 'interferencia_logistica', name: 'Interferência Logística', level: 2, category: 'logistica',
    targetType: 'team', kind: 'modifier',
    description: 'Interrompe a rede logística da força-alvo: nenhum reabastecimento permitido.',
  },
  ataque_porto: {
    id: 'ataque_porto', name: 'Ataque a Porto/Base', level: 2, category: 'logistica',
    targetType: 'infrastructure', kind: 'modifier',
    description: 'Ataca a infraestrutura portuária/aérea-alvo: a instalação não pode reabastecer unidades.',
  },
  ataque_rede_combustivel: {
    id: 'ataque_rede_combustivel', name: 'Ataque à Rede de Combustível', level: 2, category: 'logistica',
    targetType: 'team', kind: 'modifier',
    description: 'Compromete a rede de combustível da força-alvo: recuperação de combustível naval/aéreo bloqueada.',
  },
  ataque_satelite: {
    id: 'ataque_satelite', name: 'Ataque a Satélites', level: 3, category: 'isr',
    targetType: 'team', kind: 'modifier',
    description: 'Degrada significativamente a capacidade de ISR de toda a força-alvo.',
  },
  ataque_rede_eletrica: {
    id: 'ataque_rede_eletrica', name: 'Ataque à Rede Elétrica', level: 3, category: 'logistica',
    targetType: 'team', kind: 'modifier',
    description: 'Ataca a infraestrutura energética: portos e bases aéreas da força-alvo não reabastecem unidades, e a recuperação de combustível é bloqueada.',
  },
  ataque_telecom: {
    id: 'ataque_telecom', name: 'Ataque a Telecomunicações', level: 3, category: 'comando',
    targetType: 'team', kind: 'modifier',
    description: 'Colapsa as telecomunicações da força-alvo: nenhuma unidade pode se mover ou atacar no próximo turno.',
  },
  campanha_desinformacao: {
    id: 'campanha_desinformacao', name: 'Campanha de Desinformação', level: 3, category: 'enganoso',
    targetType: 'team', kind: 'message',
    description: 'Envia uma mensagem de inteligência (verdadeira, parcial ou falsa) ao oponente, definida pelo Facilitador.',
  },
};

const CYBER_DEFENSE_EFFECTS = {
  escudo_isr: {
    id: 'escudo_isr', name: 'Escudo de ISR', counters: 'isr',
    description: 'Reduz a chance de operações cibernéticas de ISR contra sua força.',
  },
  contramedida_combate: {
    id: 'contramedida_combate', name: 'Contramedida de Combate', counters: 'combate',
    description: 'Reduz a chance de operações cibernéticas de Combate contra sua força.',
  },
  redundancia_logistica: {
    id: 'redundancia_logistica', name: 'Redundância Logística', counters: 'logistica',
    description: 'Reduz a chance de operações cibernéticas de Logística contra sua força.',
  },
};

const INFRA_TYPES = ['porto', 'aeroporto', 'carrier', 'fpso', 'base_naval', 'bateria_ada', 'bateria_costeira'];
