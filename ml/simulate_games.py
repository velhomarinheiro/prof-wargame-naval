#!/usr/bin/env python3
"""
Generates synthetic game logs for bootstrap imitation learning training.

Implements a rule-based simulator that replicates core game mechanics from
server.js in Python. Outputs JSONL files compatible with train_bot.py.

Usage:
    python ml/simulate_games.py --n 100
"""

import argparse
import json
import random
import time
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).parent.parent
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


def get_terrain(col, row):
    if col < 0 or col >= GRID_W or row < 0 or row >= GRID_H:
        return T_LAND
    return TERRAIN_MAP[row][col]


def oddq_to_cube(col, row):
    x = col
    z = row - (col - (col & 1)) // 2
    return (x, -x - z, z)


def cube_to_oddq(x, z):
    return (x, z + (x - (x & 1)) // 2)


def hex_neighbors(col, row):
    cx, _, cz = oddq_to_cube(col, row)
    result = []
    for dx, dy, dz in CUBE_DIRS:
        nc, nr = cube_to_oddq(cx + dx, cz + dz)
        if 0 <= nc < GRID_W and 0 <= nr < GRID_H:
            result.append((nc, nr))
    return result


def hex_dist(c1, r1, c2, r2):
    a = oddq_to_cube(c1, r1)
    b = oddq_to_cube(c2, r2)
    return max(abs(a[0]-b[0]), abs(a[1]-b[1]), abs(a[2]-b[2]))


def can_enter(category, col, row):
    t = get_terrain(col, row)
    if category in ('air', 'neutral_air'):
        return True
    if category == 'land':
        return t in (0, 1)
    if category == 'submarine':
        return t not in (0, 1)
    return t != 0  # surface: not land


# ─── Starting order of battle ──────────────────────────────────────────────────
BLUE_TEMPLATE = [
    {'id': 'BLU-01', 'name': 'Fragata Azul 1',   'team': 'blue', 'category': 'surface',
     'col': 2, 'row': 4, 'hp': 8, 'maxHp': 8, 'movement': 3,
     'weapons': {'ascm': {'quantity': 4}, 'navalGun': {'quantity': 10}},
     'attackRange': {'surface': 3, 'submarine': 2, 'air': 1, 'land': 2},
     'detectionRange': {'surface': 3, 'submarine': 1, 'air': 3, 'land': 2},
     'fuel': {'current': 8, 'max': 8, 'usesFuel': True}},
    {'id': 'BLU-02', 'name': 'Fragata Azul 2',   'team': 'blue', 'category': 'surface',
     'col': 3, 'row': 6, 'hp': 8, 'maxHp': 8, 'movement': 3,
     'weapons': {'ascm': {'quantity': 4}, 'navalGun': {'quantity': 10}},
     'attackRange': {'surface': 3, 'submarine': 2, 'air': 1, 'land': 2},
     'detectionRange': {'surface': 3, 'submarine': 1, 'air': 3, 'land': 2},
     'fuel': {'current': 8, 'max': 8, 'usesFuel': True}},
    {'id': 'BLU-03', 'name': 'Submarino Azul',    'team': 'blue', 'category': 'submarine',
     'col': 5, 'row': 7, 'hp': 6, 'maxHp': 6, 'movement': 3,
     'weapons': {'torpedo': {'quantity': 6}},
     'attackRange': {'surface': 3, 'submarine': 2, 'air': 0, 'land': 0},
     'detectionRange': {'surface': 2, 'submarine': 2, 'air': 0, 'land': 1},
     'fuel': {'current': 8, 'max': 8, 'usesFuel': False}},
    {'id': 'BLU-04', 'name': 'Destroier Azul',    'team': 'blue', 'category': 'surface',
     'col': 2, 'row': 7, 'hp': 10, 'maxHp': 10, 'movement': 4,
     'weapons': {'ascm': {'quantity': 6}, 'navalGun': {'quantity': 12}, 'airDefense': {'quantity': 4}},
     'attackRange': {'surface': 4, 'submarine': 2, 'air': 2, 'land': 3},
     'detectionRange': {'surface': 4, 'submarine': 1, 'air': 4, 'land': 3},
     'fuel': {'current': 10, 'max': 10, 'usesFuel': True}},
]

RED_TEMPLATE = [
    {'id': 'RED-01', 'name': 'Fragata Vermelha 1','team': 'red',  'category': 'surface',
     'col': 13, 'row': 3, 'hp': 8, 'maxHp': 8, 'movement': 3,
     'weapons': {'ascm': {'quantity': 4}, 'navalGun': {'quantity': 10}},
     'attackRange': {'surface': 3, 'submarine': 2, 'air': 1, 'land': 2},
     'detectionRange': {'surface': 3, 'submarine': 1, 'air': 3, 'land': 2},
     'fuel': {'current': 8, 'max': 8, 'usesFuel': True}},
    {'id': 'RED-02', 'name': 'Fragata Vermelha 2','team': 'red',  'category': 'surface',
     'col': 12, 'row': 5, 'hp': 8, 'maxHp': 8, 'movement': 3,
     'weapons': {'ascm': {'quantity': 4}, 'navalGun': {'quantity': 10}},
     'attackRange': {'surface': 3, 'submarine': 2, 'air': 1, 'land': 2},
     'detectionRange': {'surface': 3, 'submarine': 1, 'air': 3, 'land': 2},
     'fuel': {'current': 8, 'max': 8, 'usesFuel': True}},
    {'id': 'RED-03', 'name': 'Submarino Vermelho', 'team': 'red', 'category': 'submarine',
     'col': 10, 'row': 7, 'hp': 6, 'maxHp': 6, 'movement': 3,
     'weapons': {'torpedo': {'quantity': 6}},
     'attackRange': {'surface': 3, 'submarine': 2, 'air': 0, 'land': 0},
     'detectionRange': {'surface': 2, 'submarine': 2, 'air': 0, 'land': 1},
     'fuel': {'current': 8, 'max': 8, 'usesFuel': False}},
    {'id': 'RED-04', 'name': 'Destroier Vermelho', 'team': 'red', 'category': 'surface',
     'col': 14, 'row': 6, 'hp': 10, 'maxHp': 10, 'movement': 4,
     'weapons': {'ascm': {'quantity': 6}, 'navalGun': {'quantity': 12}, 'airDefense': {'quantity': 4}},
     'attackRange': {'surface': 4, 'submarine': 2, 'air': 2, 'land': 3},
     'detectionRange': {'surface': 4, 'submarine': 1, 'air': 4, 'land': 3},
     'fuel': {'current': 10, 'max': 10, 'usesFuel': True}},
]


# ─── Bot strategies ────────────────────────────────────────────────────────────
def get_attack_range(unit, target_cat):
    return unit.get('attackRange', {}).get(target_cat, 0)


def bot_move(unit, enemies, allies, strategy='aggressive'):
    """
    Returns (new_col, new_row).
    Strategies: 'aggressive' (move toward nearest enemy),
                'defensive'  (stay near allies unless enemy is close),
                'flanking'   (approach from a different angle).
    """
    if unit.get('movement', 0) == 0:
        return unit['col'], unit['row']

    live_enemies = [e for e in enemies if e.get('hp', 0) > 0]
    if not live_enemies:
        return unit['col'], unit['row']

    col, row = unit['col'], unit['row']

    if strategy == 'defensive':
        nearest_enemy_dist = min(hex_dist(col, row, e['col'], e['row']) for e in live_enemies)
        atk_ranges = [get_attack_range(unit, e['category']) for e in live_enemies]
        max_range = max(atk_ranges) if atk_ranges else 0
        # Stay unless enemy is within 2× attack range
        if max_range > 0 and nearest_enemy_dist > max_range * 2:
            return col, row

    # Pick target: nearest enemy for aggressive, random for flanking
    if strategy == 'flanking':
        target = random.choice(live_enemies)
    else:
        target = min(live_enemies, key=lambda e: hex_dist(col, row, e['col'], e['row']))

    target_dist = hex_dist(col, row, target['col'], target['row'])
    atk_range = get_attack_range(unit, target['category'])

    # Don't close if already in range (with small buffer)
    if atk_range > 0 and target_dist <= max(1, atk_range - 1):
        return col, row

    # Multi-step BFS: move up to movement allowance
    steps = unit.get('movement', 1)
    cur_col, cur_row = col, row
    for _ in range(steps):
        best_col, best_row = cur_col, cur_row
        best_dist = hex_dist(cur_col, cur_row, target['col'], target['row'])
        for nc, nr in hex_neighbors(cur_col, cur_row):
            if not can_enter(unit['category'], nc, nr):
                continue
            d = hex_dist(nc, nr, target['col'], target['row'])
            if d < best_dist:
                best_dist = d
                best_col, best_row = nc, nr
        if best_col == cur_col and best_row == cur_row:
            break  # no progress
        cur_col, cur_row = best_col, best_row
        # Stop if now in attack range
        if atk_range > 0 and hex_dist(cur_col, cur_row, target['col'], target['row']) <= atk_range:
            break

    return cur_col, cur_row


def bot_declare_attacks(team, all_units):
    my = [u for u in all_units if u['team'] == team and u.get('hp', 0) > 0]
    enemies = [u for u in all_units if u['team'] != team and u['team'] != 'neutral' and u.get('hp', 0) > 0]
    attacks = []
    for unit in my:
        candidates = []
        for enemy in enemies:
            atk_range = get_attack_range(unit, enemy['category'])
            if atk_range == 0:
                continue
            dist = hex_dist(unit['col'], unit['row'], enemy['col'], enemy['row'])
            if dist <= atk_range:
                candidates.append((dist, enemy))
        if candidates:
            # Attack lowest HP enemy in range (or nearest on tie)
            candidates.sort(key=lambda x: (x[1]['hp'], x[0]))
            attacks.append({'attackerId': unit['id'], 'targetId': candidates[0][1]['id']})
    return attacks


def resolve_damage(att, tgt):
    """Simplified d6-based damage (30% miss, 1-3 dmg on hit)."""
    if random.random() < 0.30:
        return 0
    base = random.randint(1, 3)
    # Submarines harder to hit
    if tgt['category'] == 'submarine':
        base = max(0, base - 1)
    return base


def check_winner(units):
    def offensive(u):
        if u.get('hp', 0) <= 0:
            return False
        return any(v > 0 for v in u.get('attackRange', {}).values())
    b = any(offensive(u) for u in units if u['team'] == 'blue')
    r = any(offensive(u) for u in units if u['team'] == 'red')
    if not b:
        return 'red'
    if not r:
        return 'blue'
    return None


# ─── Game simulation ───────────────────────────────────────────────────────────
def simulate_game(game_id, max_turns=30, seed=None):
    if seed is not None:
        random.seed(seed)

    ts = time.strftime('%Y%m%dT%H%M%S')
    log_path = LOG_DIR / f"game_SIM{game_id:04d}_{ts}.jsonl"
    events = []
    now = lambda: time.strftime('%Y-%m-%dT%H:%M:%SZ')

    units = [deepcopy(u) for u in BLUE_TEMPLATE + RED_TEMPLATE]

    # Randomize starting positions slightly for variety
    for u in units:
        jitter_col = random.randint(-1, 1)
        jitter_row = random.randint(-1, 1)
        nc, nr = u['col'] + jitter_col, u['row'] + jitter_row
        if 0 <= nc < GRID_W and 0 <= nr < GRID_H and can_enter(u['category'], nc, nr):
            u['col'], u['row'] = nc, nr

    # Assign random strategy per team
    blue_strategy = random.choice(['aggressive', 'aggressive', 'defensive', 'flanking'])
    red_strategy  = random.choice(['aggressive', 'aggressive', 'defensive', 'flanking'])

    events.append({'event': 'game_start', 'room': f'SIM{game_id:04d}',
                   'turn': 1, 'period': 'day',
                   'units': [dict(u) for u in units], 'ts': now()})

    winner = None
    turn_num = 1
    period = 'day'

    for t in range(max_turns):
        turn_num = t // 2 + 1
        period = 'day' if t % 2 == 0 else 'night'

        # ── Movement ──────────────────────────────────────────────────────────
        for team, strat in (('blue', blue_strategy), ('red', red_strategy)):
            my = [u for u in units if u['team'] == team and u.get('hp', 0) > 0]
            enemies = [u for u in units if u['team'] != team and u.get('hp', 0) > 0]
            moves = []
            for unit in my:
                old_col, old_row = unit['col'], unit['row']
                nc, nr = bot_move(unit, enemies, my, strat)
                moves.append({'unitId': unit['id'],
                              'from': {'col': old_col, 'row': old_row},
                              'to':   {'col': nc, 'row': nr}})
                unit['col'], unit['row'] = nc, nr
                unit['moved'] = (nc != old_col or nr != old_row)

            events.append({'event': 'movement_committed', 'room': f'SIM{game_id:04d}',
                           'team': team, 'turn': turn_num, 'period': period,
                           'moves': moves, 'units': [dict(u) for u in units], 'ts': now()})

        # ── Combat ────────────────────────────────────────────────────────────
        blue_attacks = bot_declare_attacks('blue', units)
        red_attacks  = bot_declare_attacks('red',  units)

        events.append({'event': 'attacks_declared', 'room': f'SIM{game_id:04d}',
                       'turn': turn_num, 'period': period,
                       'blueAttacks': blue_attacks, 'redAttacks': red_attacks,
                       'units': [dict(u) for u in units], 'ts': now()})

        unit_map = {u['id']: u for u in units}
        # Shuffle attack order for variety
        all_attacks = blue_attacks + red_attacks
        random.shuffle(all_attacks)
        for atk in all_attacks:
            att = unit_map.get(atk['attackerId'])
            tgt = unit_map.get(atk['targetId'])
            if not att or not tgt or att.get('hp', 0) <= 0 or tgt.get('hp', 0) <= 0:
                continue
            dmg = resolve_damage(att, tgt)
            tgt['hp'] = max(0, tgt['hp'] - dmg)
            destroyed = tgt['hp'] == 0
            # Spend ammo (pick first available weapon)
            for wpn, wdata in att.get('weapons', {}).items():
                if wdata.get('quantity', 0) > 0:
                    wdata['quantity'] = max(0, wdata['quantity'] - 1)
                    break
            events.append({'event': 'engagement_resolved', 'room': f'SIM{game_id:04d}',
                           'attackerId': att['id'], 'targetId': tgt['id'],
                           'damage': dmg, 'destroyed': destroyed,
                           'targetHpAfter': tgt['hp'], 'ts': now()})

        winner = check_winner(units)
        if winner:
            break

        # Simple next-turn reset
        for u in units:
            u['moved'] = False

    events.append({'event': 'game_over', 'room': f'SIM{game_id:04d}',
                   'winner': winner or 'draw', 'turn': turn_num, 'period': period,
                   'units': [dict(u) for u in units], 'ts': now()})

    with open(log_path, 'w') as f:
        for ev in events:
            f.write(json.dumps(ev) + '\n')

    return winner or 'draw', log_path


def main():
    parser = argparse.ArgumentParser(description='Generate synthetic wargame training data')
    parser.add_argument('--n', type=int, default=100, help='Number of games to simulate (default: 100)')
    args = parser.parse_args()

    print(f"=== Operação Atlântico Sul — Synthetic Data Generator ===")
    print(f"Generating {args.n} games → {LOG_DIR}\n")

    results = {}
    for i in range(args.n):
        winner, _ = simulate_game(i, seed=i)
        results[winner] = results.get(winner, 0) + 1
        if (i + 1) % 20 == 0 or i == args.n - 1:
            b = results.get('blue', 0)
            r = results.get('red', 0)
            d = results.get('draw', 0)
            print(f"  [{i+1:>4}/{args.n}] Blue {b} | Red {r} | Draw {d}")

    b = results.get('blue', 0)
    r = results.get('red', 0)
    d = results.get('draw', 0)
    print(f"\nDone! {args.n} games → Blue {b} ({100*b//args.n}%) | Red {r} ({100*r//args.n}%) | Draw {d}")
    print(f"\nNext: python ml/train_bot.py")


if __name__ == '__main__':
    main()
