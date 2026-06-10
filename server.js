'use strict';
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const { ORDER_OF_BATTLE }  = require('./shared/order_of_battle');
const { COMBAT_CONFIG }    = require('./shared/combat_config');
const { resolveEngagement, getWeaponQuantity, getWeaponRange } = require('./shared/combat_engine');
const {
  CYBER_EFFECTS, CYBER_DEFENSE_EFFECTS, RESULT_LABELS,
  buildStartingHand, scaleCyberEffect, computeCyberSuggestion,
} = require('./shared/cyber_config');
const {
  initializeFuel, isFuelDisabled,
  navalMoveCost, spendNavalFuel, spendAirFuel,
  spendEngagementFuel, spendDamageFuel,
  markRefuelEligibility, recoverNavalFuel,
  checkNavalFuelZero, checkAirFuelLosses,
  recoverAircraft, resetFuelTurnCounters,
} = require('./fuel_model');

const PORT   = process.env.PORT || 3000;
const GRID_W = 16;
const GRID_H = 10;

// ─── Terrain ─────────────────────────────────────────────────────────────────
const T_LAND=0,T_SHALLOW=1,T_SHELF=2,T_DEEP=3,T_OIL=4;
const TERRAIN_MAP=[
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
function getTerrain(col,row){if(row<0||row>=GRID_H||col<0||col>=GRID_W)return T_LAND;return TERRAIN_MAP[row][col];}
function canEnterTerrain(category,terrain){
  if(category==='air'||category==='neutral_air') return true;
  if(category==='land')      return terrain===T_LAND||terrain===T_SHALLOW;
  if(category==='submarine') return terrain!==T_LAND&&terrain!==T_SHALLOW;
  return terrain!==T_LAND;
}

// ─── Display type mapping ─────────────────────────────────────────────────────
const COMP_DISPLAY_TYPE={
  'navio_aeródromo':'carrier','navio_doca':'amphib','navio_desembarque':'amphib',
  'fragata':'fragata','corveta':'corveta','destroier':'destroier','destroyer':'destroier',
  'cruzador':'cruzador','navio_patoc':'patrulha_oc','navio_patrulha':'patrulha_c',
  'navio_logistico':'logistico','navio_tanque':'tanque','submarino_nuclear':'sub_nuclear',
  'submarino_convencional':'submarino','patrulha_maritima':'patrulha','caca':'caca',
  'ataque':'ataque','aew':'aew','helicoptero_ASW':'helicoptero','helicoptero_ASup':'helicoptero',
  'bateria_costeira':'bateria_costeira','bateria_ada':'bateria_ada','base_naval':'bateria_ada',
  'plataforma':'fpso','porto':'porto','aeroporto':'aeroporto',
  'navio_mercante':'logistico','apoio_offshore':'logistico','barco_pesqueiro':'patrulha_c',
  'veleiro':'patrulha_c','helicoptero_transporte':'helicoptero','aviacao_civil':'patrulha',
  'op_esp':'op_esp',
};
const DISPLAY_TYPE_FALLBACK={surface:'fragata',submarine:'submarino',air:'patrulha',land:'corveta',neutral:'logistico'};

function rangeAgainst(t,cat){if(!t)return 0;return Number(t[cat]||0);}

// ─── Hex math ─────────────────────────────────────────────────────────────────
function oddqToCube(col,row){const x=col;const z=row-(col-(col&1))/2;return{x,y:-x-z,z};}
function cubeToOddq(x,z){return{col:x,row:z+(x-(x&1))/2};}
const CUBE_DIRS=[{dx:+1,dy:-1,dz:0},{dx:+1,dy:0,dz:-1},{dx:0,dy:+1,dz:-1},{dx:-1,dy:+1,dz:0},{dx:-1,dy:0,dz:+1},{dx:0,dy:-1,dz:+1}];
function hexNeighbors(col,row){const c=oddqToCube(col,row);return CUBE_DIRS.map(d=>cubeToOddq(c.x+d.dx,c.z+d.dz)).filter(({col:nc,row:nr})=>nc>=0&&nc<GRID_W&&nr>=0&&nr<GRID_H);}
function hexDist(c1,r1,c2,r2){const a=oddqToCube(c1,r1),b=oddqToCube(c2,r2);return Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y),Math.abs(a.z-b.z));}

// ─── Air refuel ───────────────────────────────────────────────────────────────
function isAirRefuelLocation(unit,state){
  return state.units.some(o=>o.id!==unit.id&&o.team===unit.team&&(o.hp??0)>0&&(o.type==='aeroporto'||o.type==='carrier')&&o.col===unit.col&&o.row===unit.row);
}

// ─── Fog of war ───────────────────────────────────────────────────────────────
function saveMovementSnapshot(state){
  state.movementSnapshot={};
  for(const u of state.units) state.movementSnapshot[u.id]={col:u.col,row:u.row};
}

function filterLogForPlayer(log,team){
  const opp=team==='blue'?'red':'blue';
  const movePat=new RegExp(`\\(${opp}\\)\\s+→`);
  const fuelPat=new RegExp(`^[⛽✈].*\\(${opp}\\)`);
  const hiddenPat=/^\[OCULTO:(blue|red)\]/;
  return (log||[]).filter(line=>{
    const hm=hiddenPat.exec(line);
    if(hm) return hm[1]===team;
    return !movePat.test(line)&&!fuelPat.test(line);
  });
}

function stateFor(state,role){
  if(role==='facilitator'){
    const{combatQueue:_cq,battleRoundDecisions:_brd,pendingBrPayload:_pbp,...rest}=state;
    return{...rest,isFacilitator:true};
  }
  const team=role;
  const night=state.period==='night';
  const{combatQueue:_cq,battleRoundDecisions:_brd,pendingPaths:_pp,pendingBrPayload:_pbp,...stateRest}=state;

  const enemyActual=state.units.filter(u=>u.team!==team&&u.team!=='neutral'&&u.hp>0);
  const useSnapshot=(state.phase==='movement'||state.phase==='movement_approval')&&state.movementSnapshot;
  const enemies=useSnapshot
    ?enemyActual.map(u=>{const snap=state.movementSnapshot[u.id];return snap?{...u,col:snap.col,row:snap.row}:u;})
    :enemyActual;
  const mine=state.units.filter(u=>u.team===team&&u.hp>0);
  const mineForDetection=useSnapshot
    ?mine.map(u=>{const snap=state.movementSnapshot[u.id];return snap?{...u,col:snap.col,row:snap.row}:u;})
    :mine;

  const detected=enemies.filter(enemy=>{
    const stealthy=!!enemy.stealthy;
    const deepBonus=getTerrain(enemy.col,enemy.row)===T_DEEP?1:0;
    const stealthBonus=activeCyberModifier(state,enemy.team,enemy.id,'stealthBonus');
    return mineForDetection.some(f=>{
      let range=stealthy?rangeAgainst(f.detectionRange,'submarine')-deepBonus:rangeAgainst(f.detectionRange,enemy.category);
      range+=activeCyberModifier(state,f.team,f.id,'detectionRange');
      range-=stealthBonus;
      if(night&&f.category!=='submarine') range-=stealthy?1:2;
      return range>=1&&hexDist(f.col,f.row,enemy.col,enemy.row)<=range;
    });
  }).map(e=>({...e,detected:true}));

  // Neutral units also subject to fog-of-war
  const detectedNeutrals=state.units.filter(u=>u.team==='neutral'&&u.hp>0).filter(neutral=>{
    return mineForDetection.some(f=>{
      let range=rangeAgainst(f.detectionRange,neutral.category);
      range+=activeCyberModifier(state,f.team,f.id,'detectionRange');
      if(night&&f.category!=='submarine') range-=2;
      return range>=1&&hexDist(f.col,f.row,neutral.col,neutral.row)<=range;
    });
  }).map(n=>{
    if(n.sofBoarding&&n.sofBoarding.controlledBy!==team){
      const{sofBoarding:_,...rest}=n;
      return{...rest,detected:true};
    }
    return{...n,detected:true};
  });

  const fakeUnits=(state.cyber?.fakeContacts||[]).filter(fc=>fc.visibleToTeam===team).map(fc=>({
    id:fc.id,team:fc.fakeTeam,name:'Contato Não Identificado',category:'surface',type:'fragata',
    composition:[],movement:0,detectionRange:{},attackRange:{},weapons:{},capabilities:{},
    col:fc.col,row:fc.row,hp:1,maxHp:1,detected:true,isFakeContact:true,
  }));

  return{
    ...stateRest,
    units:[...mine,...detected,...detectedNeutrals,...fakeUnits],
    blueAttacks:team==='blue'?state.blueAttacks:(state.blueAttacks!==null?'✓':null),
    redAttacks: team==='red' ?state.redAttacks :(state.redAttacks !==null?'✓':null),
    isFacilitator:false,
    cyber:filterCyberForTeam(state,team),
    log:filterLogForPlayer(stateRest.log,team),
  };
}

// ─── Weapon priority / combat helpers ────────────────────────────────────────
const WEAPON_PRIORITY={
  surface:['ascm','asbm','mss','torpedo','airAttack','navalGun','opEspSabotage'],
  submarine:['asw','torpedo'],
  air:['airDefense','airAttack'],
  land:['lacm','airAttack','navalGun','opEspSabotage'],
};
function selectBestWeapon(attacker,target,dist){
  const priority=WEAPON_PRIORITY[target.category]||[];
  for(const wpnType of priority){
    const qty=getWeaponQuantity(attacker,wpnType);
    if(qty<=0) continue;
    const profile=COMBAT_CONFIG.weaponProfiles?.[wpnType];
    if(!profile) continue;
    if(!profile.targets.includes(target.category)) continue;
    const range=getWeaponRange(attacker,wpnType);
    if(dist<=range) return wpnType;
  }
  return null;
}

// ─── Unit factory ─────────────────────────────────────────────────────────────
function makeUnit(team,spec){
  const pos=spec.position||spec.start||{col:0,row:0};
  const weapons=spec.weapons?JSON.parse(JSON.stringify(spec.weapons)):{};
  const unit={
    id:spec.id,team,name:spec.name,category:spec.category,
    type:(spec.composition&&spec.composition[0]&&COMP_DISPLAY_TYPE[spec.composition[0].type])||DISPLAY_TYPE_FALLBACK[spec.category]||'fragata',
    composition:spec.composition||[],movement:spec.movement,
    detectionRange:spec.detectionRange,attackRange:spec.attackRange,
    col:pos.col,row:pos.row,hp:spec.stayingPower,maxHp:spec.stayingPower,
    stealthy:spec.category==='submarine'||spec.subtype==='op_esp',moved:false,weapons,
    initWeapons:JSON.parse(JSON.stringify(weapons)),
    capabilities:spec.capabilities?{...spec.capabilities}:{},
    notes:spec.notes||'',
    homeBaseId:null,
    embarkUnitId:spec.embarkUnitId||null,
    subtype:spec.subtype||null,
  };
  initializeFuel(unit);
  return unit;
}

function setAircraftHomeBases(state){
  const baseTypes=new Set(['aeroporto','carrier']);
  for(const unit of state.units){
    if(unit.hp<=0||unit.category!=='air'||!['blue','red'].includes(unit.team)) continue;
    const base=state.units.find(b=>b.team===unit.team&&b.hp>0&&baseTypes.has(b.type)&&b.col===unit.col&&b.row===unit.row);
    if(base) unit.homeBaseId=base.id;
  }
}

function returnAircraftToBases(state){
  for(const unit of state.units){
    if(unit.hp<=0||unit.category!=='air') continue;
    if(!unit.homeBaseId) continue;
    const base=state.units.find(b=>b.id===unit.homeBaseId);
    if(!base||base.hp<=0){
      unit.hp=0;
      state.log.unshift(`✈ ${unit.name}(${unit.team}) perdida — base aérea destruída.`);
      continue;
    }
    unit.col=base.col;
    unit.row=base.row;
    unit.fuel.wasAtRefuelLocation=true;
  }
}

function checkSofBoarding(state){
  for(const sof of state.units){
    if(sof.hp<=0||sof.subtype!=='op_esp') continue;
    const vessels=state.units.filter(v=>
      v.team==='neutral'&&v.hp>0&&
      v.col===sof.col&&v.row===sof.row&&
      v.category==='surface'
    );
    for(const vessel of vessels){
      if(vessel.sofBoarding){
        if(vessel.sofBoarding.controlledBy===sof.team) continue;
        const d6=Math.ceil(Math.random()*6);
        const incumbent=vessel.sofBoarding;
        if(d6>=4){
          state.log.unshift(`[OCULTO:${sof.team}] 🎲 Abordagem por ${sof.name}: d6=${d6} — REPELIDO`);
          state.log.unshift(`[OCULTO:${incumbent.controlledBy}] 🎲 Retomada tentada: d6=${d6} — CONTROLE MANTIDO`);
        }else{
          const oldSof=state.units.find(u=>u.id===incumbent.sofUnitId&&u.hp>0);
          if(oldSof){oldSof.hp=0;state.log.unshift(`[OCULTO:${incumbent.controlledBy}] ⚫ ${oldSof.name} eliminada na retomada`);}
          vessel.sofBoarding={controlledBy:sof.team,sofUnitId:sof.id};
          state.log.unshift(`[OCULTO:${sof.team}] 🎲 Abordagem: d6=${d6} — CONTROLE DE ${vessel.name} OBTIDO`);
          state.log.unshift(`[OCULTO:${incumbent.controlledBy}] 🎲 Embarcação retomada pelo adversário: d6=${d6}`);
        }
      }else{
        vessel.sofBoarding={controlledBy:sof.team,sofUnitId:sof.id};
        state.log.unshift(`[OCULTO:${sof.team}] 🔒 ${sof.name} abordou ${vessel.name} — controle oculto`);
      }
    }
  }
}

// ─── Guerra Cibernética ───────────────────────────────────────────────────────
let _cyberSeed=1;
function genCyberId(prefix){return `${prefix}-${_cyberSeed++}`;}

// Soma os modificadores cibernéticos ativos de `key` afetando `team`/`unitId`.
// Efeitos com scope 'team' aplicam-se a toda a equipe; scope 'unit' apenas à unidade-alvo.
function activeCyberModifier(state,team,unitId,key){
  let total=0;
  for(const eff of state.cyber?.activeEffects||[]){
    if(eff.affectedTeam!==team) continue;
    if(eff.scope==='unit'&&eff.targetId!==unitId) continue;
    total+=Number(eff.modifiers?.[key]||0);
  }
  return total;
}

function isInfraResupplyBlocked(state,infraUnit){
  for(const eff of state.cyber?.activeEffects||[]){
    if(eff.affectedTeam!==infraUnit.team) continue;
    if(!eff.modifiers?.resupplyBlocked) continue;
    if(eff.scope==='team') return true;
    if(eff.scope==='unit'&&eff.targetId===infraUnit.id) return true;
  }
  return false;
}

function getCyberTeamsWithFlag(state,key){
  const teams=new Set();
  for(const eff of state.cyber?.activeEffects||[]){
    if(eff.scope==='team'&&eff.modifiers?.[key]) teams.add(eff.affectedTeam);
  }
  return teams;
}

// Filtra o estado cibernético exposto a uma equipe: oculta a mão do
// adversário, operações pendentes alheias e a origem de efeitos secretos.
function filterCyberForTeam(state,team){
  const enemyTeam=team==='blue'?'red':'blue';
  const cyber=state.cyber||{};
  const enemyHand=cyber[enemyTeam]||{offensiveCards:[],defensiveCards:[],submitted:false};
  const filteredEnemyHand={
    offensiveCount:enemyHand.offensiveCards.filter(c=>!c.used).length,
    defensiveActiveCount:enemyHand.defensiveCards.filter(c=>c.active).length,
    submitted:enemyHand.submitted,
  };
  const activeEffects=(cyber.activeEffects||[])
    .filter(eff=>eff.affectedTeam===team||eff.attackerTeam===team)
    .map(eff=>{
      if(eff.affectedTeam===team&&eff.secret&&eff.attackerTeam!==team){
        return{...eff,attackerTeam:null,effectId:null,name:'Anomalia Não Identificada'};
      }
      return eff;
    });
  const pendingOperations=(cyber.pendingOperations||[]).filter(op=>op.attackerTeam===team);
  return{
    [team]:cyber[team]||buildStartingHand(team),
    [enemyTeam]:filteredEnemyHand,
    pendingOperations,
    activeEffects,
  };
}

function describeCyberTarget(state,op){
  if(op.targetType==='team') return op.defenderTeam==='blue'?'Força Azul':'Força Vermelha';
  const u=state.units.find(x=>x.id===op.targetId);
  return u?u.name:op.targetId;
}

function tickCyberEffects(state){
  state.cyber.activeEffects=(state.cyber.activeEffects||[]).filter(eff=>{
    eff.turnsRemaining-=1;
    if(eff.turnsRemaining<=0){
      state.log.unshift(`🛡 Efeito cibernético expirado: ${eff.name} (${eff.affectedTeam==='blue'?'Azul':'Vermelho'}).`);
      return false;
    }
    return true;
  });
  state.cyber.fakeContacts=(state.cyber.fakeContacts||[]).filter(fc=>{
    fc.turnsRemaining-=1;
    return fc.turnsRemaining>0;
  });
  for(const team of['blue','red']){
    state.cyber[team].submitted=false;
    for(const card of state.cyber[team].defensiveCards) card.active=false;
  }
  state.cyber.pendingOperations=[];
}

// Aplica o efeito de uma operação cyber já decidida pelo Facilitador.
// Retorna {effectAppliedDesc, message} — `message` é um objeto de mensagem
// (estilo facilitator_message) quando o efeito é do tipo 'message'.
function applyCyberEffect(state,op,result,extra={}){
  const effectDef=CYBER_EFFECTS[op.effectId];
  const scaled=scaleCyberEffect(effectDef,result);
  const targetLabel=describeCyberTarget(state,op);
  let effectAppliedDesc='Nenhum efeito.';
  let message=null;

  if(scaled){
    if(effectDef.kind==='modifier'){
      state.cyber.activeEffects.push({
        id:genCyberId('CYBEFF'),effectId:op.effectId,name:effectDef.name,
        attackerTeam:op.attackerTeam,affectedTeam:op.defenderTeam,
        scope:effectDef.scope||'unit',
        targetId:effectDef.scope==='team'?null:op.targetId,
        modifiers:scaled.modifiers,turnsRemaining:scaled.duration,
        secret:!!op.secret,
      });
      const modDesc=Object.entries(scaled.modifiers).map(([k,v])=>`${k}:${v>0?'+':''}${v}`).join(', ');
      effectAppliedDesc=`${effectDef.name} aplicado a ${targetLabel} (${modDesc}) por ${scaled.duration} turno(s).`;
    }else if(effectDef.kind==='fake_contact'){
      const target=state.units.find(u=>u.id===op.targetId);
      if(target){
        const neighbors=hexNeighbors(target.col,target.row);
        for(let i=0;i<scaled.fakeContactCount;i++){
          const off=neighbors[i%Math.max(1,neighbors.length)]||{col:target.col,row:target.row};
          state.cyber.fakeContacts.push({
            id:genCyberId('FAKE'),visibleToTeam:op.defenderTeam,fakeTeam:op.attackerTeam,
            col:off.col,row:off.row,turnsRemaining:scaled.duration,
          });
        }
      }
      effectAppliedDesc=`${scaled.fakeContactCount} contato(s) falso(s) criado(s) próximo a ${targetLabel}.`;
    }else if(effectDef.kind==='message'){
      const text=(extra.messageText||'').trim()||effectDef.description;
      message={
        id:`MSG-${Date.now()}`,from:'facilitator',to:op.defenderTeam,
        text,timestamp:new Date().toISOString(),replies:[],cyberOp:true,
      };
      state.messages.push(message);
      effectAppliedDesc=`Mensagem de inteligência enviada à ${targetLabel}.`;
    }
  }

  const resultLabel=RESULT_LABELS[result]||result;
  const fullEntry=`🛡 [CYBER N${effectDef.level}] ${op.attackerTeam==='blue'?'Azul':'Vermelho'} → ${effectDef.name} em ${targetLabel}: ${resultLabel}. ${effectAppliedDesc}`;
  if(op.secret){
    state.log.unshift(`[OCULTO:${op.attackerTeam}] ${fullEntry}`);
    if(scaled){
      state.log.unshift(`[OCULTO:${op.defenderTeam}] ⚠ Anomalia detectada em sistemas — possível ação cibernética não identificada.`);
    }
  }else{
    state.log.unshift(fullEntry);
  }
  if(state.log.length>80) state.log=state.log.slice(0,80);

  state.cyber.history.push({
    turn:state.turn,attacker:op.attackerTeam,operation:op.effectId,
    target:op.targetType==='team'?op.defenderTeam:op.targetId,
    facilitatorDecision:result,effectApplied:effectAppliedDesc,
    duration:scaled?scaled.duration:0,secret:!!op.secret,level:effectDef.level,
  });

  return{effectAppliedDesc,message};
}

function startMovementPhase(state){
  state.phase='movement';
  state.log.unshift('Fase de Movimentação iniciada.');
  if(state.log.length>50) state.log=state.log.slice(0,50);
}

let _unitSeed=1000;
function genUnitId(team){return `${team.toUpperCase()}-FAC-${_unitSeed++}`;}

function initialUnits(customOB){
  const ob=customOB||ORDER_OF_BATTLE;
  const units=[];
  for(const spec of(ob.forces.blue||[])) units.push(makeUnit('blue',spec));
  for(const spec of(ob.forces.red||[])) units.push(makeUnit('red',spec));
  for(const spec of(ob.forces.neutral||[])) units.push(makeUnit('neutral',spec));
  return units;
}

function newGame(customOB){
  const state={
    turn:1,period:'day',phase:'cyber',
    blueDone:false,redDone:false,
    blueAttacks:null,redAttacks:null,
    units:initialUnits(customOB),
    log:['──── Turno 1 · Período Diurno ────','Fase de Guerra Cibernética iniciada.'],
    messages:[],
    winner:null,
    movementSnapshot:{},
    pendingPaths:{},
    pendingBrPayload:null,
    combatQueue:[],currentEngagementIndex:0,
    battleRoundDecisions:{blue:null,red:null},
    cyber:{
      blue:buildStartingHand('blue'),
      red:buildStartingHand('red'),
      pendingOperations:[],
      activeEffects:[],
      fakeContacts:[],
      history:[],
    },
  };
  saveMovementSnapshot(state);
  markRefuelEligibility(state);
  setAircraftHomeBases(state);
  return state;
}

// ─── Combat system ────────────────────────────────────────────────────────────
const SALVO_SIZE={ascm:2,mss:2,torpedo:1,lacm:1,asbm:1};
function isSingleRoundWeapon(w){return['lacm','asbm'].includes(w);}

function buildCombatQueue(state){
  const all=[...(state.blueAttacks||[]),...(state.redAttacks||[])];
  return all.map((atk,i)=>{
    const att=state.units.find(u=>u.id===atk.attackerId&&u.hp>0);
    const def=state.units.find(u=>u.id===atk.targetId&&u.hp>0);
    if(!att||!def) return null;
    if(activeCyberModifier(state,att.team,att.id,'attackDisabled')>0){
      state.log.unshift(`🛡 ${att.name}(${att.team}) impedido de atacar — efeito cibernético ativo.`);
      return null;
    }
    const dist=hexDist(att.col,att.row,def.col,def.row);
    let wpnType=null;
    if(atk.weaponType){
      const p=COMBAT_CONFIG.weaponProfiles?.[atk.weaponType];
      const q=getWeaponQuantity(att,atk.weaponType);
      const r=getWeaponRange(att,atk.weaponType);
      if(p&&q>0&&p.targets.includes(def.category)&&dist<=r) wpnType=atk.weaponType;
    }
    if(!wpnType) wpnType=selectBestWeapon(att,def,dist);
    if(!wpnType) return null;
    const profile=COMBAT_CONFIG.weaponProfiles?.[wpnType];
    const qty=getWeaponQuantity(att,wpnType);
    const requested=atk.amount??(SALVO_SIZE[wpnType]||1);
    const baseAmount=profile?.expendable?Math.min(qty,Math.max(1,requested)):1;
    const malus=activeCyberModifier(state,att.team,att.id,'attackAmountMalus');
    const amount=Math.max(1,baseAmount-malus);
    return{id:`ENG-${String(i+1).padStart(2,'0')}`,attackerId:atk.attackerId,targetId:atk.targetId,
      weaponType:wpnType,amount,battleRound:1,maxBattleRounds:isSingleRoundWeapon(wpnType)?1:2,status:'pending',results:[]};
  }).filter(Boolean);
}

function resolveBattleRound(state,engagement,initiativeBonusTeam=null){
  const att=state.units.find(u=>u.id===engagement.attackerId&&u.hp>0);
  const def=state.units.find(u=>u.id===engagement.targetId&&u.hp>0);
  const brTag=`${engagement.id}·BR${engagement.battleRound}`;
  if(!att||!def){engagement.status='ended';state.log.unshift(`[${brTag}] Unidade destruída — engajamento encerrado.`);return null;}
  if(!att.fuel||att.fuel.usesFuel===false||att.fuel.current>0){/*ok*/}else{
    state.log.unshift(`⛽ ${att.name} sem combustível.`);return{ok:false,reason:'Atacante sem combustível'};
  }
  const initLabel=initiativeBonusTeam?` ★${initiativeBonusTeam.toUpperCase()}`:'';
  state.log.unshift(`──── ${brTag}${initLabel} ────`);
  const dist=hexDist(att.col,att.row,def.col,def.row);
  const defenderDisabled=isFuelDisabled(def)||activeCyberModifier(state,def.team,def.id,'ecmDegraded')>0;
  const eng=resolveEngagement({attacker:att,defender:def,weaponType:engagement.weaponType,
    amount:engagement.amount,distance:dist,initiativeBonusTeam,defenderDisabled});
  if(!eng.ok){
    state.log.unshift(`⚠ ${att.name} → ${def.name}: ${eng.reason}`);
  }else{
    spendEngagementFuel(att);
    if(eng.destroyed) state.log.unshift(`💥 ${def.name} DESTRUÍDO por ${att.name} [${eng.weaponLabel}]`);
    else if(eng.totalDamage>0){const intStr=eng.interception?.intercepted>0?` (${eng.interception.intercepted} intercept.)`:'';state.log.unshift(`✓ ${att.name} → ${def.name} −${eng.totalDamage}SP [${eng.weaponLabel}${intStr}]`);spendDamageFuel(def);}
    else{const intStr=eng.interception?.intercepted>0?` (${eng.interception.intercepted} intercept.)`:'';state.log.unshift(`✗ ${att.name} → ${def.name} falhou [${eng.weaponLabel}${intStr}]`);}
  }
  if(state.log.length>80) state.log=state.log.slice(0,80);
  engagement.results.push({battleRound:engagement.battleRound,initiativeBonusTeam,result:eng});
  return eng;
}

function queueBrForFacilitator(room,engagement,result,mustDecide,extra={}){
  const payload={engagement,result,mustDecide,...extra};
  const afterApprove=mustDecide?'wait_decisions':'no_more_decisions';
  if(!room.players.facilitator){
    releaseBrToPlayers(room,payload,afterApprove);
    return;
  }
  room.state.pendingBrPayload={payload,afterApprove};
  io.to(room.players.facilitator).emit('br_result_pending',payload);
}

function releaseBrToPlayers(room,payload,afterApprove){
  if(room.players.blue) io.to(room.players.blue).emit('battle_round_result',payload);
  if(room.players.red)  io.to(room.players.red ).emit('battle_round_result',payload);
  if(room.players.facilitator) io.to(room.players.facilitator).emit('battle_round_result',payload);
  if(afterApprove==='no_more_decisions'){
    finishCurrentEngagement(room);
  }else{
    room.state.battleRoundDecisions={blue:null,red:null};
  }
}

function startCurrentEngagement(room){
  const state=room.state;
  const engagement=state.combatQueue[state.currentEngagementIndex];
  engagement.battleRound=1;
  const result=resolveBattleRound(state,engagement);
  if(!result||!result.ok||engagement.maxBattleRounds===1||result.destroyed){
    queueBrForFacilitator(room,engagement,result,false);return;
  }
  queueBrForFacilitator(room,engagement,result,true);
}

function resolveCounterAttack(state,engagement,blue,red){
  const att=state.units.find(u=>u.id===engagement.attackerId&&u.hp>0);
  const def=state.units.find(u=>u.id===engagement.targetId&&u.hp>0);
  if(!att||!def) return null;
  const dist=hexDist(def.col,def.row,att.col,att.row);
  const counterWpn=selectBestWeapon(def,att,dist);
  if(!counterWpn||isSingleRoundWeapon(counterWpn)) return null;
  const profile=COMBAT_CONFIG.weaponProfiles?.[counterWpn];
  const qty=getWeaponQuantity(def,counterWpn);
  const counterAmt=profile?.expendable?Math.min(qty,SALVO_SIZE[counterWpn]||1):1;
  const defDecision=def.team==='blue'?blue:red;
  const attDecision=att.team==='blue'?blue:red;
  const counterInit=(defDecision==='continue'&&attDecision==='stop')?def.team:null;
  const counterEng={id:`${engagement.id}-CTR`,attackerId:def.id,targetId:att.id,
    weaponType:counterWpn,amount:counterAmt,battleRound:2,maxBattleRounds:2,status:'pending',results:[]};
  return resolveBattleRound(state,counterEng,counterInit);
}

function processBattleRoundDecision(room){
  const state=room.state;
  const engagement=state.combatQueue[state.currentEngagementIndex];
  const{blue,red}=state.battleRoundDecisions;
  const bothStop=blue==='stop'&&red==='stop';
  const maxReached=engagement.battleRound>=engagement.maxBattleRounds;
  if(bothStop||maxReached){queueBrForFacilitator(room,engagement,null,false,{decisions:{blue,red}});return;}
  let initiativeBonusTeam=null;
  if(blue==='continue'&&red==='stop') initiativeBonusTeam='blue';
  if(red==='continue'&&blue==='stop') initiativeBonusTeam='red';
  engagement.battleRound=2;
  const result=resolveBattleRound(state,engagement,initiativeBonusTeam);
  const counterResult=resolveCounterAttack(state,engagement,blue,red);
  queueBrForFacilitator(room,engagement,result,false,{decisions:{blue,red},initiativeBonusTeam,counterResult});
}

function finishCurrentEngagement(room){
  const state=room.state;
  state.combatQueue[state.currentEngagementIndex].status='ended';
  state.currentEngagementIndex+=1;
  if(state.currentEngagementIndex<state.combatQueue.length) startCurrentEngagement(room);
  else finishCombatPhase(room);
}

function finishCombatPhase(room){
  const state=room.state;
  state.log.unshift('── Fase de Combate encerrada. ──');
  state.combatQueue=[];state.currentEngagementIndex=0;state.battleRoundDecisions={blue:null,red:null};

  const winner=checkWinner(state);
  if(winner){
    state.winner=winner;
    state.log.unshift(`🏆 ${winner==='blue'?'Força Azul':'Força Vermelha'} VENCEU!`);
    broadcast(room,'game_over',{winner,state:null});
    return;
  }

  // Enter combat_approval: facilitator reviews final HP before next turn
  state.phase='combat_approval';
  state.log.unshift('Aguardando confirmação do Facilitador para o próximo turno...');
  if(room.players.facilitator) io.to(room.players.facilitator).emit('combat_approval_needed',stateFor(state,'facilitator'));
  broadcast(room);
}

function checkWinner(state){
  const hasOffense=u=>Object.values(u.attackRange||{}).some(v=>v>0)||Object.values(u.weapons||{}).some(w=>w.quantity>0)||Object.values(u.capabilities||{}).some(v=>v>0);
  const b=state.units.some(u=>u.team==='blue'&&u.hp>0&&hasOffense(u));
  const r=state.units.some(u=>u.team==='red' &&u.hp>0&&hasOffense(u));
  if(!b) return 'red';if(!r) return 'blue';return null;
}

function nextTurn(state){
  tickCyberEffects(state);
  const fuelBlockedTeams=getCyberTeamsWithFlag(state,'fuelRecoveryBlocked');
  const portHexes=new Set(state.units.filter(u=>u.team==='blue'&&u.hp>0&&u.type==='porto'&&!isInfraResupplyBlocked(state,u)).map(u=>`${u.col},${u.row}`));
  for(const u of state.units){
    if(u.hp<=0) continue;
    if(!u.initWeapons||Object.keys(u.initWeapons).length===0) continue;
    const hexKey=`${u.col},${u.row}`;
    let reload=false;
    if(u.team==='blue'){
      if(u.category==='land') reload=true;
      else if(u.category==='air') reload=u.fuel?.wasAtRefuelLocation===true;
      else if(!u.moved&&(u.category==='surface'||u.category==='submarine')) reload=portHexes.has(hexKey);
    }else if(u.team==='red'){
      if(u.category==='air') reload=u.fuel?.wasAtRefuelLocation===true;
    }
    if(reload&&u.category==='air'&&u.homeBaseId){
      const base=state.units.find(b=>b.id===u.homeBaseId);
      if(base&&isInfraResupplyBlocked(state,base)) reload=false;
    }
    if(reload){
      const restored=[];
      for(const[wpn,init]of Object.entries(u.initWeapons)){
        const cur=u.weapons[wpn]?.quantity??0;
        if(cur<init.quantity){u.weapons[wpn]={...init};restored.push(wpn.toUpperCase());}
      }
      if(restored.length>0) state.log.unshift(`🔄 ${u.name} recompletou: ${restored.join(', ')}`);
    }
  }
  returnAircraftToBases(state);
  for(const u of state.units){
    if(u.hp<=0||u.subtype!=='op_esp'||!u.embarkUnitId) continue;
    const host=state.units.find(h=>h.id===u.embarkUnitId);
    if(!host||host.hp<=0){
      u.hp=0;
      state.log.unshift(`⚫ ${u.name}(${u.team}) perdida — unidade transportadora afundada.`);
    }
  }
  const fuelReports=recoverNavalFuel(state,fuelBlockedTeams);
  for(const{unit:u}of fuelReports) state.log.unshift(`⛽ ${u.name}(${u.team}) reabasteceu: ${u.fuel.current}/${u.fuel.max} FP.`);
  recoverAircraft(state,fuelBlockedTeams);
  state.units.forEach(u=>{u.moved=false;});
  resetFuelTurnCounters(state);
  state.period=state.period==='day'?'night':'day';
  if(state.period==='day') state.turn++;
  state.phase='cyber';
  state.blueDone=state.redDone=false;
  state.blueAttacks=state.redAttacks=null;
  const per=state.period==='day'?'Diurno':'Noturno';
  state.log.unshift(`──── Turno ${state.turn} · Período ${per} ────`);
  state.log.unshift('Fase de Guerra Cibernética iniciada.');
  if(state.log.length>50) state.log=state.log.slice(0,50);
  saveMovementSnapshot(state);
  markRefuelEligibility(state);
}

// ─── Server ───────────────────────────────────────────────────────────────────
const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:'*'}});

app.use(express.static(path.join(__dirname,'public')));
app.get('/',(_, res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.get('/game',(_, res)=>res.sendFile(path.join(__dirname,'public','game.html')));

const rooms=new Map();
function genId(){return Math.random().toString(36).slice(2,8).toUpperCase();}

function broadcast(room,event='game_update',extraPayload=null){
  if(!room.state) return;
  const emit=(pid,role)=>{
    if(!pid) return;
    const state=stateFor(room.state,role);
    if(event==='game_update') io.to(pid).emit('game_update',state);
    else if(event==='game_over'){io.to(pid).emit('game_over',{winner:room.state.winner,state});}
  };
  emit(room.players.blue,'blue');
  emit(room.players.red,'red');
  emit(room.players.facilitator,'facilitator');
}

function facBroadcast(room){
  if(!room.state||!room.players.facilitator) return;
  io.to(room.players.facilitator).emit('game_update',stateFor(room.state,'facilitator'));
}

// ─── Socket connections ───────────────────────────────────────────────────────
io.on('connection',socket=>{
  console.log('+ connect',socket.id);

  // ── Facilitador cria a sala ──────────────────────────────────────────────
  socket.on('create_room',()=>{
    const id=genId();
    const room={
      id,
      players:{blue:null,red:null,facilitator:socket.id},
      state:null,
      customOB:JSON.parse(JSON.stringify(ORDER_OF_BATTLE)),
    };
    rooms.set(id,room);
    socket.data.roomId=id; socket.data.role='facilitator';
    socket.join(id);
    socket.emit('room_created',{roomId:id,role:'facilitator',ob:room.customOB});
  });

  // ── Jogadores entram com escolha de equipe ───────────────────────────────
  socket.on('join_room',({roomId,team})=>{
    const room=rooms.get(roomId?.toUpperCase?.());
    if(!room){socket.emit('join_error','Sala não encontrada.');return;}
    if(!team||!['blue','red'].includes(team)){socket.emit('join_error','Selecione Azul ou Vermelho.');return;}
    if(room.players[team]){socket.emit('join_error',`Equipe ${team==='blue'?'Azul':'Vermelha'} já ocupada.`);return;}

    room.players[team]=socket.id;
    socket.data.roomId=room.id; socket.data.role=team;
    socket.join(room.id);
    socket.emit('join_success',{role:team,roomId:room.id});

    // Notifica facilitador
    if(room.players.facilitator){
      io.to(room.players.facilitator).emit('player_joined',{
        team,
        blueReady:!!room.players.blue,
        redReady:!!room.players.red,
      });
    }
    // Se o jogo já começou, envia estado atual ao novo jogador
    if(room.state){
      socket.emit('game_start',{role:team,state:stateFor(room.state,team)});
    }
  });

  // ── Config: facilitador atualiza a OB ────────────────────────────────────
  socket.on('update_ob',({ob})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room||socket.data.role!=='facilitator') return;
    room.customOB=ob;
    socket.emit('ob_updated',{ok:true});
  });

  // ── Config: facilitador inicia o jogo ────────────────────────────────────
  socket.on('start_game',()=>{
    const room=rooms.get(socket.data.roomId);
    if(!room||socket.data.role!=='facilitator') return;
    if(!room.players.blue||!room.players.red){
      socket.emit('action_error','Aguardando os dois jogadores conectarem.');return;
    }
    room.state=newGame(room.customOB);
    io.to(room.players.blue).emit('game_start',{role:'blue',state:stateFor(room.state,'blue')});
    io.to(room.players.red ).emit('game_start',{role:'red', state:stateFor(room.state,'red')});
    socket.emit('game_start',{role:'facilitator',state:stateFor(room.state,'facilitator')});
  });

  // ── Guerra Cibernética: equipe envia operações ───────────────────────────
  socket.on('cyber_submit',({operations,defenseCardIds})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state) return;
    const{state}=room,{role}=socket.data;
    const team=role;
    if(!['blue','red'].includes(team)) return;
    if(state.phase!=='cyber'){socket.emit('action_error','Não é a fase de Guerra Cibernética.');return;}
    if(state.cyber[team].submitted){socket.emit('action_error','Você já concluiu a fase cibernética.');return;}

    const enemyTeam=team==='blue'?'red':'blue';
    const hand=state.cyber[team];

    // Ativar cartas defensivas
    for(const cardId of(defenseCardIds||[])){
      const card=hand.defensiveCards.find(c=>c.id===cardId);
      if(card) card.active=true;
    }

    for(const op of(operations||[])){
      const card=hand.offensiveCards.find(c=>c.id===op.cardId&&!c.used&&c.effectId===op.effectId);
      const effectDef=CYBER_EFFECTS[op.effectId];
      if(!card||!effectDef) continue;

      let targetId=op.targetId,defenderTeam=enemyTeam;
      if(effectDef.targetType==='team'){
        targetId=enemyTeam;
      }else{
        const target=state.units.find(u=>u.id===op.targetId&&u.hp>0&&u.team===enemyTeam);
        if(!target) continue;
        if(effectDef.targetType==='infrastructure'&&!['porto','aeroporto','carrier','fpso','base_naval','bateria_ada','bateria_costeira'].includes(target.type)) continue;
        targetId=target.id;
      }

      card.used=true;
      const{chance,result}=computeCyberSuggestion(state.cyber,team,defenderTeam,effectDef);
      state.cyber.pendingOperations.push({
        id:genCyberId('CYBOP'),attackerTeam:team,defenderTeam,effectId:op.effectId,
        targetType:effectDef.targetType,targetId,cardId:card.id,
        justification:(op.justification||'').slice(0,300),
        secret:!!op.secret,suggestedChance:chance,suggestedResult:result,
      });
      state.log.unshift(`[OCULTO:${team}] 🛡 ${team==='blue'?'Azul':'Vermelho'} declarou operação cyber: ${effectDef.name} → ${describeCyberTarget(state,{targetType:effectDef.targetType,targetId,defenderTeam})}`);
    }

    hand.submitted=true;
    state.log.unshift(`${team==='blue'?'Força Azul':'Força Vermelha'} concluiu a fase de Guerra Cibernética.`);
    if(state.log.length>50) state.log=state.log.slice(0,50);

    if(state.cyber.blue.submitted&&state.cyber.red.submitted){
      if(state.cyber.pendingOperations.length===0){
        startMovementPhase(state);
      }else{
        state.phase='cyber_approval';
        state.log.unshift('Operações cibernéticas declaradas. Aguardando avaliação do Facilitador...');
        if(room.players.facilitator) io.to(room.players.facilitator).emit('cyber_approval_needed',stateFor(state,'facilitator'));
      }
    }
    broadcast(room);
  });

  // ── Guerra Cibernética: facilitador resolve uma operação ──────────────────
  socket.on('cyber_resolve_op',({opId,result,messageText})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state||socket.data.role!=='facilitator') return;
    const{state}=room;
    if(state.phase!=='cyber_approval'){socket.emit('action_error','Não é a fase de aprovação cibernética.');return;}
    const idx=state.cyber.pendingOperations.findIndex(o=>o.id===opId);
    if(idx===-1) return;
    const[op]=state.cyber.pendingOperations.splice(idx,1);
    const finalResult=result||op.suggestedResult;
    const{message}=applyCyberEffect(state,op,finalResult,{messageText});
    if(message){
      const sendTo=pid=>{if(pid) io.to(pid).emit('facilitator_message',message);};
      sendTo(room.players[op.defenderTeam]);
    }
    if(state.cyber.pendingOperations.length===0&&state.phase==='cyber_approval'){
      startMovementPhase(state);
    }
    broadcast(room);
  });

  // ── Guerra Cibernética: facilitador conclui a fase (resolve pendências automaticamente) ──
  socket.on('cyber_finish_phase',()=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state||socket.data.role!=='facilitator') return;
    const{state}=room;
    if(state.phase!=='cyber_approval'){socket.emit('action_error','Não é a fase de aprovação cibernética.');return;}
    for(const op of[...state.cyber.pendingOperations]){
      const{message}=applyCyberEffect(state,op,op.suggestedResult);
      if(message){
        const sendTo=pid=>{if(pid) io.to(pid).emit('facilitator_message',message);};
        sendTo(room.players[op.defenderTeam]);
      }
    }
    state.cyber.pendingOperations=[];
    startMovementPhase(state);
    broadcast(room);
  });

  // ── Guerra Cibernética: facilitador cria evento manual ─────────────────────
  socket.on('cyber_create_event',({attackerTeam,effectId,targetType,targetId,result,secret,messageText,messageTo})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state||socket.data.role!=='facilitator') return;
    const{state}=room;
    const effectDef=CYBER_EFFECTS[effectId];
    if(!effectDef||!['blue','red'].includes(attackerTeam)) return;
    const enemyTeam=attackerTeam==='blue'?'red':'blue';
    let defenderTeam=enemyTeam,resolvedTargetId=targetId;
    if(effectDef.targetType==='team'){
      defenderTeam=targetId&&['blue','red'].includes(targetId)?targetId:enemyTeam;
      resolvedTargetId=defenderTeam;
    }else{
      const target=state.units.find(u=>u.id===targetId&&u.hp>0);
      if(!target) return;
      defenderTeam=target.team;
      resolvedTargetId=target.id;
    }
    const op={attackerTeam,defenderTeam,effectId,targetType:effectDef.targetType,targetId:resolvedTargetId,secret:!!secret};
    const finalResult=result||'success';
    const{message}=applyCyberEffect(state,op,finalResult,{messageText});
    state.cyber.history[state.cyber.history.length-1].facilitatorDecision='manual:'+finalResult;
    if(message){
      const to=messageTo||defenderTeam;
      const sendTo=pid=>{if(pid) io.to(pid).emit('facilitator_message',message);};
      if(to==='all'||to==='blue') sendTo(room.players.blue);
      if(to==='all'||to==='red') sendTo(room.players.red);
    }
    broadcast(room);
  });

  // ── Movimentação ─────────────────────────────────────────────────────────
  socket.on('commit_moves',({moves})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state) return;
    const{state}=room,{role}=socket.data;
    const team=role; // 'blue' or 'red'
    if(!['blue','red'].includes(team)) return;

    if(state.phase!=='movement'){socket.emit('action_error','Não é a fase de movimentação.');return;}
    if(state[team==='blue'?'blueDone':'redDone']){socket.emit('action_error','Você já encerrou a movimentação.');return;}

    // Validate
    for(const{unitId,path}of(moves||[])){
      if(!Array.isArray(path)||path.length<2) continue;
      const unit=state.units.find(u=>u.id===unitId&&u.hp>0&&(u.team===team||(u.team==='neutral'&&u.sofBoarding?.controlledBy===team)));
      if(!unit){socket.emit('action_error',`Unidade ${unitId} inválida.`);return;}
      if(unit.movement===0){socket.emit('action_error',`${unit.name}: unidade fixa.`);return;}
      if(isFuelDisabled(unit)){socket.emit('action_error',`${unit.name}: sem combustível.`);return;}
      if(activeCyberModifier(state,team,unit.id,'moveDisabled')>0){socket.emit('action_error',`${unit.name}: C2 interrompido — movimento bloqueado.`);return;}
      if(path[0].col!==unit.col||path[0].row!==unit.row){socket.emit('action_error',`Caminho inválido para ${unit.name}.`);return;}
      if(path.length-1>unit.movement){socket.emit('action_error',`${unit.name}: caminho excede alcance.`);return;}
      for(let i=1;i<path.length;i++){
        const{col,row}=path[i];
        if(col<0||col>=GRID_W||row<0||row>=GRID_H){socket.emit('action_error',`${unit.name}: fora do tabuleiro.`);return;}
        if(hexDist(path[i-1].col,path[i-1].row,col,row)!==1){socket.emit('action_error',`${unit.name}: passo não adjacente.`);return;}
        if(!canEnterTerrain(unit.category,getTerrain(col,row))&&unit.subtype!=='op_esp'){socket.emit('action_error',`${unit.name}: terreno intransponível.`);return;}
      }
    }

    // Apply
    const pp=state.pendingPaths=state.pendingPaths||{};
    for(const{unitId,path}of(moves||[])){
      if(!Array.isArray(path)||path.length<2) continue;
      const unit=state.units.find(u=>u.id===unitId&&u.hp>0&&(u.team===team||(u.team==='neutral'&&u.sofBoarding?.controlledBy===team)));
      if(!unit) continue;
      const dest=path[path.length-1];
      unit.col=dest.col;unit.row=dest.row;unit.moved=true;
      pp[unitId]=path;
      if(unit.team==='neutral'){
        state.log.unshift(`[OCULTO:${team}] 🚢 ${unit.name} deslocado (controle oculto) → ${String.fromCharCode(65+dest.col)}${dest.row+1}`);
      }else{
        state.log.unshift(`${unit.name}(${team}) → ${String.fromCharCode(65+dest.col)}${dest.row+1}`);
      }
      const dist=path.length-1;
      if(unit.category!=='air'){spendNavalFuel(unit,navalMoveCost(dist));}
      else{
        unit.airStatus='airborne';spendAirFuel(unit,dist);
        if(isAirRefuelLocation(unit,state)){
          unit.fuel.wasAtRefuelLocation=true;
          const base=state.units.find(b=>b.team===unit.team&&b.hp>0&&(b.type==='aeroporto'||b.type==='carrier')&&b.col===unit.col&&b.row===unit.row);
          if(base) unit.homeBaseId=base.id;
        }
      }
    }

    // Stationary fuel
    for(const u of state.units){
      if(u.hp<=0||u.team!==team||u.moved) continue;
      if(u.category==='air'){
        if(u.airStatus==='airborne'){if(isAirRefuelLocation(u,state)) u.fuel.wasAtRefuelLocation=true;else spendAirFuel(u,1);}
      }else{spendNavalFuel(u,navalMoveCost(0));}
    }

    if(team==='blue') state.blueDone=true;else state.redDone=true;

    if(state.blueDone&&state.redDone){
      checkSofBoarding(state);
      // Fuel alerts
      const navalEmpty=checkNavalFuelZero(state);
      for(const u of navalEmpty){
        const pid=room.players[u.team];
        if(pid) io.to(pid).emit('fuel_alert',{unitId:u.id,name:u.name,type:'naval_empty'});
        state.log.unshift(`⛽ ${u.name}(${u.team}) sem combustível.`);
      }
      const airLost=checkAirFuelLosses(state);
      for(const u of airLost){
        const pid=room.players[u.team];
        if(pid) io.to(pid).emit('fuel_alert',{unitId:u.id,name:u.name,type:'air_lost'});
        state.log.unshift(`✈ ${u.name}(${u.team}) perdida por falta de combustível.`);
      }

      // Entrar em movement_approval
      state.phase='movement_approval';
      state.log.unshift('Movimentos concluídos. Aguardando aprovação do Facilitador...');
      if(room.players.facilitator) io.to(room.players.facilitator).emit('movement_approval_needed',stateFor(state,'facilitator'));
    }else{
      const waiting=team==='blue'?'Força Vermelha':'Força Azul';
      state.log.unshift(`${team==='blue'?'Força Azul':'Força Vermelha'} encerrou movimentação. Aguardando ${waiting}...`);
    }
    if(state.log.length>50) state.log=state.log.slice(0,50);
    broadcast(room);
  });

  // ── Facilitador aprova movimentos (com opção de reposicionamento) ─────────
  socket.on('approve_movements',({overrides})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state||socket.data.role!=='facilitator') return;
    const{state}=room;
    if(state.phase!=='movement_approval'){socket.emit('action_error','Não é a fase de aprovação de movimentos.');return;}

    // Aplicar overrides de posição
    for(const{unitId,col,row}of(overrides||[])){
      if(col<0||col>=GRID_W||row<0||row>=GRID_H) continue;
      const unit=state.units.find(u=>u.id===unitId);
      if(unit){
        unit.col=col;unit.row=row;
        state.log.unshift(`📍 Facilitador reposicionou ${unit.name} → ${String.fromCharCode(65+col)}${row+1}`);
      }
    }

    state.pendingPaths={};
    state.phase='combat';
    state.log.unshift('Movimentos aprovados. Fase de Combate iniciada. Declare seus ataques.');
    broadcast(room);
  });

  // ── Combate: declaração de ataques ───────────────────────────────────────
  socket.on('declare_attacks',attacks=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state) return;
    const{state}=room,{role}=socket.data;
    const team=role;
    if(!['blue','red'].includes(team)) return;
    if(state.phase!=='combat'){socket.emit('action_error','Não é a fase de combate.');return;}
    if(team==='blue') state.blueAttacks=attacks||[];else state.redAttacks=attacks||[];
    state.log.unshift(`${team==='blue'?'Força Azul':'Força Vermelha'} confirmou ${(attacks||[]).length} ataque(s).`);
    if(state.blueAttacks!==null&&state.redAttacks!==null){
      state.log.unshift('── Resolução de Combate ──');
      state.combatQueue=buildCombatQueue(state);
      state.currentEngagementIndex=0;
      state.battleRoundDecisions={blue:null,red:null};
      broadcast(room);
      if(state.combatQueue.length===0) finishCombatPhase(room);
      else startCurrentEngagement(room);
    }else{broadcast(room);}
  });

  socket.on('battle_round_decision',({decision})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state) return;
    const{state}=room,{role}=socket.data;
    if(!['blue','red'].includes(role)||state.phase!=='combat') return;
    state.battleRoundDecisions[role]=decision;
    const{blue,red}=state.battleRoundDecisions;
    if(blue&&red) processBattleRoundDecision(room);
  });

  // ── Facilitador aprova resultados de combate ──────────────────────────────
  socket.on('approve_combat',({hpChanges})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state||socket.data.role!=='facilitator') return;
    const{state}=room;
    if(state.phase!=='combat_approval'){socket.emit('action_error','Não é a fase de aprovação de combate.');return;}

    // Aplicar modificações de HP
    for(const{unitId,hp}of(hpChanges||[])){
      const unit=state.units.find(u=>u.id===unitId);
      if(!unit) continue;
      const oldHp=unit.hp;
      unit.hp=Math.max(0,Math.min(unit.maxHp,Number(hp)||0));
      if(unit.hp!==oldHp) state.log.unshift(`📝 Facilitador ajustou SP de ${unit.name}: ${oldHp}→${unit.hp}`);
    }

    // Re-check winner after adjustments
    const winner=checkWinner(state);
    if(winner){
      state.winner=winner;
      state.log.unshift(`🏆 ${winner==='blue'?'Força Azul':'Força Vermelha'} VENCEU!`);
      broadcast(room,'game_over');
      return;
    }

    nextTurn(state);
    broadcast(room);
  });

  // ── Mensagens do Facilitador ──────────────────────────────────────────────
  socket.on('facilitator_message',({to,text})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state||socket.data.role!=='facilitator') return;
    if(!text?.trim()) return;

    const msg={
      id:`MSG-${Date.now()}`,
      from:'facilitator',to,
      text:text.trim(),
      timestamp:new Date().toISOString(),
      replies:[],
    };
    room.state.messages.push(msg);
    room.state.log.unshift(`📢 Facilitador → ${to==='all'?'Todos':to==='blue'?'Azul':'Vermelho'}: "${text.trim().slice(0,40)}"`);

    const sendTo=(pid)=>{if(pid) io.to(pid).emit('facilitator_message',msg);};
    if(to==='all'||to==='blue') sendTo(room.players.blue);
    if(to==='all'||to==='red')  sendTo(room.players.red);
    socket.emit('message_sent',{msgId:msg.id});
    facBroadcast(room);
  });

  socket.on('player_reply',({messageId,text})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state) return;
    const{role}=socket.data;
    if(!['blue','red'].includes(role)) return;
    if(!text?.trim()) return;
    const msg=room.state.messages.find(m=>m.id===messageId);
    if(!msg) return;
    const reply={from:role,text:text.trim(),timestamp:new Date().toISOString()};
    msg.replies.push(reply);
    room.state.log.unshift(`↩ ${role==='blue'?'Azul':'Vermelho'}: "${text.trim().slice(0,40)}"`);
    if(room.players.facilitator) io.to(room.players.facilitator).emit('player_reply',{messageId,reply});
    facBroadcast(room);
  });

  // ── Gerenciamento de unidades pelo facilitador ────────────────────────────
  socket.on('facilitator_manage_unit',({action,unitId,data})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state||socket.data.role!=='facilitator') return;
    const{state}=room;

    if(action==='add'){
      // data = spec object
      const team=data.team||'neutral';
      const newId=genUnitId(team);
      const spec={...data,id:newId,position:{col:data.col??8,row:data.row??5}};
      const unit=makeUnit(team,spec);
      state.units.push(unit);
      state.log.unshift(`➕ Facilitador adicionou ${unit.name} (${team})`);
      broadcast(room);
    }else if(action==='edit'&&unitId){
      const unit=state.units.find(u=>u.id===unitId);
      if(!unit) return;
      if(data.hp!=null) unit.hp=Math.max(0,Math.min(unit.maxHp,Number(data.hp)));
      if(data.col!=null&&data.row!=null){unit.col=Number(data.col);unit.row=Number(data.row);}
      if(data.name) unit.name=data.name;
      if(data.status) unit.customStatus=data.status;
      state.log.unshift(`✏ Facilitador editou ${unit.name}`);
      broadcast(room);
    }else if(action==='remove'&&unitId){
      const unit=state.units.find(u=>u.id===unitId);
      if(!unit) return;
      unit.hp=0;
      state.log.unshift(`❌ Facilitador removeu ${unit.name}`);
      broadcast(room);
    }
  });

  // ── Facilitador reposiciona unidade no mapa ───────────────────────────────
  socket.on('facilitator_reposition',({unitId,col,row})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state||socket.data.role!=='facilitator') return;
    if(col<0||col>=GRID_W||row<0||row>=GRID_H) return;
    const unit=room.state.units.find(u=>u.id===unitId&&u.hp>0);
    if(!unit) return;
    unit.col=col;unit.row=row;
    room.state.log.unshift(`📍 Facilitador moveu ${unit.name} → ${String.fromCharCode(65+col)}${row+1}`);
    broadcast(room);
  });

  // ── Facilitador aprova resultado de batalha ───────────────────────────────
  socket.on('facilitator_approve_br',({hpAdjustments,altered})=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state||socket.data.role!=='facilitator') return;
    const{state}=room;
    if(!state.pendingBrPayload) return;
    const adjustedNotes=[];
    for(const{unitId,hp}of(hpAdjustments||[])){
      const unit=state.units.find(u=>u.id===unitId);
      if(!unit) continue;
      const oldHp=unit.hp;
      unit.hp=Math.max(0,Math.min(unit.maxHp,Number(hp)||0));
      if(unit.hp!==oldHp){
        state.log.unshift(`📝 Facilitador ajustou SP de ${unit.name}: ${oldHp}→${unit.hp}`);
        adjustedNotes.push(`${unit.name}: ${oldHp}→${unit.hp}SP`);
      }
    }
    const{payload,afterApprove}=state.pendingBrPayload;
    state.pendingBrPayload=null;
    const finalPayload=(altered&&adjustedNotes.length>0)
      ?{...payload,facilitatorNote:`📝 Ajuste do Facilitador: ${adjustedNotes.join(', ')}`}
      :payload;
    releaseBrToPlayers(room,finalPayload,afterApprove);
  });

  // ── Facilitador encerra o jogo ────────────────────────────────────────────
  socket.on('facilitator_end_game',()=>{
    const room=rooms.get(socket.data.roomId);
    if(!room?.state||socket.data.role!=='facilitator') return;
    const{state}=room;
    state.winner='draw';
    state.log.unshift('🚩 Facilitador encerrou a partida.');
    broadcast(room,'game_over');
  });

  // ── Restart ───────────────────────────────────────────────────────────────
  socket.on('restart',()=>{
    const room=rooms.get(socket.data.roomId);
    if(!room||socket.data.role!=='facilitator') return;
    room.state=newGame(room.customOB);
    if(room.players.blue) io.to(room.players.blue).emit('game_start',{role:'blue',state:stateFor(room.state,'blue')});
    if(room.players.red)  io.to(room.players.red ).emit('game_start',{role:'red', state:stateFor(room.state,'red')});
    socket.emit('game_start',{role:'facilitator',state:stateFor(room.state,'facilitator')});
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect',()=>{
    const{roomId,role}=socket.data;if(!roomId) return;
    const room=rooms.get(roomId);if(!room) return;
    console.log(`- disconnect ${role} from ${roomId}`);
    room.players[role]=null;
    // Notify remaining players
    const notify=pid=>{if(pid) io.to(pid).emit('player_disconnected',{role});};
    if(role==='facilitator'){notify(room.players.blue);notify(room.players.red);}
    else{notify(room.players.facilitator);notify(room.players[role==='blue'?'red':'blue']);}
    // Limpar sala se facilitador saiu
    if(role==='facilitator') rooms.delete(roomId);
  });
});

server.listen(PORT,()=>console.log(`Servidor em http://localhost:${PORT}`));
