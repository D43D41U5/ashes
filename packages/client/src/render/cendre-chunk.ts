/**
 * ═══ CE QU'UN CHUNK DE SOL RETIENT DE LA CENDRE — sa SIGNATURE (spec `cendre.md` R11bis) ═══
 *
 * Le sol est cuit par chunks de `PAVE.CHUNK` tuiles et gardé en texture ; la cendre, elle, se
 * DÉRIVE de dix âges qui bougent chaque jour de saison. Il faut donc savoir, sans recuire, quels
 * chunks ont changé d'aspect. Ce module répond à cette seule question.
 *
 * ⚠ **LA PREMIÈRE ÉCRITURE RETENAIT « LES CHUNKS QUI PORTENT DE LA CENDRE », ET C'EST L'ERREUR.**
 * Une appartenance POSITIVE relevée à la cuisson ne peut pas voir arriver le front : un chunk cuit
 * avant que la cendre l'atteigne n'est dans aucun ensemble, donc n'est jamais jeté — donc n'est
 * JAMAIS recuit. Le front s'arrête net au bord du chunk et y reste tant que le joueur le garde à
 * l'écran (l'oubli, 120 images, ne le répare que si on lui tourne le dos deux secondes).
 *
 * MESURÉ (`seed 2026`, la fenêtre d'un écran autour de (632, 239), du jour 151 au jour 291) :
 * cuits à l'âge 60 et regardés sans interruption, **21 chunks sur 35 restaient faux, 3 403 tuiles
 * peintes vivantes alors qu'elles avaient brûlé**. Sur les seules bascules de jour, l'ancienne
 * règle ratait 17,2 % des chunks qui changeaient (dont 1,3 % que même un balayage complet aurait
 * ratés : le chunk vierge que le front entame).
 *
 * ═══ LA RÈGLE JUSTE EST UN SEUIL, PAS UNE APPARTENANCE ═══
 *
 * Une tuile brûle quand `coût ≤ avancée · ORTHO · (1 + grain)`, soit `avancée ≥ seuil(tuile)`.
 * On retient donc, par fosse qui revendique une tuile du chunk, **le plus petit de ces seuils** :
 * l'avancée à laquelle sa toute première tuile ici prendra feu. Le chunk se recuit dès que le
 * foyer a bougé ET que son avancée a atteint ce seuil — avant, il n'y a rien à voir ; après, il y
 * a toujours quelque chose (le front qui progresse, ou la cendre qui refroidit).
 *
 * Pur, sans Phaser : c'est ce qui le rend testable (`cendre-chunk.test.ts`).
 */
import { CENDRE, avanceeDeCendre, coutDe, foyerDe, grainDeCendre, type WorldMap } from '@ashes/sim'
import { PAVE, PAVE_MARGE_TUILES } from './paves'

/** Ce qu'un chunk sait de la cendre au moment où il a été cuit. */
export interface SignatureCendre {
  /** Par fosse qui revendique une tuile du chunk (marge de cuisson comprise) : l'AVANCÉE à
   *  laquelle sa première tuile ici prend feu. Une ou deux entrées en pratique. */
  readonly seuils: readonly { readonly foyer: number; readonly avancee: number }[]
  /** Les âges des foyers à la cuisson — COPIÉS : le tableau de la scène est remplacé à chaque
   *  snapshot, le garder par référence rendrait la comparaison toujours vraie. */
  readonly ages: readonly number[]
}

/**
 * LA SIGNATURE D'UN CHUNK — relevée une fois, à la cuisson.
 *
 * Elle balaie exactement ce que `cuireChunk` LIT (le chunk plus `PAVE_MARGE_TUILES` tout autour :
 * frange, liseré et ombre portée débordent). Un balayage plus étroit rouvrirait le même défaut,
 * large d'une tuile, à chaque couture de chunk.
 *
 * Le grain est décidé au motif de `CENDRE.MOTIF` tuiles : on le mémoïse par bloc, ce qui ramène
 * 324 lectures de bruit à 9.
 */
export function signatureCendre(
  map: WorldMap, seed: number, cx: number, cy: number, ages: readonly number[],
): SignatureCendre {
  const seuils = new Map<number, number>()
  const champ = map.cendreCout
  if (champ) {
    const N = PAVE.CHUNK
    const M = PAVE_MARGE_TUILES
    const grains = new Map<number, number>()
    const y1 = cy * N + N + M
    const x1 = cx * N + N + M
    for (let ty = cy * N - M; ty < y1; ty++) {
      if (ty < 0 || ty >= map.height) continue
      for (let tx = cx * N - M; tx < x1; tx++) {
        if (tx < 0 || tx >= map.width) continue
        const c = coutDe(champ, ty * map.width + tx)
        if (c < 0) continue // hors d'atteinte : l'eau, le vide — rien n'y brûlera jamais
        const bloc = Math.floor(ty / CENDRE.MOTIF) * 65536 + Math.floor(tx / CENDRE.MOTIF)
        let g = grains.get(bloc)
        if (g === undefined) { g = grainDeCendre(seed, tx, ty); grains.set(bloc, g) }
        const seuil = c / CENDRE.ORTHO / (1 + g)
        const f = foyerDe(champ, ty * map.width + tx)
        const vu = seuils.get(f)
        if (vu === undefined || seuil < vu) seuils.set(f, seuil)
      }
    }
  }
  return {
    seuils: [...seuils].map(([foyer, avancee]) => ({ foyer, avancee })),
    ages: [...ages],
  }
}

/**
 * LA CENDRE A-T-ELLE BOUGÉ POUR CE CHUNK ? — la question qui décide de le jeter.
 *
 * ⚠ ON COMPARE DES ÂGES, PAS DES AVANCÉES. `avanceeDeCendre` tronque le jour, mais la couleur de
 * la cendre suit son ANCIENNETÉ, continue : un caractère `deluge` vieillit un foyer de 0,4 jour et
 * repeint la frange sans déplacer l'avancée d'un pouce. Le dixième de jour est la maille que
 * `WorldScene` emploie déjà pour décider d'appeler — on la garde ici, écrivain unique.
 */
export function cendreARemue(sig: SignatureCendre | undefined, ages: readonly number[]): boolean {
  if (!sig) return true // un chunk sans signature (couche neuve) : on ne parie pas
  // LE MONDE VIENT D'APPRENDRE SES FOSSES (premier snapshot : `[]` → dix âges). Rien ne se compare
  // encore, et la tache initiale a été cuite sans ses avancées : on recuit.
  if (sig.ages.length !== ages.length) return true
  for (const { foyer, avancee } of sig.seuils) {
    const age = ages[foyer] ?? 0
    if (Math.round(age * 10) === Math.round((sig.ages[foyer] ?? 0) * 10)) continue
    if (avanceeDeCendre(age) >= avancee) return true
  }
  return false
}
