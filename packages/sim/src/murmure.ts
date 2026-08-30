/**
 * ═══ LES MURMURES (spec `cendre.md` R27, chantier ③ des dix — 2026-08-30) ═══
 *
 * La vieille cendre est pleine de morts (`densiteDesMorts`) — la nuit, ils se REJOUENT. Un
 * murmure est une apparition non hostile qui se DONNE à qui vient doucement : une phrase à la
 * chronique de veillée, l'événement `murmure_recueilli` pour tout autre consommateur.
 *
 * TOUT SE DÉRIVE, RIEN NE SE STOCKE (le patron du semis des fumerolles) : par nuit et par
 * maille, `hash2(cycle, maille)` élit le site — même seed ⇒ mêmes murmures, et PAS UN tirage
 * du PRNG d'état n'est consommé (la landmine du décompte d'entités ne peut pas mordre). Le
 * seul état est `entity.murmure` : le dernier site recueilli, un nombre.
 *
 * Le réglage vit ICI, à côté de sa loi (le patron `FUMEROLLE`) : la maille et la part se
 * calibrent en regardant une carte, le rayon et le calme en jouant — mais séparer les deux
 * ferait deux maisons pour cinq nombres.
 */
import { avanceesDepuisAges, BANDE_VIEILLE, bandeDeCendre } from './cendre'
import type { EtatDeCendre } from './coulee'
import { emitEvent } from './events'
import { addItems } from './items'
import { stimulusPourLesMorts } from './faune'
import { densiteDesMorts } from './morts'
import { hash2 } from './noise'
import type { SimState } from './sim'
import { getGameTime, TICKS_PER_CYCLE } from './time'

export const MURMURE = {
  /** La maille du semis, en tuiles — un site possible par maille et par nuit. */
  MAILLE: 24,
  /** La part des mailles qui murmurent une nuit donnée. */
  PART: 0.3,
  /** Le plancher de `densiteDesMorts` du site : les morts font le murmure — les PICS, pas
   *  la vieille cendre entière (elle plafonne à ~0,82, les charniers saturent à 1). */
  SEUIL_MORTS: 0.85,
  /** À combien de tuiles le murmure se donne — et à combien un Cendreux le rend muet. */
  RAYON_DON: 3,
  /** Le plafond de `stimulusPourLesMorts` du visiteur : la marche calme passe (≤ ~1), le
   *  sprint jamais (≥ 1,4) — la même lecture que la chasse et la traque, entrée UNE fois. */
  SEUIL_CALME: 1.2,
} as const

const SEL_MURMURE = 0x4d55524d // 'MURM'

/** Ce que le semis LIT (le périmètre de `densiteDesMorts`) — `SimState` le satisfait tel
 *  quel ; le rendu passe son tick et `lieuxBrules: []` (voir `EtatDesMorts`). */
export type EtatDeMurmure = EtatDeCendre & { tick: number; lieuxBrules: readonly { zone: number; until: number }[] }

/** Le site d'une maille CETTE nuit — `null` si la maille ne murmure pas (part, bande, morts). */
function siteDeLaMaille(
  state: EtatDeMurmure,
  mx: number,
  my: number,
  cycle: number,
  avancees: readonly number[],
): { tx: number; ty: number; id: number } | null {
  const { width, height } = state.map
  const mailles = Math.ceil(width / MURMURE.MAILLE)
  const maille = my * mailles + mx
  if (hash2(maille, cycle, state.seed ^ SEL_MURMURE) >= MURMURE.PART) return null
  // La position DANS la maille — deux hachages de plus, jamais le PRNG d'état.
  const tx = mx * MURMURE.MAILLE + Math.floor(hash2(maille, cycle, state.seed ^ 0x504f5331) * MURMURE.MAILLE)
  const ty = my * MURMURE.MAILLE + Math.floor(hash2(maille, cycle, state.seed ^ 0x504f5332) * MURMURE.MAILLE)
  if (tx >= width || ty >= height) return null
  // Les portes du LIEU : la bande VIEILLE, et les morts au-dessus du seuil.
  if (bandeDeCendre(state.map, tx, ty, avancees, state.seed) !== BANDE_VIEILLE) return null
  if (densiteDesMorts(state, tx, ty) < MURMURE.SEUIL_MORTS) return null
  return { tx, ty, id: cycle * 0x100000 + maille }
}

/**
 * TOUS LES SITES DE CETTE NUIT — l'énumérateur que le rendu fantôme (R27d) et le banc
 * partagent : balayer les mailles est bon marché (la part écarte avant de payer bande et
 * morts), et c'est la MÊME loi que la passe du tick, jamais une recopie.
 */
export function sitesDeLaNuit(state: SimState): { tx: number; ty: number; id: number }[] {
  if (!getGameTime(state).isNight) return []
  return sitesDeCycle(state, Math.floor(state.tick / TICKS_PER_CYCLE))
}

/**
 * LES SITES D'UN CYCLE, sans la porte de nuit — la forme que le RENDU consomme (R27d) : le
 * client tient `{ map, cendreAge, seed }` et son propre `isNight` ; il pose la même question
 * que la sim, jamais une recopie. `densiteDesMorts` ne lit que la carte et l'âge : le
 * périmètre d'`EtatDeCendre` suffit.
 */
export function sitesDeCycle(etat: EtatDeMurmure, cycle: number): { tx: number; ty: number; id: number }[] {
  const out: { tx: number; ty: number; id: number }[] = []
  if (!etat.map.cendreCout || etat.cendreAge.length === 0) return out
  const avancees = avanceesDepuisAges(etat.cendreAge, etat.cendreAge.length)
  const mx1 = Math.ceil(etat.map.width / MURMURE.MAILLE)
  const my1 = Math.ceil(etat.map.height / MURMURE.MAILLE)
  for (let my = 0; my < my1; my++) {
    for (let mx = 0; mx < mx1; mx++) {
      const site = siteDeLaMaille(etat, mx, my, cycle, avancees)
      if (site) out.push(site)
    }
  }
  return out
}

/** Un Cendreux à portée rend le site MUET — courir vers un murmure amène ce qui le dissipe.
 *  (Le corps d'un monstre est une ENTITÉ ; `Monster` ne porte que son esprit. Le `find` par
 *  cendreux est payé seulement quand un visiteur est déjà à portée d'un site — rare.) */
function cendreuxPres(state: SimState, tx: number, ty: number): boolean {
  const r2 = MURMURE.RAYON_DON * MURMURE.RAYON_DON
  for (const m of state.monsters) {
    if (m.type !== 'cendreux') continue
    const corps = state.entities.find((x) => x.id === m.entityId)
    if (!corps) continue
    const dx = corps.x - (tx + 0.5)
    const dy = corps.y - (ty + 0.5)
    if (dx * dx + dy * dy <= r2) return true
  }
  return false
}

/**
 * LA PASSE DU TICK (R27b) — pour chaque visiteur, le site de sa maille et des voisines qui
 * chevauchent son rayon ; s'il est à portée, calme, sans Cendreux, et que ce site ne lui a
 * pas déjà parlé : `murmure_recueilli`. La nuit seulement — de jour il n'existe RIEN.
 */
export function advanceMurmures(state: SimState): void {
  if (!state.map.cendreCout || state.cendreAge.length === 0) return
  if (!getGameTime(state).isNight) return
  const cycle = Math.floor(state.tick / TICKS_PER_CYCLE)
  const avancees = avanceesDepuisAges(state.cendreAge, state.cendreAge.length)
  const r2 = MURMURE.RAYON_DON * MURMURE.RAYON_DON
  // Le corps d'un monstre est une entité — mais un murmure se donne aux VIVANTS qui écoutent,
  // jamais à un Cendreux qui passe (le patron du filtre de `advanceTemperature`).
  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  for (const e of state.entities) {
    if (monsterIds.has(e.id)) continue
    // Les mailles que le rayon du visiteur peut chevaucher (RAYON_DON < MAILLE : ±1 suffit).
    const mx0 = Math.floor((e.x - MURMURE.RAYON_DON) / MURMURE.MAILLE)
    const my0 = Math.floor((e.y - MURMURE.RAYON_DON) / MURMURE.MAILLE)
    const mx1 = Math.floor((e.x + MURMURE.RAYON_DON) / MURMURE.MAILLE)
    const my1 = Math.floor((e.y + MURMURE.RAYON_DON) / MURMURE.MAILLE)
    for (let my = Math.max(0, my0); my <= my1; my++) {
      for (let mx = Math.max(0, mx0); mx <= mx1; mx++) {
        const site = siteDeLaMaille(state, mx, my, cycle, avancees)
        if (!site || e.murmure === site.id) continue
        const dx = e.x - (site.tx + 0.5)
        const dy = e.y - (site.ty + 0.5)
        if (dx * dx + dy * dy > r2) continue
        if (stimulusPourLesMorts(state, e) > MURMURE.SEUIL_CALME) continue
        if (cendreuxPres(state, site.tx, site.ty)) continue
        e.murmure = site.id
        // LA GRAINE DU MURMURE (`agriculture.md` J3, R27c soldé) : le secret reçu se plante.
        // Best-effort — sac plein, la graine se perd (assumé, documenté à la spec).
        addItems(e.inventory, { graine_de_braise: 1 })
        emitEvent(state, { type: 'murmure_recueilli', tick: state.tick, entityId: e.id, tx: site.tx, ty: site.ty })
      }
    }
  }
}
