/**
 * ═══ L'HYDROLOGIE DE LA RACINE — l'eau n'est plus posée, elle est DÉRIVÉE ═══
 *
 * *(Décision d'Alexis, 2026-08-30 : « j'accepte plusieurs rivières. En fait, il faut qu'on ait
 * une hydrologie réaliste, pas des règles écrites en dur pour dire "il faut une rivière, 2 lacs,
 * 1 delta, nanana…". Il faut un vrai paysage. »)*
 *
 * Ce qui meurt avec ce module : `DENSITE_LACS` (« huit lacs par carte »), `LAC_MAX_CELLULES`
 * (« et pas plus grands que ça »), `tracerLaRiviere` (« LA rivière, du nord au sud, qui enfile
 * une à trois perles »), `relierLesLacs` (« et un chenal entre elles »). C'étaient des DÉCRETS :
 * un compte, une entité, une topologie, écrits à la main et calibrés à la main.
 *
 * Ce qui les remplace tient en une phrase : **l'eau va où l'eau va**. Un seul champ physique — le
 * drainage — et deux SEUILS dessus. Un seuil n'est pas un décret : il dit à partir de quand un
 * phénomène se voit, pas combien il doit y en avoir.
 *
 *   ① UN LAC EST UNE CUVETTE FERMÉE assez creuse pour retenir l'eau. Le priority-flood remplit
 *     chaque dépression jusqu'à son COL ; celles dont le fond est à `LAC_PROFONDEUR_MIN` sous ce
 *     col sont des lacs, les autres sont du sol bosselé. Il y en a ce que le relief en donne —
 *     zéro, trois ou vingt —, et de la taille que leur cuvette leur donne. **Aucun plafond** :
 *     un grand bassin fait un grand lac, et c'est ce qu'on voulait voir.
 *
 *   ② UN COURS D'EAU EST UNE LIGNE DE DRAINAGE assez chargée pour creuser. Le rayon suit le
 *     débit — `r ∝ √flux`, la géométrie hydraulique des vraies rivières —, donc le filet, le
 *     ruisseau et le fleuve sont le MÊME objet à trois endroits de la même courbe. « Rivière »
 *     cesse d'être une entité : c'est le nom qu'on donne à un cours d'eau qui dépasse
 *     `FLUX_FLEUVE`. Il y en a autant que le pays fabrique de gros troncs.
 *
 * ═══ « À LA BONNE PROFONDEUR » — le mur, lui aussi, se dérive ═══
 *
 * Le PROFOND (`TERRAIN_DEEP_WATER`, un mur — invariant R5) n'est plus peint par une règle de
 * forme (« le cœur du lac est à trois tuiles de la rive », « la rivière a un cœur de trois
 * tuiles »). Il est là où l'eau est PROFONDE : sous un lac, quand le fond descend de
 * `PROFOND_LAME` sous le niveau ; sous un cours d'eau, quand son débit passe `FLUX_FLEUVE`.
 * L'anneau de haut-fond de R45 tombe alors tout seul — la profondeur décroît vers la rive, donc
 * la dernière tuile avant la terre est toujours du haut-fond.
 *
 * ═══ CE QUI NE BOUGE PAS ═══
 *
 *   — R5 : on ne nage pas. Le profond reste un mur ; il y en a simplement là où il doit y en
 *     avoir, et pas là où une règle de dessin en mettait.
 *   — La CONNEXITÉ : un cours d'eau sous `FLUX_FLEUVE` est du haut-fond, donc marchable. Les
 *     fleuves, eux, se franchissent aux gués (`zonegen-sentes.ts`), comme avant.
 *   — A16 : aucune eau aux abords d'un seuil (`horsSeuils`).
 *   — R32 ne gouverne plus l'eau : tout se trace en courbes lissées, estampées au disque
 *     (`zonegen-trace.ts`), et les lacs se peignent à la tuile sur l'iso-ligne de leur niveau.
 *
 * Pur et déterministe (invariant n°2) : aucun PRNG — l'hydrologie est une LECTURE du relief.
 * Les ordres sont totaux partout (le tas départage par index, les tris par `(valeur, index)`),
 * et l'arithmétique se tient à `+ - * / sqrt min max abs sign floor round`.
 */
import { TERRAINS, TERRAIN_DEEP_WATER, TERRAIN_SHALLOW_WATER } from './balance'
import { isWater } from './map'
import { fbm2 } from './noise'
import { CREUX, lireLeChampGraine, type Creux } from './racine-relief'
import { TasPF } from './socle'
import { lisserChaikin, meandrer, peindreCoursDEau, rasteriser4, type Point } from './zonegen-trace'

/** Le réglage — calibré en REGARDANT une carte, comme les autres blocs du worldgen. */
export const HYDRO = {
  // ══ LES LACS — les cuvettes que le pays creuse vraiment ═════════════════════════════════
  /**
   * LA PROFONDEUR QUI FAIT UN LAC, en LAMES (`CREUX.LAME`) — la seule molette qui reste, et
   * elle remplace le COMPTE de lacs. MESURÉ le 2026-08-30 sur la Racine du monde joué : le
   * relief porte 82 à 90 cuvettes fermées, de 0,4 à 5,2 lames de creux, et 15 % du pays est en
   * cuvette. Sans ce seuil on noierait la Racine — qui porte les villages (A17). Avec, on garde
   * les vraies : quelques grands bassins, quelques mares, et le sol bosselé reste du sol.
   */
  LAC_PROFONDEUR_MIN: 1.15,
  /** Sous cette profondeur d'eau (en lames), le lac est un HAUT-FOND marchable ; au-delà, un
   *  mur. C'est ce qui donne l'anneau de rive sans qu'on ait à l'écrire. */
  PROFOND_LAME: 1.0,
  /**
   * ═══ UN LAC CREUX PLONGE DÈS LA BERGE ═══
   *
   * *(Décision d'Alexis, 2026-08-30 : « je ne sais pas si je veux que les îles soient toujours
   * connectées avec l'eau peu profonde — j'imaginais plus l'île explorable lorsque le gel
   * s'installe sur l'eau profonde ».)*
   *
   * Le seuil du profond n'est plus une profondeur FIXE : il fond avec le CREUX DU LAC. Une mare
   * garde toute sa bande de haut-fond — on la traverse en pataugeant. Un lac creux, lui, plonge
   * dès la berge : sa rive est un mur, et l'îlot qui en sort est ceint de mur comme elle.
   *
   * ⚠ On avait d'abord essayé la PENTE LOCALE du fond. Mesuré, écarté : sur ce relief la pente
   * est du même ordre partout (0,002 à 0,005 par tuile) — le seuil ne séparait rien, il faisait
   * plonger TOUTES les rives (haut-fond tombé à 4,1 % contre 9,8 % de profond, et plus une
   * berge où patauger). Le creux du lac, lui, sépare vraiment : c'est une propriété du LAC, pas
   * du pixel.
   *
   * Conséquence voulue : un tel îlot est INACCESSIBLE l'été (le profond est un mur, R5) et
   * s'ouvre au GRAND FROID, quand la glace le rend marchable (`collision.ts` : le profond bloque
   * *sauf s'il est gelé*, et `gel.ts` replie sur la rive qui s'y attarde au dégel). Le lieu
   * saisonnier tombe des systèmes existants — on n'écrit pas une ligne de saisonnalité.
   */
  /** Le creux (en lames) au-delà duquel un lac plonge dès sa berge. En deçà, sa bande de
   *  haut-fond garde toute sa largeur ; entre les deux, elle fond linéairement. */
  CREUX_MUR: 2.8,
  /**
   * Ce qui reste de la bande de haut-fond dans le lac le plus creux (fraction). ZÉRO, et c'est
   * le point : dans un lac creux, l'eau est profonde DÈS la première tuile. Le continent garde
   * quand même son pas d'eau basse — `assainirLeProfond` le lui rend (R45) — mais une ÎLE, elle,
   * en est exemptée : c'est là que naît l'île qui ne se gagne qu'au gel.
   */
  PROFOND_PLANCHER: 0,
  /** L'échelle du grain qui dentelle la rive, en tuiles. */
  RIVE_ECHELLE: 26,
  /** Son amplitude, en unités d'altitude — petit devant la LAME (0,05). */
  RIVE_GRAIN: 0.012,
  /**
   * ═══ LA BATHYMÉTRIE — pourquoi un grand lac porte des ÎLES ═══
   *
   * *(Question d'Alexis, 2026-08-30 : « est-ce qu'il y aurait moyen d'avoir des îles / chapelets
   * d'îles dans certains de ces cas ? Sans forcer la chose, mais par génération pure. »)*
   *
   * On ne pose AUCUNE île. Une tuile est sous l'eau si son altitude passe sous le niveau du
   * col : toute bosse qui perce reste sèche, et c'est une île — c'était déjà vrai (16 à 19 par
   * carte, mesuré). Ce qui manquait, c'est du RELIEF AU FOND : dans un grand lac creux, l'octave
   * fine du champ est trop plate pour percer, donc le lac sortait lisse.
   *
   * On ajoute donc au fond une ondulation de MOYENNE échelle. Elle ne décide de rien : là où le
   * lac est creux, elle reste noyée (et fait des hauts-fonds, que la pêche lit) ; là où il est
   * peu profond, elle perce et sème un chapelet. **L'île apparaît là où le lac est mince** —
   * c'est la géographie qui répond, pas une règle.
   */
  ILOTS_ECHELLE: 90,
  /** L'ondulation du fond, en FRACTION du creux du lac — un lac calme garde un fond doux… */
  CALME_PART: 0.55,
  /**
   * LA SECONDE ONDULATION DU FOND — celle qui fait les GRANDES îles.
   *
   * *(« j'aimerais que certaines îles soient big », Alexis, 2026-08-30.)* L'octave à 90 tuiles
   * ne perce que par la pointe : elle sème des cailloux. Il faut une ondulation LONGUE (des
   * centaines de tuiles) pour qu'un plateau entier sorte de l'eau.
   *
   * Et son amplitude fait plus que la taille : un dôme qui monte HAUT au-dessus du niveau a sa
   * ligne d'eau sur le FLANC RAIDE, pas sur le sommet mou — donc le profond arrive au ras, et
   * la grande île est isolée. Un dôme qui affleure à peine, lui, garde sa plage. Les deux
   * existent, et c'est le relief qui choisit — pas nous.
   */
  ILOTS_LARGE_ECHELLE: 340,
  /** L'aire minimale (en tuiles) d'un lac pour porter une île. En deçà, c'est une mare. */
  ILE_LAC_MIN: 6000,
  /** Le rayon d'une île, en fraction de la racine de l'aire du lac. 0,17 → un lac de 40 000
   *  tuiles (200 de côté) porte une île de 34 tuiles de rayon, soit ~3 600 tuiles. */
  ILE_PART: 0.3,
  /** Une île de plus par tranche d'aire, plafonné. */
  ILE_PAR_AIRE: 25000,
  ILE_MAX_PAR_LAC: 3,
  /** Le fondu minimal (0 à la rive, 1 au cœur) où un dôme d'île a le droit de naître. */
  ILE_LARGE_MIN: 0.85,
  /** Le rayon du dôme, en multiples du rayon d'île visé, et sa hauteur en multiples de la
   *  profondeur au sommet. Plus la hauteur est grande, plus la part du dôme qui émerge est
   *  large : le bord de l'île est à `d/R = sqrt(1 − 1/H)`. */
  ILE_RAYON_DOME: 1.6,
  ILE_HAUTEUR: 4,
  /** Sur combien de CELLULES depuis le bord de la cuvette le relief de fond monte de zéro à
   *  plein. En deçà, la côte est l'iso-ligne du terrain nu — donc courbe, et jamais clippée. */
  FONDU_RIVE: 3,

  // ══ LES COURS D'EAU — un seul objet, trois noms ══════════════════════════════════════════
  /**
   * LE DÉBIT DE CREUSEMENT, en cellules drainées : au-dessus, le vallon porte un filet d'eau.
   * C'est la MAILLE du réseau. MESURÉ : 2 870 cellules du pays dépassent 10, 1 350 dépassent
   * 30, 630 dépassent 100 — la maille se choisit donc là-dedans, à l'œil, sur la carte rendue.
   */
  TETE_FLUX_MIN: 60,
  /** Le débit à partir duquel un cours d'eau est un FLEUVE : il gagne un cœur profond, donc il
   *  devient un mur qu'on ne franchit qu'au gué. MESURÉ : 35 cellules dépassent 1 000, 220 à
   *  260 dépassent 300 — c'est là que vivent les quelques gros troncs du pays. */
  FLUX_FLEUVE: 700,
  /** Le débit auquel un cours d'eau atteint sa pleine largeur (au-delà, il ne grossit plus). */
  FLUX_PLEIN: 2200,
  /** Rayon d'un filet de tête, en tuiles (1,2 → 3 tuiles de large). */
  RAYON_MIN: 1.2,
  /** Rayon du plus gros fleuve (4,6 → 9-10 tuiles). */
  RAYON_MAX: 4.6,
  /** Le retrait du cœur profond sous la berge d'un fleuve, en tuiles : deux tuiles de haut-fond
   *  de chaque côté, l'anneau de R45 par construction. */
  COEUR_RETRAIT: 2.2,
  /** L'écart d'un cours d'eau à sa ligne de drainage, en tuiles. Il croît avec le débit : un
   *  fleuve divague, un filet obéit à sa pente. */
  MEANDRE_MIN: 3.5,
  MEANDRE_MAX: 26,
  /** La descente d'un cours d'eau, en cellules — de quoi traverser un pays sans jamais boucler. */
  MAX_CELLULES: 600,
  /** Au-delà de ce débit, le cours d'eau est publié dans les CHENAUX : la saulaie ne longe que
   *  l'eau qui compte (publiée pour tous, elle couvrait 10 % de la carte — mesuré). */
  FLUX_SAULAIE: 700,
  /** L'ε du priority-flood : la pente qu'on impose en remplissant, pour que tout draine. */
  EPSILON: 1e-6,
} as const

/** Ce que l'hydrologie laisse derrière elle — de quoi percer les gués et nommer les lieux. */
export interface Hydrologie {
  /** Les FILS des fleuves (`flux ≥ FLUX_FLEUVE`), du plus gros au plus petit, chacun amont →
   *  aval, en index de tuile. Plusieurs, désormais : le pays en fabrique ce qu'il veut. */
  fils: number[][]
  /** Les tuiles du cœur PROFOND des fleuves. Les sentes y creusent les gués. */
  coeur: Set<number>
  /** Les tuiles d'eau COURANTE qui comptent (la saulaie les longe). */
  chenaux: number[]
  /** Toute l'eau posée par la passe (lacs compris) — pour la frange de marais. */
  eaux: number[]
  /**
   * LES TUILES DES LACS SEULS — ce que l'inondation des cuvettes a peint, sans les fleuves ni
   * les chenaux. C'est la DONNÉE qui dit ce qui est plat : une nappe tient sur un palier de
   * terrasse (`terrasses.ts`), un fleuve descend en cascades — et il n'y a qu'ici qu'on le
   * sait, pas à la tuile (une bande autour du fil prenait le milieu des fleuves larges pour un
   * lac, et l'embouchure pour du fleuve). Index de tuile, dans l'ordre de l'inondation.
   */
  lacs: number[]
}

/** Les 8 voisins, cardinaux d'abord : l'ordre du tableau EST le départage des ex æquo. */
const VDX = [0, 0, -1, 1, -1, 1, -1, 1]
const VDY = [-1, 1, 0, 0, -1, -1, 1, 1]
const SQRT2 = Math.sqrt(2)
const VDIST = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2]

/**
 * DÉRIVE L'HYDROLOGIE DE LA RACINE et la peint. Une seule passe, un seul champ.
 */
export function tracerLHydrologie(
  terrain: number[],
  zone: Int32Array,
  racineId: number,
  width: number,
  height: number,
  creux: Creux | null,
  horsSeuils: Uint8Array,
  seed: number,
): Hydrologie {
  const vide: Hydrologie = { fils: [], coeur: new Set(), chenaux: [], eaux: [], lacs: [] }
  if (!creux) return vide
  const M = CREUX.MOTIF
  const cols = creux.cols
  const rows = creux.rows
  const n = cols * rows
  const selRive = (seed ^ 0x48594452) | 0 /* 'HYDR' */
  const eaux: number[] = []
  const tuilesDeLac: number[] = []
  const chenaux: number[] = []
  const coeur = new Set<number>()

  /** La tuile au centre d'une cellule. */
  const centre = (k: number): number => {
    const kx = k % cols
    const x = (creux.mx0 + kx) * M + M / 2
    const y = (creux.my0 + (k - kx) / cols) * M + M / 2
    if (x < 0 || y < 0 || x >= width || y >= height) return -1
    return y * width + x
  }
  /** Une tuile que l'eau a le droit de prendre : de la Racine, marchable, sèche, hors seuil. */
  const libre = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const i = y * width + x
    if (zone[i] !== racineId) return false
    if (isWater(terrain[i]!)) return false
    if (TERRAINS[terrain[i]!]?.walkable !== true) return false
    // ⚠ LA CELLULE **ET SES VOISINES** : le masque est à la maille de la cellule (8 tuiles),
    // l'emprise d'un seuil se mesure à la TUILE. Une eau posée dans une cellule libre mais
    // collée à une cellule interdite débordait dans l'emprise — 15 tuiles, garde A16, seed 7.
    const k = celluleDeTuile(x, y)
    if (k < 0) return true
    if (horsSeuils[k] !== 1) return false
    const kx = k % cols
    const ky = (k - kx) / cols
    for (let d = 0; d < 8; d++) {
      const vx = kx + VDX[d]!
      const vy = ky + VDY[d]!
      if (vx < 0 || vy < 0 || vx >= cols || vy >= rows) continue
      if (horsSeuils[vy * cols + vx] !== 1) return false
    }
    return true
  }
  const celluleDeTuile = (x: number, y: number): number => {
    const kx = Math.floor(x / M) - creux.mx0
    const ky = Math.floor(y / M) - creux.my0
    if (kx < 0 || ky < 0 || kx >= cols || ky >= rows) return -1
    return ky * cols + kx
  }

  // ══ 1. LE PAYS, ET SON EXUTOIRE ═════════════════════════════════════════════════════════
  //
  // Le niveau de base, c'est le BORD du pays : l'eau de la Racine s'en va par là (elle descend
  // vers le feu, comme le disait R5 — sauf qu'on ne le décrète plus, c'est la pente qui le dit).
  const dansLePays = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    if (creux.dedans[k] !== 1) continue
    if (centre(k) < 0) continue
    dansLePays[k] = 1
  }
  const estBase = new Uint8Array(n)
  for (let k = 0; k < n; k++) {
    if (dansLePays[k] !== 1) continue
    const kx = k % cols
    const ky = (k - kx) / cols
    for (let d = 0; d < 8; d++) {
      const vx = kx + VDX[d]!
      const vy = ky + VDY[d]!
      if (vx < 0 || vy < 0 || vx >= cols || vy >= rows || dansLePays[vy * cols + vx] !== 1) {
        estBase[k] = 1
        break
      }
    }
  }

  // ══ 2. LE PRIORITY-FLOOD — chaque dépression se remplit jusqu'à SON col ═════════════════
  const filled = new Float64Array(n)
  const ferme = new Uint8Array(n)
  const tas = new TasPF(n)
  for (let k = 0; k < n; k++) filled[k] = creux.alt[k]!
  for (let k = 0; k < n; k++) {
    if (estBase[k] !== 1) continue
    ferme[k] = 1
    tas.pousse(filled[k]!, k)
  }
  while (tas.taille > 0) {
    const k = tas.tire()
    const kx = k % cols
    const ky = (k - kx) / cols
    const fk = filled[k]! + HYDRO.EPSILON
    for (let d = 0; d < 8; d++) {
      const vx = kx + VDX[d]!
      const vy = ky + VDY[d]!
      if (vx < 0 || vy < 0 || vx >= cols || vy >= rows) continue
      const v = vy * cols + vx
      if (ferme[v] === 1 || dansLePays[v] !== 1) continue
      ferme[v] = 1
      filled[v] = creux.alt[v]! > fk ? creux.alt[v]! : fk
      tas.pousse(filled[v]!, v)
    }
  }

  // ══ 3. LES CUVETTES — et lesquelles sont des LACS ═══════════════════════════════════════
  //
  // Une cellule est NOYÉE si la surface remplie dépasse son altitude. Les composantes de
  // noyées sont les cuvettes ; on garde celles dont le fond descend de `LAC_PROFONDEUR_MIN`
  // sous leur col. Le NIVEAU du lac est le maximum de `filled` sur sa composante : le col.
  const seuilLac = CREUX.LAME * HYDRO.LAC_PROFONDEUR_MIN
  const marge = CREUX.LAME * 0.25
  const noye = new Uint8Array(n)
  for (let k = 0; k < n; k++) if (ferme[k] === 1 && filled[k]! - creux.alt[k]! > marge) noye[k] = 1
  const vu = new Uint8Array(n)
  const lacs: { cellules: number[]; niveau: number; creux: number }[] = []
  for (let s = 0; s < n; s++) {
    if (vu[s] === 1 || noye[s] !== 1) continue
    const comp: number[] = [s]
    vu[s] = 1
    let creuxMax = 0
    let niveau = 0
    for (let t = 0; t < comp.length; t++) {
      const k = comp[t]!
      const p = filled[k]! - creux.alt[k]!
      if (p > creuxMax) creuxMax = p
      if (filled[k]! > niveau) niveau = filled[k]!
      const kx = k % cols
      const ky = (k - kx) / cols
      for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < cols ? k + 1 : -1, ky > 0 ? k - cols : -1, ky + 1 < rows ? k + cols : -1]) {
        if (v >= 0 && vu[v] !== 1 && noye[v] === 1) { vu[v] = 1; comp.push(v) }
      }
    }
    if (creuxMax >= seuilLac) lacs.push({ cellules: comp, niveau, creux: creuxMax })
  }

  // ══ 4. LA PEINTURE DES LACS — à la tuile, sur l'iso-ligne du col ════════════════════════
  //
  // Le lac est exactement « le terrain sous le niveau du col ». Aucun quantile, aucun plafond :
  // la forme EST une iso-ligne du relief, donc courbe, et le grain la dentelle. La PROFONDEUR
  // se lit au même endroit — `niveau − altitude` — d'où le profond au centre et le haut-fond
  // contre la rive, sans qu'on écrive un anneau.
  /**
   * Le champ du fond VU PAR UN LAC — et son amplitude est une FRACTION DU CREUX DE CE LAC.
   *
   * ⚠ C'est la correction qui a débloqué les îles, et la leçon vaut d'être écrite : une
   * bathymétrie d'amplitude ABSOLUE ne perce jamais un lac creux. MESURÉ sur la seed 2026 (« je
   * ne vois pas d'île significative ») : ses deux plus grands lacs font 4,8 et 5,2 lames de
   * creux, quand l'ondulation du fond ne montait que de 0,2 lame — elle n'atteignait la surface
   * nulle part, et le lac sortait lisse. Un vrai fond de lac a du relief À LA MESURE de sa
   * cuvette : un bassin creux porte des hauts-fonds hauts, un bassin plat des rides basses.
   */
  /**
   * LE CHAMP DU FOND D'UN LAC — le terrain, son grain de rive, et une ondulation douce.
   *
   * ⚠ IL N'Y A PLUS DE « RÉGIME ARCHIPEL » ICI, et l'histoire vaut d'être gardée. On a essayé
   * de fabriquer les îles par le bruit : amplitude proportionnelle au creux, point neutre
   * décalé, comblement du bassin. **Aucune de ces écritures n'était stable** — fabriquer une
   * île en faisant percer un bruit au-dessus d'un niveau est un processus à SEUIL : rien ne
   * garantit qu'un grand lac en obtienne, doubler l'échelle les supprime, et chaque retouche
   * redessine le pays entier en cascade (2 275 tuiles d'île sur une graine, 49 sur une autre,
   * aux mêmes réglages — mesuré). Les îles sont désormais des DÔMES posés sur les hauts-fonds
   * réels du lac ; ici, il ne reste que le fond doux sur lequel elles se posent.
   */
  const champLac = (x: number, y: number, creuxLac: number, large: number): number => {
    const nu = lireLeChampGraine(
      creux, creux.alt, x, y, (fbm2(x, y, HYDRO.RIVE_ECHELLE, selRive) - 0.5) * HYDRO.RIVE_GRAIN,
    )
    const part = creuxLac * HYDRO.CALME_PART * large
    return nu
      + (fbm2(x, y, HYDRO.ILOTS_ECHELLE, (selRive ^ 0x494c4f54) | 0 /* 'ILOT' */) - 0.5) * part
      + (fbm2(x, y, HYDRO.ILOTS_LARGE_ECHELLE, (selRive ^ 0x4247494c) | 0 /* 'BGIL' */) - 0.5) * part * 0.8
  }
  for (const lac of lacs) {
    // L'emprise : les cellules de la cuvette PLUS leur anneau — sans quoi l'iso-ligne serait
    // clippée au bord des cellules et la rive hériterait des angles droits de la grille.
    const dansLaCuvette = new Set(lac.cellules)
    const emprise = new Set(lac.cellules)
    for (const k of lac.cellules) {
      const kx = k % cols
      const ky = (k - kx) / cols
      for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < cols ? k + 1 : -1, ky > 0 ? k - cols : -1, ky + 1 < rows ? k + cols : -1]) {
        if (v >= 0 && dansLePays[v] === 1) emprise.add(v)
      }
    }
    // L'inondation part du point BAS de la cuvette, en 4-connexité : le lac est d'un seul
    // tenant, et une bosse restée sèche au milieu devient une ÎLE.
    let bas = lac.cellules[0]!
    for (const k of lac.cellules) if (creux.alt[k]! < creux.alt[bas]! || (creux.alt[k] === creux.alt[bas] && k < bas)) bas = k
    const bx = (creux.mx0 + (bas % cols)) * M + M / 2
    const by = (creux.my0 + ((bas - (bas % cols)) / cols)) * M + M / 2
    if (!libre(bx, by)) continue
    // LE CARACTÈRE DU LAC — tiré de son point bas, donc stable et sans PRNG d'état.
    // ═══ LE RELIEF DE FOND N'AGIT QU'AU LARGE ═══
    //
    // *(« t'es en train de creuser les côtes en escalier… », Alexis, 2026-08-30.)* Il avait
    // raison, et la cause était mécanique : une bathymétrie ample déplace la ligne d'eau de
    // plusieurs tuiles ; le lac voulait alors sortir de son emprise, se faisait CLIPPER au bord
    // des cellules, et la côte reprenait l'escalier de la grille — l'exact défaut qu'on venait
    // de tuer partout ailleurs.
    //
    // On fond donc le relief de fond à ZÉRO sur les cellules de bord, plein au cœur. Deux
    // bénéfices d'un coup : **la côte redevient l'iso-ligne du terrain nu** (elle ne sort plus
    // jamais de l'emprise, donc plus rien à clipper), et **les îles naissent AU LARGE**, ce qui
    // est leur place. Le poids se lit en bilinéaire comme le reste — sinon ses marches de
    // cellule se verraient dans le fond.
    const poids = new Float64Array(n)
    {
      const dist = new Map<number, number>()
      const file: number[] = []
      for (const k of lac.cellules) {
        const kx = k % cols
        const ky = (k - kx) / cols
        let bord = false
        for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < cols ? k + 1 : -1, ky > 0 ? k - cols : -1, ky + 1 < rows ? k + cols : -1]) {
          if (v < 0 || !dansLaCuvette.has(v)) { bord = true; break }
        }
        if (bord) { dist.set(k, 0); file.push(k) }
      }
      for (let h = 0; h < file.length; h++) {
        const k = file[h]!
        const d = dist.get(k)! + 1
        const kx = k % cols
        const ky = (k - kx) / cols
        for (const v of [kx > 0 ? k - 1 : -1, kx + 1 < cols ? k + 1 : -1, ky > 0 ? k - cols : -1, ky + 1 < rows ? k + cols : -1]) {
          if (v < 0 || !dansLaCuvette.has(v) || dist.has(v)) continue
          dist.set(v, d)
          file.push(v)
        }
      }
      for (const [k, d] of dist) poids[k] = Math.min(1, d / HYDRO.FONDU_RIVE)
    }
    const largeEn = (x: number, y: number): number => Math.min(1, Math.max(0, lireLeChampGraine(creux, poids, x, y, 0)))

    // ═══ LES ÎLES — LE LIEU EST DU TERRAIN, L'AMPLEUR EST DÉCIDÉE ═══
    //
    // *(Décision d'Alexis, 2026-08-30, après quatre calibrages ratés : « la map a complètement
    // changé depuis ma dernière remarque. Pourquoi ? » — parce que fabriquer les îles par un
    // BRUIT QUI DOIT PERCER UN NIVEAU est un processus à SEUIL, donc chaotique : rien ne
    // garantit qu'un grand lac en obtienne, doubler l'échelle les SUPPRIME, et chaque retouche
    // redessine tout le pays en cascade — 2 275 tuiles d'île sur une graine, 49 sur une autre,
    // aux mêmes réglages.)*
    //
    // On garde donc l'ORIGINE PHYSIQUE et l'on abandonne le seuil : une île naît sur un vrai
    // HAUT-FOND du terrain (un maximum local du fond de la cuvette — le relief dit où), et l'on
    // fait émerger ce haut-fond d'un dôme dont le rayon est CALCULÉ pour que l'île atteigne la
    // taille visée (on dit combien). Le résultat est stable : un grand lac a ses îles, toujours,
    // et un réglage ne déplace plus que leur ampleur.
    const aireLac = lac.cellules.length * M * M
    const domes: { cx: number; cy: number; R: number; H: number }[] = []
    if (aireLac >= HYDRO.ILE_LAC_MIN) {
      const rIle = Math.sqrt(aireLac) * HYDRO.ILE_PART
      const combien = Math.min(HYDRO.ILE_MAX_PAR_LAC, 1 + Math.floor(aireLac / HYDRO.ILE_PAR_AIRE))
      // Les sommets du fond : les cellules les plus HAUTES de la cuvette, écartées entre elles.
      // ⚠ LES SOMMETS SE CHERCHENT AU LARGE, et c'est le correctif qui a tout débloqué : les
      // cellules les plus hautes d'une cuvette sont sur son POURTOUR, là où le fondu de rive
      // écrase le dôme à zéro. On ne retient donc que le cœur (`poids ≥ ILE_LARGE_MIN`), et
      // parmi lui les plus hautes — le haut-fond du large, qui est bien ce qu'on cherchait.
      const parHaut = lac.cellules
        .filter((k) => poids[k]! >= HYDRO.ILE_LARGE_MIN)
        .sort((a, b2) => (creux.alt[b2]! - creux.alt[a]!) || (a - b2))
      for (const k of parHaut) {
        if (domes.length >= combien) break
        const kx = k % cols
        const ky = (k - kx) / cols
        const cx = (creux.mx0 + kx) * M + M / 2
        const cy = (creux.my0 + ky) * M + M / 2
        if (domes.some((d) => Math.abs(d.cx - cx) + Math.abs(d.cy - cy) < rIle * 3)) continue
        const prof = lac.niveau - creux.alt[k]!
        if (prof <= 0) continue // déjà émergé : le terrain a fait l'île tout seul
        // R = 2r et H = 4/3 · prof : le dôme `H·(1 − (d/R)²)` dépasse alors le niveau
        // exactement jusqu'à `d = r`. C'est toute l'arithmétique, et elle se vérifie à la main.
        domes.push({ cx, cy, R: rIle * HYDRO.ILE_RAYON_DOME, H: prof * HYDRO.ILE_HAUTEUR })
      }
    }
    // ⚠ MÉMOÏSÉ PAR TUILE. Le remplissage interroge le champ CINQ fois par tuile (une par
    // voisin candidat, puis une pour la profondeur), et chaque interrogation coûte une lecture
    // bilinéaire du poids plus trois `fbm2` à trois octaves. MESURÉ : la génération de la vallée
    // était passée de 10,6 à 13,2 s (budget A13 : 15 s) — l'essentiel était là.
    const cache = new Map<number, number>()
    const champIci = (x: number, y: number): number => {
      const cle = y * width + x
      const vu2 = cache.get(cle)
      if (vu2 !== undefined) return vu2
      let v = champLac(x, y, lac.creux, largeEn(x, y))
      // LES DÔMES — ajoutés au fond, atténués par le même fondu que le reste : une île ne se
      // colle jamais à la rive, elle sort du large.
      if (domes.length > 0) {
        const w = largeEn(x, y)
        for (const d of domes) {
          const dx = x - d.cx
          const dy = y - d.cy
          const u = (dx * dx + dy * dy) / (d.R * d.R)
          if (u >= 1) continue
          v += d.H * (1 - u) * w
        }
      }
      cache.set(cle, v)
      return v
    }
    // LE CREUX DU LAC décide de la largeur de sa berge : une mare patauge, un lac est un mur.
    const creuxLames = lac.creux / CREUX.LAME
    const mur = Math.min(1, Math.max(0, (creuxLames - HYDRO.LAC_PROFONDEUR_MIN) / (HYDRO.CREUX_MUR - HYDRO.LAC_PROFONDEUR_MIN)))
    const seuilIci = CREUX.LAME * HYDRO.PROFOND_LAME * (1 - mur * (1 - HYDRO.PROFOND_PLANCHER))
    const dansLeLac = new Set<number>([by * width + bx])
    const file = [by * width + bx]
    for (let t = 0; t < file.length; t++) {
      const i = file[t]!
      const ix = i % width
      const iy = (i - ix) / width
      const prof = lac.niveau - champIci(ix, iy)
      terrain[i] = prof >= seuilIci ? TERRAIN_DEEP_WATER : TERRAIN_SHALLOW_WATER
      eaux.push(i)
      tuilesDeLac.push(i)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = ix + dx
        const ny = iy + dy
        const j = ny * width + nx
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || dansLeLac.has(j)) continue
        if (!emprise.has(celluleDeTuile(nx, ny))) continue // jamais hors de l'emprise
        if (!libre(nx, ny)) continue
        if (champIci(nx, ny) >= lac.niveau) continue //       au-dessus du col : c'est la berge
        dansLeLac.add(j)
        file.push(j)
      }
    }
  }

  // ══ 5. LES RÉCEPTEURS ET LE DÉBIT ═══════════════════════════════════════════════════════
  const recepteur = new Int32Array(n).fill(-1)
  for (let k = 0; k < n; k++) {
    if (ferme[k] !== 1 || estBase[k] === 1) continue
    const kx = k % cols
    const ky = (k - kx) / cols
    let meilleure = 0
    for (let d = 0; d < 8; d++) {
      const vx = kx + VDX[d]!
      const vy = ky + VDY[d]!
      if (vx < 0 || vy < 0 || vx >= cols || vy >= rows) continue
      const v = vy * cols + vx
      if (ferme[v] !== 1) continue
      const s = (filled[k]! - filled[v]!) / VDIST[d]!
      if (s > meilleure) { meilleure = s; recepteur[k] = v }
    }
  }
  const ordre: number[] = []
  for (let k = 0; k < n; k++) if (ferme[k] === 1) ordre.push(k)
  ordre.sort((a, b) => (filled[b]! - filled[a]!) || (a - b))
  const flux = new Float64Array(n)
  for (const k of ordre) flux[k]! += 1
  for (const k of ordre) {
    const r = recepteur[k]!
    if (r >= 0) flux[r]! += flux[k]!
  }

  // ══ 6. LES COURS D'EAU — le rayon suit le débit ═════════════════════════════════════════
  //
  // `r ∝ √flux` : la géométrie hydraulique des vraies rivières (la largeur croît comme la
  // racine du débit). C'est ce qui fait qu'un affluent se voit PLUS ÉTROIT que le tronc où il
  // se jette, sans qu'on ait à classer les cours d'eau en catégories.
  const rayonDe = (k: number): number => {
    const t = Math.min(1, Math.sqrt(flux[k]! / HYDRO.FLUX_PLEIN))
    return HYDRO.RAYON_MIN + (HYDRO.RAYON_MAX - HYDRO.RAYON_MIN) * t
  }
  const amontCreuse = new Uint8Array(n)
  for (const k of ordre) {
    if (flux[k]! < HYDRO.TETE_FLUX_MIN) continue
    const r = recepteur[k]!
    if (r >= 0) amontCreuse[r] = 1
  }
  const centrePoint = (k: number): Point => {
    const kx = k % cols
    return {
      x: (creux.mx0 + kx) * M + M / 2,
      y: (creux.my0 + (k - kx) / cols) * M + M / 2,
      r: rayonDe(k),
    }
  }
  const peint = new Uint8Array(n)
  const cours: { chemin: number[]; fluxMax: number; jusquALExutoire: boolean }[] = []
  for (const tete of ordre) {
    if (flux[tete]! < HYDRO.TETE_FLUX_MIN || amontCreuse[tete] === 1) continue
    if (estBase[tete] === 1 || horsSeuils[tete] === 0) continue
    const chemin: number[] = [tete]
    let k = tete
    let fluxMax = flux[tete]!
    let jusquALExutoire = false
    for (let pas = 0; pas < HYDRO.MAX_CELLULES; pas++) {
      const r = recepteur[k]!
      if (r < 0) { jusquALExutoire = true; break } // on est arrivé à l'exutoire du pays
      if (horsSeuils[r] === 0) break //        A16 : un seuil ne nourrit rien, pas même à boire
      chemin.push(r)
      peint[k] = 1
      if (flux[r]! > fluxMax) fluxMax = flux[r]!
      if (peint[r] === 1) break //             la confluence : l'aval est déjà tracé
      k = r
    }
    if (chemin.length >= 2) cours.push({ chemin, fluxMax, jusquALExutoire })
  }

  // LA PEINTURE, DU PLUS GROS AU PLUS PETIT — un affluent ne repeint pas le tronc où il se
  // jette : `poser` refuse l'eau déjà là, donc l'ordre décide qui garde sa largeur. Le plus
  // gros d'abord est le seul ordre qui ne rétrécisse jamais un fleuve à un endroit au hasard.
  cours.sort((a, b) => (b.fluxMax - a.fluxMax) || (a.chemin[0]! - b.chemin[0]!))
  const litNeuf = new Set<number>()
  const courbes = new Map<number, Point[]>()
  for (const { chemin, fluxMax } of cours) {
    const grand = fluxMax >= HYDRO.FLUX_SAULAIE
    const poser = (x: number, y: number): void => {
      if (!libre(x, y)) return
      const i = y * width + x
      terrain[i] = TERRAIN_SHALLOW_WATER
      litNeuf.add(i)
      eaux.push(i)
      if (grand) chenaux.push(i)
    }
    // Le méandre croît avec le débit : un fleuve divague, un filet obéit à sa pente.
    const t = Math.min(1, Math.sqrt(fluxMax / HYDRO.FLUX_PLEIN))
    const ampl = HYDRO.MEANDRE_MIN + (HYDRO.MEANDRE_MAX - HYDRO.MEANDRE_MIN) * t
    const points = meandrer(chemin.map(centrePoint), ampl, (selRive ^ chemin[0]!) | 0)
    courbes.set(chemin[0]!, points) // ⚠ LE FIL SE TIRE DE LA MÊME COURBE QUE LE LIT — sinon il
    // suit la ligne de drainage brute pendant que le lit serpente, et il SORT de son lit (vu sur
    // la carte rendue : des pointillés de fil en plein pré, à côté de l'eau).
    peindreCoursDEau(points, 2, poser)

    // ── LE CŒUR PROFOND — seulement là où le débit fait un FLEUVE ──
    // Il ne creuse QUE le lit qu'on vient de poser (jamais un lac, jamais un autre cours) :
    // le profond naît donc ceint de sa propre berge, et l'anneau de R45 tient par construction.
    if (fluxMax < HYDRO.FLUX_FLEUVE) continue
    const creuser = (x: number, y: number): void => {
      if (x < 0 || y < 0 || x >= width || y >= height) return
      const i = y * width + x
      if (!litNeuf.has(i)) return
      terrain[i] = TERRAIN_DEEP_WATER
      coeur.add(i)
    }
    // ⚠ LE CŒUR SE PEINT COMME LE LIT, par la MÊME courbe rastérisée. Estamper un disque par
    // POINT de la polyligne (un par cellule, soit tous les huit tuiles) posait des perles
    // disjointes : le cœur sortait en CHAPELET de taches profondes, vu sur la carte rendue.
    const bouts = Math.max(1, Math.round(points.length * 0.06))
    const pointsCoeur: Point[] = points
      .slice(bouts, points.length - bouts)
      .map((p) => ({ x: p.x, y: p.y, r: (p.r ?? 0) - HYDRO.COEUR_RETRAIT }))
    if (pointsCoeur.length >= 2) peindreCoursDEau(pointsCoeur, 2, creuser)
  }

  // ═══ CE QU'EST UN FLEUVE — et ce qui n'en est pas un ═══
  //
  // Un tronçon qui s'arrête sur un autre est un AFFLUENT, pas un fleuve : il n'a pas d'exutoire
  // à lui. MESURÉ en publiant tous les tronçons : 25 à 32 « fleuves » par carte, dont un de neuf
  // tuiles — c'était compter les branches et appeler chacune un arbre. Un fleuve, c'est ce qui
  // porte assez d'eau ET qui va jusqu'au bout du pays.
  const fleuves = cours
    .filter((c) => c.fluxMax >= HYDRO.FLUX_FLEUVE && c.jusquALExutoire)
    .sort((a, b) => (b.fluxMax - a.fluxMax) || (a.chemin[0]! - b.chemin[0]!))
  const fils = fleuves.map(({ chemin }) => peindreFil(courbes.get(chemin[0]!) ?? chemin.map(centrePoint), width, height))
  return { fils, coeur, chenaux, eaux, lacs: tuilesDeLac }
}

/**
 * LE FIL D'UN FLEUVE — sa ligne centrale, en chaîne de tuiles 4-ADJACENTES.
 *
 * C'est le contrat que tout ce qui lit `map.fil` suppose : le champ de courant du client, les
 * gués, la nature de l'eau. On rastérise donc la MÊME courbe que celle qu'on vient de peindre
 * (lissée par Chaikin, comme le lit), et l'on jette les points hors carte.
 */
function peindreFil(points: readonly Point[], width: number, height: number): number[] {
  const out: number[] = []
  for (const p of rasteriser4(lisserChaikin(points, 2))) {
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue
    out.push(p.y * width + p.x)
  }
  return out
}
