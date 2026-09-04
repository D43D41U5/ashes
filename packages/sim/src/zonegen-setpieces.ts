/**
 * LES SET-PIECES DE LA RACINE — des ENDROITS, pas des timbres (spec t0-exploration R9-R12) ;
 * et depuis l'étage 3 (§2quinquies, 2026-08-16), ils se DÉRIVENT : LA COURONNE.
 *
 * L'ancien régime était un tirage par rejet salé ('SETP') qui POSAIT trois rectangles — la
 * signature mesurée du tampon : « la forêt ancienne de la T0 tient en UN massif de 1 920
 * tuiles = 48×40 exactement ». Or la doctrine du chantier (§2bis) dit : « ce qui se lit
 * comme logique, c'est ce qui est DÉRIVÉ ; ce qui se lit comme arbitraire, c'est ce qui est
 * POSÉ. » Le tirage meurt donc, et chaque set-piece végétal COURONNE la plus grande
 * composante réelle de sa famille :
 *
 *   • le BOIS NOIR — la couronne du plus grand massif de FORÊT : ses tuiles les plus
 *     profondes (érosion 8-connexe) deviennent `old_growth`, à BUDGET (`COURONNE_BOIS`) —
 *     jamais le massif entier : la composition A12/A17 est un contrat. La conversion le rend
 *     au passage ignifuge à la lisière sud (le prédicat des cédants ignore la futaie
 *     ancienne) — et ses VIEUX FÛTS meurent en devenant futaie (la doctrine du teaser
 *     s'étend d'elle-même : le plus grand massif troque ses vieux fûts contre LE teaser).
 *   • la COMBE BRUMEUSE — la couronne du marais au plus grand CŒUR : la roselière au
 *     profond, la MARE (haut-fond seulement — R45 et la connexité ne bougent pas) au plus
 *     profond encore. On élit par le cœur, pas par la taille brute : un ruban de frange n'a
 *     pas de dedans, une combe en a un.
 *   • le CERCLE DE PIERRES — AUCUNE peinture : le monument (rect inchangé, décor client
 *     dérivé) se centre sur la tuile la plus profonde de la plus grande fleuraie de la bande
 *     NORD (il doit survivre à la saison, lui). Les menhirs se posent sur le pré fleuri qui
 *     existait — ils ne le fabriquent plus.
 *
 * L'élection lit le terrain FINAL de la passe 1.6 : ce que la lisière sud a déjà converti
 * n'est plus candidat — le sud s'évite par NATURE (l'ancien `EVITE_SUD` meurt), et le Bois
 * Noir comme la Combe restent PERDABLES au front de cendre, comme avant, exprès.
 *
 * LE CORPS EST LE TERRAIN (R45bis) : la zone publiée porte la bbox COMPACTE du couronnement
 * — culling, nom, contournement des sentes, écart des charniers — mais toute question
 * d'APPARTENANCE se lit au sol (doctrine `arbre-peuplement`).
 *
 * Pur et déterministe : AUCUN tirage — érosion + composantes + tris à départage stable
 * (taille, puis première tuile row-major : le patron du Lac Mort). La garde A12 de zonegen
 * (double génération, zones comprises) l'exige.
 */
import { TERRAIN_FLOWER_MEADOW, TERRAIN_FOREST, TERRAIN_MARSH, TERRAIN_OLD_GROWTH, TERRAIN_REED_MARSH, TERRAIN_SHALLOW_WATER, TERRAIN_WET_MEADOW } from './balance'
import { isWater } from './map'
import { composantesDeMasque, eroderMasque } from './profondeur'
import type { GrapheZones } from './zonegraph'

export const SET_PIECES = {
  /** Budget de la couronne du Bois Noir, en tuiles — l'ordre de grandeur du tampon d'hier
   *  (48×40 = 1 920), la forme du monde d'aujourd'hui. La couronne CROÎT depuis le pic
   *  d'érosion du massif élu, par profondeur décroissante et en restant connexe, jusqu'au
   *  budget : compacte, organique, exacte (MESURÉ : les ensembles de niveau d'un massif
   *  réel se fragmentent en lobes — un seuil global rendait 448 tuiles sur la seed 2026). */
  COURONNE_BOIS: 1920,
  /** Le rayon (Chebyshev) où l'on cherche la forêt de part et d'autre d'une tuile d'eau, pour
   *  décider si elle sert de PONT à la couronne du Bois Noir. 2 → une eau de cinq tuiles au
   *  plus est enjambée ; au-delà (la rivière), l'eau coupe le massif, et c'est voulu. */
  PONT_RAYON: 2,
  /** Budget de la couronne de la Combe, sur le masque du PAYS HUMIDE (marais ∪ roselière ∪
   *  prairie humide — MESURÉ : le plus grand marais nu fait 11 à 83 tuiles de cœur, le seul
   *  « marais-endroit » était le tampon ; les grandes auréoles humides des lacs, elles,
   *  existent). Conversion par PRÉFIXES d'adoption : mare, puis roselière, puis marais. */
  COURONNE_COMBE: 1280,
  /** Le préfixe roselière de la Combe (mare comprise) — l'ordre de grandeur des anneaux du
   *  tampon d'hier (528 + 117). */
  ROSELIERE_BUDGET: 640,
  /** Le préfixe mare (haut-fond seulement — R45 et la connexité ne bougent pas). */
  MARE_BUDGET: 120,
  /** Le monument, lui, garde ses dimensions : un cercle de pierres a une taille. */
  CERCLE: { w: 24, h: 24 },
  /** Le Cercle vit dans la part de la Racine qui SURVIT à la saison (le nord). */
  CERCLE_NORD_FRAC: 0.38,
  /** Le Cercle s'écarte des deux couronnes (Manhattan des centres) : un monument choisit sa
   *  place — la nature, elle, met ses massifs où elle veut. */
  ECART_MIN: 200,
  /** Plafond du champ d'érosion du couronnement — assez pour ordonner un très grand massif. */
  CAP_EROSION: 24,
} as const

export interface SetPiece {
  kind: 'bois_noir' | 'cercle_pierres' | 'combe_brumeuse'
  nom: string
  x: number
  y: number
  w: number
  h: number
}

interface Couronne {
  /** Les tuiles de la couronne, DANS L'ORDRE D'ADOPTION (du pic vers le bord) : les préfixes
   *  de cette liste sont connexes par construction — la mare et la roselière de la Combe en
   *  sont des tranches. */
  tuiles: number[]
  bbox: { x: number; y: number; w: number; h: number }
}

/** La bbox (en tuiles) d'un ensemble d'index. */
function bboxDe(tuiles: readonly number[], width: number): Couronne['bbox'] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const i of tuiles) {
    const x = i % width
    const y = (i - x) / width
    if (x < x0) x0 = x
    if (y < y0) y0 = y
    if (x > x1) x1 = x
    if (y > y1) y1 = y
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

/**
 * COURONNER un masque : érosion, élection de la composante au plus grand CŒUR (compte de
 * tuiles à d ≥ profMin ; égalité : plus petite étiquette = première tuile plus tôt), puis
 * CROISSANCE DEPUIS LE PIC : partant de la tuile la plus profonde de l'élue (égalité :
 * premier index row-major), on adopte à chaque pas la tuile de la frontière la plus PROFONDE
 * (égalité : ordre d'arrivée dans son godet — FIFO, déterministe), jusqu'au budget. La
 * couronne est CONNEXE par construction, compacte (elle épouse la dorsale du massif), et
 * chaque préfixe de l'ordre d'adoption l'est aussi. MESURÉ avant cette forme : un seuil de
 * niveau global se fragmentait en lobes (448 tuiles au lieu de 1 920 sur la seed 2026).
 */
function couronner(
  masque: Uint8Array,
  width: number,
  height: number,
  budget: number,
  profMin: number,
  adoptable?: Uint8Array,
): Couronne | null {
  const prof = eroderMasque(masque, width, height, SET_PIECES.CAP_EROSION)
  const comp = composantesDeMasque(masque, width, height)
  if (comp.tailles.length === 0) return null

  // L'élection : la composante au plus grand cœur (d ≥ profMin).
  const coeurs = new Array<number>(comp.tailles.length).fill(0)
  for (let i = 0; i < prof.length; i++) {
    if (comp.label[i] !== -1 && prof[i]! >= profMin) coeurs[comp.label[i]!]! += 1
  }
  let elu = -1
  for (let c = 0; c < coeurs.length; c++) {
    if (elu === -1 || coeurs[c]! > coeurs[elu]!) elu = c
  }
  if (elu === -1 || coeurs[elu]! === 0) return null

  // Le pic : la tuile la plus profonde de l'élue, première en row-major.
  let pic = -1
  for (let i = 0; i < prof.length; i++) {
    if (comp.label[i] !== elu) continue
    if (pic === -1 || prof[i]! > prof[pic]!) pic = i
  }
  if (pic === -1) return null

  // La croissance : godets par profondeur (1..CAP), curseur FIFO par godet.
  const godets: number[][] = Array.from({ length: SET_PIECES.CAP_EROSION + 1 }, () => [])
  const curseurs = new Array<number>(SET_PIECES.CAP_EROSION + 1).fill(0)
  const vu = new Uint8Array(width * height)
  godets[prof[pic]!]!.push(pic)
  vu[pic] = 1
  const tuiles: number[] = []
  while (tuiles.length < budget) {
    let d = SET_PIECES.CAP_EROSION
    while (d >= 1 && curseurs[d]! >= godets[d]!.length) d -= 1
    if (d < 1) break // le massif est épuisé avant le budget
    const i = godets[d]![curseurs[d]!]!
    curseurs[d]! += 1
    // TRAVERSÉE SANS ADOPTION : une tuile du masque qui n'est pas `adoptable` sert de PONT — la
    // couronne passe par-dessus sans la prendre, ni au budget ni à la bbox. C'est ce qui permet
    // à un ruisseau de traverser le Bois Noir sans le couper en deux (2026-08-30).
    if (!adoptable || adoptable[i] === 1) tuiles.push(i)
    const x = i % width
    const y = (i - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (vu[j] || comp.label[j] !== elu) continue
        vu[j] = 1
        godets[prof[j]!]!.push(j)
      }
    }
  }
  if (tuiles.length === 0) return null
  return { tuiles, bbox: bboxDe(tuiles, width) }
}

/** Couronne les set-pieces (terrain EN PLACE) et rend leurs zones à enregistrer. */
export function placerLesSetPieces(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  /** L'épaisseur que la falaise prendra vers le sud (`RELIEF.PAROI_RANGEES`) — passée plutôt
   *  qu'importée : `zonegen` nous appelle déjà, et un import en retour ferait un cycle. */
  margeDuMur: number,
): SetPiece[] {
  const racineId = g.racine
  const r = g.zones[racineId]!.rect
  if (!r) return []
  const N = width * height
  const out: SetPiece[] = []

  const masqueDe = (garde: (t: number, x: number, y: number) => boolean): Uint8Array => {
    const m = new Uint8Array(N)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (zone[i] === racineId && garde(terrain[i]!, x, y)) m[i] = 1
      }
    }
    return m
  }

  /**
   * ═══ LA COURONNE NE S'ÉLIT PAS SUR CE QUE LE MUR VA PRENDRE ═══
   *
   * *Décision d'Alexis, 2026-08-31 : « élire la couronne après le murage ».* Le Bois Noir est un
   * LIEU budgété — `COURONNE_BOIS` tuiles, exactement (garde A25). Depuis que la falaise
   * s'épaissit à trois tuiles (`epaissirLesFalaises`), le mur en mangeait **45** au bord de la
   * Racine : 1 875 au lieu de 1 920, sur la graine 2026.
   *
   * ⚠ **ON N'A PAS DÉPLACÉ LA PASSE, ET IL FAUT LE DIRE.** Élire vraiment *après* le murage
   * voudrait dire déplacer `placerLesSetPieces` derrière la passe 3 — or les sentes (passe 1.7)
   * la consomment pour contourner les set-pieces, et les clairières (1.62) pour ne pas trouer la
   * futaie. On obtient la MÊME garantie en amont, et sans rien réordonner : la couronne s'élit
   * sur les tuiles qui **survivront** au mur, c'est-à-dire hors de la bande où il tombera.
   *
   * La bande se lit sur le GRAPHE, pas sur le terrain : le mur suit une arête entre deux zones,
   * puis descend de `RELIEF.PAROI_RANGEES` rangées vers le sud. Une tuile est donc menacée si une
   * tuile d'une autre zone se trouve à une case autour d'elle, ou jusqu'à deux rangées AU NORD.
   * C'est un sur-ensemble du mur réel — on préfère un bois qui recule d'une tuile à un budget qui
   * ment.
   *
   * Dans le monde JOUÉ (une seule zone), aucune tuile n'est menacée : ce chemin n'y change rien,
   * pas même le flux du PRNG.
   */
  const menaceParLeMur = (x: number, y: number): boolean => {
    const z = zone[y * width + x]!
    for (let dy = -margeDuMur; dy <= 1; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= height) continue
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= width) continue
        if (zone[ny * width + nx] !== z) return true
      }
    }
    return false
  }

  // ══ LE BOIS NOIR : la couronne du plus grand massif de forêt devient futaie ancienne ══
  //
  // ⚠ UN RUISSEAU NE COUPE PAS UN BOIS (2026-08-30). Depuis que la Racine a son drainage
  // (`zonegen-rus.ts`), des filets d'eau traversent les massifs — et le masque de forêt, lui,
  // s'y coupait en morceaux : la couronne devait SERPENTER pour dépenser son budget. MESURÉ sur
  // les trois graines de garde : le taux de remplissage de sa bbox tombait de 0,344 à 0,156
  // (seed 2026 : bbox 57×98 → 113×109). Une futaie qu'on voit de loin ne serpente pas.
  //
  // L'eau ÉTROITE entre donc dans le masque comme PONT (traversée, jamais adoptée : elle reste
  // de l'eau, elle ne coûte pas un tuile de budget). « Étroite » se lit sur place : deux tuiles
  // de forêt à `PONT_RAYON` — un ru de trois à cinq tuiles passe, la rivière (sept à onze) non,
  // et c'est juste : un fleuve, lui, coupe vraiment un bois.
  const forets = masqueDe((t, x, y) => t === TERRAIN_FOREST && !menaceParLeMur(x, y))
  const avecPonts = new Uint8Array(forets)
  {
    const R = SET_PIECES.PONT_RAYON
    for (let y = R; y < height - R; y++) {
      for (let x = R; x < width - R; x++) {
        const i = y * width + x
        if (forets[i] === 1 || zone[i] !== racineId) continue
        if (!isWater(terrain[i]!)) continue
        let voisins = 0
        for (let dy = -R; dy <= R && voisins < 2; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            if (forets[(y + dy) * width + x + dx] === 1) { voisins += 1; break }
          }
        }
        if (voisins >= 2) avecPonts[i] = 1
      }
    }
  }
  const bois = couronner(
    avecPonts,
    width, height, SET_PIECES.COURONNE_BOIS, 2, forets,
  )
  if (bois) {
    for (const i of bois.tuiles) terrain[i] = TERRAIN_OLD_GROWTH
    out.push({ kind: 'bois_noir', nom: 'le Bois Noir', ...bois.bbox })
  }

  // ── LA COMBE BRUMEUSE : la couronne du PAYS HUMIDE — mare au pic, roselière autour,
  //    marais en jupe. Les trois sont des PRÉFIXES de l'ordre d'adoption : connexes, nichés. ──
  const combe = couronner(
    masqueDe((t) => t === TERRAIN_MARSH || t === TERRAIN_REED_MARSH || t === TERRAIN_WET_MEADOW),
    width, height, SET_PIECES.COURONNE_COMBE, 2,
  )
  if (combe) {
    for (let k = 0; k < combe.tuiles.length; k++) {
      const i = combe.tuiles[k]!
      terrain[i] = k < SET_PIECES.MARE_BUDGET ? TERRAIN_SHALLOW_WATER
        : k < SET_PIECES.ROSELIERE_BUDGET ? TERRAIN_REED_MARSH
          : TERRAIN_MARSH
    }
    out.push({ kind: 'combe_brumeuse', nom: 'la Combe brumeuse', ...combe.bbox })
  }

  // ── LE CERCLE DE PIERRES : le monument sur la plus grande fleuraie du NORD, sans peinture ──
  const nordMax = r.y + SET_PIECES.CERCLE_NORD_FRAC * r.h
  const fleuraies = masqueDe((t, _x, y) => t === TERRAIN_FLOWER_MEADOW && y < nordMax)
  const profFleur = eroderMasque(fleuraies, width, height, SET_PIECES.CAP_EROSION)
  const compFleur = composantesDeMasque(fleuraies, width, height)
  const loin = (cx: number, cy: number): boolean => out.every((p) => {
    const dx = Math.abs(p.x + p.w / 2 - cx)
    const dy = Math.abs(p.y + p.h / 2 - cy)
    return dx + dy >= SET_PIECES.ECART_MIN
  })
  // Les candidates, grandes d'abord (égalité : étiquette plus petite) — la première dont le
  // pic est assez loin des couronnes gagne.
  const ordre = compFleur.tailles.map((taille, c) => ({ taille, c }))
    .sort((a, b) => (b.taille - a.taille) || (a.c - b.c))
  for (const { c } of ordre) {
    // Le pic de la composante : la tuile la plus profonde, première en row-major.
    let pic = -1
    for (let i = 0; i < N; i++) {
      if (compFleur.label[i] !== c) continue
      if (pic === -1 || profFleur[i]! > profFleur[pic]!) pic = i
    }
    if (pic === -1) continue
    const cx = pic % width
    const cy = (pic - cx) / width
    if (!loin(cx, cy)) continue
    const { w, h } = SET_PIECES.CERCLE
    // Clampé au rect de la RACINE (pas de la carte) : un monument ne chevauche pas le mur.
    const x = Math.min(Math.max(r.x, cx - w / 2), r.x + r.w - w)
    const y = Math.min(Math.max(r.y, cy - h / 2), r.y + r.h - h)
    out.push({ kind: 'cercle_pierres', nom: 'le Cercle de pierres', x, y, w, h })
    break
  }

  return out
}
