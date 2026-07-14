/**
 * L'hydrologie alpine (SP1b) — modèle : l'eau vient surtout de la FONTE DE LA
 * GLACE en altitude, dévale, et se jette toujours dans quelque chose (la rivière
 * principale, le lac, ou est absorbée par le marais) — jamais « dans le vide ».
 * Elle converge en TOILE (les ruisseaux fusionnent en descendant).
 *
 * Mise en œuvre pure & déterministe :
 *  - lac au point d'écoulement le plus bas ;
 *  - tronc central méandré (tête de vallée → lac), tracé explicitement ;
 *  - arbre de drainage vers le lac (priority-flood, Barnes 2014) → chaque tuile
 *    connaît sa tuile aval, sans cycle ;
 *  - ruisseaux de fonte : sources en HAUTE altitude (limite des neiges), tracés
 *    en aval sur l'arbre jusqu'au premier corps d'eau OU marais (→ ils fusionnent
 *    en toile et se terminent toujours quelque part) ;
 *  - tarns dans les vraies cuvettes hautes.
 * hash2 pour l'échantillonnage/départage ; arithmétique autorisée, pas de trigo.
 */
import { TERRAIN_DEEP_WATER, TERRAIN_MARSH, TERRAIN_SHALLOW_WATER } from './balance'
import { boxBlur } from './geometry'
import { elevationAt, type WorldMap } from './map'
import { fbm2, hash2 } from './noise'
import { isWater, type Paint, type ValleyPoint } from './valleygen-primitives'

const paintShallow: Paint = (cur) => (cur === TERRAIN_DEEP_WATER ? undefined : TERRAIN_SHALLOW_WATER)
const paintDeep: Paint = () => TERRAIN_DEEP_WATER

/**
 * Plan d'eau à contour IRRÉGULIER — on DÉFORME la position d'échantillonnage par
 * un bruit basse fréquence (domain warping) avant le test de disque : le contour
 * gagne des lobes et de l'allongement au lieu de rester un rond (les vrais plans
 * d'eau ne sont jamais circulaires). Deux appels concentriques (même seed) →
 * cœur profond bien à l'intérieur de la berge. `warpAmp` = fraction du rayon.
 */
function stampWaterBody(
  map: WorldMap, cx: number, cy: number, rx: number, ry: number, paint: Paint, seed: number, warpAmp: number,
): void {
  const W = map.width
  const H = map.height
  const rmax = Math.max(rx, ry)
  const rr = Math.ceil(rmax * (1 + warpAmp)) + 1
  const scale = Math.max(3, rmax)
  for (let dy = -rr; dy <= rr; dy++) {
    for (let dx = -rr; dx <= rr; dx++) {
      const tx = cx + dx
      const ty = cy + dy
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue
      const wx = dx + warpAmp * rmax * (fbm2(tx, ty, scale, seed) * 2 - 1)
      const wy = dy + warpAmp * rmax * (fbm2(tx, ty, scale, (seed ^ 0x9e3779b9) | 0) * 2 - 1)
      const ex = wx / rx // ellipse : rx ≠ ry → forme allongée (sans trigo)
      const ey = wy / ry
      if (ex * ex + ey * ey > 1) continue
      const next = paint(map.terrain[ty * W + tx] ?? 0)
      if (next !== undefined) map.terrain[ty * W + tx] = next
    }
  }
}

/** Constantes d'hydrologie — contenu de carte, réglées à la vignette. */
export const HYDRO = {
  LAKE_R_FRAC: 0.055,     // rayon du lac (fraction de min(W,H))
  RIVER_HW: 2,            // demi-largeur du cœur du tronc (→ 5 tuiles d'eau profonde : ça BLOQUE)
  /**
   * Espacement des gués le long du cours, en fraction de min(W,H).
   *
   * C'est LE bouton de la nouvelle topologie. La rivière traversante coupe la
   * vallée en deux rives ; ce nombre décide à quel point ça coûte de changer de
   * rive. 0,25 → un gué tous les 300 tuiles à l'échelle du jeu, soit un détour
   * maximal de ~150 tuiles (≈ 40 s de marche à 4 tuiles/s). Assez pour que le
   * fleuve compte, pas assez pour qu'il punisse.
   */
  FORD_SPACING_FRAC: 0.25,
  /** De combien le gué s'élargit de part et d'autre du cœur (une plage de galets). */
  FORD_WIDEN: 2,
  /** Demi-fenêtre du lissage du cours, en fraction de min(W,H) — arrondit les
   *  angles droits que la grille impose au thalweg, sans le déplacer. */
  SMOOTH_FRAC: 0.012,
  // (MAIN_AMP_FRAC / MAIN_SCALE_FRAC ont disparu avec le tronc en segment droit :
  //  on lui ajoutait un méandre bruité pour qu'il ne soit pas une règle. Le thalweg
  //  n'en a pas besoin — il serpente parce que le RELIEF serpente.)
  MELT_DENSITY: 0.00015,  // sources de fonte par tuile intérieure (modéré)
  MELT_LO: 0.6,           // altitude min d'une source de fonte (limite des neiges basse)
  MELT_HI: 0.86,          // altitude max (sous le pic scellé)
  ABSORB_AT: 0.34,        // altitude à laquelle un ruisseau atteint le FOND et est
                          //  absorbé (meadow/marais) — l'empêche de traverser le
                          //  fond plat vers un lac lointain (mirroir de BANDS.FLOOR)
  POOL_R_FRAC: 0.013,     // rayon d'une mare de fonte au pied de pente (fond de vallée)
  TARN_DENSITY: 0.00007,  // tarns par tuile intérieure
  TARN_MIN_FRAC: 0.4,     // altitude min d'un tarn
  TARN_MAX_FRAC: 0.68,    // altitude max d'un tarn
  TARN_R_FRAC: 0.014,     // rayon d'un tarn
  EROSION_DEPTH: 0.2,     // incision MAX (à la bouche) de l'érosion fluviale ; les
                          //  affluents creusent ∝ √(flux).
  /** Sur combien de tuiles l'incision s'étale — la largeur des BERGES.
   *  Sans elle, la tranchée a des parois verticales et le rendu se replie
   *  (cf. `erodeChannels` : c'est ce qui faisait planter 4 seeds sur 16). */
  EROSION_BANK_TILES: 4,
}

const NX = [-1, 0, 1, -1, 1, -1, 0, 1]
const NY = [-1, -1, -1, 0, 0, 1, 1, 1]

/** La tuile intérieure au plus bas écoulement (loin du bord) — le bassin du lac. */
function lowestInterior(flow: number[], W: number, H: number, margin: number): ValleyPoint {
  let bx = margin, by = margin, be = 2
  for (let y = margin; y < H - margin; y++) {
    for (let x = margin; x < W - margin; x++) {
      const e = flow[y * W + x]!
      if (e < be) { be = e; bx = x; by = y }
    }
  }
  return { x: bx, y: by }
}

// (`highestInterior` — le point d'écoulement le plus haut de l'intérieur — a servi
//  de source au fleuve jusqu'au 2026-07-13. Il pouvait tomber à l'est, voire au
//  sud-est, à deux pas de la bouche : le fleuve était alors court et ne détachait
//  qu'un coin de vallée. Remplacé par `farthestSource`, qui prend le plus LONG
//  affluent — un fleuve long par construction, et non par chance.)

/**
 * Place 1 à 4 lacs (nombre aléatoire selon la seed) dans les bassins d'écoulement
 * les plus bas, ESPACÉS, chacun de taille et de FORME diverses (ellipse allongée
 * + domain-warp → ronds, oblongs, lobés). Renvoie le lac PRINCIPAL (le plus bas,
 * exutoire de la rivière et du drainage).
 */
function carveLakes(map: WorldMap, flow: number[], seed: number): ValleyPoint {
  const W = map.width
  const H = map.height
  const D = Math.min(W, H)
  const margin = Math.max(3, Math.round(D * 0.05))
  const count = 1 + Math.floor(hash2(seed, 0x3c1a, 0x9) * 3.999) // 1..4
  const excludeR = Math.round(D * 0.14)
  const base = D * HYDRO.LAKE_R_FRAC
  const placed: ValleyPoint[] = []
  for (let i = 0; i < count; i++) {
    // Le point le plus bas pas déjà proche d'un lac placé.
    let bx = -1, by = -1, be = 1e9
    for (let y = margin; y < H - margin; y++) {
      for (let x = margin; x < W - margin; x++) {
        const e = flow[y * W + x]!
        if (e >= be) continue
        let ok = true
        for (const p of placed) {
          const ddx = x - p.x; const ddy = y - p.y
          if (ddx * ddx + ddy * ddy < excludeR * excludeR) { ok = false; break }
        }
        if (ok) { be = e; bx = x; by = y }
      }
    }
    if (bx < 0) break
    const ks = (seed ^ (i * 0x51ed)) | 0
    const size = 0.5 + hash2(ks, 1, 0x11) * 1.3          // 0.5×..1.8×
    const aspect = 0.65 + hash2(ks, 2, 0x22) * 0.85      // 0.65..1.5 (allongement)
    const warpAmp = 0.4 + hash2(ks, 3, 0x33) * 0.35      // 0.4..0.75 (irrégularité)
    const r = Math.max(4, Math.round(base * size))
    const rx = Math.max(3, Math.round(r * aspect))
    const ry = Math.max(3, Math.round(r / aspect))
    stampWaterBody(map, bx, by, rx + 2, ry + 2, paintShallow, ks, warpAmp)
    stampWaterBody(map, bx, by, rx, ry, paintDeep, ks, warpAmp)
    placed.push({ x: bx, y: by })
  }
  return placed[0] ?? lowestInterior(flow, W, H, margin)
}

/**
 * LA BOUCHE DE LA VALLÉE — la tuile la plus basse du bord sud.
 *
 * Le sud est le côté OUVERT (`computeRelief` exclut `y` du calcul de `edge` :
 * ni forme de vallée ni enceinte n'y montent). C'est par là que l'eau s'en va,
 * et c'est vers là que TOUT le relief descend. On prend donc la bouche sur
 * l'avant-dernière rangée : la dernière est l'anneau scellé (`sealBorderRing`),
 * qui redeviendra roche après nous — la rivière s'y enfonce, comme sous une
 * montagne.
 */
function valleyMouth(map: WorldMap): ValleyPoint {
  const W = map.width
  const H = map.height
  const el = map.elevation!
  const D = Math.min(W, H)
  const margin = Math.max(3, Math.round(D * 0.06))
  const y = H - 2
  let bx = margin
  let be = 2
  for (let x = margin; x < W - margin; x++) {
    const e = el[y * W + x]!
    if (e < be) { be = e; bx = x }
  }
  return { x: bx, y }
}

/**
 * LE THALWEG — le chemin que l'eau prend VRAIMENT, d'un point jusqu'à la bouche.
 *
 * On suit l'arbre de drainage (`dir`), qui est déjà là : chaque tuile connaît sa
 * tuile aval, et la suivre mène à coup sûr au puits, sans cycle. Le tronc n'est
 * donc plus un SEGMENT DROIT tiré à la règle entre deux points et bruité pour
 * faire joli — il épouse le relief, parce qu'il EST le relief.
 *
 * (L'ancienne version se justifiait ainsi : « le fond est trop plat pour qu'un
 * fleuve s'y creuse par accumulation ; on le pose procéduralement ». C'était vrai
 * de l'accumulation de flux, pas du chemin : l'arbre de drainage, lui, traverse
 * les plats sans peine — le priority-flood les a comblés exprès.)
 */
function traceThalweg(map: WorldMap, dir: number[], fromX: number, fromY: number): number[] {
  const W = map.width
  const path: number[] = []
  const maxSteps = map.width + map.height + 8 // garde-fou : l'arbre est acyclique, mais on ne parie pas
  let c = fromY * W + fromX
  for (let s = 0; s < maxSteps && c >= 0; s++) {
    path.push(c)
    c = dir[c]!
  }
  return path
}

/**
 * LA SOURCE DU FLEUVE — le point le plus LOIN de la bouche, en pas de rivière.
 *
 * Un fleuve, c'est son plus long affluent : le Nil ne naît pas de la source la
 * plus haute mais de la plus lointaine. On prend donc la tuile de plus grande
 * PROFONDEUR dans l'arbre de drainage (le nombre de pas qui l'en séparent), et
 * non plus le point d'écoulement le plus élevé de l'intérieur.
 *
 * CE QUE ÇA CORRIGE. `highestInterior` cherchait le maximum sur TOUT l'intérieur,
 * bordure comprise : il pouvait le trouver à l'est, voire au sud-est — à deux pas
 * de la bouche. Le fleuve était alors court et ne détachait qu'un coin. Mesuré :
 * sur les seeds 2718 et 31415, il ne portait que 2 ou 3 gués et ne séparait que
 * 7 % de la vallée du reste. Ailleurs (2026, 7, 42), le même code donnait six
 * gués et une vraie coupure — le fleuve était bon *par chance*.
 *
 * La profondeur d'arbre, elle, ne dépend pas de la chance : la tuile la plus
 * lointaine est nécessairement à l'autre bout du bassin. Le fleuve est long par
 * construction.
 *
 * La profondeur se lit sur `order` (l'ordre de dépilement du priority-flood, du
 * puits vers l'amont) : quand on traite une tuile, son aval l'a forcément été
 * avant — il n'a été empilé que par lui. Une seule passe, `+` uniquement.
 */
function farthestSource(dir: number[], order: readonly number[]): number {
  const depth = new Int32Array(dir.length)
  let best = order[0] ?? 0
  let bestD = 0
  for (const i of order) {
    const d = dir[i]!
    if (d >= 0) depth[i] = depth[d]! + 1
    if (depth[i]! > bestD) { bestD = depth[i]!; best = i }
  }
  return best
}

/**
 * ANCRE LA SOURCE DANS LE MUR — remonte le torrent de la tête de vallée jusqu'au
 * bord de la carte.
 *
 * SANS ÇA, LES GUÉS NE SERVENT À RIEN, et c'est une mesure qui l'a montré, pas un
 * raisonnement. Le tronc partait du point d'écoulement le plus haut de
 * l'INTÉRIEUR (à 96 tuiles du bord, marge oblige) : il restait donc, entre sa
 * source et la montagne, un couloir de terrain praticable — et on contournait le
 * fleuve par le haut. Testé en rebouchant les gués : sur la seed 7 la vallée se
 * scindait bien en deux rives (69 % / 30 %), mais sur les seeds 2026 et 42 elle
 * restait **d'un seul tenant à 100 %**. Le fleuve n'était un obstacle qu'une fois
 * sur trois, et les six gués n'y changeaient rien.
 *
 * Un fleuve qui ne sépare rien n'est pas un fleuve, c'est un motif. On remonte
 * donc le cours d'eau jusqu'au bord : le torrent sort de la montagne. Les tuiles
 * de bordure qu'il touche seront rendues à la roche par `sealBorderRing` (qui
 * tourne après nous) — le fleuve se trouve ainsi bouché à l'amont par l'enceinte,
 * et il court d'un mur à l'autre.
 *
 * Le sud est EXCLU du repli : c'est la bouche, pas la source.
 */
function traceToRim(map: WorldMap, fromX: number, fromY: number): number[] {
  const W = map.width
  const H = map.height
  const el = map.elevation!
  const path: number[] = []
  const seen = new Uint8Array(W * H)
  let x = fromX
  let y = fromY
  for (let s = 0; s < W + H; s++) {
    const i = y * W + x
    if (seen[i] === 1) break
    seen[i] = 1
    path.push(i)
    if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) break // le bord : la source est dans le mur

    // On remonte : le voisin le plus HAUT qu'on n'a pas déjà vu.
    let bx = -1
    let by = -1
    let be = el[i]!
    for (let d = 0; d < 8; d++) {
      const nx = x + NX[d]!
      const ny = y + NY[d]!
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      if (seen[ny * W + nx] === 1) continue
      const e = el[ny * W + nx]!
      if (e > be) { be = e; bx = nx; by = ny }
    }
    if (bx >= 0) { x = bx; y = by; continue }

    // Sommet local : plus rien ne monte. On file droit au bord le plus proche —
    // l'eau sort de la montagne. (Le bord SUD est exclu : c'est la bouche.)
    const gauche = x
    const droite = W - 1 - x
    const haut = y
    const m = Math.min(gauche, droite, haut)
    if (m === haut) y -= 1
    else if (m === gauche) x -= 1
    else x += 1
  }
  return path.reverse() // du bord vers la tête : l'amont d'abord
}

/**
 * LISSE LE COURS — moyenne glissante sur les positions du chemin.
 *
 * L'arbre de drainage donne la bonne ROUTE mais une mauvaise GÉOMÉTRIE : dans un
 * plat comblé, le plus court chemin en 8-connexité est fait de segments d'axe et
 * de diagonales à 45°, et la rivière descendait la vallée à angles droits. La
 * pente infime (`FLAT_EPS`) a réglé le pire — les retours en arrière — mais pas
 * l'angularité : elle est inhérente à la métrique de la grille.
 *
 * La moyenne glissante arrondit ces angles sans déplacer le cours : **la moyenne
 * d'une droite est la droite**, donc là où le thalweg descend franchement rien ne
 * bouge ; c'est seulement dans les coins que la courbe se forme.
 *
 * LA FENÊTRE RÉTRÉCIT SYMÉTRIQUEMENT AUX BOUTS — et ce détail a coûté cher.
 * Première version : la fenêtre était simplement TRONQUÉE au bord du tableau, en
 * se disant que « les extrémités restent donc clouées ». C'est faux : une fenêtre
 * tronquée moyenne quand même, et elle tire l'extrémité VERS L'INTÉRIEUR. La
 * bouche du fleuve se retrouvait sept tuiles trop haut, et il restait, entre elle
 * et l'enceinte, un couloir praticable en bas de carte. On contournait le fleuve
 * par le sud — mesuré : la vallée restait d'un seul tenant à 100 % même en
 * rebouchant tous les gués. Le fleuve ne séparait rien.
 *
 * Avec un rayon `min(fenêtre, i, n−1−i)`, la moyenne reste centrée : au premier
 * point le rayon vaut zéro (le point ne bouge PAS), et il s'ouvre en avançant.
 * La source reste dans le mur, la bouche dans l'enceinte.
 *
 * `+ /` uniquement — exact, pur, déterministe.
 */
function smoothPath(map: WorldMap, path: readonly number[], window: number): ValleyPoint[] {
  const W = map.width
  const n = path.length
  const out: ValleyPoint[] = []
  for (let i = 0; i < n; i++) {
    const r = Math.min(window, i, n - 1 - i) // symétrique → l'extrémité est un point fixe
    let sx = 0
    let sy = 0
    let k = 0
    for (let j = i - r; j <= i + r; j++) {
      const t = path[j]!
      sx += t % W
      sy += (t / W) | 0
      k += 1
    }
    out.push({ x: sx / k, y: sy / k })
  }
  return out
}

/**
 * Grave un cours d'eau le long d'un chemin : cœur profond, berges peu profondes.
 * `paintPolyline` ne convient pas ici — il tire des segments droits entre des
 * sommets, alors que le chemin est déjà donné point par point (et il serpente
 * tout seul : c'est le RELIEF qui le fait méandrer, pas un bruit ajouté par
 * dessus, comme le faisait l'ancien tronc en ligne droite).
 */
function carveChannel(map: WorldMap, path: readonly ValleyPoint[], halfWidth: number): void {
  for (const p of path) {
    const cx = Math.round(p.x)
    const cy = Math.round(p.y)
    stampWaterBody(map, cx, cy, halfWidth + 1, halfWidth + 1, paintShallow, 0, 0)
    stampWaterBody(map, cx, cy, halfWidth, halfWidth, paintDeep, 0, 0)
  }
}

/**
 * LES GUÉS — car une rivière qui traverse la vallée la COUPE EN DEUX.
 *
 * C'est nouveau, et c'est voulu. Tant que le tronc mourait au milieu de la carte,
 * on le contournait par le bout et il n'était un obstacle pour personne : la
 * vallée était un champ ouvert où l'on marchait tout droit de n'importe où vers
 * n'importe où (mesuré : une seule composante, zéro goulot). Un fleuve qui va de
 * la tête à la bouche, lui, sépare une rive gauche d'une rive droite — cinq
 * tuiles d'eau profonde, et l'eau profonde bloque.
 *
 * Le franchissement redevient donc une DÉCISION, comme il l'était du temps du
 * squelette artisanal (« le Pont », « le Gué »). À intervalle régulier le long du
 * cours, l'eau s'élargit et se fait basse : le cœur profond redevient de l'eau
 * peu profonde, franchissable — et lente (0,5), car on ne traverse pas un fleuve
 * en courant.
 *
 * Chaque gué devient un TOPONYME (`Zone` sans `kind`) : la carte le montre dès le
 * premier jour, comme elle montre le relief. Ce n'est pas un secret à découvrir,
 * c'est la forme du pays — et c'est exactement la distinction que pose la spec
 * `lieux.md` (on cache les LIEUX, jamais le TERRAIN).
 */
function placeFords(map: WorldMap, path: readonly ValleyPoint[], seed: number): void {
  const D = Math.min(map.width, map.height)
  const spacing = Math.max(24, Math.round(D * HYDRO.FORD_SPACING_FRAC))
  const r = HYDRO.RIVER_HW + HYDRO.FORD_WIDEN
  // On saute la moitié d'un intervalle au départ : un gué collé à la source ou à
  // la bouche ne sert personne (on y est déjà passé, ou on en sort).
  // L'empreinte RÉELLE du gué déborde du rayon : `stampWaterBody` déforme son
  // disque (warp) et peut peindre jusqu'à `ceil(r × (1 + warp)) + 1`. La zone doit
  // couvrir CE rayon-là, pas `r` — sinon le toponyme ne recouvre pas le gué qu'il
  // nomme, et tout ce qui raisonne sur la zone (un test, demain un sentier) rate
  // ses bords.
  const rz = Math.ceil(r * (1 + FORD_WARP)) + 1
  let n = 0
  for (let k = Math.floor(spacing / 2); k < path.length - spacing / 2; k += spacing) {
    const p = path[k]!
    const cx = Math.round(p.x)
    const cy = Math.round(p.y)
    // Le gué s'élargit un peu (contour bruité léger : une plage de galets, pas un pont).
    stampWaterBody(map, cx, cy, r, r, paintFord, (seed ^ (k * 0x9d7)) | 0, FORD_WARP)
    n += 1
    map.zones.push({ name: `le Gué ${roman(n)}`, x: cx - rz, y: cy - rz, w: 2 * rz + 1, h: 2 * rz + 1 })
  }
}

/** Irrégularité du contour du gué — une plage de galets, pas un pont de pierre. */
const FORD_WARP = 0.25

/** Au gué, le cœur profond redevient franchissable. Le reste n'est pas touché. */
const paintFord: Paint = (cur) => (cur === TERRAIN_DEEP_WATER ? TERRAIN_SHALLOW_WATER : undefined)

const ROMANS = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const roman = (n: number): string => ROMANS[n] ?? String(n)

/**
 * Arbre de drainage vers le puits par priority-flood (Barnes 2014) : comble les
 * cuvettes du relief et, ce faisant, donne à chaque tuile sa tuile AVAL (`dir`,
 * l'index du voisin par lequel elle a été « inondée » = un pas vers le puits).
 * Suivre `dir` mène toujours au puits, sans cycle (c'est un arbre).
 *
 * LA PENTE INFIME DES PLATS (`FLAT_EPS`) — corrige un artefact qui SE VOYAIT.
 *
 * Combler une cuvette la rend PLATE : toutes ses tuiles reçoivent exactement la
 * même altitude. Le tas départage alors les ex æquo par index (`a < b`), c'est-à-
 * dire en balayage row-major — et l'inondation traverse le plat en lignes droites
 * d'axe. Le thalweg qui suit `dir` héritait fidèlement de l'artefact : sur la
 * vraie carte, la rivière descendait la vallée en **marches d'escalier à angles
 * droits**, avec des retours en arrière. Un circuit imprimé, pas un fleuve.
 *
 * Le remède est classique : en comblant, on ajoute une pente infinitésimale (le
 * voisin inondé est *un cheveu* plus haut que celui d'où l'eau est venue). Le plat
 * cesse d'être plat, l'inondation s'y propage en fronts réguliers depuis son
 * exutoire, et `dir` y devient un vrai chemin le plus court vers la sortie — ce
 * que fait une rivière qui traverse une plaine.
 *
 * 1e-7 : assez pour départager (les altitudes sont des flottants doubles), assez
 * petit pour ne rien déformer — même accumulé sur un plat de 10 000 tuiles, ça
 * reste mille fois sous l'écart entre deux bandes de biome (0,09). Arithmétique
 * exacte : une addition, rien de plus (invariant n°2 intact).
 */
const FLAT_EPS = 1e-7

function computeDrainageDir(
  map: WorldMap, seed: number, sinkX: number, sinkY: number,
): { dir: number[]; order: number[] } {
  const W = map.width
  const H = map.height
  const N = W * H
  const el = map.elevation!
  const INF = 2
  const filled = new Array<number>(N).fill(INF)
  const dir = new Array<number>(N).fill(-1)
  const order: number[] = [] // séquence de pop (aval→amont) : sert à l'accumulation de flux
  const heap = new Array<number>(N)
  let hn = 0
  const lower = (a: number, b: number): boolean =>
    filled[a]! < filled[b]! || (filled[a]! === filled[b]! && a < b)
  const swap = (i: number, j: number): void => { const t = heap[i]!; heap[i] = heap[j]!; heap[j] = t }
  const push = (i: number): void => {
    heap[hn] = i; let c = hn; hn++
    while (c > 0) { const p = (c - 1) >> 1; if (lower(heap[c]!, heap[p]!)) { swap(c, p); c = p } else break }
  }
  const pop = (): number => {
    const top = heap[0]!; hn--; heap[0] = heap[hn]!
    let c = 0
    for (;;) {
      const l = 2 * c + 1; const r = l + 1; let m = c
      if (l < hn && lower(heap[l]!, heap[m]!)) m = l
      if (r < hn && lower(heap[r]!, heap[m]!)) m = r
      if (m === c) break
      swap(c, m); c = m
    }
    return top
  }
  const sink = sinkY * W + sinkX
  filled[sink] = el[sink]!
  push(sink)
  while (hn > 0) {
    const c = pop()
    order.push(c) // aval d'abord (le sink), amont ensuite
    const cx = c % W; const cy = (c / W) | 0
    for (let d = 0; d < 8; d++) {
      const nx = cx + NX[d]!; const ny = cy + NY[d]!
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const ni = ny * W + nx
      if (filled[ni]! !== INF) continue
      // Le comblement ajoute la pente infime (cf. FLAT_EPS) : hors d'une cuvette
      // le terrain domine et rien ne change ; DANS une cuvette comblée, chaque pas
      // vers l'amont monte d'un cheveu — le plat retrouve un sens d'écoulement.
      const combli = filled[c]! + FLAT_EPS
      filled[ni] = el[ni]! > combli ? el[ni]! : combli
      dir[ni] = c // aval = la tuile par laquelle on a été inondé (vers le puits)
      push(ni)
    }
  }
  return { dir, order }
}

/**
 * ÉROSION FLUVIALE — l'eau creuse le terrain sur son passage. Accumulation de
 * flux sur l'arbre de drainage (chaque tuile = 1 + tout ce qui s'écoule à travers
 * elle), puis incision ∝ √(flux) (loi de stream-power simplifiée ; `sqrt` autorisé,
 * pas de `pow`). Le tronc (flux max) creuse une vraie vallée, les affluents des
 * ravines. Purement sur `elevation` (RENDU) — la terrain d'eau est déjà posée ;
 * l'eau se retrouve donc au FOND de ce qu'elle a creusé. Pur & déterministe.
 *
 * L'incision CROÎT vers l'aval (le flux ne fait qu'augmenter) → le chemin reste
 * descendant, aucune cuvette fermée nouvelle qui piégerait l'eau.
 */
function erodeChannels(map: WorldMap, dir: number[], order: number[]): void {
  const N = map.width * map.height
  const el = map.elevation!
  const acc = new Array<number>(N).fill(1)
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!
    const d = dir[i]!
    if (d >= 0) acc[d]! += acc[i]!
  }

  /**
   * L'INCISION S'ÉTALE AVANT DE S'APPLIQUER — et ce flou n'est pas cosmétique :
   * sans lui, LE JEU PLANTE sur une seed sur quatre.
   *
   * L'incision vaut `EROSION_DEPTH × √(acc) / √N`. Au chenal principal, `acc` vaut
   * N (toute la vallée s'y écoule) donc l'incision vaut 0,2 ; sur la berge, à UNE
   * TUILE de là, `acc` vaut 1 et l'incision vaut 0,0001. **Une falaise de 0,2 en
   * une tuile.** Le client soulève chaque tuile de `elevation × RELIEF_H` (150 px)
   * : une marche pareille replie l'image sur elle-même, et `assertNoFold` lève une
   * exception — sans garde de développement. Mesuré : les seeds 7, 2718, 4 et 5 ne
   * démarraient pas.
   *
   * C'est un artefact de MODÈLE, pas de rendu : l'accumulation de flux est
   * discrète (une tuile draine, ou ne draine pas), alors qu'une vraie vallée
   * fluviale a des VERSANTS. On étale donc l'incision sur quelques tuiles avant de
   * la soustraire — ce qui creuse une vallée en V au lieu d'une tranchée à parois
   * verticales. Le lit reste au même endroit, à la même profondeur ; il gagne des
   * berges.
   */
  const carve = new Array<number>(N)
  const norm = 1 / Math.sqrt(N) // acc au puits = N → incision max = EROSION_DEPTH
  for (let i = 0; i < N; i++) carve[i] = HYDRO.EROSION_DEPTH * Math.sqrt(acc[i]!) * norm
  boxBlur(carve, map.width, map.height, HYDRO.EROSION_BANK_TILES)

  for (let i = 0; i < N; i++) {
    const e = el[i]! - carve[i]!
    el[i] = e < 0 ? 0 : e
  }
}

/**
 * Ruisseaux de FONTE : sources en haute altitude (limite des neiges), chacune
 * tracée en aval sur l'arbre de drainage jusqu'au premier corps d'eau (rivière,
 * lac, ou un autre ruisseau déjà tracé → fusion en TOILE) ou jusqu'au marais qui
 * l'absorbe. Ils partent donc de la glace et se jettent toujours quelque part.
 */
function carveIceStreams(
  map: WorldMap, dir: number[], seed: number,
): Array<{ source: ValleyPoint; outlet: ValleyPoint }> {
  const W = map.width
  const H = map.height
  const D = Math.min(W, H)
  const margin = Math.max(3, Math.round(D * 0.05))
  const interior = (W - 2 * margin) * (H - 2 * margin)
  const count = Math.round(HYDRO.MELT_DENSITY * interior)
  const maxSteps = W + H
  const streams: Array<{ source: ValleyPoint; outlet: ValleyPoint }> = []
  for (let k = 0; k < count; k++) {
    // Source de fonte : la plus haute parmi quelques candidats, dans la tranche
    // d'altitude de la limite des neiges (au-dessus de la forêt, sous le pic).
    let sx = -1; let sy = -1; let se = -1
    for (let s = 0; s < 10; s++) {
      const x = margin + Math.floor(hash2(k * 149 + s, seed, 0x2b7) * (W - 2 * margin))
      const y = margin + Math.floor(hash2(seed, k * 149 + s, 0x4e9) * (H - 2 * margin))
      const e = elevationAt(map, x, y)
      if (e >= HYDRO.MELT_LO && e <= HYDRO.MELT_HI && e > se) { se = e; sx = x; sy = y }
    }
    if (sx < 0) continue
    let c = sy * W + sx
    let steps = 0
    let poolX = -1
    let poolY = -1
    let lastX = -1
    let lastY = -1
    while (c >= 0 && steps < maxSteps) {
      const t = map.terrain[c]!
      if (t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER) break // se jette dans l'eau → toile
      if (t === TERRAIN_MARSH) break // absorbé par le marais
      const cx = c % W; const cy = (c / W) | 0
      if (elevationAt(map, cx, cy) < HYDRO.ABSORB_AT) { poolX = cx; poolY = cy; break } // atteint le fond → forme une mare
      map.terrain[c] = TERRAIN_SHALLOW_WATER // filet de fonte franchissable
      lastX = cx; lastY = cy // dernière tuile d'eau posée = exutoire du ruisseau
      const next = dir[c]!
      if (next >= 0) {
        // Pas vers l'aval diagonal ? les deux tuiles ne se touchent que par le
        // coin → le filet paraît « cassé ». On pose une tuile-pont orthogonale
        // (la plus basse des deux : l'eau va vers le bas), ce qui rend le
        // ruisseau 4-connexe sans l'épaissir sur les segments droits.
        const nx = next % W; const ny = (next / W) | 0
        const ddx = nx - cx; const ddy = ny - cy
        if (ddx !== 0 && ddy !== 0) {
          const ea = elevationAt(map, nx, cy) // candidate horizontale
          const eb = elevationAt(map, cx, ny) // candidate verticale
          const useH = ea < eb || (ea === eb && hash2(cx, cy, 0x6d) < 0.5)
          const pi = useH ? cy * W + nx : ny * W + cx
          const pt = map.terrain[pi]
          if (pt !== TERRAIN_DEEP_WATER && pt !== TERRAIN_SHALLOW_WATER && pt !== TERRAIN_MARSH) {
            map.terrain[pi] = TERRAIN_SHALLOW_WATER
          }
        }
      }
      c = next
      steps++
    }
    if (lastX >= 0) streams.push({ source: { x: sx, y: sy }, outlet: { x: lastX, y: lastY } })
    if (poolX >= 0) {
      // Mare de fonte au pied de la pente : le ruisseau finit dans un vrai point
      // d'eau, et le fond de vallée se pique de mares (au lieu d'être sec).
      const pr = Math.max(2, Math.round(D * HYDRO.POOL_R_FRAC))
      stampWaterBody(map, poolX, poolY, pr + 1, pr + 1, paintShallow, (seed ^ (k * 71)) | 0, 0.5)
      if (pr >= 3) stampWaterBody(map, poolX, poolY, pr, pr, paintDeep, (seed ^ (k * 71)) | 0, 0.5)
    }
  }
  return streams
}

/** Tarns : petites cuvettes d'altitude (minima locaux du relief RÉEL) → poches d'eau. */
function carveTarns(map: WorldMap, seed: number): void {
  const D = Math.min(map.width, map.height)
  const margin = Math.max(4, Math.round(D * 0.06))
  const interior = (map.width - 2 * margin) * (map.height - 2 * margin)
  const count = Math.round(HYDRO.TARN_DENSITY * interior)
  const r = Math.max(2, Math.round(D * HYDRO.TARN_R_FRAC))
  let placed = 0
  for (let k = 0; k < count * 16 && placed < count; k++) {
    const x = margin + Math.floor(hash2(k * 977 + 3, seed, 0x3f1) * (map.width - 2 * margin))
    const y = margin + Math.floor(hash2(seed, k * 977 + 3, 0x7c5) * (map.height - 2 * margin))
    const e = elevationAt(map, x, y)
    if (e < HYDRO.TARN_MIN_FRAC || e > HYDRO.TARN_MAX_FRAC) continue
    if (isWater(map.terrain[y * map.width + x] ?? 0)) continue
    let isBasin = true
    for (let dy = -2; dy <= 2 && isBasin; dy += 2) {
      for (let dx = -2; dx <= 2; dx += 2) {
        if (dx === 0 && dy === 0) continue
        if (elevationAt(map, x + dx, y + dy) < e) { isBasin = false; break }
      }
    }
    if (!isBasin) continue
    stampWaterBody(map, x, y, r + 1, r + 1, paintShallow, (seed ^ (k * 53)) | 0, 0.5)
    stampWaterBody(map, x, y, r, r, paintDeep, (seed ^ (k * 53)) | 0, 0.5)
    placed += 1
  }
}

/**
 * Fusionne les plans d'eau TRÈS PROCHES : fermeture morphologique du masque d'eau
 * (dilatation de rayon R puis érosion de rayon R). Ne comble que les petits
 * interstices (≤ 2R tuiles) entre deux eaux voisines — deux mares côte à côte
 * deviennent un seul plan d'eau, les fins liserés de terre disparaissent — sans
 * jamais rétrécir une vraie eau ni relier des eaux éloignées. Le comblement est
 * peu profond (un col d'eau franchissable entre les deux). Pur, déterministe.
 */
function mergeNearbyWater(map: WorldMap, r: number): void {
  const W = map.width
  const H = map.height
  const N = W * H
  const isW = (i: number): boolean => {
    const t = map.terrain[i]
    return t === TERRAIN_DEEP_WATER || t === TERRAIN_SHALLOW_WATER
  }
  // Dilatation : marque toute tuile à ≤ r (Chebyshev) d'une eau.
  const dil = new Uint8Array(N)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let any = 0
      for (let dy = -r; dy <= r && any === 0; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= H) continue
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= W) continue
          if (isW(ny * W + nx)) { any = 1; break }
        }
      }
      dil[y * W + x] = any
    }
  }
  // Érosion de la dilatation → « fermeture » ; les tuiles de terre entièrement
  // enveloppées par la dilatation (donc dans un interstice ≤ 2r) sont comblées.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (isW(i)) continue
      let all = 1
      for (let dy = -r; dy <= r && all === 1; dy++) {
        const ny = y + dy
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || dil[ny * W + nx] === 0) { all = 0; break }
        }
      }
      if (all === 1) map.terrain[i] = TERRAIN_SHALLOW_WATER
    }
  }
}

/**
 * Grave tout le réseau d'eau dans une carte alpine (après les bandes de terrain).
 * `flow` = le champ d'écoulement macro lisse (`computeRelief`), pour situer les
 * lacs et la tête de vallée.
 *
 * L'ORDRE A CHANGÉ, ET C'EST LE CŒUR DU CORRECTIF (2026-07-13). Le puits de
 * l'arbre de drainage était **le lac** — un cul-de-sac. Toute l'eau de la vallée
 * y convergeait et s'y arrêtait ; le tronc était un segment droit tiré à la règle
 * entre la tête et le lac, puis bruité pour faire joli. Le résultat se voyait sur
 * la carte : un fil d'eau qui **mourait au milieu**, et toute la moitié sud sans
 * un ruisseau à suivre.
 *
 * Le puits est désormais **la bouche de la vallée** (le bord sud, le côté ouvert).
 * Une vallée se draine vers sa sortie : c'est vrai en montagne, et ça suffit à
 * tout remettre d'aplomb. Le tronc devient le THALWEG (il suit l'arbre, donc le
 * relief) ; les ruisseaux de fonte le rejoignent au lieu de finir dans un lac ;
 * l'accumulation de flux culmine à la bouche, donc l'érosion y creuse une vraie
 * vallée. Et le fleuve traverse — donc il SÉPARE, donc il faut des gués.
 */
export function carveHydrology(
  map: WorldMap, flow: number[], seed: number,
): Array<{ source: ValleyPoint; outlet: ValleyPoint }> {
  const D = Math.min(map.width, map.height)

  const lake = carveLakes(map, flow, seed)               // 1..4 lacs, formes diverses ; principal renvoyé
  const mouth = valleyMouth(map)                         // là où l'eau s'en va
  const { dir, order } = computeDrainageDir(map, seed, mouth.x, mouth.y)

  // LE TRONC, en deux brins qui fusionnent d'eux-mêmes (ils suivent le même arbre) :
  //  — de la tête de vallée jusqu'à la bouche : le cours principal ;
  //  — du lac jusqu'à la bouche : son émissaire.
  // Si le thalweg passe déjà par le lac, les deux brins se confondent en aval et
  // le second ne fait que repeindre de l'eau. Sinon, le lac a son propre exutoire —
  // ce qui est le cas d'un vrai lac de vallée posé à l'écart du cours principal.
  const src = farthestSource(dir, order) // le plus long affluent : le fleuve est long par construction
  const head = { x: src % map.width, y: (src / map.width) | 0 }
  const win = Math.max(2, Math.round(D * HYDRO.SMOOTH_FRAC))
  // D'UN MUR À L'AUTRE : la source remonte jusqu'au bord (où l'enceinte la bouchera),
  // puis le thalweg descend jusqu'à la bouche. Sans le premier brin, on contournait
  // le fleuve par sa source et les gués ne servaient à rien (mesuré).
  const amont = traceToRim(map, head.x, head.y)
  const aval = traceThalweg(map, dir, head.x, head.y)
  const trunk = smoothPath(map, [...amont, ...aval], win)
  const outflow = smoothPath(map, traceThalweg(map, dir, lake.x, lake.y), win)
  carveChannel(map, trunk, HYDRO.RIVER_HW)
  carveChannel(map, outflow, HYDRO.RIVER_HW)

  // Le fleuve coupe la vallée en deux rives : on la recoud, à intervalles choisis.
  placeFords(map, trunk, seed)

  const streams = carveIceStreams(map, dir, seed)        // ruisseaux de fonte → rivière / lac / marais
  carveTarns(map, seed)
  mergeNearbyWater(map, 2)                               // fusionne les plans d'eau très proches
  erodeChannels(map, dir, order)                         // DERNIER : l'eau creuse son lit dans l'élévation (rendu)
  return streams                                         // (source, exutoire) par ruisseau — pour tests de continuité
}
