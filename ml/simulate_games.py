#!/usr/bin/env python3
"""
Generates synthetic game logs for bootstrap imitation learning training.

Combat model calibrated to match shared/combat_config.js (Bacia de Campos / SIGE 2026):
  - d6 damage tables with η-based hit probability
  - Interception by airDefense / bmd
  - Weapon priority matching server.js WEAPON_PRIORITY
  - Roll=6 → critical hit (roll 2nd d6 for damage)

Usage:
    python ml/simulate_games.py --n 100
"""

import argparse
import json
import random
import time
from copy import deepcopy
from pathlib import Path

ROOT    = Path(__file__).parent.parent
LOG_DIR = ROOT / "data" / "game-logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

GRID_W, GRID_H = 16, 10
TERRAIN_MAP = [
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
]
T_LAND = 0
CUBE_DIRS = [(+1,-1,0),(+1,0,-1),(0,+1,-1),(-1,+1,0),(-1,0,+1),(0,-1,+1)]


# ─── Hex helpers ─────────────────────────────────────────────────────────────
def get_terrain(col, row):
    if col < 0 or col >= GRID_W or row < 0 or row >= GRID_H:
        return T_LAND
    return TERRAIN_MAP[row][col]

def oddq_to_cube(col, row):
    x = col; z = row - (col - (col & 1)) // 2
    return (x, -x - z, z)

def cube_to_oddq(x, z):
    return (x, z + (x - (x & 1)) // 2)

def hex_neighbors(col, row):
    cx, _, cz = oddq_to_cube(col, row)
    return [(nc, nr) for dx, dy, dz in CUBE_DIRS
            for nc, nr in [cube_to_oddq(cx+dx, cz+dz)]
            if 0 <= nc < GRID_W and 0 <= nr < GRID_H]

def hex_dist(c1, r1, c2, r2):
    a = oddq_to_cube(c1, r1); b = oddq_to_cube(c2, r2)
    return max(abs(a[0]-b[0]), abs(a[1]-b[1]), abs(a[2]-b[2]))

def can_enter(category, col, row):
    t = get_terrain(col, row)
    if category in ('air', 'neutral_air'): return True
    if category == 'land':       return t in (0, 1)
    if category == 'submarine':  return t not in (0, 1)
    return t != 0


# ─── Combat model (mirrors combat_config.js + combat_engine.js) ──────────────

def d6():
    return random.randint(1, 6)

# New calibrated damage tables (Bacia de Campos / SIGE 2026)
# Format: {roll: damage_or_'1d6'}
DAMAGE_TABLES = {
    'blue': {
        'ascmSurface':  {'surface':  {1:0,2:2,3:2,4:2,5:2,6:'1d6'}},
        'mssSurface':   {'surface':  {1:0,2:1,3:1,4:1,5:1,6:'1d6'}},
        'torpedo':      {'surface':  {1:0,2:2,3:2,4:2,5:2,6:'1d6'},
                         'submarine':{1:0,2:1,3:1,4:1,5:1,6:'1d6'}},
        'lacm':         {'land':     {1:0,2:2,3:2,4:2,5:2,6:'1d6'}},
        'asbmSurface':  {'surface':  {1:0,2:0,3:2,4:2,5:2,6:'1d6'}},
        'navalGun':     {'surface':  {1:0,2:0,3:1,4:1,5:1,6:1},
                         'land':     {1:0,2:0,3:0,4:1,5:1,6:1}},
        'airDefense':   {'air':      {1:0,2:1,3:1,4:1,5:1,6:1},
                         'missile':  {1:0,2:1,3:1,4:1,5:1,6:1}},
        'bmd':          {'air':      {1:0,2:0,3:0,4:1,5:1,6:1},
                         'missile':  {1:0,2:0,3:0,4:1,5:1,6:1}},
        'asw':          {'submarine':{1:0,2:0,3:1,4:1,5:1,6:'1d6'}},
        'airAttack':    {'surface':  {1:0,2:0,3:2,4:2,5:2,6:'1d6'},
                         'air':      {1:0,2:0,3:1,4:1,5:1,6:'1d6'},
                         'land':     {1:0,2:0,3:1,4:1,5:1,6:'1d6'}},
    },
    'red': {  # same values after calibration
        'ascmSurface':  {'surface':  {1:0,2:2,3:2,4:2,5:2,6:'1d6'}},
        'mssSurface':   {'surface':  {1:0,2:1,3:1,4:1,5:1,6:'1d6'}},
        'torpedo':      {'surface':  {1:0,2:2,3:2,4:2,5:2,6:'1d6'},
                         'submarine':{1:0,2:1,3:1,4:1,5:1,6:'1d6'}},
        'lacm':         {'land':     {1:0,2:2,3:2,4:2,5:2,6:'1d6'}},
        'asbmSurface':  {'surface':  {1:0,2:0,3:2,4:2,5:2,6:'1d6'}},
        'navalGun':     {'surface':  {1:0,2:0,3:1,4:1,5:1,6:1},
                         'land':     {1:0,2:0,3:0,4:1,5:1,6:1}},
        'airDefense':   {'air':      {1:0,2:1,3:1,4:1,5:1,6:1},
                         'missile':  {1:0,2:1,3:1,4:1,5:1,6:1}},
        'bmd':          {'air':      {1:0,2:0,3:0,4:1,5:1,6:1},
                         'missile':  {1:0,2:0,3:0,4:1,5:1,6:1}},
        'asw':          {'submarine':{1:0,2:0,3:1,4:1,5:1,6:'1d6'}},
        'airAttack':    {'surface':  {1:0,2:0,3:2,4:2,5:2,6:'1d6'},
                         'air':      {1:0,2:0,3:1,4:1,5:1,6:'1d6'},
                         'land':     {1:0,2:0,3:1,4:1,5:1,6:'1d6'}},
    },
}

# Weapon profiles (mirrors combat_config.js weaponProfiles)
WEAPON_PROFILES = {
    'ascm':      {'expendable':True,  'defaultRange':6,  'targets':['surface'],
                  'interceptableBy':['airDefense'], 'damageProfile':'ascmSurface'},
    'mss':       {'expendable':True,  'defaultRange':3,  'targets':['surface'],
                  'interceptableBy':['airDefense'], 'damageProfile':'mssSurface'},
    'torpedo':   {'expendable':True,  'defaultRange':2,  'targets':['surface','submarine'],
                  'interceptableBy':[], 'damageProfile':'torpedo'},
    'lacm':      {'expendable':True,  'defaultRange':10, 'targets':['land'],
                  'interceptableBy':['airDefense','bmd'], 'damageProfile':'lacm'},
    'asbm':      {'expendable':True,  'defaultRange':10, 'targets':['surface'],
                  'interceptableBy':['bmd'], 'damageProfile':'asbmSurface'},
    'navalGun':  {'expendable':False, 'defaultRange':1,  'targets':['surface','land'],
                  'interceptableBy':[], 'damageProfile':'navalGun'},
    'airDefense':{'expendable':False, 'defaultRange':1,  'targets':['air'],
                  'interceptableBy':[], 'damageProfile':'airDefense'},
    'bmd':       {'expendable':False, 'defaultRange':1,  'targets':['air'],
                  'interceptableBy':[], 'damageProfile':'bmd'},
    'asw':       {'expendable':False, 'defaultRange':2,  'targets':['submarine'],
                  'interceptableBy':[], 'damageProfile':'asw'},
    'airAttack': {'expendable':False, 'defaultRange':4,  'targets':['surface','air','land'],
                  'interceptableBy':['airDefense'], 'damageProfile':'airAttack'},
}

# Weapon priority per target category (mirrors server.js WEAPON_PRIORITY)
WEAPON_PRIORITY = {
    'surface':   ['ascm','asbm','mss','torpedo','airAttack','navalGun'],
    'submarine': ['asw','torpedo'],
    'air':       ['airDefense','airAttack'],
    'land':      ['lacm','airAttack','navalGun'],
}

SALVO_SIZE = {'ascm':2, 'mss':2, 'torpedo':1, 'lacm':1, 'asbm':1}


def get_weapon_qty(unit, wpn):
    return (unit.get('weapons',{}).get(wpn) or {}).get('quantity', 0)

def get_weapon_range(unit, wpn):
    w = (unit.get('weapons',{}).get(wpn) or {})
    if 'range' in w:
        return w['range']
    return WEAPON_PROFILES[wpn]['defaultRange']

def resolve_damage_roll(team, damage_profile, target_cat, advantage=False):
    """Roll d6 (with optional advantage) and look up damage. Returns (roll, damage)."""
    table = DAMAGE_TABLES.get(team, {}).get(damage_profile, {}).get(target_cat)
    if not table:
        return 0, 0
    roll = d6()
    if advantage:
        roll = max(roll, d6())
    value = table.get(roll, 0)
    if value == '1d6':
        return roll, d6()
    return roll, int(value)

def resolve_interception(defender, incoming_wpn, launched):
    """Resolve interception rolls. Returns number of missiles that get through."""
    profile = WEAPON_PROFILES.get(incoming_wpn, {})
    interceptable_by = profile.get('interceptableBy', [])
    remaining = launched
    for def_wpn in interceptable_by:
        def_qty = get_weapon_qty(defender, def_wpn)
        if def_qty <= 0:
            continue
        shots = min(remaining, def_qty)
        intercepted = 0
        def_profile = WEAPON_PROFILES.get(def_wpn, {})
        for _ in range(shots):
            _, dmg = resolve_damage_roll(defender['team'],
                                         def_profile['damageProfile'], 'missile')
            if dmg > 0:
                intercepted += 1
        remaining = max(0, remaining - intercepted)
        if remaining <= 0:
            break
    return remaining  # missiles that bypassed interception

def select_weapon(attacker, target, dist):
    """Select best weapon using server.js priority order."""
    priority = WEAPON_PRIORITY.get(target['category'], [])
    for wpn in priority:
        qty = get_weapon_qty(attacker, wpn)
        if qty <= 0 and WEAPON_PROFILES.get(wpn, {}).get('expendable', True):
            continue
        if not WEAPON_PROFILES.get(wpn, {}).get('expendable', False) and qty <= 0:
            # Non-expendable: check it exists at all in unit's weapons dict
            if wpn not in (attacker.get('weapons') or {}):
                continue
        profile = WEAPON_PROFILES.get(wpn)
        if not profile:
            continue
        if target['category'] not in profile['targets']:
            continue
        if dist > get_weapon_range(attacker, wpn):
            continue
        return wpn
    return None

def resolve_engagement(attacker, defender, initiative_bonus_team=None):
    """
    Full engagement resolution matching combat_engine.js.
    Returns {'ok', 'total_damage', 'destroyed', 'weapon', 'launched', 'intercepted'}.
    """
    dist = hex_dist(attacker['col'], attacker['row'], defender['col'], defender['row'])
    wpn = select_weapon(attacker, defender, dist)
    if not wpn:
        return {'ok': False, 'total_damage': 0, 'destroyed': False,
                'weapon': None, 'launched': 0, 'intercepted': 0}

    profile    = WEAPON_PROFILES[wpn]
    dmg_profile = profile['damageProfile']
    expendable  = profile['expendable']

    qty = get_weapon_qty(attacker, wpn)
    salvo = SALVO_SIZE.get(wpn, 1)
    if expendable:
        launched = min(qty, salvo)
        if launched <= 0:
            return {'ok': False, 'total_damage': 0, 'destroyed': False,
                    'weapon': wpn, 'launched': 0, 'intercepted': 0}
        # Spend ammo
        attacker['weapons'][wpn]['quantity'] = qty - launched
    else:
        launched = 1

    effective = resolve_interception(defender, wpn, launched)
    intercepted = launched - effective

    advantage = (initiative_bonus_team is not None and
                 initiative_bonus_team == attacker['team'])

    total_dmg = 0
    for _ in range(effective):
        _, dmg = resolve_damage_roll(attacker['team'], dmg_profile,
                                     defender['category'], advantage)
        total_dmg += dmg

    defender['hp'] = max(0, defender['hp'] - total_dmg)
    destroyed = defender['hp'] == 0

    return {'ok': True, 'total_damage': total_dmg, 'destroyed': destroyed,
            'weapon': wpn, 'launched': launched, 'intercepted': intercepted}


# ─── Starting order of battle ─────────────────────────────────────────────────
BLUE_TEMPLATE = [
    {'id':'BLU-01','name':'Fragata Azul 1',   'team':'blue','category':'surface',
     'col':2,'row':4,'hp':8,'maxHp':8,'movement':3,
     'weapons':{'ascm':{'quantity':4},'navalGun':{'quantity':99}},
     'attackRange':{'surface':6,'submarine':2,'air':1,'land':1},
     'detectionRange':{'surface':3,'submarine':1,'air':3,'land':2},
     'fuel':{'current':8,'max':8,'usesFuel':True}},
    {'id':'BLU-02','name':'Fragata Azul 2',   'team':'blue','category':'surface',
     'col':3,'row':6,'hp':8,'maxHp':8,'movement':3,
     'weapons':{'ascm':{'quantity':4},'mss':{'quantity':4},'navalGun':{'quantity':99}},
     'attackRange':{'surface':6,'submarine':2,'air':1,'land':1},
     'detectionRange':{'surface':3,'submarine':1,'air':3,'land':2},
     'fuel':{'current':8,'max':8,'usesFuel':True}},
    {'id':'BLU-03','name':'Submarino Azul',   'team':'blue','category':'submarine',
     'col':5,'row':7,'hp':6,'maxHp':6,'movement':3,
     'weapons':{'torpedo':{'quantity':6}},
     'attackRange':{'surface':2,'submarine':2,'air':0,'land':0},
     'detectionRange':{'surface':2,'submarine':2,'air':0,'land':1},
     'fuel':{'current':8,'max':8,'usesFuel':False}},
    {'id':'BLU-04','name':'Destroier Azul',   'team':'blue','category':'surface',
     'col':2,'row':7,'hp':10,'maxHp':10,'movement':4,
     'weapons':{'ascm':{'quantity':6},'navalGun':{'quantity':99},
                'airDefense':{'quantity':4},'mss':{'quantity':4}},
     'attackRange':{'surface':6,'submarine':2,'air':2,'land':3},
     'detectionRange':{'surface':4,'submarine':1,'air':4,'land':3},
     'fuel':{'current':10,'max':10,'usesFuel':True}},
]

RED_TEMPLATE = [
    {'id':'RED-01','name':'Fragata Vermelha 1','team':'red','category':'surface',
     'col':13,'row':3,'hp':8,'maxHp':8,'movement':3,
     'weapons':{'ascm':{'quantity':4},'navalGun':{'quantity':99}},
     'attackRange':{'surface':6,'submarine':2,'air':1,'land':1},
     'detectionRange':{'surface':3,'submarine':1,'air':3,'land':2},
     'fuel':{'current':8,'max':8,'usesFuel':True}},
    {'id':'RED-02','name':'Fragata Vermelha 2','team':'red','category':'surface',
     'col':12,'row':5,'hp':8,'maxHp':8,'movement':3,
     'weapons':{'ascm':{'quantity':4},'mss':{'quantity':4},'navalGun':{'quantity':99}},
     'attackRange':{'surface':6,'submarine':2,'air':1,'land':1},
     'detectionRange':{'surface':3,'submarine':1,'air':3,'land':2},
     'fuel':{'current':8,'max':8,'usesFuel':True}},
    {'id':'RED-03','name':'Submarino Vermelho','team':'red','category':'submarine',
     'col':10,'row':7,'hp':6,'maxHp':6,'movement':3,
     'weapons':{'torpedo':{'quantity':6}},
     'attackRange':{'surface':2,'submarine':2,'air':0,'land':0},
     'detectionRange':{'surface':2,'submarine':2,'air':0,'land':1},
     'fuel':{'current':8,'max':8,'usesFuel':False}},
    {'id':'RED-04','name':'Destroier Vermelho','team':'red','category':'surface',
     'col':14,'row':6,'hp':10,'maxHp':10,'movement':4,
     'weapons':{'ascm':{'quantity':6},'navalGun':{'quantity':99},
                'airDefense':{'quantity':4},'mss':{'quantity':4}},
     'attackRange':{'surface':6,'submarine':2,'air':2,'land':3},
     'detectionRange':{'surface':4,'submarine':1,'air':4,'land':3},
     'fuel':{'current':10,'max':10,'usesFuel':True}},
]


# ─── Bot strategies ────────────────────────────────────────────────────────────
def bot_move(unit, enemies, allies, strategy='aggressive'):
    if unit.get('movement', 0) == 0:
        return unit['col'], unit['row']
    live_en = [e for e in enemies if e.get('hp', 0) > 0]
    if not live_en:
        return unit['col'], unit['row']
    col, row = unit['col'], unit['row']

    # Select target
    if strategy == 'flanking':
        target = random.choice(live_en)
    else:
        target = min(live_en, key=lambda e: hex_dist(col, row, e['col'], e['row']))

    target_dist = hex_dist(col, row, target['col'], target['row'])
    wpn = select_weapon(unit, target, target_dist)
    best_range = get_weapon_range(unit, wpn) if wpn else 0

    if strategy == 'defensive':
        if best_range > 0 and target_dist > best_range * 2:
            return col, row

    # Already in comfortable range — hold
    if best_range > 0 and target_dist <= max(1, best_range - 1):
        return col, row

    # Multi-step BFS toward target
    cur_col, cur_row = col, row
    for _ in range(unit.get('movement', 1)):
        best_nc, best_nr = cur_col, cur_row
        best_d = hex_dist(cur_col, cur_row, target['col'], target['row'])
        for nc, nr in hex_neighbors(cur_col, cur_row):
            if not can_enter(unit['category'], nc, nr):
                continue
            d = hex_dist(nc, nr, target['col'], target['row'])
            if d < best_d:
                best_d = d; best_nc, best_nr = nc, nr
        if best_nc == cur_col and best_nr == cur_row:
            break
        cur_col, cur_row = best_nc, best_nr
        if best_range > 0 and hex_dist(cur_col, cur_row, target['col'], target['row']) <= best_range:
            break
    return cur_col, cur_row


def bot_declare_attacks(team, all_units):
    my = [u for u in all_units if u['team'] == team and u.get('hp', 0) > 0]
    en = [u for u in all_units if u['team'] != team and u['team'] != 'neutral' and u.get('hp', 0) > 0]
    attacks = []
    for unit in my:
        candidates = []
        for enemy in en:
            dist = hex_dist(unit['col'], unit['row'], enemy['col'], enemy['row'])
            wpn  = select_weapon(unit, enemy, dist)
            if wpn:
                candidates.append((enemy['hp'], dist, enemy))
        if candidates:
            candidates.sort(key=lambda x: (x[0], x[1]))  # lowest HP, then nearest
            attacks.append({'attackerId': unit['id'], 'targetId': candidates[0][2]['id']})
    return attacks


def check_winner(units):
    def has_offense(u):
        if u.get('hp', 0) <= 0: return False
        return any(v > 0 for v in u.get('attackRange', {}).values())
    b = any(has_offense(u) for u in units if u['team'] == 'blue')
    r = any(has_offense(u) for u in units if u['team'] == 'red')
    if not b: return 'red'
    if not r: return 'blue'
    return None


# ─── Game simulation ──────────────────────────────────────────────────────────
def simulate_game(game_id, max_turns=30, seed=None):
    if seed is not None:
        random.seed(seed)

    ts       = time.strftime('%Y%m%dT%H%M%S')
    log_path = LOG_DIR / f"game_SIM{game_id:04d}_{ts}.jsonl"
    events   = []
    now      = lambda: time.strftime('%Y-%m-%dT%H:%M:%SZ')

    units = [deepcopy(u) for u in BLUE_TEMPLATE + RED_TEMPLATE]

    # Slight random jitter in starting positions
    for u in units:
        for _ in range(3):
            nc = u['col'] + random.randint(-1, 1)
            nr = u['row'] + random.randint(-1, 1)
            if 0 <= nc < GRID_W and 0 <= nr < GRID_H and can_enter(u['category'], nc, nr):
                u['col'], u['row'] = nc, nr
                break

    blue_strat = random.choice(['aggressive','aggressive','defensive','flanking'])
    red_strat  = random.choice(['aggressive','aggressive','defensive','flanking'])

    events.append({'event':'game_start','room':f'SIM{game_id:04d}',
                   'turn':1,'period':'day',
                   'units':[dict(u) for u in units],'ts':now()})

    winner = None
    turn_num, period = 1, 'day'

    for t in range(max_turns):
        turn_num = t // 2 + 1
        period   = 'day' if t % 2 == 0 else 'night'

        # ── Movement ──────────────────────────────────────────────────────────
        for team, strat in (('blue', blue_strat), ('red', red_strat)):
            my  = [u for u in units if u['team'] == team  and u.get('hp',0) > 0]
            en  = [u for u in units if u['team'] != team  and u.get('hp',0) > 0]
            moves = []
            for unit in my:
                oc, or_ = unit['col'], unit['row']
                nc, nr  = bot_move(unit, en, my, strat)
                moves.append({'unitId':unit['id'],
                              'from':{'col':oc,'row':or_},
                              'to':  {'col':nc,'row':nr}})
                unit['col'], unit['row'] = nc, nr
                unit['moved'] = (nc != oc or nr != or_)
            events.append({'event':'movement_committed','room':f'SIM{game_id:04d}',
                           'team':team,'turn':turn_num,'period':period,
                           'moves':moves,'units':[dict(u) for u in units],'ts':now()})

        # ── Combat ────────────────────────────────────────────────────────────
        blue_atk = bot_declare_attacks('blue', units)
        red_atk  = bot_declare_attacks('red',  units)
        events.append({'event':'attacks_declared','room':f'SIM{game_id:04d}',
                       'turn':turn_num,'period':period,
                       'blueAttacks':blue_atk,'redAttacks':red_atk,
                       'units':[dict(u) for u in units],'ts':now()})

        unit_map = {u['id']: u for u in units}
        all_atk  = blue_atk + red_atk
        random.shuffle(all_atk)

        for atk in all_atk:
            att = unit_map.get(atk['attackerId'])
            tgt = unit_map.get(atk['targetId'])
            if not att or not tgt or att.get('hp',0)<=0 or tgt.get('hp',0)<=0:
                continue
            result = resolve_engagement(att, tgt)
            events.append({'event':'engagement_resolved','room':f'SIM{game_id:04d}',
                           'attackerId':att['id'],'targetId':tgt['id'],
                           'weapon':result['weapon'],
                           'launched':result['launched'],'intercepted':result['intercepted'],
                           'damage':result['total_damage'],'destroyed':result['destroyed'],
                           'targetHpAfter':tgt['hp'],'ts':now()})

        winner = check_winner(units)
        if winner:
            break

        for u in units:
            u['moved'] = False

    events.append({'event':'game_over','room':f'SIM{game_id:04d}',
                   'winner':winner or 'draw','turn':turn_num,'period':period,
                   'units':[dict(u) for u in units],'ts':now()})

    with open(log_path, 'w') as f:
        for ev in events:
            f.write(json.dumps(ev) + '\n')

    return winner or 'draw', log_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--n', type=int, default=100)
    args = parser.parse_args()

    print(f"=== Operação Atlântico Sul — Synthetic Data Generator (calibrated d6) ===")
    print(f"Generating {args.n} games → {LOG_DIR}\n")

    results = {}
    for i in range(args.n):
        winner, _ = simulate_game(i, seed=i)
        results[winner] = results.get(winner, 0) + 1
        if (i+1) % 20 == 0 or i == args.n-1:
            b = results.get('blue',0); r = results.get('red',0); d = results.get('draw',0)
            print(f"  [{i+1:>4}/{args.n}] Blue {b} | Red {r} | Draw {d}")

    b = results.get('blue',0); r = results.get('red',0); d = results.get('draw',0)
    print(f"\nDone! Blue {b} ({100*b//args.n}%) | Red {r} ({100*r//args.n}%) | Draw {d}")
    print(f"Run: python ml/train_bot.py")


if __name__ == '__main__':
    main()
