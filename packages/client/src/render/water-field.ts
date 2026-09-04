/**
 * LE CHAMP D'EAU — ce que le shader a besoin de savoir de la carte, cuit une
 * fois, en une texture de 1 px par tuile (même résolution que le bake du sol).
 *
 * Pur : aucun import Phaser, donc testable en Node. Le wrapper qui en fait une
 * texture WebGL vit dans `scenes/world/water-layer.ts`.
 *
 *   R — LE MASQUE, et il est BINAIRE : ≥ 128 dans l'eau, 0 sur la terre. Rien entre
 *       les deux, et c'est essentiel. En filtrage linéaire, un masque binaire
 *       croise 0,5 EXACTEMENT sur la frontière entre deux tuiles : le shader tient
 *       donc son trait de rive au bon endroit, au pixel près. La première version
 *       encodait la profondeur dans ce canal (0,45 pour un haut-fond) — l'eau
 *       débordait alors d'une demi-tuile sur l'herbe, et son écume avec elle.
 *       Les 7 bits SOUS le masque portent LES CHUTES (spec `terrasses.md` T-R8quater,
 *       `chutesDe`) : qui est lèvre d'une marche d'eau, qui en est le pied — décidé ici,
 *       une fois, pour que le shader n'ait pas à sonder ses voisines à chaque pixel.
 *       Le shader lit le masque en `step(0,25, R)` : les drapeaux ne le déplacent pas.
 *   G — PROFONDEUR CASE À CASE (geste 01, eau-fond) : 0 sur le haut-fond, 255 au
 *       cœur profond, et la TUILE FRONTIÈRE (profonde, touchant un haut-fond) porte
 *       un poids intermédiaire biaisé profond (0,70 ± 0,08, ondulé par hash de
 *       tuile) — le même langage que le lerp de la passe 2 du bake des biomes,
 *       côté profond seulement : les tuiles marchables gardent leur luminance.
 *       (Le canal portait l'élévation, morte avec la carte plate — R35 caduque.)
 *   B — RÉGIME (geste 10, eau-fond) : 0 = eau normale · 200 = LAC MORT (l'eau trop
 *       claire). Le canal portait le profond binaire, redondant depuis que G porte
 *       la profondeur. (Le régime 120 — l'eau morte du marais — a existé un soir :
 *       regardé, refusé par Alexis le 2026-07-26.)
 *   A — 1, toujours. Un canal alpha non plein serait prémultiplié à l'upload et
 *       corromprait les trois autres.
 *
 * La distance au rivage n'est PAS cuite ici : le shader la déduit du masque en
 * le sondant sur quelques tuiles autour de lui. C'est plus juste (elle suit la
 * berge, pas une grille) et ça épargne un canal.
 */

/** Les deux terrains d'eau (ids de `TERRAINS`, sim/balance.ts). */
const SHALLOW = 4
const DEEP = 6
/** Les deux terrains de MARAIS — le sol mou (`peche.md`, décision d'Alexis 2026-08-24). Ils ont
 *  droit au même SDF que l'eau : l'acteur s'y enfonce, et « s'enfoncer » est une PENTE. */
const MARSH = 8
const REED_MARSH = 19
/** Le masque d'eau — le milieu par défaut du champ de rive. */
export const MILIEU_EAU: readonly number[] = [SHALLOW, DEEP]
/** Le masque de VASE : ce dans quoi on s'enlise sans nager. */
export const MILIEU_VASE: readonly number[] = [MARSH, REED_MARSH]

/** LE PROFIL DE LA RAMPE (geste 01, élargi sur demande d'Alexis « lerp encore plus ») :
 *  cinq anneaux autour de l'arête shallow|deep — deux côté haut-fond, trois côté
 *  profond — que le lerp bilinéaire du shader fond en un dégradé de ~5 tuiles.
 *  Index : 0 rien · 1 = S2 (haut-fond, 2 tuiles de l'arête) · 2 = S1 (contre l'arête)
 *  · 3 = D1 · 4 = D2 · 5 = D3. L'ondulation ±0,05 par tuile garde les iso-lignes
 *  courbes. Les extrêmes (haut-fond loin = 0, cœur profond = 1) restent purs : le
 *  contraste du gué (R10, ≥ 1,4:1) se re-mesure après chaque retouche du profil. */
const RAMPE_PROFIL = [0, 0.1, 0.28, 0.55, 0.8, 0.93] as const
const RAMPE_ONDULATION = 0.05

/** Hash positionnel (le patron imul des feuilles) — l'ondulation du poids de la
 *  tuile frontière, stable par carte, jamais `Math.random`. */
function hache(x: number, y: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) & 0xffff) / 0x10000
}

/** Portée du champ de rive, en tuiles (bornée par l'encodage 128 ± d×16 sur un octet). */
export const RIVE_MAX_TILES = 7.9

/**
 * LE CHAMP DE RIVE (spec eau-vivante R1) — la distance SIGNÉE à la rive : positive dans
 * l'eau, négative sur terre, ZÉRO pile sur la frontière des tuiles. Un SDF de berge.
 *
 * Deux chanfreins 3-4 (vers la terre, vers l'eau) donnent la distance au CENTRE de la
 * tuile opposée la plus proche ; on retranche une demi-tuile pour que le zéro tombe sur
 * l'ARÊTE — ainsi un bilinéaire (GPU manuel ou CPU) croise 0 exactement sur le trait de
 * rive que le masque binaire dessine déjà. Encodage texture : `128 + d×16` (1/16 tuile).
 *
 * Une SEULE vérité de « où est l'eau » : l'écume, le lit, le sol humide, l'immersion des
 * acteurs, les événements de franchissement et le volume du clapotis lisent tous ce champ.
 */
export interface RiveField {
  /** Distance signée en TUILES (+eau / −terre), par tuile. */
  sd: Float32Array
  /** RGBA prêt pour la texture : R = 128 + clamp(sd, ±7,9)×16, A = 255. */
  data: Uint8ClampedArray
  width: number
  height: number
}

/**
 * ⚠ LE MILIEU EST UN PARAMÈTRE depuis le 2026-08-24 — la fonction ne connaît plus « l'eau »,
 * elle connaît « un dedans et un dehors ». C'est ce qui donne au MARAIS la même transition
 * continue qu'à l'eau (demande d'Alexis : « la même chose pour le marais ») sans dupliquer
 * cinquante lignes de chanfrein : un second champ, le même code, un autre masque.
 *
 * `avecTexture` : le RGBA n'est utile qu'au SHADER de l'eau. Le champ de vase ne sert qu'au
 * CPU (l'immersion des acteurs) — lui cuire une texture de 15 Mo serait payer pour rien.
 */
export function buildRiveField(
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  milieu: readonly number[] = MILIEU_EAU,
  avecTexture = true,
): RiveField {
  const N = width * height
  // Le masque APLATI d'abord (revue, MESURÉ : appeler une closure des millions de
  // fois dominait le coût du chanfrein plein-cadre — 520-610 ms de boot). Le milieu passe
  // par une TABLE indexée par id de terrain, pas par un prédicat : une lecture de tableau
  // par tuile, exactement comme avant, quel que soit le nombre d'ids.
  const dedans = new Uint8Array(256)
  for (const t of milieu) dedans[t] = 1
  const eauMask = new Uint8Array(N)
  for (let i = 0; i < N; i++) eauMask[i] = dedans[terrain[i] ?? 0]!
  // LA BANDE, PAS LA CARTE (2e passe de la revue : même en tableau plat, deux chanfreins
  // pleins-cadres coûtaient ~250-380 ms sur 3,75 M de tuiles). Le champ ne sert que sous
  // ±8 tuiles du rivage : une expansion de DIAL (poids 3/4, seaux 0..CAP) depuis les
  // cellules de CONTACT ne visite que le voisinage du rivage — ~rivage × 16 cellules.
  // d = distance au milieu OPPOSÉ en tiers de tuile, propagée DANS son milieu (le plus
  // court chemin vers l'autre milieu ne traverse jamais l'autre milieu : il s'y arrête).
  const CAP = Math.ceil((RIVE_MAX_TILES + 1) * 3)
  const d = new Uint16Array(N).fill(CAP)
  const seaux: number[][] = []
  for (let k = 0; k <= CAP; k++) seaux.push([])
  // Les graines : chaque paire de voisins de milieux OPPOSÉS seed ses deux cellules —
  // 3 (contact ortho) ou 4 (contact diagonal pur, le coin rectiligne du worldgen).
  for (let y = 0; y < height; y++) {
    const fin = y < height - 1
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const e = eauMask[i]!
      if (x < width - 1 && eauMask[i + 1] !== e) {
        if (d[i]! > 3) { d[i] = 3; seaux[3]!.push(i) }
        if (d[i + 1]! > 3) { d[i + 1] = 3; seaux[3]!.push(i + 1) }
      }
      if (fin && eauMask[i + width] !== e) {
        if (d[i]! > 3) { d[i] = 3; seaux[3]!.push(i) }
        if (d[i + width]! > 3) { d[i + width] = 3; seaux[3]!.push(i + width) }
      }
      if (fin && x < width - 1 && eauMask[i + width + 1] !== e) {
        if (d[i]! > 4) { d[i] = 4; seaux[4]!.push(i) }
        if (d[i + width + 1]! > 4) { d[i + width + 1] = 4; seaux[4]!.push(i + width + 1) }
      }
      if (fin && x > 0 && eauMask[i + width - 1] !== e) {
        if (d[i]! > 4) { d[i] = 4; seaux[4]!.push(i) }
        if (d[i + width - 1]! > 4) { d[i + width - 1] = 4; seaux[4]!.push(i + width - 1) }
      }
    }
  }
  // L'expansion : monotone par seaux croissants — chaque cellule se fixe à sa première
  // sortie (une entrée plus tardive dans un seau porte forcément une distance ≥).
  for (let k = 3; k <= CAP; k++) {
    const seau = seaux[k]!
    for (let s = 0; s < seau.length; s++) {
      const i = seau[s]!
      if (d[i]! < k) continue // fixée par un chemin plus court — entrée périmée
      const e = eauMask[i]!
      const x = i % width
      const y = (i - x) / width
      const relaxe = (j: number, poids: number): void => {
        if (eauMask[j] !== e) return // la distance se propage DANS son milieu
        const nv = k + poids
        if (nv < d[j]! && nv <= CAP) {
          d[j] = nv
          seaux[nv]!.push(j)
        }
      }
      if (x > 0) relaxe(i - 1, 3)
      if (x < width - 1) relaxe(i + 1, 3)
      if (y > 0) {
        relaxe(i - width, 3)
        if (x > 0) relaxe(i - width - 1, 4)
        if (x < width - 1) relaxe(i - width + 1, 4)
      }
      if (y < height - 1) {
        relaxe(i + width, 3)
        if (x > 0) relaxe(i + width - 1, 4)
        if (x < width - 1) relaxe(i + width + 1, 4)
      }
    }
  }
  // L'encodage en UNE passe, écritures 32 bits, chemins RAPIDES pour le loin (l'écrasante
  // majorité des cellules est à d = CAP : deux constantes préchiffrées, zéro arithmétique).
  const sd = new Float32Array(N)
  // Sans texture (le champ de vase), on n'alloue pas 4 octets par tuile pour rien — 15 Mo
  // sur une carte de production. Un tampon d'UNE cellule reçoit alors les écritures u32.
  const data = new Uint8ClampedArray(avecTexture ? N * 4 : 4)
  const u32 = new Uint32Array(data.buffer) // little-endian : R au poids faible, A au fort
  const iu = (i: number): number => (avecTexture ? i : 0)
  // G = B = 128 PARTOUT par défaut : ces canaux portent le COURANT (flow-field.ts,
  // encodé 128 + dir×112 par water-layer) et 128 pile décode « pas de courant » —
  // un zéro y ferait dériver TOUTE l'eau en diagonale (revue adversariale, bloquant).
  const R_TERRE_LOIN = Math.round(128 - RIVE_MAX_TILES * 16)
  const R_EAU_LOIN = Math.round(128 + RIVE_MAX_TILES * 16)
  const U_TERRE_LOIN = 0xff808000 | R_TERRE_LOIN
  const U_EAU_LOIN = 0xff808000 | R_EAU_LOIN
  for (let i = 0; i < N; i++) {
    const di = d[i]!
    if (di >= CAP) {
      if (eauMask[i] === 1) {
        sd[i] = RIVE_MAX_TILES
        u32[iu(i)] = U_EAU_LOIN
      } else {
        sd[i] = -RIVE_MAX_TILES
        u32[iu(i)] = U_TERRE_LOIN
      }
      continue
    }
    // La demi-tuile retranchée place le zéro sur l'ARÊTE entre deux centres voisins.
    const brut = eauMask[i] === 1 ? di / 3 - 0.5 : -(di / 3 - 0.5)
    const borne = Math.max(-RIVE_MAX_TILES, Math.min(RIVE_MAX_TILES, brut))
    sd[i] = borne
    u32[iu(i)] = 0xff808000 | Math.round(128 + borne * 16)
  }
  return { sd, data, width, height }
}

/** Lecture CPU bilinéaire du champ (x, y en tuiles) — la même distance que le shader. */
export function riveAt(field: RiveField, x: number, y: number): number {
  const px = x - 0.5
  const py = y - 0.5
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  const fx = px - ix
  const fy = py - iy
  const lit = (tx: number, ty: number): number => {
    const cx = Math.max(0, Math.min(field.width - 1, tx))
    const cy = Math.max(0, Math.min(field.height - 1, ty))
    return field.sd[cy * field.width + cx]!
  }
  const a = lit(ix, iy)
  const b = lit(ix + 1, iy)
  const c = lit(ix, iy + 1)
  const d = lit(ix + 1, iy + 1)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

export interface WaterField {
  /** RGBA, 4 octets par tuile, `width × height`. */
  data: Uint8ClampedArray
  width: number
  height: number
  /** Faux si la carte n'a pas une seule tuile d'eau — inutile de monter la couche. */
  hasWater: boolean
}

/**
 * LA MÉMOIRE DU FOND (geste 03, eau-fond) — le lit de l'eau a une MATIÈRE.
 *
 * Le worldgen écrase le terrain par les ids d'eau : ce qu'il y avait dessous est
 * perdu, et la réfraction du shader rééchantillonnait… la couleur d'eau bakée
 * elle-même (le cyan du bake, consigné dans l'état des lieux). Ce champ INFÈRE un
 * fond plausible — variante client seul, actée sur l'artefact eau-fond :
 *
 *   SABLE   près des berges (le champ de rive donne la distance),
 *   GALETS  là où le courant porte (le lit de la rivière est lavé),
 *   VASE    partout ailleurs, qui fonce en s'éloignant du bord.
 *
 * 1 px/tuile, RGB = couleur du lit, A = 255 (jamais prémultiplié à tort), lu par le
 * shader (`uFond`) à la place du bake pour la réfraction et le lit visible. Le bake
 * (`uSeabed`) reste la vérité de la COULEUR DE RIVE (l'écume s'y teinte).
 * Moucheté par hash de tuile — des aplats qui vivent, jamais un dégradé.
 */
const FOND_SABLE: [number, number, number] = [150, 128, 86]
const FOND_GALETS: [number, number, number] = [109, 104, 94]
const FOND_VASE: [number, number, number] = [86, 66, 42]
const FOND_VASE_PROFONDE: [number, number, number] = [60, 47, 30]
/** Seuil de norme de courant au-delà duquel le lit est lavé (galets). */
const FOND_COURANT_GALETS = 0.3
/** Le sable s'arrête à cette distance de la rive (tuiles) ; la vase prend ensuite. */
const FOND_SABLE_TUILES = 1.6

/** Le lit du Lac Mort (geste 10) : des galets pâles, froids — un fond qu'on voit TROP bien. */
const FOND_LAC_MORT: [number, number, number] = [138, 142, 136]

/** Les herbiers (geste 09, repris) : des TUILES d'algues dans le langage du sol —
 *  des aplats 1 px/tuile comme le bake, jamais un blob shader (retour d'Alexis). */
const FOND_ALGUE: [number, number, number] = [64, 84, 54]
/** Les algues poussent par plaques : un hash de région (blocs de 8 tuiles) ouvre la
 *  plaque, un hash fin sème les tuiles dedans — des massifs épars, jamais un tapis. */
const ALGUE_REGION = 0.55
const ALGUE_TUILE = 0.5
/** Pas d'algues dans la bande du lit visible : le bord reste sable. */
const ALGUE_RIVE_MIN = 1.3

export function buildFondField(
  terrain: ArrayLike<number>,
  sd: Float32Array,
  courant: ReadonlyMap<number, { x: number; y: number }> | null,
  width: number,
  height: number,
  regime?: ArrayLike<number>,
  /** Tampon de sortie (ex. l'ImageData de la texture) — épargne une copie de 15 Mo
   *  sur la carte pleine (budget A10 : le boot de l'eau se chronomètre). */
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  const data = out ?? new Uint8ClampedArray(width * height * 4)
  // LA TERRE D'ABORD, EN BLOC (budget A10, MESURÉ : la version qui hachait chaque tuile
  // coûtait ~290 ms sur la carte pleine — pour 95 % de tuiles de terre que le shader
  // n'échantillonne jamais au-delà de la marge de réfraction). Un remplissage u32
  // constant : la terre porte du sable — la réfraction qui déborde d'un rien près du
  // bord trouve une plage, pas un trou noir. Le moucheté n'existe que sous l'eau.
  const u32 = new Uint32Array(data.buffer, data.byteOffset, width * height)
  u32.fill(0xff000000 | (FOND_SABLE[2] << 16) | (FOND_SABLE[1] << 8) | FOND_SABLE[0])
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const t = terrain[i]
      if (t !== SHALLOW && t !== DEEP) continue
      let base: [number, number, number]
      let galet = false
      if (regime?.[i] === REGIME_LAC_MORT) {
        // Le Lac Mort (geste 10) montre son fond partout — des galets pâles, froids.
        base = FOND_LAC_MORT
      } else if (t === SHALLOW) {
        // LE HAUT-FOND EST SABLE (ou galets sous le courant), PARTOUT : c'est le lit
        // qu'on FOULE — marchable = clair, la lisibilité du gué (R10) passe par lui.
        // La vase est réservée au profond : la première écriture la faisait commencer
        // à 1,6 tuile de la rive, en plein cœur du gué — le haut-fond mesuré fonçait
        // de ~10 % et A4 tombait à 1,38:1 (MESURÉ). La matière suit le TERRAIN.
        const v = courant?.get(i)
        const mag = v ? Math.sqrt(v.x * v.x + v.y * v.y) : 0
        if (mag > FOND_COURANT_GALETS) {
          base = FOND_GALETS
          galet = true
        } else if (
          mag < 0.1 &&
          (sd[i] ?? 0) > ALGUE_RIVE_MIN &&
          hache((x >> 3) + 911, (y >> 3) + 613) > ALGUE_REGION &&
          hache(x + 331, y + 577) > ALGUE_TUILE
        ) {
          // L'HERBIER : des massifs de tuiles d'algues sur le haut-fond CALME, loin du
          // bord — le courant les interdit (la rivière reste nue), la rive reste sable.
          base = FOND_ALGUE
        } else {
          base = FOND_SABLE
        }
      } else {
        // La vase du profond fonce avec la distance au bord — par la même rampe que
        // l'œil : on ne voit plus le fond, il devient nuit.
        const d = sd[i] ?? 0
        const prof = Math.min(1, Math.max(0, d - FOND_SABLE_TUILES) / 5)
        base = [
          FOND_VASE[0] + (FOND_VASE_PROFONDE[0] - FOND_VASE[0]) * prof,
          FOND_VASE[1] + (FOND_VASE_PROFONDE[1] - FOND_VASE[1]) * prof,
          FOND_VASE[2] + (FOND_VASE_PROFONDE[2] - FOND_VASE[2]) * prof,
        ]
      }
      // Le moucheté : ±8 % par tuile, et le gros galet clair de loin en loin.
      const n = hache(x + 7919, y + 104729)
      let gain = 0.92 + n * 0.16
      if (galet && n > 0.82) gain = 1.18
      const o = i * 4
      data[o] = Math.round(base[0] * gain)
      data[o + 1] = Math.round(base[1] * gain)
      data[o + 2] = Math.round(base[2] * gain)
      data[o + 3] = 255
    }
  }
  return data
}

/** Le masque d'eau du canal R : l'eau vaut `MASQUE_EAU + drapeaux`, la terre 0. */
export const MASQUE_EAU = 128

/**
 * LES DRAPEAUX DE CHUTE (spec `terrasses.md` T-R8quater) — les 7 bits sous le masque.
 *
 * Une marche d'eau dont la paroi regarde le nord, l'est ou l'ouest n'a pas de face à peindre :
 * la projection (`LIFT_TUILES` = 2 tuiles par palier, tri par strate) la réduit à un pli d'un
 * pixel. Ce qui se voit d'une chute vue de haut, c'est SA LÈVRE — le bourrelet blanc là où l'eau
 * bascule, sur la tuile HAUTE — et SON PIED — l'écume et les bulles sur l'eau BASSE, là où l'écran
 * la montre à côté de la lèvre. La géométrie du « à côté » est celle de la projection, pas du
 * monde : une tuile de palier p se dessine `2p` rangs plus haut. D'où, pour une tuile basse (x, y)
 * au palier q :
 *   • RIDEAU_E — la chute qui regarde l'EST tombe de (x−1, y+k), k ∈ {1, 2}, au palier q+1 : sa
 *     paroi de 2 tuiles de haut occupe, à l'écran, les rangs de (x, y+1) et (x, y+2)… c'est-à-dire
 *     de MOI, une ou deux tuiles au nord du pied réel (x, y+k), lequel est caché sous le quad haut.
 *   • PIED_N — la lèvre nord de (x, y+3) au palier q+1 se dessine JUSTE SOUS mon bord sud (rang
 *     y+3−2(q+1) = y−2q+1) : l'écume et les bulles se posent sur moi ; et (x, y+4) une tuile plus
 *     loin (PIED_N = 2) porte la brume, plus haut encore.
 * Seul l'écart d'UN palier est une chute (T-A3 : ±1 entre voisines) ; un décroché de deux
 * paliers n'a pas de lèvre — sa paroi (4 tuiles) n'est pas celle qu'on a dessinée.
 */
export const CHUTE_LEVRE_N = 1 // je suis haute ; l'eau au NORD est un palier plus bas
export const CHUTE_LEVRE_E = 2 // … à l'EST
export const CHUTE_LEVRE_O = 4 // … à l'OUEST
export const CHUTE_RIDEAU_E = 8 // je suis basse, à l'est d'une chute qui regarde l'est : rideau sur mon bord OUEST
export const CHUTE_RIDEAU_O = 16 // … à l'ouest d'une chute qui regarde l'ouest : rideau sur mon bord EST
export const CHUTE_PIED_N = 32 // ×1 : la lèvre nord est sous mon bord sud · ×2 : une tuile plus loin (la brume)
/** Une lèvre est/ouest ne compte que sur une couture d'au moins tant de tuiles (voir `chutesDe`). */
export const CHUTE_RUN_MIN = 3

/** Les drapeaux de chute de chaque tuile (0 partout sur une carte plate). Exporté pour les tests. */
export function chutesDe(
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  palier: ArrayLike<number>,
): Uint8Array {
  const flags = new Uint8Array(width * height)
  const wet = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const t = terrain[y * width + x]
    return t === SHALLOW || t === DEEP
  }
  const pal = (x: number, y: number): number => palier[y * width + x] ?? 0
  // Une lèvre : de l'eau, dont la voisine est de l'eau UN palier plus bas.
  const levreBrute = (x: number, y: number, dx: number, dy: number): boolean =>
    wet(x, y) && wet(x + dx, y + dy) && pal(x + dx, y + dy) === pal(x, y) - 1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!wet(x, y)) continue
      let f = 0
      if (levreBrute(x, y, 0, -1)) f |= CHUTE_LEVRE_N
      if (levreBrute(x, y, 1, 0)) f |= CHUTE_LEVRE_E
      if (levreBrute(x, y, -1, 0)) f |= CHUTE_LEVRE_O
      flags[y * width + x] = f
    }
  }
  // LES LÈVRES EST/OUEST NE VALENT QUE SUR UNE COUTURE QUI COURT (≥ CHUTE_RUN_MIN tuiles du nord
  // au sud). Une marche en ESCALIER (la lisière d'une terrasse suit une courbe de niveau : des
  // lèvres nord d'une ou deux tuiles, des lèvres est d'une tuile, en diagonale) n'a pas de paroi
  // dressée — la couche des parois n'en dresse que sous les faces sud — et son rideau de deux
  // tuiles y peignait un mur que le sol ne montre pas : regardé le 2026-09-03 (marche nord de la
  // graine 2026), un nuage blanc de trois tuiles. Là, seule la lèvre nord dessine la marche.
  for (let x = 0; x < width; x++) {
    for (const bit of [CHUTE_LEVRE_E, CHUTE_LEVRE_O]) {
      let debut = -1
      for (let y = 0; y <= height; y++) {
        const a = y < height && (flags[y * width + x]! & bit) !== 0
        if (a && debut < 0) debut = y
        if (!a && debut >= 0) {
          if (y - debut < CHUTE_RUN_MIN) for (let k = debut; k < y; k++) flags[k * width + x]! &= ~bit
          debut = -1
        }
      }
    }
  }
  const levre = (x: number, y: number, bit: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && (flags[y * width + x]! & bit) !== 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!wet(x, y)) continue
      let f = flags[y * width + x]!
      const q = pal(x, y)
      // Le pied d'une chute latérale : la lèvre est UN palier au-dessus, une ou deux tuiles au sud.
      for (let k = 1; k <= 2; k++) {
        if (levre(x - 1, y + k, CHUTE_LEVRE_E) && pal(x - 1, y + k) === q + 1) f |= CHUTE_RIDEAU_E
        if (levre(x + 1, y + k, CHUTE_LEVRE_O) && pal(x + 1, y + k) === q + 1) f |= CHUTE_RIDEAU_O
      }
      if (levre(x, y + 3, CHUTE_LEVRE_N) && pal(x, y + 3) === q + 1) f |= CHUTE_PIED_N
      else if (levre(x, y + 4, CHUTE_LEVRE_N) && pal(x, y + 4) === q + 1) f |= CHUTE_PIED_N * 2
      flags[y * width + x] = f
    }
  }
  return flags
}

/** Les régimes d'eau du canal B (geste 10). */
export const REGIME_NORMAL = 0
export const REGIME_LAC_MORT = 2
/** LE BIEF SOUILLÉ (spec `cendre.md` R26d) — l'eau que la coulée de suie a prise : grise,
 *  molle, le ciel s'y éteint. Canal B à 100 (le lac mort tient 200 — deux seuils du shader). */
export const REGIME_SUIE = 3

export function buildWaterField(
  terrain: ArrayLike<number>,
  width: number,
  height: number,
  /** Régime par tuile (REGIME_*) — absent : tout est eau normale. */
  regime?: ArrayLike<number>,
  /**
   * LE PALIER de chaque tuile (spec `terrasses.md` T-R7), 0..3 — absent : tout au palier 0.
   * Il se range dans les UNITÉS du canal B, sous le régime (0 / 100 / 200) : le shader lit
   * `mod(B × 255, 100)` pour le palier, et ses seuils de régime (0,30 · 0,63) ne voient pas
   * trois unités. Un canal à soi aurait coûté une cinquième texture pour deux bits.
   */
  palier?: ArrayLike<number>,
): WaterField {
  const data = new Uint8ClampedArray(width * height * 4)
  let hasWater = false
  const chutes = palier ? chutesDe(terrain, width, height, palier) : null

  for (let i = 0; i < width * height; i++) {
    const t = terrain[i]
    const wet = t === SHALLOW || t === DEEP
    if (wet) hasWater = true

    const o = i * 4
    data[o] = wet ? MASQUE_EAU + (chutes?.[i] ?? 0) : 0 // masque BINAIRE + drapeaux de chute — voir l'en-tête
    // G (profondeur) : 0 par défaut — la 2e passe pose le profond et sa frontière.
    data[o + 2] = (regime?.[i] === REGIME_LAC_MORT ? 200 : regime?.[i] === REGIME_SUIE ? 100 : 0) + (palier?.[i] ?? 0)
    data[o + 3] = 255
  }

  // ═══ LA PROFONDEUR EN RAMPE (geste 01, élargi) ═══
  // Cinq anneaux depuis l'arête shallow|deep (4-voisinage : un coin n'est pas une
  // couture), fondus ensuite par le bilinéaire du shader : la transition s'étale sur
  // ~5 tuiles au lieu d'une. Les anneaux côté haut-fond assombrissent un peu le bord
  // marchable — assumé (demande « lerp encore plus ») : le CENTRE du gué reste à 0,
  // et la sonde A4 exclut de toute façon les tuiles au contact.
  const ring = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const t = terrain[i]
      if (t !== DEEP && t !== SHALLOW) continue
      // L'AUTRE eau en 4-voisinage — inliné : une closure ici s'allouait par tuile
      // d'eau et triplait le coût de la passe (106 → 327 ms au banc, MESURÉ).
      const autre = t === DEEP ? SHALLOW : DEEP
      const bord =
        (x > 0 && terrain[i - 1] === autre) ||
        (x < width - 1 && terrain[i + 1] === autre) ||
        (y > 0 && terrain[i - width] === autre) ||
        (y < height - 1 && terrain[i + width] === autre)
      if (bord) ring[i] = t === DEEP ? 3 : 2
    }
  }
  // Les 2es anneaux (S2/D2), puis le 3e côté profond (D3) — chaque passe ne lit que
  // les valeurs posées par la précédente : la propagation reste symétrique.
  const dilate = (deVal: number, versTerrain: number, versVal: number): void => {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (ring[i] !== 0 || terrain[i] !== versTerrain) continue
        const touche =
          (x > 0 && ring[i - 1] === deVal) ||
          (x < width - 1 && ring[i + 1] === deVal) ||
          (y > 0 && ring[i - width] === deVal) ||
          (y < height - 1 && ring[i + width] === deVal)
        if (touche) ring[i] = versVal
      }
    }
  }
  dilate(2, SHALLOW, 1)
  dilate(3, DEEP, 4)
  dilate(4, DEEP, 5)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const t = terrain[i]
      const r = ring[i]!
      let poids: number
      if (t === DEEP) poids = r >= 3 ? RAMPE_PROFIL[r]! : 1
      else if (t === SHALLOW && r > 0) poids = RAMPE_PROFIL[r]!
      else continue
      poids += (hache(x, y) - 0.5) * 2 * RAMPE_ONDULATION
      data[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, poids)) * 255)
    }
  }

  return { data, width, height, hasWater }
}
