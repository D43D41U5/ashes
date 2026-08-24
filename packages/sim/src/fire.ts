/**
 * LE FEU COMME STATION (spec `docs/specs/feu-station.md`) — l'état du feu LIBRE
 * (allumé / braises / éteint), la combustion et la cuisson au tick. Pur et déterministe :
 * aucun tirage, le temps est le numéro de tick.
 *
 * SLOTS-CONTENEURS : combustible, ENTRÉES et SORTIES sont de VRAIES cases d'inventaire
 * (dépôt/retrait/déplacement libres, via l'action `transfer` avec une `zone`). La SEULE
 * limite : l'unité EN COURS de consommation est VERROUILLÉE — la bûche qui brûle (`burnSlot`),
 * l'aliment qui cuit (`cookRemaining`). Une pile se déplace de `count − verrou` (`fireSlotLocked`).
 * L'upkeep du FOYER (village.fuel) reste dans `village.ts` — migration différée (S16) ; il n'a donc
 * PAS de zone combustible (`fireZoneInventory` rend `undefined`), mais garde entrées/sorties.
 */
import { CENDREUX, COOK_SLOT, DRY_SLOT, FIRE } from './balance'
import { emitEvent } from './events'
import { distSq } from './geometry'
import { addItems, countOf, makeInventory, type Inventory, type ItemId } from './items'
import { meteoFeuConso } from './meteo'
import type { Monster } from './monsters'
import type { SimState } from './sim'
import type { Structure } from './village'

export type FireState = 'lit' | 'ember' | 'out'

/** Les trois zones-conteneurs d'un feu (spec feu-station). */
export type FireZone = 'fuel' | 'cookIn' | 'cookOut'

/** Index de la PREMIÈRE case de `fuel` qui contient encore du bois, -1 si le slot est vide. */
function firstFuelSlot(fuel: Inventory): number {
  return fuel.findIndex((slot) => slot !== null && slot.item === 'wood' && slot.count > 0)
}

/**
 * L'état d'un feu, à partir du seul TICK (et non d'un `SimState` complet) — pour que le CLIENT
 * puisse le dériver du snapshot (il a le tick + la structure), source unique avec la sim.
 */
export function fireStateAt(tick: number, s: Structure): FireState {
  if (s.type !== 'fire') return 'out'
  if (s.villageId !== 0) return 'lit' // Foyer : inchangé tant que l'upkeep n'est pas migré (S16)
  // Feu libre SANS slot combustible = hors modèle (feu forgé à la main dans un test, ou d'avant
  // cette feature) : il vaut ALLUMÉ. En prod, tout feu libre naît avec du bois (addStructure).
  if (s.fuel === undefined) return 'lit'
  if (countOf(s.fuel, 'wood') > 0) return 'lit' // il reste des bûches à brûler
  if (s.emberUntil !== undefined && tick < s.emberUntil) return 'ember'
  return 'out'
}

export function fireState(state: SimState, s: Structure): FireState {
  return fireStateAt(state.tick, s)
}

/** Le feu chauffe-t-il / garde-t-il encore ? (allumé OU braises — la garde tient jusqu'aux braises, S4). */
export function fireActive(state: SimState, s: Structure): boolean {
  const st = fireState(state, s)
  return st === 'lit' || st === 'ember'
}

/** Facteur de chaleur selon l'état (S3) : plein allumé, atténué en braises, nul éteint. */
export function fireWarmthFactor(state: SimState, s: Structure): number {
  const st = fireState(state, s)
  if (st === 'lit') return 1
  if (st === 'ember') return FIRE.EMBER_WARMTH_FACTOR
  return 0
}

/** Ticks restants avant extinction — le TEMPS que le combustible fait tenir le feu (affiché au modal). */
export function fuelTicksRemaining(tick: number, s: Structure): number {
  const wood = s.fuel ? countOf(s.fuel, 'wood') : 0
  if (wood <= 0 || s.burnAt === undefined) return 0
  return Math.max(0, wood * FIRE.BURN_TICKS - (tick - s.burnAt))
}

/** Progression de la CONSOMMATION de la bûche EN COURS (0..1) — l'indicateur du slot combustible. */
export function fuelBurnProgress(tick: number, s: Structure): number {
  if (s.burnAt === undefined) return 0
  return Math.max(0, Math.min(1, (tick - s.burnAt) / FIRE.BURN_TICKS))
}

/**
 * LES CENDREUX VIVANTS ET LEUR POSITION — relevés UNE fois par tick pour toutes les bouches
 * (les feux libres ici, le Foyer dans `advanceUpkeep`). Rendus vides sans un seul cendreux :
 * un monde sans morts ne paie pas un octet de ce chantier.
 */
const BUVEURS_DU_TICK = new WeakMap<SimState, { tick: number; liste: { m: Monster; x: number; y: number }[] }>()

export function cendreuxVivantsPositions(state: SimState): { m: Monster; x: number; y: number }[] {
  // MÉMO DU TICK (pur : même état, même tick → même liste) — `advanceFire` et
  // `advanceUpkeep` la demandent tous les deux, chaque tick ; l'index d'entités ne se
  // construit qu'une fois. MESURÉ au profil : le chantier 2026-08-21 coûtait +14 % de tick
  // sur le banc, et ce doublon en était la part la plus bête.
  const memo = BUVEURS_DU_TICK.get(state)
  if (memo && memo.tick === state.tick) return memo.liste
  const out: { m: Monster; x: number; y: number }[] = []
  if (state.monsters.some((m) => m.type === 'cendreux')) {
    const byId = new Map<number, { x: number; y: number; hp: number }>()
    for (const e of state.entities) byId.set(e.id, e)
    for (const m of state.monsters) {
      if (m.type !== 'cendreux') continue
      const e = byId.get(m.entityId)
      if (e && e.hp > 0) out.push({ m, x: e.x, y: e.y })
    }
  }
  BUVEURS_DU_TICK.set(state, { tick: state.tick, liste: out })
  return out
}

/**
 * La combustion au tick (spec S2) : chaque feu LIBRE brûle la bûche de sa case `burnSlot` ; à
 * échéance, il la consomme et allume la suivante (première case pleine). À court de bois, les
 * flammes meurent — braises (`emberUntil`) puis extinction (`fire_extinguished`). Le Foyer n'est
 * PAS concerné (S16). `burnSlot` ANCRE le verrou : la case qui brûle ne bouge pas tant que sa
 * bûche n'est pas consumée — déposer ailleurs ne détourne pas la flamme.
 */
export function advanceFire(state: SimState): void {
  // ═══ ILS BOIVENT LA CHALEUR (décision d'Alexis ⑯, 2026-08-21) ═══
  //
  // Un cendreux au CONTACT d'un feu EN FLAMMES en consomme le bois : l'ancre `burnAt`
  // recule de `BOIRE.CONSO` ticks par tick et par buveur — le patron exact de la pluie
  // (`meteoFeuConso`), donc l'état, le budget affiché et l'indicateur client voient tous la
  // même faim, sans un octet de plus. LES BRAISES NE SE BOIVENT PAS : ce bloc ne court que
  // tant qu'il reste du bois — un feu bu tombe en braises et y reste le temps des braises,
  // le ward tient (le plancher de la décision ⑯ : le feu achète, il ne trahit jamais tout).
  // Et boire RASSASIE (⑰) : la chaleur bue endort son buveur — le feu abandonné est un leurre.
  let buveurs: { m: Monster; x: number; y: number }[] | null = null
  const lesBuveurs = (): { m: Monster; x: number; y: number }[] => (buveurs ??= cendreuxVivantsPositions(state))
  const contact2 = CENDREUX.BOIRE.CONTACT * CENDREUX.BOIRE.CONTACT

  for (const s of state.structures) {
    if (s.type !== 'fire') continue
    if (s.villageId === 0 && s.fuel && countOf(s.fuel, 'wood') > 0) {
      // Sécurité : du bois attend mais rien n'est ancré (feu forgé à la main, ou bûche déplacée hors
      // de la case qui brûlait). On (r)ancre sur la première case pleine et on rallume.
      if (s.burnAt === undefined || s.burnSlot === undefined || (s.fuel[s.burnSlot]?.count ?? 0) <= 0) {
        s.burnAt = state.tick
        s.burnSlot = firstFuelSlot(s.fuel)
      }
      // R5 MÉTÉO — la pluie ACCÉLÈRE la faim du feu, jamais ne l'éteint : sous empreinte
      // mouillée, la bûche en cours vieillit de `meteoFeuConso` par tick au lieu de 1. On
      // recule l'ANCRE plutôt que de compter à part : tout ce qui se dérive de `burnAt`
      // (état, budget `fuelTicksRemaining`, indicateur de slot) voit la même accélération,
      // client compris. Évalué au point du FEU (s.tx, s.ty), pas de l'observateur ; vaut
      // exactement 1 hors front mouillé — à sec ou sous brouillard, pas UN octet ne bouge.
      const conso = meteoFeuConso(state, s.tx, s.ty)
      if (conso > 1) s.burnAt -= conso - 1
      // La soif des buveurs — même mécanique d'ancre que la pluie, juste au-dessus.
      let soif = 0
      for (const b of lesBuveurs()) {
        if (distSq(b.x, b.y, s.tx + 0.5, s.ty + 0.5) > contact2) continue
        soif += CENDREUX.BOIRE.CONSO
        b.m.satiete = Math.min(CENDREUX.BOIRE.SATIETE_MAX, (b.m.satiete ?? 0) + CENDREUX.BOIRE.SATIETE_FEU_PAR_TICK)
      }
      if (soif > 0) s.burnAt -= soif
      if (state.tick >= s.burnAt + FIRE.BURN_TICKS) {
        const burning = s.fuel[s.burnSlot] // la bûche EN COURS est entièrement consommée
        if (burning) {
          burning.count -= 1
          if (burning.count <= 0) s.fuel[s.burnSlot] = null
        }
        const next = firstFuelSlot(s.fuel)
        if (next >= 0) {
          s.burnAt = state.tick // la suivante s'allume
          s.burnSlot = next
        } else {
          delete s.burnAt
          delete s.burnSlot
          s.emberUntil = state.tick + FIRE.EMBER_TICKS
          emitEvent(state, { type: 'fire_extinguished', tick: state.tick, structureId: s.id })
        }
      }
    }
    // Cuisson passive (S7-S9) — sur TOUT feu (libre ou Foyer), le travail de la STATION.
    advanceCook(state, s)
  }
  // ═══ LES POSTES QUI TRAVAILLENT SANS FLAMME (spec `peche.md` S2/S4, 2026-08-24) ═══
  //
  // Le SÉCHOIR sèche sans combustible et sans surveillance — donc sans `fireState`. Le FOUR,
  // lui, cuit maintenant aussi (S5). Un seul balayage de plus, la même `advanceCook` : deux
  // boucles qui feraient la même chose finiraient par diverger sur le verrou ou les sorties.
  for (const s of state.structures) {
    if (s.type !== 'sechoir' && s.type !== 'furnace') continue
    advanceCook(state, s)
  }
}

/**
 * Une étape de cuisson (spec S7-S9) : chaque ENTRÉE cuit sa pile UNE unité à la fois. Le compteur
 * de l'unité en cours (`cookRemaining`, parallèle à `cookIn`) descend tant que le feu est ALLUMÉ
 * (exige la flamme — ni braises ni éteint : il se FIGE alors, la cuisson reprend au rallumage).
 * À échéance, le résultat (+ sous-produits) part vers les SORTIES (empilé, `addItems`), l'unité
 * quitte l'entrée et la SUIVANTE s'engage ; si les sorties sont pleines, l'unité reste PRÊTE
 * (compteur à 0) et réessaie (rien ne se perd). Passif, sans le joueur — le travail de la station.
 */
function advanceCook(state: SimState, s: Structure): void {
  if (!s.cookIn) return
  // LE FEU, LUI, EXIGE LA FLAMME (S8) : en braises ou éteint, la cuisson se FIGE et reprend au
  // rallumage. Les postes sans flamme (séchoir, four) n'ont rien à figer — le séchoir sèche
  // même sous la pluie (D13), et c'est une décision, pas un oubli.
  if (s.type === 'fire' && fireState(state, s) !== 'lit') return
  if (!s.cookRemaining) s.cookRemaining = s.cookIn.map(() => null)
  for (let i = 0; i < s.cookIn.length; i++) {
    const slot = s.cookIn[i]
    if (!slot) {
      s.cookRemaining[i] = null // rien dans la case → rien d'engagé
      continue
    }
    const rule = recettesDuPoste(s.type)?.[slot.item]
    if (!rule) continue // aliment non cuisinable ici (ne devrait pas arriver via le filtre) : on le LAISSE
    // Engager l'unité en tête si aucune ne l'est, sinon descendre son compteur.
    let rem = s.cookRemaining[i]
    if (rem === null || rem === undefined) rem = rule.ticks
    if (rem > 0) rem -= 1
    s.cookRemaining[i] = rem
    if (rem > 0) continue
    // Unité cuite : verser le résultat en SORTIE (best-effort). Sorties pleines → on reste à 0, on attend.
    if (!s.cookOut) s.cookOut = makeInventory(FIRE.COOK_OUTPUTS)
    const leftover = addItems(s.cookOut, { [rule.output]: 1 })
    if ((leftover[rule.output] ?? 0) > 0) continue
    for (const bp of rule.byproducts ?? []) addItems(s.cookOut, { [bp.item]: bp.count }) // best-effort
    emitEvent(state, { type: 'meat_cooked', tick: state.tick, structureId: s.id, item: rule.output })
    slot.count -= 1
    if (slot.count <= 0) {
      s.cookIn[i] = null
      s.cookRemaining[i] = null
    } else {
      s.cookRemaining[i] = rule.ticks // l'unité suivante s'engage
    }
  }
}

/**
 * L'inventaire d'une zone-conteneur du feu (créé à la volée pour ENTRÉES/SORTIES et le combustible
 * d'un feu libre). `undefined` = zone absente ici : le combustible n'existe QUE sur un feu libre —
 * le Foyer tient sur `village.fuel` (migration S16), donc glisser dans SON combustible n'a pas lieu.
 */
export function fireZoneInventory(s: Structure, zone: FireZone): Inventory | undefined {
  // ⚠ TROIS POSTES DEPUIS LE 2026-08-24, plus un seul : le feu, le four et le séchoir. Les
  // deux nouveaux n'ont PAS de zone combustible — le four tient sur le bois du village, le
  // séchoir ne brûle rien. La garde d'entrée est donc « ce poste a-t-il des recettes ? ».
  if (recettesDuPoste(s.type) === undefined) return undefined
  if (zone === 'fuel') {
    if (s.type !== 'fire') return undefined
    if (s.villageId !== 0) return undefined // Foyer : pas de zone combustible (S16)
    if (!s.fuel) s.fuel = makeInventory(FIRE.FUEL_SLOTS)
    return s.fuel
  }
  if (zone === 'cookIn') {
    if (!s.cookIn) s.cookIn = makeInventory(FIRE.COOK_INPUTS)
    return s.cookIn
  }
  if (!s.cookOut) s.cookOut = makeInventory(FIRE.COOK_OUTPUTS)
  return s.cookOut
}

/**
 * Cette zone accepte-t-elle cet item ? (cases SPÉCIALISÉES) — combustible : du bois ; ENTRÉES : ce
 * qui se cuit ici (`COOK_SLOT`) ; SORTIES : les produits cuits de ce feu (résultats + sous-produits).
 */
export function fireZoneAccepts(s: Structure, zone: FireZone, item: ItemId): boolean {
  if (zone === 'fuel') return s.type === 'fire' && item === 'wood'
  if (zone === 'cookIn') return recettesDuPoste(s.type)?.[item] !== undefined
  const rules = recettesDuPoste(s.type)
  if (!rules) return false
  for (const rule of Object.values(rules)) {
    if (rule.output === item) return true
    for (const bp of rule.byproducts ?? []) if (bp.item === item) return true
  }
  return false
}

/**
 * LES RECETTES D'UN POSTE — la cuisson (`COOK_SLOT`) ou le séchage (`DRY_SLOT`), jamais les
 * deux : un poste transforme d'UNE façon. L'écrivain unique de cette question, pour que le
 * verrou de consommation, le filtre des cases et l'avancement lisent tous la même table.
 */
export function recettesDuPoste(
  type: Structure['type'],
): Partial<Record<ItemId, { output: ItemId; byproducts?: { item: ItemId; count: number }[]; ticks: number }>> | undefined {
  return COOK_SLOT[type] ?? DRY_SLOT[type]
}

/**
 * Combien d'unités de cette case sont EN COURS de consommation — donc VERROUILLÉES, insaisissables.
 * 0 partout, sauf : la case combustible qui brûle (`burnSlot`) et l'ENTRÉE dont une unité cuit
 * (`cookRemaining`). Une pile se déplace de `count − ce nombre` (spec feu-station, verrou de conso).
 */
export function fireSlotLocked(s: Structure, zone: FireZone, slot: number): number {
  if (zone === 'fuel') return s.villageId === 0 && s.burnAt !== undefined && slot === s.burnSlot ? 1 : 0
  if (zone === 'cookIn') return s.cookRemaining?.[slot] != null ? 1 : 0
  return 0
}
