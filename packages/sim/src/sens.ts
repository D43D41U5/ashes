/**
 * LES SENS DU CENDREUX — ce que le sol lui porte (spec `cendreux.md` R24-R25, 2026-08-21).
 *
 * Module FEUILLE, exprès : balance, géométrie, température, types — et rien d'autre. Trois
 * systèmes l'appellent (combat, économie, village) et `cendreux.ts` importe déjà `village` :
 * loger `secouerLeSol` chez le Cendreux refermait deux cycles d'import neufs. Le dépôt a déjà
 * tranché ce cas par extraction (`ecart.ts`, `defriche.ts`) — on fait pareil. La VUE honnête,
 * elle, vit dans `faune.ts` (`stimulusPourLesMorts`) : c'est le vocabulaire de la chasse,
 * entré une fois.
 *
 * Pur et déterministe : aucun tirage, aucune fonction Math approximée — des produits, des
 * comparaisons, `distSq`.
 */
import { CENDREUX } from './balance'
import { distSq } from './geometry'
import type { Monster } from './monsters'
import type { Entity, SimState } from './sim'
import { eveilCendreuxAt } from './temperature'

/**
 * L'ÉVEIL DE CE CENDREUX-LÀ : la pente de température (`eveilCendreuxAt`), atténuée par sa
 * SATIÉTÉ — la chaleur bue le réchauffe, donc l'endort (décision ⑰ : « rassasié, il
 * s'affaisse »). La satiété s'ajoute au froid du monde comme des degrés portés sur soi.
 */
export function eveilDuCendreux(state: SimState, monster: Monster, entity: Entity): number {
  const brut = eveilCendreuxAt(state, entity.x, entity.y, state.tick)
  const satiete = monster.satiete ?? 0
  if (satiete <= 0) return brut
  // Plein (SATIETE_MAX), il porte (CHAUD − FROID) degrés de trop : amorphe partout où le
  // monde seul ne l'aurait pas endormi — sauf au cœur du froid extrême, qui déborde l'échelle.
  const e = brut - satiete / CENDREUX.BOIRE.SATIETE_MAX
  return e < 0 ? 0 : e
}

/**
 * ═══ L'IMPACT ÉBRANLE LE SOL, ET LE SOL PORTE JUSQU'AUX MORTS (spec R25, 2026-08-21) ═══
 *
 * Un coup qui PORTE — mêlée qui touche, coup d'outil de récolte, pose d'une pièce — secoue le
 * sol : tout Cendreux hors horde dans `portée × son éveil` prend le LIEU DU GESTE pour DERNIER
 * LIEU VU (le champ de la décision ⑨ — il ira vérifier, n'y trouvera rien, reprendra sa
 * marche). Aucun état neuf, AUCUN tirage : la secousse est une pure écriture de mémoire.
 *
 * L'éveil module la portée, et c'est tout le cadran (②) : de jour au chaud le village martèle
 * sans réveiller personne ; la saison qui refroidit rend le sol de plus en plus à l'écoute.
 * Un membre de HORDE n'écoute pas — il a déjà son Feu, et lui donner un détour poserait des
 * A* par bête, le coût exact que R5 interdit. Les ÉMETTEURS sont les vivants seulement : les
 * gardes des sites d'appel (`resolveStrike`, `harvestStrike`, `build`/`place_component`)
 * excluent les monstres — décision ⑤, pas d'alerte goule→goule, même par le sol.
 *
 * La météo n'entre pas ici : le brouillard voile des yeux, il n'étouffe pas le sol.
 */
export function secouerLeSol(state: SimState, x: number, y: number, portee: number): void {
  for (const m of state.monsters) {
    if (m.type !== 'cendreux') continue
    if (state.hordes.some((h) => h.memberEntityIds.includes(m.entityId))) continue
    const e = state.entities.find((en) => en.id === m.entityId)
    if (!e || e.hp <= 0) continue
    const reach = portee * eveilDuCendreux(state, m, e)
    if (reach <= 0 || distSq(e.x, e.y, x, y) > reach * reach) continue
    m.lastSeenX = x
    m.lastSeenY = y
  }
}
