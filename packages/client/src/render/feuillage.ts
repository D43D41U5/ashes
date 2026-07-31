/**
 * LE FEUILLAGE D'UN HOUPPIER — le relief ET l'albédo d'une cime, dérivés ensemble.
 *
 * ═══ POURQUOI CE MODULE EXISTE ═══
 *
 * L'albédo d'un houppier était RIGOUREUSEMENT uniforme : une seule couleur, sur toute la
 * silhouette. Pas « presque plat » — MESURÉ le 2026-07-30, l'écart moyen entre deux pixels
 * voisins vaut **0,00 sur les onze variantes**. Et son contour était une BOÎTE : le périmètre
 * du masque égalait exactement celui de sa boîte englobante (découpe 1,00). Le mécanisme censé
 * lui donner sa forme (`silhouette: 2`, l'union des deux premiers rects) produit pour un feuillu
 * une croix — or l'union d'une croix a précisément le périmètre de son rectangle englobant.
 * Le dispositif de forme rendait une boîte.
 *
 * Le fût avait exactement le même défaut, et `ecorce.ts` l'a réglé le 2026-07-29 : *« Il
 * remplissait un rectangle d'une seule couleur : c'est pour ça qu'il n'y avait aucune texture à
 * voir sur un tronc. »* Ce module est son pendant pour la cime, et il en reprend le patron à la
 * lettre — **relief et ton calculés dans la MÊME boucle**, parce que deux passes séparées
 * finissent toujours par se décaler.
 *
 * ═══ LE LEVIER, ET C'EST LUI QUI FAIT LA QUALITÉ ═══
 *
 * Le relief ne sert pas à peindre une ombre : il est passé à `normalFromCanvas` (le paramètre
 * `relief`, déjà emprunté par le fût). Chaque touffe reçoit donc sa VRAIE normale et se fait
 * éclairer par le soleil du jeu — au lieu d'un dégradé peint sur une dalle. On n'ajoute pas de
 * l'ombrage à l'albédo, on donne de la FORME à la lumière.
 *
 * Ce que l'albédo porte, lui, reste de la MATIÈRE — la doctrine de `matiere.ts` : une masse de
 * feuilles profonde n'a pas le ton d'une feuille de plein soleil, comme le creux d'un sillon
 * d'écorce n'a pas le ton de sa plaque. On reste donc dans la fourchette `corps → lumiere` de la
 * famille, et on ne touche PAS à `ombre` : celui-là serait un ombrage, et l'aplatissement `_lit`
 * le rejette à juste titre.
 *
 * ═══ LE BORD SE DÉCOUPE PAR SOUSTRACTION ═══
 *
 * Les touffes ne DÉBORDENT jamais la silhouette d'origine : elles la creusent. C'est ce qui
 * garantit que `houppierS`, `hauteurPx` et le compte entier de tuiles (E1) restent vrais au
 * pixel près — un houppier qui grandirait ferait mentir six mesures. Le contour devient
 * irrégulier parce que les touffes ne remplissent pas les coins, jamais parce qu'on ajoute
 * de la matière dehors.
 *
 * Et l'ASSISE est protégée : la zone par laquelle la cime repose sur le fût reste pleine, quoi
 * que disent les touffes. Sans ça, un houppier se mettrait à flotter — la panne exacte que
 * `assiseHouppier` garde depuis le 2026-07-28.
 *
 * Pur : aucun import Phaser, testable en Node.
 */

/** Hash déterministe — le patron `imul` du reste du rendu, jamais `Math.random`. */
function hash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca6b) ^ Math.imul(seed | 0, 0x27d4eb2f)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x45d9f3b) >>> 0
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

/** La maille du feuillage, en px — la grille canonique de l'art (sol, brume, Feu). Elle est
 *  aussi celle des facettes de la carte de normales du houppier (`cell: 4`) : les deux
 *  coïncident au lieu de se couper, et une touffe tombe sur ses propres facettes. */
export const FEUILLE_CELL = 4

export interface Feuillage {
  /** Côté visé d'une touffe, en px. Petit = cime fine (bouleau), grand = masse (chêne). */
  touffe: number
  /**
   * Creux entre deux touffes (0..1) : c'est LUI qui fait lire les masses séparément — et c'est
   * le premier contributeur au CONTRASTE LOCAL de la cime.
   *
   * Rabattu de plus de moitié le 2026-07-30, sur constat d'Alexis (« ça tranche trop avec le
   * sol ») MESURÉ : la canopée affichait un contraste local de 3,73 % contre 0,85 % au sol,
   * soit 4,4× plus fort. Le reproche portait sur le VOLUME, pas sur le propos — la forme reste,
   * la voix baisse.
   */
  creux: number
  /**
   * Part du bord que les touffes laissent tomber (0 = contour intact, 1 = très déchiqueté).
   *
   * Il se règle pour la FORME seule, et c'est tout l'intérêt du plancher de masse : tant qu'on
   * réglait les deux avec ce seul nombre, baisser l'échancrure pour sauver la masse d'une graine
   * rendait le bord d'une autre à sa boîte (la `fine` est passée par 0,42 avant que le plancher
   * n'existe, et le baliveau y a perdu son feston). Le plancher tenant la masse par
   * construction, ce réglage ne dit plus que « à quel point le contour est déchiqueté ».
   */
  echancrure: number
  /** Étirement vertical des touffes (1 = rondes). > 1 pour un conifère, dont les masses pendent. */
  elance: number
}

/**
 * ═══ LES QUATRE FEUILLAGES ═══
 *
 * Une famille par PORT d'arbre, pas une par espèce : la table des écorces a fait le même choix,
 * et pour la même raison — quatre jeux de réglages se calibrent à l'œil, onze non.
 */
export const FEUILLAGES: Record<string, Feuillage> = {
  /** LA MASSE — chêne, hêtre : de grosses touffes serrées, un bord qui reste ample. */
  masse: { touffe: 11, creux: 0.16, echancrure: 0.3, elance: 1 },
  /** LA CIME FINE — bouleau, baliveau : des touffes petites et nombreuses, un bord très ajouré. */
  fine: { touffe: 7, creux: 0.2, echancrure: 0.5, elance: 1 },
  /** LE RIDEAU — le saule : des masses qui pendent, bord très découpé par le bas. */
  rideau: { touffe: 8, creux: 0.18, echancrure: 0.45, elance: 1.7 },
  /** L'AIGUILLE — pins, sapin, mélèze : des étages étroits et allongés, bord franchement dentelé. */
  aiguille: { touffe: 6, creux: 0.22, echancrure: 0.55, elance: 1.5 },
}

export const FEUILLAGE_DEFAUT = FEUILLAGES.masse!

export const FEUILLAGE_PAR_VARIANTE: Record<string, keyof typeof FEUILLAGES> = {
  tree: 'masse',
  old_tree: 'masse',
  chene_pre: 'masse',
  hetre: 'masse',
  saule: 'rideau',
  bouleau: 'fine',
  baliveau: 'fine',
  pin: 'aiguille',
  vieux_pin: 'aiguille',
  sapin: 'aiguille',
  meleze: 'aiguille',
}

export function feuillageDe(slug: string): Feuillage {
  return FEUILLAGES[FEUILLAGE_PAR_VARIANTE[slug] ?? 'masse'] ?? FEUILLAGE_DEFAUT
}

/** Ce que `champDeFeuillage` rend — les trois faces d'une même vérité, calculées ensemble. */
export interface GrainHouppier {
  /** Hauteur de matière (0..1), 0 hors de la cime. C'est ce qu'on passe à `normalFromCanvas`. */
  relief: Float32Array
  /** Le ton à peindre, `null` là où la cime est ajourée. */
  ton: (string | null)[]
  /** La silhouette RÉELLE après découpe — celle que le reste du pipeline doit lire. */
  opaque: (x: number, y: number) => boolean
}

/** Mélange deux `#rrggbb` et rend un `rgb()`. */
function melanger(a: string, b: string, k: number): string {
  const n = (h: string): [number, number, number] => {
    const v = parseInt(h.slice(1), 16)
    return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
  }
  const [ar, ag, ab] = n(a)
  const [br, bg, bb] = n(b)
  const m = (x: number, y: number): number => Math.round(x + (y - x) * k)
  return `rgb(${m(ar, br)},${m(ag, bg)},${m(ab, bb)})`
}

/**
 * LE CHAMP DE FEUILLAGE — les touffes, leur relief, leur ton et le contour qu'elles découpent.
 *
 * `dedans` est la silhouette d'ORIGINE : on ne sort jamais d'elle. `assise` protège la zone par
 * laquelle la cime repose sur le fût. `corps`/`lumiere` bornent la matière — jamais `ombre`.
 */
export function champDeFeuillage(
  f: Feuillage,
  W: number,
  H: number,
  dedans: (x: number, y: number) => boolean,
  assise: (x: number, y: number) => boolean,
  corps: string,
  lumiere: string,
  seed = 11,
): GrainHouppier {
  const relief = new Float32Array(W * H)
  const ton: (string | null)[] = new Array<string | null>(W * H).fill(null)

  // ═══ DEUX CHAMPS, ET C'EST TOUT LE SUJET (révision du 2026-07-30, constat d'Alexis) ═══
  //
  // Première version : UN champ de grosses touffes (7 à 11 px) qui servait à la fois le ton, le
  // relief et le contour. Verdict d'Alexis : « ça tranche trop avec le sol ». La mesure lui a
  // donné raison mais a déplacé la cause — la canopée était DÉJÀ 3,5× plus contrastée que le sol
  // avant que j'y touche, et mes touffes n'ont porté ça qu'à 3,9×. Ce n'est donc pas l'amplitude
  // qu'on voyait, c'est la TAILLE DES MOTIFS : des masses de 7-11 px se lisent, là où le grain
  // du sol (4 px) reste sous le seuil. Deux surfaces voisines qui ne parlent pas à la même
  // échelle se querellent, même à contraste égal.
  //
  // D'où la séparation : le GRAIN (ce qu'on voit de près, dans la masse) prend l'instrument du
  // sol — bruit postérisé en trois crans francs, maille 4 px, même amplitude. Et les grosses
  // masses ne servent plus qu'au CONTOUR, qui ne coûte presque rien en contraste (MESURÉ : 0,2
  // sur 3,9) mais fait tomber la boîte.

  /** Bruit-valeur blocky à la maille voulue. Le voisinage adoucit sans lisser : on reste en
   *  crans francs, la grammaire de tout l'art du jeu. */
  const bruit = (x: number, y: number, cell: number, s: number): number => {
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)
    return (hash(cx, cy, s) * 2 + hash(cx + 1, cy, s) + hash(cx, cy + 1, s)) / 4
  }

  // ① LE GRAIN — celui du sol, transposé. Trois crans, maille 4 px.
  const champ = new Float32Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = bruit(x, y, FEUILLE_CELL, seed)
      champ[y * W + x] = t < 0.34 ? 0 : t < 0.62 ? 0.5 : 1
    }
  }

  // ② LES MASSES — à l'échelle de la touffe, et RÉSERVÉES AU CONTOUR. Elles ne touchent ni le
  // ton ni le relief : elles disent seulement jusqu'où la cime avance, lobe par lobe.
  const masses = new Float32Array(W * H)
  // La maille des masses est BORNÉE PAR LA CIME : à 11 px sur un houppier de 28, il n'y a que
  // trois cellules en travers et tout un côté du bord tombe du même côté du seuil — le hêtre ne
  // se découpait plus du tout (garde rouge, et c'est elle qui l'a dit). Quatre cellules au
  // minimum en travers du plus petit côté : il faut de la variation pour qu'il y ait un feston.
  const cellMasse = Math.max(3, Math.min(Math.round(f.touffe), Math.floor(Math.min(W, H) / 4)))
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      masses[y * W + x] = bruit(x, y, cellMasse, seed ^ 0x5bf03635)
    }
  }

  // ③ LA BANDE DE BORD — et elle est la correction d'une faute que la mesure a attrapée.
  //
  // Le seuil de découpe s'appliquait partout : les cimes perdaient LA MOITIÉ de leur masse
  // (remplissage MESURÉ 0,84 → 0,48), et une canopée trouée de part en part ne ferme plus le
  // ciel — ce qui est son rôle. La découpe ne doit mordre QUE près du contour d'origine ; au
  // cœur, la cime reste pleine. On calcule donc la distance au bord par un chanfrein 3-4 (le
  // patron du champ de rive de l'eau), et le seuil ne s'applique que dans cette bande.
  const INF = 1e9
  const dist = new Float32Array(W * H).fill(INF)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (!dedans(x, y)) dist[y * W + x] = 0
  }
  const relax = (i: number, j: number, c: number): void => {
    const v = dist[j]! + c
    if (v < dist[i]!) dist[i] = v
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (x > 0) relax(i, i - 1, 3)
      if (y > 0) relax(i, i - W, 3)
      if (x > 0 && y > 0) relax(i, i - W - 1, 4)
      if (x < W - 1 && y > 0) relax(i, i - W + 1, 4)
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x
      if (x < W - 1) relax(i, i + 1, 3)
      if (y < H - 1) relax(i, i + W, 3)
      if (x < W - 1 && y < H - 1) relax(i, i + W + 1, 4)
      if (x > 0 && y < H - 1) relax(i, i + W - 1, 4)
    }
  }
  // Largeur de la bande, en px (le chanfrein compte en tiers de pixel) : une touffe environ,
  // pour que le bord se dentelle à l'échelle des masses et non par grignotage — mais PLAFONNÉE
  // à une fraction de la cime. Sans ce plafond, une bande calibrée sur la touffe couvre presque
  // toute une petite boîte (MESURÉ : le houppier de `tree`, 32 px, perdait 45 % de sa masse),
  // et la découpe cesse d'être un bord pour devenir un ajourage général. La fraction est passée
  // de 0,22 à 0,16 le 2026-07-30 : à 0,22 la bande couvrait encore les deux tiers d'une cime de
  // 32 px, et les deux gardes (« garde sa masse » et « n'est plus une boîte ») se renvoyaient la
  // balle — un anneau plus étroit les satisfait toutes les deux au lieu de les arbitrer.
  // Le plancher de 4,5 px n'est pas décoratif : sur les plus petites cimes (le baliveau, 24×29)
  // la fraction seule donnait 3,8 px, et il n'y a alors pas la place de festonner sans manger
  // la masse — les deux gardes se bloquaient l'une l'autre.
  const bande = Math.max(4.5, Math.min(f.touffe * 0.85, Math.min(W, H) * 0.16)) * 3

  // ④ LE SEUIL EST UNE RAMPE, et c'est ce qui réconcilie les deux exigences.
  //
  // Un seuil CONSTANT sur la bande ne peut pas les tenir ensemble, et la mesure l'a montré deux
  // fois : des touffes disjointes donnent un beau bord mais une cime trouée (remplissage 0,53) ;
  // des touffes qui se recouvrent rendent la masse mais remplissent aussi le bord (découpe 1,10,
  // soit une boîte). On fait donc dépendre l'exigence de la PROFONDEUR dans la bande : contre le
  // contour d'origine, seule la crête d'une touffe passe ; vers l'intérieur, l'exigence s'annule.
  // Le bord est alors festonné au pas des touffes, et la masse reste pleine derrière.
  // Relevée après coup : la propagation depuis l'assise rogne le feston en même temps qu'elle
  // supprime les îlots, et la découpe du `tree` était retombée à 1,016 — presque une boîte. Le
  // contour ne pèse que 0,2 sur 3,9 de contraste local (MESURÉ) : le renforcer ne rouvre pas le
  // reproche d'Alexis sur l'intérieur, qui lui tient au grain et à sa maille.
  const exigence = 0.42 + 0.55 * f.echancrure

  // ═══ LA DÉCOUPE SE RELÂCHE JUSQU'À TENIR SON PLANCHER DE MASSE ═══
  //
  // Deux contrats se disputent le même réglage : « la canopée ferme le ciel » (garder au moins
  // les trois quarts de la masse) et « ce n'est plus une boîte » (découper le contour). Réglés
  // à la main, ils se renvoyaient la balle d'une variante à l'autre, puis d'une GRAINE à
  // l'autre — le hêtre, puis la cinquième cime du bouleau, puis celle du baliveau. Poursuivre
  // les symptômes graine par graine n'est pas un réglage, c'est un aveu.
  //
  // On POSE donc le plancher, comme on a posé la connexité : on découpe, on mesure, et tant que
  // la cime est trop entamée on relâche l'exigence d'un cran et on recommence. Déterministe,
  // borné, et le contrat cesse de dépendre de la chance d'une graine.
  const PLANCHER = 0.8 // marge au-dessus des trois quarts que la garde exige
  let aireOrigine = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (dedans(x, y)) aireOrigine++

  const decouper = (exig: number): Uint8Array => {
    const taille = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= W || y >= H) return false
      const i = y * W + x
      if (!dedans(x, y)) return false
      if (assise(x, y)) return true
      const d = dist[i]!
      if (d > bande) return true // le CŒUR reste plein : la canopée doit fermer le ciel
      // Le contour est découpé par les MASSES, pas par le grain : un bord grignoté à 4 px se
      // lirait comme de l'usure, pas comme du feuillage. Contre le contour d'origine, seule la
      // crête d'une masse passe ; vers l'intérieur, l'exigence s'annule.
      return masses[i]! > exig * (1 - d / bande)
    }

    // UNE CIME EST CE QUI TIENT AU TRONC. Constat d'Alexis : « certains houppiers ont des
    // feuilles détachées du gros du houppier » — MESURÉ, 3 variantes sur 11 portaient un îlot
    // flottant. Propagation depuis l'assise, en 4-VOISINAGE : dans un art blocky, un pixel qui
    // ne tient que par un coin se lit détaché, la diagonale n'est pas une attache.
    const garde = new Uint8Array(W * H)
    const pile: number[] = []
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (assise(x, y) && taille(x, y)) {
          const i = y * W + x
          if (!garde[i]) { garde[i] = 1; pile.push(i) }
        }
      }
    }
    while (pile.length) {
      const i = pile.pop()!
      const x = i % W
      const y = (i - x) / W
      const voisins = [
        x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1,
        y > 0 ? i - W : -1, y < H - 1 ? i + W : -1,
      ]
      for (const j of voisins) {
        if (j < 0 || garde[j]) continue
        const jx = j % W
        const jy = (j - jx) / W
        if (!taille(jx, jy)) continue
        garde[j] = 1
        pile.push(j)
      }
    }
    return garde
  }

  let garde = decouper(exigence)
  for (let essai = 0; essai < 8; essai++) {
    let reste = 0
    for (let i = 0; i < garde.length; i++) if (garde[i]) reste++
    if (aireOrigine === 0 || reste / aireOrigine >= PLANCHER) break
    garde = decouper(exigence * Math.pow(0.8, essai + 1))
  }

  const opaque = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && garde[y * W + x] === 1

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (!opaque(x, y)) continue
      const v = champ[i]!
      // Le relief reste TRÈS doux : la carte de normales le convertit en lumière, et c'est
      // encore un canal par lequel la cime pourrait se remettre à crier.
      relief[i] = 0.86 + 0.14 * v
      // LA MATIÈRE, et son amplitude est celle du sol. On ne parcourt PAS toute la fourchette
      // `corps → lumiere` (29 % de luminance : c'est un ombrage déguisé) mais sa toute dernière
      // frange, `creux` de large — quelques pour cent, comme les crans du grain du sol. Une
      // feuille d'ombre n'a pas le ton d'une feuille de plein soleil : c'est de la matière, la
      // même distinction que le sillon d'écorce, et c'est ce qui l'autorise à survivre à
      // l'aplatissement `_lit`.
      ton[i] = melanger(corps, lumiere, 1 - f.creux + f.creux * v)
    }
  }

  return { relief, ton, opaque }
}
