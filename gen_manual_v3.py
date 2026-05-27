#!/usr/bin/env python3
"""Generate manual_jogador_v3.docx — player manual v3.0 for Operacao Atlantico Sul."""

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# ── Palette ──────────────────────────────────────────────────────────────────
NAVY   = RGBColor(0x07, 0x19, 0x29)
BLUE   = RGBColor(0x15, 0x65, 0xc0)
BLUE_L = RGBColor(0x82, 0xb1, 0xff)
RED    = RGBColor(0xb7, 0x1c, 0x1c)
RED_L  = RGBColor(0xff, 0x8a, 0x80)
GOLD   = RGBColor(0xc9, 0xa8, 0x4c)
WHITE  = RGBColor(0xff, 0xff, 0xff)
LIGHT  = RGBColor(0xd0, 0xe8, 0xf4)
DIM    = RGBColor(0x5a, 0x8a, 0xaa)
GREEN  = RGBColor(0x00, 0x80, 0x40)
ORANGE = RGBColor(0xe6, 0x5c, 0x00)
TEAL   = RGBColor(0x00, 0x6e, 0x6e)

def set_cell_bg(cell, hex_color):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)

def set_cell_border(cell, top=None, bottom=None, left=None, right=None):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    tcBorders = OxmlElement('w:tcBorders')
    for side, val in [('top', top), ('bottom', bottom), ('left', left), ('right', right)]:
        if val:
            el = OxmlElement(f'w:{side}')
            el.set(qn('w:val'), val.get('val', 'single'))
            el.set(qn('w:sz'), str(val.get('sz', 4)))
            el.set(qn('w:color'), val.get('color', '000000'))
            tcBorders.append(el)
    tcPr.append(tcBorders)

def page_break(doc):
    doc.add_paragraph().add_run().add_break(
        __import__('docx.enum.text', fromlist=['WD_BREAK']).WD_BREAK.PAGE)

doc = Document()

# ── Page setup (A4 portrait) ─────────────────────────────────────────────────
section = doc.sections[0]
section.page_width    = Cm(21)
section.page_height   = Cm(29.7)
section.top_margin    = Cm(2)
section.bottom_margin = Cm(2)
section.left_margin   = Cm(2.2)
section.right_margin  = Cm(2.2)

style = doc.styles['Normal']
style.font.name = 'Calibri'
style.font.size = Pt(10)
style.font.color.rgb = RGBColor(0x1a, 0x1a, 0x2e)

# ── Helpers ───────────────────────────────────────────────────────────────────
def h1(text, color=NAVY):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after  = Pt(4)
    run = p.add_run(text)
    run.font.name = 'Calibri'; run.font.size = Pt(16); run.font.bold = True
    run.font.color.rgb = color
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bot = OxmlElement('w:bottom')
    bot.set(qn('w:val'), 'single'); bot.set(qn('w:sz'), '8')
    bot.set(qn('w:color'), '{:02X}{:02X}{:02X}'.format(*color))
    pBdr.append(bot); pPr.append(pBdr)
    return p

def h2(text, color=BLUE):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after  = Pt(3)
    run = p.add_run(text)
    run.font.name = 'Calibri'; run.font.size = Pt(12); run.font.bold = True
    run.font.color.rgb = color
    return p

def h3(text, color=DIM):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after  = Pt(2)
    run = p.add_run(text)
    run.font.name = 'Calibri'; run.font.size = Pt(10.5); run.font.bold = True
    run.font.color.rgb = color
    return p

def body(text, space_after=4):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after  = Pt(space_after)
    run = p.add_run(text)
    run.font.name = 'Calibri'; run.font.size = Pt(10)
    return p

def bullet(text, level=0, color=None):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.left_indent  = Cm(0.8 + level * 0.5)
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after  = Pt(2)
    run = p.add_run(text)
    run.font.name = 'Calibri'; run.font.size = Pt(10)
    if color: run.font.color.rgb = color
    return p

def note_box(text, bg='E8F4FF', border_color='1565C0'):
    tbl = doc.add_table(rows=1, cols=1)
    tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
    cell = tbl.cell(0, 0)
    cell.width = Cm(16.6)
    set_cell_bg(cell, bg)
    set_cell_border(cell,
        top    = {'val':'single','sz':6,'color':border_color},
        bottom = {'val':'single','sz':6,'color':border_color},
        left   = {'val':'single','sz':12,'color':border_color},
        right  = {'val':'single','sz':6,'color':border_color},
    )
    p = cell.paragraphs[0]
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after  = Pt(4)
    p.paragraph_format.left_indent  = Cm(0.3)
    r = p.add_run(text)
    r.font.name = 'Calibri'; r.font.size = Pt(9.5)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return tbl

def make_table(headers, rows, col_widths=None, header_bg='071929',
               header_color=WHITE, alt_bg='EEF4FF'):
    n = len(headers)
    tbl = doc.add_table(rows=1 + len(rows), cols=n)
    tbl.style = 'Table Grid'
    tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
    hdr = tbl.rows[0]
    for i, h in enumerate(headers):
        cell = hdr.cells[i]
        set_cell_bg(cell, header_bg)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h)
        r.font.bold = True; r.font.name = 'Calibri'
        r.font.size = Pt(9); r.font.color.rgb = header_color
    for ri, row in enumerate(rows):
        bg = 'FFFFFF' if ri % 2 == 0 else alt_bg
        for ci, val in enumerate(row):
            cell = tbl.rows[ri+1].cells[ci]
            set_cell_bg(cell, bg)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(str(val))
            r.font.name = 'Calibri'; r.font.size = Pt(9)
    if col_widths:
        for ri2 in range(len(rows)+1):
            for ci2, w in enumerate(col_widths):
                tbl.rows[ri2].cells[ci2].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return tbl

# ═══════════════════════════════════════════════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════════════════════════════════════════════
tbl_cover = doc.add_table(rows=1, cols=1)
cell0 = tbl_cover.cell(0, 0)
set_cell_bg(cell0, '071929')
cell0.width = Cm(16.6)
p0 = cell0.paragraphs[0]
p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
p0.paragraph_format.space_before = Pt(18)
p0.paragraph_format.space_after  = Pt(2)
r0 = p0.add_run('OPERAÇÃO ATLÂNTICO SUL')
r0.font.name = 'Calibri'; r0.font.size = Pt(22); r0.font.bold = True
r0.font.color.rgb = WHITE
p1 = cell0.add_paragraph()
p1.alignment = WD_ALIGN_PARAGRAPH.CENTER
p1.paragraph_format.space_before = Pt(0)
p1.paragraph_format.space_after  = Pt(18)
r1 = p1.add_run('Wargame Naval Estratégico — 2 Jogadores')
r1.font.name = 'Calibri'; r1.font.size = Pt(11); r1.font.color.rgb = LIGHT

doc.add_paragraph()
p_title = doc.add_paragraph()
p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER
p_title.paragraph_format.space_after = Pt(4)
rt = p_title.add_run('MANUAL DO JOGADOR')
rt.font.name = 'Calibri'; rt.font.size = Pt(28); rt.font.bold = True
rt.font.color.rgb = NAVY

p_sub = doc.add_paragraph()
p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
p_sub.paragraph_format.space_after = Pt(30)
rs = p_sub.add_run('Guia Completo de Referência')
rs.font.name = 'Calibri'; rs.font.size = Pt(13); rs.font.color.rgb = DIM

p_ver = doc.add_paragraph()
p_ver.alignment = WD_ALIGN_PARAGRAPH.CENTER
rv = p_ver.add_run('Versão 3.0')
rv.font.name = 'Calibri'; rv.font.size = Pt(10); rv.font.color.rgb = DIM
rv.font.italic = True

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# SUMÁRIO
# ═══════════════════════════════════════════════════════════════════════════════
h1('SUMÁRIO', NAVY)
toc_items = [
    ('1.',    'Visão Geral do Jogo'),
    ('2.',    'Como Iniciar uma Partida'),
    ('3.',    'O Tabuleiro — Mapa Hexagonal'),
    ('4.',    'Estrutura de um Turno'),
    ('5.',    'Sistema de Pontos de Combustível (FP)'),
    ('  5.1', 'FP Naval — Superfície e Submarinos'),
    ('  5.2', 'FP Aéreo — Aeronaves'),
    ('  5.3', 'Reabastecimento Naval'),
    ('  5.4', 'Reabastecimento e Recompletamento Aéreo'),
    ('6.',    'Fase de Movimentação'),
    ('7.',    'Fase de Combate'),
    ('  7.1', 'Declarar Ataques e Selecionar Salva'),
    ('  7.2', 'Seleção Automática de Arma'),
    ('  7.3', 'Tipos de Armas e Salvas'),
    ('  7.4', 'Sistema de Battle Rounds (2 Rodadas)'),
    ('  7.5', 'Decisão de Continuar ou Parar'),
    ('  7.6', 'Bônus de Iniciativa'),
    ('  7.7', 'Contrataque no Battle Round 2'),
    ('  7.8', 'Resolução de Dano — Sistema d6'),
    ('  7.9', 'Interceptação de Mísseis'),
    ('  7.10','Staying Power (SP) e Destruição'),
    ('8.',    'Sistema de Detecção e Névoa de Guerra'),
    ('9.',    'Recompletamento de Munição'),
    ('10.',   'Condição de Vitória'),
    ('11.',   'Catálogo de Plataformas — Força Azul'),
    ('12.',   'Catálogo de Plataformas — Força Vermelha'),
    ('13.',   'Referência Rápida'),
]
for num, title in toc_items:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after  = Pt(2)
    rn = p.add_run(f'{num}  ')
    rn.font.name = 'Calibri'; rn.font.size = Pt(10); rn.font.bold = True
    rn.font.color.rgb = BLUE
    rt2 = p.add_run(title)
    rt2.font.name = 'Calibri'; rt2.font.size = Pt(10)

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 1. VISÃO GERAL
# ═══════════════════════════════════════════════════════════════════════════════
h1('1. Visão Geral do Jogo')
body('Operação Atlântico Sul é um wargame naval estratégico para dois jogadores disputado em um mapa hexagonal que representa o litoral sudeste brasileiro e as águas adjacentes do Atlântico Sul. Um jogador comanda a Força Azul (defensora, Brasil) e o outro comanda a Força Vermelha (atacante, potência adversária fictícia).')
body('O jogo é disputado em turnos compostos por dois períodos: Diurno e Noturno. Cada período contém uma Fase de Movimentação seguida de uma Fase de Combate. Os movimentos de ambos os lados são revelados simultaneamente somente após os dois jogadores confirmarem o fim da fase de movimentação.')

h2('Objetivo Estratégico')
bullet('Força Azul: defender as plataformas petrolíferas (FPSOs), os portos e impedir o desembarque anfíbio inimigo no território nacional.', color=BLUE)
bullet('Força Vermelha: projetar poder sobre o litoral brasileiro, neutralizar as FPSOs e as bases navais, e estabelecer um beachhead anfíbio.', color=RED)

h2('Condição de Vitória Imediata')
body('O jogo termina imediatamente quando uma das partes não possuir mais nenhuma unidade com capacidade ofensiva restante. Consulte a Seção 10 para detalhes.')

# ═══════════════════════════════════════════════════════════════════════════════
# 2. COMO INICIAR
# ═══════════════════════════════════════════════════════════════════════════════
h1('2. Como Iniciar uma Partida')
h2('Criar ou Entrar em uma Sala')
bullet('O primeiro jogador clica em "Criar Sala" — receberá um código de sala de 6 letras (ex.: A3F7K2).')
bullet('O segundo jogador digita esse código e clica em "Entrar na Sala".')
bullet('A partida inicia automaticamente quando os dois jogadores estiverem conectados.')
bullet('O primeiro jogador joga como Força Azul; o segundo, como Força Vermelha.')

h2('Tela de Jogo')
bullet('O mapa hexagonal ocupa a maior parte da tela.')
bullet('À direita: painel lateral com informações da unidade selecionada, botões de ação, log de batalha e indicador de combustível.')
bullet('No topo: turno, período, fase atual e banner "SUA VEZ" quando é seu turno de agir.')

# ═══════════════════════════════════════════════════════════════════════════════
# 3. TABULEIRO
# ═══════════════════════════════════════════════════════════════════════════════
h1('3. O Tabuleiro — Mapa Hexagonal')
body('O mapa possui 16 colunas (A–P, oeste a leste) e 10 linhas (1–10, norte a sul), totalizando 160 hexágonos de topo plano. As coordenadas são exibidas nas bordas do mapa. A área retratada corresponde ao litoral entre Vitória/ES (norte) e o sul do estado do Paraná.')

h2('Tipos de Terreno')
make_table(
    ['Cor', 'Tipo', 'Restrições de Entrada'],
    [
        ['Areia / bege',  'Área Terrestre (T_LAND)',         'Somente unidades aéreas e terrestres'],
        ['Azul claro',    'Águas Rasas <200m',               'Proibido a submarinos'],
        ['Azul médio',    'Plataforma Continental',          'Sem restrições navais'],
        ['Azul escuro',   'Águas Profundas',                 'Sem restrições; +furtividade submarina'],
        ['Laranja / ★',  'Bacia Petrolífera / FPSO',        'Sem restrições; objetivo estratégico'],
    ],
    col_widths=[3.0, 4.8, 8.8]
)

h2('Infraestrutura Fixa no Mapa')
make_table(
    ['Símbolo', 'Nome', 'Função'],
    [
        ['✛', 'Base Naval do Rio de Janeiro', 'Referência; recompletamento naval'],
        ['⚓', 'Portos (Santos, Rio, Vitória, Açu)', 'Recompletamento naval de superfície e sub'],
        ['✈', 'Bases Aéreas (BA Santa Cruz, BA Santos, AeroCF/BANS)', 'Reabastecimento e recompletamento de aeronaves'],
        ['△', 'FPSOs (PLT-01 a PLT-05)', 'Objetivos estratégicos'],
    ],
    col_widths=[1.5, 6.5, 8.6]
)

# ═══════════════════════════════════════════════════════════════════════════════
# 4. ESTRUTURA DO TURNO
# ═══════════════════════════════════════════════════════════════════════════════
h1('4. Estrutura de um Turno')
body('Cada turno completo é composto por dois períodos: Diurno e Noturno. O jogo começa no Período Diurno do Turno 1. Cada período segue a sequência abaixo:')
make_table(
    ['Etapa', 'Descrição'],
    [
        ['1. Movimentação',    'Ambos os jogadores planejam e confirmam movimentos (simultâneo e secreto). FP são consumidos.'],
        ['2. Revelação',       'Posições reais são reveladas. Novas detecções calculadas com posições finais.'],
        ['3. Combate',         'Ambos declaram ataques → resolução por Battle Rounds sequenciais.'],
        ['4. Recompletamento', 'Ao início do próximo turno: aeronaves reabastecidas retornam ao status Pronta; navios em porto recebem munição.'],
    ],
    col_widths=[3.8, 12.8]
)

# ═══════════════════════════════════════════════════════════════════════════════
# 5. SISTEMA DE PONTOS DE COMBUSTÍVEL (FP)
# ═══════════════════════════════════════════════════════════════════════════════
h1('5. Sistema de Pontos de Combustível (FP)')
body('Todas as unidades navais e aéreas convencionais consomem Pontos de Combustível (FP) para operar. Unidades com propulsão nuclear e plataformas fixas são isentas. O painel lateral exibe o FP atual no formato "X/Y FP" com código de cor: verde (suficiente), amarelo (baixo ≤25%) e vermelho (esgotado).')

# ── 5.1 FP Naval ──
h2('5.1 FP Naval — Superfície e Submarinos Convencionais')
body('Cada navio de superfície e submarino convencional começa o jogo com seu FP máximo. O FP é consumido toda vez que a unidade se movimenta ou permanece estacionária.')

make_table(
    ['Distância percorrida', 'FP gasto'],
    [
        ['0 hex (parado)',   '1 FP'],
        ['1 hex',           '1 FP'],
        ['2 hex',           '2 FP'],
        ['3+ hex',          '3 FP'],
    ],
    col_widths=[7.0, 9.6]
)
body('Limite por turno: máximo de 4 FP por unidade por turno (independente de quantas fases de movimento ocorram).')
body('Consequência de FP = 0: a unidade não pode se mover, não pode atacar e não pode se defender.')

note_box(
    'ISENTOS DE FP NAVAL: Porta-Aviões vermelho (KCV Aurelius Magnus) — propulsão nuclear. '
    'Submarinos nucleares (SNAC Álvaro Alberto e KAR Veylan) — propulsão nuclear. '
    'Plataformas FPSO — estruturas fixas. Unidades terrestres e portos — sem consumo.',
    bg='E8F4FF', border_color='1565C0'
)

h3('FP Máximo por Unidade — Força Azul (Superfície)')
make_table(
    ['ID', 'Nome', 'Composição', 'FP Máx'],
    [
        ['SAG-P',   'SAG Principal',           'NAM Atlântico + helicópteros', '12'],
        ['SAG-1',   'SAG-1',                   '3x Fragata Tamandaré',         '10'],
        ['SAG-2',   'SAG-2',                   '2x Fragata + 2x Corveta',      '10'],
        ['ANFIB',   'Força de Desembarque',    'NDM Bahia + Oiapoque + NCC',   '8'],
        ['APLOG',   'Apoio Logístico',         'NApLog',                       '30'],
        ['REAB',    'Navio Tanque',            'NT Alte Gastão Motta',         '40'],
        ['PAOC1',   'Patrulha Oceânica 1',     '2x NPaOc Apa',                 '10'],
        ['PAOC2',   'Patrulha Oceânica 2',     '2x NPaOc Amazonas',            '10'],
        ['PATC1',   'Patrulha Costeira 1',     '2x NPa Macaé',                 '6'],
        ['PATC2',   'Patrulha Costeira 2',     '4x NPa Grajaú',                '6'],
    ],
    col_widths=[2.0, 3.2, 5.8, 1.7]
)

h3('FP Máximo por Unidade — Força Azul (Submarinos)')
make_table(
    ['ID', 'Nome', 'Tipo', 'FP Máx'],
    [
        ['SBN',  'SNAC Álvaro Alberto', 'Nuclear (isento)',     '∞'],
        ['SB1',  'S40 Riachuelo',       'Convencional AIP',    '20'],
        ['SB2',  'S41 Humaitá',         'Convencional AIP',    '20'],
        ['SB3',  'S42 Tonelero',        'Convencional AIP',    '20'],
    ],
    col_widths=[2.0, 4.0, 4.5, 1.7]
)

h3('FP Máximo por Unidade — Força Vermelha (Superfície)')
make_table(
    ['ID', 'Nome', 'Composição', 'FP Máx'],
    [
        ['ESCCSG', 'Escolta CSG',      'CG Drakhmar + 2x DDG Volnaria', '12'],
        ['SAG1',   'SAG-1',            'DDG + 2x FFG',                  '12'],
        ['SAG2',   'SAG-2',            '3x FFG',                        '10'],
        ['REAB',   'Petroleiro CSG',   'AOR Korvas',                    '24'],
        ['ANFIB-E','Grupo Anfíbio',    'LPD Harnax + 2x LST Morvask',   '12'],
        ['LOG1',   'Grupo Logístico',  'AOR Korvas + AOT Brennar',      '30'],
        ['LOG2',   'Navio Munições',   'AKE Yarven',                    '8'],
        ['CSG',    'KCV Aurelius Magnus','Porta-Aviões (nuclear)',       '∞'],
    ],
    col_widths=[2.0, 3.2, 5.8, 1.7]
)

h3('FP Máximo por Unidade — Força Vermelha (Submarinos)')
make_table(
    ['ID', 'Nome', 'Tipo', 'FP Máx'],
    [
        ['SBN', 'KAR Veylan', 'Nuclear (isento)',  '∞'],
        ['SB',  'KAR Skarn',  'Convencional AIP', '20'],
    ],
    col_widths=[2.0, 4.0, 4.5, 1.7]
)

page_break(doc)

# ── 5.2 FP Aéreo ──
h2('5.2 FP Aéreo — Aeronaves')
body('Aeronaves utilizam o valor de Movimento como FP máximo (ex.: F-39 Gripen mov=8 → 8 FP). O FP representa o combustível embarcado disponível para aquela missão.')

make_table(
    ['Situação', 'FP gasto'],
    [
        ['Por hex de voo (movimento)',           '1 FP por hex'],
        ['Patrulha — aeronave em voo sem mover', '1 FP por turno'],
        ['Em aeroporto ou porta-aviões (status Pronta)', '0 FP'],
    ],
    col_widths=[9.5, 7.1]
)

body('Se uma aeronave ficar com 0 FP enquanto está em voo (status "Em Voo") e não alcançar uma base no fim do turno, ela é perdida.')

h3('FP Máximo por Aeronave')
make_table(
    ['Unidade', 'Aeronave', 'Mov / FP Máx', 'Alcance máximo'],
    [
        ['PATMAR1/2 (Azul)', 'P-3AM Orion',      '16', '16 hex ida'],
        ['PAC1/2 (Azul)',    'F-39E Gripen',      '8',  '8 hex ida'],
        ['APAER1/2 (Azul)',  'AF-1 A-4 Skyhawk', '6',  '6 hex ida'],
        ['PAC1/2 (Verm.)',   'KMF-22 Sturmadler','10', '10 hex ida'],
        ['PATMAR1/2 (Verm.)','K-32 Stormwatch',  '12', '12 hex ida'],
        ['AWACS (Verm.)',    'K-99 Argus',        '10', '10 hex ida'],
    ],
    col_widths=[4.0, 4.0, 3.0, 4.6]
)

note_box(
    'PLANEJAMENTO DE MISSÃO: Uma aeronave que sai de uma base e precisa retornar no mesmo turno '
    'tem alcance útil de metade do FP máximo (ex.: Gripen com 8 FP alcança no máximo 4 hex de raio '
    'se precisar retornar à base no mesmo turno). '
    'Aeronaves que terminam o turno em voo consomem 1 FP adicional de patrulha.',
    bg='FFF3E0', border_color='E65C00'
)

# ── 5.3 Reabastecimento Naval ──
h2('5.3 Reabastecimento Naval')
body('Um navio de superfície ou submarino convencional é reabastecido (FP restaurado ao máximo) quando atende as duas condições simultaneamente:')
bullet('Condição 1: estava empilhado com um fornecedor de combustível NO INÍCIO do turno.')
bullet('Condição 2: ainda está empilhado com o mesmo fornecedor NO FIM do turno.')
body('Ou seja: o navio deve permanecer no mesmo hexágono que o fornecedor durante todo o turno (entrada e saída).')

h3('Fornecedores de Reabastecimento Naval')
make_table(
    ['Tipo', 'Exemplo', 'Observação'],
    [
        ['Navio Tanque (type: tanque)', 'REAB (Azul), REAB (Verm.)', 'Reabastece navios de sua equipe no mesmo hex'],
        ['Navio Logístico (type: logistico)', 'APLOG (Azul), LOG1/2 (Verm.)', 'Fornece FP e reabastece armas'],
        ['Porto (type: porto)', 'Porto Santos, Porto RJ, etc.', 'Reabastece e recomposta armas navais'],
    ],
    col_widths=[4.5, 5.0, 7.1]
)

note_box(
    'ATENÇÃO: Se o navio ou o fornecedor se mover durante o turno (sair do hex conjunto), '
    'o reabastecimento NÃO ocorre — mesmo que retornem ao mesmo hex ao final. '
    'A regra dos dois checkpoints garante que o reabastecimento só ocorre quando ambos '
    'permaneceram juntos o turno inteiro.',
    bg='FCE8E8', border_color='B71C1C'
)

# ── 5.4 Reabastecimento Aéreo ──
h2('5.4 Reabastecimento e Recompletamento Aéreo')
body('O reabastecimento de aeronaves é mais simples que o naval: basta que a aeronave TERMINE o turno em um hexágono com uma base aérea ou porta-aviões. No turno seguinte, ela iniciará com 100% de combustível e 100% de armamento.')

make_table(
    ['Condição', 'Resultado no próximo turno'],
    [
        ['Termina o turno em hex com aeroporto (Força Azul)', 'FP 100% + armas 100% + status "Pronta"'],
        ['Termina o turno em hex com porta-aviões (mesma equipe)', 'FP 100% + armas 100% + status "Pronta"'],
        ['Termina o turno em voo (sem base no hex)', 'FP como deixou (consumido em patrulha)'],
    ],
    col_widths=[8.5, 8.1]
)

h3('Bases Aéreas da Força Azul (Aeroportos)')
make_table(
    ['ID', 'Nome', 'Localização (col/linha)', 'Aeronaves'],
    [
        ['BLUE-AERO-RJ', 'BA Santa Cruz / Galeão', 'A-4 (col A, linha 4)', 'PAC1, PAC2 (F-39 Gripen)'],
        ['BLUE-AERO-SP', 'BA Santos',              'B-4 (col B, linha 4)', 'PATMAR1, PATMAR2 (P-3AM)'],
        ['BLUE-AERO-CF', 'AeroCF / BANS*',         'C-4 (col C, linha 4)', 'Alternativa — qualquer aeronave azul'],
    ],
    col_widths=[3.0, 4.0, 4.3, 5.3]
)
body('* AeroCF/BANS = Aeroporto de Cabo Frio + Base Aérea Naval de São Pedro da Aldeia (mesmo hexágono).')
body('Qualquer aeronave azul pode usar qualquer base aérea azul para reabastecimento — não há restrição de base exclusiva. O porta-aviões NAM Atlântico (SAG-P) também fornece reabastecimento para aeronaves azuis empilhadas com ele.')
body('Bases aéreas são unidades fixas no mapa (ícone ✈). Se uma base for destruída por ataque inimigo, ela não pode mais fornecer reabastecimento.')

note_box(
    'FORÇA VERMELHA — Aeronaves: somente o porta-aviões KCV Aurelius Magnus fornece '
    'reabastecimento e recompletamento. Não há bases terrestres para as aeronaves vermelhas. '
    'Se o KCV for destruído ou danificado a ponto de deixar o hex, as aeronaves vermelhas '
    'perdem seu único ponto de reabastecimento.',
    bg='FCE8E8', border_color='B71C1C'
)

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 6. MOVIMENTAÇÃO
# ═══════════════════════════════════════════════════════════════════════════════
h1('6. Fase de Movimentação')
h2('Regras Gerais')
bullet('Cada unidade possui um valor de Movimento (hexágonos por fase).')
bullet('O movimento é hex a hex em passos adjacentes — não é possível pular hexágonos.')
bullet('Unidades com Movimento = 0 são fixas (portos, baterias costeiras, FPSOs, aeroportos).')
bullet('Uma unidade pode optar por não se mover (ficar no mesmo hex) — FP de parada (1 FP naval) ainda é consumido.')
bullet('Unidades aéreas podem sobrevoar qualquer terreno sem penalidade.')
bullet('Submarinos não podem entrar em Águas Rasas nem em Área Terrestre.')
bullet('Unidades de superfície não podem entrar em Área Terrestre.')
bullet('Unidades com 0 FP naval não podem se mover.')

h2('Movimentação Simultânea (Névoa de Guerra)')
body('Durante a fase de movimentação, as posições inimigas exibidas no mapa correspondem às localizações do INÍCIO do turno — não às posições que o inimigo está assumindo agora. Novas detecções obtidas pelo movimento de suas próprias unidades também NÃO são reveladas até que ambos os lados confirmem o fim da fase.')
body('As posições reais de ambos os lados são reveladas simultaneamente somente após os dois jogadores clicarem em "Confirmar Movimentação". Isso simula sigilo de manobra: emboscadas, recuos secretos e reposicionamentos estratégicos são possíveis sem que o adversário saiba antecipadamente.')

note_box(
    'TÁTICA: Um grupo naval que se move para perto de uma unidade inimiga NÃO a detectará '
    'imediatamente — a detecção de novas unidades é computada apenas com as posições do início '
    'do turno. Planeje com incerteza!',
    bg='E8F4FF', border_color='1565C0'
)

h2('Como Mover uma Unidade')
bullet('Clique na unidade para selecioná-la. O painel lateral exibirá seus atributos e FP atual.')
bullet('Os hexágonos alcançáveis são destacados em verde.')
bullet('Clique no hexágono de destino para traçar o caminho passo a passo.')
bullet('Use "↩ Desfazer Passo" para recuar o último passo do caminho.')
bullet('Ao terminar, clique em "Confirmar Movimentação". Sua confirmação fica pendente até o adversário também confirmar.')

h2('Custo de Movimento e FP')
make_table(
    ['Categoria', 'Movimento Máx', 'FP gasto por turno', 'Observação'],
    [
        ['Superfície',  '2–4 hex', '1–3 FP (máx 4/turno)', 'Limitada a água'],
        ['Aérea',       '5–16 hex','1 FP/hex voado + 1 FP patrulha',  'Voa sobre qualquer terreno'],
        ['Submarina (convencional)','2–3 hex','1–3 FP (máx 4/turno)', 'Sem águas rasas/terra'],
        ['Submarina (nuclear)', '4 hex',    'Isento',     'Propulsão nuclear — FP ilimitado'],
        ['Terrestre/Fixa', '0 hex',         'Isento',     'Portos, FPSOs, aeroportos, baterias'],
    ],
    col_widths=[4.0, 3.0, 4.5, 5.1]
)

# ═══════════════════════════════════════════════════════════════════════════════
# 7. COMBATE
# ═══════════════════════════════════════════════════════════════════════════════
h1('7. Fase de Combate')
body('Após ambos confirmarem a movimentação, entra-se na Fase de Combate. Cada jogador pode declarar ataques de suas unidades contra alvos inimigos detectados dentro do alcance. Unidades com 0 FP naval não podem atacar nem se defender.')

h2('7.1 Declarar Ataques e Selecionar Salva')
bullet('Clique em uma unidade sua para selecioná-la.')
bullet('Os alvos inimigos ao alcance são destacados em vermelho.')
bullet('Clique em um alvo para declarar o ataque — ele aparece listado no painel lateral.')
bullet('Para cada ataque declarado, use os botões [−] e [+] ao lado do alvo para ajustar a quantidade de munição da salva (mínimo 1).')
bullet('Você pode declarar múltiplos ataques com diferentes unidades.')
bullet('Clique em "Confirmar Ataques" quando terminar. Os combates são resolvidos simultaneamente.')

note_box(
    'GESTÃO DE MUNIÇÃO: Salvas menores preservam armamento para engajamentos futuros. '
    'A Força Vermelha NÃO recomposta a maioria dos mísseis — cada tiro conta. '
    'Tamanhos de salva padrão: ASCM 2, MSS 2, Torpedo 1, LACM 1, ASBM 1.',
    bg='FFF3E0', border_color='E65C00'
)

h2('7.2 Seleção Automática de Arma')
body('O sistema seleciona automaticamente a melhor arma disponível de acordo com o tipo de alvo e a distância, seguindo esta prioridade:')
make_table(
    ['Tipo de Alvo', 'Prioridade de Armas (da mais para a menos preferida)'],
    [
        ['Superfície',  'ASCM → ASBM → MSS → Torpedo → AirAttack → NavalGun'],
        ['Submarino',   'ASW → Torpedo'],
        ['Aérea',       'AirDefense → AirAttack'],
        ['Terrestre',   'LACM → AirAttack → NavalGun'],
    ],
    col_widths=[3.5, 13.1]
)

h2('7.3 Tipos de Armas e Salvas')
make_table(
    ['Arma', 'Tipo', 'Alvo', 'Salva Padrão', 'BR', 'Interceptável'],
    [
        ['ASCM',      'Expendável',  'Superfície',         '2', '1 ou 2', 'Sim (DEFA)'],
        ['MSS',       'Expendável',  'Superfície',         '2', '1 ou 2', 'Sim (DEFA)'],
        ['Torpedo',   'Expendável',  'Superfície / Sub',   '1', '1 ou 2', 'Não'],
        ['LACM',      'Expendável',  'Terrestre',          '1', '1 apenas','Sim (BMD)'],
        ['ASBM',      'Expendável',  'Superfície',         '1', '1 apenas','Sim (BMD)'],
        ['AirAttack', 'Capacidade',  'Sup / Aér / Terr',  '—', '1 ou 2', 'Não'],
        ['NavalGun',  'Capacidade',  'Superfície / Terr',  '—', '1 ou 2', 'Não'],
        ['ASW',       'Capacidade',  'Submarino',          '—', '1 ou 2', 'Não'],
        ['AirDefense','Capacidade',  'Interceptar ASCM/MSS','—','—',       '—'],
        ['BMD',       'Capacidade',  'Interceptar LACM/ASBM','—','—',     '—'],
    ],
    col_widths=[2.3, 2.5, 3.0, 2.3, 2.3, 2.8]
)
body('Armas Expendáveis têm estoque limitado. Quando esgotadas, a unidade não pode usá-las até ser recompletada (Força Azul) ou nunca mais (maioria da Força Vermelha).')

page_break(doc)

h2('7.4 Sistema de Battle Rounds (2 Rodadas por Engajamento)')
body('Cada par atacante/alvo forma um Engajamento independente. Cada Engajamento pode ter até dois Battle Rounds (BR), permitindo que os jogadores escalem ou encerrem o combate dinamicamente.')
make_table(
    ['Battle Round', 'O que acontece'],
    [
        ['BR1', 'O atacante dispara a salva. Dano é calculado e reportado no painel de Engajamento.'],
        ['BR2 (opcional)', 'Ambos os jogadores decidem CONTINUAR ou PARAR. Se ao menos um continua, um segundo round é resolvido com contrataque do defensor.'],
    ],
    col_widths=[3.5, 13.1]
)
note_box(
    'EXCEÇÃO — Armas Estratégicas: Engajamentos com LACM (mísseis de cruzeiro) ou ASBM '
    '(mísseis balísticos) possuem apenas 1 Battle Round — sem opção de continuar.',
    bg='FFF3E0', border_color='E65C00'
)

h2('7.5 Decisão de Continuar ou Parar')
body('Após o BR1, se o alvo sobreviveu e a arma admite BR2, um painel de decisão é exibido para AMBOS os jogadores:')
bullet('[▶ CONTINUAR] — deseja um segundo round de fogo neste engajamento.')
bullet('[■ PARAR]     — encerra o engajamento aqui.')
make_table(
    ['Azul', 'Vermelho', 'Resultado'],
    [
        ['PARAR',     'PARAR',     'Engajamento encerrado. Passa para o próximo.'],
        ['CONTINUAR', 'CONTINUAR', 'BR2 resolvido. Nenhum bônus de iniciativa.'],
        ['CONTINUAR', 'PARAR',     'BR2 resolvido. Força Azul recebe bônus de iniciativa (★).'],
        ['PARAR',     'CONTINUAR', 'BR2 resolvido. Força Vermelha recebe bônus de iniciativa (★).'],
    ],
    col_widths=[2.8, 2.8, 11.0]
)

h2('7.6 Bônus de Iniciativa (★)')
body('Quando apenas um dos lados decide CONTINUAR no BR2, aquele lado recebe o Bônus de Iniciativa: em vez de rolar 1d6 por tiro, rola 2d6 e usa o valor mais alto. Isso simula a vantagem tática de quem persegue o engajamento com determinação.')
note_box(
    'Exemplo: sem bônus, um dado resulta em 3. Com bônus, dois dados resultam em 3 e 5 — '
    'usa-se 5. O bônus aparece no painel como ★ ao lado de cada rolagem.',
    bg='FFFCE8', border_color='C9A84C'
)

h2('7.7 Contrataque no Battle Round 2')
body('No Battle Round 2, a unidade que foi alvo no BR1 também responde com fogo — o contrataque. Representa a reação imediata do defensor durante o engajamento prolongado.')
bullet('O defensor seleciona automaticamente sua melhor arma de curto alcance (MSS, Torpedo, NavalGun, AirAttack ou ASW) contra o atacante original.')
bullet('Armas estratégicas (LACM, ASBM) NÃO são usadas no contrataque.')
bullet('O contrataque é resolvido simultaneamente ao BR2 do atacante, exibido no painel com o símbolo ↩ e a seção "── Contrataque ──".')
bullet('Se o defensor escolheu CONTINUAR e o atacante PAROU, o defensor recebe bônus de iniciativa (★) no contrataque.')

h2('7.8 Resolução de Dano — Sistema d6')
body('Cada tiro efetivo (não interceptado) gera uma rolagem de d6. O resultado determina o dano ao alvo de acordo com tabelas por arma e categoria do alvo.')
make_table(
    ['Arma vs. Alvo', '1', '2', '3', '4', '5', '6'],
    [
        ['ASCM vs. Superfície',    '0','0','0','1d6','1d6','1d6'],
        ['MSS vs. Superfície',     '0','0','1','1',  '1',  '1d6'],
        ['Torpedo vs. Superfície', '0','0','0','1',  '1d6','1d6'],
        ['Torpedo vs. Submarino',  '0','0','0','1',  '1d6','1d6'],
        ['LACM vs. Terrestre',     '0','0','1','1',  '1d6','1d6'],
        ['AirAttack vs. Superfície','0','0','0','1', '1d6','1d6'],
        ['AirAttack vs. Aérea',    '0','0','0','1',  '1',  '1d6'],
        ['NavalGun vs. Superfície','0','0','1','1',  '1',  '1'],
        ['ASW vs. Submarino',      '0','0','0','0',  '1',  '1d6'],
        ['DEFA vs. Míssil',        '0','0','0','0',  '1',  '1'],
    ],
    col_widths=[4.6, 1.4, 1.4, 1.4, 1.4, 1.4, 1.6]
)
body('Quando o resultado indica "1d6 SP", um segundo dado é lançado e seu valor (1–6) é o dano. Exibido no log como: d6=6→4(4SP).')

h2('7.9 Interceptação de Mísseis')
body('Antes do cálculo de dano, mísseis podem ser abatidos pelas defesas do alvo (automaticamente):')
bullet('DEFA (airDefense) intercepta ASCM e MSS: para cada míssil, rola 1d6 — resultado 5 ou 6 = interceptado.')
bullet('BMD intercepta LACM e ASBM: para cada míssil, rola 1d6 — resultado 5 ou 6 = interceptado.')
bullet('Torpedos NÃO são interceptáveis.')
bullet('O painel de Engajamento exibe o número de interceptados. Somente os mísseis não interceptados alcançam o alvo.')
note_box(
    'IMPORTANTE: A interceptação NUNCA recebe bônus de iniciativa — o sistema defensivo age '
    'independentemente da decisão de CONTINUAR ou PARAR.',
    bg='FCE8E8', border_color='B71C1C'
)

h2('7.10 Staying Power (SP) e Destruição')
bullet('Cada unidade possui SP máximo (exibido como "SP / MaxSP" e como barra de HP no contador).')
bullet('Quando SP chega a 0, a unidade é destruída e removida do mapa.')
bullet('Se uma unidade for destruída antes que seu engajamento seja processado, o painel exibe "Unidade já destruída — engajamento cancelado."')

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 8. DETECÇÃO
# ═══════════════════════════════════════════════════════════════════════════════
h1('8. Sistema de Detecção e Névoa de Guerra')
body('Unidades inimigas somente são visíveis no mapa se detectadas por pelo menos uma unidade aliada. Unidades não detectadas permanecem completamente ocultas.')

h2('Alcance de Detecção')
body('Cada unidade possui alcances por categoria de alvo: Det S / Aé / Sb / T = superfície / aérea / submarino / terrestre. Uma unidade inimiga é detectada se qualquer unidade aliada estiver dentro do alcance correspondente.')

h2('Penalidades Noturnas')
make_table(
    ['Categoria da Unidade Detectora', 'Diurno', 'Noturno'],
    [
        ['Superfície e Aérea',          'Alcance normal',    '−2 hex'],
        ['Sonar (detectando submarinos)','Alcance normal',   'Sem penalidade'],
        ['Detectando em Águas Profundas','—',                '−1 hex adicional (submarino)'],
    ],
    col_widths=[6.0, 3.3, 7.3]
)

h2('Furtividade — Submarinos')
bullet('Submarinos são sempre furtivos — detectáveis somente por alcance "submarine" (geralmente muito menor que "surface").')
bullet('Em Águas Profundas (T_DEEP), o alcance efetivo de sonar sofre −1 hex adicional.')
bullet('O sonar não sofre penalidade noturna, mas a redução por águas profundas se aplica.')

h2('Névoa de Guerra na Movimentação')
body('Durante a Fase de Movimentação, a detecção usa as posições do INÍCIO do turno — tanto das unidades amigas quanto das inimigas. Isso significa:')
bullet('Mover uma unidade detectora mais perto de um inimigo NÃO a detecta imediatamente.')
bullet('Novas detecções só são reveladas após AMBOS os jogadores confirmarem o fim da movimentação.')
bullet('As posições reais reveladas refletem onde cada unidade terminou — podendo ser completamente diferentes do esperado.')

# ═══════════════════════════════════════════════════════════════════════════════
# 9. RECOMPLETAMENTO DE MUNIÇÃO
# ═══════════════════════════════════════════════════════════════════════════════
h1('9. Recompletamento de Munição')
body('O recompletamento restaura armas expendáveis ao estoque inicial. Para aeronaves, o recompletamento ocorre junto com o reabastecimento de combustível (ver Seção 5.4). Para navios, segue as regras abaixo.')

h2('Navios — Recompletamento em Porto ou Base Logística')
make_table(
    ['Força', 'Unidade', 'Condição'],
    [
        ['Azul', 'Navios de superfície / Sub',   'Estacionado (não se moveu) em hex de Porto ativo'],
        ['Azul', 'Unidades terrestres (baterias)','Recompletamento automático — sempre'],
        ['Vermelha', 'Aeronaves',   'Termina o turno no hex do KCV (porta-aviões) — veja Seção 5.4'],
        ['Vermelha', 'Navios / Sub', 'SEM recompletamento — munição é finita e irreversível'],
    ],
    col_widths=[2.2, 4.8, 9.6]
)
note_box(
    'DIFERENÇA IMPORTANTE: Aeronaves azuis recompletam armas quando terminam o turno em '
    'uma base aérea, independentemente de terem voado. Navios azuis precisam '
    'ESTAR PARADOS (não terem se movido no turno) E estarem em um porto.\n'
    'A Força Vermelha SÓ recomposta aeronaves no porta-aviões. '
    'Todos os mísseis navais vermelhos são finitos — gerencie com cuidado.',
    bg='FFF3E0', border_color='E65C00'
)

body('Quando uma unidade recompeta, o log registra: 🔄 [nome] recompletou: ASCM, MSS, ...')

# ═══════════════════════════════════════════════════════════════════════════════
# 10. VITÓRIA
# ═══════════════════════════════════════════════════════════════════════════════
h1('10. Condição de Vitória')
body('O jogo termina imediatamente quando uma das partes não possuir mais nenhuma unidade com capacidade ofensiva restante. Uma unidade possui capacidade ofensiva se tiver: attackRange > 0 em qualquer categoria, OU armas expendáveis com quantidade > 0, OU qualquer capacidade (airDefense, asw, etc.) com valor > 0.')
body('Unidades puramente logísticas (portos, FPSOs, navios de reabastecimento) não contam para esta verificação.')

h2('Caminhos para a Vitória')
make_table(
    ['Forçar Vermelha vence se...', 'Força Azul vence se...'],
    [
        ['Destruir todas as unidades combatentes azuis', 'Destruir todas as unidades combatentes vermelhas'],
        ['Destruir FPSOs, portos e bases, isolando a defesa', 'Esgotar toda a munição vermelha (sem capacidade ofensiva restante)'],
        ['Completar desembarque anfíbio sem contraposição', 'Afundar o grupo anfíbio antes do desembarque'],
    ],
    col_widths=[8.3, 8.3]
)

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 11. CATÁLOGO — FORÇA AZUL
# ═══════════════════════════════════════════════════════════════════════════════
h1('11. Catálogo de Plataformas — Força Azul')
body('Contadores azuis. Os valores de SP/FP e armamento são os valores iniciais de cada unidade.')

h2('Grupos Navais de Superfície')
make_table(
    ['ID', 'Nome', 'SP', 'Mov', 'FP', 'Armas Expendáveis', 'Capacidades'],
    [
        ['SAG-P',  'SAG Principal\n(NAM Atlântico + helicópteros)', '4','4','12','MSS×16 (3)',     'DEFA-3 ASW-4 AirAtk-6'],
        ['SAG-1',  'SAG-1\n(3x Fragata Tamandaré)',                 '9','4','10','MSS×18 (2)',     'Canhão-3 DEFA-6 ASW-3 AirAtk-3'],
        ['SAG-2',  'SAG-2\n(2x Fragata + 2x Corveta)',              '10','4','10','MSS×24 (2)',    'Canhão-4 DEFA-6 ASW-4 AirAtk-2'],
        ['ANFIB',  'Força de Desembarque\n(NDM + Oiapoque + NCC)',  '10','2','8', '—',             'Canhão-3 DEFA-3 ASW-4'],
        ['APLOG',  'Apoio Logístico\n(NApLog)',                     '3', '2','30','—',             '—'],
        ['REAB',   'Navio Tanque\n(NT Gastão Motta)',               '3', '2','40','—',             '—'],
        ['PAOC1',  'Patrulha Oceânica 1\n(2x NPaOc Apa)',           '4', '4','10','MSS×4 (2)',     'Canhão-2 DEFA-2 AirAtk-2'],
        ['PAOC2',  'Patrulha Oceânica 2\n(2x NPaOc Amazonas)',      '4', '4','10','MSS×4 (2)',     'Canhão-2 DEFA-2 AirAtk-2'],
        ['PATC1',  'Patrulha Costeira 1\n(2x NPa Macaé)',           '2', '3','6', 'MSS×2 (1)',     'Canhão-2'],
        ['PATC2',  'Patrulha Costeira 2\n(4x NPa Grajaú)',          '2', '3','6', 'MSS×2 (1)',     'Canhão-2'],
    ],
    col_widths=[1.8, 4.2, 0.8, 0.8, 0.8, 3.5, 3.7]
)
body('Alcance entre parênteses nas armas expendáveis.')

h2('Submarinos')
make_table(
    ['ID', 'Nome', 'SP', 'Mov', 'FP', 'Armas', 'Notas'],
    [
        ['SBN', 'SNAC Álvaro Alberto (nuclear)', '3','4','∞', 'ASCM×2(6) MSS×4(2) TORP×12(2)', 'Furtivo; posição secreta'],
        ['SB1', 'S40 Riachuelo (conv.)',          '2','2','20','MSS×2(2) TORP×6(2)',            'Furtivo; posição secreta'],
        ['SB2', 'S41 Humaitá (conv.)',            '2','2','20','MSS×2(2) TORP×6(2)',            'Furtivo; posição secreta'],
        ['SB3', 'S42 Tonelero (conv.)',           '2','2','20','MSS×2(2) TORP×6(2)',            'Furtivo; posição secreta'],
    ],
    col_widths=[1.5, 4.3, 0.7, 0.7, 0.7, 4.7, 3.0]
)

h2('Aeronaves')
make_table(
    ['ID', 'Nome', 'SP', 'Mov/FP', 'Armas', 'Base Inicial'],
    [
        ['PATMAR1', 'P-3AM Orion 1',    '2','16','MSS×4(2) TORP×2(2)','BA Santos (B-4)'],
        ['PATMAR2', 'P-3AM Orion 2',    '2','16','MSS×4(2) TORP×2(2)','BA Santos (B-4)'],
        ['PAC1',    'F-39E Gripen 1',   '6','8', '—',                  'BA Santa Cruz (A-4)'],
        ['PAC2',    'F-39E Gripen 2',   '6','8', '—',                  'BA Santa Cruz (A-4)'],
        ['APAER1',  'AF-1 A-4 Skyhawk 1','2','6','ASCM×4(6) MSS×2(2) LACM×2(10)','Porto do Rio (D-4)'],
        ['APAER2',  'AF-1 A-4 Skyhawk 2','2','6','ASCM×4(6) MSS×2(2) LACM×2(10)','Porto do Rio (D-4)'],
    ],
    col_widths=[2.0, 3.8, 0.7, 1.8, 4.5, 3.8]
)
body('Todas as aeronaves azuis reabasteciam em qualquer BA azul (BA Santa Cruz, BA Santos, AeroCF/BANS) ou no NAM Atlântico (SAG-P).')

h2('Unidades Terrestres e Infraestrutura')
make_table(
    ['ID', 'Nome', 'SP', 'Tipo', 'Armas / Capacidades', 'Posição'],
    [
        ['DEFCOST1',    'Bateria Costeira 1',  '2','Bateria',   'MSS×10(3)  DEFA-2',          'E-3 (col E, linha 3)'],
        ['DEFCOST2',    'Bateria Costeira 2',  '2','Bateria',   'MSS×10(3)  DEFA-2',          'B-5 (col B, linha 5)'],
        ['BDA1',        'Batalhão ADA 1',      '2','ADA',       'DEFA-6  BMD-2',               'D-2 (Rio de Janeiro)'],
        ['BDA2',        'Batalhão ADA 2',      '2','ADA',       'DEFA-6  BMD-2',               'A-6 (Santos)'],
        ['Porto Santos','Porto de Santos',     '20','Porto',    'Hub logístico sul',           'A-6'],
        ['Porto RJ',    'Porto do Rio',        '20','Porto',    'Hub naval central',           'C-5'],
        ['Porto Vitória','Porto de Vitória',   '16','Porto',    '—',                           'F-2'],
        ['Porto Açu',   'Porto do Açu',        '12','Porto',    'Terminal offshore',           'E-4'],
        ['BA Santa Cruz','Base Aérea RJ',      '10','Aeroporto','Reabastecimento F-39 Gripen', 'A-4'],
        ['BA Santos',   'Base Aérea Santos',   '10','Aeroporto','Reabastecimento P-3AM',       'B-4'],
        ['AeroCF/BANS', 'Cabo Frio / S.P.Aldeia','10','Aeroporto','Alternativa aérea',         'C-4'],
        ['FPSO1–4',     'Plataformas',    '6 (cada)','FPSO',   'Apenas detecção (1/1)',       'Vários'],
    ],
    col_widths=[2.3, 3.5, 0.7, 2.0, 4.0, 4.1]
)

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 12. CATÁLOGO — FORÇA VERMELHA
# ═══════════════════════════════════════════════════════════════════════════════
h1('12. Catálogo de Plataformas — Força Vermelha')
body('Contadores vermelhos. ATENÇÃO: a maioria dos navios vermelhos NÃO recomposta munição. A munição inicial é tudo que terão durante a partida.')

h2('Grupos Navais de Superfície')
make_table(
    ['ID', 'Nome', 'SP', 'Mov', 'FP', 'Armas Expendáveis', 'Capacidades'],
    [
        ['CSG',    'KCV Aurelius Magnus\n(Porta-Aviões nuclear)',    '6','4','∞',  'MSS×10(3)',                      'DEFA-3 ASW-6 AirAtk-8'],
        ['ESCCSG', 'Escolta CSG\n(CG Drakhmar + 2x DDG)',           '12','4','12','ASCM×14(6) MSS×18(3) LACM×8(10)','Canhão-6 DEFA-13 BMD-4 ASW-11'],
        ['SAG1',   'SAG-1\n(DDG + 2x FFG)',                         '10','4','12','ASCM×8(6) MSS×12(3) LACM×2(10)', 'Canhão-4 DEFA-8 BMD-1 ASW-8'],
        ['SAG2',   'SAG-2\n(3x FFG)',                               '9', '4','10','MSS×12(3)',                      'Canhão-3 DEFA-6 ASW-3'],
        ['REAB',   'Petroleiro CSG\n(AOR Korvas)',                  '3', '2','24','—',                              '—'],
        ['ANFIB-E','Grupo Anfíbio\n(LPD Harnax + 2x LST)',          '14','3','12','—',                              'Canhão-4 DEFA-4'],
        ['LOG1',   'Grupo Logístico\n(AOR + AOT)',                  '6', '2','30','—',                              '—'],
        ['LOG2',   'Navio Munições\n(AKE Yarven)',                  '6', '2','8', '—',                              '—'],
    ],
    col_widths=[1.8, 4.0, 0.8, 0.8, 0.8, 4.2, 3.2]
)

h2('Submarinos')
make_table(
    ['ID', 'Nome', 'SP', 'Mov', 'FP', 'Armas', 'Notas'],
    [
        ['SBN', 'KAR Veylan (nuclear)',  '3','4','∞', 'ASCM×8(6) TORP×12(2) LACM×4(10)', 'Furtivo; posição secreta'],
        ['SB',  'KAR Skarn (conv.)',     '2','2','20','ASCM×4(6) TORP×6(2)',              'Furtivo; posição secreta'],
    ],
    col_widths=[1.5, 4.0, 0.7, 0.7, 0.7, 5.3, 3.7]
)

h2('Aeronaves (todas embarcadas no KCV)')
make_table(
    ['ID', 'Nome', 'SP', 'Mov/FP', 'Armas / Capacidades', 'Posição Inicial'],
    [
        ['PAC1',     'KMF-22 Sturmadler 1',  '8','10','AirDef-8  AirAtk-8',              'KCV (col P, linha 2)'],
        ['PAC2',     'KMF-22 Sturmadler 2',  '8','10','AirDef-8  AirAtk-8',              'KCV (col P, linha 2)'],
        ['PATMAR1',  'K-32 Stormwatch 1',    '2','12','ASCM×2(6) MSS×2(2) TORP×2(2) ASW-2 AirAtk-2','KCV'],
        ['PATMAR2',  'K-32 Stormwatch 2',    '2','12','ASCM×2(6) MSS×2(2) TORP×2(2) ASW-2 AirAtk-2','KCV'],
        ['AWACS',    'K-99 Argus (AEW)',      '2','10','—  (somente detecção)',            'KCV'],
    ],
    col_widths=[2.0, 4.2, 0.7, 1.8, 4.8, 3.1]
)
body('Todas as aeronaves vermelhas reabasteciam exclusivamente no KCV Aurelius Magnus. Sem porta-aviões = sem reabastecimento.')

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 13. REFERÊNCIA RÁPIDA
# ═══════════════════════════════════════════════════════════════════════════════
h1('13. Referência Rápida')

h2('Sequência de Jogo por Turno')
make_table(
    ['#', 'Ação'],
    [
        ['1','Fase de Movimentação — ambos os jogadores planejam e confirmam movimentos (secreto). FP consumidos.'],
        ['2','Revelação simultânea das posições + novas detecções calculadas com posições finais.'],
        ['3','Fase de Combate — ambos declaram ataques (e quantidades de salva) e confirmam.'],
        ['4','Servidor resolve Engajamentos um a um via Battle Rounds.'],
        ['5','BR1: painel exibe resultado; jogadores decidem CONTINUAR ou PARAR.'],
        ['6','BR2 (se aplicável): fogo do atacante + contrataque do defensor; bônus de iniciativa se assimétrico.'],
        ['7','Fim dos Engajamentos → verificação de vitória → início do próximo turno.'],
        ['8','Início do próximo turno: aeronaves em base reabastecidas → status Pronta (FP+armas 100%). Navios em porto → armas recompletadas.'],
    ],
    col_widths=[0.7, 15.9]
)

h2('Tabela de Custo FP Naval')
make_table(
    ['Movimento', '0 hex', '1 hex', '2 hex', '3+ hex', 'Limite/turno'],
    [['FP gasto', '1', '1', '2', '3', '4']],
    col_widths=[3.2, 2.0, 2.0, 2.0, 2.0, 2.0]
)

h2('Reabastecimento — Resumo')
make_table(
    ['Quem', 'Condição', 'Resultado'],
    [
        ['Aeronave azul',      'Termina o turno em hex de aeroporto ou NAM Atlântico', 'FP 100% + armas 100% no próximo turno'],
        ['Aeronave vermelha',  'Termina o turno no hex do KCV',                        'FP 100% + armas 100% no próximo turno'],
        ['Navio azul (armas)', 'Estacionário em porto azul no fim do turno',            'Armas 100% no próximo turno'],
        ['Navio azul (FP)',    'Estacionário em hex de LOG/tanque/porto — turno inteiro','FP 100% no próximo turno'],
        ['Navio vermelho',     'Sem recompletamento de armas',                          '—'],
    ],
    col_widths=[3.8, 6.8, 6.0]
)

h2('Lembretes Críticos')
bullet('FP = 0 em navio: não pode mover, atacar nem defender.')
bullet('Aeronave em voo com FP = 0 que não alcança base = PERDIDA.')
bullet('Aeronave em base (status Pronta): sem custo de FP parado, pode atacar normalmente.')
bullet('Submarinos: sonar não sofre penalidade noturna; −1 hex em águas profundas.')
bullet('Torpedo: não é interceptável. ASCM/MSS: interceptados por DEFA (5–6 no d6).')
bullet('LACM/ASBM: apenas 1 Battle Round — sem contrataque.')
bullet('Iniciativa (★): rola 2d6 toma o maior — o lado que quer continuar e o adversário parou.')
bullet('Novas detecções por movimento: reveladas só após ambos confirmarem a fase.')
bullet('Navios vermelhos: munição FINITA (sem recompletamento) — exceto aeronaves no KCV.')
bullet('Aeroporto azul destruído: não fornece mais reabastecimento.')

h2('Abreviações')
make_table(
    ['Abreviação', 'Significado'],
    [
        ['FP',    'Pontos de Combustível — "tanque" da unidade'],
        ['SP',    'Staying Power — pontos de vida da unidade'],
        ['ASCM',  'Anti-Ship Cruise Missile — míssil antinavio de cruzeiro'],
        ['MSS',   'Multi-purpose Ship-launched missile — míssil versátil'],
        ['LACM',  'Land-Attack Cruise Missile — míssil de cruzeiro terrestre'],
        ['ASBM',  'Anti-Ship Ballistic Missile — míssil balístico antinavio'],
        ['ASW',   'Anti-Submarine Warfare — guerra antissubmarina'],
        ['DEFA',  'Defesa Antiaérea — intercepta ASCM/MSS (rola 5–6)'],
        ['BMD',   'Ballistic Missile Defense — intercepta LACM/ASBM (rola 5–6)'],
        ['BR1/2', 'Battle Round 1 / Battle Round 2'],
        ['NAM',   'Navio Aeródromo Mobile — porta-aviões (SAG-P)'],
        ['KCV',   'Porta-Aviões vermelho (KCV Aurelius Magnus)'],
        ['AIP',   'Air-Independent Propulsion — sub convencional moderno'],
    ],
    col_widths=[2.8, 13.8]
)

# Footer
p_foot = doc.add_paragraph()
p_foot.paragraph_format.space_before = Pt(20)
p_foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
rf = p_foot.add_run('Operação Atlântico Sul — Manual do Jogador  |  Versão 3.0')
rf.font.name = 'Calibri'; rf.font.size = Pt(8.5); rf.font.color.rgb = DIM; rf.font.italic = True

out = '/home/user/wargame-naval/manual_jogador_v3.docx'
doc.save(out)
print(f'Salvo: {out}')
