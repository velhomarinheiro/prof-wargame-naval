#!/usr/bin/env python3
"""
Generates synthetic game logs using the full Order of Battle from
shared/order_of_battle.js — all units, weapons and capabilities.

Usage:
    python ml/simulate_games.py --n 120
"""

import argparse, json, random, time
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

# ─── Hex helpers ──────────────────────────────────────────────────────────────
def get_terrain(col, row):
    if col < 0 or col >= GRID_W or row < 0 or row >= GRID_H: return T_LAND
    return TERRAIN_MAP[row][col]

def oddq_to_cube(col, row):
    x = col; z = row - (col - (col & 1)) // 2
    return (x, -x-z, z)

def cube_to_oddq(x, z):
    return (x, z + (x-(x&1))//2)

def hex_neighbors(col, row):
    cx,_,cz = oddq_to_cube(col, row)
    return [(nc,nr) for dx,dy,dz in CUBE_DIRS
            for nc,nr in [cube_to_oddq(cx+dx,cz+dz)]
            if 0<=nc<GRID_W and 0<=nr<GRID_H]

def hex_dist(c1,r1,c2,r2):
    a=oddq_to_cube(c1,r1); b=oddq_to_cube(c2,r2)
    return max(abs(a[0]-b[0]),abs(a[1]-b[1]),abs(a[2]-b[2]))

def can_enter(category, col, row):
    t = get_terrain(col, row)
    if category in ('air','neutral_air'): return True
    if category == 'land':       return t in (0,1)
    if category == 'submarine':  return t not in (0,1)
    return t != 0

# ─── Combat model (calibrated d6 / Bacia de Campos) ──────────────────────────
def d6(): return random.randint(1,6)

DAMAGE_TABLES = {
    t: {
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
    }
    for t in ('blue','red')
}

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

WEAPON_PRIORITY = {
    'surface':   ['ascm','asbm','mss','torpedo','airAttack','navalGun'],
    'submarine': ['asw','torpedo'],
    'air':       ['airDefense','airAttack'],
    'land':      ['lacm','airAttack','navalGun'],
}
SALVO_SIZE = {'ascm':2,'mss':2,'torpedo':1,'lacm':1,'asbm':1}


def get_weapon_qty(unit, wpn):
    w = unit.get('weapons',{}).get(wpn)
    if w is not None: return w.get('quantity',0)
    c = unit.get('capabilities',{}).get(wpn)
    if c is not None: return c
    return 0

def get_weapon_range(unit, wpn):
    w = unit.get('weapons',{}).get(wpn)
    if w and 'range' in w: return w['range']
    return WEAPON_PROFILES.get(wpn,{}).get('defaultRange',0)

def is_expendable(wpn):
    return WEAPON_PROFILES.get(wpn,{}).get('expendable',True)

def spend_weapon(unit, wpn, amount):
    if not is_expendable(wpn): return
    if wpn in unit.get('weapons',{}):
        unit['weapons'][wpn]['quantity'] = max(0, unit['weapons'][wpn]['quantity']-amount)

def resolve_damage_roll(team, damage_profile, target_cat, advantage=False):
    table = DAMAGE_TABLES.get(team,{}).get(damage_profile,{}).get(target_cat)
    if not table: return 0, 0
    roll = d6()
    if advantage: roll = max(roll, d6())
    value = table.get(roll, 0)
    if value == '1d6': return roll, d6()
    return roll, int(value)

def resolve_interception(defender, incoming_wpn, launched):
    profile = WEAPON_PROFILES.get(incoming_wpn,{})
    remaining = launched
    for def_wpn in profile.get('interceptableBy',[]):
        def_qty = get_weapon_qty(defender, def_wpn)
        if def_qty <= 0: continue
        shots = min(remaining, def_qty)
        intercepted = 0
        def_prof = WEAPON_PROFILES.get(def_wpn,{})
        for _ in range(shots):
            _, dmg = resolve_damage_roll(defender['team'], def_prof['damageProfile'], 'missile')
            if dmg > 0: intercepted += 1
        remaining = max(0, remaining - intercepted)
        if remaining <= 0: break
    return remaining   # missiles that bypassed interception

def select_weapon(attacker, target, dist):
    for wpn in WEAPON_PRIORITY.get(target['category'],[]):
        profile = WEAPON_PROFILES.get(wpn)
        if not profile: continue
        if target['category'] not in profile['targets']: continue
        if get_weapon_qty(attacker, wpn) <= 0: continue
        if dist > get_weapon_range(attacker, wpn): continue
        return wpn
    return None

def resolve_engagement(attacker, defender, initiative_bonus_team=None):
    dist = hex_dist(attacker['col'],attacker['row'],defender['col'],defender['row'])
    wpn  = select_weapon(attacker, defender, dist)
    if not wpn:
        return {'ok':False,'total_damage':0,'destroyed':False,
                'weapon':None,'launched':0,'intercepted':0}
    profile     = WEAPON_PROFILES[wpn]
    expendable  = profile['expendable']
    qty         = get_weapon_qty(attacker, wpn)
    launched    = min(qty, SALVO_SIZE.get(wpn,1)) if expendable else 1
    if launched <= 0:
        return {'ok':False,'total_damage':0,'destroyed':False,
                'weapon':wpn,'launched':0,'intercepted':0}
    if expendable:
        spend_weapon(attacker, wpn, launched)
    effective   = resolve_interception(defender, wpn, launched)
    intercepted = launched - effective
    advantage   = (initiative_bonus_team is not None and
                   initiative_bonus_team == attacker['team'])
    total_dmg = 0
    for _ in range(effective):
        _, dmg = resolve_damage_roll(attacker['team'], profile['damageProfile'],
                                      defender['category'], advantage)
        total_dmg += dmg
    defender['hp'] = max(0, defender['hp'] - total_dmg)
    destroyed = (defender['hp'] == 0)
    return {'ok':True,'total_damage':total_dmg,'destroyed':destroyed,
            'weapon':wpn,'launched':launched,'intercepted':intercepted}

def has_offense(unit):
    if unit.get('hp',0) <= 0: return False
    for wlist in WEAPON_PRIORITY.values():
        for wpn in wlist:
            if WEAPON_PROFILES.get(wpn,{}).get('targets') and get_weapon_qty(unit,wpn)>0:
                return True
    return False

# ─── Full Order of Battle (mirrors shared/order_of_battle.js) ─────────────────
BLUE_OB = [
  # ── Surface naval ────────────────────────────────────────────────────────────
  {'id':'BLUE-SAG-P','name':'SAG-P','category':'surface',
   'stayingPower':4,'movement':4,
   'detectionRange':{'surface':4,'air':3,'submarine':2,'land':2},
   'attackRange':{'surface':3,'air':1,'submarine':2,'land':2},
   'weapons':{'mss':{'quantity':16,'range':3}},
   'capabilities':{'airDefense':3,'asw':4,'airAttack':6},
   'position':{'col':3,'row':4}},
  {'id':'BLUE-SAG-S1','name':'SAG-1','category':'surface',
   'stayingPower':9,'movement':4,
   'detectionRange':{'surface':2,'air':2,'submarine':1,'land':1},
   'attackRange':{'surface':2,'air':1,'submarine':1,'land':1},
   'weapons':{'mss':{'quantity':18,'range':2}},
   'capabilities':{'navalGun':3,'airDefense':6,'asw':3,'airAttack':3},
   'position':{'col':5,'row':4}},
  {'id':'BLUE-SAG-S2','name':'SAG-2','category':'surface',
   'stayingPower':10,'movement':4,
   'detectionRange':{'surface':3,'air':2,'submarine':1,'land':1},
   'attackRange':{'surface':2,'air':1,'submarine':1,'land':1},
   'weapons':{'mss':{'quantity':24,'range':2}},
   'capabilities':{'navalGun':4,'airDefense':6,'asw':4,'airAttack':2},
   'position':{'col':3,'row':5}},
  {'id':'BLUE-ANFIB','name':'ANFIB','category':'surface',
   'stayingPower':10,'movement':2,
   'detectionRange':{'surface':3,'air':2,'submarine':2,'land':2},
   'attackRange':{'surface':3,'air':1,'submarine':2,'land':2},
   'weapons':{},
   'capabilities':{'navalGun':3,'airDefense':3,'asw':4},
   'position':{'col':2,'row':4}},
  {'id':'BLUE-LOG-A','name':'APLOG','category':'surface',
   'stayingPower':3,'movement':2,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':0},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':3,'row':3}},
  {'id':'BLUE-LOG-T','name':'REAB-A','category':'surface',
   'stayingPower':3,'movement':2,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':0},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':5,'row':1}},
  {'id':'BLUE-PAT-O1','name':'PAOC1','category':'surface',
   'stayingPower':4,'movement':4,
   'detectionRange':{'surface':2,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':2,'air':1,'submarine':0,'land':0},
   'weapons':{'mss':{'quantity':4,'range':2}},
   'capabilities':{'navalGun':2,'airDefense':2,'airAttack':2},
   'position':{'col':7,'row':1}},
  {'id':'BLUE-PAT-O2','name':'PAOC2','category':'surface',
   'stayingPower':4,'movement':4,
   'detectionRange':{'surface':2,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':2,'air':1,'submarine':0,'land':0},
   'weapons':{'mss':{'quantity':4,'range':2}},
   'capabilities':{'navalGun':2,'airDefense':2,'airAttack':2},
   'position':{'col':4,'row':7}},
  {'id':'BLUE-PAT-C1','name':'PATC1','category':'surface',
   'stayingPower':2,'movement':3,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':1},
   'attackRange':{'surface':1,'air':0,'submarine':0,'land':0},
   'weapons':{'mss':{'quantity':2,'range':1}},
   'capabilities':{'navalGun':2},'position':{'col':4,'row':4}},
  {'id':'BLUE-PAT-C2','name':'PATC2','category':'surface',
   'stayingPower':2,'movement':3,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':1},
   'attackRange':{'surface':1,'air':0,'submarine':0,'land':0},
   'weapons':{'mss':{'quantity':2,'range':1}},
   'capabilities':{'navalGun':2},'position':{'col':5,'row':2}},
  # ── Submarines ───────────────────────────────────────────────────────────────
  {'id':'BLUE-SUB-N','name':'SBN','category':'submarine',
   'stayingPower':3,'movement':4,
   'detectionRange':{'surface':3,'air':0,'submarine':2,'land':0},
   'attackRange':{'surface':3,'air':0,'submarine':2,'land':1},
   'weapons':{'ascm':{'quantity':2,'range':6},'mss':{'quantity':4,'range':2},
              'torpedo':{'quantity':12,'range':2}},
   'capabilities':{'asw':1},'position':{'col':7,'row':4}},
  {'id':'BLUE-SUB-1','name':'SB1','category':'submarine',
   'stayingPower':2,'movement':2,
   'detectionRange':{'surface':2,'air':0,'submarine':1,'land':0},
   'attackRange':{'surface':2,'air':0,'submarine':1,'land':0},
   'weapons':{'mss':{'quantity':2,'range':2},'torpedo':{'quantity':6,'range':2}},
   'capabilities':{'asw':1},'position':{'col':6,'row':2}},
  {'id':'BLUE-SUB-2','name':'SB2','category':'submarine',
   'stayingPower':2,'movement':2,
   'detectionRange':{'surface':2,'air':0,'submarine':1,'land':0},
   'attackRange':{'surface':2,'air':0,'submarine':1,'land':0},
   'weapons':{'mss':{'quantity':2,'range':2},'torpedo':{'quantity':6,'range':2}},
   'capabilities':{'asw':1},'position':{'col':3,'row':6}},
  {'id':'BLUE-SUB-3','name':'SB3','category':'submarine',
   'stayingPower':2,'movement':2,
   'detectionRange':{'surface':2,'air':0,'submarine':1,'land':0},
   'attackRange':{'surface':2,'air':0,'submarine':1,'land':0},
   'weapons':{'mss':{'quantity':2,'range':2},'torpedo':{'quantity':6,'range':2}},
   'capabilities':{'asw':1},'position':{'col':4,'row':4}},
  # ── Aviation ─────────────────────────────────────────────────────────────────
  {'id':'BLUE-MPRA-1','name':'PATMAR1','category':'air',
   'stayingPower':2,'movement':16,
   'detectionRange':{'surface':4,'air':1,'submarine':1,'land':2},
   'attackRange':{'surface':3,'air':0,'submarine':1,'land':0},
   'weapons':{'mss':{'quantity':4,'range':2},'torpedo':{'quantity':2,'range':2}},
   'capabilities':{'asw':2,'airAttack':2},'position':{'col':1,'row':3}},
  {'id':'BLUE-MPRA-2','name':'PATMAR2','category':'air',
   'stayingPower':2,'movement':16,
   'detectionRange':{'surface':4,'air':1,'submarine':1,'land':2},
   'attackRange':{'surface':3,'air':0,'submarine':1,'land':0},
   'weapons':{'mss':{'quantity':4,'range':2},'torpedo':{'quantity':2,'range':2}},
   'capabilities':{'asw':2,'airAttack':2},'position':{'col':1,'row':3}},
  {'id':'BLUE-CACA-1','name':'PAC1','category':'air',
   'stayingPower':6,'movement':8,
   'detectionRange':{'surface':2,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':2,'submarine':0,'land':0},
   'weapons':{},'capabilities':{'airDefense':6,'airAttack':6},
   'position':{'col':0,'row':3}},
  {'id':'BLUE-CACA-2','name':'PAC2','category':'air',
   'stayingPower':6,'movement':8,
   'detectionRange':{'surface':2,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':2,'submarine':0,'land':0},
   'weapons':{},'capabilities':{'airDefense':6,'airAttack':6},
   'position':{'col':0,'row':3}},
  {'id':'BLUE-CJAT-1','name':'APAER1','category':'air',
   'stayingPower':2,'movement':6,
   'detectionRange':{'surface':2,'air':1,'submarine':0,'land':1},
   'attackRange':{'surface':1,'air':1,'submarine':0,'land':1},
   'weapons':{'ascm':{'quantity':4,'range':6},'mss':{'quantity':2,'range':2},
              'lacm':{'quantity':2,'range':10}},
   'capabilities':{'airAttack':2},'position':{'col':3,'row':3}},
  {'id':'BLUE-CJAT-2','name':'APAER2','category':'air',
   'stayingPower':2,'movement':6,
   'detectionRange':{'surface':2,'air':1,'submarine':0,'land':1},
   'attackRange':{'surface':1,'air':1,'submarine':0,'land':1},
   'weapons':{'ascm':{'quantity':4,'range':6},'mss':{'quantity':2,'range':2},
              'lacm':{'quantity':2,'range':10}},
   'capabilities':{'airAttack':2},'position':{'col':3,'row':3}},
  # ── Land combat ──────────────────────────────────────────────────────────────
  {'id':'BLUE-DCOST1','name':'DEFCOST1','category':'land',
   'stayingPower':2,'movement':1,
   'detectionRange':{'surface':2,'air':0,'submarine':0,'land':1},
   'attackRange':{'surface':3,'air':0,'submarine':0,'land':0},
   'weapons':{'mss':{'quantity':10,'range':3}},
   'capabilities':{'airDefense':2},'position':{'col':4,'row':2}},
  {'id':'BLUE-DCOST2','name':'DEFCOST2','category':'land',
   'stayingPower':2,'movement':1,
   'detectionRange':{'surface':2,'air':0,'submarine':0,'land':1},
   'attackRange':{'surface':3,'air':0,'submarine':0,'land':0},
   'weapons':{'mss':{'quantity':10,'range':3}},
   'capabilities':{'airDefense':2},'position':{'col':1,'row':4}},
  {'id':'BLUE-ADA-1','name':'BDA1','category':'land',
   'stayingPower':2,'movement':1,
   'detectionRange':{'surface':1,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':2,'submarine':0,'land':0},
   'weapons':{},'capabilities':{'airDefense':6,'bmd':2},
   'position':{'col':3,'row':1}},
  {'id':'BLUE-ADA-2','name':'BDA2','category':'land',
   'stayingPower':2,'movement':1,
   'detectionRange':{'surface':1,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':2,'submarine':0,'land':0},
   'weapons':{},'capabilities':{'airDefense':6,'bmd':2},
   'position':{'col':0,'row':5}},
  # ── Infrastructure (valid targets) ───────────────────────────────────────────
  {'id':'BLUE-FPSO1','name':'FPSO1','category':'surface','stayingPower':6,'movement':0,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':0},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':6,'row':3}},
  {'id':'BLUE-FPSO2','name':'FPSO2','category':'surface','stayingPower':6,'movement':0,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':0},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':5,'row':3}},
  {'id':'BLUE-FPSO3','name':'FPSO3','category':'surface','stayingPower':6,'movement':0,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':0},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':4,'row':5}},
  {'id':'BLUE-FPSO4','name':'FPSO4','category':'surface','stayingPower':6,'movement':0,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':0},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':2,'row':6}},
  {'id':'BLUE-PORTO-S','name':'Porto Santos','category':'land','stayingPower':20,'movement':0,
   'detectionRange':{'surface':1,'air':0,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':0,'row':5}},
  {'id':'BLUE-PORTO-RJ','name':'Porto Rio','category':'land','stayingPower':20,'movement':0,
   'detectionRange':{'surface':1,'air':0,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':2,'row':4}},
  {'id':'BLUE-PORTO-V','name':'Porto Vitória','category':'land','stayingPower':16,'movement':0,
   'detectionRange':{'surface':1,'air':0,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':5,'row':1}},
  {'id':'BLUE-PORTO-ACU','name':'Porto Açu','category':'land','stayingPower':12,'movement':0,
   'detectionRange':{'surface':1,'air':0,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':4,'row':3}},
  {'id':'BLUE-AERO-RJ','name':'BA Santa Cruz','category':'land','stayingPower':10,'movement':0,
   'detectionRange':{'surface':1,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':0,'row':3}},
  {'id':'BLUE-AERO-SP','name':'BA Santos','category':'land','stayingPower':10,'movement':0,
   'detectionRange':{'surface':1,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':1,'row':3}},
  {'id':'BLUE-AERO-CF','name':'AeroCF/BANS','category':'land','stayingPower':10,'movement':0,
   'detectionRange':{'surface':1,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':2,'row':3}},
]

RED_OB = [
  # ── Surface naval ────────────────────────────────────────────────────────────
  {'id':'RED-GBPA','name':'CSG','category':'surface',
   'stayingPower':6,'movement':4,
   'detectionRange':{'surface':5,'air':4,'submarine':2,'land':2},
   'attackRange':{'surface':4,'air':1,'submarine':2,'land':2},
   'weapons':{'mss':{'quantity':10,'range':3}},
   'capabilities':{'airDefense':3,'asw':6,'airAttack':8},
   'position':{'col':15,'row':1}},
  {'id':'RED-GE-1','name':'ESCCSG','category':'surface',
   'stayingPower':12,'movement':4,
   'detectionRange':{'surface':3,'air':2,'submarine':2,'land':1},
   'attackRange':{'surface':6,'air':1,'submarine':2,'land':8},
   'weapons':{'ascm':{'quantity':14,'range':6},'mss':{'quantity':18,'range':3},
              'lacm':{'quantity':8,'range':10}},
   'capabilities':{'navalGun':6,'airDefense':13,'bmd':4,'asw':11},
   'position':{'col':14,'row':1}},
  {'id':'RED-GE-2','name':'SAG1','category':'surface',
   'stayingPower':10,'movement':4,
   'detectionRange':{'surface':3,'air':2,'submarine':2,'land':1},
   'attackRange':{'surface':6,'air':1,'submarine':2,'land':8},
   'weapons':{'ascm':{'quantity':8,'range':6},'mss':{'quantity':12,'range':3},
              'lacm':{'quantity':2,'range':10}},
   'capabilities':{'navalGun':4,'airDefense':8,'bmd':1,'asw':8},
   'position':{'col':14,'row':2}},
  {'id':'RED-GE-3','name':'SAG2','category':'surface',
   'stayingPower':9,'movement':4,
   'detectionRange':{'surface':2,'air':2,'submarine':1,'land':1},
   'attackRange':{'surface':2,'air':1,'submarine':1,'land':1},
   'weapons':{'mss':{'quantity':12,'range':3}},
   'capabilities':{'navalGun':3,'airDefense':6,'asw':3},
   'position':{'col':14,'row':0}},
  {'id':'RED-AOR-G','name':'REAB-V','category':'surface',
   'stayingPower':3,'movement':2,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':0},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':15,'row':0}},
  {'id':'RED-GANF','name':'ANFIB-E','category':'surface',
   'stayingPower':14,'movement':3,
   'detectionRange':{'surface':2,'air':1,'submarine':0,'land':2},
   'attackRange':{'surface':2,'air':1,'submarine':0,'land':2},
   'weapons':{},'capabilities':{'navalGun':4,'airDefense':4},
   'position':{'col':15,'row':2}},
  {'id':'RED-GLOG','name':'LOG1','category':'surface',
   'stayingPower':6,'movement':2,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':0},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':15,'row':3}},
  {'id':'RED-AKE','name':'LOG2','category':'surface',
   'stayingPower':6,'movement':2,
   'detectionRange':{'surface':1,'air':1,'submarine':0,'land':0},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':15,'row':4}},
  # ── Submarines ───────────────────────────────────────────────────────────────
  {'id':'RED-KSN','name':'SBN','category':'submarine',
   'stayingPower':3,'movement':4,
   'detectionRange':{'surface':3,'air':0,'submarine':2,'land':0},
   'attackRange':{'surface':3,'air':0,'submarine':2,'land':8},
   'weapons':{'ascm':{'quantity':8,'range':6},'torpedo':{'quantity':12,'range':2},
              'lacm':{'quantity':4,'range':10}},
   'capabilities':{'asw':1},'position':{'col':13,'row':2}},
  {'id':'RED-KS-1','name':'SB','category':'submarine',
   'stayingPower':2,'movement':2,
   'detectionRange':{'surface':2,'air':0,'submarine':1,'land':0},
   'attackRange':{'surface':2,'air':0,'submarine':1,'land':0},
   'weapons':{'ascm':{'quantity':4,'range':6},'torpedo':{'quantity':6,'range':2}},
   'capabilities':{'asw':1},'position':{'col':1,'row':8}},
  # ── Aviation ─────────────────────────────────────────────────────────────────
  {'id':'RED-KMF-1','name':'PAC1','category':'air',
   'stayingPower':8,'movement':10,
   'detectionRange':{'surface':2,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':2,'air':2,'submarine':0,'land':1},
   'weapons':{},'capabilities':{'airDefense':8,'airAttack':8},
   'position':{'col':15,'row':1}},
  {'id':'RED-KMF-2','name':'PAC2','category':'air',
   'stayingPower':8,'movement':10,
   'detectionRange':{'surface':2,'air':2,'submarine':0,'land':1},
   'attackRange':{'surface':2,'air':2,'submarine':0,'land':1},
   'weapons':{},'capabilities':{'airDefense':8,'airAttack':8},
   'position':{'col':15,'row':1}},
  {'id':'RED-MPRA-K1','name':'PATMAR1','category':'air',
   'stayingPower':2,'movement':12,
   'detectionRange':{'surface':3,'air':1,'submarine':2,'land':1},
   'attackRange':{'surface':2,'air':0,'submarine':1,'land':0},
   'weapons':{'ascm':{'quantity':2,'range':6},'mss':{'quantity':2,'range':2},
              'torpedo':{'quantity':2,'range':2}},
   'capabilities':{'asw':2,'airAttack':2},'position':{'col':15,'row':1}},
  {'id':'RED-MPRA-K2','name':'PATMAR2','category':'air',
   'stayingPower':2,'movement':12,
   'detectionRange':{'surface':3,'air':1,'submarine':2,'land':1},
   'attackRange':{'surface':2,'air':0,'submarine':1,'land':0},
   'weapons':{'ascm':{'quantity':2,'range':6},'mss':{'quantity':2,'range':2},
              'torpedo':{'quantity':2,'range':2}},
   'capabilities':{'asw':2,'airAttack':2},'position':{'col':15,'row':1}},
  {'id':'RED-AWACS-K','name':'AWACS','category':'air',
   'stayingPower':2,'movement':10,
   'detectionRange':{'surface':3,'air':4,'submarine':0,'land':1},
   'attackRange':{'surface':0,'air':0,'submarine':0,'land':0},
   'weapons':{},'capabilities':{},'position':{'col':15,'row':1}},
]

def make_unit(spec, team):
    pos = spec.get('position', {'col':0,'row':0})
    return {
        'id': spec['id'], 'name': spec['name'], 'team': team,
        'category': spec['category'],
        'col': pos['col'], 'row': pos['row'],
        'hp': spec['stayingPower'], 'maxHp': spec['stayingPower'],
        'movement': spec.get('movement', 0),
        'weapons':      {k: dict(v) for k,v in spec.get('weapons',{}).items()},
        'capabilities': dict(spec.get('capabilities',{})),
        'attackRange':  dict(spec.get('attackRange',{})),
        'detectionRange': dict(spec.get('detectionRange',{})),
    }

# ─── Bot strategies ────────────────────────────────────────────────────────────
def bot_move(unit, enemies, allies, strategy='aggressive'):
    if unit.get('movement',0) == 0: return unit['col'], unit['row']
    live_en = [e for e in enemies if e.get('hp',0)>0 and has_offense(e)]
    # non-offensive support: also consider unarmed targets (FPSOs etc.) for red
    if not live_en:
        live_en = [e for e in enemies if e.get('hp',0)>0]
    if not live_en: return unit['col'], unit['row']
    col, row = unit['col'], unit['row']

    if strategy == 'flanking':
        target = random.choice(live_en)
    else:
        target = min(live_en, key=lambda e: hex_dist(col,row,e['col'],e['row']))

    td   = hex_dist(col, row, target['col'], target['row'])
    wpn  = select_weapon(unit, target, td)
    best_range = get_weapon_range(unit, wpn) if wpn else 0

    if strategy == 'defensive' and best_range > 0 and td > best_range*2:
        return col, row
    if best_range > 0 and td <= max(1, best_range-1):
        return col, row

    # Multi-step BFS toward target
    cur_col, cur_row = col, row
    for _ in range(unit.get('movement',1)):
        bc, br = cur_col, cur_row
        bd = hex_dist(cur_col, cur_row, target['col'], target['row'])
        for nc, nr in hex_neighbors(cur_col, cur_row):
            if not can_enter(unit['category'], nc, nr): continue
            d = hex_dist(nc, nr, target['col'], target['row'])
            if d < bd: bd = d; bc, br = nc, nr
        if bc == cur_col and br == cur_row: break
        cur_col, cur_row = bc, br
        if best_range > 0 and hex_dist(cur_col,cur_row,target['col'],target['row'])<=best_range:
            break
    return cur_col, cur_row

def bot_declare_attacks(team, all_units):
    my = [u for u in all_units if u['team']==team and u.get('hp',0)>0 and has_offense(u)]
    en = [u for u in all_units if u['team']!=team and u['team']!='neutral' and u.get('hp',0)>0]
    attacks = []
    for unit in my:
        candidates = []
        for enemy in en:
            dist = hex_dist(unit['col'],unit['row'],enemy['col'],enemy['row'])
            wpn  = select_weapon(unit, enemy, dist)
            if wpn: candidates.append((enemy['hp'], dist, enemy))
        if candidates:
            candidates.sort(key=lambda x: (x[0], x[1]))
            attacks.append({'attackerId':unit['id'], 'targetId':candidates[0][2]['id']})
    return attacks

def check_winner(units):
    b = any(has_offense(u) for u in units if u['team']=='blue')
    r = any(has_offense(u) for u in units if u['team']=='red')
    if not b: return 'red'
    if not r: return 'blue'
    return None

# ─── Game simulation ──────────────────────────────────────────────────────────
def simulate_game(game_id, max_turns=30, seed=None):
    if seed is not None: random.seed(seed)
    ts       = time.strftime('%Y%m%dT%H%M%S')
    log_path = LOG_DIR / f"game_SIM{game_id:04d}_{ts}.jsonl"
    events   = []
    now      = lambda: time.strftime('%Y-%m-%dT%H:%M:%SZ')

    units = ([make_unit(s,'blue') for s in BLUE_OB] +
             [make_unit(s,'red')  for s in RED_OB])

    # Slight starting position jitter for variety
    for u in units:
        if u['movement'] == 0: continue
        for _ in range(3):
            nc = u['col'] + random.randint(-1,1)
            nr = u['row'] + random.randint(-1,1)
            if 0<=nc<GRID_W and 0<=nr<GRID_H and can_enter(u['category'],nc,nr):
                u['col'], u['row'] = nc, nr; break

    blue_strat = random.choice(['aggressive','aggressive','defensive','flanking'])
    red_strat  = random.choice(['aggressive','aggressive','defensive','flanking'])

    events.append({'event':'game_start','room':f'SIM{game_id:04d}',
                   'turn':1,'period':'day',
                   'units':[dict(u) for u in units],'ts':now()})

    winner = None
    turn_num, period = 1, 'day'

    for t in range(max_turns):
        turn_num = t//2+1
        period   = 'day' if t%2==0 else 'night'

        # ── Movement ──────────────────────────────────────────────────────────
        for team, strat in (('blue',blue_strat),('red',red_strat)):
            my = [u for u in units if u['team']==team  and u.get('hp',0)>0]
            en = [u for u in units if u['team']!=team  and u.get('hp',0)>0]
            moves = []
            for unit in my:
                oc,or_ = unit['col'],unit['row']
                nc,nr  = bot_move(unit, en, my, strat)
                moves.append({'unitId':unit['id'],
                              'from':{'col':oc,'row':or_},
                              'to':  {'col':nc,'row':nr}})
                unit['col'],unit['row'] = nc,nr
                unit['moved'] = (nc!=oc or nr!=or_)
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

        unit_map = {u['id']:u for u in units}
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
        if winner: break
        for u in units: u['moved'] = False

    events.append({'event':'game_over','room':f'SIM{game_id:04d}',
                   'winner':winner or 'draw','turn':turn_num,'period':period,
                   'units':[dict(u) for u in units],'ts':now()})

    with open(log_path,'w') as f:
        for ev in events: f.write(json.dumps(ev)+'\n')

    return winner or 'draw', log_path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--n', type=int, default=120)
    args = parser.parse_args()
    print(f"=== Operação Atlântico Sul — OB Completo ({args.n} partidas) ===")
    print(f"Azul: {len(BLUE_OB)} unidades  |  Vermelho: {len(RED_OB)} unidades\n")
    results = {}
    for i in range(args.n):
        winner, _ = simulate_game(i, seed=i)
        results[winner] = results.get(winner,0)+1
        if (i+1)%20==0 or i==args.n-1:
            b=results.get('blue',0); r=results.get('red',0); d=results.get('draw',0)
            print(f"  [{i+1:>4}/{args.n}] Blue {b} | Red {r} | Draw {d}")
    b=results.get('blue',0); r=results.get('red',0); d=results.get('draw',0)
    print(f"\nFim: Blue {b} ({100*b//args.n}%) | Red {r} ({100*r//args.n}%) | Draw {d}")

if __name__ == '__main__':
    main()
