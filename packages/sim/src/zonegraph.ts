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
import { hash2 } from './noise'


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
  TUILES_PAR_JOUEUR: 75_000,

  /** Vallée alpine : portrait, la bouche au sud. 2 de large pour 3 de haut. */
  RATIO_LARGEUR: 2,
  RATIO_HAUTEUR: 3,

  /**
   * LE BLOC — la maille de TOUT ce qui est rectiligne, en tuiles (spec R32). Les rectangles de
   * régions sont alignés dessus : un bord de zone tombe donc TOUJOURS pile sur une arête de bloc.
   */
  BLOC: 16,

  /**
   * ═══ LA CARTE N'EST PAS UN PAVAGE — décision d'Alexis, 2026-07-14 (sur croquis) ═══
   *
   * *« Les invariants sont : la position de cendre et T0, la forme approximative des zones, le
   * passage par la zone de neige pour accéder à plusieurs zones endgame, le fait que tout ne soit
   * pas un pavage de la map. »*
   *
   * Toutes les zones ne se touchent pas bord à bord. Là où deux régions ne se rejoignent pas, il
   * reste du VIDE — sur la carte plate, une **masse de ROCHE infranchissable** (façon montagne
   * RimWorld). Le vide a donc une masse : il ferme la vallée, et une frontière entre deux pays se
   * longe jusqu'à son SEUIL — *on ne cherche pas une porte, on longe le mur jusqu'au passage.*
   */

  /** Deux régions sont VOISINES si la crevasse qui les sépare ne fait pas plus que ça (tuiles).
   *  Au-delà, elles se tournent le dos : le gouffre est trop large, il n'y a pas d'isthme. */
  MUR_MAX: 80,

  /** Et il faut qu'elles se FASSENT FACE sur au moins cette longueur : en deçà, c'est un contact
   *  de coin, et un seuil dans un coin n'est pas un seuil. */
  FACE_MIN: 48,

  /** Le treillis du semis — SEULEMENT pour le repli en diagramme de puissance (voir `geometries`). */
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
  /**
   * LA PURETÉ MINIMALE d'une porte, en tuiles — sa distance à une TROISIÈME région.
   *
   * Une porte percée dans un coin triple n'est pas une porte : elle tombe visuellement dans une zone
   * qui n'est pas la sienne, et sa falaise y est trop mince pour se longer.
   *
   * RECALIBRÉE de 55 à 40 le 2026-07-14, et il faut dire pourquoi : depuis que les rectangles se
   * CHEVAUCHENT (spec R40), la pureté se mesure contre le rectangle NOMINAL d'une région, pas contre
   * sa forme visible — qui peut être bien plus petite (une voisine lui a mangé un morceau). Le
   * chiffre sur-estime donc la proximité d'une tierce. 40 tuiles restent deux blocs et demi : une
   * porte n'est jamais dans un coin.
   */
  PURETE_MIN: 40,
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
   * ═══ LE NÉVÉ BLANC — une RÉGION, mais PAS UNE ZONE (spec §3) ═══
   *
   * *« On ne le visite pas, on le TRAVERSE. »* Blizzard perpétuel, aucun bois, aucune eau liquide,
   * aucun gibier : c'est un **SEUIL GÉANT**, et il commande l'accès aux trois T2 endgame du nord
   * (invariant du croquis d'Alexis : *« le passage par la zone de neige pour accéder à plusieurs
   * zones endgame »*).
   *
   * LA CONSÉQUENCE EST CE QUI REND LE GOULOT ADMISSIBLE, et elle vaut d'être écrite : R11bis
   * interdit qu'une ZONE soit un goulot, parce qu'**un village peut la tenir**. On ne peut pas
   * tenir un Névé — on n'y vit pas, il ne nourrit rien (R10.3). Un goulot qu'on ne peut pas tenir
   * n'est pas un goulot : c'est une PORTE. Les gardes qui parlent de zones (A21, A4) l'excluent
   * donc explicitement, et c'est la seule exception du modèle.
   *
   * Il garde le nord ; mais il n'y monte pas seul : **deux zones du cœur y donnent** (décision
   * d'Alexis, 2026-07-14). Sans quoi celle qui y mènerait serait, elle, un vrai goulot tenable.
   */
  traverse?: true
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

  // ── LE SEUIL GÉANT — une région, pas une zone (voir `ZoneDef.traverse`) ──
  { slug: 'neve', nom: 'le Névé Blanc', tier: 2, traverse: true },
]

/** Les 12 vraies ZONES — celles qu'on habite, qu'on tient, qu'un village peut bloquer. */
export const VRAIES_ZONES = ZONES.filter((z) => !z.traverse)

/** Le compte par palier — la table EST la contrainte : 1 + 6 + 5 = 12 = COLS × ROWS. */
export const RACINE_SLUG = 'pres_bas'

// ────────────────────────────────────────────────────────────────────────────
// LE GRAPHE
// ────────────────────────────────────────────────────────────────────────────

/** Un rectangle de carte, en tuiles. Aligné sur `MONDE.BLOC`, toujours. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Zone {
  id: number
  def: ZoneDef
  /** Le site, en tuiles — le centre de la zone, là où son nom se pose. */
  x: number
  y: number
  /** Le poids du diagramme de puissance (dérivé du palier). Inutilisé sur un pavage. */
  poids: number
  /**
   * ═══ LA ZONE EST UN RECTANGLE — et c'est le cas NORMAL (décision d'Alexis, 2026-07-14) ═══
   *
   * *« J'aimerais plus insister sur la partie carré/rectangle des zones. On essaye de les faire
   * correspondre à ces formes, on fallback vers un polygone plus complexe QUE si on n'a pas le
   * choix. »*
   *
   * Quand ce champ est présent, la zone EST ce rectangle — exactement, au bloc près. Quand il est
   * absent, la carte est retombée sur le **repli** : le diagramme de puissance, qui rend des
   * polygones rectilignes en escalier (voir `geometries`). Le repli existe parce qu'une saison est
   * une carte : mieux vaut une zone en escalier qu'une seed mort-née (R26).
   */
  rect?: Rect
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
  /** La direction qui va de `a` vers `b` — l'axe que l'isthme traverse. Les formes étant des
   *  polygones en L (voir `Case.p`), la normale à la frontière ne se devine pas : on la CONSTATE. */
  ax: number
  ay: number
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
 * ═══ LE SQUELETTE — la carte est DESSINÉE, pas tirée au sort ═══
 *
 * *« Voici le design de map ciblé ; les proportions ne sont pas forcément respectées mais la forme
 * et l'emboîtement général est là. »* (Alexis, 2026-07-14, croquis à l'appui.)
 *
 * On cesse de générer une partition et on POSE une carte. Treize rectangles, écrits ici, en
 * fractions de carte — la seed ne fait plus que les jitterer et permuter les identités dans chaque
 * palier. C'est le modèle de Valheim jusqu'au bout : *les biomes sont fixes, la carte ne l'est pas.*
 *
 * CE QUE LE CROQUIS IMPOSE, et qui ne se négocie pas :
 *
 *   1. **LA CENDRE EST AU SUD, SOUS LE T0.** Le front remonte donc vers le nord, à travers le
 *      jardin. La saison n'est pas un compteur : c'est une vallée qu'on perd, et elle se perd par
 *      le bas (spec R27-R30).
 *   2. **LA NEIGE COMMANDE LE NORD.** Les trois T2 endgame ne se rejoignent qu'en traversant le
 *      Névé. Mais **deux zones du cœur y donnent** — sans quoi celle qui y mènerait serait un
 *      goulot tenable, ce que R11bis interdit.
 *   3. **LA CARTE N'EST PAS UN PAVAGE.** Tout ce qui n'est pas une région est une CREVASSE.
 *
 * Les fractions ci-dessous sont en [0,1] : `x` vers l'est, `y` vers le SUD (0 = le nord de la
 * carte, 1 = son sud). On lit donc le tableau du nord au sud, comme le croquis.
 */
interface Case {
  /** Le rôle dans le squelette — sert au débogage et aux gardes. */
  role: string
  tier: Tier
  /** Identité IMPOSÉE (la Cendrière est au sud, le Névé est la bande) ; sinon tirée dans le tier. */
  fixe?: string
  /**
   * ═══ LA PRIORITÉ — ce qui fait qu'une terrasse SE POSE SUR une autre ═══
   *
   * Les rectangles du squelette **SE CHEVAUCHENT**, largement, et c'est tout le sujet. Alexis, trois
   * fois : *« certaines zones mordaient sur d'autres et c'est ça qui donnait l'impression de
   * terrasses avec des rampes »*, puis *« n'hésite pas à mordre un peu plus »*, puis — en
   * capitales — *« JE PERSISTE, LES ZONES NE MORDENT QUASIMENT PAS LES UNES DANS LES AUTRES »*.
   *
   * Il avait raison, et je regardais mal. Des rectangles qui s'ALIGNENT bord à bord font un mur de
   * briques ; des rectangles qui SE RECOUVRENT font des terrasses. Dans le croquis, le T1 étroit
   * monte franchement DANS la bande de neige ; le grand T1 mord DANS les T1 du bas.
   *
   * Une tuile appartient donc à la région de plus haute priorité qui la contient. La zone haute
   * **se pose sur** la basse et lui mange un morceau — dont la forme visible devient un POLYGONE
   * RECTILIGNE (un L, un rectangle échancré). C'est très exactement le repli qu'Alexis avait
   * autorisé d'emblée : *« on fallback vers un polygone plus complexe QUE si on n'a pas le choix. »*
   * On n'avait pas le choix : c'est le chevauchement qui fabrique le relief.
   */
  p: number
  x0: number
  y0: number
  x1: number
  y1: number
}

const SQUELETTE: readonly Case[] = [
  // Les `y` se CHEVAUCHENT d'une région à l'autre — c'est délibéré, et c'est ce qui fait le relief.
  // `p` tranche : la plus haute priorité se pose SUR l'autre et lui mange un morceau.

  // ── LE FEU — la Cendrière, plein sud. Tout le monde mord dedans ; elle ne mord sur personne. ──
  { role: 'cendre', tier: 2, fixe: 'cendriere', p: 0, x0: 0.02, y0: 0.895, x1: 0.98, y1: 0.985 },

  // ── LE JARDIN — la racine. Elle déborde SUR la Cendrière ; la ceinture débordera sur elle. ────
  { role: 'racine', tier: 0, fixe: RACINE_SLUG, p: 1, x0: 0.05, y0: 0.665, x1: 0.95, y1: 0.915 },

  // ── LA CEINTURE — trois T1 POSÉES SUR le jardin : elles lui mangent le haut, et son bord devient
  //    une dentelle de terrasses. Elles ne se touchent PAS entre elles — pour passer de l'une à
  //    l'autre, il faut redescendre au jardin ou monter par le milieu. La carte a des BOUCLES.
  { role: 'ceinture-ouest', tier: 1, p: 2, x0: 0.02, y0: 0.490, x1: 0.42, y1: 0.720 },
  { role: 'ceinture-centre', tier: 1, p: 2, x0: 0.46, y0: 0.525, x1: 0.70, y1: 0.720 },
  { role: 'ceinture-est', tier: 1, p: 2, x0: 0.74, y0: 0.455, x1: 0.98, y1: 0.720 },

  // ── LE MILIEU — `milieu-ouest` se pose SUR deux T1 de la ceinture à la fois, et mord de sept
  //    points de carte dans chacune. C'est le geste central du croquis : un surplomb, pas un contact.
  { role: 'milieu-ouest', tier: 1, p: 3, x0: 0.10, y0: 0.310, x1: 0.62, y1: 0.560 },
  { role: 'milieu-est', tier: 1, p: 3, x0: 0.70, y0: 0.270, x1: 0.98, y1: 0.520 },

  // ── LES DEUX APPROCHES DU NÉVÉ — ce qui empêche un village de verrouiller l'endgame. ──────────
  { role: 'approche-ouest', tier: 1, p: 4, x0: 0.22, y0: 0.190, x1: 0.48, y1: 0.390 },
  { role: 'approche-est', tier: 2, p: 4, x0: 0.64, y0: 0.190, x1: 0.98, y1: 0.330 },

  // ── LE NORD — trois T2, de hauteurs différentes, qui montent dans la neige. ───────────────────
  { role: 'nord-ouest', tier: 2, p: 5, x0: 0.02, y0: 0.015, x1: 0.40, y1: 0.195 },
  { role: 'nord-centre', tier: 2, p: 5, x0: 0.38, y0: 0.008, x1: 0.66, y1: 0.195 },
  { role: 'nord-est', tier: 2, p: 5, x0: 0.64, y0: 0.045, x1: 0.98, y1: 0.195 },

  // ── LE NÉVÉ — LA PRIORITÉ LA PLUS HAUTE, et c'est ce qui le sauve. Tout le monde monte dedans ;
  //    lui reste une BANDE CONTINUE, pleine largeur, qu'on ne peut pas contourner. Un seuil géant
  //    échancré ne serait plus un seuil : ce serait un trou dans le mur.
  { role: 'neve', tier: 2, fixe: 'neve', p: 9, x0: 0.02, y0: 0.150, x1: 0.98, y1: 0.245 },
]

/**
 * ═══ LES LIENS — l'adjacence se DÉCLARE, elle ne se déduit pas ═══
 *
 * Seize liens, écrits. Deux régions liées PARTAGENT une arête (leurs rectangles se touchent, et
 * mordent souvent l'un sur l'autre) ; le seuil est une RAMPE percée dans cette arête. Deux régions
 * non liées ne se touchent pas : entre elles, la crevasse.
 *
 * POURQUOI ON LES ÉCRIT AU LIEU DE LES MESURER. La première version déduisait l'adjacence de la
 * géométrie — voisines si la crevasse faisait moins de 80 tuiles. C'est juste, et c'est fragile : le
 * jitter de la seed déplace les bords, une crevasse de 59 tuiles s'ouvre à 97, et **la frontière
 * disparaît**. Mesuré : six régions sur treize injoignables sur la seed 1. On ne pouvait ni
 * resserrer le jitter (il devenait inutile) ni élargir le seuil (des frontières apparaissaient là où
 * le croquis veut du vide). Les deux réglages étaient pris en tenaille.
 *
 * **Sur une carte DESSINÉE, la topologie est un fait, pas une mesure.** On l'écrit ; la géométrie
 * n'a plus qu'à dire OÙ passe la rampe — jamais SI la frontière existe.
 */
const LIENS: readonly (readonly [string, string])[] = [
  ['cendre', 'racine'], // l'impasse du sud : le feu, et il n'a qu'une porte sur le jardin

  // Le jardin ouvre sur trois T1 — la première décision du joueur est un CHOIX (R14).
  ['racine', 'ceinture-ouest'],
  ['racine', 'ceinture-centre'],
  ['racine', 'ceinture-est'],

  // On remonte. `milieu-ouest` MORD sur deux T1 de la ceinture : c'est le débord qui fait la
  // terrasse. Les trois T1 de la ceinture, elles, ne se touchent PAS entre elles — pour passer de
  // l'une à l'autre, il faut redescendre au jardin ou monter par le milieu. La carte a des BOUCLES.
  ['ceinture-ouest', 'milieu-ouest'],
  ['ceinture-centre', 'milieu-ouest'],
  ['ceinture-est', 'milieu-est'],

  // LES DEUX APPROCHES DU NÉVÉ — l'invariant qui empêche un village de verrouiller l'endgame :
  // retirer l'une laisse l'autre.
  ['milieu-ouest', 'approche-ouest'],
  ['milieu-est', 'approche-est'],
  ['approche-ouest', 'neve'],
  ['approche-est', 'neve'],

  // LE NORD — on n'y entre QUE par la neige.
  ['neve', 'nord-ouest'],
  ['neve', 'nord-centre'],
  ['neve', 'nord-est'],
  ['nord-ouest', 'nord-centre'],
  ['nord-centre', 'nord-est'],
]

/**
 * ═══ LE VIDE — une MASSE DE ROCHE PLATE, infranchissable (façon montagne RimWorld) ═══
 *
 * La carte n'est pas un pavage : là où aucune région ne s'étend, il y a du VIDE. Autrefois c'était
 * un gouffre — un palier très bas peint en noir. Sur la carte plate, c'est simplement de la ROCHE :
 * un mur qu'on longe, pas un abîme dans lequel on tombe. Il donne la masse, il ferme la vallée entre
 * les pays éloignés ; il ne fait pas les frontières entre zones voisines.
 *
 * ET IL N'EST PAS ENTRE LES ZONES VOISINES. C'est la faute qu'il a fallu montrer pour la voir : la
 * première écriture séparait TOUTES les régions par une crevasse, et les seuils devenaient de longs
 * couloirs étroits jetés au-dessus — *« là on a des petits couloirs pas ouf »* (Alexis). Le croquis
 * dit le contraire : **les zones voisines SE TOUCHENT**, elles se chevauchent même partiellement
 * (« certaines zones mordaient sur d'autres »). C'est ce partage d'arête qui les met bord à bord —
 * et `murerLesAretes` y pose une simple ligne de roche, jamais une crevasse.
 *
 * Le vide n'est donc que là où il n'y a **aucune** région : les marges, et les trous entre les
 * colonnes qui ne se touchent pas.
 */

export interface Echantillon {
  /** L'id de la RÉGION propriétaire — ou la plus proche, si le point est dans le vide. */
  zone: number
  /** L'id de la région d'en face — celle qui se dispute la crevasse la plus proche. */
  voisin: number
  /** Distance au bord de sa région, en tuiles. Croît vers le cœur. */
  marge: number
  /** Distance à la TROISIÈME région — ce qui interdit de percer une porte dans un coin. */
  purete: number
  /** LE POINT EST-IL DANS LA CREVASSE ? C'est la question que le pavage ne posait pas. */
  vide: boolean
}

/**
 * L'ÉCHANTILLON — treize rectangles, treize tests d'appartenance, et une réponse EXACTE.
 *
 * Pas de bruit, pas de warp, pas de dichotomie. Ce que le diagramme de puissance approchait par une
 * arithmétique de gradients, la géométrie le donne ici de plain-pied — coins compris, qui sont des
 * coins de rectangles et non plus des lieux flous où trois cellules s'égalisent.
 */
export function echantillonAt(g: GrapheZones, x: number, y: number): Echantillon {
  const n = g.zones.length
  // LA PLUS HAUTE PRIORITÉ GAGNE. Les rectangles se recouvrent (voir `Case.p`) : c'est ce
  // chevauchement qui fabrique les terrasses, et c'est ici qu'il se tranche.
  let zone = -1
  let best = -1
  for (let i = 0; i < n; i++) {
    const r = g.zones[i]!.rect!
    if (x < r.x || x >= r.x + r.w || y < r.y || y >= r.y + r.h) continue
    const p = SQUELETTE[i]!.p
    if (p > best) { best = p; zone = i }
  }

  // LA CREVASSE. On rend tout de même la région la plus proche : la cendre en fait une distance, le
  // client en tire une teinte d'air, et un échantillon doit toujours répondre.
  if (zone < 0) {
    let best = 0
    let bestD = Infinity
    let second = 0
    let secondD = Infinity
    for (let i = 0; i < n; i++) {
      const d = distAuRect(x, y, g.zones[i]!.rect!)
      if (d < bestD) { secondD = bestD; second = best; bestD = d; best = i }
      else if (d < secondD) { secondD = d; second = i }
    }
    return { zone: best, voisin: second, marge: -bestD, purete: secondD, vide: true }
  }

  const r = g.zones[zone]!.rect!
  // La distance à chacun des quatre bords, et la région d'en face au droit du point.
  const bords: readonly (readonly [number, number, number])[] = [
    [x - r.x, r.x - 1, y],
    [r.x + r.w - 1 - x, r.x + r.w, y],
    [y - r.y, x, r.y - 1],
    [r.y + r.h - 1 - y, x, r.y + r.h],
  ]
  let marge = Infinity
  let voisin = zone
  for (const [d, px, py] of bords) if (d < marge) { marge = d; voisin = regionLaPlusProche(g, px, py, zone) }
  if (!Number.isFinite(marge)) marge = g.width + g.height

  let purete = Infinity
  for (let i = 0; i < n; i++) {
    if (i === zone || i === voisin) continue
    const d = distAuRect(x, y, g.zones[i]!.rect!)
    if (d < purete) purete = d
  }
  if (!Number.isFinite(purete)) purete = g.width + g.height

  return { zone, voisin, marge, purete, vide: false }
}

/** La région la plus proche d'un point, en excluant `sauf`. Le vide n'appartient à personne. */
function regionLaPlusProche(g: GrapheZones, x: number, y: number, sauf: number): number {
  let best = sauf
  let bestD = Infinity
  for (let i = 0; i < g.zones.length; i++) {
    if (i === sauf) continue
    const d = distAuRect(x, y, g.zones[i]!.rect!)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

/** Distance d'un point à un rectangle (0 s'il est dedans). `sqrt` est autorisé (invariant n°2). */
export function distAuRect(x: number, y: number, r: Rect): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w - 1))
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h - 1))
  if (dx === 0) return dy
  if (dy === 0) return dx
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * ═══ LES MURS — où deux régions SE FONT FACE par-dessus la crevasse ═══
 *
 * C'est ce qui remplace le « catalogue des frontières ». Deux régions ne partagent plus une arête :
 * elles se REGARDENT, séparées par un gouffre. S'il est assez étroit (`MUR_MAX`) et qu'elles se font
 * face sur une longueur suffisante (`FACE_MIN`), un isthme peut le franchir — et c'est un seuil.
 */
/**
 * ═══ LE CATALOGUE DES PORTES — on SCANNE la frontière, on ne la calcule pas ═══
 *
 * Depuis que les rectangles se chevauchent (`Case.p`), une région n'est plus un rectangle : c'est un
 * POLYGONE RECTILIGNE, un rectangle échancré par ses voisines. La frontière entre deux régions n'est
 * donc plus une arête qu'on déduit de quatre nombres — elle serpente en marches d'escalier.
 *
 * On la CONSTATE : un balayage de la carte au pas du bloc, et l'on relève tout endroit où une région
 * touche une région LIÉE. C'est bête, c'est robuste, et ça donne la frontière entière — échancrures
 * comprises. C'est exactement la leçon que l'ancien générateur avait payée deux fois : *la frontière
 * réelle EST l'adjacence ; rien d'autre ne fait foi.*
 */
export interface Porte {
  a: number
  b: number
  x: number
  y: number
  /** La direction de `a` vers `b`. */
  ax: number
  ay: number
}

function catalogueDesPortes(g: GrapheZones): Map<string, Porte[]> {
  const B = MONDE.BLOC
  const lies = new Set<string>()
  for (const [ra, rb] of LIENS) {
    const a = SQUELETTE.findIndex((c) => c.role === ra)
    const b = SQUELETTE.findIndex((c) => c.role === rb)
    lies.add(`${Math.min(a, b)}:${Math.max(a, b)}`)
  }

  const cols = Math.ceil(g.width / B)
  const rows = Math.ceil(g.height / B)
  const owner = new Int32Array(cols * rows)
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const e = echantillonAt(g, i * B + B / 2, j * B + B / 2)
      owner[j * cols + i] = e.vide ? -1 : e.zone
    }
  }

  const out = new Map<string, Porte[]>()
  const BORD = 40 // une porte ne se colle jamais au bord de la carte : l'anneau y est bloquant
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const me = owner[j * cols + i]!
      if (me < 0) continue
      for (const [di, dj] of [[1, 0], [0, 1]] as const) {
        const ii = i + di
        const jj = j + dj
        if (ii >= cols || jj >= rows) continue
        const lui = owner[jj * cols + ii]!
        if (lui < 0 || lui === me) continue
        const k = `${Math.min(me, lui)}:${Math.max(me, lui)}`
        if (!lies.has(k)) continue
        const x = i * B + B / 2 + (di * B) / 2
        const y = j * B + B / 2 + (dj * B) / 2
        if (x < BORD || y < BORD || x >= g.width - BORD || y >= g.height - BORD) continue
        const [a, b] = k.split(':').map(Number) as [number, number]
        // La direction va toujours de `a` vers `b` (la paire est canonique).
        const versB = me === a ? 1 : -1
        const p: Porte = { a, b, x, y, ax: di * versB, ay: dj * versB }
        const l = out.get(k)
        if (l) l.push(p)
        else out.set(k, [p])
      }
    }
  }
  return out
}

/**
 * ═══ LA DÉRIVATION — on POSE le squelette, on le jittere, on perce les isthmes ═══
 *
 * Plus de tirage vérifié, plus de poids dégressif, plus de repli : la carte est DESSINÉE, donc elle
 * tient par construction. Toute la machinerie qui existait pour survivre à une géométrie tirée au
 * sort — le diagramme de puissance, le graphe de Gabriel, l'assignation des paliers par profondeur,
 * la réparation des contraintes, les seize essais — **disparaît avec la cause qui la justifiait.**
 *
 * Ce qui SURVIT, et qui a été payé cher : le coloriage des paliers (deux voisines n'ont jamais le
 * même — sans quoi une frontière est une clôture), l'écartement des portes (250 tuiles : aucun
 * village n'en tient deux), et la garde de bi-connexité (aucune zone tenable n'est un goulot).
 */
export function deriveGrapheZones(seed: number, joueurs = MONDE.JOUEURS_CIBLE): GrapheZones {
  const { width, height } = tailleCarte(joueurs)
  const B = MONDE.BLOC
  const q = (t: number): number => Math.round(t / B) * B

  /**
   * ═══ LE JITTER SE FAIT PAR RAIL, PAS PAR RECTANGLE ═══
   *
   * Et c'est la seule façon de le faire. Deux régions voisines PARTAGENT une arête : elles écrivent
   * la même fraction (`y1: 0.535` chez l'une, `y0: 0.535` chez l'autre). Si l'on jitterait chaque
   * rectangle indépendamment, les deux bords se DÉCOLLERAIENT — la terrasse deviendrait un couloir,
   * et toute la topologie du croquis avec elle.
   *
   * On jittere donc la VALEUR, pas le rectangle : la même fraction reçoit toujours le même
   * déplacement, où qu'elle apparaisse. Les arêtes partagées le restent, exactement ; les bords
   * libres bougent. ±0,8 % de la carte, soit une vingtaine de tuiles : assez pour que deux seeds ne
   * se superposent jamais, trop peu pour changer un emboîtement. **Le croquis est un invariant.**
   */
  const rail = (v: number, axe: number): number =>
    v + (hash2(Math.round(v * 1000), axe, (seed ^ 0x51a1) | 0) * 2 - 1) * 0.008

  const rects: Rect[] = SQUELETTE.map((c) => {
    const x0 = q(Math.max(0, rail(c.x0, 0)) * width)
    const y0 = q(Math.max(0, rail(c.y0, 1)) * height)
    const x1 = q(Math.min(1, rail(c.x1, 0)) * width)
    const y1 = q(Math.min(1, rail(c.y1, 1)) * height)
    return { x: x0, y: y0, w: Math.max(4 * B, x1 - x0), h: Math.max(4 * B, y1 - y0) }
  })

  // LES IDENTITÉS : imposées là où le croquis l'exige (la racine, la Cendrière, le Névé), tirées
  // dans le palier partout ailleurs. C'est là, et là seulement, que deux seeds divergent vraiment.
  const libres: Record<Tier, ZoneDef[]> = {
    0: melange(ZONES.filter((z) => z.tier === 0 && !estFixe(z.slug)), seed ^ 0xd10),
    1: melange(ZONES.filter((z) => z.tier === 1 && !estFixe(z.slug)), seed ^ 0xd11),
    2: melange(ZONES.filter((z) => z.tier === 2 && !estFixe(z.slug)), seed ^ 0xd12),
  }
  const zones: Zone[] = SQUELETTE.map((c, id) => {
    const def = c.fixe ? ZONES.find((z) => z.slug === c.fixe)! : libres[c.tier].pop()!
    const r = rects[id]!
    return { id, def, x: r.x + r.w / 2, y: r.y + r.h / 2, poids: 0, rect: r }
  })

  const racine = SQUELETTE.findIndex((c) => c.fixe === RACINE_SLUG)
  const g: GrapheZones = {
    seed, width, height, zones, racine, seuils: [], voisins: [], impasses: [], gardiennes: [],
  }

  // L'ADJACENCE EST DÉCLARÉE (voir `LIENS`) — mais on ne la croit que si la frontière EXISTE
  // vraiment sur la carte. Le chevauchement peut avaler un contact ; on ne perce pas une porte dans
  // un mur imaginaire.
  const catalogue = catalogueDesPortes(g)
  g.voisins = zones.map(() => [] as number[])
  for (const [k, pts] of catalogue) {
    if (pts.length < 3) continue // trois blocs de contact : en deçà, c'est un coin, pas une frontière
    const [a, b] = k.split(':').map(Number) as [number, number]
    g.voisins[a]!.push(b)
    g.voisins[b]!.push(a)
  }
  for (const l of g.voisins) l.sort((p, q2) => p - q2)

  // LES IMPASSES — les vrais culs-de-sac : une seule voisine, rien derrière. Le croquis en donne
  // exactement une, et c'est la Cendrière (gardée par le jardin). On les CONSTATE, on ne les choisit
  // plus : la géométrie est écrite, elle sait déjà où sont ses fonds de vallée.
  for (let i = 0; i < zones.length; i++) {
    if (zones[i]!.def.traverse) continue
    if (g.voisins[i]!.length === 1) { g.impasses.push(i); g.gardiennes.push(g.voisins[i]![0]!) }
  }

  g.seuils = percerLesIsthmes(g, catalogue)
  marquerLesSecours(g, g.seuils)
  return g
}

function estFixe(slug: string): boolean {
  return SQUELETTE.some((c) => c.fixe === slug)
}

/**
 * ═══ LES ISTHMES — un par mur, DEUX quand la région n'a qu'un mur ═══
 *
 * R11 : au moins deux seuils par zone, écartés d'au moins 250 tuiles — *sept écrans : aucun village
 * ne peut tenir les deux.* Une région à plusieurs murs l'obtient d'elle-même (une porte par mur, et
 * les murs sont sur des faces différentes). Une région à mur UNIQUE (la Cendrière) reçoit ses deux
 * portes sur le même mur, aux deux tiers de sa longueur — le mur du jardin fait mille tuiles, il y
 * a la place.
 *
 * LE NÉVÉ EST EXEMPTÉ DE L'ÉCARTEMENT, et c'est la seule exception du modèle : la règle des 250
 * tuiles existe pour qu'aucun village ne tienne deux portes. **On ne bâtit pas dans un Névé.** Une
 * bande de cent cinquante tuiles de haut ne peut pas écarter de 250 une porte nord d'une porte sud ;
 * exiger qu'elle le fasse serait appliquer une règle contre sa propre raison d'être.
 */
function percerLesIsthmes(g: GrapheZones, catalogue: Map<string, Porte[]>): Seuil[] {
  const seul = new Set(g.zones.filter((z) => g.voisins[z.id]!.length === 1).map((z) => z.id))
  const compte = (z: number): boolean => !g.zones[z]!.def.traverse

  // Les candidates de chaque frontière, triées : le balayage est déjà déterministe, on le fige.
  const choix: { pts: Porte[]; k: number }[] = []
  for (const [key, pts] of [...catalogue.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
    if (pts.length < 3) continue
    const [a, b] = key.split(':').map(Number) as [number, number]
    const combien = seul.has(a) || seul.has(b) ? 2 : 1
    for (let n = 0; n < combien; n++) {
      // Une porte au milieu ; deux, aux quarts — le maximum d'écartement qu'un segment offre.
      const f = combien === 1 ? 0.5 : n === 0 ? 0.2 : 0.8
      choix.push({ pts, k: Math.min(pts.length - 1, Math.round(f * (pts.length - 1))) })
    }
  }

  /**
   * ═══ ON ÉCARTE LES PORTES — en les faisant GLISSER le long de leur frontière ═══
   *
   * R11 : deux seuils d'une même zone sont à ≥ 250 tuiles. *Sept écrans : aucun village ne peut
   * tenir les deux.* Poser chaque porte au milieu de sa frontière ne suffit pas — deux frontières
   * qui se rejoignent à un coin donnent deux portes voisines. Mesuré : le Lac Mort de la seed 42
   * avait ses deux portes à 248 tuiles, deux de trop.
   *
   * On les fait donc glisser, chacune à son tour, vers la position qui maximise sa distance aux
   * autres portes de ses DEUX régions. Quatre passes (la troisième ne bouge déjà plus rien).
   *
   * LE NÉVÉ EST EXEMPTÉ, seule exception du modèle : la règle des 250 tuiles existe pour qu'aucun
   * village ne tienne deux portes. **On ne bâtit pas dans un Névé** — il ne nourrit rien (R10.3).
   * Une bande de cent cinquante tuiles de haut ne peut pas écarter de 250 sa porte nord de sa porte
   * sud ; l'exiger serait appliquer la règle contre sa propre raison d'être.
   */
  for (let passe = 0; passe < 4; passe++) {
    for (let i = 0; i < choix.length; i++) {
      const c = choix[i]!
      const moi = c.pts[c.k]!
      const gene = choix.filter((q, n) => {
        if (n === i) return false
        const o = q.pts[q.k]!
        return (compte(moi.a) && (o.a === moi.a || o.b === moi.a))
          || (compte(moi.b) && (o.a === moi.b || o.b === moi.b))
      })
      if (gene.length === 0) continue
      let best = c.k
      let bestScore = -1
      // On échantillonne neuf positions le long de la frontière, en évitant ses deux bouts (une
      // porte de coin n'est pas une porte : la falaise y est mince, et elle tombe dans une tierce).
      for (let s2 = 0; s2 < 9; s2++) {
        const k = Math.round((0.1 + (s2 / 8) * 0.8) * (c.pts.length - 1))
        const p = c.pts[k]!
        let score = Infinity
        for (const q of gene) {
          const o = q.pts[q.k]!
          score = Math.min(score, distSq(p.x, p.y, o.x, o.y))
        }
        if (score > bestScore) { bestScore = score; best = k }
      }
      c.k = best
    }
  }

  return choix.map((c, id) => {
    const p = c.pts[c.k]!
    return { id, a: p.a, b: p.b, x: p.x, y: p.y, ax: p.ax, ay: p.ay, secours: false }
  })
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
