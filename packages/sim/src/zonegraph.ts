/**
 * LE GRAPHE DE ZONES — la carte est un PLAN qu'on gravit, pas une texture qu'on lit.
 *
 * LE RENVERSEMENT (spec `worldgen.md` §1, décisions du 2026-07-14). L'ancienne vallée
 * dérivait sa STRUCTURE de son TERRAIN : un champ d'altitude fonction de la distance au
 * bord, puis des bandes de biome, puis des lieux posés dessus. Un champ concentrique n'a
 * ni pièce, ni porte, ni fond — on marchait tout droit de n'importe où vers n'importe où,
 * et deux seeds ne différaient que par leur papier peint.
 *
 * On génère désormais **le graphe D'ABORD** ; le terrain en découlera. Ce fichier ne
 * connaît pas une seule tuile : il produit douze zones, leurs paliers, leurs adjacences et
 * leurs SEUILS. C'est l'ossature, et elle se teste seule — avant qu'un caillou n'existe.
 *
 * CE QUI SURVIT DE `pays.ts`, ET QUI EST REPRIS ICI. Le semis sur treillis jitteré, le
 * warp des frontières, et surtout **le champ de MARGE** (la distance à la frontière la plus
 * proche). `pays.ts` portait déjà la bonne remarque, sans en tirer la conséquence : *« la
 * marge est la clé des enceintes — c'est ce champ qu'on sculpte pour lever un mur là où deux
 * pays se touchent. »* C'est exactement ce qu'on fait : la frontière devient une **falaise**,
 * et le seuil, une **brèche** dedans. Ce qui MEURT de `pays.ts`, c'est son identité par biais
 * d'humidité fondu sur 60 tuiles — un dégradé ne fabrique pas une zone qu'on reconnaît en
 * trois secondes.
 *
 * LE DIAGRAMME DE PUISSANCE, et pourquoi lui. Les cellules ne peuvent pas être égales : la
 * RACINE doit porter dix-sept villages, une zone T2 est un cul-de-sac. Il faut donc des
 * cellules de tailles voulues. Un Voronoï **multiplicativement** pondéré (Apollonius) donne
 * des cellules qui peuvent être **non connexes** — inacceptable : une zone en deux morceaux
 * est un bug de carte. Le diagramme de **puissance** (distance² − poids) garde des cellules
 * **convexes**, donc connexes par construction. C'est la seule raison de ce choix, et elle
 * suffit.
 *
 * Pur et déterministe : `hash2` pour le semis, les tirages et les permutations ; `fbm2` pour
 * le warp ; `+ - * /` et `sqrt` uniquement (invariant n°2). Aucune trigonométrie.
 */
import { distSq } from './geometry'
import { fbm2, hash2 } from './noise'


// ────────────────────────────────────────────────────────────────────────────
// LE DIMENSIONNEMENT — un seul bouton (spec R16)
// ────────────────────────────────────────────────────────────────────────────

/**
 * `JOUEURS_CIBLE` EST LE BOUTON, et c'est le seul (décision d'Alexis : *« partons sur 50,
 * mais je dois pouvoir piloter ça facilement »*). La surface de la racine s'en déduit, et la
 * carte se déduit de la racine. **On ne règle jamais la carte à la main.**
 */
export const MONDE = {
  JOUEURS_CIBLE: 50,

  /** Un village pour trois joueurs — l'hypothèse de peuplement du multi. */
  JOUEURS_PAR_VILLAGE: 3,
  /** Deux villages voisins sont à ≥ 130 tuiles : ~33 s de marche. Assez près pour se
   *  frotter (le jeu est un jeu d'alignement), assez loin pour ne pas se marcher dessus. */
  ESPACEMENT_VILLAGES: 130,

  /**
   * Tuiles TOTALES par joueur cible. 50 → 2,5 M de tuiles.
   *
   * Ce n'est pas un nombre tiré au hasard, il se remonte : dix-sept villages à 130 tuiles
   * d'écart réclament ~290 k tuiles de racine ; la racine pèse ~14 % de la carte (le reste :
   * onze zones et la roche) ; donc ~2,1 M, plus une marge de manœuvre. Il se **mesure** en
   * test (A17), il ne se devine pas.
   */
  TUILES_PAR_JOUEUR: 50_000,

  /** Vallée alpine : portrait, la bouche au sud. 2 de large pour 3 de haut. */
  RATIO_LARGEUR: 2,
  RATIO_HAUTEUR: 3,

  /** Le treillis du semis : 3 colonnes × 4 rangées = les 12 zones. */
  COLS: 3,
  ROWS: 4,
  /** Décalage du site dans sa cellule. < 0,5 → il n'en sort jamais. */
  JITTER: 0.26,

  /**
   * LES POIDS DU DIAGRAMME DE PUISSANCE, en tuiles². Ils se **soustraient** au carré de la
   * distance : un poids fort tire la frontière vers le voisin, donc agrandit la cellule.
   *
   * Le décalage de frontière vaut `poids / (2 × d)` où `d` est l'écart entre les deux sites
   * (~440 tuiles ici) : 165 000 déplace donc la frontière de ~190 tuiles en faveur de la racine.
   *
   * LA RACINE A ÉTÉ AGRANDIE (retour d'Alexis sur la carte rendue : « la racine est trop
   * petite »). Elle valait 110 000, soit **446 000 tuiles (17,8 % de la carte)** — déjà
   * au-dessus de la cible calculée (dix-sept villages à 130 tuiles d'écart ≈ 373 000). Le
   * calcul disait donc oui, et l'œil disait non : **c'est l'œil qui tranche.** À 165 000, elle
   * pèse **547 000 tuiles (21,9 %)**.
   *
   * ET IL Y A UN PLAFOND DUR, mesuré : à **210 000, la génération ÉCHOUE** — la racine écrase
   * une zone voisine au point qu'il ne lui reste plus deux frontières, donc plus deux portes,
   * et le tirage ne converge plus. Une saison = une carte : on n'approche pas d'une falaise
   * dont la chute coûte un serveur. 165 000 laisse une marge de 27 % avant le vide.
   *
   * Ce sont des ordres de grandeur MESURÉS (A17/A20), pas des vérités.
   */
  POIDS: { 0: 165_000, 1: 0, 2: -45_000 } as Record<Tier, number>,

  /** Amplitude du warp des frontières, en tuiles — ce qui les rend organiques.
   *  Borne : le déplacement doit rester injectif (pas de repli du plan), donc
   *  `AMP × 2,5 / ÉCHELLE < 1`. Ici 90 × 2,5 / 420 ≈ 0,54 : la frontière serpente,
   *  elle ne se recroise pas. */
  WARP_AMP: 90,
  WARP_SCALE: 420,

  /** Deux seuils d'une même zone sont à ≥ 250 tuiles : sept écrans (la caméra en montre 35).
   *  **Aucun village ne peut tenir les deux** — c'est toute la raison d'être du chiffre. */
  ECART_SEUILS: 250,

  /**
   * L'optimiseur VISE PLUS HAUT QUE LA BARRE, et atterrit donc au-dessus.
   *
   * Mesuré : en visant exactement 250, la médiane de l'écart obtenu était… 252. L'optimiseur
   * se pose PILE sur la contrainte et s'arrête (il satisfait, il ne maximise pas) — donc la
   * moindre seed un peu serrée passe dessous. En visant 300, on garde une marge sans rien
   * changer à la règle.
   */
  ECART_VISE: 300,

  /**
   * TROIS PORTES AU PLUS PAR ZONE — et c'est une décision de FORME, pas un correctif.
   *
   * Mesuré sur 20 seeds : une zone pouvait recevoir jusqu'à **cinq** seuils. Une pièce à cinq
   * portes n'est pas une pièce, c'est un carrefour — et c'est exactement là que l'écart de 250
   * tuiles devenait géométriquement impossible (dix paires à écarter sur un périmètre de 1800
   * tuiles). Plafonner sert donc le design ET la contrainte : **une zone est une PIÈCE**, on y
   * entre par deux portes, trois au grand maximum.
   */
  MAX_PORTES: 3,

  /**
   * LES IMPASSES — au plus deux zones T2 qui sont de vrais CULS-DE-SAC (décision d'Alexis).
   *
   * LE COMPROMIS, ET IL FAUT LE DIRE EXACTEMENT. La 2-connexité totale (aucun goulot nulle part)
   * interdit tout cul-de-sac : le Glacier ne pouvait plus être un fond de vallée dont on ne
   * ressort que par où l'on est entré. Or c'est une forme qu'on veut — un prix, au bout d'un
   * chemin, avec rien derrière.
   *
   * On rétablit donc jusqu'à deux IMPASSES, et on borne très précisément ce qu'elles coûtent :
   *
   *   • **Le CŒUR reste 2-connexe.** Les dix zones non terminales : retirer n'importe laquelle
   *     laisse les autres jointes. **Aucun goulot pour NAVIGUER** — la demande d'Alexis, tenue.
   *   • **Une impasse a DEUX PORTES sur son unique frontière**, à ≥ 250 tuiles l'une de l'autre.
   *     Sa gardienne est un point d'articulation (c'est inévitable : c'est la définition d'un
   *     cul-de-sac), mais **aucun VILLAGE ne peut la bloquer** — il faudrait tenir toute une zone
   *     de 430×484 tuiles, pas un couloir.
   *   • **Deux gardiennes DISTINCTES.** Personne ne coupe deux prix d'un coup.
   *   • **Jamais la T2 collée à la racine** (R13) : celle-là est un passage, pas un trophée — elle
   *     est là pour qu'on VOIE l'enfer depuis son pas de porte, pas pour qu'on s'y enferme.
   */
  MAX_IMPASSES: 2,

  /**
   * LA PURETÉ MINIMALE D'UNE PORTE, en tuiles — sa distance à la TROISIÈME zone la plus proche.
   *
   * Repéré par Alexis SUR LA CARTE RENDUE : *« les portes semblent souvent à l'intersection de
   * plusieurs zones. »* La cause était mécanique, et c'était mon optimiseur qui la produisait :
   * il ÉCARTE les portes les unes des autres au maximum — or les points d'une frontière les plus
   * éloignés des autres portes sont **ses deux extrémités**, c'est-à-dire les COINS TRIPLES.
   * L'optimiseur poussait donc systématiquement les portes dans les coins.
   *
   * Une porte dans un coin triple est une mauvaise porte : trois frontières s'y croisent, donc
   * aucune n'a d'épaisseur, donc la falaise est mince et **le seuil est court** (or un seuil doit
   * avoir une LONGUEUR — R10.4). Et le point tombe visuellement dans une zone qui n'est pas la
   * sienne.
   *
   * 55 tuiles : plus d'un écran et demi de marge autour de la porte, où l'on n'est que dans les
   * deux zones qu'elle relie. La falaise y a sa pleine épaisseur.
   */
  PURETE_MIN: 55,
}

/** La taille de la carte, DÉDUITE du nombre de joueurs. Jamais réglée à la main. */
export function tailleCarte(joueurs = MONDE.JOUEURS_CIBLE): { width: number; height: number } {
  const n = joueurs * MONDE.TUILES_PAR_JOUEUR
  // w × h = n, et h / w = RATIO_HAUTEUR / RATIO_LARGEUR → w = sqrt(n × L / H).
  const w = Math.round(Math.sqrt((n * MONDE.RATIO_LARGEUR) / MONDE.RATIO_HAUTEUR))
  const h = Math.round((w * MONDE.RATIO_HAUTEUR) / MONDE.RATIO_LARGEUR)
  return { width: w, height: h }
}

// ────────────────────────────────────────────────────────────────────────────
// LA TABLE DES ZONES — douze identités AUTORISÉES, pas tirées au sort
// ────────────────────────────────────────────────────────────────────────────

export type Tier = 0 | 1 | 2

/**
 * Une zone n'est pas un biome : c'est un THÈME (spec R7). Elle peut mêler des terrains — une
 * vieille forêt a ses clairières et son ruisseau — tant qu'elle se **reconnaît en trois
 * secondes**. C'est la lisibilité (principe 3 du directeur de jeu), et c'est très exactement
 * ce que le modèle des « pays » ne pouvait pas donner.
 *
 * Les identités sont ÉCRITES, jamais tirées : ce sont les positions et les adjacences qui
 * changent d'une seed à l'autre. C'est le modèle de Valheim — les biomes sont fixes, la carte
 * ne l'est pas.
 */
export interface ZoneDef {
  slug: string
  nom: string
  tier: Tier
  /**
   * La ressource STRUCTURANTE : elle n'existe NULLE PART ailleurs (spec R9). C'est elle qui
   * remplace la récompense de distance, qui était arithmétiquement morte (`circleFactor`
   * multipliait le stock d'un nœud, mais un sac fait trente bois où qu'on soit). *Loin* ne
   * veut plus dire « plus » : ça veut dire « **le seul endroit où ça existe** ».
   */
  structurante?: string
  /**
   * Les ressources DE LIAISON — partagées avec d'autres zones, et **déclarées** (décision
   * d'Alexis : le charbon naît au Karst ET au Versant Brûlé). Ce n'est pas un relâchement de
   * R9, c'est une COUTURE : deux zones qu'un même besoin relie donnent au joueur un choix de
   * route. Le partage se déclare ; il ne se subit pas.
   */
  liaison?: string[]
}

export const ZONES: readonly ZoneDef[] = [
  // ── T0 : LA RACINE ──────────────────────────────────────────────────────
  // On y meurt de faim, pas de crocs. Au début : la Cendrière avance (spec R27).
  { slug: 'pres_bas', nom: 'les Prés Bas', tier: 0 },

  // ── T1 : LA CEINTURE — chacune enseigne une leçon différente ─────────────
  { slug: 'sylve', nom: 'la Vieille Sylve', tier: 1, structurante: 'gros_bois' },
  { slug: 'karst', nom: 'le Karst', tier: 1, structurante: 'iron_ore', liaison: ['coal'] },
  { slug: 'tourbiere', nom: 'la Tourbière', tier: 1, structurante: 'tourbe' },
  { slug: 'alpages', nom: 'les Hauts Alpages', tier: 1, structurante: 'pierre_de_taille' },
  { slug: 'brule', nom: 'le Versant Brûlé', tier: 1, structurante: 'cendre', liaison: ['coal'] },
  { slug: 'ruines', nom: 'la Combe aux Ruines', tier: 1, structurante: 'components' },

  // ── T2 : LES MARGES — le contenu se décidera ; la carte lui ménage la place ──
  { slug: 'cendriere', nom: 'la Cendrière', tier: 2 },
  { slug: 'glacier', nom: 'le Glacier', tier: 2 },
  { slug: 'aiguilles', nom: 'les Aiguilles', tier: 2 },
  { slug: 'gouffre', nom: 'le Gouffre', tier: 2 },
  { slug: 'lac_mort', nom: 'le Lac Mort', tier: 2 },
]

/** Le compte par palier — la table EST la contrainte : 1 + 6 + 5 = 12 = COLS × ROWS. */
export const RACINE_SLUG = 'pres_bas'

// ────────────────────────────────────────────────────────────────────────────
// LE GRAPHE
// ────────────────────────────────────────────────────────────────────────────

export interface Zone {
  id: number
  def: ZoneDef
  /** Le site, en tuiles — le centre de la zone, là où son nom se pose. */
  x: number
  y: number
  /** Le poids du diagramme de puissance (dérivé du palier). */
  poids: number
}

/** Un SEUIL — une porte entre deux zones. Un LIEU, pas un mur (spec R10). */
export interface Seuil {
  id: number
  /** Les deux zones qu'il relie. `a < b`, toujours — la paire est canonique. */
  a: number
  b: number
  /** Le point de passage, en tuiles : sur la frontière des deux zones. */
  x: number
  y: number
  /**
   * `false` pour le premier seuil d'une paire, `true` pour le second.
   * **Le second est TOUJOURS pire** (plus long, plus froid, plus gardé) : ce n'est pas un
   * raccourci, c'est l'alternative de celui qu'on a chassé du premier (spec R11).
   */
  secours: boolean
}

export interface GrapheZones {
  seed: number
  width: number
  height: number
  zones: Zone[]
  /** L'id de la racine (les Prés Bas). */
  racine: number
  /** Les seuils — les SEULS passages. Tout le reste de chaque frontière est une falaise. */
  seuils: Seuil[]
  /** Adjacence géométrique brute (qui touche qui), avant le choix des seuils. */
  voisins: number[][]
  /**
   * LES IMPASSES — les culs-de-sac. Des zones T2 terminales : une seule voisine, rien derrière.
   * On y va pour le prix, et on en revient par où l'on est entré. Le reste de la carte (le CŒUR)
   * n'en dépend jamais.
   */
  impasses: number[]
  /**
   * La GARDIENNE de chaque impasse (même index). C'est la seule zone par laquelle on y accède.
   *
   * Elle est STOCKÉE, pas recalculée : trois endroits en ont besoin (le choix des seuils, les
   * contraintes, les gardes), et trois recalculs finissent toujours par diverger. Une seule
   * vérité.
   */
  gardiennes: number[]
}

/**
 * À qui appartient ce point ? Le diagramme de PUISSANCE : `distance² − poids`. La position
 * d'interrogation est déformée par un bruit (domain warp) — d'où des frontières qui
 * serpentent au lieu de polygones.
 *
 * On balaie TOUS les sites (douze) : c'est douze distances au carré, moins cher que n'importe
 * quelle indexation spatiale, et ça supprime toute une classe de bugs de voisinage (le warp
 * déplace le point de 90 tuiles ; un balayage local raterait parfois le vrai plus proche —
 * c'est le genre de faute qui ne se voit que sur une seed sur vingt, c'est-à-dire *en
 * production*).
 */
function warp(g: { seed: number }, x: number, y: number): { wx: number; wy: number } {
  const wx = x + MONDE.WARP_AMP * (fbm2(x, y, MONDE.WARP_SCALE, (g.seed ^ 0x1b56c4f9) | 0) * 2 - 1)
  const wy = y + MONDE.WARP_AMP * (fbm2(x, y, MONDE.WARP_SCALE, (g.seed ^ 0x7d2ac03b) | 0) * 2 - 1)
  return { wx, wy }
}

export interface Echantillon {
  /** L'id de la zone propriétaire. */
  zone: number
  /** L'id de la zone d'en face — celle qui se dispute la frontière la plus proche. */
  voisin: number
  /**
   * Distance à la frontière la plus proche, en tuiles. 0 dessus, croît vers le cœur.
   *
   * C'EST LE CHAMP QU'ON SCULPTE. La falaise, c'est `marge < ÉPAISSEUR` ; le seuil, c'est une
   * brèche qu'on y perce. Toute la topologie du jeu sort de cette seule valeur.
   */
  marge: number
  /**
   * LA PURETÉ — à quelle distance est la TROISIÈME zone la plus proche.
   *
   * ELLE A ÉTÉ AJOUTÉE PARCE QU'ELLE MANQUAIT, ET LE DÉFAUT SE VOYAIT À L'ŒIL (Alexis, sur la
   * carte rendue : *« les portes semblent souvent à l'intersection de plusieurs zones, et
   * certains points blancs semblent en dehors de leur zone »*).
   *
   * LA CAUSE ÉTAIT MÉCANIQUE, et c'est mon optimiseur qui la produisait : il ÉCARTE les portes
   * les unes des autres au maximum. Or, sur une frontière, les points les plus éloignés des
   * autres portes sont **ses deux extrémités** — c'est-à-dire les **COINS TRIPLES**, là où trois
   * zones se rejoignent. L'optimiseur poussait donc systématiquement les portes dans les coins.
   *
   * Et une porte dans un coin triple est une MAUVAISE porte : la falaise y est mince (trois
   * frontières se croisent, aucune n'a d'épaisseur), le seuil y est donc court, et le point tombe
   * visuellement dans une troisième zone. On exige désormais qu'une porte soit **PURE** : loin de
   * toute zone tierce. C'est une contrainte de FORME, et elle valait bien d'être vue.
   */
  purete: number
}

/**
 * L'échantillon en un point — la primitive de tout le reste.
 *
 * La marge se dérive des deux meilleures « puissances » (d² − w). Sur la frontière exacte,
 * `pa === pb` : leur écart vaut donc 0 dessus et croît quand on s'éloigne. La conversion en
 * TUILES divise par `2 × d(site_a, site_b)`, qui est le gradient de `pb − pa` le long de la
 * ligne des sites — un simple développement : `pb − pa = |X−B|² − |X−A|²`, dont la dérivée
 * vaut `2 × |A−B|`.
 *
 * `sqrt` est autorisé (invariant n°2) et nécessaire ici : on compare un écart à une largeur
 * en tuiles, pas deux distances entre elles.
 */
export function echantillonAt(g: GrapheZones, x: number, y: number): Echantillon {
  const { wx, wy } = warp(g, x, y)
  let best = 0
  let bestP = Infinity
  let second = 0
  let secondP = Infinity
  let third = 0
  let thirdP = Infinity
  for (const z of g.zones) {
    const p = distSq(wx, wy, z.x, z.y) - z.poids
    if (p < bestP) {
      thirdP = secondP
      third = second
      secondP = bestP
      second = best
      bestP = p
      best = z.id
    } else if (p < secondP) {
      thirdP = secondP
      third = second
      secondP = p
      second = z.id
    } else if (p < thirdP) {
      thirdP = p
      third = z.id
    }
  }
  const a = g.zones[best]!
  const b = g.zones[second]!
  const c = g.zones[third]!
  const dab = Math.sqrt(distSq(a.x, a.y, b.x, b.y))
  // dab > 0 : deux sites ne coïncident jamais (treillis + jitter < 0,5 cellule).
  const marge = (secondP - bestP) / (2 * dab)
  // La PURETÉ : la même arithmétique, mais contre la TROISIÈME zone. Sur un coin triple, les
  // trois puissances s'égalisent et la pureté tombe à zéro — c'est exactement le lieu qu'on veut
  // fuir quand on perce une porte.
  const dac = Math.sqrt(distSq(a.x, a.y, c.x, c.y))
  const purete = dac > 0 ? (thirdP - bestP) / (2 * dac) : Infinity
  return { zone: best, voisin: second, marge, purete }
}

/**
 * LE SEMIS, LES PALIERS, LES SEUILS. O(sites²) — négligeable, et appelé une fois.
 */
export function deriveGrapheZones(seed: number, joueurs = MONDE.JOUEURS_CIBLE): GrapheZones {
  const { width, height } = tailleCarte(joueurs)
  const cellW = width / MONDE.COLS
  const cellH = height / MONDE.ROWS

  // ── 1. Le semis : un site par cellule du treillis, jitteré ────────────────
  const sites: { id: number; x: number; y: number }[] = []
  for (let j = 0; j < MONDE.ROWS; j++) {
    for (let i = 0; i < MONDE.COLS; i++) {
      const id = j * MONDE.COLS + i
      const jx = (hash2(i, j, (seed ^ 0x5a01) | 0) * 2 - 1) * MONDE.JITTER
      const jy = (hash2(j, i, (seed ^ 0x5a02) | 0) * 2 - 1) * MONDE.JITTER
      sites.push({ id, x: (i + 0.5 + jx) * cellW, y: (j + 0.5 + jy) * cellH })
    }
  }

  // ── 2. L'adjacence géométrique, AVANT les poids ───────────────────────────
  // Deux sites sont voisins si aucun troisième ne se glisse dans le disque dont ils sont un
  // diamètre (le graphe de GABRIEL). C'est un sous-graphe de Delaunay, il est PLANAIRE et
  // connexe, et il ne produit pas les longues arêtes rasantes qui donneraient des frontières
  // de quelques tuiles — donc des seuils impossibles à placer.
  const voisins: number[][] = sites.map(() => [])
  for (let a = 0; a < sites.length; a++) {
    for (let b = a + 1; b < sites.length; b++) {
      const sa = sites[a]!
      const sb = sites[b]!
      const mx = (sa.x + sb.x) / 2
      const my = (sa.y + sb.y) / 2
      const r2 = distSq(sa.x, sa.y, sb.x, sb.y) / 4
      let gabriel = true
      for (const sc of sites) {
        if (sc.id === a || sc.id === b) continue
        if (distSq(sc.x, sc.y, mx, my) < r2) { gabriel = false; break }
      }
      if (gabriel) { voisins[a]!.push(b); voisins[b]!.push(a) }
    }
  }

  // GABRIEL PEUT LAISSER UN SITE À UN SEUL VOISIN (un coin du treillis) — et une zone à un
  // seul voisin ne peut PAS recevoir deux portes sur deux frontières différentes. Elle se
  // bloquerait alors avec un seul village, ce qui est très exactement ce que le directeur de
  // jeu a demandé d'éviter (« mitiger le grief d'une zone complète »). On augmente donc
  // l'adjacence jusqu'au degré 2, par le site non-voisin le plus proche.
  // (Mesuré : sans ceci, le Glacier de la seed 1234 n'avait qu'un seul seuil.)
  for (let a = 0; a < sites.length; a++) {
    while (voisins[a]!.length < 2) {
      const sa = sites[a]!
      let best = -1
      let bestD = Infinity
      for (const sc of sites) {
        if (sc.id === a || voisins[a]!.includes(sc.id)) continue
        const d = distSq(sa.x, sa.y, sc.x, sc.y)
        if (d < bestD) { bestD = d; best = sc.id }
      }
      if (best < 0) break
      voisins[a]!.push(best)
      voisins[best]!.push(a)
    }
  }

  // ── 3. LA RACINE — la bouche de la vallée, au sud ─────────────────────────
  // On arrive par la bouche : c'est le côté ouvert du relief, et c'est la seule direction
  // d'où l'on peut entrer dans une vallée alpine sans être déjà un alpiniste.
  //
  // Elle doit avoir au moins TROIS voisins : il lui en faut deux en T1 (spec R14 — la
  // première décision du joueur doit être un CHOIX) et un en T2 (spec R13 — de ton pas de
  // porte, tu vois l'enfer). Un site de coin n'y suffit pas toujours.
  let racine = -1
  let meilleur = Infinity
  for (const s of sites) {
    if (voisins[s.id]!.length < 3) continue
    // Distance au milieu du bord sud. Départage par id croissant : déterministe.
    const d = distSq(s.x, s.y, width / 2, height)
    if (d < meilleur) { meilleur = d; racine = s.id }
  }
  // Filet : si aucun site n'a trois voisins (treillis dégénéré), on prend le plus au sud.
  if (racine < 0) {
    meilleur = Infinity
    for (const s of sites) {
      const d = distSq(s.x, s.y, width / 2, height)
      if (d < meilleur) { meilleur = d; racine = s.id }
    }
  }

  // ── 4. LES PALIERS, puis L'ADJACENCE RÉELLE — et on RE-TIRE si ça ne tient pas
  //
  // LA CIRCULARITÉ, ET COMMENT ON EN SORT. Le poids d'une zone dépend de son palier ; la forme
  // des cellules dépend des poids ; l'adjacence dépend de la forme. Assigner les paliers
  // D'APRÈS l'adjacence serait donc circulaire.
  //
  // On tranche par un TIRAGE VÉRIFIÉ : on assigne les paliers d'après une adjacence
  // approchée (les sites nus, graphe de Gabriel — elle suffit à dire qui est « loin » de la
  // racine), on construit la vraie carte, puis on VÉRIFIE les contraintes sur l'adjacence
  // RÉELLE. Si elles ne tiennent pas, on re-tire avec un autre sel. Déterministe (le sel est
  // le numéro d'essai), et ça converge en un ou deux essais.
  //
  // C'est ce qui supprime toute une classe de bugs que les rustines n'atteignaient pas : une
  // arête d'adjacence SANS frontière réelle, un seuil qui atterrit dans une troisième zone.
  // **La frontière réelle EST l'adjacence.** Rien d'autre ne fait foi.
  const prof = bfs(voisins, racine)

  // ── 5. LA RACINE EST AUSSI GROSSE QUE LA GÉOMÉTRIE L'AUTORISE ─────────────
  //
  // MESURE QUI A TOUT CHANGÉ : au poids fixe de 165 000, **7 seeds sur 60 ne généraient
  // PAS DU TOUT** — la racine gonflée écrasait une voisine au point qu'il ne lui restait plus
  // deux frontières, donc plus deux portes, et aucun tirage ne convergeait. Douze seeds de
  // garde ne l'avaient pas vu : elles avaient eu de la chance. Sur un jeu où **une saison =
  // une seed**, 12 % de cartes mort-nées, c'est un serveur ruiné une fois sur huit.
  //
  // ET LE RÉESSAI NE RÉESSAYAIT RIEN D'UTILE : il re-tirait les PALIERS, alors que le défaut
  // était GÉOMÉTRIQUE. Si le site racine n'a que deux frontières réelles, aucun tirage de
  // paliers ne lui donnera jamais deux T1 **et** une T2. On tournait seize fois pour rien.
  //
  // Le poids de la racine DESCEND donc jusqu'à ce que la carte tienne. La racine est aussi
  // grosse que la géométrie de CETTE seed le permet, jamais plus — et à poids nul, on retombe
  // sur un Voronoï ordinaire, qui se comporte toujours bien. La terminaison est garantie.
  //
  // LE NOMBRE D'IMPASSES EST DÉGRESSIF — deux si la géométrie le permet, une sinon, zéro au pire.
  //
  // POURQUOI IL LE FAUT, et c'est la géométrie qui l'impose, pas un caprice : une gardienne a
  // **structurellement au moins QUATRE portes** — deux pour son impasse (sans quoi un village la
  // bloquerait), et deux au minimum vers le cœur (sans quoi le cœur cesse d'être 2-connexe, et le
  // goulot revient par la fenêtre). Or quatre portes toutes distantes de 250 tuiles, sur le
  // périmètre d'une seule cellule, **n'est pas toujours possible**.
  //
  // **On ne relâche pas la règle : on renonce à un cul-de-sac.** Zéro impasse tient toujours
  // (c'est la carte d'avant les impasses) — la génération termine, quoi qu'il arrive.
  //
  // L'ORDRE DES BOUCLES EST LE SUJET, et la première écriture le prenait à l'envers : elle
  // essayait 2, puis 1, puis 0 **sur le premier tirage venu** — et comme 0 réussit toujours, elle
  // s'en contentait sans jamais aller voir si un AUTRE tirage aurait porté deux culs-de-sac.
  // Mesuré : 8 cartes sur 40 se retrouvaient sans la moindre impasse. On épuise donc TOUS les
  // tirages à 2 impasses avant d'en concéder une, et tous ceux à 1 avant de n'en concéder aucune.
  // (Le poids de la racine reste la boucle EXTERNE : sa taille est une exigence dure — elle doit
  // porter dix-sept villages —, pas une préférence.)
  let g: GrapheZones | null = null
  for (const poidsRacine of POIDS_RACINE_DEGRESSIFS) {
    // LE CATALOGUE DES FRONTIÈRES SE CALCULE UNE FOIS PAR TIRAGE, pas une fois par combinaison.
    // Il coûte 160 k échantillons (un balayage de la carte au pas de 4) ; le recalculer pour
    // chaque nombre d'impasses essayé faisait exploser le temps de génération — la garde de
    // déterminisme, qui génère chaque carte deux fois, expirait.
    const essais = []
    for (let sel = 0; sel < 6; sel++) {
      const tiers = assignerPaliers(sites, voisins, prof, racine, seed, sel)
      const zones = identifierZones(sites, tiers, seed, sel, poidsRacine)
      const cand: GrapheZones = {
        seed, width, height, zones, racine, seuils: [], voisins: [], impasses: [], gardiennes: [],
      }
      const catalogues = catalogueFrontieres(cand)
      cand.voisins = adjacenceReelle(zones.length, catalogues)
      placerLaCendriere(cand)
      essais.push({ cand, catalogues })
    }

    for (const combien of [MONDE.MAX_IMPASSES, 1, 0]) {
      for (const { cand, catalogues } of essais) {
        const imp = choisirImpasses(cand, catalogues, combien)
        if (imp.impasses.length !== combien) continue
        cand.impasses = imp.impasses
        cand.gardiennes = imp.gardiennes
        if (!contraintesTenues(cand)) continue
        cand.seuils = choisirSeuils(cand, catalogues)
        if (!portesTenues(cand)) continue
        g = cand
        break
      }
      if (g) break
    }
    if (g) break
  }
  if (!g) {
    throw new Error(
      `zonegraph: seed ${seed} — aucune forme ne tient les contraintes, même à poids de racine nul. ` +
        `Une saison = une carte : on préfère un échec bruyant à une carte muette.`,
    )
  }
  return g
}

/**
 * Les poids de racine essayés, du plus ambitieux au plus modeste. Le premier qui tient gagne.
 * Le dernier (0) est un Voronoï ordinaire : il tient toujours, donc la génération termine.
 */
const POIDS_RACINE_DEGRESSIFS = [165_000, 140_000, 115_000, 90_000, 60_000, 30_000, 0]

/**
 * LES PORTES TIENNENT-ELLES ? Deux portes d'une même zone doivent être à ≥ ECART_SEUILS.
 *
 * C'est la SECONDE moitié de la leçon des 60 seeds : même quand la carte se génère, une seed
 * pouvait sortir deux portes à **141 tuiles** l'une de l'autre — un seul village les tenait
 * toutes les deux, et toute la règle du chemin alternatif tombait. La recherche locale fait ce
 * qu'elle peut ; quand la géométrie ne le permet pas, ce n'est pas à la règle de plier, c'est
 * à la FORME de changer. On rejette, et on essaie une autre forme.
 */
function portesTenues(g: GrapheZones): boolean {
  const min = MONDE.ECART_SEUILS * MONDE.ECART_SEUILS
  for (const z of g.zones) {
    const m = g.seuils.filter((s) => s.a === z.id || s.b === z.id)
    if (m.length < 2) return false
    for (let i = 0; i < m.length; i++) {
      for (let j = i + 1; j < m.length; j++) {
        if (distSq(m[i]!.x, m[i]!.y, m[j]!.x, m[j]!.y) < min) return false
      }
    }
  }
  return true
}

/**
 * LES CONTRAINTES DURES, vérifiées sur l'adjacence RÉELLE (spec R13/R14).
 *
 * 1. La racine touche **≥ 2 zones T1** — la première décision du joueur doit être un CHOIX.
 * 2. La racine touche **≥ 1 zone T2** — *de ton pas de porte, tu vois l'enfer.*
 * 3. Toute zone a **≥ 2 voisines** — sans quoi elle ne pourra jamais avoir deux portes, et un
 *    seul village la bloquerait.
 */
function contraintesTenues(g: GrapheZones): boolean {
  const vois = g.voisins[g.racine]!
  if (vois.filter((v) => g.zones[v]!.def.tier === 1).length < 2) return false
  if (!vois.some((v) => g.zones[v]!.def.tier === 2)) return false
  if (!g.voisins.every((l) => l.length >= 2)) return false

  // 4. AUCUN GOULOT POUR NAVIGUER — le CŒUR doit être 2-connexe.
  //
  // Le cœur = toutes les zones SAUF les impasses. Les impasses, elles, sont des culs-de-sac
  // assumés : leur gardienne EST un point d'articulation, c'est la définition même d'un
  // cul-de-sac, et c'est le prix qu'Alexis a accepté pour ravoir un fond de vallée. Mais ce
  // qu'elle coupe, c'est UN trophée — jamais une route.
  //
  // On le vérifie ICI, sur le graphe complet des frontières : **si le cœur complet n'est pas
  // 2-connexe, aucun de ses sous-graphes ne peut l'être.** La seed est perdue d'avance, et il
  // faut la re-tirer tout de suite au lieu d'élaguer pour rien.
  const impasses = new Set(g.impasses)
  const coeur = g.zones.map((z) => z.id).filter((id) => !impasses.has(id))
  if (!estBiconnexeSur(coeur, g.voisins)) return false

  // 5. Chaque impasse a sa gardienne DANS LE CŒUR, et **les gardiennes sont distinctes** :
  //    personne ne coupe deux trophées d'un coup.
  if (g.gardiennes.length !== g.impasses.length) return false
  const vues = new Set<number>()
  for (const gd of g.gardiennes) {
    if (impasses.has(gd) || vues.has(gd)) return false
    vues.add(gd)
  }
  return true
}

/**
 * LES IMPASSES — jusqu'à deux zones T2 qui sont de vrais culs-de-sac.
 *
 * On prend les T2 **les plus profondes** (les plus éloignées de la racine dans le graphe) : c'est
 * là qu'un fond de vallée a un sens. On EXCLUT la T2 collée à la racine (R13) — celle-là est un
 * passage, pas un trophée : elle existe pour qu'on VOIE l'enfer depuis son pas de porte, pas pour
 * qu'on s'y enferme.
 *
 * On exclut aussi les zones dont le retrait de leurs autres arêtes casserait le cœur : la
 * vérification est faite par `contraintesTenues`, qui rejette le tirage. On ne bricole pas.
 */
function choisirImpasses(
  g: GrapheZones,
  catalogues: Map<string, { x: number; y: number }[]>,
  combien: number,
): { impasses: number[]; gardiennes: number[] } {
  const prof = bfs(g.voisins, g.racine)
  const candidates = g.zones
    .filter((z) => z.def.tier === 2)
    .filter((z) => !g.voisins[g.racine]!.includes(z.id)) // jamais la T2 du pas de la porte
    .map((z) => ({ id: z.id, prof: prof[z.id]! }))
    // Les plus PROFONDES d'abord. Départage par id : déterministe.
    .sort((a, b) => b.prof - a.prof || a.id - b.id)

  /**
   * L'ÉCARTEMENT MAXIMAL QUE PORTE UNE FRONTIÈRE — deux points d'elle, les plus éloignés.
   *
   * C'EST LA CONTRAINTE QUI MANQUAIT, et elle faisait échouer TOUS les tirages. Une impasse porte
   * ses deux portes sur son **unique** frontière : si cette frontière est courte, les deux portes
   * ne peuvent pas s'écarter de 250 tuiles, et un seul village les tiendrait toutes les deux —
   * ce qui est précisément ce qu'on refuse. (Mesuré avant correctif : les deux portes d'une
   * impasse se retrouvaient à **134 tuiles**.)
   *
   * On ne relâche donc pas la règle : **on exige une frontière assez longue.** Une zone dont
   * aucune frontière ne porte deux portes écartées n'a pas le droit d'être une impasse — elle
   * restera un passage, et c'est très bien.
   */
  const ecartement = (a: number, b: number): number => {
    const pts = catalogues.get(`${Math.min(a, b)}:${Math.max(a, b)}`)
    if (!pts || pts.length < 2) return 0
    let max = 0
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        max = Math.max(max, distSq(pts[i]!.x, pts[i]!.y, pts[j]!.x, pts[j]!.y))
      }
    }
    return Math.sqrt(max)
  }

  const impasses: number[] = []
  const gardiennes: number[] = []
  for (const c of candidates) {
    if (impasses.length >= combien) break
    // Retirer cette zone du cœur ne doit pas casser la 2-connexité de ce qui reste.
    const coeur = g.zones.map((z) => z.id).filter((id) => id !== c.id && !impasses.includes(id))
    if (!estBiconnexeSur(coeur, g.voisins)) continue

    // LA GARDIENNE : celle dont la frontière avec l'impasse est **la plus longue**, et elle doit
    // porter deux portes à ECART_VISE (on vise plus haut que la barre : l'optimiseur satisfait,
    // il ne maximise pas — cf. ECART_VISE). Gardiennes DISTINCTES : personne ne coupe deux
    // trophées d'un coup.
    const libres = g.voisins[c.id]!
      .filter((v) => !impasses.includes(v) && !gardiennes.includes(v))
      .map((v) => ({ v, e: ecartement(c.id, v) }))
      .sort((p, q) => q.e - p.e || p.v - q.v)
    const meilleure = libres[0]
    if (!meilleure || meilleure.e < MONDE.ECART_VISE) continue

    impasses.push(c.id)
    gardiennes.push(meilleure.v)
  }
  return { impasses, gardiennes }
}

/**
 * LES PALIERS — biaisés par la distance, pas dictés par elle (« go Valheim kind »).
 * La profondeur dans le graphe BIAISE le palier ; un jitter le brouille.
 */
function assignerPaliers(
  sites: { id: number }[],
  voisins: number[][],
  prof: number[],
  racine: number,
  seed: number,
  sel: number,
): Tier[] {
  const tiers = new Array<Tier>(sites.length).fill(1)
  tiers[racine] = 0
  const autres = sites
    .filter((s) => s.id !== racine)
    .map((s) => ({
      id: s.id,
      // Le jitter (±0,45) est INFÉRIEUR à un pas de profondeur : il permute des zones de
      // profondeurs voisines, il ne téléporte pas une T2 au fond du jardin. Les contraintes
      // dures s'en chargent, elles, et volontairement.
      score: prof[s.id]! + (hash2(s.id, seed ^ (sel * 0x9e37), 0x7e1) - 0.5) * 0.9,
    }))
  autres.sort((p, q) => p.score - q.score || p.id - q.id) // départage par id : déterministe
  for (let k = 0; k < autres.length; k++) tiers[autres[k]!.id] = k < 6 ? 1 : 2
  reparerPaliers(tiers, voisins, racine, seed)
  return tiers
}

/** Les identités : une permutation À L'INTÉRIEUR de chaque palier. Les zones sont ÉCRITES
 *  (Valheim : les biomes sont fixes) ; seules leurs positions et adjacences changent. */
function identifierZones(
  sites: { id: number; x: number; y: number }[],
  tiers: Tier[],
  seed: number,
  sel: number,
  poidsRacine: number,
): Zone[] {
  const zones: Zone[] = []
  for (const tier of [0, 1, 2] as const) {
    const cases = sites.filter((s) => tiers[s.id] === tier).map((s) => s.id)
    const defs = melange(ZONES.filter((d) => d.tier === tier), (seed ^ (0xd1 + tier)) + sel * 31)
    if (defs.length !== cases.length) {
      throw new Error(
        `zonegraph: ${cases.length} sites de palier ${tier} pour ${defs.length} zones déclarées. ` +
          `La table ZONES et le treillis (${MONDE.COLS}×${MONDE.ROWS}) doivent se correspondre exactement.`,
      )
    }
    for (let k = 0; k < cases.length; k++) {
      const id = cases[k]!
      const s = sites[id]!
      // Le poids de la RACINE est celui qu'on essaie ; les autres viennent de la table.
      const poids = tier === 0 ? poidsRacine : MONDE.POIDS[tier]
      zones.push({ id, def: defs[k]!, x: s.x, y: s.y, poids })
    }
  }
  zones.sort((p, q) => p.id - q.id)
  return zones
}

/** Profondeur de chaque nœud depuis la racine (BFS ; voisins visités par id croissant). */
function bfs(voisins: number[][], racine: number): number[] {
  const prof = new Array<number>(voisins.length).fill(Infinity)
  prof[racine] = 0
  const file = [racine]
  for (let head = 0; head < file.length; head++) {
    const v = file[head]!
    for (const w of [...voisins[v]!].sort((a, b) => a - b)) {
      if (prof[w] !== Infinity) continue
      prof[w] = prof[v]! + 1
      file.push(w)
    }
  }
  return prof
}

/**
 * LES DEUX CONTRAINTES DURES, réparées après le tirage (spec R13/R14).
 *
 * 1. La racine touche **≥ 2 zones T1** — la première décision du joueur doit être un CHOIX,
 *    jamais un goulot unique.
 * 2. La racine touche **≥ 1 zone T2** — *de ton pas de porte, tu vois l'enfer.* C'est le
 *    frisson de Valheim, et on le rend OBLIGATOIRE : le critère mou d'origine (« une T2
 *    adjacente à une zone de palier ≤ 1 ») est vrai dans n'importe quel graphe connexe, donc
 *    il ne testait rien.
 *
 * On répare par ÉCHANGE (une T1 contre une T2), ce qui préserve les comptes 6/5 par
 * construction — un swap ne crée ni ne détruit de palier.
 */
function reparerPaliers(tiers: Tier[], voisins: number[][], racine: number, seed: number): void {
  const vois = [...voisins[racine]!].sort((a, b) => a - b)
  const loin = (t: Tier) =>
    // La zone de palier `t` la PLUS éloignée de la racine — celle qu'on peut sacrifier sans
    // remords. Départage par id : déterministe.
    tiers
      .map((tt, id) => ({ id, tt }))
      .filter((z) => z.tt === t && z.id !== racine && !vois.includes(z.id))
      .sort((p, q) => (hash2(p.id, seed, 0xbe) - hash2(q.id, seed, 0xbe)) || (p.id - q.id))[0]?.id

  // (1) Au moins deux T1 chez les voisins de la racine.
  for (let garde = 0; garde < 4; garde++) {
    if (vois.filter((v) => tiers[v] === 1).length >= 2) break
    const promu = vois.find((v) => tiers[v] === 2)
    const sacrifie = loin(1)
    if (promu === undefined || sacrifie === undefined) break
    tiers[promu] = 1
    tiers[sacrifie] = 2
  }

  // (2) Au moins une T2 chez les voisins de la racine — SANS casser (1).
  if (!vois.some((v) => tiers[v] === 2)) {
    // On ne dégrade que si la racine garde ≥ 2 voisines T1 après coup : d'où le `> 2`.
    const t1Vois = vois.filter((v) => tiers[v] === 1)
    if (t1Vois.length > 2) {
      const sacrifie = t1Vois[t1Vois.length - 1]!
      const promu = loin(2)
      if (promu !== undefined) {
        tiers[sacrifie] = 2
        tiers[promu] = 1
      }
    }
  }
}

/**
 * LE GRAPHE EST-IL 2-CONNEXE ? — connexe, ET sans aucun point d'articulation.
 *
 * Un **point d'articulation** est une zone dont le retrait déconnecte la carte : c'est un GOULOT
 * D'ÉTRANGLEMENT, et le village qui le tient tient tout ce qui est derrière. C'est le défaut
 * qu'Alexis a repéré sur la carte rendue (seed 909 : une seule zone commandait l'accès à tout le
 * T2), et que la garantie « deux portes par zone » ne couvrait pas — deux portes empêchent de
 * bloquer une PORTE, pas de bloquer une ZONE.
 *
 * On le vérifie bêtement, en retirant chaque zone tour à tour : douze sommets, c'est douze
 * parcours en largeur — quelques microsecondes. Tarjan ferait mieux à l'asymptote et serait plus
 * facile à écrire de travers ; à cette taille, **la version qu'on peut relire gagne**.
 */
export function estBiconnexeSur(membres: readonly number[], voisins: readonly number[][]): boolean {
  if (membres.length < 3) return membres.length <= 1 // deux zones ne peuvent pas être 2-connexes
  const dans = new Set(membres)
  const joignables = (retiree: number): number => {
    const depart = membres.find((m) => m !== retiree)
    if (depart === undefined) return 0
    const vu = new Set([depart])
    const file = [depart]
    for (let h = 0; h < file.length; h++) {
      for (const w of voisins[file[h]!]!) {
        // On ne circule QUE dans le sous-ensemble : une route qui sort du cœur et y revient par
        // une impasse n'est pas une route (une impasse n'a qu'une porte de sortie — la même).
        if (w === retiree || !dans.has(w) || vu.has(w)) continue
        vu.add(w)
        file.push(w)
      }
    }
    return vu.size
  }
  // Connexe tout court : on ne retire rien (-1 n'est le nom d'aucune zone).
  if (joignables(-1) !== membres.length) return false
  // Et sans point d'articulation : retirer N'IMPORTE LEQUEL laisse tous les autres joints.
  for (const z of membres) {
    if (joignables(z) !== membres.length - 1) return false
  }
  return true
}

/** La 2-connexité d'un jeu d'arêtes OUVERTES, sur le cœur (les impasses exclues). */
function coeurBiconnexe(g: GrapheZones, ouvertes: ReadonlySet<string>): boolean {
  const n = g.zones.length
  const vo: number[][] = Array.from({ length: n }, () => [])
  for (const k of ouvertes) {
    const [a, b] = k.split(':').map(Number) as [number, number]
    vo[a]!.push(b)
    vo[b]!.push(a)
  }
  const impasses = new Set(g.impasses)
  const coeur = g.zones.map((z) => z.id).filter((id) => !impasses.has(id))
  if (!estBiconnexeSur(coeur, vo)) return false
  // Et chaque impasse reste rattachée au cœur (elle a sa gardienne).
  for (const z of g.impasses) {
    if (!vo[z]!.some((v) => !impasses.has(v))) return false
  }
  return true
}

/**
 * LA CENDRIÈRE EST LA T2 DU PAS DE LA PORTE — et c'est la clef de voûte de la saison.
 *
 * *Décision d'Alexis, 2026-07-14 : « on a une zone T2 à côté de la zone de départ — est-ce qu'on
 * n'en ferait pas notre zone de propagation de la difficulté ? »*
 *
 * CE QUE ÇA REQUALIFIE. R13 posait une T2 au pas de la porte pour le FRISSON (« de chez toi, tu
 * vois l'enfer »). Elle devient un **MOTEUR** : l'enfer que tu vois est celui qui viendra te
 * chercher. Ce n'est plus une curiosité, c'est un compte à rebours planté dans ton jardin.
 *
 * ET ÇA DONNE UN LIEU AUX TROIS ACTES. Le GDD promet trois actes de saison, et le troisième
 * **s'appelle déjà « Cendre »** — mais ce n'est aujourd'hui qu'un multiplicateur de faim, un
 * nombre qui monte. La saison cesse d'être un compteur qui durcit : elle devient **une vallée
 * qu'on perd**. Personne ne dit au joueur de monter ; le sol brûle derrière lui.
 *
 * LE PRIX, payé sciemment : l'identité de la T2 voisine de la racine n'est plus tirée au sort.
 * On y perd un peu de rejouabilité — on y gagne une **cosmologie stable**, et c'est un bon
 * échange : le monde a désormais un centre, et il est en train de brûler.
 *
 * Techniquement, c'est un ÉCHANGE d'identités entre deux sites de MÊME palier. Les poids du
 * diagramme ne dépendent que du palier — pas de l'identité — donc la géométrie ne bouge pas d'un
 * bit. On peut le faire APRÈS avoir calculé les frontières, et c'est ce qui sort de la
 * circularité.
 */
function placerLaCendriere(g: GrapheZones): void {
  const CENDRE = 'cendriere'
  const actuelle = g.zones.find((z) => z.def.slug === CENDRE)
  if (!actuelle) return
  const voisinesT2 = g.voisins[g.racine]!.filter((v) => g.zones[v]!.def.tier === 2)
  if (voisinesT2.length === 0) return // pas de T2 au pas de la porte : `contraintesTenues` rejettera
  if (voisinesT2.includes(actuelle.id)) return // elle y est déjà

  // Elle n'y est pas : on l'ÉCHANGE avec la T2 qui s'y trouve. Deux sites de même palier, donc
  // de même poids : la carte est identique au bit près, seuls les NOMS bougent.
  const cible = g.zones[voisinesT2[0]!]!
  const def = actuelle.def
  actuelle.def = cible.def
  cible.def = def
}

/** Fisher-Yates seedé — déterministe, et le seul mélange autorisé dans /sim. */
function melange<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(hash2(i, seed, 0x3f) * (i + 1)))
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

/**
 * LE CHOIX DES SEUILS — on part de TOUTES les frontières, et on en FERME.
 *
 * LA FAUTE DES DEUX PREMIÈRES ÉCRITURES, et elle vaut d'être gravée. Elles construisaient un
 * arbre couvrant sur l'adjacence des SITES (graphe de Gabriel), puis perçaient une porte dans
 * chaque arête. Mais l'adjacence des sites et les frontières RÉELLES ne coïncident pas : la
 * frontière naît du diagramme de puissance — avec ses poids — puis se tord sous le warp. Deux
 * sites « voisins » peuvent finir séparés par un troisième. On perçait donc des portes dans des
 * murs imaginaires, et des zones se retrouvaient avec une seule sortie.
 *
 * **La frontière réelle EST l'adjacence.** Rien d'autre ne fait foi. On part donc du réel :
 * les frontières existent, on décide seulement lesquelles deviennent des PORTES et lesquelles
 * restent des falaises pleines. On ferme tant qu'on peut, sous deux invariants — et c'est
 * l'ordre de fermeture qui fait la forme :
 *
 *   • le graphe reste **2-CONNEXE** (voir ci-dessous) ;
 *   • aucune zone ne dépasse MAX_PORTES (une pièce à cinq portes est un carrefour, pas une
 *     pièce — et c'est là que l'écart de 250 tuiles devenait géométriquement impossible).
 *
 * ═══ 2-CONNEXE, ET POURQUOI ÇA ABROGE « L'ARBRE DE ZONES » ═══
 *
 * Retour d'Alexis SUR LA CARTE RENDUE (2026-07-14) : *« sur la seed 909, il faut passer par une
 * seule zone pour accéder au T2 — il ne faut pas de goulot d'étranglement pour naviguer sur
 * l'ensemble de la map. »* Il a raison, et ma garantie ne couvrait pas ça : je garantissais que
 * chaque zone a **≥ 2 portes**, ce qui empêche de bloquer une *porte*. Mais rien n'empêchait une
 * **ZONE ENTIÈRE** d'être le seul chemin vers tout un pan de la carte — un **point
 * d'articulation** au sens des graphes. Un village qui tient cette zone-là tient tout ce qui est
 * derrière : c'est exactement le grief qu'on voulait mitiger, un cran plus haut.
 *
 * On exige donc la **2-connexité par les sommets** : toute zone est atteignable par deux chemins
 * qui ne partagent **aucune zone**. Retirer n'importe quelle zone laisse le reste connexe.
 *
 * ═══ MAIS LE CUL-DE-SAC REVIENT — LES IMPASSES (2e décision d'Alexis) ═══
 *
 * La 2-connexité TOTALE interdit tout cul-de-sac : le Glacier ne pouvait plus être un fond de
 * vallée dont on ne ressort que par où l'on est entré. Or c'est une forme qu'on veut — un prix,
 * au bout d'un chemin, avec rien derrière. Alexis a demandé le compromis, et le voici, avec son
 * coût dit exactement :
 *
 *   • **Le CŒUR (les dix zones non terminales) reste 2-connexe.** Aucun goulot pour NAVIGUER :
 *     la demande d'origine est tenue, intégralement.
 *   • **Deux IMPASSES au plus** — des T2 profondes, jamais celle du pas de la porte. Leur
 *     gardienne EST un point d'articulation : c'est **inévitable**, c'est la définition même d'un
 *     cul-de-sac. Mais ce qu'elle coupe, c'est UN TROPHÉE, jamais une route.
 *   • **Une impasse a DEUX PORTES sur son unique frontière**, à ≥ 250 tuiles l'une de l'autre :
 *     **aucun village ne la bloque.** Il faudrait tenir toute une zone de 430×484 tuiles, pas un
 *     couloir — et ça, aucun village ne le peut.
 *   • **Gardiennes DISTINCTES** : personne ne coupe deux trophées d'un coup.
 *
 * L'invariant est maintenu À CHAQUE FERMETURE, jamais réparé après coup : on part du graphe
 * complet des frontières et on ne ferme une frontière que si la 2-connexité du CŒUR SURVIT.
 * C'est ce qui rend la propriété vraie par construction — et non par un rattrapage qui
 * laisserait des cas.
 */
function choisirSeuils(g: GrapheZones, catalogues: Map<string, { x: number; y: number }[]>): Seuil[] {
  const n = g.zones.length
  const cle = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`
  const degre = new Array<number>(n).fill(0)
  const ouvertes = new Set<string>()
  for (let a = 0; a < n; a++) {
    for (const b of g.voisins[a]!) {
      if (b <= a) continue
      ouvertes.add(cle(a, b))
      degre[a]!++
      degre[b]!++
    }
  }

  // ── LES IMPASSES : on les MURE, sauf d'un côté ────────────────────────────
  // Une impasse est un cul-de-sac : UNE seule voisine, sa gardienne. On ferme donc toutes ses
  // autres frontières — et c'est la seule fermeture qu'on s'autorise sans passer par le test de
  // 2-connexité, parce qu'elle est le BUT, pas un effet de bord. (Le cœur, lui, ne perd rien :
  // une impasse n'a jamais été une route pour personne.)
  const impasses = new Set(g.impasses)
  const gardienneDe = new Map<number, number>()
  for (let k = 0; k < g.impasses.length; k++) {
    const z = g.impasses[k]!
    const gardienne = g.gardiennes[k]
    if (gardienne === undefined) continue
    gardienneDe.set(z, gardienne)
    for (const v of g.voisins[z]!) {
      if (v === gardienne) continue
      const k = cle(z, v)
      if (!ouvertes.delete(k)) continue
      degre[z]!--
      degre[v]!--
    }
    // ON PROVISIONNE LA SECONDE PORTE DE L'IMPASSE dans le budget de sa gardienne. Sans ça,
    // l'élagage croit la gardienne à trois portes, la laisse tranquille, puis on lui en ajoute
    // une quatrième — et ses portes ne peuvent plus toutes s'écarter de 250 tuiles. (C'est ce
    // qui faisait échouer TOUS les tirages : la contrainte était contradictoire sans que rien ne
    // le dise.) L'impasse, elle, garde son unique frontière — qui portera ses deux portes.
    degre[gardienne]! += 1
    degre[z]! += 1
  }

  for (let passe = 0; passe < 6; passe++) {
    // Les candidates à la fermeture, triées par CHARGE du couple (on dégonfle les moyeux
    // d'abord), puis par clé — déterministe de bout en bout.
    const cands = [...ouvertes].sort((p, q) => {
      const [pa, pb] = p.split(':').map(Number) as [number, number]
      const [qa, qb] = q.split(':').map(Number) as [number, number]
      const chargeQ = degre[qa]! + degre[qb]!
      const chargeP = degre[pa]! + degre[pb]!
      return chargeQ - chargeP || (p < q ? -1 : 1)
    })
    let ferme = false
    for (const k of cands) {
      const [a, b] = k.split(':').map(Number) as [number, number]
      // On ne ferme que si l'une des deux zones est encore en SURCHARGE. Sans cette condition,
      // on fermerait jusqu'à l'anneau nu — et la carte perdrait toute sa richesse de routes.
      if (degre[a]! <= MONDE.MAX_PORTES && degre[b]! <= MONDE.MAX_PORTES) continue
      // Une frontière d'impasse ne se touche pas : c'est sa SEULE, et elle est sacrée.
      if (impasses.has(a) || impasses.has(b)) continue
      // ET SEULEMENT SI LA 2-CONNEXITÉ DU CŒUR SURVIT : c'est l'invariant, et il est maintenu à
      // chaque fermeture. (Elle implique degré ≥ 2 dans le cœur : inutile de le vérifier à part.)
      ouvertes.delete(k)
      if (!coeurBiconnexe(g, ouvertes)) { ouvertes.add(k); continue }
      degre[a]!--
      degre[b]!--
      ferme = true
    }
    if (!ferme) break
  }

  // ── Les portes, posées une par une, chacune fuyant les précédentes ────────
  // Glouton max-min : chaque porte se place AUSSI LOIN QUE POSSIBLE de celles déjà posées sur
  // les deux zones qu'elle touche.
  const seuils: Seuil[] = []
  for (const k of [...ouvertes].sort()) {
    const [a, b] = k.split(':').map(Number) as [number, number]
    const cands = catalogues.get(k)
    if (!cands || cands.length === 0) continue
    const poses = seuils.filter((s) => s.a === a || s.b === a || s.a === b || s.b === b)
    let best: { x: number; y: number }
    if (poses.length > 0) {
      best = cands[0]!
      let bestScore = -1
      for (const c of cands) {
        let score = Infinity
        for (const s of poses) score = Math.min(score, distSq(c.x, c.y, s.x, s.y))
        if (score > bestScore) { bestScore = score; best = c }
      }
    } else {
      // Aucune contrainte : le MILIEU de la frontière. La falaise y est la plus épaisse (on est
      // loin des coins triples), donc le seuil y est le plus LONG — et un seuil doit avoir une
      // longueur (spec R10.4).
      best = cands[Math.floor(cands.length / 2)]!
    }
    seuils.push({ id: seuils.length, a, b, x: best.x, y: best.y, secours: false })
  }

  // ── LA SECONDE PORTE D'UNE IMPASSE — sur sa SEULE frontière ───────────────
  //
  // C'est ce qui rend le cul-de-sac ACCEPTABLE. Une impasse n'a qu'une voisine ; sa gardienne
  // est donc un point d'articulation, et rien n'y peut rien. Mais **un village ne bloque pas une
  // ZONE — il bloque une PORTE.** En perçant deux portes sur cette unique frontière, à 250 tuiles
  // l'une de l'autre (sept écrans), on rend le blocage impossible en pratique : il faudrait tenir
  // une zone de 430×484 tuiles, ce qu'aucun village ne peut faire.
  //
  // La distance est garantie par `ecarterLesPortes`, juste en dessous : les deux portes bordent
  // les MÊMES deux zones, donc elles se repoussent l'une l'autre au maximum de ce que la
  // frontière permet — et `portesTenues` rejette le tirage si 250 est hors d'atteinte.
  for (const [z, gardienne] of gardienneDe) {
    const k = cle(z, gardienne)
    const cands = catalogues.get(k)
    if (!cands || cands.length < 2) continue
    const premiere = seuils.find((s) => s.a === Math.min(z, gardienne) && s.b === Math.max(z, gardienne))
    let best = cands[0]!
    let bestScore = -1
    for (const c of cands) {
      const score = premiere ? distSq(c.x, c.y, premiere.x, premiere.y) : 0
      if (score > bestScore) { bestScore = score; best = c }
    }
    seuils.push({
      id: seuils.length,
      a: Math.min(z, gardienne),
      b: Math.max(z, gardienne),
      x: best.x,
      y: best.y,
      secours: true,
    })
  }

  ecarterLesPortes(seuils, catalogues)
  marquerLesSecours(g, seuils)
  return seuils
}

/**
 * QUELLES PORTES SONT « DE SECOURS » — et la première écriture était FAUSSE.
 *
 * ELLE MARQUAIT une porte comme secours dès que **l'une** de ses deux zones avait déjà été vue.
 * Au bout de deux ou trois portes, toutes les zones sont vues — donc **tout le reste devenait
 * secours**. Alexis l'a repéré à l'œil sur la carte rendue : *« je n'ai que 2 portes principales,
 * le reste est secondaire. »* Le drapeau ne disait rien.
 *
 * LA FAUTE ÉTAIT CONCEPTUELLE, pas arithmétique : « secours » n'est pas une propriété d'une porte
 * *dans l'absolu* — la même porte est la voie normale pour la zone d'un côté et le détour pour
 * celle de l'autre. Il fallait un point de vue, et il n'y en a qu'un qui ait un sens : **celui du
 * joueur, qui part des Prés Bas.**
 *
 * D'où : on parcourt le graphe en largeur DEPUIS LA RACINE. La porte par laquelle on atteint une
 * zone pour la première fois est sa **voie naturelle** — c'est celle qu'on empruntera sans y
 * penser. Toutes les autres sont les **ALTERNATIVES** : les chemins de traverse, ceux qu'on prend
 * quand on a été chassé du premier. Ce sont elles qui seront plus longues, plus froides, plus
 * gardées (R11) — et il est juste qu'elles le soient, puisque personne ne les emprunte par hasard.
 *
 * Les portes naturelles forment un arbre couvrant : **onze**. Les alternatives sont le reste.
 */
function marquerLesSecours(g: GrapheZones, seuils: Seuil[]): void {
  const naturelles = new Set<number>()
  const vu = new Set([g.racine])
  const file = [g.racine]
  for (let h = 0; h < file.length; h++) {
    const v = file[h]!
    // Ordre déterministe : par id de seuil croissant.
    for (const s of [...seuils].sort((p, q) => p.id - q.id)) {
      const autre = s.a === v ? s.b : s.b === v ? s.a : -1
      if (autre < 0 || vu.has(autre)) continue
      vu.add(autre)
      naturelles.add(s.id) // c'est PAR ELLE qu'on découvre cette zone : c'est sa voie normale
      file.push(autre)
    }
  }
  for (const s of seuils) s.secours = !naturelles.has(s.id)
}

/**
 * LES PORTES D'UNE MÊME ZONE S'ÉCARTENT — recherche locale, après coup.
 *
 * Le glouton pose les portes dans un ordre figé et ne revient jamais sur son choix : la
 * première porte d'une zone est posée sans savoir où tombera la seconde. D'où des paires trop
 * serrées (mesuré : deux seuils du Glacier à 234 tuiles, pour un minimum de 250).
 *
 * On repasse donc : tant qu'une paire viole l'écart, on essaie de DÉPLACER l'une des deux sur
 * sa propre frontière, vers le candidat qui maximise sa distance minimale aux autres portes de
 * ses zones. On n'accepte que si le minimum GLOBAL s'améliore — donc ça converge, et ça ne
 * casse jamais ce qui allait bien.
 *
 * Déterministe : ordre d'itération fixe, aucun tirage.
 */
function ecarterLesPortes(seuils: Seuil[], catalogues: Map<string, { x: number; y: number }[]>): void {
  /**
   * LE COÛT — la SOMME des violations, en tuiles. Zéro quand tout va bien.
   *
   * Et ce choix est LA correction : la première écriture maximisait le minimum GLOBAL, et
   * restait bloquée dans un optimum local — écarter les portes de la Vieille Sylve resserrait
   * (un peu) celles d'une autre zone, le minimum global ne montait pas, le déplacement était
   * refusé, et on s'immobilisait à 238 tuiles pour un minimum de 250. Une somme, elle, DESCEND
   * : elle voit qu'on échange une grosse violation contre une petite. On ne mesure pas le pire,
   * on mesure la DETTE.
   */
  const cout = (): number => {
    let total = 0
    for (let i = 0; i < seuils.length; i++) {
      for (let j = i + 1; j < seuils.length; j++) {
        const p = seuils[i]!
        const q = seuils[j]!
        // Deux portes ne se gênent que si elles bordent une MÊME zone : c'est là, et là
        // seulement, qu'un village pourrait les tenir toutes les deux.
        if (p.a !== q.a && p.a !== q.b && p.b !== q.a && p.b !== q.b) continue
        const d = Math.sqrt(distSq(p.x, p.y, q.x, q.y))
        // On vise ECART_VISE (300), pas ECART_SEUILS (250) : l'optimiseur SATISFAIT, il ne
        // maximise pas — il se pose pile sur sa cible et s'arrête. En visant la barre, on
        // atterrissait dessus (médiane mesurée : 252), et la moindre seed serrée passait
        // dessous. En visant plus haut, on garde de la marge sans changer la règle.
        if (d < MONDE.ECART_VISE) total += MONDE.ECART_VISE - d
      }
    }
    return total
  }

  for (let passe = 0; passe < 40; passe++) {
    if (cout() === 0) return
    let ameliore = false
    for (const s of seuils) {
      const cands = catalogues.get(`${s.a}:${s.b}`)
      if (!cands || cands.length < 2) continue
      const ox = s.x
      const oy = s.y
      let meilleur = cout()
      let bx = ox
      let by = oy
      for (const c of cands) {
        s.x = c.x
        s.y = c.y
        const apres = cout()
        // `<` strict : on n'accepte que ce qui améliore VRAIMENT — sans quoi deux candidats
        // équivalents se relaieraient à l'infini.
        if (apres < meilleur) { meilleur = apres; bx = c.x; by = c.y }
      }
      s.x = bx
      s.y = by
      if (bx !== ox || by !== oy) ameliore = true
    }
    if (!ameliore) return // plus rien à gagner : la géométrie ne le permet pas
  }
}

/**
 * LES CATALOGUES DE FRONTIÈRE — on ÉNUMÈRE les vraies frontières, on ne les devine pas.
 *
 * DEUX ÉCRITURES RATÉES AVANT CELLE-CI, et la leçon vaut d'être écrite. La première cherchait
 * le point de frontière par DICHOTOMIE le long du segment qui joint les deux sites, décalé
 * perpendiculairement. C'est géométriquement séduisant et pratiquement faux : dès qu'on
 * s'éloigne du milieu, le segment décalé traverse une TROISIÈME zone, la dichotomie est
 * jetée, et le catalogue se réduit à une poignée de points **tous groupés au même endroit**.
 * Le placement glouton n'avait alors plus rien à choisir — il a même rendu le résultat PIRE
 * (deux seuils de la Cendrière à 146 tuiles, contre 249 avant).
 *
 * On balaie donc la carte, une fois, au pas de `PAS_FRONTIERE`, et on relève toutes les tuiles
 * dont un voisin appartient à une autre zone. C'est bête, c'est robuste, et ça donne la
 * frontière ENTIÈRE — coins triples compris, courbes du warp comprises. Coût : ~160 k
 * échantillons pour la carte du jeu, soit une fraction de seconde, une seule fois.
 */
const PAS_FRONTIERE = 4

export function catalogueFrontieres(g: GrapheZones): Map<string, { x: number; y: number }[]> {
  const out = new Map<string, { x: number; y: number }[]>()
  const p = PAS_FRONTIERE
  // Le champ grossier : qui possède quoi, au pas de 4 tuiles.
  const cols = Math.floor(g.width / p)
  const rows = Math.floor(g.height / p)
  const owner = new Int32Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      owner[j * cols + i] = echantillonAt(g, i * p, j * p).zone
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const me = owner[j * cols + i]!
      for (const [di, dj] of [[1, 0], [0, 1]] as const) {
        const ii = i + di
        const jj = j + dj
        if (ii >= cols || jj >= rows) continue
        const lui = owner[jj * cols + ii]!
        if (lui === me) continue
        const x = Math.round(((i + ii) * p) / 2)
        const y = Math.round(((j + jj) * p) / 2)
        // On écarte les frontières qui rasent le bord de carte : un seuil doit avoir de la
        // terre des deux côtés, et l'anneau de bordure est bloquant de toute façon.
        if (x < 30 || y < 30 || x >= g.width - 30 || y >= g.height - 30) continue
        // ON VALIDE LE POINT À LA TUILE PRÈS, et ce n'est pas du zèle : le champ grossier est
        // échantillonné au pas de 4, et le MILIEU de deux échantillons voisins peut tomber
        // dans une TROISIÈME zone (un coin triple). Mesuré : un « seuil » entre les zones 8
        // et 11 atterrissait dans la zone 10. Un seuil doit séparer les deux zones qu'il
        // prétend relier — sinon ce n'est pas une porte, c'est une erreur de carte.
        const e = echantillonAt(g, x, y)
        const a = Math.min(me, lui)
        const b = Math.max(me, lui)
        if ((e.zone !== a || e.voisin !== b) && (e.zone !== b || e.voisin !== a)) continue
        // ET LE POINT DOIT ÊTRE PUR — loin de toute TROISIÈME zone (voir `Echantillon.purete`).
        // Sans cette borne, l'optimiseur qui écarte les portes les pousse vers les extrémités des
        // frontières, c'est-à-dire dans les COINS TRIPLES : la falaise y est mince, le seuil y est
        // court, et la porte tombe visuellement dans une zone qui n'est pas la sienne.
        if (e.purete < MONDE.PURETE_MIN) continue
        const k = `${a}:${b}`
        const liste = out.get(k)
        if (liste) liste.push({ x, y })
        else out.set(k, [{ x, y }])
      }
    }
  }
  return out
}

/** L'adjacence RÉELLE — celle des frontières qui existent, pas celle des sites qui se
 *  regardent. C'est la seule qui compte : on ne perce pas une porte dans un mur imaginaire. */
function adjacenceReelle(n: number, catalogues: Map<string, { x: number; y: number }[]>): number[][] {
  const adj: number[][] = Array.from({ length: n }, () => [])
  for (const [k, pts] of catalogues) {
    // Une frontière de moins de 5 points (20 tuiles) est un contact, pas une frontière : on
    // n'y percerait qu'une porte coincée dans un coin.
    if (pts.length < 5) continue
    const [a, b] = k.split(':').map(Number) as [number, number]
    adj[a]!.push(b)
    adj[b]!.push(a)
  }
  for (const l of adj) l.sort((x, y) => x - y)
  return adj
}
