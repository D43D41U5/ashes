/**
 * L'ÉCART — « on ne se tient pas les uns SUR les autres ».
 *
 * UNE SEULE SOMME DE RÉPULSIONS DANS LE JEU, et c'est tout l'objet de ce module. Elle est née
 * pour le GIBIER (spec faune R9bis, `advanceFaune`) ; la décision d'Alexis du 2026-08-20 la
 * donne aussi à la HORDE, qui marchait jusque-là en colonne — seize Cendreux descendant le même
 * gradient du même champ de flux calculent tous la même tuile suivante et s'empilent. Vu à
 * l'écran : treize goules relevées par la sim, DEUX silhouettes à l'image.
 *
 * ── POURQUOI UN MODULE À PART ───────────────────────────────────────────────────
 *
 * Les deux appelants ne peuvent pas se voir : `faune.ts` importe déjà `monsters.ts` (pour
 * `moveToward` et le type `Monster`), donc `monsters.ts` ne peut pas importer `faune.ts` en
 * retour. C'est mot pour mot la situation que `defriche.ts` décrit et résout de la même
 * façon — le calcul vit ici, ne dépend que de `geometry.ts`, et les deux le lisent sans cycle.
 * Recopier la somme dans `monsters.ts` aurait donné DEUX écarts à régler au lieu d'un, et
 * l'un des deux aurait fini par mentir.
 *
 * ── STRUCTUREL, DONC SANS ALLOCATION ────────────────────────────────────────────
 *
 * Il ne prend ni `Monster` ni `Entity` — juste des identités et un accès aux corps. Deux
 * raisons : ça coupe le cycle d'import, et ça évite de construire un tableau intermédiaire à
 * chaque tick pour chaque bête (le coût par tick est un chantier permanent de ce dépôt).
 *
 * PUR — aucune horloge, aucun PRNG, aucun Math approximé (`sqrt` seul, autorisé par
 * l'invariant §2).
 */
import { distSq } from './geometry'

/** Ce que l'écart a besoin de savoir d'un corps : où il est, et s'il est encore debout. */
export interface CorpsSitue {
  x: number
  y: number
  hp: number
}

export interface Ecart {
  /** La direction où s'écarter, UNITAIRE — ou `null` : rien à fuir, ou parfait équilibre. */
  push: { x: number; y: number } | null
  /** Le carré de la distance à la plus proche voisine — c'est lui qui arme l'hystérésis. */
  nearestSq: number
}

/**
 * LA SOMME DES RÉPULSIONS d'un corps par rapport à ses voisins, normalisée.
 *
 * LE GROUPE SE LIT PAR INDEX (`combien` + `idDu`), et non comme un tableau d'objets — sinon
 * chaque appelant devrait en construire un : la horde ne porte que des `number[]`, et la
 * fabrique tournait UNE FOIS PAR GOULE ET PAR TICK (seize objets × seize membres = 256
 * allocations par tick de nuit d'assaut, au moment le plus chargé du jeu). `corps` rend le
 * corps d'une identité — les deux appelants ont déjà leur index du tick, on ne rebalaie donc
 * jamais `state.entities`. `deadband` est la zone morte de l'équilibre : un correctif MESURÉ,
 * pas un réglage.
 */
export function separationPush(
  combien: number,
  idDu: (i: number) => number,
  moiId: number,
  moiX: number,
  moiY: number,
  corps: (entityId: number) => CorpsSitue | undefined,
  radius: number,
  deadband: number,
): Ecart {
  let px = 0
  let py = 0
  let n = 0
  let nearestSq = Infinity
  for (let i = 0; i < combien; i++) {
    const autreId = idDu(i)
    if (autreId === moiId) continue
    const e = corps(autreId)
    if (!e || e.hp <= 0) continue
    const d2 = distSq(moiX, moiY, e.x, e.y)
    if (d2 < nearestSq) nearestSq = d2
    if (d2 >= radius * radius) continue
    const d = Math.sqrt(d2)
    if (d < 0.001) {
      // Deux corps exactement superposés : il faut bien choisir un sens, et il
      // doit être le MÊME sur toutes les machines — l'ordre des `entityId` tranche.
      px += moiId < autreId ? 1 : -1
      n++
      continue
    }
    // Plus la voisine est près, plus elle pousse fort : c'est ce qui empêche la
    // somme de s'annuler bêtement au milieu d'un groupe symétrique.
    const w = radius / d
    px += ((moiX - e.x) / d) * w
    py += ((moiY - e.y) / d) * w
    n++
  }
  if (n === 0) return { push: null, nearestSq }
  const l = Math.sqrt(px * px + py * py)
  // LA ZONE MORTE DE L'ÉQUILIBRE (mesuré 2026-08-01 — c'est LE tremblement).
  //
  // La somme des répulsions est NORMALISÉE : elle garde toute sa force jusqu'au
  // point d'équilibre, et le pas, lui, a une longueur fixe. Une bête coincée
  // entre deux voisines dépassait donc l'équilibre à chaque pas, trouvait la
  // somme inversée au tick suivant, et repartait en sens inverse — 0,081 tuile
  // à l'ouest, 0,081 à l'est, VINGT FOIS PAR SECONDE, avec le sprite qui se
  // retourne à chaque fois. L'hystérésis de `separating` n'y pouvait rien : la
  // bête ne quitte jamais l'état, elle oscille DEDANS.
  //
  // En dessous de ce déséquilibre, on ne bouge donc plus : la bête est aussi
  // bien là qu'ailleurs, et un pas ne ferait que la renvoyer d'où elle vient.
  // (Le seuil se lit en unités de poids `radius/d` : une voisine pile au rayon
  // pèse 1. Un pas de broutage déplace le déséquilibre d'environ 0,14 — la zone
  // morte est le double, pour qu'aucun pas ne puisse traverser l'équilibre.)
  if (l < deadband) return { push: null, nearestSq }
  return { push: { x: px / l, y: py / l }, nearestSq }
}
