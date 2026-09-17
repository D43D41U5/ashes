/**
 * ═══ L'ORACLE DU CHAMP — la GI de référence, sur le CPU, pure et testée (spec `lumiere-globale.md` LG-R4) ═══
 *
 * *« L'oracle de ce calcul est JETABLE : `tools/__gi-planches/gi-ref.mjs` est gitignoré et meurt avec la
 * session. Il devient un module pur et testé AVANT la première passe, car c'est contre lui que chaque
 * passe GPU se garde (LG-A2). »* — le voici. C'est le calcul « idéal » au grain que la chaîne de passes
 * GPU doit approcher (LG-A2 : ≤ 1 niveau en moyenne, < 1 % des texels à plus de 3 niveaux) : la lumière
 * directe à ombres douces, puis un rebond coloré sur les faces éclairées des occludeurs, sous un genou.
 *
 * Il ne tourne PAS par image : il sert aux gardes (LG-A1, LG-A2, LG-A4) et aux planches. Il n'a aucune
 * dépendance Phaser, ni navigateur.
 *
 * ═══ LE REPÈRE ═══
 * Une grille gw × gh de texels (1 texel = 1 cellule du grain, 4 px monde) ; les coordonnées continues
 * ont leurs centres de texels en +0,5. Toutes les distances sont en texels. Deux sortes d'occludeurs :
 * les cellules OPAQUES (`occ`) et les BANDES de mur (`murs`, rectangles à intervalles ouverts — une
 * pièce d'arête, à cheval sur sa ligne, LG-R10). Le raster vient de la SIM (`occlusionAuGrain`, `grille.ts`) :
 * les occludeurs ne sont pas réécrits ici, ils sont LUS (LG-R11 : « la loi reste dans /sim, ici on la MONTRE »).
 *
 * ═══ LA TRAVERSÉE EST CELLE DE LA SIM, AU BIT PRÈS ═══
 * `traverse` est la règle de `segmentBloque` (`packages/sim/src/lumiere.ts`) sur un raster : départ et
 * arrivée exclus, une cellule n'est visitée que si le segment y entre avant sa fin (t < 1), à égalité on
 * avance en y d'abord — la règle du coin (LG-R12). Le motif est la table de la sim (`MOTIF_SOURCE`), pas
 * une spirale recalculée. `champ-ref.test.ts` le prouve contre `partVisible`, texel par texel.
 */
import { MOTIF_SOURCE } from '@ashes/sim'

/** Une bande de mur, en texels DE LA GRILLE (origine au coin nord-ouest du raster) — intervalles ouverts. */
export interface BandeGrille {
  readonly x0: number
  readonly x1: number
  readonly y0: number
  readonly y1: number
}

/** La grille des occludeurs, au grain. */
export interface GrilleGi {
  readonly gw: number
  readonly gh: number
  /** Par texel : 1 = opaque, 0 = libre. */
  readonly occ: Uint8Array
  /** Les bandes, en texels de la grille. */
  readonly murs: readonly BandeGrille[]
  /** Par texel opaque, son albédo (r, g, b) ; ignoré pour un texel libre. */
  readonly albedo: Float32Array
  /** Par bande, son albédo (même ordre que `murs`). */
  readonly albedoMurs: readonly (readonly [number, number, number])[]
}

/** Une source de lumière, en texels de la grille. */
export interface Emetteur {
  readonly x: number
  readonly y: number
  /** Là où la lumière s'éteint (la portée que la sim connaît). */
  readonly rayon: number
  /** Le rayon du disque émissif — la pénombre (`GI.TAILLE_SOURCE`). */
  readonly taille: number
  /** La teinte, en lumière linéaire. */
  readonly rgb: readonly [number, number, number]
}

export interface ReglagesChamp {
  /** Le gain du rebond ; 0 = lumière directe seule. */
  readonly rebond: number
  /** La portée du rebond, en texels. */
  readonly porteeRebond: number
  /** Le genou du rebond (Infinity : pas de genou). */
  readonly plafondRebond: number
  /** La pente de la lumière avec la distance, dans [0, 1] — linéaire par défaut. */
  readonly profil?: (d: number, e: Emetteur) => number
}

export interface Champ {
  /** La lumière DIRECTE par texel (r, g, b), avant rebond. */
  readonly direct: Float32Array
  /** Le rebond BRUT par texel, avant le genou. */
  readonly rebond: Float32Array
  /** La lumière totale : direct + rebond sous le genou ; sur un texel opaque, celle de sa face éclairée. */
  readonly light: Float32Array
  /** Sur un texel opaque, la part DIRECTE de sa face éclairée (un fût près du feu lit sa face, et sa part directe avec). */
  readonly directFace: Float32Array
}

const profilLineaire = (d: number, e: Emetteur): number => Math.max(0, 1 - d / e.rayon)

/** Le segment entre-t-il dans l'INTÉRIEUR de la bande ? Intervalles ouverts (LG-R10) — la règle de la sim. */
export function coupeBande(m: BandeGrille, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0
  let t1 = 1
  const dx = x1 - x0
  const dy = y1 - y0
  if (dx === 0) {
    if (!(x0 > m.x0 && x0 < m.x1)) return false
  } else {
    const a = (m.x0 - x0) / dx
    const b = (m.x1 - x0) / dx
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  if (dy === 0) {
    if (!(y0 > m.y0 && y0 < m.y1)) return false
  } else {
    const a = (m.y0 - y0) / dy
    const b = (m.y1 - y0) / dy
    t0 = Math.max(t0, Math.min(a, b))
    t1 = Math.min(t1, Math.max(a, b))
  }
  return t1 - t0 > 1e-9
}

/**
 * Le segment (x0, y0) → (x1, y1) est-il BLOQUÉ ? — une bande coupée, ou une cellule opaque visitée.
 * Amanatides–Woo, avec la règle du coin de la sim (`segmentBloque`) : départ et arrivée exclus, une
 * cellule n'est visitée que si le segment y entre avant sa fin, à égalité on avance en y d'abord.
 */
export function traverse(g: GrilleGi, x0: number, y0: number, x1: number, y1: number): boolean {
  for (const m of g.murs) if (coupeBande(m, x0, y0, x1, y1)) return true
  let cx = Math.floor(x0)
  let cy = Math.floor(y0)
  const ex = Math.floor(x1)
  const ey = Math.floor(y1)
  if (cx === ex && cy === ey) return false
  const dx = x1 - x0
  const dy = y1 - y0
  const sx = dx > 0 ? 1 : -1
  const sy = dy > 0 ? 1 : -1
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity
  let tx = dx !== 0 ? (dx > 0 ? cx + 1 - x0 : x0 - cx) * tdx : Infinity
  let ty = dy !== 0 ? (dy > 0 ? cy + 1 - y0 : y0 - cy) * tdy : Infinity
  const garde = 4 * (Math.abs(dx) + Math.abs(dy)) + 4
  for (let pas = 0; pas < garde; pas++) {
    if (tx < ty) {
      if (tx >= 1) return false
      cx += sx
      tx += tdx
    } else {
      if (ty >= 1) return false
      cy += sy
      ty += tdy
    }
    if (cx === ex && cy === ey) return false
    if (cx >= 0 && cy >= 0 && cx < g.gw && cy < g.gh && g.occ[cy * g.gw + cx] === 1) return true
  }
  return false
}

/**
 * LA PART VISIBLE d'une source étendue depuis (px, py) — combien des seize points du disque de rayon
 * `taille` centré en (ex, ey) le point voit, sur seize. La même mesure que `partVisible` de la sim.
 */
export function partVisibleGrille(g: GrilleGi, px: number, py: number, ex: number, ey: number, taille: number): number {
  let vus = 0
  for (const p of MOTIF_SOURCE) if (!traverse(g, px, py, ex + p[0] * taille, ey + p[1] * taille)) vus++
  return vus / MOTIF_SOURCE.length
}

/** Une cellule opaque reçoit la lumière de sa face éclairée : le max de ses voisines libres, et laquelle. */
function recu(g: GrilleGi, x: number, y: number, src: Float32Array): [number, number, number, number, number] {
  let r = 0
  let gg = 0
  let b = 0
  let best = -1
  let vx = x
  let vy = y
  for (const [ox, oy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + ox
    const ny = y + oy
    if (nx < 0 || ny < 0 || nx >= g.gw || ny >= g.gh) continue
    const j = ny * g.gw + nx
    if (g.occ[j] === 1) continue
    r = Math.max(r, src[j * 3]!)
    gg = Math.max(gg, src[j * 3 + 1]!)
    b = Math.max(b, src[j * 3 + 2]!)
    const s = src[j * 3]! + src[j * 3 + 1]! + src[j * 3 + 2]!
    if (s > best) {
      best = s
      vx = nx
      vy = ny
    }
  }
  return [r, gg, b, vx, vy]
}

interface Face {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly rgb: readonly [number, number, number]
}

/** LE CHAMP (LG-R4, les cinq étapes : direct, faces, rebond, genou, somme). */
export function champRef(g: GrilleGi, emetteurs: readonly Emetteur[], reglages: ReglagesChamp): Champ {
  const { gw, gh, occ } = g
  const { rebond, porteeRebond, plafondRebond } = reglages
  const profil = reglages.profil ?? profilLineaire
  const n = gw * gh
  const direct = new Float32Array(n * 3)

  // 1. Direct.
  for (const e of emetteurs) {
    const x0 = Math.max(0, Math.floor(e.x - e.rayon))
    const x1 = Math.min(gw - 1, Math.ceil(e.x + e.rayon))
    const y0 = Math.max(0, Math.floor(e.y - e.rayon))
    const y1 = Math.min(gh - 1, Math.ceil(e.y + e.rayon))
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = y * gw + x
        if (occ[k] === 1) continue
        const px = x + 0.5
        const py = y + 0.5
        const ddx = px - e.x
        const ddy = py - e.y
        const f = profil(Math.sqrt(ddx * ddx + ddy * ddy), e)
        if (f <= 0) continue
        const vus = partVisibleGrille(g, px, py, e.x, e.y, e.taille)
        if (vus <= 0) continue
        const a = f * vus
        direct[k * 3] = direct[k * 3]! + e.rgb[0] * a
        direct[k * 3 + 1] = direct[k * 3 + 1]! + e.rgb[1] * a
        direct[k * 3 + 2] = direct[k * 3 + 2]! + e.rgb[2] * a
      }
  }

  // 2. Faces — les cellules opaques bordées d'une libre, et les deux côtés de chaque bande.
  const rb = new Float32Array(n * 3)
  const light = new Float32Array(direct)
  if (rebond > 0) {
    const faces: Face[] = []
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const k = y * gw + x
        if (occ[k] !== 1) continue
        const [r, gg, b, vx, vy] = recu(g, x, y, direct)
        if (r + gg + b <= 1e-4) continue
        faces.push({ x: x + 0.5, y: y + 0.5, vx: vx + 0.5, vy: vy + 0.5, rgb: [r * g.albedo[k * 3]!, gg * g.albedo[k * 3 + 1]!, b * g.albedo[k * 3 + 2]!] })
      }
    // Chaque texel de longueur d'une bande a deux faces, une par côté ; chacune reçoit la lumière directe du
    // texel qui la borde et la renvoie de ce côté-là, depuis le centre du texel d'en face (la distance
    // qu'avait la face d'un mur d'un texel à sa voisine — le rebond garde la pente de G2).
    g.murs.forEach((m, im) => {
      const alb = g.albedoMurs[im] ?? [0.5, 0.42, 0.32]
      const horizontale = m.x1 - m.x0 > m.y1 - m.y0
      const ligne = horizontale ? Math.round(m.y0 + 0.5) : Math.round(m.x0 + 0.5)
      const a0 = horizontale ? Math.round(m.x0 + 0.5) : Math.round(m.y0 + 0.5)
      const a1 = horizontale ? Math.round(m.x1 - 0.5) : Math.round(m.y1 - 0.5)
      for (let u = a0; u < a1; u++)
        for (const cote of [ligne - 1, ligne]) {
          const autre = cote === ligne ? ligne - 1 : ligne
          const sx = horizontale ? u : cote
          const sy = horizontale ? cote : u
          const ax = horizontale ? u : autre
          const ay = horizontale ? autre : u
          if (sx < 0 || sy < 0 || sx >= gw || sy >= gh) continue
          const j = sy * gw + sx
          if (occ[j] === 1) continue
          const r = direct[j * 3]!
          const gg = direct[j * 3 + 1]!
          const b = direct[j * 3 + 2]!
          if (r + gg + b <= 1e-4) continue
          faces.push({ x: ax + 0.5, y: ay + 0.5, vx: sx + 0.5, vy: sy + 0.5, rgb: [r * alb[0], gg * alb[1], b * alb[2]] })
        }
    })

    // 3. Rebond — chaque face émet en Lambert depuis son côté éclairé, éteinte à la portée ; le total
    // s'accumule À PART pour être passé sous le genou sans changer de teinte.
    for (const f of faces) {
      const nx = f.vx - f.x
      const ny = f.vy - f.y
      const x0 = Math.max(0, Math.floor(f.x - porteeRebond))
      const x1 = Math.min(gw - 1, Math.ceil(f.x + porteeRebond))
      const y0 = Math.max(0, Math.floor(f.y - porteeRebond))
      const y1 = Math.min(gh - 1, Math.ceil(f.y + porteeRebond))
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const k = y * gw + x
          if (occ[k] === 1) continue
          const px = x + 0.5
          const py = y + 0.5
          const ddx = px - f.x
          const ddy = py - f.y
          const d = Math.sqrt(ddx * ddx + ddy * ddy)
          if (d > porteeRebond) continue
          const cos = (ddx * nx + ddy * ny) / d
          if (!(cos > 0)) continue
          // La distance se compte depuis la face, la visibilité depuis son côté éclairé.
          if (traverse(g, px, py, f.vx, f.vy)) continue
          const a = (rebond * cos * (1 - d / porteeRebond)) / (1 + d)
          rb[k * 3] = rb[k * 3]! + f.rgb[0] * a
          rb[k * 3 + 1] = rb[k * 3 + 1]! + f.rgb[1] * a
          rb[k * 3 + 2] = rb[k * 3 + 2]! + f.rgb[2] * a
        }
    }

    // 4. Genou, 5. Somme.
    for (let k = 0; k < n; k++) {
      const m = Math.max(rb[k * 3]!, rb[k * 3 + 1]!, rb[k * 3 + 2]!)
      const s = Number.isFinite(plafondRebond) && m > 0 ? 1 / (1 + m / plafondRebond) : 1
      light[k * 3] = light[k * 3]! + rb[k * 3]! * s
      light[k * 3 + 1] = light[k * 3 + 1]! + rb[k * 3 + 1]! * s
      light[k * 3 + 2] = light[k * 3 + 2]! + rb[k * 3 + 2]! * s
    }
  }

  // Les cellules opaques, pour l'affichage : la lumière de leur face éclairée, et sa part directe.
  const directFace = new Float32Array(direct)
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const k = y * gw + x
      if (occ[k] !== 1) continue
      const [r, gg, b] = recu(g, x, y, light)
      light[k * 3] = r
      light[k * 3 + 1] = gg
      light[k * 3 + 2] = b
      const [dr, dg, db] = recu(g, x, y, direct)
      directFace[k * 3] = dr
      directFace[k * 3 + 1] = dg
      directFace[k * 3 + 2] = db
    }
  return { direct, rebond: rb, light, directFace }
}

/**
 * LA COMPOSITION (LG-R5) : par canal, M = 1 − (1 − Mn × (1 − a × S)) × (1 − L), M ≤ 1.
 *   · `mn` : le plancher de la nuit d'aujourd'hui, par canal (le multiplicateur du voile) ;
 *   · `S` le masque d'astre en ce texel et `a` son opacité (LG-R8) ;
 *   · `L` la lumière du champ, déjà ramenée à sa force de l'heure (LG-R5 : f de jour).
 * Là où ne tombent ni lumière ni ombre (L = 0, S = 0), M = Mn : rien ne bouge (LG-A5).
 */
export function composerM(mn: number, s: number, a: number, l: number): number {
  const plancher = mn * (1 - a * s)
  // Sans lumière, EXACTEMENT le plancher : « rien ne bouge » se lit au bit, pas à l'arrondi près (LG-A5).
  if (l <= 0) return plancher
  const m = 1 - (1 - plancher) * (1 - Math.min(1, l))
  return m > 1 ? 1 : m
}

/**
 * ═══ L'ASTRE QUI JETTE L'OMBRE (LG-R8) ═══
 *
 * Ses deux nombres sont CALCULÉS AILLEURS et reçus ici. `deriveDOmbre` et `forceDeLOmbre` sont la loi
 * de `scenes/world/dynamic-lighting.ts`, que `WorldScene` pousse déjà aux socles et aux falaises
 * (`view.deriveOmbre`, `view.forceOmbre`) : la GI lit le MÊME nombre à la MÊME heure, elle ne le
 * recalcule pas. Les réglages de forme viennent de `GI.ASTRE`, passés comme `ReglagesChamp` l'est —
 * l'oracle prend ses nombres, il n'importe aucune constante.
 */
export interface Astre {
  /** La dérive, dans [-1, 1] (`deriveDOmbre`) : négative, l'astre est à l'est et l'ombre part à
   *  l'OUEST (le matin) ; positive, elle part à l'EST (le soir) ; nulle, elle tombe plein sud. */
  readonly derive: number
  /** La longueur de l'ombre PLEINE, en texels — `longueurDOmbre(H, px par texel)` (LG-R9). */
  readonly longueur: number
  /** Le décalage latéral par unité de longueur, à dérive ±1 (`GI.ASTRE.CISAILLEMENT`, LG-R8). */
  readonly cisaillement: number
  /** Les valeurs de la pénombre, du plus près au plus loin (`GI.ASTRE.PENOMBRE` : ⅔ puis ⅓). */
  readonly penombre: readonly number[]
}

/**
 * ═══ LE MASQUE D'ASTRE (LG-R8, LG-R9) — CE QUE LE SOLEIL ET LA LUNE RETIRENT AU PLANCHER DU CIEL ═══
 *
 * Rend S par texel, dans [0, 1] : 1 dans l'ombre pleine, ⅔ puis ⅓ dans les deux texels de pénombre,
 * 0 ailleurs. Il entre dans `composerM` (LG-R5), où il multiplie le PLANCHER — `mn × (1 − a × S)` —
 * et laisse le feu intact : une ombre d'astre n'éteint pas une flamme.
 *
 * ═══ L'OMBRE EST UNE SOMME DE MINKOWSKI, PAS UN TRACÉ ═══
 * Un point à la hauteur z tombe à ℓ × z/H au sud du pied (LG-R8), et un mur occupe toutes les
 * hauteurs de 0 à H : son ombre est donc sa bande BALAYÉE par le vecteur (dx, dy) — la somme de
 * Minkowski de la bande et du segment. Une seule formule rend les deux orientations : un mur
 * est-ouest jette un parallélogramme vers le sud ; un mur nord-sud ne dépasse qu'au-delà de son bout
 * sud (le reste du balayage retombe sur lui-même) et traîne en diagonale dès que la dérive n'est pas
 * nulle. Et « une ombre d'astre se compte depuis la FACE » (LG-R10) en sort tout seul : le balayage
 * part du BORD de la bande, jamais de son axe.
 *
 * ═══ CE QUI N'EST PAS UN LANCEUR ═══
 * Les murs SEULS, ici. Une roche garde sa coulée au pixel et n'entre pas dans le masque (LG-R15) ; un
 * arbre est deux cartes debout à la silhouette réelle, vent compris (LG-R8) — une tranche à part ; une
 * marche est un lanceur de sa hauteur (LG-R14), qui attend `etage-layer.ts`. Un texel d'occludeur,
 * lui, ne prend pas l'ombre d'astre (LG-R8) : un bloc est éclairé par ses faces, pas par son sol.
 *
 * L'opacité `a` n'est PAS ici : elle vaut `SHADOW_ALPHA` × `forceDeLOmbre`, deux nombres du rendu, et
 * elle entre dans `composerM`. Le masque ne dit que la FORME — d'où « elle s'annule à la nouvelle
 * lune » qui se lit chez l'appelant, au bit près, sans que cette fonction ait à le savoir.
 */
export function ombrePleineDAstre(g: GrilleGi, astre: Astre): Float32Array {
  const s = new Float32Array(g.gw * g.gh)
  const dy = astre.longueur
  if (!(dy > 0) || g.murs.length === 0) return s
  const dx = astre.cisaillement * astre.longueur * astre.derive

  // LE BALAYAGE de chaque bande, lu au centre de chaque texel de son emprise.
  for (const m of g.murs) {
    const x0 = Math.max(0, Math.floor(Math.min(m.x0, m.x0 + dx)))
    const x1 = Math.min(g.gw, Math.ceil(Math.max(m.x1, m.x1 + dx)))
    const y0 = Math.max(0, Math.floor(m.y0))
    const y1 = Math.min(g.gh, Math.ceil(m.y1 + dy))
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const k = y * g.gw + x
        if (s[k] === 1 || g.occ[k]) continue
        // S, C'EST LE RAYON D'OMBRE, et rien d'autre : le segment qui part du texel VERS l'astre, long
        // de ℓ, coupe-t-il la bande ? C'est mot pour mot `coupeBande` — donc le prédicat d'occultation
        // de la sim, aux mêmes intervalles ouverts (LG-R10), et non une seconde géométrie écrite à
        // côté. Le balayage de Minkowski et le rayon d'ombre sont la MÊME phrase lue dans les deux
        // sens. Et comme aucun centre de texel n'est dans l'intérieur d'une bande (ses bords sont
        // demi-entiers), un mur ne s'ombre jamais lui-même.
        if (coupeBande(m, x + 0.5, y + 0.5, x + 0.5 - dx, y + 0.5 - dy)) s[k] = 1
      }
  }

  return s
}

/**
 * LE MASQUE ENTIER (LG-R8) : l'ombre pleine, PLUS ses deux texels de pénombre à ⅔ puis ⅓. C'est
 * lui qui entre dans `composerM` et que les planches montrent.
 *
 * ⚠ LA SCISSION EN DEUX FONCTIONS N'EST PAS COSMÉTIQUE, ELLE SERT LA GARDE. Sur le GPU, l'ombre
 * pleine tient dans l'alpha de `gi-direct` — relisible — tandis que la pénombre se dilate dans la
 * passe somme, où plus rien ne peut la porter : un alpha < 1 sur `gi-champ` changerait son quad
 * MULTIPLY. La garde compare donc `ombrePleineDAstre` à ce qu'elle peut vraiment relire, au lieu
 * de comparer à peu près le masque entier. La pénombre, elle, est épinglée au texel par les tests.
 */
export function masqueDAstre(g: GrilleGi, astre: Astre): Float32Array {
  const s = ombrePleineDAstre(g, astre)

  // LA PÉNOMBRE, DEHORS — deux fronts de Tchebychev à travers le sol libre, JAMAIS vers le nord :
  // le haut d'une ombre est son contact, il n'a pas de bord doux (LG-R8).
  let front: number[] = []
  for (let k = 0; k < s.length; k++) if (s[k] === 1) front.push(k)
  for (const v of astre.penombre) {
    const suivant: number[] = []
    for (const k of front) {
      const x = k % g.gw
      const y = (k - x) / g.gw
      for (let jy = 0; jy <= 1; jy++)
        for (let jx = -1; jx <= 1; jx++) {
          if (jx === 0 && jy === 0) continue
          const nx = x + jx
          const ny = y + jy
          if (nx < 0 || ny < 0 || nx >= g.gw || ny >= g.gh) continue
          const n = ny * g.gw + nx
          if (s[n] !== 0 || g.occ[n]) continue
          s[n] = v
          suivant.push(n)
        }
    }
    front = suivant
  }
  return s
}
