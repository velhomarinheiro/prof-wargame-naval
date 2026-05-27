#!/usr/bin/env python3
"""Generate manual_jogador_v2.docx — updated player manual for Operacao Atlantico Sul."""

from docx import Document
from docx.shared import Pt, Cm, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import copy

# ── Palette ──────────────────────────────────────────────────────────────────
NAVY   = RGBColor(0x07, 0x19, 0x29)
DEEP   = RGBColor(0x0a, 0x20, 0x35)
BLUE   = RGBColor(0x15, 0x65, 0xc0)
BLUE_L = RGBColor(0x82, 0xb1, 0xff)
RED    = RGBColor(0xb7, 0x1c, 0x1c)
RED_L  = RGBColor(0xff, 0x8a, 0x80)
GOLD   = RGBColor(0xc9, 0xa8, 0x4c)
WHITE  = RGBColor(0xff, 0xff, 0xff)
LIGHT  = RGBColor(0xd0, 0xe8, 0xf4)
DIM    = RGBColor(0x5a, 0x8a, 0xaa)
GREEN  = RGBColor(0x00, 0xc8, 0x60)
ORANGE = RGBColor(0xe6, 0x5c, 0x00)

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
section.page_width  = Cm(21)
section.page_height = Cm(29.7)
section.top_margin    = Cm(2)
section.bottom_margin = Cm(2)
section.left_margin   = Cm(2.2)
section.right_margin  = Cm(2.2)

# ── Default paragraph style ──────────────────────────────────────────────────
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
    run.font.name  = 'Calibri'
    run.font.size  = Pt(16)
    run.font.bold  = True
    run.font.color.rgb = color
    # Bottom border
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '8')
    bottom.set(qn('w:color'), '{:02X}{:02X}{:02X}'.format(*color))
    pBdr.append(bottom)
    pPr.append(pBdr)
    return p

def h2(text, color=BLUE):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after  = Pt(3)
    run = p.add_run(text)
    run.font.name  = 'Calibri'
    run.font.size  = Pt(12)
    run.font.bold  = True
    run.font.color.rgb = color
    return p

def h3(text, color=DIM):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after  = Pt(2)
    run = p.add_run(text)
    run.font.name  = 'Calibri'
    run.font.size  = Pt(10.5)
    run.font.bold  = True
    run.font.color.rgb = color
    return p

def body(text, space_after=4, bold_parts=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after  = Pt(space_after)
    if bold_parts:
        # bold_parts: list of (substr, is_bold) for simple inline formatting
        remaining = text
        for part, is_bold in bold_parts:
            idx = remaining.find(part)
            if idx > 0:
                r = p.add_run(remaining[:idx])
                r.font.name = 'Calibri'; r.font.size = Pt(10)
            r = p.add_run(part)
            r.font.name = 'Calibri'; r.font.size = Pt(10); r.bold = is_bold
            remaining = remaining[remaining.find(part)+len(part):]
        if remaining:
            r = p.add_run(remaining)
            r.font.name = 'Calibri'; r.font.size = Pt(10)
    else:
        run = p.add_run(text)
        run.font.name = 'Calibri'
        run.font.size = Pt(10)
    return p

def bullet(text, level=0, color=None):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.left_indent   = Cm(0.8 + level * 0.5)
    p.paragraph_format.space_before  = Pt(1)
    p.paragraph_format.space_after   = Pt(2)
    run = p.add_run(text)
    run.font.name = 'Calibri'
    run.font.size = Pt(10)
    if color:
        run.font.color.rgb = color
    return p

def note_box(text, bg='E8F4FF', border_color='1565C0'):
    """Highlighted note/tip box."""
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
    r.font.name = 'Calibri'
    r.font.size = Pt(9.5)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return tbl

def make_table(headers, rows, col_widths=None, header_bg='071929', header_color=WHITE, alt_bg='EEF4FF'):
    n = len(headers)
    tbl = doc.add_table(rows=1+len(rows), cols=n)
    tbl.style = 'Table Grid'
    tbl.alignment = WD_TABLE_ALIGNMENT.LEFT
    # Header row
    hdr = tbl.rows[0]
    for i, h in enumerate(headers):
        cell = hdr.cells[i]
        set_cell_bg(cell, header_bg)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r = p.add_run(h)
        r.font.bold  = True
        r.font.name  = 'Calibri'
        r.font.size  = Pt(9)
        r.font.color.rgb = header_color
    # Data rows
    for ri, row in enumerate(rows):
        bg = 'FFFFFF' if ri % 2 == 0 else alt_bg
        for ci, val in enumerate(row):
            cell = tbl.rows[ri+1].cells[ci]
            set_cell_bg(cell, bg)
            p = cell.paragraphs[0]
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            r = p.add_run(str(val))
            r.font.name = 'Calibri'
            r.font.size = Pt(9)
    # Column widths
    if col_widths:
        for ri2 in range(len(rows)+1):
            for ci2, w in enumerate(col_widths):
                tbl.rows[ri2].cells[ci2].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)
    return tbl

# ═══════════════════════════════════════════════════════════════════════════════
# COVER PAGE
# ═══════════════════════════════════════════════════════════════════════════════
# Top color bar
tbl_cover = doc.add_table(rows=1, cols=1)
cell0 = tbl_cover.cell(0,0)
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
rv = p_ver.add_run('Versão 2.0')
rv.font.name = 'Calibri'; rv.font.size = Pt(10); rv.font.color.rgb = DIM
rv.font.italic = True

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# SUMÁRIO
# ═══════════════════════════════════════════════════════════════════════════════
h1('SUMÁRIO', NAVY)
toc_items = [
    ('1.', 'Visão Geral do Jogo'),
    ('2.', 'Como Iniciar uma Partida'),
    ('3.', 'O Tabuleiro — Mapa Hexagonal'),
    ('4.', 'Estrutura de um Turno'),
    ('5.', 'Fase de Movimentação'),
    ('6.', 'Fase de Combate'),
    ('  6.1', 'Declarar Ataques e Selecionar Salva'),
    ('  6.2', 'Seleção Automática de Arma'),
    ('  6.3', 'Tipos de Armas e Salvas'),
    ('  6.4', 'Sistema de Battle Rounds (2 Rodadas)'),
    ('  6.5', 'Decisão de Continuar ou Parar'),
    ('  6.6', 'Bônus de Iniciativa'),
    ('  6.7', 'Contrataque no Battle Round 2'),
    ('  6.8', 'Resolução de Dano — Sistema d6'),
    ('  6.9', 'Interceptação de Mísseis'),
    ('  6.10', 'Staying Power (SP) e Destruição'),
    ('7.', 'Sistema de Detecção e Névoa de Guerra'),
    ('8.', 'Recompletamento de Munição'),
    ('9.', 'Condição de Vitória'),
    ('10.', 'Catálogo de Plataformas'),
    ('11.', 'Referência Rápida'),
]
for num, title in toc_items:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after  = Pt(2)
    rn = p.add_run(f'{num}  ')
    rn.font.name = 'Calibri'; rn.font.size = Pt(10); rn.font.bold = True; rn.font.color.rgb = BLUE
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
body('O jogo termina imediatamente quando uma das partes não possuir mais nenhuma unidade combatente com pontos de vida (SP) restantes. Consulte a Seção 9 para detalhes.')

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
bullet('À direita: painel lateral com informações da unidade selecionada, botões de ação e log de batalha.')
bullet('No topo: turno, período, fase atual e banner "SUA VEZ" quando é seu turno de agir.')

# ═══════════════════════════════════════════════════════════════════════════════
# 3. TABULEIRO
# ═══════════════════════════════════════════════════════════════════════════════
h1('3. O Tabuleiro — Mapa Hexagonal')
body('O mapa possui 16 colunas (A–P, oeste a leste) e 10 linhas (1–10, norte a sul), totalizando 160 hexágonos de topo plano. As coordenadas são exibidas nas bordas do mapa.')

h2('Tipos de Terreno')
make_table(
    ['Cor', 'Tipo', 'Restrições'],
    [
        ['Areia / bege',  'Área Terrestre (T_LAND)',          'Somente unidades aéreas'],
        ['Azul claro',    'Águas Rasas <200m (T_SHALLOW)',    'Proibido a submarinos'],
        ['Azul médio',    'Plataforma Continental',           'Sem restrições navais'],
        ['Azul escuro',   'Águas Profundas (T_DEEP)',         'Sem restrições navais; melhor para subs'],
        ['Laranja / ★',  'Bacia Petrolífera / FPSO',         'Sem restrições; objetivo estratégico'],
    ],
    col_widths=[3.0, 5.2, 7.4]
)

h2('Escala e Distância')
body('A distância entre hexágonos é medida em passos hexagonais (distância cúbica). Um hex adjacente equivale a distância 1. Alcances de movimento, detecção e armas são todos expressos nessa unidade.')

# ═══════════════════════════════════════════════════════════════════════════════
# 4. ESTRUTURA DO TURNO
# ═══════════════════════════════════════════════════════════════════════════════
h1('4. Estrutura de um Turno')
body('Cada turno completo é composto por dois períodos: Diurno e Noturno. O jogo começa no Período Diurno do Turno 1.')
make_table(
    ['Etapa', 'Descrição'],
    [
        ['Período',         'Diurno ou Noturno — alterna a cada fase'],
        ['Movimentação',    'Ambos os jogadores movem suas unidades (simultâneo e secreto)'],
        ['Combate',         'Ambos declaram ataques → resolução por Battle Rounds'],
        ['Recompletamento', 'Ao final do turno, unidades elegíveis recebem munição'],
    ],
    col_widths=[4.0, 12.6]
)
body('Indicadores no topo da tela mostram o Turno atual, o Período (☀ Diurno / 🌙 Noturno) e a Fase atual.')

# ═══════════════════════════════════════════════════════════════════════════════
# 5. MOVIMENTAÇÃO
# ═══════════════════════════════════════════════════════════════════════════════
h1('5. Fase de Movimentação')

h2('Regras Gerais')
bullet('Cada unidade possui um valor de Movimento. Ela pode se deslocar até esse número de hexágonos por fase.')
bullet('O movimento é hex a hex em passos adjacentes — não é possível pular hexágonos.')
bullet('Unidades com Movimento = 0 são fixas (portos, baterias costeiras, plataformas).')
bullet('Uma unidade pode optar por não se mover (ficar no mesmo hex).')
bullet('Unidades aéreas podem sobrevoar qualquer terreno sem penalidade.')
bullet('Submarinos não podem entrar em hexágonos Rasos (T_SHALLOW) nem em Terra (T_LAND).')
bullet('Unidades de superfície não podem entrar em Terra (T_LAND).')

h2('Movimentação Simultânea (Névoa de Guerra)')
body('Durante a fase de movimentação, as posições inimigas exibidas no mapa correspondem às localizações do início do turno — não às posições que o inimigo está assumindo agora. Novas detecções obtidas pelo movimento de suas próprias unidades também NÃO são reveladas até que ambos os lados confirmem o fim da fase.')
body('As posições reais de ambos os lados são reveladas ao mesmo tempo somente após os dois jogadores clicarem em "Confirmar Movimentação". Isso simula sigilo de manobra: emboscadas, recuos secretos e reposicionamentos estratégicos são possíveis sem que o adversário saiba antecipadamente.')

note_box(
    'TÁTICA: Um grupo naval que se move para perto de uma unidade inimiga NÃO a detectará imediatamente — '
    'a detecção de novas unidades é computada apenas com as posições do início do turno. '
    'Planeje com incerteza!',
    bg='E8F4FF', border_color='1565C0'
)

h2('Como Mover uma Unidade')
bullet('Clique na unidade para selecioná-la. O painel lateral exibirá seus atributos.')
bullet('Os hexágonos alcançáveis são destacados em verde.')
bullet('Clique no hexágono de destino para traçar o caminho passo a passo.')
bullet('Use "↩ Desfazer Passo" para recuar o último passo do caminho.')
bullet('Ao terminar, clique em "Confirmar Movimentação". Sua confirmação fica pendente até o adversário também confirmar.')

h2('Valores de Movimento por Categoria')
make_table(
    ['Categoria', 'Movimento Típico', 'Observação'],
    [
        ['Superfície (surface)', '2–4 hex', 'Limitada a água'],
        ['Aérea (air)',          '5–8 hex', 'Voa sobre qualquer terreno'],
        ['Submarina (submarine)','2–3 hex', 'Não entra em águas rasas ou terra'],
        ['Terrestre / Fixa',    '0 hex',   'Portos, FPSOs, baterias fixas'],
    ],
    col_widths=[4.5, 3.5, 8.6]
)

# ═══════════════════════════════════════════════════════════════════════════════
# 6. COMBATE
# ═══════════════════════════════════════════════════════════════════════════════
h1('6. Fase de Combate')
body('Após ambos confirmarem a movimentação, entra-se na Fase de Combate. Cada jogador pode declarar ataques de suas unidades contra alvos inimigos detectados dentro do alcance.')

h2('6.1 Declarar Ataques e Selecionar Salva')
bullet('Clique em uma unidade sua para selecioná-la.')
bullet('Os alvos inimigos ao alcance são destacados em vermelho.')
bullet('Clique em um alvo para declarar o ataque — ele aparece listado no painel lateral.')
bullet('Para cada ataque declarado, use os botões [−] e [+] ao lado do alvo para ajustar a quantidade de munição da salva (mínimo 1).')
bullet('Você pode declarar múltiplos ataques com diferentes unidades.')
bullet('Clique em "Confirmar Ataques" quando terminar. Os combates são resolvidos simultaneamente.')

note_box(
    'GESTÃO DE MUNIÇÃO: Salvas menores preservam armamento para engajamentos futuros. '
    'A Força Vermelha NÃO recomposta — cada míssil conta. '
    'Tamanhos de salva padrão: ASCM 2, MSS 2, Torpedo 1, LACM 1, ASBM 1.',
    bg='FFF3E0', border_color='E65C00'
)

h2('6.2 Seleção Automática de Arma')
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

h2('6.3 Tipos de Armas e Salvas')
make_table(
    ['Arma', 'Tipo', 'Alvo', 'Salva Padrão', 'Battle Rounds', 'Interceptável'],
    [
        ['ASCM', 'Expendável', 'Superfície', '2', '1 ou 2', 'Sim (DEFA)'],
        ['MSS',  'Expendável', 'Sup/Sub/Aér', '2', '1 ou 2', 'Sim (DEFA)'],
        ['Torpedo', 'Expendável', 'Sup/Sub', '1', '1 ou 2', 'Não'],
        ['LACM', 'Expendável', 'Terrestre', '1', '1 apenas', 'Sim (BMD)'],
        ['ASBM', 'Expendável', 'Superfície', '1', '1 apenas', 'Sim (BMD)'],
        ['AirAttack', 'Capacidade', 'Sup/Sub/Ter', '—', '1 ou 2', 'Não'],
        ['NavalGun',  'Capacidade', 'Sup/Ter',    '—', '1 ou 2', 'Não'],
        ['ASW',       'Capacidade', 'Submarino',  '—', '1 ou 2', 'Não'],
        ['AirDefense','Capacidade', 'Interceptar ASCM/MSS', '—', '—', '—'],
        ['BMD',       'Capacidade', 'Interceptar LACM/ASBM','—', '—', '—'],
    ],
    col_widths=[2.4, 2.5, 2.8, 2.3, 2.5, 2.5]
)
body('Armas Expendáveis possuem estoque limitado (ex.: ASCM: 8). Quando esgotadas, a unidade não pode usá-las até ser recompletada. Capacidades são persistentes e não se esgotam.')

page_break(doc)

h2('6.4 Sistema de Battle Rounds (2 Rodadas por Engajamento)')
body('Cada par atacante/alvo forma um Engajamento independente. Ao contrário de outros jogos onde o dano é calculado de uma vez, aqui cada Engajamento pode ter até dois Battle Rounds (BR), permitindo que os jogadores escalem ou encerrem o combate dinamicamente.')

make_table(
    ['Battle Round', 'O que acontece'],
    [
        ['BR1', 'O atacante dispara a salva. Dano é calculado e reportado no painel de Engajamento.'],
        ['BR2 (opcional)', 'Ambos os jogadores decidem CONTINUAR ou PARAR. Se ao menos um continua, um segundo round é resolvido.'],
    ],
    col_widths=[3.5, 13.1]
)

note_box(
    'EXCEÇÃO — Armas Estratégicas: Engajamentos com LACM (mísseis de cruzeiro) ou ASBM (mísseis balísticos) '
    'possuem apenas 1 Battle Round — sem opção de continuar.',
    bg='FFF3E0', border_color='E65C00'
)

body('O painel de Engajamento exibe, para cada BR:')
bullet('Atacante → Alvo [ARMA]')
bullet('Mísseis lançados e interceptados')
bullet('Rolagens de dados individuais (ex.: d6=4(2SP)  d6=6(3SP))')
bullet('Dano total infligido e SP restante do alvo')
bullet('Mensagem DESTRUÍDO! se SP chegar a 0')

h2('6.5 Decisão de Continuar ou Parar')
body('Após o BR1, se o alvo sobreviveu e a arma admite BR2, um painel de decisão é exibido para AMBOS os jogadores:')
bullet('[▶ CONTINUAR] — deseja um segundo round de fogo neste engajamento.')
bullet('[■ PARAR]     — encerra o engajamento aqui.')
body('A decisão de cada lado é revelada no painel após os dois jogadores escolherem:')
make_table(
    ['Azul', 'Vermelho', 'Resultado'],
    [
        ['PARAR',     'PARAR',    'Engajamento encerrado. Passa para o próximo.'],
        ['CONTINUAR', 'CONTINUAR','BR2 resolvido. Nenhum bônus de iniciativa.'],
        ['CONTINUAR', 'PARAR',    'BR2 resolvido. Força Azul recebe bônus de iniciativa (★).'],
        ['PARAR',     'CONTINUAR','BR2 resolvido. Força Vermelha recebe bônus de iniciativa (★).'],
    ],
    col_widths=[2.8, 2.8, 11.0]
)

h2('6.6 Bônus de Iniciativa (★)')
body('Quando apenas um dos lados decide CONTINUAR no BR2, aquele lado recebe o Bônus de Iniciativa: em vez de rolar 1d6 por tiro, rola 2d6 e usa o valor mais alto. Isso simula a vantagem tática de quem persegue o engajamento com determinação.')
note_box(
    'Exemplo: sem bônus, um dado resulta em 3 (2SP). Com bônus, dois dados resultam em 3 e 5 — usa-se 5 (3SP). '
    'O bônus aparece no painel como ★iniciativa ao lado de cada rolagem.',
    bg='FFFCE8', border_color='C9A84C'
)

h2('6.7 Contrataque no Battle Round 2')
body('No Battle Round 2, a unidade que foi alvo no BR1 também responde com fogo próprio — o contrataque. Isso representa a reação imediata do defensor durante o engajamento prolongado.')
bullet('O defensor seleciona automaticamente sua melhor arma de curto alcance (MSS, Torpedo, NavalGun, AirAttack ou ASW) contra o atacante original.')
bullet('Armas estratégicas (LACM, ASBM) NÃO são usadas no contrataque.')
bullet('O contrataque é resolvido simultaneamente ao BR2 do atacante e exibido no mesmo painel, com o símbolo ↩ e a seção "── Contrataque ──".')
bullet('Se o defensor escolheu CONTINUAR e o atacante PAROU, o defensor também recebe bônus de iniciativa (★) no contrataque.')

# ═══════════════════════════════════════════════════════════════════════════════
# 6.8 DANO
# ═══════════════════════════════════════════════════════════════════════════════
h2('6.8 Resolução de Dano — Sistema d6')
body('Cada tiro efetivo (não interceptado) gera uma rolagem de d6. O resultado determina o dano infligido ao alvo, de acordo com tabelas específicas por arma e categoria do alvo.')
make_table(
    ['d6', '1', '2', '3', '4', '5', '6'],
    [
        ['ASCM vs Superfície', '0','1','1','2','2','1d6'],
        ['MSS vs Superfície',  '0','1','1','2','2','1d6'],
        ['Torpedo vs Superfície','0','0','1','2','3','1d6'],
        ['LACM vs Terrestre',  '0','1','2','2','3','1d6'],
    ],
    col_widths=[4.0, 1.8, 1.8, 1.8, 1.8, 1.8, 1.8]
)
body('Quando o resultado da tabela indica "1d6 SP", um segundo dado é lançado e o valor obtido (1–6) é o dano total. Exibido no log como: d6=5→3(3SP).')

h2('6.9 Interceptação de Mísseis')
body('Antes de calcular o dano, mísseis podem ser abatidos pelas defesas do alvo. A interceptação ocorre automaticamente:')
bullet('DEFA (airDefense) intercepta ASCM e MSS: para cada míssil, rola 1d6 — resultado 5 ou 6 = interceptado.')
bullet('BMD intercepta LACM e ASBM: para cada míssil, rola 1d6 — resultado 5 ou 6 = interceptado.')
bullet('Torpedos NÃO são interceptáveis.')
bullet('O painel de Engajamento exibe o número de interceptados: ex. "[3 intercept.]". Somente os mísseis não interceptados alcançam o alvo.')
note_box(
    'IMPORTANTE: A interceptação NUNCA recebe bônus de iniciativa — o sistema defensivo age independentemente '
    'da decisão de CONTINUAR ou PARAR.',
    bg='FCE8E8', border_color='B71C1C'
)

h2('6.10 Staying Power (SP) e Destruição')
bullet('Cada unidade possui SP máximo (exibido como SP/MaxSP no painel lateral).')
bullet('Quando SP chega a 0, a unidade é destruída e removida do mapa.')
bullet('A unidade destruída aparece no painel com a mensagem DESTRUÍDO!')
bullet('Se uma unidade já foi destruída quando seu engajamento for processado, o painel exibe "Unidade já destruída — engajamento cancelado."')

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 7. DETECÇÃO
# ═══════════════════════════════════════════════════════════════════════════════
h1('7. Sistema de Detecção e Névoa de Guerra')
body('Unidades inimigas somente são visíveis no mapa se detectadas por pelo menos uma unidade aliada. Unidades não detectadas permanecem completamente ocultas — você não sabe onde estão.')

h2('Alcance de Detecção')
body('Cada unidade possui alcances de detecção específicos por categoria de alvo (superfície, aérea, submarino, terrestre). Uma unidade inimiga é detectada se qualquer unidade aliada estiver dentro do alcance correspondente.')
body('Notação no painel lateral: Det S/Aé/Sb/T = superfície / aérea / submarino / terrestre.')

h2('Efeito Diurno / Noturno')
make_table(
    ['Categoria Detectora', 'Diurno', 'Noturno', 'Observação'],
    [
        ['Superfície / Aérea', 'Alcance normal', '−2 hex', 'Penalidade noturna padrão'],
        ['Alvo furtivo (sub)', 'Alcance reduzido', '−1 hex', 'Penalidade adicional à detecção submarina'],
        ['Submarino (sonar)',  'Alcance normal', 'Sem penalidade', 'Sonar não depende de luz'],
        ['Águas profundas',   '—', '—', 'Detecção de sub −1 hex adicional'],
    ],
    col_widths=[4.2, 2.8, 2.8, 6.8]
)

h2('Regra da Movimentação Simultânea (Névoa)')
body('Durante a Fase de Movimentação, a detecção é calculada com as posições do INÍCIO do turno — tanto das unidades amigas quanto das inimigas. Isso significa:')
bullet('Mover uma unidade detectora mais perto de um inimigo NÃO a detecta imediatamente.')
bullet('Novas detecções decorrentes do movimento só são reveladas após AMBOS os jogadores confirmarem o fim da movimentação.')
bullet('As posições reais reveladas na transição para a fase de combate refletem onde cada unidade terminou o movimento — que pode ser diferente do que o adversário esperava.')

h2('Furtividade (Stealthy)')
bullet('Submarinos são furtivos por natureza.')
bullet('Alvos furtivos exigem alcance de detecção específico para "submarine" — geralmente muito menor que o alcance para superfície.')
bullet('Em águas profundas (T_DEEP), o alcance efetivo de sonar é reduzido em 1 hex adicional.')

note_box(
    'TÁTICA: À noite, agrupe seus principais grupos navais próximos às unidades de patrulha marítima (P-3AM) '
    '— são os maiores detectores da Força Azul. Submarinos inimigos são especialmente difíceis de detectar '
    'à noite em águas profundas: alcance efetivo pode cair a 1 hex ou menos.',
    bg='E8F4FF', border_color='1565C0'
)

# ═══════════════════════════════════════════════════════════════════════════════
# 8. RECOMPLETAMENTO
# ═══════════════════════════════════════════════════════════════════════════════
h1('8. Recompletamento de Munição')
body('O recompletamento de armas expendáveis ocorre automaticamente ao final de cada turno, conforme as regras abaixo. O valor restaurado é sempre o estoque inicial da unidade (quantidade máxima).')

h2('Regras de Recompletamento')
make_table(
    ['Força', 'Unidade', 'Condição de Recompletamento'],
    [
        ['Azul', 'Navios de superfície', 'Estacionado em hex de Porto ou Base Naval'],
        ['Azul', 'Aeronaves',            'Estacionado em hex de Base Aérea ou no hex do Porta-Aviões'],
        ['Azul', 'Unidades terrestres',  'Recompletamento automático (sempre)'],
        ['Vermelho', 'Aeronaves',        'Estacionado no hex do Porta-Aviões no fim do turno (sem mover)'],
        ['Vermelho', 'Navios / demais',  'SEM recompletamento — munição é finita'],
    ],
    col_widths=[2.2, 4.2, 10.2]
)

body('Quando uma unidade recompeta, o log registra: 🔄 [nome] recompletou: ASCM, MSS, ...')
note_box(
    'IMPORTANTE: Unidades que se MOVERAM no turno NÃO se recompletam — o recompletamento '
    'exige operação estacionária. Planeje retiradas e reabastecimentos com antecedência.\n'
    'A Força Vermelha tem recompletamento APENAS para suas aeronaves no porta-aviões. '
    'Todos os outros sistemas são finitos — gerencie munição com cuidado.',
    bg='FFF3E0', border_color='E65C00'
)

# ═══════════════════════════════════════════════════════════════════════════════
# 9. VITÓRIA
# ═══════════════════════════════════════════════════════════════════════════════
h1('9. Condição de Vitória')
body('O jogo termina imediatamente, em qualquer momento da fase de combate, quando uma das partes não possuir mais nenhuma unidade com capacidade ofensiva restante.')
body('Uma unidade possui capacidade ofensiva se tiver: attackRange > 0 em qualquer categoria, OU armas expendáveis com quantidade > 0, OU qualquer capacidade (airDefense, asw, etc.) com valor > 0.')
body('Unidades puramente logísticas (portos, FPSOs, navios de reabastecimento) não contam para esta verificação.')

h2('Derrota por Exaustão')
body('Se a Força Vermelha esgotar toda sua munição sem destruir unidades suficientes, a Força Azul vence por exaustão — a frota inimiga fica sem poder ofensivo.')

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 10. CATÁLOGO
# ═══════════════════════════════════════════════════════════════════════════════
h1('10. Catálogo de Plataformas')
body('Cada unidade é representada por um contador circular no mapa. A cor identifica o lado: AZUL = Força Azul; VERMELHO = Força Vermelha. O número no canto indica o SP atual.')

h2('Força Azul — Plataformas')
make_table(
    ['Símbolo', 'Tipo', 'Categoria', 'Papel Tático'],
    [
        ['⬡ Círculo azul / fragata',   'Fragata / Corveta',      'Superfície', 'Escolta, defesa aérea, ASW'],
        ['⬡ Círculo azul / destroyer', 'Destroyer',              'Superfície', 'Multimissão — ASCM, ASW, DEFA'],
        ['⬡ Círculo azul / sub',       'Submarino',              'Submarina',  'Ataque furtivo (Torpedo/MSS)'],
        ['⬡ Círculo azul / carrier',   'Porta-Aviões',           'Superfície', 'Plataforma de aviação; recomposta aeronaves'],
        ['⬡ Círculo azul / aviao',     'Aeronave (P-3AM, S-70B)','Aérea',      'Patrulha marítima, ASW, detecção'],
        ['⬡ Círculo azul / base',      'Base Naval / Porto',     'Terrestre',  'Ponto logístico; recompletamento'],
        ['⬡ Círculo azul / bateria',   'Bateria Costeira',       'Terrestre',  'ASCM / navalGun de longo alcance'],
    ],
    col_widths=[4.2, 3.8, 2.8, 5.8]
)

h2('Força Vermelha — Plataformas')
make_table(
    ['Símbolo', 'Tipo', 'Categoria', 'Papel Tático'],
    [
        ['⬡ Círculo vermelho / destroyer', 'Destroyer / Cruzador',  'Superfície', 'Ataque de área; ASCM, ASBM'],
        ['⬡ Círculo vermelho / sub',       'Submarino de ataque',   'Submarina',  'Torpedo / MSS furtivo'],
        ['⬡ Círculo vermelho / carrier',   'Porta-Aviões',          'Superfície', 'Projeção aérea; recomposta aeronaves'],
        ['⬡ Círculo vermelho / aviao',     'Aeronave (Su-30, Ka-27)','Aérea',     'Superioridade aérea, strike ASCM'],
        ['⬡ Círculo vermelho / anfibio',   'Navio Anfíbio',         'Superfície', 'Desembarque; objetivo secundário'],
        ['⬡ Círculo vermelho / logistico', 'Navio de Suprimento',   'Superfície', 'Logística; sem armamento ofensivo'],
    ],
    col_widths=[4.2, 3.8, 2.8, 5.8]
)

h2('Símbolos Gráficos dos Contadores')
make_table(
    ['Ícone', 'Tipo de Plataforma'],
    [
        ['🚢 Navio / fragata',        'Unidade de superfície genérica (fragata, corveta, destroyer)'],
        ['⚓ Âncora',                 'Porto / base logística (fixa)'],
        ['✛ Cruz / "+"',             'Base Naval'],
        ['✈ Avião',                  'Aeronave de asa fixa (P-3AM, Su-30, etc.)'],
        ['🚁 Hélice',                'Helicóptero naval (S-70B, Ka-27)'],
        ['🔵 Círculo grande',        'Porta-Aviões / navio capital'],
        ['△ Triângulo',              'Plataforma de petróleo (FPSO)'],
        ['⬛ Quadrado sólido',       'Navio anfíbio ou de suprimento'],
        ['≈ Onda',                   'Submarino'],
    ],
    col_widths=[4.0, 12.6]
)

page_break(doc)

# ═══════════════════════════════════════════════════════════════════════════════
# 11. REFERÊNCIA RÁPIDA
# ═══════════════════════════════════════════════════════════════════════════════
h1('11. Referência Rápida')

h2('Sequência de Jogo por Turno')
make_table(
    ['Etapa', 'Ação'],
    [
        ['1', 'Fase de Movimentação — ambos os jogadores planejam e confirmam movimentos (secreto)'],
        ['2', 'Revelação simultânea das posições + novas detecções'],
        ['3', 'Fase de Combate — ambos declaram ataques (e quantidades de salva) e confirmam'],
        ['4', 'Servidor resolve Engajamentos um a um via Battle Rounds'],
        ['5', 'Para cada BR1: painel exibe resultado; jogadores decidem CONTINUAR ou PARAR'],
        ['6', 'Se BR2: fogo do atacante + contrataque do defensor; bônus de iniciativa se assimétrico'],
        ['7', 'Fim dos Engajamentos → verificação de vitória → recompletamento → próximo turno'],
    ],
    col_widths=[0.8, 15.8]
)

h2('Lembretes Importantes')
bullet('Submarinos são furtivos — o sonar deles não sofre penalidade noturna.')
bullet('O sonar não detecta alvos terrestres ou aéreos (alcance 0).')
bullet('Unidades que se moveram NÃO se recompletam no mesmo turno.')
bullet('Armas expendáveis esgotadas = unidade não pode atacar com aquela arma.')
bullet('Interceptação (DEFA/BMD) ocorre ANTES do cálculo de dano e nunca recebe bônus de iniciativa.')
bullet('Torpedo não pode ser interceptado.')
bullet('A Força Vermelha só recomposta aeronaves no porta-aviões — demais munições são finitas.')
bullet('LACM e ASBM têm apenas 1 Battle Round — sem opção de continuar/contrataque.')
bullet('Novas detecções pelo movimento próprio só são reveladas APÓS ambos confirmarem a fase.')
bullet('Salva padrão: ASCM 2 · MSS 2 · Torpedo 1 · LACM 1 · ASBM 1 (ajustável pelo jogador).')

h2('Abreviações')
make_table(
    ['Abreviação', 'Significado'],
    [
        ['SP',    'Staying Power — pontos de vida da unidade'],
        ['ASCM',  'Anti-Ship Cruise Missile — míssil antinavio de cruzeiro'],
        ['MSS',   'Multi-purpose Ship-launched missile — míssil versátil embarcado'],
        ['LACM',  'Land-Attack Cruise Missile — míssil de cruzeiro de ataque terrestre'],
        ['ASBM',  'Anti-Ship Ballistic Missile — míssil balístico antinavio'],
        ['ASW',   'Anti-Submarine Warfare — guerra antissubmarina'],
        ['DEFA',  'Defesa Antiaérea (airDefense) — intercepta ASCM/MSS'],
        ['BMD',   'Ballistic Missile Defense — intercepta LACM/ASBM'],
        ['BR1/2', 'Battle Round 1 / Battle Round 2'],
        ['T_LAND','Terreno terrestre — intransponível para navios e submarinos'],
        ['T_DEEP','Águas profundas — reduz detecção submarina em 1 hex'],
    ],
    col_widths=[2.8, 13.8]
)

# Footer line
p_foot = doc.add_paragraph()
p_foot.paragraph_format.space_before = Pt(20)
p_foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
rf = p_foot.add_run('Operação Atlântico Sul — Manual do Jogador  |  Versão 2.0')
rf.font.name = 'Calibri'; rf.font.size = Pt(8.5); rf.font.color.rgb = DIM; rf.font.italic = True

# Save
out = '/home/user/wargame-naval/manual_jogador_v2.docx'
doc.save(out)
print(f'Saved: {out}')
