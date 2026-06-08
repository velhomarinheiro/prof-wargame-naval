'use strict';

// Damage tables calibrated against Bacia de Campos scenario parameters
// (naval_salvo project, SIGE 2026).
//
// Calibration basis (η → d6 faces):
//   η = 0.90 (submarine)  → 5 faces  P ≈ 0.833
//   η = 0.85 (frigate MB) → 5 faces  P ≈ 0.833
//   η = 0.80 (destroyer)  → 5 faces  P ≈ 0.833  (same at d6 granularity)
//   η = 0.75 (strike air) → 4 faces  P ≈ 0.667
//   η = 0.70 (MPA/ASW)    → 4 faces  P ≈ 0.667
//   BMD effectiveness     → 3 faces  P ≈ 0.500  (literature: 0.40–0.60)
//   ASBM hit probability  → 4 faces  P ≈ 0.667  (targeting-chain penalty)
//
// Damage-per-hit basis: HP_per_unit / staying_power_Bacia
//   surface (frigate-class, 3 HP / s=2)   → 2 SP per hit
//   surface (destroyer/carrier, ~4 HP / s=3) → 2 SP per hit
//   submarine (2 HP / s=2)                → 1 SP per hit
//   air / land                             → 1 SP per hit
//
// Roll=6 preserves the "critical hit" 1d6 mechanic for tactical tension.
// navalGun unchanged: η ≈ 0.60 → 4 faces already correct; 1 SP fixed.

const COMBAT_CONFIG = {

  weaponProfiles: {
    ascm: {
      expendable: true,
      defaultRange: 6,
      targets: ['surface'],
      interceptableBy: ['airDefense'],
      damageProfile: 'ascmSurface',
      label: 'ASCM',
    },
    mss: {
      expendable: true,
      defaultRange: 3,
      targets: ['surface'],
      interceptableBy: ['airDefense'],
      damageProfile: 'mssSurface',
      label: 'MSS',
    },
    torpedo: {
      expendable: true,
      defaultRange: 2,
      targets: ['surface', 'submarine'],
      interceptableBy: [],
      damageProfile: 'torpedo',
      label: 'TORPEDO',
    },
    lacm: {
      expendable: true,
      defaultRange: 10,
      targets: ['land'],
      interceptableBy: ['airDefense', 'bmd'],
      damageProfile: 'lacm',
      label: 'LACM',
    },
    asbm: {
      expendable: true,
      defaultRange: 10,
      targets: ['surface'],
      interceptableBy: ['bmd'],
      damageProfile: 'asbmSurface',
      label: 'ASBM',
    },
    navalGun: {
      expendable: false,
      defaultRange: 1,
      targets: ['surface', 'land'],
      interceptableBy: [],
      damageProfile: 'navalGun',
      label: 'CANHÃO',
    },
    airDefense: {
      expendable: false,
      defaultRange: 1,
      targets: ['air'],
      interceptableBy: [],
      damageProfile: 'airDefense',
      label: 'DEFA',
    },
    bmd: {
      expendable: false,
      defaultRange: 1,
      targets: ['air'],
      interceptableBy: [],
      damageProfile: 'bmd',
      label: 'BMD',
    },
    asw: {
      expendable: false,
      defaultRange: 2,
      targets: ['submarine'],
      interceptableBy: [],
      damageProfile: 'asw',
      label: 'ASW',
    },
    airAttack: {
      expendable: false,
      defaultRange: 4,
      targets: ['surface', 'air', 'land'],
      interceptableBy: ['airDefense'],
      damageProfile: 'airAttack',
      label: 'AT.AÉR',
    },
  },

  // d6 damage tables  ─  "1d6" means roll a second d6 for damage
  damageTables: {
    blue: {
      // η=0.85 → 5 faces; 2 SP/hit; roll=6 → critical (1d6)  E≈1.92 SP/míssil
      ascmSurface: {
        surface:    { '1':0, '2':2, '3':2, '4':2, '5':2, '6':'1d6' },
      },
      // η=0.85 → 5 faces; 1 SP/hit; roll=6 → critical (1d6)  E≈1.25 SP/míssil
      mssSurface: {
        surface:    { '1':0, '2':1, '3':1, '4':1, '5':1, '6':'1d6' },
      },
      // η=0.90 → 5 faces; 2 SP vs surface, 1 SP vs submarine  E≈1.92 / 1.25
      torpedo: {
        surface:    { '1':0, '2':2, '3':2, '4':2, '5':2, '6':'1d6' },
        submarine:  { '1':0, '2':1, '3':1, '4':1, '5':1, '6':'1d6' },
      },
      // η≈0.85 → 5 faces; 2 SP/hit; fixed land target  E≈1.92 SP/míssil
      lacm: {
        land:       { '1':0, '2':2, '3':2, '4':2, '5':2, '6':'1d6' },
      },
      // η≈0.70 → 4 faces (targeting-chain penalty); 2 SP/hit  E≈1.58 SP/míssil
      asbmSurface: {
        surface:    { '1':0, '2':0, '3':2, '4':2, '5':2, '6':'1d6' },
      },
      // unchanged: η≈0.60 → 4 faces vs surface, 3 vs land; 1 SP fixed
      navalGun: {
        surface:    { '1':0, '2':0, '3':1, '4':1, '5':1, '6':1 },
        land:       { '1':0, '2':0, '3':0, '4':1, '5':1, '6':1 },
      },
      // η=0.85 → 5 faces; P(intercept)≈0.833 per slot
      airDefense: {
        air:        { '1':0, '2':1, '3':1, '4':1, '5':1, '6':1 },
        missile:    { '1':0, '2':1, '3':1, '4':1, '5':1, '6':1 },
      },
      // literature η≈0.50 → 3 faces; P(intercept)≈0.500 per slot
      bmd: {
        air:        { '1':0, '2':0, '3':0, '4':1, '5':1, '6':1 },
        missile:    { '1':0, '2':0, '3':0, '4':1, '5':1, '6':1 },
      },
      // η=0.70 (MPA) → 4 faces; 1 SP/hit; roll=6 → critical  E≈1.08 SP/arma
      asw: {
        submarine:  { '1':0, '2':0, '3':1, '4':1, '5':1, '6':'1d6' },
      },
      // η=0.75 (StrikeAir) → 4 faces; 2 SP vs surface, 1 SP vs air/land
      airAttack: {
        surface:    { '1':0, '2':0, '3':2, '4':2, '5':2, '6':'1d6' },
        air:        { '1':0, '2':0, '3':1, '4':1, '5':1, '6':'1d6' },
        land:       { '1':0, '2':0, '3':1, '4':1, '5':1, '6':'1d6' },
      },
    },

    red: {
      // η=0.80 → 5 faces at d6 granularity (same as blue)
      ascmSurface: {
        surface:    { '1':0, '2':2, '3':2, '4':2, '5':2, '6':'1d6' },
      },
      mssSurface: {
        surface:    { '1':0, '2':1, '3':1, '4':1, '5':1, '6':'1d6' },
      },
      torpedo: {
        surface:    { '1':0, '2':2, '3':2, '4':2, '5':2, '6':'1d6' },
        submarine:  { '1':0, '2':1, '3':1, '4':1, '5':1, '6':'1d6' },
      },
      lacm: {
        land:       { '1':0, '2':2, '3':2, '4':2, '5':2, '6':'1d6' },
      },
      asbmSurface: {
        surface:    { '1':0, '2':0, '3':2, '4':2, '5':2, '6':'1d6' },
      },
      navalGun: {
        surface:    { '1':0, '2':0, '3':1, '4':1, '5':1, '6':1 },
        land:       { '1':0, '2':0, '3':0, '4':1, '5':1, '6':1 },
      },
      // η=0.80 → 5 faces; same at d6 granularity
      airDefense: {
        air:        { '1':0, '2':1, '3':1, '4':1, '5':1, '6':1 },
        missile:    { '1':0, '2':1, '3':1, '4':1, '5':1, '6':1 },
      },
      bmd: {
        air:        { '1':0, '2':0, '3':0, '4':1, '5':1, '6':1 },
        missile:    { '1':0, '2':0, '3':0, '4':1, '5':1, '6':1 },
      },
      asw: {
        submarine:  { '1':0, '2':0, '3':1, '4':1, '5':1, '6':'1d6' },
      },
      airAttack: {
        surface:    { '1':0, '2':0, '3':2, '4':2, '5':2, '6':'1d6' },
        air:        { '1':0, '2':0, '3':1, '4':1, '5':1, '6':'1d6' },
        land:       { '1':0, '2':0, '3':1, '4':1, '5':1, '6':'1d6' },
      },
    },
  },
};

if (typeof module !== 'undefined') module.exports = { COMBAT_CONFIG };
