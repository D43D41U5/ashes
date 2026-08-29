/**
 * CE QUE LES CORPS SOLIDES COÛTENT À LA MEUTE — la courbe, sur douze graines.
 *
 *   node --import tsx tools/diag-corps.mts
 *
 * POURQUOI CET INSTRUMENT EXISTE. La séparation des corps (`separation.ts`, demande
 * d'Alexis 2026-08-27 : « on traverse les sprites des ennemis ») fait rougir A12bis —
 * l'ENCERCLEMENT, le moment de jeu construit le 2026-08-01. C'est exactement la question
 * qui a gelé `KNOCKBACK_TILES` à zéro, et elle se pose de la même façon : une meute est
 * CHAOTIQUE, la garde se joue sur UNE graine, et son verdict à cette échelle mesure le
 * hasard autant que la règle.
 *
 * On mesure donc les deux PROPRIÉTÉS que les gardes défendent, à plusieurs forces de
 * séparation — la colonne `0` étant le TÉMOIN, c'est-à-dire le jeu d'avant :
 *
 *   · L'ENCERCLEMENT — combien de côtés distincts la meute tient-elle autour d'un homme
 *     figé ? (A12/A12bis affirment ≥ 2.)
 *   · LA LÉTALITÉ — un homme désarmé meurt-il face à quatre loups ? (A14, et `faune.md`
 *     R13 : « la mort doit être l'issue probable ».)
 *
 * Le banc est celui de `diag-recul.mts`, à la ligne près : un monde nu à 2 h du matin,
 * sans faune ambiante ni nuit qui chasse (elle sème ses propres loups et noierait le
 * comptage). Un instrument qui ne reproduit pas le zéro connu ne mesure rien.
 */
import {
  BALANCE,
  COMBAT,
  FAUNA,
  MONSTER_DEFS,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  createEmptyMap,
  createSim,
  cycleOffsetForStartHour,
  spawnEntity,
  spawnMonster,
  step,
  type Monster,
  type SimState,
} from '../packages/sim/src/index'

const POUSSEES = (process.env.DIAG_CORPS ?? '0,0.25,0.5,1').split(',').map(Number)
const GRAINES = (process.env.DIAG_GRAINES ?? '0,1,2,3,4,5,6,7,8,9,10,11').split(',').map(Number)

/** LA GÉOMÉTRIE D'A12bis SANS SOIN — ce que la garde de `faune.test.ts` relève vraiment. */
function cotesA12bis(graine: number): number {
  const sim = banc(graine)
  const pack = meute(sim, 4, 80.5, 80.5)
  const a = spawnEntity(sim, 80.5, 92.5)
  sim.entities.find((e) => e.id === a)!.hp = 100
  for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) step(sim, [{ entityId: a, dx: 0, dy: 1 }])
  for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) step(sim, [{ entityId: a, dx: 0, dy: 0 }])
  const proie = sim.entities.find((e) => e.id === a)!
  const cotes = new Set<string>()
  for (const w of pack) {
    const e = sim.entities.find((x) => x.id === w.entityId)
    if (!e) continue
    if (dist(e, proie) <= FAUNA.ENCIRCLE_RADIUS + FAUNA.POST_TOLERANCE + 1) {
      cotes.add(`${e.x < proie.x ? 'O' : 'E'}${e.y < proie.y ? 'N' : 'S'}`)
    }
  }
  return cotes.size
}

/**
 * LE BANC DE `faune.test.ts`, À LA LIGNE PRÈS — et les deux détails qui manquaient au
 * premier jet, chacun payé d'une mesure fausse :
 *  · LA CARTE porte le carré de forêt du banc (10..50) ; un monde tout en prairie n'est
 *    pas le même monde pour le couvert (`chasse.md` C3) ;
 *  · LE VENT EST NUL. L'odorat (C17) ignore couvert et allure : un vent laissé libre rend
 *    chaque banc dépendant de la direction d'approche. `faune.test` le coupe ; ne pas le
 *    couper, c'est mesurer autre chose (`diag-recul.mts` ne le coupe pas — ses chiffres
 *    d'encerclement sont à relire avec ça en tête).
 */
function banc(graine: number): SimState {
  const map = createEmptyMap(160, 160, TERRAIN_GRASS)
  for (let ty = 10; ty < 50; ty++) {
    for (let tx = 10; tx < 50; tx++) map.terrain[ty * map.width + tx] = TERRAIN_FOREST
  }
  const sim = createSim(graine, {
    map,
    faunaCap: 0,
    worldEvents: false,
    cycleOffset: cycleOffsetForStartHour(2, 1),
  })
  sim.wind = { x: 0, y: 0 }
  return sim
}

function meute(sim: SimState, n: number, x: number, y: number): Monster[] {
  const herdId = sim.nextHerdId++
  const pack: Monster[] = []
  for (let i = 0; i < n; i++) {
    const id = spawnMonster(sim, 'wolf', x + i * 1.2, y)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    m.herdId = herdId
    pack.push(m)
  }
  return pack
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y))

/** LE MONTAGE D'A12bis À LA LETTRE — l'homme NON soigné : meurt-il dans la fenêtre ? */
function tombeEnA12bis(graine: number): boolean {
  const sim = banc(graine)
  meute(sim, 4, 80.5, 80.5)
  const a = spawnEntity(sim, 80.5, 92.5)
  sim.entities.find((e) => e.id === a)!.hp = 100
  for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) step(sim, [{ entityId: a, dx: 0, dy: 1 }])
  for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) {
    step(sim, [{ entityId: a, dx: 0, dy: 0 }])
    const moi = sim.entities.find((e) => e.id === a)
    if (!moi || moi.hp <= 0 || moi.hp === COMBAT.RESPAWN_HP) return true
  }
  return false
}

/** COMBIEN DE CÔTÉS la meute tient-elle autour d'un homme qui s'est figé ? */
function cotesTenus(graine: number): number {
  const sim = banc(graine)
  const pack = meute(sim, 4, 80.5, 80.5)
  const a = spawnEntity(sim, 80.5, 92.5)
  const moi = sim.entities.find((e) => e.id === a)!
  moi.hp = 100
  for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) step(sim, [{ entityId: a, dx: 0, dy: 1 }])
  // ON LE MAINTIENT DEBOUT : c'est la GÉOMÉTRIE de la traque qu'on mesure ici, pas la
  // survie (elle a sa propre colonne). Sans ça, l'homme meurt pendant la fenêtre, `die()`
  // le renvoie à son point d'entrée — et l'on relève « zéro côté tenu » pour un cercle
  // qui s'était parfaitement fermé sur un cadavre.
  for (let t = 0; t < 10 * BALANCE.TICK_RATE_HZ; t++) {
    moi.hp = 100
    step(sim, [{ entityId: a, dx: 0, dy: 0 }])
  }
  const proie = sim.entities.find((e) => e.id === a)
  if (!proie) return -1
  const cotes = new Set<string>()
  for (const w of pack) {
    const e = sim.entities.find((x) => x.id === w.entityId)
    if (!e) continue
    if (dist(e, proie) <= FAUNA.ENCIRCLE_RADIUS + FAUNA.POST_TOLERANCE + 1) {
      cotes.add(`${e.x < proie.x ? 'O' : 'E'}${e.y < proie.y ? 'N' : 'S'}`)
    }
  }
  return cotes.size
}

/** L'HOMME DÉSARMÉ MEURT-IL ? (et en combien de secondes) */
function mortEnSecondes(graine: number): number {
  const sim = banc(graine)
  const herdId = sim.nextHerdId++
  const alphaId = spawnMonster(sim, 'wolf', 80.5, 80.5)
  const alpha = sim.monsters.find((z) => z.entityId === alphaId)!
  alpha.herdId = herdId
  alpha.alpha = true
  sim.entities.find((x) => x.id === alphaId)!.hp = MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP
  for (let i = 1; i <= 3; i++) {
    const id = spawnMonster(sim, 'wolf', 80.5 + i * 1.2, 80.5)
    const m = sim.monsters.find((z) => z.entityId === id)!
    m.herdId = herdId
    m.alphaId = alphaId
  }
  const a = spawnEntity(sim, 84.5, 80.5)
  for (let t = 0; t < 30 * BALANCE.TICK_RATE_HZ; t++) {
    step(sim, [{ entityId: a, dx: 0, dy: 0, action: { type: 'attack', dx: -1, dy: 0 } }])
    const moi = sim.entities.find((x) => x.id === a)
    if (!moi || moi.hp <= 0 || moi.hp === COMBAT.RESPAWN_HP) return t / BALANCE.TICK_RATE_HZ
  }
  return -1
}

const moy = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

/**
 * LE CAS QU'ON CRAIGNAIT : un assaillant qui PRESSE, pendant qu'on marche sur lui.
 *
 * L'arithmétique inquiétait : un corps qui pousse à 0,24 t/tick PLUS un homme à 0,2 ferment
 * 0,44 par tick, quand la séparation n'en rend que 0,20 (le plafond, deux corps). Si l'IA
 * pressait vraiment, le contact ne tiendrait pas, et « on traverse les sprites » survivrait
 * dans le cas même qui a fait naître le chantier.
 *
 * ⚠ CE QUE LA MESURE A RÉPONDU, ET IL FAUT LE LIRE COMME UNE LIMITE, PAS COMME UN ✓ :
 * **le contact n'a JAMAIS lieu, ni avec la règle ni sans elle** — 100 % dans les deux
 * colonnes, à poussée nulle comme à poussée pleine. L'IA de mêlée s'arrête à sa portée
 * d'engagement (`engageRange`, R5bis) et frappe de là ; elle n'entre pas dans le corps.
 * Cette colonne ne BORNE donc rien : elle dit seulement que le cas redouté ne se produit
 * pas dans ce montage. Ce qui interpénétrait vraiment — et que la règle corrige de 0 % à
 * 100 % — c'est le JOUEUR qui marche dans un corps (colonnes « contact marche/course »).
 */
function contreUnLoup(espece: 'wolf' | 'cendreux' | 'zombie' = 'cendreux'): number {
  const sim = banc(0)
  const herdId = sim.nextHerdId++
  const pack: Monster[] = []
  for (let i = 0; i < 2; i++) {
    const id = spawnMonster(sim, espece, 80.5 + i * 1.2, 80.5)
    const m = sim.monsters.find((mm) => mm.entityId === id)!
    m.herdId = herdId
    pack.push(m)
  }
  const a = spawnEntity(sim, 80.5, 88.5)
  const moi = sim.entities.find((e) => e.id === a)!
  moi.hp = 100
  // Trois secondes de marche : la meute le repère et vient.
  for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) step(sim, [{ entityId: a, dx: 0, dy: -1 }])
  let mini = Infinity
  for (let t = 0; t < 12 * BALANCE.TICK_RATE_HZ; t++) {
    moi.hp = 100 // on mesure la géométrie, pas la survie
    step(sim, [{ entityId: a, dx: 0, dy: -1 }]) // il marche DROIT sur eux
    for (const w of pack) {
      const e = sim.entities.find((x) => x.id === w.entityId)
      if (!e) continue
      const u = (moi.x - e.x) / BALANCE.AVATAR_HITBOX_TILES
      const v = (moi.y - e.y) / BALANCE.AVATAR_HITBOX_DEPTH_TILES
      const d = Math.sqrt(u * u + v * v)
      if (d < mini) mini = d
    }
  }
  return Math.min(mini, 1)
}

/**
 * LA FERMETÉ DU CONTACT — la seule mesure qui réponde à la plainte d'origine.
 *
 * Un homme marche droit sur un loup ENDORMI (immobile) pendant deux secondes. On relève
 * la distance normalisée la plus courte atteinte : 1 = il n'est jamais entré dans le
 * corps, 0 = il lui a marché dessus. C'est le « on traverse les sprites » en un nombre.
 */
function penetration(sprint: boolean): number {
  const sim = banc(0)
  // UN CORPS INERTE, pas une bête : `spawnEntity` ne donne ni IA ni fiche de monstre, donc
  // rien d'autre que la séparation ne le déplace. ⚠ Le CLOUER à la main (première version)
  // faussait la mesure du simple au double : on jetait la moitié de la correction — celle
  // que le poussé encaisse — et l'on relevait 32 % de contact là où le jeu en tient 100.
  const autre = spawnEntity(sim, 80.5, 80.5)
  const lui = sim.entities.find((e) => e.id === autre)!
  const a = spawnEntity(sim, 76.5, 80.5)
  const moi = sim.entities.find((e) => e.id === a)!
  let mini = Infinity
  for (let t = 0; t < 3 * BALANCE.TICK_RATE_HZ; t++) {
    step(sim, [{ entityId: a, dx: 1, dy: 0, sprint }])
    const u = (moi.x - lui.x) / BALANCE.AVATAR_HITBOX_TILES
    const v = (moi.y - lui.y) / BALANCE.AVATAR_HITBOX_DEPTH_TILES
    const d = Math.sqrt(u * u + v * v)
    if (d < mini) mini = d
  }
  return mini
}

console.log('LES CORPS SOLIDES CONTRE LA MEUTE — deux propriétés, douze graines\n')
console.log(`  plafond ${COMBAT.SEPARATION_MAX_TILES} t/tick · zone morte ${COMBAT.SEPARATION_DEADBAND} · graines 0-11`)
console.log('  (balayer : DIAG_CORPS=0,0.5,1 node --import tsx tools/diag-corps.mts)\n')
console.log('⚠ « vs MORT / vs LOUP » : 100 % dans TOUTES les colonnes, poussée nulle comprise — l’IA de mêlée')
console.log('  s’arrête à sa portée d’engagement et n’entre jamais dans le corps. La colonne ne borne rien.\n')
console.log('poussée   cercle fermé (≥2 côtés)   côtés moy.   il MEURT   mort moy. (s)   tombe en A12bis   A12bis tel quel   contact marche  course  vs MORT  vs LOUP')
for (const p of POUSSEES) {
  ;(COMBAT as { SEPARATION_PUSH: number }).SEPARATION_PUSH = p
  const cotes = GRAINES.map(cotesTenus)
  const morts = GRAINES.map(mortEnSecondes)
  const tues = morts.filter((m) => m >= 0)
  const a12 = GRAINES.map(tombeEnA12bis).filter(Boolean).length
  const g12 = GRAINES.map(cotesA12bis)
  const pen = penetration(false)
  const penS = penetration(true)
  const penL = contreUnLoup('cendreux')
  const penW = contreUnLoup('wolf')
  console.log(
    `${p.toFixed(2).padStart(6)}   ${String(cotes.filter((c) => c >= 2).length).padStart(9)}/${GRAINES.length}` +
      `   ${moy(cotes).toFixed(2).padStart(12)}   ${String(tues.length).padStart(5)}/${GRAINES.length}` +
      `   ${(tues.length > 0 ? moy(tues).toFixed(1) : '—').padStart(12)}   ${String(a12).padStart(11)}/${GRAINES.length}` +
      `   ${String(g12.filter((c) => c >= 2).length).padStart(8)}/${GRAINES.length}` +
      `   ${(pen * 100).toFixed(0).padStart(9)} %  ${(penS * 100).toFixed(0).padStart(6)} %  ${(penL * 100).toFixed(0).padStart(6)} %  ${(penW * 100).toFixed(0).padStart(5)} %`,
  )
}
