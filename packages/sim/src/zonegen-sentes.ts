/**
 * LES SENTES DU PAYS D'AVANT — les routes de la Racine (spec t0-exploration R17-R18).
 *
 * Le pré n'est pas vierge : on y vivait, on guettait le sud, on est partis. Les sentes en
 * sont la trace praticable : des polylignes Manhattan de terrain `road` (id 2, ×1,25 — la
 * valeur que la table portait depuis toujours sans qu'aucune carte ne s'en serve), qui
 * relient CHAQUE seuil de la Racine à un carrefour central. La route est un choix, pas un
 * rail : plus rapide, plus exposée — Rust l'a montré, la route FABRIQUE les rencontres.
 *
 * ═══ LE GUÉ NAÎT DU CROISEMENT ═══
 *
 * Là où une sente rencontre le CŒUR profond de la rivière, elle ne s'arrête pas : elle le
 * REND FRANCHISSABLE — le profond redevient haut-fond sur la largeur du passage (R7). C'est
 * le croisement qui crée le gué, pas l'inverse ; et s'il en manque (aucune sente ne croise),
 * on en force aux tiers du cours — la rivière n'a JAMAIS le droit d'être un goulot (R5,
 * worldgen R11bis : l'eau profonde est un mur, un mur sans porte coupe la zone en deux).
 *
 * Rien ne pousse sur une sente (R18) : `zone-content` exclut le terrain `road` de tous ses
 * semis, comme il exclut les rampes. Une route à buissons est une pelouse rayée.
 *
 * Pur et déterministe : `hash2`, `+ - * / abs sign min max floor round` (invariant n°2).
 */
import { TERRAINS, TERRAIN_DEEP_WATER, TERRAIN_ROAD, TERRAIN_SHALLOW_WATER } from './balance'
import { isWater } from './map'
import { hash2 } from './noise'
import type { Socle } from './socle'
import type { Riviere } from './zonegen-water'
import type { GrapheZones } from './zonegraph'

export const SENTES = {
  /** Demi-largeur d'une sente. 1 → 3 tuiles : deux charrettes se croisent, à peine. */
  DEMI: 1,
  /** La bouche d'un seuil : à combien de pas du point de seuil, DANS la Racine, la sente prend. */
  BOUCHE: 26,
  /** Demi-longueur d'un gué le long du cœur de la rivière (en tuiles de cœur converties). */
  GUE_DEMI: 3,
  /** Nombre minimal de gués sur la rivière — forcés aux tiers si les croisements n'ont pas payé. */
  GUES_MIN: 2,
  /** Deux gués à moins de N tuiles ne comptent que pour un (dédoublonnage des toponymes). */
  GUE_ECART: 24,
} as const

export interface Gue {
  x: number
  y: number
}

/**
 * Trace les sentes de la Racine et perce les gués. Rend les gués (pour leurs toponymes).
 *
 * À appeler APRÈS l'eau (les sentes doivent savoir où est le cœur profond) et AVANT le
 * percement des seuils (les bouches se calculent depuis le graphe, pas depuis les couloirs —
 * et le couloir, percé ensuite, marquera `rampe` ses tuiles, sente comprise : un seuil ne
 * nourrit rien, la règle tient déjà).
 */
export function tracerLesSentes(
  terrain: number[],
  zone: Int32Array,
  g: GrapheZones,
  width: number,
  height: number,
  seed: number,
  riviere: Riviere | null,
  setPieces: readonly { x: number; y: number; w: number; h: number }[] = [],
  socle: Socle | null = null,
): { gues: Gue[]; croisees: { x: number; y: number }[] } {
  const racineId = g.racine
  const r = g.zones[racineId]!.rect
  if (!r) return { gues: [], croisees: [] }
  const sel = (seed ^ 0x53454e54) | 0 /* 'SENT' */
  const gues: Gue[] = []
  // LES CROISÉES (annales, spec `annales.md` R2) : le point où une liaison REJOINT le réseau
  // d'avant — le carrefour en Y qui ÉMERGE du raccord (on ne le dessine pas, on l'estampille).
  // « Des routes se sont trouvées ici » : le lieu social du pays d'avant, et du vôtre — c'est
  // là que les rencontres se fabriquent.
  const croisees: { x: number; y: number }[] = []

  const marchable = (i: number): boolean => TERRAINS[terrain[i]!]?.walkable === true

  // UN LIEU SE POSTE AU BORD DU CHEMIN, PAS DESSOUS (R18) — et un set-piece encore moins :
  // mesuré par la revue, la première écriture pavait 72 tuiles de route À TRAVERS le Cercle
  // de pierres (et rayait le Bois Noir et la Combe sur cinq seeds sur neuf). La route les
  // CONTOURNE : leur rect (+1 de marge) est un obstacle du tracé, au même titre qu'un lac.
  const dansSetPiece = (x: number, y: number): boolean =>
    setPieces.some((p) => x >= p.x - 1 && x < p.x + p.w + 1 && y >= p.y - 1 && y < p.y + p.h + 1)

  // ── LES BOUCHES : un départ de sente par seuil de la Racine ──
  const bouches: { x: number; y: number }[] = []
  for (const s of g.seuils) {
    if (s.a !== racineId && s.b !== racineId) continue
    const versRacine = s.a === racineId ? -1 : 1
    const ix = s.ax * versRacine
    const iy = s.ay * versRacine
    let px = -1
    let py = -1
    for (let k = SENTES.BOUCHE; k < SENTES.BOUCHE + 40; k++) {
      const x = s.x + ix * k
      const y = s.y + iy * k
      if (x < 0 || y < 0 || x >= width || y >= height) break
      const i = y * width + x
      if (zone[i] === racineId && marchable(i)) { px = x; py = y; break }
    }
    if (px >= 0) bouches.push({ x: px, y: py })
  }
  if (bouches.length === 0) return { gues: [], croisees: [] }

  // ── LE TRACÉ : bouche → réseau, en marches de Manhattan qui ESQUIVENT les lacs ──
  // (L'eau ne se pave pas : une sente TRAVERSE l'eau peu profonde — le pas ralentit, c'est le
  // prix du gué — et son terrain reste de l'eau. Seule la terre ferme devient route.)

  const percerGue = (x: number, y: number): void => {
    if (riviere && percerLeCoeur(terrain, riviere, x, y, width, height) > 0
      && gues.every((q) => Math.abs(q.x - x) + Math.abs(q.y - y) >= SENTES.GUE_ECART)) {
      gues.push({ x, y })
    }
  }

  // ═══ LE RÉSEAU SÉQUENTIEL — l'étoile est morte (stratigraphie S-R15, décision du 2026-08-09) ═══
  //
  // L'ancienne version faisait converger toutes les sentes vers UN carrefour au centre
  // géométrique du pays — un menu, pas une géographie. Désormais chaque bouche rejoint le
  // RÉSEAU DÉJÀ TRACÉ au plus court : la première liaison relie les deux bouches les plus
  // proches, chaque suivante vise la tuile de route la plus proche de sa bouche et S'ARRÊTE
  // dès qu'elle touche une route. La FUSION en tronçons communs et les carrefours en Y
  // ÉMERGENT de cet arrêt — on ne les dessine pas. Le gué reste ce qu'il était : le point où
  // une liaison croise le cœur de la rivière.
  const routes: number[] = [] // les tuiles de route peintes, dans l'ordre — la cible des suivantes
  // LE RÉSEAU D'AVANT — la fusion ne se déclenche que sur les liaisons PRÉCÉDENTES, jamais sur
  // la peinture fraîche de la liaison en cours (sans quoi elle « fusionne » avec sa propre croix
  // de départ au premier pas et s'arrête à sa bouche — mesuré : seuil coupé du réseau, A6 rouge).
  const reseau = new Uint8Array(width * height)
  /** Les tuiles VERSÉES au réseau (les liaisons finies) — les cibles des liaisons suivantes. */
  const tuilesReseau: number[] = []
  const peindreEtNoter = (cx: number, cy: number, horiz: boolean): void => {
    for (let w = -SENTES.DEMI; w <= SENTES.DEMI; w++) {
      const x = horiz ? cx : cx + w
      const y = horiz ? cy + w : cy
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const i = y * width + x
      if (zone[i] !== racineId || !marchable(i)) continue
      if (isWater(terrain[i]!)) continue
      if (terrain[i] !== TERRAIN_ROAD) {
        terrain[i] = TERRAIN_ROAD
        routes.push(i)
      }
    }
  }

  // ═══ LE ROUTAGE : un BFS au pas de la CELLULE (8 tuiles), jamais un marcheur glouton ═══
  //
  // Le marcheur-esquive de l'ancienne étoile ne savait pas contourner un obstacle CONCAVE :
  // enlisé contre une rive, il rendait des liaisons en pointillés (mesuré : seuil coupé, A6
  // rouge). Le BFS sur la grille des cellules trouve LE plus court chemin praticable — et en
  // visant TOUTES les cellules du réseau à la fois, la liaison fusionne au point le plus
  // proche PAR CONSTRUCTION. Déterministe : file FIFO, voisins dans un ordre fixe, grille de
  // ~12 000 cellules par liaison — des miettes.
  const M8 = 8
  const cols8 = Math.ceil(width / M8)
  const rows8 = Math.ceil(height / M8)
  /** Une TUILE que le tracé peut fouler : du pays, marchable — ou le cœur de la rivière
   *  (qu'on percera en gué). */
  const tuileOK = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const i = y * width + x
    if (zone[i] !== racineId) return false
    const t = terrain[i]!
    if (t === TERRAIN_DEEP_WATER) return riviere?.coeur.has(i) ?? false
    return TERRAINS[t]?.walkable === true
  }
  /**
   * Une CELLULE praticable : sa rangée centrale ET sa colonne centrale entières sont foulables.
   * Le centre seul ne suffisait pas — un tronçon cardinal traverse les DEMI-RANGÉES de deux
   * cellules, et 2-3 tuiles de roche au bord d'une cellule « au centre propre » faisaient des
   * routes en pointillés (mesuré : seuil coupé, A6 rouge). En exigeant la croix centrale,
   * tout segment entre deux cellules OK est peignable ou eau — plus un trou possible.
   * Mémoïsé : chaque cellule se juge une fois par tracé.
   */
  const celluleCache = new Int8Array(cols8 * rows8).fill(-1)
  const celluleOK = (c8: number): boolean => {
    const connu = celluleCache[c8]!
    if (connu >= 0) return connu === 1
    const cx0 = (c8 % cols8) * M8
    const cy0 = ((c8 - (c8 % cols8)) / cols8) * M8
    const cyM = cy0 + M8 / 2
    const cxM = cx0 + M8 / 2
    let ok = !dansSetPiece(cxM, cyM)
    for (let x = cx0; ok && x < cx0 + M8; x++) ok = tuileOK(x, cyM)
    for (let y = cy0; ok && y < cy0 + M8; y++) ok = tuileOK(cxM, y)
    celluleCache[c8] = ok ? 1 : 0
    return ok
  }
  const celluleDe8 = (x: number, y: number): number =>
    Math.min(rows8 - 1, Math.floor(y / M8)) * cols8 + Math.min(cols8 - 1, Math.floor(x / M8))

  /** Peint le tronçon Manhattan (x d'abord, y ensuite) entre deux centres de cellules,
   *  en perçant les gués au passage. */
  const peindreTroncon = (deX: number, deY: number, versX: number, versY: number): void => {
    const pasX = deX <= versX ? 1 : -1
    for (let x = deX; x !== versX; x += pasX) {
      const i = deY * width + x
      if (terrain[i] === TERRAIN_DEEP_WATER && (riviere?.coeur.has(i) ?? false)) percerGue(x, deY)
      peindreEtNoter(x, deY, true)
    }
    const pasY = deY <= versY ? 1 : -1
    for (let y = deY; y !== versY + pasY; y += pasY) {
      const i = y * width + versX
      if (terrain[i] === TERRAIN_DEEP_WATER && (riviere?.coeur.has(i) ?? false)) percerGue(versX, y)
      peindreEtNoter(versX, y, false)
    }
  }

  /**
   * LE COÛT D'UN PAS de cellule à cellule — c'est lui qui fait la route ORGANIQUE. Un plus
   * court chemin en pas égaux est une LIGNE DROITE (mesuré : des liaisons au cordeau le long
   * des frontières — pire que l'étoile) ; une route réelle épouse le terrain. Le pas paie
   * donc : un socle (12), la MONTÉE (la différence d'altitude du socle — la route contourne
   * les bosses au lieu de les gravir), et un grain positionnel ('SENT') qui fait serpenter
   * là où le terrain est indifférent. Coûts ENTIERS — les sommes sont exactes, l'ordre du
   * tas ne doit rien aux arrondis.
   */
  const coutVers = (de: number, v: number): number => {
    const vx = v % cols8
    const vy = (v - vx) / cols8
    let cout = 12 + Math.floor(hash2(vx, vy, sel) * 10)
    if (socle) {
      // La grille du socle est LA grille des cellules (même motif de 8) : mêmes index.
      const dAlt = Math.abs((socle.alt[de] ?? 0.5) - (socle.alt[v] ?? 0.5))
      // La pente se paie à la montée comme à la descente : une route de fond de vallon.
      cout += Math.min(48, Math.floor(dAlt * 800))
    }
    return cout
  }

  /** Relie (deX,deY) au réseau versé (ou à une cible explicite pour la première liaison) :
   *  Dijkstra de cellules à coûts entiers (tas départagé par index), chemin remonté par
   *  parents, peinture par tronçons. */
  const relier = (deX: number, deY: number, cibleExplicite: { x: number; y: number } | null): void => {
    const debut = routes.length
    // Les cellules-cibles : celles qui portent une tuile du réseau — ou LA cellule de la cible.
    const estCible = new Uint8Array(cols8 * rows8)
    if (cibleExplicite) {
      estCible[celluleDe8(cibleExplicite.x, cibleExplicite.y)] = 1
    } else {
      for (const i of tuilesReseau) estCible[celluleDe8(i % width, (i - (i % width)) / width)] = 1
    }
    const nC = cols8 * rows8
    const departC = celluleDe8(deX, deY)
    const parent = new Int32Array(nC).fill(-2) // -2 = jamais vu, -1 = départ
    const dist = new Float64Array(nC).fill(Infinity)
    parent[departC] = -1
    dist[departC] = 0
    // Le tas binaire (distance, index) — ordre TOTAL, comme le Priority-Flood du socle.
    const tasD: number[] = []
    const tasI: number[] = []
    const avant = (p: number, q: number): boolean =>
      tasD[p]! < tasD[q]! || (tasD[p] === tasD[q] && tasI[p]! < tasI[q]!)
    const echange = (p: number, q: number): void => {
      const td = tasD[p]!; tasD[p] = tasD[q]!; tasD[q] = td
      const ti = tasI[p]!; tasI[p] = tasI[q]!; tasI[q] = ti
    }
    const pousse = (d: number, i: number): void => {
      tasD.push(d); tasI.push(i)
      let p = tasD.length - 1
      while (p > 0) {
        const pere = (p - 1) >> 1
        if (!avant(p, pere)) break
        echange(p, pere)
        p = pere
      }
    }
    const tire = (): number => {
      const res = tasI[0]!
      const fin = tasD.length - 1
      tasD[0] = tasD[fin]!; tasI[0] = tasI[fin]!
      tasD.pop(); tasI.pop()
      let p = 0
      for (;;) {
        const g2 = 2 * p + 1
        const d2 = 2 * p + 2
        let m = p
        if (g2 < tasD.length && avant(g2, m)) m = g2
        if (d2 < tasD.length && avant(d2, m)) m = d2
        if (m === p) break
        echange(p, m)
        p = m
      }
      return res
    }
    pousse(0, departC)
    let arrivee = -1
    const regle = new Uint8Array(nC)
    while (tasD.length > 0 && arrivee < 0) {
      const c8 = tire()
      if (regle[c8] === 1) continue
      regle[c8] = 1
      if (estCible[c8] === 1 && c8 !== departC) { arrivee = c8; break }
      const cx8 = c8 % cols8
      const cy8 = (c8 - cx8) / cols8
      // Ordre FIXE des voisins (N, S, O, E).
      for (const v of [cy8 > 0 ? c8 - cols8 : -1, cy8 + 1 < rows8 ? c8 + cols8 : -1, cx8 > 0 ? c8 - 1 : -1, cx8 + 1 < cols8 ? c8 + 1 : -1]) {
        if (v < 0 || regle[v] === 1) continue
        if (!celluleOK(v)) { regle[v] = 1; continue } // infranchissable : réglé sans distance
        const d = dist[c8]! + coutVers(c8, v)
        if (d < dist[v]!) {
          dist[v] = d
          parent[v] = c8
          pousse(d, v)
        }
      }
    }
    if (arrivee < 0) { finir(debut); return } // pas de chemin : la garde de connexité tranchera
    // Le chemin, remonté puis peint de la bouche vers le réseau.
    const chemin: number[] = []
    for (let c8 = arrivee; c8 >= 0; c8 = parent[c8]!) chemin.push(c8)
    chemin.reverse()
    peindreEtNoter(deX, deY, true)
    peindreEtNoter(deX, deY, false)
    let px = deX
    let py = deY
    for (let q = 1; q < chemin.length; q++) {
      const c8 = chemin[q]!
      const cx = (c8 % cols8) * M8 + M8 / 2
      const cy = ((c8 - (c8 % cols8)) / cols8) * M8 + M8 / 2
      peindreTroncon(px, py, cx, cy)
      px = cx
      py = cy
    }
    // LE DERNIER RACCORD — le chemin s'arrête au CENTRE de la cellule d'arrivée, mais la route
    // qu'on rejoint peut passer à son COIN : douze tuiles d'herbe entre deux routes « reliées »
    // (mesuré, A6 rouge). On peint donc jusqu'à la tuile visée elle-même : la tuile de réseau
    // la plus proche du centre d'arrivée (distance au carré, départage par index) — ou la
    // cible explicite de la première liaison.
    if (cibleExplicite) {
      peindreTroncon(px, py, cibleExplicite.x, cibleExplicite.y)
    } else {
      let best = -1
      let bestD = Infinity
      for (const i of tuilesReseau) {
        const rx = i % width
        const ry = (i - rx) / width
        const d = (rx - px) * (rx - px) + (ry - py) * (ry - py)
        if (d < bestD || (d === bestD && i < best)) { bestD = d; best = i }
      }
      if (best >= 0) {
        peindreTroncon(px, py, best % width, (best - (best % width)) / width)
        // La tuile de réseau rejointe EST la croisée — celle que le dernier raccord vise déjà.
        croisees.push({ x: best % width, y: (best - (best % width)) / width })
      }
    }
    finir(debut)
  }

  /** Verse la peinture accumulée depuis `debut` au réseau — les suivantes pourront y fusionner. */
  const finir = (debut: number): void => {
    for (let q = debut; q < routes.length; q++) {
      reseau[routes[q]!] = 1
      tuilesReseau.push(routes[q]!)
    }
  }

  // L'ORDRE DES LIAISONS : la première relie la bouche 0 à la bouche la plus proche d'elle ;
  // chaque bouche suivante rejoint le réseau versé au plus court. Ordre des bouches = ordre
  // des seuils du graphe — déterministe.
  if (bouches.length === 1) {
    // Une seule porte : une amorce de route à sa bouche, pour que A6 ait quelque chose à voir.
    const debut = routes.length
    peindreEtNoter(bouches[0]!.x, bouches[0]!.y, true)
    peindreEtNoter(bouches[0]!.x, bouches[0]!.y, false)
    finir(debut)
  } else {
    let plusProche = 1
    let bestD = Infinity
    for (let b = 1; b < bouches.length; b++) {
      const d = (bouches[b]!.x - bouches[0]!.x) * (bouches[b]!.x - bouches[0]!.x)
        + (bouches[b]!.y - bouches[0]!.y) * (bouches[b]!.y - bouches[0]!.y)
      if (d < bestD) { bestD = d; plusProche = b }
    }
    relier(bouches[0]!.x, bouches[0]!.y, bouches[plusProche]!)
    for (let b = 1; b < bouches.length; b++) {
      if (b === plusProche) continue
      relier(bouches[b]!.x, bouches[b]!.y, null)
    }
  }

  return { gues, croisees }
}

/**
 * Convertit le cœur profond de la rivière en haut-fond autour de (x,y). Rend le NOMBRE de
 * tuiles converties — zéro veut dire « il n'y avait rien à percer ici » (un lac-perle, une
 * portion déjà ouverte), et un gué qui n'a rien percé n'est PAS un gué : la première écriture
 * enregistrait le toponyme sans condition, et la seed du jeu affichait « le Gué » sur de l'eau
 * infranchissable (mesuré par la revue — un gué fantôme).
 */
function percerLeCoeur(
  terrain: number[],
  riviere: Riviere,
  x: number,
  y: number,
  width: number,
  height: number,
): number {
  let converti = 0
  for (let dy = -SENTES.GUE_DEMI; dy <= SENTES.GUE_DEMI; dy++) {
    for (let dx = -SENTES.GUE_DEMI; dx <= SENTES.GUE_DEMI; dx++) {
      const gx = x + dx
      const gy = y + dy
      if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue // pas de wrap de ligne
      const i = gy * width + gx
      if (riviere.coeur.has(i) && terrain[i] === TERRAIN_DEEP_WATER) {
        terrain[i] = TERRAIN_SHALLOW_WATER
        converti++
      }
    }
  }
  return converti
}

/**
 * ═══ LES GUÉS FORCÉS — la rivière n'est JAMAIS un goulot (R7), et la garantie vit ICI ═══
 *
 * Hors de `tracerLesSentes`, et c'est le point (revue du 2026-07-25) : la première écriture
 * forçait ses gués À L'INTÉRIEUR du traceur, APRÈS ses sorties anticipées — une Racine sans
 * carrefour trouvable rendait zéro sente ET zéro gué, rivière pourtant valide. Ici, on ne
 * dépend de rien : tant qu'il manque des gués, on balaie les positions du FIL dont le
 * voisinage porte du cœur ENCORE PROFOND (jamais un lac-perle : `percerLeCoeur` rend zéro et
 * on passe), aux fractions les plus étalées d'abord. Un gué ne compte que s'il a VRAIMENT
 * percé — le compte rendu est le compte vrai.
 */
export function forcerLesGues(
  terrain: number[],
  riviere: Riviere | null,
  gues: Gue[],
  width: number,
  height: number,
): void {
  if (!riviere || riviere.fil.length === 0) return
  // Les fractions du cours, de la plus structurante à la plus fine : tiers, puis quarts, etc.
  const fractions: number[] = []
  for (let den = 3; den <= 9 && fractions.length < 24; den++) {
    for (let num = 1; num < den; num++) fractions.push(num / den)
  }
  for (const f of fractions) {
    if (gues.length >= SENTES.GUES_MIN) return
    const k = Math.round(f * (riviere.fil.length - 1))
    const i = riviere.fil[k]!
    const x = i % width
    const y = (i - x) / width
    if (percerLeCoeur(terrain, riviere, x, y, width, height) === 0) continue
    if (gues.every((q) => Math.abs(q.x - x) + Math.abs(q.y - y) >= SENTES.GUE_ECART)) {
      gues.push({ x, y })
    }
  }
}
