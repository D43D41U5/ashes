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
  /** La hauteur de la barrière, en TEXELS du grain (H px ÷ px par texel) — LG-R9 : chaque bande lance
   *  l'ombre d'astre à SA hauteur (`hauteurDeBande`, `reglages.ts`). Un mur : 8 ; une palissade : 6. */
  readonly hauteur: number
}

/**
 * ═══ LES MARCHES (LG-R14) — le relief du sol, par texel, tel que la sim le rastérise ═══
 *
 * *« La falaise fait écran À SENS UNIQUE, jugée en hauteur : un palier vaut le lift du jeu (32 px), la
 * flamme d'un feu est à 10 px au-dessus de son sol ; un rayon du champ est bloqué par une arête s'il la
 * franchit plus bas que le haut de la marche, et un texel du haut n'est jamais bloqué par sa propre
 * marche. La rampe est un plancher, la porte ouverte : un connecteur n'est pas une arête. »*
 *
 * Ce sont les deux tableaux de `occlusionAuGrain` (`paliers`, `portes`), copiés tels quels par
 * `grille.ts` : le raster de la sim, dont l'écran DÉRIVE (LG-R11). `hauteur` est le lift d'un palier en
 * texels (`LUMIERE.PALIER_TEXELS`, 8) — reçu, jamais recalculé ici. Absent dans un creux (cave, chapeau) :
 * tout s'y lit à un seul niveau, la loi d'avant les terrasses.
 */
export interface MarchesGrille {
  /** Par texel, le palier de sa tuile (`palierDuSol`). */
  readonly paliers: Uint8Array
  /** Par texel, 1 sur une PORTE (rampe, gueule, escalier — `estUnePorte`) : jamais une arête. */
  readonly portes: Uint8Array
  /** Le lift d'un palier, en texels du grain. */
  readonly hauteur: number
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
  /** Les paliers et les portes (LG-R14) — absents dans un creux, ou sur une grille sans relief. */
  readonly marches?: MarchesGrille
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
  /**
   * LA HAUTEUR DE LA FLAMME au-dessus du palier 0, en texels (LG-R14) : `palier × hauteur + flamme` —
   * ce que la sim pose (`partVisible`, `hauteurDuPalier(niveauSource) + FLAMME_TEXELS`). Absente : au
   * ras du sol, ce qui ne change rien sur une grille sans marches.
   */
  readonly z?: number
  /**
   * LE JOUR D'UNE GUEULE (LG-R20) — la source n'est pas une flamme : sa lumière suit la loi des ANNEAUX
   * de la sim (`partDuCiel` : Tchebychev à la PAIRE, nul sur sa largeur — `demi` texels de part et
   * d'autre de `x` —, linéaire jusqu'à `rayon`, à sa force propre : le pic du feu ne s'y applique pas), et
   * ses seize rayons vont au disque posé CONTRE LA FENTE (`sourceDUnePorte`), à `cible`, pas à (x, y).
   * Absent : un feu, une torche — le profil du trou et le disque sous la flamme.
   */
  readonly jour?: { readonly demi: number; readonly cible: readonly [number, number] }
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

/** L'indice d'un texel de la grille, ou −1 hors d'elle. */
function indice(g: GrilleGi, cx: number, cy: number): number {
  return cx >= 0 && cy >= 0 && cx < g.gw && cy < g.gh ? cy * g.gw + cx : -1
}

/**
 * Le segment (x0, y0) → (x1, y1) est-il BLOQUÉ ? — une bande coupée, une cellule opaque visitée, ou une
 * MARCHE franchie trop bas (LG-R14). Amanatides–Woo, avec la règle du coin de la sim (`segmentBloque`) :
 * départ et arrivée exclus de la SORTE, une cellule n'est visitée que si le segment y entre avant sa fin,
 * à égalité on avance en y d'abord.
 *
 * LA MARCHE, mot pour mot celle de la sim : le rayon est une droite de la hauteur `z0` (le sol du
 * récepteur) à `z1` (la flamme) ; à chaque changement de texel, si le palier change et qu'aucun des deux
 * texels n'est une porte, il est bloqué s'il franchit l'arête STRICTEMENT sous le haut de la marche,
 * `max(palier, suivant) × hauteur`. Le texel de départ et celui d'arrivée ne s'épargnent JAMAIS la marche.
 * Hors de la grille, le palier est inconnu : on garde celui du dernier texel vu — le GPU fait de même.
 */
export function traverse(g: GrilleGi, x0: number, y0: number, x1: number, y1: number, z0 = 0, z1 = 0): boolean {
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
  const marches = g.marches
  let palier = 0
  let porte = false
  if (marches) {
    const k0 = indice(g, cx, cy)
    if (k0 >= 0) {
      palier = marches.paliers[k0]!
      porte = marches.portes[k0] === 1
    }
  }
  const garde = 4 * (Math.abs(dx) + Math.abs(dy)) + 4
  for (let pas = 0; pas < garde; pas++) {
    // `t` : le paramètre d'ENTRÉE dans le texel suivant — c'est là que la hauteur du rayon se juge.
    let t: number
    if (tx < ty) {
      if (tx >= 1) return false
      t = tx
      cx += sx
      tx += tdx
    } else {
      if (ty >= 1) return false
      t = ty
      cy += sy
      ty += tdy
    }
    if (marches) {
      const k = indice(g, cx, cy)
      if (k >= 0) {
        const suivant = marches.paliers[k]!
        const porteSuivante = marches.portes[k] === 1
        if (suivant !== palier && !porte && !porteSuivante && z0 + t * (z1 - z0) < Math.max(palier, suivant) * marches.hauteur) return true
        palier = suivant
        porte = porteSuivante
      }
    }
    if (cx === ex && cy === ey) return false
    if (cx >= 0 && cy >= 0 && cx < g.gw && cy < g.gh && g.occ[cy * g.gw + cx] === 1) return true
  }
  return false
}

/**
 * LA PART VISIBLE d'une source étendue depuis (px, py) — combien des seize points du disque de rayon
 * `taille` centré en (ex, ey) le point voit, sur seize. La même mesure que `partVisible` de la sim.
 * `z0`, `z1` : le sol du récepteur et la flamme, en texels au-dessus du palier 0 (LG-R14).
 */
export function partVisibleGrille(g: GrilleGi, px: number, py: number, ex: number, ey: number, taille: number, z0 = 0, z1 = 0): number {
  let vus = 0
  for (const p of MOTIF_SOURCE) if (!traverse(g, px, py, ex + p[0] * taille, ey + p[1] * taille, z0, z1)) vus++
  return vus / MOTIF_SOURCE.length
}

/** Le sol d'un texel, en texels au-dessus du palier 0 — 0 sans marches (LG-R14). */
function solDuTexel(g: GrilleGi, k: number): number {
  const m = g.marches
  return m ? m.paliers[k]! * m.hauteur : 0
}

/**
 * LA HAUTEUR DES MARCHES d'une grille, en texels : du palier le plus bas au plus haut de la fenêtre —
 * ce que la plus haute marche lance comme ombre d'astre (LG-R14, « comme un mur de sa hauteur »). 0 sans
 * relief. C'est le lanceur que `ChampGpu` ajoute aux bandes pour tailler sa marche d'ombre.
 */
export function hauteurDesMarches(g: GrilleGi): number {
  const m = g.marches
  if (!m) return 0
  let bas = 255
  let haut = 0
  for (let k = 0; k < m.paliers.length; k++) {
    const p = m.paliers[k]!
    if (p < bas) bas = p
    if (p > haut) haut = p
  }
  return haut > bas ? (haut - bas) * m.hauteur : 0
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

/** Une face qui émet : au texel (x, y), regardant le texel libre (vx, vy) dont elle renvoie la lumière. */
export interface Face {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly rgb: readonly [number, number, number]
}

/**
 * LES FACES (LG-R4 « faces ») — les cellules opaques bordées d'une libre, et les deux côtés de chaque
 * bande. Une cellule pleine regarde sa voisine libre la plus éclairée et renvoie le max par canal de ses
 * voisines libres, × son albédo. Chaque texel de longueur d'une bande a deux faces, une par côté ;
 * chacune reçoit la lumière directe du texel qui la borde et la renvoie de ce côté-là, depuis le centre
 * du texel d'en face (la distance qu'avait la face d'un mur d'un texel à sa voisine — le rebond garde
 * la pente de G2).
 *
 * Exportée pour le banc de l'Atelier (`banc-gi.ts`, LG-A1) : c'est CE que la passe `gi-faces` doit
 * porter, case par case — la même liste que `champRef` fait rebondir.
 */
export function facesDuChamp(g: GrilleGi, direct: Float32Array): Face[] {
  const { gw, gh, occ } = g
  const faces: Face[] = []
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const k = y * gw + x
      if (occ[k] !== 1) continue
      const [r, gg, b, vx, vy] = recu(g, x, y, direct)
      if (r + gg + b <= 1e-4) continue
      faces.push({ x: x + 0.5, y: y + 0.5, vx: vx + 0.5, vy: vy + 0.5, rgb: [r * g.albedo[k * 3]!, gg * g.albedo[k * 3 + 1]!, b * g.albedo[k * 3 + 2]!] })
    }
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
  return faces
}

/** LE CHAMP (LG-R4, les cinq étapes : direct, faces, rebond, genou, somme). */
export function champRef(g: GrilleGi, emetteurs: readonly Emetteur[], reglages: ReglagesChamp): Champ {
  const { gw, gh, occ } = g
  const { rebond, porteeRebond, plafondRebond } = reglages
  const profil = reglages.profil ?? profilLineaire
  const n = gw * gh
  const direct = new Float32Array(n * 3)

  // 1. Direct — du sol du texel (son palier, LG-R14) à la flamme de la source (`e.z`).
  for (const e of emetteurs) {
    const z1 = e.z ?? 0
    const j = e.jour
    const demi = j ? j.demi : 0
    const x0 = Math.max(0, Math.floor(e.x - e.rayon - demi))
    const x1 = Math.min(gw - 1, Math.ceil(e.x + e.rayon + demi))
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
        // Le jour d'une gueule (LG-R20) : l'anneau de la sim, à la paire ; une flamme : le profil du trou.
        const f = j
          ? Math.max(0, 1 - Math.max(Math.max(0, Math.abs(ddx) - j.demi), Math.abs(ddy)) / e.rayon)
          : profil(Math.sqrt(ddx * ddx + ddy * ddy), e)
        if (f <= 0) continue
        const vus = partVisibleGrille(g, px, py, j ? j.cible[0] : e.x, j ? j.cible[1] : e.y, e.taille, solDuTexel(g, k), z1)
        if (vus <= 0) continue
        const a = f * vus
        direct[k * 3] = direct[k * 3]! + e.rgb[0] * a
        direct[k * 3 + 1] = direct[k * 3 + 1]! + e.rgb[1] * a
        direct[k * 3 + 2] = direct[k * 3 + 2]! + e.rgb[2] * a
      }
  }

  // 2. Faces — les cellules opaques bordées d'une libre, et les deux côtés de chaque bande (`facesDuChamp`).
  const rb = new Float32Array(n * 3)
  const light = new Float32Array(direct)
  if (rebond > 0) {
    const faces = facesDuChamp(g, direct)

    // 3. Rebond — chaque face émet en Lambert depuis son côté éclairé, éteinte à la portée ; le total
    // s'accumule À PART pour être passé sous le genou sans changer de teinte.
    for (const f of faces) {
      const nx = f.vx - f.x
      const ny = f.vy - f.y
      // La face rebondit AU SOL de son texel éclairé (LG-R14) : le rayon de rebond va du sol du récepteur
      // au sol de ce texel-là — une marche entre les deux fait écran comme pour le direct.
      const zf = solDuTexel(g, Math.floor(f.vy) * gw + Math.floor(f.vx))
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
          if (traverse(g, px, py, f.vx, f.vy, solDuTexel(g, k), zf)) continue
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
  /** La longueur de l'ombre PLEINE d'un MUR étalon, en texels — `longueurDOmbre(HAUTEUR_MUR_PX, px par
   *  texel)` (LG-R9). Elle ne projette AUCUNE bande : chaque bande lance à sa hauteur
   *  (`longueurParHauteur × hauteur`, ci-dessous). Nulle, aucun astre ne porte et rien ne se projette. */
  readonly longueur: number
  /** Le décalage latéral par unité de longueur, à dérive ±1 (`GI.ASTRE.CISAILLEMENT`, LG-R8). */
  readonly cisaillement: number
  /** Les valeurs de la pénombre, du plus près au plus loin (`GI.ASTRE.PENOMBRE` : ⅔ puis ⅓). */
  readonly penombre: readonly number[]
  /** LG-R9 : ℓ / H — combien de px d'ombre par px de hauteur (`GI.ASTRE.LONGUEUR_PAR_HAUTEUR`, 0,4).
   *  C'est le nombre qui projette une CARTE (un arbre, LG-R8) : un point à la hauteur z tombe à
   *  `longueurParHauteur × z` au sud de son pied. `longueur` ci-dessus en est le cas du mur. */
  readonly longueurParHauteur: number
}

/** Une silhouette : w × h pixels, 1 où le pixel est OPAQUE (alpha ≥ 128, LG-R8), rangée 0 en haut. */
export interface Silhouette {
  readonly w: number
  readonly h: number
  readonly opaque: Uint8Array
}

/**
 * UNE CARTE DEBOUT SUR SON PIED (LG-R8 : « un arbre est deux cartes debout sur leur pied : le fût et la
 * cime »). Elle porte la pose EXACTE du sprite du jeu — position, origine, rotation du vent, étirement,
 * miroir — et sa silhouette réelle. Toutes les longueurs sont en PX DE LA GRILLE (px monde moins
 * l'origine du raster) ; l'oracle les convertit en texels avec `pxParTexel`.
 */
export interface CarteDOmbre {
  readonly silhouette: Silhouette
  /** La position du sprite (son point d'origine). */
  readonly x: number
  readonly y: number
  readonly originX: number
  readonly originY: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
  readonly flipX: boolean
  readonly flipY: boolean
  /** Le PIED de la carte — le point du sol d'où elle se dresse : le sprite du fût y a son origine, la
   *  cime s'en élève de `ancrageHouppierPx`. C'est autour de lui que la projection tourne. */
  readonly piedX: number
  readonly piedY: number
}

/** Les cartes d'une image et leur grain. */
export interface CartesDOmbre {
  readonly cartes: readonly CarteDOmbre[]
  readonly pxParTexel: number
}

/**
 * ═══ L'OMBRE DES CARTES (LG-R8, LG-R9) — la silhouette PROJETÉE au sol ═══
 *
 * Un point de la carte à la hauteur z au-dessus de son pied tombe à ℓ/H × z au SUD du pied, cisaillé
 * comme la coulée : décalé de `cisaillement × dérive` px par px de longueur. La projection est donc
 * l'affine M = [[1, −q·k], [0, −q]] autour du pied (q = ℓ/H, k = cisaillement × dérive), appliquée à
 * la carte DEBOUT — c'est-à-dire au sprite tel qu'il est posé (origine, rotation du vent, étirement,
 * miroir). On la lit à l'ENVERS, du centre de chaque texel vers le pixel de la silhouette qui y tombe :
 * M⁻¹ = [[1, −k], [0, −1/q]], puis la pose du sprite défaite, puis `floor`.
 *
 * C'est cette fonction même qui rastérise la cible `gi-arbres` de la chaîne GPU (`ChampGpu`,
 * `ecrireLesCartes`) : le GPU ne dessine pas les cartes, il lit ce masque. Pourquoi — mesuré — est
 * écrit là-bas ; ici, la conséquence : l'oracle et la chaîne partagent la rastérisation, et la garde
 * du masque (LG-A9) n'éprouve que le téléversement et la lecture. La rastérisation, elle, s'éprouve
 * dans `champ-ref.test.ts`, sur toutes les variantes d'arbres.
 *
 * Un texel d'occludeur ne prend pas l'ombre (LG-R8) ; rien ne tombe au nord du pied (q > 0). `s` reçoit
 * 1 sous une carte et n'est jamais remis à 0 : l'appelant passe un tableau neuf ou vidé.
 */
export function ombreDesCartes(g: GrilleGi, s: Float32Array, astre: Astre, arbres: CartesDOmbre): void {
  const q = astre.longueurParHauteur
  if (!(q > 0)) return
  const k = astre.cisaillement * astre.derive
  const pas = arbres.pxParTexel
  for (const c of arbres.cartes) {
    const sil = c.silhouette
    if (sil.w <= 0 || sil.h <= 0) continue
    const cos = Math.cos(c.rotation)
    const sin = Math.sin(c.rotation)
    // L'EMPRISE : les quatre coins de la carte, posés puis projetés, bornent les texels à lire.
    const w = sil.w * c.scaleX
    const h = sil.h * c.scaleY
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [lx, ly] of [[-c.originX * w, -c.originY * h], [(1 - c.originX) * w, -c.originY * h], [-c.originX * w, (1 - c.originY) * h], [(1 - c.originX) * w, (1 - c.originY) * h]] as const) {
      // Posé (rotation autour de l'origine, puis translation), puis projeté autour du pied.
      const px = c.x + cos * lx - sin * ly - c.piedX
      const py = c.y + sin * lx + cos * ly - c.piedY
      const gx = c.piedX + px - q * k * py
      const gy = c.piedY - q * py
      if (gx < x0) x0 = gx
      if (gx > x1) x1 = gx
      if (gy < y0) y0 = gy
      if (gy > y1) y1 = gy
    }
    const tx0 = Math.max(0, Math.floor(x0 / pas))
    const tx1 = Math.min(g.gw - 1, Math.ceil(x1 / pas))
    const ty0 = Math.max(0, Math.floor(y0 / pas))
    const ty1 = Math.min(g.gh - 1, Math.ceil(y1 / pas))
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const idx = ty * g.gw + tx
        if (s[idx] === 1 || g.occ[idx]) continue
        // Du centre du texel au point de la carte debout : M⁻¹ autour du pied.
        const dx = (tx + 0.5) * pas - c.piedX
        const dy = (ty + 0.5) * pas - c.piedY
        const px = c.piedX + dx - k * dy
        const py = c.piedY - dy / q
        // La pose du sprite, défaite : translation, rotation inverse, échelle, origine, miroir.
        const ex = px - c.x
        const ey = py - c.y
        const u = (cos * ex + sin * ey) / c.scaleX + c.originX * sil.w
        const v = (-sin * ex + cos * ey) / c.scaleY + c.originY * sil.h
        const i = Math.floor(c.flipX ? sil.w - u : u)
        const j = Math.floor(c.flipY ? sil.h - v : v)
        if (i < 0 || j < 0 || i >= sil.w || j >= sil.h) continue
        if (sil.opaque[j * sil.w + i] === 1) s[idx] = 1
      }
  }
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
 * ═══ LES TROIS SORTES DE LANCEUR, ET CE QUI N'EN EST PAS ═══
 * Les MURS, par leurs bandes balayées (ci-dessous) ; les ARBRES, par leurs deux cartes debout à la
 * silhouette réelle, vent compris (LG-R8, `ombreDesCartes` — reçues en `arbres`, posées par la vue) ;
 * les MARCHES (LG-R14, `ombreDesMarches`) : *« la marche porte son ombre d'astre comme un mur de sa
 * hauteur — (haut − bas) × 32 px, sur le sol plus bas seulement ; la rampe n'est pas une arête »*.
 * Une roche garde sa coulée au pixel et n'entre pas dans le masque (LG-R15). Un texel d'occludeur, lui,
 * ne prend pas l'ombre d'astre (LG-R8) : un bloc est éclairé par ses faces, pas par son sol.
 *
 * L'opacité `a` n'est PAS ici : elle vaut `SHADOW_ALPHA` × `forceDeLOmbre`, deux nombres du rendu, et
 * elle entre dans `composerM`. Le masque ne dit que la FORME — d'où « elle s'annule à la nouvelle
 * lune » qui se lit chez l'appelant, au bit près, sans que cette fonction ait à le savoir.
 */
export function ombrePleineDAstre(g: GrilleGi, astre: Astre, arbres?: CartesDOmbre): Float32Array {
  const s = new Float32Array(g.gw * g.gh)
  if (!(astre.longueur > 0)) return s
  if (arbres !== undefined) ombreDesCartes(g, s, astre, arbres)
  ombreDesMarches(g, s, astre)
  if (g.murs.length === 0) return s

  // LE BALAYAGE de chaque bande, lu au centre de chaque texel de son emprise — À SA HAUTEUR (LG-R9) :
  // ℓ = longueurParHauteur × hauteur, cisaillée par la dérive. Une palissade (24 px) jette trois rangs
  // là où un mur (32 px) en jette quatre ; `astre.longueur`, l'étalon du mur, n'en projette aucune.
  for (const m of g.murs) {
    const dy = astre.longueurParHauteur * m.hauteur
    if (!(dy > 0)) continue
    const dx = astre.cisaillement * dy * astre.derive
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
 * ═══ L'OMBRE DES MARCHES (LG-R14) — la falaise est un mur de sa hauteur, pour l'astre aussi ═══
 *
 * Le RAYON D'OMBRE d'un texel, comme pour une bande : du centre du texel vers l'astre, long de
 * ℓ = longueurParHauteur × la plus haute marche de la grille, cisaillé par la dérive. Il met le texel à
 * l'ombre s'il ENTRE dans un texel d'un palier PLUS HAUT que le sien, au paramètre `t`, avant la part
 * de cette marche : `t × ℓ < longueurParHauteur × (haut − bas) × hauteur` — la hauteur se compte depuis
 * le SOL DU RÉCEPTEUR, comme un mur se compte depuis son pied. Sur le sol plus bas seulement : depuis un
 * palier haut, rien ne tombe (le rayon n'entre dans rien de plus haut). Un connecteur n'est pas une
 * arête : si le texel quitté OU le texel entré est une porte, ce franchissement-là ne porte pas — la
 * colonne de la rampe reste claire, et la rampe elle-même (LG-A15). Un texel d'occludeur ne prend rien.
 *
 * C'est la MÊME marche que `ombreDAstre` du GPU (`champ-gpu.ts`), à la borne près : ici le rayon est
 * taillé sur les marches seules, là-bas sur la plus haute bande OU marche du champ, et chaque lanceur
 * ne compte que jusqu'à sa part. Les deux lisent le même prédicat — la garde LG-A2 les compare.
 */
export function ombreDesMarches(g: GrilleGi, s: Float32Array, astre: Astre): void {
  const m = g.marches
  if (!m) return
  const hMax = hauteurDesMarches(g)
  if (!(hMax > 0) || !(astre.longueurParHauteur > 0)) return
  const dy = astre.longueurParHauteur * hMax
  const dx = astre.cisaillement * dy * astre.derive
  // La part d'UN palier de marche sur la longueur du rayon : (haut − bas) paliers valent (haut − bas) × cette part.
  const partParPalier = m.hauteur / hMax
  for (let y = 0; y < g.gh; y++)
    for (let x = 0; x < g.gw; x++) {
      const k = y * g.gw + x
      if (s[k] === 1 || g.occ[k]) continue
      if (rayonDOmbreDeMarche(g, m, x + 0.5, y + 0.5, x + 0.5 - dx, y + 0.5 - dy, partParPalier)) s[k] = 1
    }
}

/** Le rayon d'ombre (x0, y0) → (x1, y1) entre-t-il dans une marche plus haute avant sa part ? (voir `ombreDesMarches`) */
function rayonDOmbreDeMarche(g: GrilleGi, m: MarchesGrille, x0: number, y0: number, x1: number, y1: number, partParPalier: number): boolean {
  let cx = Math.floor(x0)
  let cy = Math.floor(y0)
  const k0 = cy * g.gw + cx
  const p0 = m.paliers[k0]!
  // LA MARCHE EST UNE ARÊTE : elle se franchit entre DEUX texels consécutifs de paliers différents, en
  // MONTANT (`p > pPrec`). Juger « plus haut que le récepteur » à chaque texel ferait de tout le plateau
  // une marche — et le texel d'après la rampe bloquait ce que la rampe venait d'épargner (MESURÉ, M4).
  let pPrec = p0
  let portePrec = m.portes[k0] === 1
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
    let t: number
    if (tx < ty) {
      if (tx >= 1) return false
      t = tx
      cx += sx
      tx += tdx
    } else {
      if (ty >= 1) return false
      t = ty
      cy += sy
      ty += tdy
    }
    const k = indice(g, cx, cy)
    if (k < 0) return false
    const p = m.paliers[k]!
    const porte = m.portes[k] === 1
    // Une montée, dont le haut domine le sol du récepteur (`p − p0` paliers au-dessus de lui) ; STRICT,
    // comme la part d'une bande : un rayon dont la part s'achève au bord d'une marche n'y entre pas.
    if (p > pPrec && p > p0 && !portePrec && !porte && t < (p - p0) * partParPalier) return true
    pPrec = p
    portePrec = porte
  }
  return false
}

/**
 * LE MASQUE ENTIER (LG-R8) : l'ombre pleine, PLUS ses deux texels de pénombre à ⅔ puis ⅓. C'est
 * lui qui entre dans `composerM` et que les planches montrent.
 *
 * ⚠ LA SCISSION EN DEUX FONCTIONS N'EST PAS COSMÉTIQUE, ELLE SUIT LE GPU. L'ombre PLEINE tient
 * dans l'alpha de `gi-direct` (passe 1) ; le masque ENTIER — pénombre comprise — est dilaté à la
 * passe 3 et rangé dans `gi-drapeau`.g, d'où `gi-somme` le lit au lieu de le refaire.
 *
 * Les DEUX sont donc relisibles aujourd'hui. Ça n'a pas toujours été vrai : la pénombre se dilatait
 * dans la passe somme, où plus rien ne pouvait la porter (un alpha < 1 sur `gi-champ` changerait son
 * quad MULTIPLY), et la garde ne pouvait comparer que `ombrePleineDAstre`. ⚠ ELLE N'EN COMPARE
 * TOUJOURS QUE CELLE-LÀ : la comparer au masque entier contre `gi-drapeau`.g est une garde à
 * RENFORCER, pas une garde en place. La pénombre reste épinglée au texel par les tests.
 */
export function masqueDAstre(g: GrilleGi, astre: Astre, arbres?: CartesDOmbre): Float32Array {
  const s = ombrePleineDAstre(g, astre, arbres)

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
