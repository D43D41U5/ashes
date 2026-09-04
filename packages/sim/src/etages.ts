/**
 * ═══ LES ÉTAGES — le monde en couches superposées (spec `etages.md`) ═══
 *
 * **Un étage est une carte à part entière, superposée à la même grille de coordonnées.**
 * L'étage 0 est le monde d'aujourd'hui : plein, dense, `map.terrain` inchangé, et RIEN ici ne
 * le touche (E-R1). Les autres étages sont CREUX — ils ne couvrent qu'une partie du plan (le
 * chapeau d'une mesa, demain une galerie, un pont) — et vivent dans leur propre structure.
 *
 * ⚠ **LE MODÈLE EN UNE PHRASE, et c'est elle qui rend le reste cohérent** : le chapeau d'une
 * mesa reste `TERRAIN_ROCK` à l'étage 0 — infranchissable, on la CONTOURNE — **et** porte, sur
 * la même empreinte, un sol marchable à l'étage +1. La butte ne s'est pas ouverte ; on lui a
 * ajouté un dessus. C'est très exactement ce que veut dire E-R1 : *la carte générale ignore les
 * étages*, par construction et sans une exception à écrire (`vignette.ts`, le champ de cendre et
 * le bake du sol continuent de ne lire que `map.terrain`).
 *
 * ═══ POURQUOI CE MODÈLE ET PAS UN AUTRE ═══
 *
 * La chaîne d'élimination est FAITE (spec §1, trois arbitrages d'Alexis le 2026-07-27) et ne se
 * refait pas : la carte-instance séparée meurt sur « on voit ce qui est à l'intérieur et
 * réciproquement » (deux espaces de coordonnées coupent toutes les boucles de distance de /sim) ;
 * la cave creusée À CÔTÉ meurt sur « le souterrain n'apparaît pas sur la carte générale ». Ne pas
 * les re-proposer.
 *
 * ═══ CE QUI EST DANGEREUX ICI, ET NULLE PART AILLEURS ═══
 *
 * `/sim` n'a AUJOURD'HUI ni ligne de vue ni occlusion : tout ce qui est « à distance » — le feu,
 * la construction, l'interaction, la poursuite du loup, la découverte — est une distance
 * euclidienne sur `x,y`. **67 sites dans 24 fichiers** (mesuré le 2026-08-31). La règle d'étage
 * s'écrit donc UNE FOIS, ici, dans `atteignableEntreEtages` (E-R5), et les sites l'APPELLENT.
 * Une seconde écriture de la même règle, c'est le loup qui mord à travers la roche parce qu'un
 * escalier est à côté.
 *
 * ═══ COÛT ═══
 *
 * Tout ce fichier sort en O(1) sur un monde sans étage (`map.etages` absent) et sur une paire de
 * points au MÊME étage — ce qui est le cas de 100 % des appels du jeu d'aujourd'hui. Le chemin
 * chaud de la collision ne voit rien : `etagesDuPas` rend `undefined` tant que personne n'est
 * monté, et `MoveWorld.etages` absent reprend le chemin d'avant, au bit près.
 */
import { BALANCE, TERRAIN_BOULDERS, TERRAIN_JUNIPER_HEATH, TERRAIN_SCREE } from './balance'
import { distSq } from './geometry'
import { fbm2, hash2 } from './noise'
import { MARCHABLE, terrainAt, type WorldMap } from './map'

/**
 * UN ÉTAGE — GRILLE CREUSE, JSON-SÉRIALISABLE (E-R2).
 *
 * Deux tableaux plats PARALLÈLES : `idx` (index de tuile `y * width + x`, **trié croissant**) et
 * `terrain` (l'id de terrain de la tuile de même rang). Pas de `Map`, pas de `Set`, pas d'objet
 * par tuile — l'invariant §3 (« l'état de sim voyage en JSON ») vaut ici comme partout, et une
 * grille pleine coûterait une carte entière par étage.
 *
 * La lecture se fait par recherche DICHOTOMIQUE sur `idx`, précédée de la boîte englobante qui
 * écarte en trois comparaisons tout ce qui est loin. (Un index de ligne ferait mieux ; E-R2 dit
 * « à mesurer, pas à supposer » — on mesurera quand un étage sera assez gros pour le mériter.)
 */
export interface EtageCreux {
  /**
   * L'ÉTAGE, ENTIER SIGNÉ (E-R3) : 0 = le sol du monde (jamais stocké ici), +1/+2 les plateaux,
   * −1/−2 les souterrains. **Le signe n'a aucune conséquence mécanique** — il n'existe que pour
   * que « au-dessus » et « en dessous » se disent.
   */
  niveau: number
  /** Index de tuile (`y * width + x`), TRIÉ CROISSANT. La dichotomie en dépend. */
  idx: number[]
  /** Id de terrain, même rang que `idx`. */
  terrain: number[]
  /** Boîte englobante, `x1`/`y1` EXCLUSIFS — le rejet bon marché avant la dichotomie. */
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * UN CONNECTEUR — UNE DONNÉE, JAMAIS UNE DEVINETTE (E-R7).
 *
 * Rampe, gueule de grotte, escalier : une entrée dans la carte. Rien ne se déduit du terrain, et
 * c'est la leçon de `murerLesAretes` prise à l'envers — **la falaise se CONSTATE parce qu'elle est
 * une conséquence, le connecteur se POSE parce qu'il est une intention.**
 *
 * La tuile `(x, y)` appartient aux DEUX étages qu'elle relie : elle est marchable à `de` comme à
 * `vers`. C'est ce qui fait d'une rampe une rampe — un endroit où le sol du dessus descend
 * rejoindre celui du dessous — et c'est ce qui permet au pas de basculer sans qu'aucune tuile de
 * l'étage 0 ne soit repeinte.
 *
 * **E-R8 : le connecteur est le SEUL passage entre deux étages**, exactement comme le seuil est le
 * seul passage entre deux zones. Le test destructif (E-A4) en dépend : on les bouche, l'étage
 * devient une île.
 */
export interface Connecteur {
  x: number
  y: number
  de: number
  vers: number
  type: 'rampe' | 'gueule' | 'escalier'
}

/** L'étage `niveau`, ou `undefined`. `niveau === 0` n'est JAMAIS un étage creux : c'est la carte. */
export function etageDe(map: WorldMap, niveau: number): EtageCreux | undefined {
  // ⚠ Le niveau 0 PEUT être une grille creuse depuis les terrasses (spec `terrasses.md` T-R2) :
  // la cave sous une mesa posée au palier 1 vit au niveau 0, à côté du sol des tuiles de palier 0.
  if (map.etages === undefined) return undefined
  for (const e of map.etages) if (e.niveau === niveau) return e
  return undefined
}

/**
 * ═══ LE PALIER DU SOL — l'étage que la CARTE porte à cette tuile (spec `terrasses.md` T-R1/T-R2) ═══
 *
 * Avant les terrasses, « le sol » était l'étage 0 partout — et tout `?? 0` du dépôt le disait.
 * Depuis, le sol lui-même a des paliers : la tuile `(tx,ty)` porte `map.terrain` **à l'étage
 * `palierDuSol`**, et à lui seul. Absent ≡ 0 partout : une carte d'avant, ou le monde complet,
 * se relisent sans un bit de différence.
 */
export function palierDuSol(map: WorldMap, tx: number, ty: number): number {
  const p = map.palier
  if (p === undefined) return 0
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return 0
  return p[ty * map.width + tx] ?? 0
}

/**
 * L'ÉTAGE D'UN CORPS — « au sol, là où il est » quand rien n'est écrit (T-R3).
 *
 * ⚠ C'est LA fonction qui remplace les `entity.etage ?? 0` : un corps qui n'a jamais basculé
 * d'étage n'a pas de champ, et le sol sous lui n'est plus forcément 0. Coordonnées MONDE (en
 * tuiles, fractionnaires) — celles de `Entity.x/y` et `Corpse.x/y`.
 */
export function niveauDuCorps(map: WorldMap, corps: { x: number; y: number; etage?: number }): number {
  return corps.etage ?? palierDuSol(map, Math.floor(corps.x), Math.floor(corps.y))
}

/** Le même, pour ce qui se tient sur une TUILE (`tx`,`ty`) : un nœud, une structure, un lieu. */
export function niveauDeLaTuile(map: WorldMap, chose: { tx: number; ty: number; etage?: number }): number {
  return chose.etage ?? palierDuSol(map, chose.tx, chose.ty)
}

/**
 * ÉCRIRE L'ÉTAGE D'UN CORPS — et ne l'écrire QUE s'il n'est pas « au sol, là où il est » (T-R3).
 *
 * Le champ reste ABSENT quand le corps se tient sur le sol de sa tuile : une sauvegarde d'avant
 * ne gagne pas un octet, et un corps posé ailleurs (respawn, téléportation) repart du bon niveau
 * sans qu'on ait rien à corriger. Il n'est écrit que hors du sol — sur un chapeau, une rampe,
 * dans une cave — là où le sol ne le dirait pas.
 */
export function poserLEtageDuCorps(map: WorldMap, corps: { x: number; y: number; etage?: number }, niveau: number): void {
  if (niveau === palierDuSol(map, Math.floor(corps.x), Math.floor(corps.y))) delete corps.etage
  else corps.etage = niveau
}

/**
 * Le rang de la tuile `i` dans `idx`, ou −1. Dichotomie pure — `+ - * /` et `Math.floor` seuls,
 * donc exacte au bit près d'un moteur à l'autre (invariant §2).
 */
function rangDe(etage: EtageCreux, i: number): number {
  const idx = etage.idx
  let lo = 0
  let hi = idx.length - 1
  while (lo <= hi) {
    const mid = lo + Math.floor((hi - lo) / 2)
    const v = idx[mid]!
    if (v === i) return mid
    if (v < i) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}

/**
 * L'ID DE TERRAIN À UNE TUILE, À UN ÉTAGE DONNÉ.
 *
 * `niveau === 0` rend exactement `terrainAt` — la carte, inchangée. Ailleurs : le terrain de
 * l'étage creux, ou **0 (`void`)** là où l'étage ne couvre pas le plan. Le vide n'est pas
 * marchable (`MARCHABLE[0] !== 1`) : hors de son empreinte, un étage est un trou, et c'est la
 * bonne réponse — au-dessus d'une plaine, il n'y a rien sur quoi marcher.
 */
export function terrainAEtage(map: WorldMap, niveau: number, tx: number, ty: number): number {
  // Le sol répond à SON palier (T-R2) — 0 sur une carte sans terrasses, exactement comme avant.
  if (niveau === palierDuSol(map, tx, ty)) return terrainAt(map, tx, ty)
  const e = etageDe(map, niveau)
  if (e === undefined) return 0
  if (tx < e.x0 || ty < e.y0 || tx >= e.x1 || ty >= e.y1) return 0
  const r = rangDe(e, ty * map.width + tx)
  return r < 0 ? 0 : e.terrain[r]!
}

/**
 * CETTE TUILE PORTE-T-ELLE UN SOL, À CET ÉTAGE ?
 *
 * ⚠ **LE TERRAIN SEUL** — ni structures, ni nœuds, ni gel, ni crue. Ce n'est pas la collision :
 * c'est la question de la CARTE (le pendant de `MARCHABLE[terrainAt(…)]`), et c'est tout ce dont
 * la règle d'étage a besoin. La collision complète reste dans `collision.ts`, qui l'appelle.
 */
export function marchableAEtage(map: WorldMap, niveau: number, tx: number, ty: number): boolean {
  return MARCHABLE[terrainAEtage(map, niveau, tx, ty)] === 1
}

/** Le connecteur posé sur cette tuile, ou `undefined`. */
export function connecteurAt(map: WorldMap, tx: number, ty: number): Connecteur | undefined {
  const cs = map.connecteurs
  if (cs === undefined) return undefined
  return indexDesConnecteurs(cs).parTuile.get(ty * CLE_LIGNE + tx)
}

/**
 * ═══ LA JOUE : UN PAS DE CÔTÉ NE FRANCHIT PAS LE BORD D'UNE ENTAILLE ═══
 *
 * La collision le sait depuis le 2026-09-01 (`brideDeLaJoue`, `collision.ts`) : on entre dans une
 * rampe et on en sort par le nord ou le sud, jamais par le flanc — le dessin y peint de la roche.
 * Mais la RECHERCHE DE CHEMIN ne le savait pas : l'A* (quatre voisins orthogonaux) routait par le
 * flanc, le corps venait se coller à la joue, et le compteur `stuck` recalculait… le même chemin.
 * MESURÉ (banc A8, graine 2026, jour 2) : les deux PNJ du Clan du Levant morts de faim étaient à
 * x = 35,375 et x = 34,625 — le bord est de la rampe (32-34, 200), à un demi-corps près — depuis
 * plus de 800 ticks, chemin en poche, sans avancer d'un pouce. Rare avec 180 rampes de mesa,
 * courant avec 900 rampes de terrasse.
 *
 * Le prédicat est la LETTRE de `brideDeLaJoue` sur une grille : un pas latéral (`dx ≠ 0`) passe
 * la joue quand exactement l'une des deux tuiles est un connecteur. D'une tuile de rampe à sa
 * voisine de rampe (la porte fait `CREUX.RAMPE_LARGEUR` tuiles), on passe. Une carte sans
 * connecteur sort immédiatement : le chemin d'avant, au bit près.
 */
export function franchitUneJoue(map: WorldMap, tx: number, ty: number, dx: number): boolean {
  if (dx === 0 || map.connecteurs === undefined) return false
  return (connecteurAt(map, tx, ty) !== undefined) !== (connecteurAt(map, tx + dx, ty) !== undefined)
}

/**
 * ═══ L'INDEX DES CONNECTEURS — mémoïsé par RÉFÉRENCE du tableau, comme l'index des nœuds ═══
 *
 * Avant les terrasses, ~180 connecteurs (les rampes des mesas) et deux balayages linéaires — l'un
 * par sous-tuile de chaque pas (`etagesDuPas`), l'autre par paire d'étages différents (E-R5).
 * Les terrasses en ajoutent des centaines (T-A8 : « le tick ne se dégrade pas »), donc on indexe :
 * par TUILE pour `connecteurAt`, par PAIRE d'étages (non orientée) pour `atteignableEntreEtages`.
 * Une lecture dérivée, jamais un état : le tableau ne bouge pas après l'amorce, et un tableau neuf
 * (une carte neuve) naît avec son index. ⚠ Le `Map` vit HORS du `SimState` — l'invariant « pas de
 * Map dans l'état » n'est pas touché.
 */
const CLE_LIGNE = 1 << 16
/** Une case de l'index spatial par paire : `CASES_PAR_AXE` cases par axe, largement plus que la carte / `N`. */
const CASES_PAR_AXE = 4096
type IndexConnecteurs = { parTuile: Map<number, Connecteur>; parPaireEtCase: Map<number, Connecteur[]>; pas: number }
const indexConnecteurs = new WeakMap<Connecteur[], IndexConnecteurs>()
function clePaire(a: number, b: number): number {
  const lo = a < b ? a : b
  const hi = a < b ? b : a
  return (lo + 64) * 256 + (hi + 64)
}
/** La clé (paire, case) — entière et exacte : 2^16 paires × 2^12 × 2^12 cases < 2^53. */
function cleCase(paire: number, cx: number, cy: number): number {
  return (paire * CASES_PAR_AXE + cx) * CASES_PAR_AXE + cy
}
function indexDesConnecteurs(cs: Connecteur[]): IndexConnecteurs {
  const pas = BALANCE.ETAGE_PORTEE_CONNECTEUR
  let idx = indexConnecteurs.get(cs)
  if (idx === undefined || idx.pas !== pas) {
    const parTuile = new Map<number, Connecteur>()
    // PAR PAIRE **ET PAR CASE** de `N` tuiles de côté (T-A8, MESURÉ le 2026-09-03, graine 2026 :
    // ~1 000 rampes de terrasse, presque toutes sur la paire (0,1) — la liste par paire seule se
    // rebalayait en entier à CHAQUE « un plancher les sépare-t-il ? », +0,9 ms/tick sur 2,4).
    // Un point n'est à moins de `N` que d'un connecteur des 3 × 3 cases autour de la sienne.
    const parPaireEtCase = new Map<number, Connecteur[]>()
    for (const c of cs) {
      const k = c.y * CLE_LIGNE + c.x
      if (!parTuile.has(k)) parTuile.set(k, c) // le premier posé gagne, comme le balayage d'avant
      const kc = cleCase(clePaire(c.de, c.vers), Math.floor((c.x + 0.5) / pas), Math.floor((c.y + 0.5) / pas))
      const l = parPaireEtCase.get(kc)
      if (l === undefined) parPaireEtCase.set(kc, [c])
      else l.push(c)
    }
    idx = { parTuile, parPaireEtCase, pas }
    indexConnecteurs.set(cs, idx)
  }
  return idx
}
/** Un connecteur de la paire à moins de `N` du point ? — les 3 × 3 cases autour de la sienne. */
function unConnecteurPres(idx: IndexConnecteurs, paire: number, x: number, y: number): boolean {
  const N = idx.pas
  const N2 = N * N
  const cx = Math.floor(x / N)
  const cy = Math.floor(y / N)
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iy = cy - 1; iy <= cy + 1; iy++) {
      const l = idx.parPaireEtCase.get(cleCase(paire, ix, iy))
      if (l === undefined) continue
      for (const c of l) if (distSq(x, y, c.x + 0.5, c.y + 0.5) <= N2) return true
    }
  }
  return false
}

/**
 * ═══ CETTE TUILE EST-ELLE UNE RAMPE QUI MONTE VRAIMENT ? — et les DEUX planchers qu'elle joint ═══
 *
 * Un connecteur ne suffit pas : la rampe fait `CREUX.RAMPE_LARGEUR` tuiles mais seule celle du
 * MILIEU est élue au contact du chapeau (`zonegen.ts` : *« les flancs n'ont pas à toucher le
 * chapeau »*). Sur la mesa (289..291, 106) de la graine 2026, la colonne 289 a du pierrier au
 * nord : on y marche tout droit sans jamais monter. Une colonne de flanc n'est donc pas une
 * pente — ni pour le RENDU (qui y ferait monter puis retomber le corps d'un coup), ni pour le
 * PAS (qui y ferait peiner un marcheur qui ne gravit rien).
 *
 * ⚠ **ELLE VIT ICI PARCE QUE DEUX MONDES LA LISENT** : la vitesse du pas (`moveAvatar`) et la
 * hauteur du dessin (`EtageLayer`). Deux écritures d'une même géométrie divergent toujours — et
 * celle-là se paierait en corps qui glisse à côté de la pente qu'il gravit.
 *
 * Le voisin NORD, et lui seul : « le nord est le haut » (2026-08-31), une rampe s'élit au sud du
 * chapeau et ne monte que vers lui.
 */
export function rampeQuiMonte(
  map: WorldMap,
  tx: number,
  ty: number,
): { bas: number; haut: number } | undefined {
  const c = connecteurAt(map, tx, ty)
  if (c === undefined) return undefined
  const bas = c.de < c.vers ? c.de : c.vers
  const haut = c.de < c.vers ? c.vers : c.de
  // Le nord doit porter le plancher du HAUT — et ne pas être une rampe lui-même (sans quoi une
  // rampe à deux rangées se croirait montante sur les deux, et le corps monterait deux fois).
  if (!marchableAEtage(map, haut, tx, ty - 1)) return undefined
  if (connecteurAt(map, tx, ty - 1) !== undefined) return undefined
  return { bas, haut }
}

/**
 * ═══ E-R5 — LA RÈGLE, ÉCRITE UNE FOIS ═══
 *
 * *Deux points s'atteignent s'ils sont **au même étage**, **ou** si l'un est à moins de
 * `ETAGE_PORTEE_CONNECTEUR` tuiles d'un **connecteur qui les relie**.*
 *
 * Elle ne répond QUE de l'étage. Elle ne remplace aucune portée : l'appelant garde la sienne
 * (l'aggro du loup, le carré du Feu, le rayon de découverte…) et compose. Le rôle de cette
 * fonction est de répondre « un plancher les sépare-t-il ? », rien d'autre — et c'est pourquoi
 * « l'UN des deux » suffit : la distance entre A et B, c'est l'affaire de l'appelant.
 *
 * **La première clause est la sortie précoce, et ce n'est pas une optimisation : c'est la
 * règle.** Tous les appels du jeu d'aujourd'hui la prennent (personne n'a d'étage), donc E-A8
 * — « le tick ne se dégrade pas » — est vrai par construction et non par réglage.
 */
export function atteignableEntreEtages(
  map: WorldMap,
  ax: number,
  ay: number,
  ae: number,
  bx: number,
  by: number,
  be: number,
): boolean {
  if (ae === be) return true
  const cs = map.connecteurs
  if (cs === undefined) return false
  // « QUI LES RELIE » — le connecteur ne connaît pas de sens : `de`/`vers` est une paire, et
  // l'index les range par paire non orientée, et par case (T-A8 : un millier de rampes depuis les
  // terrasses — on ne regarde que celles d'à côté).
  const idx = indexDesConnecteurs(cs)
  const paire = clePaire(ae, be)
  return unConnecteurPres(idx, paire, ax, ay) || unConnecteurPres(idx, paire, bx, by)
}

/**
 * ═══ LE CAS LE PLUS FRÉQUENT, NOMMÉ UNE FOIS : UN CORPS ET QUELQUE CHOSE POSÉ AU SOL ═══
 *
 * Le bâti, les piles au sol, les feux, les stations : **tout cela vit à l'étage 0** (`collision.ts`
 * le déclare — *« le bâti vit au sol »*), et une vingtaine de sites posent la même question dans
 * les mêmes termes. Ce n'est PAS une seconde écriture de E-R5 : c'est `atteignableEntreEtages`
 * appelée avec ses deux derniers arguments déjà remplis, sous un nom qui dit ce qu'on demande.
 * Le jour où l'on bâtira à un étage, c'est `Structure` qui gagnera son champ, et cette fonction
 * prendra un argument de plus — en un seul endroit.
 *
 * ⚠ Les coordonnées sont celles d'une TUILE (on vise son centre), parce que c'est ce que les
 * appelants ont en main : `s.tx`, `s.ty`.
 */
export function atteintLeSol(
  map: WorldMap,
  acteur: { x: number; y: number; etage?: number },
  tx: number,
  ty: number,
): boolean {
  // « Le sol » de cette tuile est son PALIER (T-R2), et l'acteur sans étage est au sol sous lui (T-R3).
  return atteignableEntreEtages(map, acteur.x, acteur.y, niveauDuCorps(map, acteur), tx + 0.5, ty + 0.5, palierDuSol(map, tx, ty))
}

/**
 * LES ÉTAGES QU'UN PAS PEUT OCCUPER, DEPUIS LA TUILE OÙ LE MARCHEUR SE TIENT.
 *
 * Rend `undefined` — donc « le monde d'avant, au bit près » — sauf quand il y a vraiment quelque
 * chose à décider : un marcheur en l'air, ou un marcheur posé sur un connecteur. C'est cette
 * sortie précoce qui garde le chemin chaud de la collision (`blockedSubAt`, balayé une fois par
 * SOUS-TUILE) exactement tel qu'il est aujourd'hui.
 *
 * Sur un connecteur, le pas a le droit d'atterrir des DEUX côtés : c'est la seule façon de monter
 * sur un chapeau de mesa dont la tuile est de la roche à l'étage 0. L'étage retenu à l'arrivée est
 * l'affaire d'`etageApresLePas`.
 */
export function etagesDuPas(map: WorldMap, niveau: number, tx: number, ty: number): readonly number[] | undefined {
  if (map.etages === undefined && map.palier === undefined) return undefined
  const c = connecteurAt(map, tx, ty)
  if (c !== undefined && (c.de === niveau || c.vers === niveau)) {
    return c.de === niveau ? [c.de, c.vers] : [c.vers, c.de]
  }
  // Le raccourci « rien à décider » ne vaut que là où le sol est l'étage 0 PARTOUT : dès que la
  // carte a des paliers, un pas au niveau 0 doit être vérifié contre le palier de la tuile (T-R2).
  return niveau === 0 && map.palier === undefined ? undefined : [niveau]
}

/**
 * L'ÉTAGE APRÈS LE PAS — on adopte celui de la tuile où l'on ATTERRIT.
 *
 * La règle tient en une phrase : *on garde son étage tant qu'il porte encore ; sinon on prend
 * celui, parmi ceux que le pas autorisait, qui porte.* Sur la rampe elle-même (marchable des deux
 * côtés) on ne bascule donc pas — on bascule en la QUITTANT, vers le seul étage où la tuile
 * d'arrivée existe. C'est ce qui fait qu'une rampe se monte et se descend sans un bouton.
 *
 * Aucun tirage, aucune horloge : la fonction est une lecture. `etages` est ordonné (l'étage
 * courant d'abord, cf. `etagesDuPas`), donc le résultat est déterministe.
 */
export function etageApresLePas(
  map: WorldMap,
  etages: readonly number[] | undefined,
  actuel: number,
  tx: number,
  ty: number,
): number {
  if (etages === undefined) return actuel
  if (marchableAEtage(map, actuel, tx, ty)) return actuel
  for (const e of etages) if (marchableAEtage(map, e, tx, ty)) return e
  // ⚠ **ON RETOMBE AU SOL, ON NE RESTE JAMAIS EN L'AIR.** Ce repli ne se déclenche sur AUCUN pas
  // réel — la collision aurait refusé d'y aller — mais sur un corps REPOSÉ hors du pas : le
  // respawn au Feu, la téléportation de debug, la berge de la glace rompue. Sans lui, un joueur
  // mort sur un plateau ressuscitait au village **encore marqué étage +1**, dans un monde où
  // rien n'est marchable à cet étage-là : toutes ses tuiles bloquées, gelé sur place, sans un
  // mot. (Et les loups l'ignoraient, puisqu'un plancher les en séparait.) Le sol, lui, existe
  // toujours — on ne peut pas n'être nulle part. Et « le sol », c'est le PALIER de la tuile (T-R6).
  return palierDuSol(map, tx, ty)
}

/**
 * ═══ BÂTIR UN ÉTAGE — ET IL PORTE UN VRAI TERRAIN, PAS UN APLAT ═══
 *
 * ⚠ **UN ÉTAGE EST UNE CARTE À PART ENTIÈRE (E-R2), au pied de la lettre.** La première écriture
 * remplissait le plateau d'un `TERRAIN_SCREE` uniforme : joli de loin, faux de près — *« on
 * construit une map en terrasse »* (Alexis, 2026-09-01). Une carte a un terrain VARIÉ, dont tout
 * le reste dérive : ce qui pousse, ce qu'on y récolte, ce que le décor y sème, ce que la palette
 * de saison y reteinte. Un aplat n'a rien à donner à personne.
 *
 * Le terrain d'un dessus de butte se DÉRIVE, il ne s'invente pas — c'est un lieu **haut, sec et
 * minéral** : de l'éboulis en fond, des blocs là où la roche perce, du genévrier dans les creux
 * où un peu de terre tient. Trois terrains que la vallée connaît déjà, donc trois entrées que le
 * décor, la table de récolte et la teinte de saison savent déjà lire.
 *
 * ⚠ **CHEMIN SALÉ, AUCUN TIRAGE** (E-R15) : la composition sort d'un bruit POSITIONNEL
 * (`fbm2`/`hash2` sur `SEL_ETAGE`), pas du PRNG. Le flux de la partie n'est pas touché d'un bit,
 * donc aucun test sans rapport ne peut tourner — le piège documenté du dépôt.
 */
const SEL_ETAGE = 0x45544147 // 'ETAG'
/**
 * L'échelle des taches, en tuiles. ⚠ **8 ET NON 5, et c'est une leçon de RENDU** : le sol du
 * plateau n'a pas la fonte au pixel que la couche des pavés donne au sol (`cuireChunk` répartit
 * les pixels d'une frontière entre les deux terrains, par priorité) — chaque tuile d'étage porte
 * un aplat. Des taches de 5 tuiles rendaient donc un DAMIER de carrés colorés, aux bords francs.
 * Plus larges, les frontières se raréfient et la matière prime sur la découpe. En dessous de 4
 * c'est de la confetti ; au-delà de ~10 un chapeau entier n'a plus qu'une seule tache.
 */
const ECHELLE_TACHE = 8
/**
 * Les SEUILS du champ, et non des « parts » — c'est la leçon des quantiles du worldgen. Écrites
 * en parts (0,30 / 0,22), elles rendaient **82 % d'éboulis pour 13 % de blocs** : `fbm2` se
 * masse autour de 0,5 et ne remplit pas [0, 1]. MESURÉ sur le champ réel du monde joué :
 * q20 = 0,351 · q50 = 0,500 · q75 = 0,619. Les seuils sont donc posés SUR CES QUANTILES.
 * Réglage de CARTE (on le juge en REGARDANT un plateau), donc il vit avec son générateur.
 */
const SEUIL_BLOCS = 0.619 // au-dessus du q75 : un quart de blocs
const SEUIL_GENEVRIER = 0.351 // sous le q20 : un cinquième de genévrier

/**
 * LE TERRAIN D'UNE TUILE DE PLATEAU — pur, positionnel, sans état.
 *
 * Exporté parce que la garde le rejoue : c'est la seule façon d'affirmer la COMPOSITION sans
 * refaire le vivier à côté (« une garde qui reconstitue le vivier passe au vert »).
 */
export function terrainDeDessus(tx: number, ty: number): number {
  // Le bruit décide de la STRUCTURE (des plaques, pas du poivre) ; le hash casse ses bords pour
  // qu'une lisière de tache ne soit pas un trait — l'entrelacs des lisières, en plus petit.
  const n = fbm2(tx, ty, ECHELLE_TACHE, SEL_ETAGE)
  const grain = hash2(tx, ty, SEL_ETAGE ^ 0x5bf03635) * 0.12 - 0.06
  const v = n + grain
  if (v > SEUIL_BLOCS) return TERRAIN_BOULDERS
  if (v < SEUIL_GENEVRIER) return TERRAIN_JUNIPER_HEATH
  return TERRAIN_SCREE
}

/**
 * ═══ LE SOL D'UNE CAVE — de la roche nue, et rien qui pousse ═══
 *
 * Le pendant de `terrainDeDessus`, un étage plus bas, et il dit l'inverse : un dessus de butte est
 * **haut, sec et minéral** mais reçoit le ciel — il porte du genévrier dans ses creux. Un dessous
 * n'en reçoit aucun. **Rien n'y pousse**, donc pas une seule entrée végétale : de l'éboulis pour le
 * sol foulé, des blocs là où la voûte s'est effondrée. Deux terrains que la vallée connaît déjà,
 * donc que le décor, la table de récolte et la teinte de saison savent déjà lire.
 *
 * ⚠ **CHEMIN SALÉ PROPRE** (`'CAVS'`), aucun tirage : le flux du PRNG de la partie n'est pas
 * touché d'un bit. Et un sel DISTINCT de celui du dessus — sans quoi une cave serait le calque
 * exact du plateau qui la coiffe, tache pour tache.
 */
const SEL_CAVE_SOL = 0x43415653 // 'CAVS'
/** Un quart de blocs, comme en haut : c'est la même roche, éboulée de la même façon. */
const SEUIL_BLOCS_CAVE = 0.619
export function terrainDeCave(tx: number, ty: number): number {
  const n = fbm2(tx, ty, ECHELLE_TACHE, SEL_CAVE_SOL)
  const grain = hash2(tx, ty, SEL_CAVE_SOL ^ 0x5bf03635) * 0.12 - 0.06
  return n + grain > SEUIL_BLOCS_CAVE ? TERRAIN_BOULDERS : TERRAIN_SCREE
}

/**
 * BÂTIR UN ÉTAGE depuis une liste de tuiles — le seul constructeur, et il TRIE.
 *
 * ⚠ `idx` doit être trié croissant (la dichotomie en dépend) et le tri par défaut de JavaScript
 * est LEXICOGRAPHIQUE : `[10, 9]` reste `[10, 9]`. Le comparateur est explicite, ici et une seule
 * fois — c'est précisément le genre de faute qui rendrait `terrainAEtage` faux une tuile sur
 * mille, en silence.
 */
export function construireEtage(
  niveau: number,
  tuiles: readonly number[],
  width: number,
  /** Le terrain d'une tuile, par ses coordonnées. Défaut : la composition d'un dessus de butte. */
  terrainDe: (tx: number, ty: number) => number = terrainDeDessus,
): EtageCreux {
  const idx = tuiles.slice().sort((a, b) => a - b)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const i of idx) {
    const ix = i % width
    const iy = (i - ix) / width
    if (ix < x0) x0 = ix
    if (iy < y0) y0 = iy
    if (ix + 1 > x1) x1 = ix + 1
    if (iy + 1 > y1) y1 = iy + 1
  }
  return {
    niveau,
    idx,
    terrain: idx.map((i) => terrainDe(i % width, (i - (i % width)) / width)),
    x0: idx.length > 0 ? x0 : 0,
    y0: idx.length > 0 ? y0 : 0,
    x1: idx.length > 0 ? x1 : 0,
    y1: idx.length > 0 ? y1 : 0,
  }
}
