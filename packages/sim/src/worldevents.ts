/**
 * Les événements du monde — hordes, carcasses, alarmes (spec événements).
 *
 * Le robinet à sessions (GDD §6) : la nuit apporte la menace, la route
 * apporte l'opportunité. Tout est tiré au PRNG de la sim et cadencé par le
 * calendrier — la pression monte avec les actes (GDD §2).
 */
import { isThreatTo } from './alignment'
import { BALANCE, CENDREUX, COMBAT, CONVOY_LOOT, FAUNA, LOOT_VALUES, MONSTER_DEFS, SEASON, SLOTS, TERRAIN_ROAD, WORLD_EVENTS } from './balance'
import { distSq } from './geometry'
import { computeFlowField, solidesEternels } from './pathfinding'
import { inventoryOf, toBag } from './items'
import { rngRoll } from './rng'
import { cendreuxSousPression, plafondGlobal, spawnMonster } from './monsters'
import type { SimState } from './sim'
import { dayTicksAt, estCrepuscule, TICKS_PER_CYCLE, jourDeSaison, seasonRamp } from './time'
import { emitEvent, type SimEvent } from './events'
import { fireStateAt } from './fire'
import { densiteDesMorts } from './morts'
import { eveilCendreuxAt } from './temperature'
import { isPrey } from './faune'

export interface Horde {
  id: number
  /** LA TUILE DU FEU VISÉ (décision ⑬, 2026-08-21) — village ou simple feu de camp : la
   *  horde ne connaît qu'une braise. Ne pas avoir de village n'est plus une immunité. */
  fireTx: number
  fireTy: number
  /** Le village de ce Feu, s'il en est un — pour la chronique et le récit, jamais pour la marche. */
  villageId?: number
  memberEntityIds: number[]
}

/**
 * LE PRÉSAGE (décision ⑱) — la horde de ce soir se décide À L'AUBE, et les signes tombent le
 * jour d'avant : `presage_horde` (bandeau, son), la faune qui déserte l'origine. Quatre
 * nombres et une taille, JSON-sérialisable : il vit dans `SimState.presage` jusqu'au
 * crépuscule qui l'exécute.
 */
export interface Presage {
  /** Le tick du crépuscule où elle se lèvera. */
  at: number
  /** L'origine élue — le sol le plus mort de la couronne d'approche (décision ⑫). */
  x: number
  y: number
  fireTx: number
  fireTy: number
  villageId?: number
  size: number
}

function roll(state: SimState): number {
  const { value, next } = rngRoll(state.rngState)
  state.rngState = next
  return value
}


/**
 * LES FEUX QUE LA VALLÉE VOIT BRÛLER — les cibles possibles d'une horde (décision ⑬).
 * L'ordre est stable (structures puis villages orphelins de structure) : l'élection qui s'y
 * appuie est reproductible.
 */
function feuxAllumes(state: SimState): { tx: number; ty: number; villageId?: number }[] {
  const feux: { tx: number; ty: number; villageId?: number }[] = []
  const vus = new Set<number>()
  const width = state.map.width
  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    if (fireStateAt(state.tick, s) !== 'lit') continue
    const key = s.ty * width + s.tx
    if (vus.has(key)) continue
    vus.add(key)
    if (s.villageId !== 0) feux.push({ tx: s.tx, ty: s.ty, villageId: s.villageId })
    else feux.push({ tx: s.tx, ty: s.ty })
  }
  // Un village dont le Feu n'aurait pas de structure (banc minimal) reste une cible.
  for (const v of state.villages) {
    const key = v.fireTy * width + v.fireTx
    if (vus.has(key)) continue
    vus.add(key)
    feux.push({ tx: v.fireTx, ty: v.fireTy, villageId: v.id })
  }
  return feux
}

/** La marche d'une demi-nuit, À L'ALLURE DU CADRAN : l'éveil au feu, au tick du crépuscule
 *  (C16 du panel — dimensionner sur le tick COURANT de l'aube rendait zéro horde avant
 *  l'acte III). Une horde d'acte I marche lentement : sa couronne est proche. */
function porteeDeNuit(state: SimState, fx: number, fy: number, atDusk: number): number {
  const eveil = eveilCendreuxAt(state, fx + 0.5, fy + 0.5, atDusk)
  const allure = Math.max(eveil, CENDREUX.TORPEUR.GAIT_MIN)
  return Math.round(
    MONSTER_DEFS.cendreux.speed *
      allure *
      60 *
      BALANCE.CYCLE_REAL_MINUTES *
      // LA NUIT EST SAISONNIÈRE (S6) : la marche du soir se dimensionne sur la nuit QU'ON AURA,
      // pas sur une fraction fixe — une horde d'hiver a deux fois plus de nuit pour arriver.
      (1 - BALANCE.PART_DE_JOUR(jourDeSaison(state, atDusk))) *
      WORLD_EVENTS.HORDE_APPROACH_FRACTION,
  )
}

/**
 * ═══ ELLE SE DÉCIDE À L'AUBE, ET ELLE NAÎT DU SOL LE PLUS MORT (décisions ⑫⑬⑱) ═══
 *
 * L'origine s'élit PAR LA DENSITÉ DES MORTS, sur les anneaux de bande de chaque feu allumé —
 * jamais sur la carte entière (le coût, mesuré par le panel : l'échantillonnage global à
 * l'aube pesait des dizaines de ms). Poids = densité³ : « là où la densité CULMINE », pas où
 * elle traîne. La cible est ensuite LE FEU LE PLUS PROCHE de l'origine élue — l'emplacement
 * du camp devient la décision du joueur. UN seul tirage (élection pondérée, somme cumulée).
 *
 * AUCUN champ de flux ici : l'aube ne paie que des lectures O(1) du champ des morts ; le BFS
 * attend le crépuscule, où il n'est payé qu'une fois, comme avant.
 */
export function planifierHorde(
  state: SimState,
  atDusk: number,
  /** Pseudo-tirage [0,1) pour les chemins SANS PRNG (debug_horde) — absent : le PRNG de l'état. */
  tirage?: number,
): Presage | null {
  const feux = feuxAllumes(state)
  if (feux.length === 0) return null // rien à assiéger : la nuit n'a pas de horde
  const { width, height } = state.map
  const cand: { x: number; y: number; poids: number; feu: (typeof feux)[number] }[] = []
  let somme = 0
  for (const feu of feux) {
    // La portée se borne par ce que la CARTE offre (le bug historique : HORDE_MIN_DIST
    // vidait toute carte plus petite que lui) : au plus loin, le coin le plus lointain.
    const coin = Math.max(
      Math.sqrt(feu.tx * feu.tx + feu.ty * feu.ty),
      Math.sqrt((width - feu.tx) * (width - feu.tx) + (height - feu.ty) * (height - feu.ty)),
      Math.sqrt(feu.tx * feu.tx + (height - feu.ty) * (height - feu.ty)),
      Math.sqrt((width - feu.tx) * (width - feu.tx) + feu.ty * feu.ty),
    )
    const portee = Math.min(porteeDeNuit(state, feu.tx, feu.ty, atDusk), Math.floor(coin))
    if (portee <= 0) continue
    const mini = Math.min(WORLD_EVENTS.HORDE_MIN_DIST, Math.floor(portee / 2))
    // Grille adaptative : jamais plus de ~65 pas de large — l'aube reste bon marché.
    const pas = Math.max(8, Math.ceil(portee / 32))
    for (let dy = -portee; dy <= portee; dy += pas) {
      for (let dx = -portee; dx <= portee; dx += pas) {
        const d2 = dx * dx + dy * dy
        if (d2 < mini * mini || d2 > portee * portee) continue
        const x = feu.tx + dx
        const y = feu.ty + dy
        if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue
        const dens = densiteDesMorts(state, x, y)
        const poids = dens * dens * dens // le cube ACCENTUE les pics (jamais `**`, invariant n°2)
        somme += poids
        cand.push({ x, y, poids, feu })
      }
    }
  }
  if (cand.length === 0 || somme <= 0) return null
  let cible = (tirage ?? roll(state)) * somme
  let elu = cand[cand.length - 1]!
  for (const c of cand) {
    cible -= c.poids
    if (cible <= 0) {
      elu = c
      break
    }
  }
  // LA CIBLE EST LE FEU LE PLUS PROCHE DE L'ORIGINE (décision ⑬) — pas forcément celui dont
  // l'anneau a élu le point : deux feux voisins partagent leurs marges.
  let feuCible = elu.feu
  let bestD = Infinity
  for (const feu of feux) {
    const d = distSq(feu.tx + 0.5, feu.ty + 0.5, elu.x + 0.5, elu.y + 0.5)
    if (d < bestD) {
      bestD = d
      feuCible = feu
    }
  }
  const jour = jourDeSaison(state)
  const size = Math.round(seasonRamp(WORLD_EVENTS.HORDE_TAILLE.DEBUT, WORLD_EVENTS.HORDE_TAILLE.FIN, jour))
  const presage: Presage = { at: atDusk, x: elu.x, y: elu.y, fireTx: feuCible.tx, fireTy: feuCible.ty, size }
  if (feuCible.villageId !== undefined) presage.villageId = feuCible.villageId
  return presage
}

/**
 * Fait apparaître une horde en marche vers un FEU — hors de vue, mais SUR UN SOL QUI Y MÈNE.
 *
 * Deux entrées : le CRÉPUSCULE exécute le présage décidé à l'aube (décision ⑱) ; les bancs
 * et le debug appellent sans présage, et on en planifie un pour tout de suite (même chemin,
 * même vérité). Le point de naissance final se prend DANS le champ de flux (le bug historique
 * « elle naissait dans la falaise » reste réparé) : parmi les tuiles à distance de marche
 * [mini..portée] du feu, LA PLUS PROCHE de l'origine élue par la densité — aucun tirage.
 */
export function spawnHorde(state: SimState, size: number, presage?: Presage, tirage?: number): Horde | null {
  let plan = presage ?? planifierHorde(state, state.tick, tirage)
  if (!plan) return null
  if (presage === undefined) plan = { ...plan, size } // les bancs choisissent leur taille
  // Le feu visé a pu mourir depuis l'aube : on re-cible le plus proche encore allumé.
  const feux = feuxAllumes(state)
  if (feux.length === 0) return null
  let cibleOk = feux.find((f) => f.tx === plan!.fireTx && f.ty === plan!.fireTy)
  if (!cibleOk) {
    let bestD = Infinity
    for (const feu of feux) {
      const d = distSq(feu.tx + 0.5, feu.ty + 0.5, plan.x + 0.5, plan.y + 0.5)
      if (d < bestD) {
        bestD = d
        cibleOk = feu
      }
    }
  }
  if (!cibleOk) return null
  // LE PLAFOND GLOBAL CLAMPE LA TAILLE (2026-08-21) : la réserve commune de la pression.
  const place = plafondGlobal(state) - cendreuxSousPression(state)
  const taille = Math.min(plan.size, place)
  if (taille <= 0) return null

  const { width } = state.map
  const champ = computeFlowField(state.map, state.nodes, solidesEternels(state.structures), cibleOk.tx, cibleOk.ty, state)
  let dMax = 0
  for (let i = 0; i < champ.length; i++) if (champ[i]! > dMax) dMax = champ[i]!
  if (dMax === 0) return null // le Feu ne mène nulle part : rien à faire marcher
  const portee = Math.min(porteeDeNuit(state, cibleOk.tx, cibleOk.ty, state.tick), dMax)
  const mini = Math.min(WORLD_EVENTS.HORDE_MIN_DIST, Math.floor(portee / 2))
  // La tuile de naissance : à champ FINI dans la bande, la plus proche de l'origine élue.
  let key = -1
  let best = Infinity
  for (let i = 0; i < champ.length; i++) {
    const d = champ[i]!
    if (d < mini || d > portee) continue
    const ex = i % width
    const ey = Math.floor(i / width)
    const e2 = (ex - plan.x) * (ex - plan.x) + (ey - plan.y) * (ey - plan.y)
    if (e2 < best) {
      best = e2
      key = i
    }
  }
  if (key === -1) return null
  const ex = key % width
  const ey = Math.floor(key / width)

  const horde: Horde = { id: state.nextHordeId, fireTx: cibleOk.tx, fireTy: cibleOk.ty, memberEntityIds: [] }
  if (cibleOk.villageId !== undefined) horde.villageId = cibleOk.villageId
  state.nextHordeId += 1
  for (let i = 0; i < taille; i++) {
    const ox = ex + (i % 3) - 1
    const oy = ey + Math.floor(i / 3) - 1
    let sx = Math.max(1, Math.min(state.map.width - 2, ox))
    let sy = Math.max(1, Math.min(state.map.height - 2, oy))
    // CHAQUE MEMBRE SUR UN SOL QUI MÈNE AU FEU. Le bloc de naissance est un carré aveugle :
    // au bord d'une paroi, une partie de ses cases tombe hors du champ (`-1`) et ces
    // membres-là resteraient plantés toute la nuit — le bug d'origine, en plus petit.
    if (champ[sy * width + sx]! === -1) {
      sx = ex
      sy = ey
    }
    // R1/R2 : la horde est faite de CENDREUX. Un seul mort-vivant, un seul lore.
    horde.memberEntityIds.push(spawnMonster(state, 'cendreux', sx + 0.5, sy + 0.5))
  }
  state.hordes.push(horde)
  // (tx, ty) EST LE POINT DE NAISSANCE, la seule tuile que la sim CHOISIT.
  const ev: SimEvent & { type: 'horde_spawned' } = {
    type: 'horde_spawned',
    tick: state.tick,
    hordeId: horde.id,
    size: taille,
    fireTx: cibleOk.tx,
    fireTy: cibleOk.ty,
    tx: ex,
    ty: ey,
  }
  if (cibleOk.villageId !== undefined) ev.villageId = cibleOk.villageId
  emitEvent(state, ev)
  return horde
}

/** Fait apparaître une carcasse de convoi sur la route, gardée (spec R6). */
export function spawnConvoy(state: SimState): void {
  const roadTiles: number[] = []
  for (let i = 0; i < state.map.terrain.length; i++) {
    if (state.map.terrain[i] === TERRAIN_ROAD) roadTiles.push(i)
  }
  if (roadTiles.length === 0) return
  const key = roadTiles[Math.floor(roll(state) * roadTiles.length)]!
  const tx = key % state.map.width
  const ty = Math.floor(key / state.map.width)
  state.corpses.push({
    id: state.nextCorpseId,
    x: tx + 0.5,
    y: ty + 0.5,
    inventory: inventoryOf(SLOTS.CHEST, CONVOY_LOOT),
    decayAt: state.tick + WORLD_EVENTS.CONVOY_DECAY_TICKS,
    diedAt: state.tick,
  })
  state.nextCorpseId += 1
  // LES GARDES PARTENT AVEC LEUR CARCASSE. Ils appartiennent à l'événement, pas au monde :
  // même horloge que la décantation du butin qu'ils veillent (voir `Monster.expiresAt`).
  const expiresAt = state.tick + WORLD_EVENTS.CONVOY_DECAY_TICKS
  for (let i = 0; i < WORLD_EVENTS.CONVOY_GUARDS; i++) {
    const id = spawnMonster(state, 'cendreux', tx + 0.5 + (i === 0 ? 1 : -1), ty + 1.5)
    const garde = state.monsters.find((m) => m.entityId === id)
    if (garde) garde.expiresAt = expiresAt
  }
  emitEvent(state, { type: 'convoy_spawned', tick: state.tick, tx, ty })
}

/** L'ordonnanceur du monde (spec R8) : appelé chaque tick par step(). */
export function advanceWorldEvents(state: SimState): void {
  // L'HORLOGE DU CYCLE, cycleOffset compris (le patron de gel.ts — constat C16b du panel :
  // le tick brut mentait dès qu'une partie ne commençait pas à l'aube).
  const cycleTick = (state.tick + state.cycleOffset) % TICKS_PER_CYCLE
  const jour = jourDeSaison(state)

  // ═══ L'AUBE (décisions ⑮ et ⑱, 2026-08-21) ═══
  if (cycleTick === 0 && state.tick > 0) {
    // 1) LA CHALEUR LES FIGE — l'aube n'efface plus rien. Les membres survivants deviennent
    //    des RELIQUES : le jour chaud les endort (le cadran de température fait tout le
    //    travail), le joueur nettoie au matin ce qui reste devant sa palissade, et le
    //    balayage `expiresAt` reprend hors regard ce que personne ne vient chercher. AUCUNE
    //    bête ne s'évapore sous les yeux — la règle que ce fichier appliquait déjà aux
    //    gardes de convoi, enfin appliquée à la horde elle-même (c'était le défaut).
    if (state.hordes.length > 0) {
      for (const horde of state.hordes) {
        for (const id of horde.memberEntityIds) {
          const m = state.monsters.find((x) => x.entityId === id)
          if (m) {
            m.expiresAt = state.tick
            m.hordeRelic = true
          }
        }
        emitEvent(state, { type: 'horde_dispersed', tick: state.tick, hordeId: horde.id })
      }
      state.hordes = []
    }
    // 2) LE PRÉSAGE DE LA VEILLE (décision ⑱) — la horde de CE SOIR se décide MAINTENANT.
    //    Cadence en PENTE CONTINUE (décision ⑭) : le tirage a lieu chaque aube, qu'il y ait
    //    des feux ou non — le nombre de pas de PRNG par jour ne dépend pas de l'état du monde.
    const presage =
      roll(state) < seasonRamp(WORLD_EVENTS.HORDE_CHANCE.DEBUT, WORLD_EVENTS.HORDE_CHANCE.FIN, jour)
        ? planifierHorde(state, state.tick + dayTicksAt(state, state.tick))
        : null
    if (presage) {
      state.presage = presage
      emitEvent(state, { type: 'presage_horde', tick: state.tick, x: presage.x, y: presage.y })
      // LA FAUNE DÉSERTE L'ORIGINE — le signe qui se lit sans bandeau : une passe
      // d'effarouchement, le mécanisme de fuite existant, aucun tirage.
      for (const m of state.monsters) {
        if (!isPrey(m.type)) continue
        const e = state.entities.find((en) => en.id === m.entityId)
        if (!e || e.hp <= 0) continue
        if (distSq(e.x, e.y, presage.x + 0.5, presage.y + 0.5) > WORLD_EVENTS.PRESAGE_FUITE_RAYON * WORLD_EVENTS.PRESAGE_FUITE_RAYON) continue
        m.fleeing = true
        m.fleeSince = state.tick
        m.fleeFromX = presage.x + 0.5
        m.fleeFromY = presage.y + 0.5
      }
    }
  }

  // ═══ LE CRÉPUSCULE : l'exécution du présage ═══
  if (estCrepuscule(state, state.tick) && state.presage !== null) {
    spawnHorde(state, state.presage.size, state.presage)
    state.presage = null
  }

  // CE QUE LE MONDE REPREND. Une bête d'événement dont l'heure est passée s'en va — mais
  // jamais sous les yeux de quelqu'un : on attend qu'on ne la regarde plus, exactement comme
  // `advanceDens` attend pour en faire NAÎTRE une. Sans ce balayage, les gardes de convoi
  // s'empilaient sans fin (mesuré : 5 → 75 Cendreux sur une saison, par ce seul canal).
  if (state.monsters.some((m) => m.expiresAt !== undefined && state.tick >= m.expiresAt)) {
    const monsterIds = new Set(state.monsters.map((m) => m.entityId))
    // LES TÉMOINS SONT LES AVATARS RÉELS, pas les PNJ (constat C6/C31 du panel) : « jamais
    // sous les yeux » protège le JOUEUR du décor qui avoue — un villageois posté près des
    // reliques de la nuit ne doit pas les rendre éternelles (elles s'accumulaient au pied
    // des villages PNJ et mangeaient le plafond global).
    const npcIds = new Set(state.npcs.map((n) => n.entityId))
    const avatars = state.entities.filter((e) => !monsterIds.has(e.id) && !npcIds.has(e.id) && e.hp > 0)
    const clearance = FAUNA.DEN_SPAWN_CLEARANCE * FAUNA.DEN_SPAWN_CLEARANCE
    const partis = new Set<number>()
    for (const m of state.monsters) {
      if (m.expiresAt === undefined || state.tick < m.expiresAt) continue
      const e = state.entities.find((en) => en.id === m.entityId)
      if (!e) continue
      if (avatars.some((a) => distSq(a.x, a.y, e.x, e.y) <= clearance)) continue // on la regarde
      partis.add(m.entityId)
    }
    if (partis.size > 0) {
      state.monsters = state.monsters.filter((m) => !partis.has(m.entityId))
      state.entities = state.entities.filter((e) => !partis.has(e.id))
    }
  }

  // La carcasse de convoi, tous les N jours de saison (spec R6).
  const day = jourDeSaison(state)
  if (
    day !== state.lastConvoyDay &&
    day % WORLD_EVENTS.CONVOY_PERIOD_DAYS === 0 &&
    state.map.terrain.includes(TERRAIN_ROAD)
  ) {
    state.lastConvoyDay = day
    spawnConvoy(state)
  }

  // L'alarme (spec R4) : une par vague et par village — monstres ET raiders.
  for (const village of state.villages) {
    if (state.tick < village.lastAlarmAt + WORLD_EVENTS.ALARM_COOLDOWN_TICKS) continue
    const radius = COMBAT.DEFEND_RADIUS
    const threatened = state.entities.some((e) => {
      if (!isThreatTo(state, e.id, village)) return false
      const dx = e.x - (village.fireTx + 0.5)
      const dy = e.y - (village.fireTy + 0.5)
      return dx * dx + dy * dy <= radius * radius
    })
    if (threatened) {
      village.lastAlarmAt = state.tick
      emitEvent(state, { type: 'alarm_raised', tick: state.tick, villageId: village.id })
    }
  }

  // Nettoyage des hordes vidées par la milice.
  state.hordes = state.hordes.filter((h) =>
    h.memberEntityIds.some((id) => state.entities.some((e) => e.id === id)),
  )

  // LA FIN DE SAISON, SI ELLE EXISTE (saison-sans-fin T4) : `null` = jamais — le solo. Alors
  // ni évacuation, ni Arche, ni verdict : la saison ne finit pas, elle tourne (R4). Un seul
  // test, lu une fois ; une vieille sauvegarde sans le champ vaut « jamais ».
  const fin = state.finDeSaison ?? null
  if (fin === null) return
  // L'ÉVACUATION SE COMPTE DEPUIS LA FIN, PAS DEPUIS UN JOUR ABSOLU (S2) : `EVAC_DAY` était
  // le jour 55 d'une saison qui finissait au 60 — cinq jours avant la fin. Un monde né au
  // jour 61 (le vrai jeu) ouvrait sinon son évacuation à son quatrième cycle.
  const jourEvac = fin - (BALANCE.SEASON_DAYS - SEASON.EVAC_DAY)

  // L'évacuation s'ouvre (spec saison R3) — une fois par saison : partie, l'Arche ne
  // revient pas (`arkDeparted`), sinon ce bloc rouvrait l'évacuation au tick suivant
  // le départ et la boucle ouvre→part inondait le flux (mesuré au banc de saison).
  if (state.evacuation === null && !state.arkDeparted && day >= jourEvac) {
    const roadTiles: number[] = []
    for (let i = 0; i < state.map.terrain.length; i++) {
      if (state.map.terrain[i] === TERRAIN_ROAD) roadTiles.push(i)
    }
    const key = roadTiles.length > 0 ? roadTiles[Math.floor(roll(state) * roadTiles.length)]! : 0
    const tx = roadTiles.length > 0 ? key % state.map.width : Math.floor(state.map.width / 2)
    const ty = roadTiles.length > 0 ? Math.floor(key / state.map.width) : Math.floor(state.map.height / 2)
    state.evacuation = { tx, ty }
    emitEvent(state, { type: 'evacuation_opened', tick: state.tick, tx, ty })
  }

  // L'ARCHE LÈVE L'ANCRE (V2-24) : l'évacuation n'est plus un marqueur passif — elle a une
  // HEURE. Au jour EVAC_DAY + EVAC_DEPART_DAYS, qui est À BORD (dans le rayon) part sauvé ;
  // le reste est laissé. C'est le « tenir jusqu'au départ » que le GDD promet, et le verdict
  // Foyer ne compte plus que les EMBARQUÉS, pas ceux qui traînent à proximité à la fin.
  if (state.evacuation !== null && day >= jourEvac + SEASON.EVAC_DEPART_DAYS) {
    const evac = state.evacuation
    for (const e of state.entities) {
      if (e.hp <= 0) continue
      const dx = e.x - (evac.tx + 0.5)
      const dy = e.y - (evac.ty + 0.5)
      if (dx * dx + dy * dy <= SEASON.EVAC_RADIUS * SEASON.EVAC_RADIUS) state.evacuatedIds.push(e.id)
    }
    emitEvent(state, { type: 'ark_departed', tick: state.tick, tx: evac.tx, ty: evac.ty, saved: state.evacuatedIds.length })
    state.evacuation = null // partie : le marqueur disparaît
    state.arkDeparted = true // et elle ne repart pas — le verrou de la réouverture
  }

  // La fin de saison : les verdicts (spec saison R4) — au jour réglé, plus à une constante.
  if (!state.seasonEnded && day > fin) {
    state.seasonEnded = true
    emitEvent(state, { type: 'season_ended', tick: state.tick, verdicts: computeVerdicts(state) })
  }
}

/** Le verdict de chaque village selon son archétype (GDD §2). */
function computeVerdicts(state: SimState): {
  villageId: number
  name: string
  archetype: 'foyer' | 'meute' | 'neutre'
  score: number
  outcome: string
}[] {
  return state.villages.map((village) => {
    const members = state.entities.filter((e) => village.memberIds.includes(e.id) && e.hp > 0)
    // L'ARCHE (V2-24) : seuls les EMBARQUÉS comptent (recensés au départ), pas la proximité
    // passive à la fin — « sauver des vies » exige de les avoir mises à bord à temps.
    const evacuated = members.filter((m) => state.evacuatedIds.includes(m.id)).length
    const lootValue = (inv: Record<string, number | undefined>): number => {
      let total = 0
      for (const item of Object.keys(inv)) {
        total += (inv[item] ?? 0) * ((LOOT_VALUES as Record<string, number>)[item] ?? 1)
      }
      return total
    }
    let granaryValue = 0
    for (const s of state.structures) {
      if (s.villageId === village.id && s.inventory) granaryValue += lootValue(toBag(s.inventory))
    }
    for (const m of members) granaryValue += lootValue(toBag(m.inventory))

    if (village.archetype === 'foyer') {
      const score = members.length + evacuated
      return {
        villageId: village.id,
        name: village.name,
        archetype: village.archetype,
        score,
        outcome: `a sauvé ${members.length} vie${members.length > 1 ? 's' : ''}${evacuated > 0 ? ` dont ${evacuated} évacuée${evacuated > 1 ? 's' : ''}` : ''}`,
      }
    }
    if (village.archetype === 'meute') {
      return {
        villageId: village.id,
        name: village.name,
        archetype: village.archetype,
        score: granaryValue,
        // Formulation INVARIANTE en genre (bible T5) : « le Clan du Levant est partie » était
        // la faute — « a quitté la vallée » s'accorde tout seul, pour « le Clan » comme pour
        // « la Meute ».
        outcome: `a quitté la vallée les bras pleins (valeur ${granaryValue})`,
      }
    }
    return {
      villageId: village.id,
      name: village.name,
      archetype: village.archetype,
      score: members.length,
      outcome: members.length > 0 ? `a tenu jusqu'à la Cendre (${members.length} debout)` : 's’est éteint',
    }
  })
}
