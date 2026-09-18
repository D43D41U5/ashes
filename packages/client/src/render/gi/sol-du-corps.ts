/**
 * ═══ OÙ UN PIXEL DE CORPS LIT LE CHAMP (spec `lumiere-globale.md` LG-R7, LG-R16) ═══
 *
 * LG-R7 fait lire à chaque pixel d'un corps « la lumière du sol, lue SOUS lui ». Reste à dire
 * OÙ est ce « sous ». Pour presque tout corps c'est sa ligne — le `y` par lequel il est trié.
 * Pour un mur, non : un mur se DRESSE, et son dessus regarde un sol qui n'est pas le sien.
 *
 * ═══ TROIS POINTS DE LECTURE, PAS UN ═══
 * C'est la forme que la composition ratifiée emploie (`planche9.mjs:151` et `:163`), et elle ne se
 * déduit pas de `pointAuSol` seul :
 *   · la part PLATE et la part de l'ASTRE se lisent SOUS LE PIXEL (`pointAuSol`) — c'est là que les
 *     marches entre deux pans d'un mur s'effacent ;
 *   · la part DIRECTE DU FEU d'une face dressée se lit AU PIED, fois son exposition à la flamme
 *     (`lectureDuFeu`, branche `auPied`) — sans quoi un tronc lit le sol DERRIÈRE lui (feu au sud :
 *     sa propre ombre ; feu au nord : un sol éclairé alors qu'il lui tourne le dos) ;
 *   · sur un DESSUS elle est NULLE (LG-R16).
 * Le rebond, lui, n'est pas concerné : il vit dans la part plate et reste lu sous le pixel.
 *
 * ═══ LE PIED D'UN MUR N'EST PAS TOUJOURS SA LIGNE ═══
 * LG-A9 dit « le pied d'un mur est sa ligne ». C'est vrai au SUD et faux au NORD, et l'écart
 * vaut une tuile entière. Un sprite de barrière est ancré au BAS DE SA TUILE quelle que soit
 * son arête (`originY = (ht+T+M)/(ht+T+2M)`, `bati-art.ts:119`, et `EDGE_ORIGIN_Y` indexe la
 * FAMILLE, jamais le bit) — mais sa bande, elle, est posée sur l'arête qu'elle occupe. Une
 * bande nord se tient donc sur le bord HAUT de sa tuile, `TILE_PX` au-dessus de sa ligne.
 *
 * QUATRE SYSTÈMES LIVRÉS LE DISENT DÉJÀ, et aucun n'est ce module :
 *   1. `bati-art.ts` `bande()` — N : `y = t.y − M` (bord haut) ; S : `y = t.y + T − M` (bord bas).
 *   2. `framing.ts:508` `barriereDepth` — `feetY = (edges & (S|E|O)) ? ty+1 : ty+DEMI_BANDE_TUILES`,
 *      « UNE BARRIÈRE TRIE SUR SA BANDE, pas sur sa tuile ». Le tri Y connaît le décalage nord.
 *   3. `sim/lumiere.ts:200` — `if (e & EDGE_N) bandes.push({… y0: Y−0,5, y1: Y+0,5 })` : la sim
 *      place l'occludeur nord sur la ligne haute. C'est L'AUTORITÉ — la GI du client doit lire
 *      la géométrie dont la sim calcule l'ombre, sinon les deux moitiés d'une même loi parlent
 *      de deux murs différents.
 *   4. **LE HARNAIS DES PLANCHES LUI-MÊME** (`planche14.mjs:416`), qui remappe tout sprite `-e1_`
 *      en `{…s, y: s.y − 16, yD: s.y}` AVANT de composer. C'est pour cela que le `pointAuSol` du
 *      harnais n'a pas de terme nord : il n'en a pas besoin, on lui passe une ligne déjà corrigée.
 *      Le look ratifié n'a donc jamais été faux au nord — vérifié au pixel sur la capture de
 *      référence : la coupe dessus/face y est IDENTIQUE au nord et au sud (288 px / 2628 px).
 *
 * Sans ce terme, une bande nord verrait **16 de ses 32 rangs de face** classés en dessus : ils
 * perdraient le direct du feu et liraient le champ une hauteur de mur trop bas. Le worldgen en pose
 * dans chaque village (`village-plan.ts:135`, le pignon tourné vers le Feu).
 *
 * ⚠ ET L'EXPOSITION SE MESURE DEPUIS CETTE LIGNE-LÀ, pas depuis l'ancrage du sprite : dans le
 * harnais, `orient` lit `s.y` APRÈS le remappage ci-dessus. Prendre `c.y` décalerait l'angle d'une
 * tuile sur tout pignon nord — précisément là où le feu est le plus près.
 *
 * ═══ LE RUBAN N'A PAS DE LIGNE DU TOUT ═══
 * Une bande EST/OUEST court sur toute la hauteur de sa tuile (`lumiere.ts:202-203` :
 * `y0 = Y−0,5, y1 = Y+T+0,5`). Chaque rang du ruban a son propre pied, et son art le peint
 * tout entier au ton du dessus pour qu'aucune couture ne le coupe (`dessinerBarriere`). La
 * règle des deux branches le sert quand même : ses rangs hauts lisent droit sous eux, ses rangs
 * bas lisent sa ligne. Ce que la règle ne peut PAS dire de lui, c'est qu'il est dessus PARTOUT —
 * cela se lit sur son type, pas sur sa géométrie (`estDessus`).
 */
import { EDGE_E, EDGE_N, EDGE_O } from '@ashes/sim'
import { DEMI_BANDE_TUILES, TILE_PX } from '../framing'
import { GI } from './reglages'

/** La hauteur d'un mur — `MUR_HT` (`bati-art.ts:143`), le défaut quand la famille est inconnue. */
const MUR_HT = GI.ASTRE.HAUTEUR_MUR_PX

/**
 * LA DEMI-ÉPAISSEUR D'UNE BANDE, EN PIXELS — 2 px, et jamais écrit en chiffre.
 *
 * Une bande est À CHEVAL sur son arête : elle déborde d'autant hors de sa tuile. Le bas du
 * cadre d'une barrière tombe donc `DEMI_BANDE_PX` SOUS sa ligne, et c'est de ce bas-là que se
 * mesure la hauteur du mur. Poser le seuil sur la ligne au lieu du bas de bande déplace la
 * frontière du dessus de 2 rangs et rogne la coiffe — mesuré, pas supposé.
 */
const DEMI_BANDE_PX = DEMI_BANDE_TUILES * TILE_PX

/**
 * LES FAMILLES DONT LA FACE A UN SENS (LG-R7, O) — celles que la règle des faces nomme :
 * *« un mur (son pan est-ouest, sa face au sud) prend la part directe du feu lue à son pied
 * × max(0, cos θ) »*.
 *
 * ⚠ **LA CLÔTURE N'Y EST PAS, ET C'EST UNE QUESTION OUVERTE, PAS UN OUBLI.** LG-R16 justifie le
 * dessus par la physique — *« la flamme (10 px au-dessus de son sol) est sous toute crête (32 px) :
 * rien de direct ne monte d'un feu sur un dessus »* — et à `CLOT_HT` = 8 px cette phrase S'INVERSE :
 * la flamme passe au-dessus de la crête d'une clôture. Sa clause d'art (« dès que l'art le
 * distingue ») dit pourtant qu'elle en a un, puisque `dessinerBarriere` lui peint un `tons.top`.
 * Les deux moitiés de la règle se contredisent sur cette famille-là : c'est à Alexis de trancher,
 * avec une image. En attendant, la clôture reste PLATE — comme la composition ratifiée l'a rendue
 * (ses 35 clôtures n'étaient nommées ni par `pointAuSol` ni par `orient` dans le harnais).
 *
 * `encadrement`, lui, EST ici bien que le harnais ne l'ait pas nommé : c'est une huisserie de
 * `MUR_HT`, la spec dit « un mur », et rien ne se contredit à son sujet. L'absence d'une famille
 * dans un jetable n'est pas une décision de design.
 */
const FAMILLES_DRESSEES: ReadonlySet<string> = new Set([
  'wall', 'wall-bois', 'wall-ruine', 'encadrement', 'door', 'door2a', 'door2b', 'palissade',
])

/** Un corps tel que la GI le voit : où il se tient, et ce qu'il est. */
export interface CorpsPose {
  /** Le `x` du sprite — l'exposition d'une face se mesure depuis sa ligne, pas depuis le pixel. */
  readonly x: number
  /** Le `y` du sprite — le bas de sa tuile pour une barrière, sa ligne pour tout autre corps. */
  readonly y: number
  /**
   * L'arête portée, UN SEUL bit (`EDGE_N`/`EDGE_E`/`EDGE_S`/`EDGE_O`), `0` pour ce qui n'est pas un
   * mur d'arête. La sim REFUSE tout masque composite (`isSingleEdge`, `village.ts:573`) : une tuile
   * porte jusqu'à quatre murs DISTINCTS, chacun son sprite et sa ligne. Vérifié sur la capture de
   * référence : 108 barrières, arêtes 1/2/4/8 seulement, aucun composite.
   */
  readonly arete: number
  /**
   * La famille de barrière — `wall-bois`, `cloture`, `door2a`… telle que `snapshot-view.ts:1958`
   * la compose dans la clé de texture. Elle donne la HAUTEUR DE CRÊTE et le SENS de la face.
   * Absente sur ce qui n'est pas une barrière.
   */
  readonly famille?: string
  /**
   * Un FÛT d'arbre — un cylindre dont on ne voit que la moitié sud, d'où `(1 + cos)/2` au lieu de
   * `max(0, cos)` : il ne s'éteint jamais tout à fait, il tourne. Une CIME n'en est pas un (elle
   * n'a pas de face : le harnais l'écarte par `s.h`).
   */
  readonly fut?: boolean
  /**
   * Le lift du palier sur lequel ce corps est posé, en px (LG-R14) — `0` au sol. Il n'entre PAS dans
   * `pointAuSol`, qui rend des coordonnées DESSINÉES ; il entre dans l'angle d'exposition, qui se
   * juge sur la position LOGIQUE (`planche9.mjs` : `s.y + lift`).
   */
  readonly lift?: number
}

/** Un point du monde, en pixels — une source, ou le sol lu. */
export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * LA HAUTEUR DE CRÊTE de ce corps, en px — `MUR_HT` par défaut, mais 24 pour une palissade et 8
 * pour une clôture (`GI.CORPS.HAUTEUR_PAR_FAMILLE`, gardé égal à `EDGE_SPRITE`).
 */
export function hauteurDeCrete(c: CorpsPose): number {
  return (c.famille !== undefined ? GI.CORPS.HAUTEUR_PAR_FAMILLE[c.famille] : undefined) ?? MUR_HT
}

/**
 * LA LIGNE DU PIED : le sol sur lequel ce corps se tient. Elle diffère de `c.y` pour la seule
 * bande NORD, qui se tient une tuile plus haut que son ancrage.
 */
export function ligneDuPied(c: CorpsPose): number {
  return c.arete === EDGE_N ? c.y - TILE_PX : c.y
}

/** Un ruban : une bande EST ou OUEST, peinte tout entière au ton du dessus. */
export function estRuban(c: CorpsPose): boolean {
  return c.arete === EDGE_E || c.arete === EDGE_O
}

/**
 * LE POINT DU SOL (px monde) QUE LIT LE PIXEL `(xw, yw)` DU CORPS `c`, pour sa part PLATE et sa
 * part de l'ASTRE.
 *
 * Deux branches, et il en faut deux : au-dessus de la crête, on regarde le DESSUS du mur, dont
 * le sol est droit dessous à sa hauteur ; en dessous, on regarde sa FACE, qui lit le pied de sa
 * bande. La crête est à `hauteurDeCrete` sous le BAS DE LA BANDE, pas sous la ligne.
 */
export function pointAuSol(c: CorpsPose, xw: number, yw: number): Point {
  if (auDessusDeLaCrete(c, yw)) return { x: xw, y: yw + hauteurDeCrete(c) }
  return { x: xw, y: ligneDuPied(c) }
}

/**
 * LE PRÉDICAT, NOMMÉ — et il DOIT l'être.
 *
 * On serait tenté de le relire sur le résultat (`pointAuSol(…).y !== ligneDuPied(c)`), et c'est
 * faux d'un rang par bande : à la crête exacte, `yw + hauteurDeCrete` TOMBE SUR la ligne, et les
 * deux branches rendent le même point. Ce rang-là est un dessus que le résultat dit face. Mesuré :
 * rang 2 au nord, rang 18 au sud. (Le harnais teste `p.y === s.y`, et paie ce rang-là.)
 */
export function auDessusDeLaCrete(c: CorpsPose, yw: number): boolean {
  return c.arete !== 0 && yw < ligneDuPied(c) + DEMI_BANDE_PX - hauteurDeCrete(c)
}

/**
 * CE PIXEL EST-IL UN DESSUS ? (LG-R16 — *« le dessus regarde le ciel : la part des astres seule,
 * jamais la part directe du feu »*, Alexis, planche 22.)
 *
 * DEUX BRANCHES, de natures différentes — et les confondre coûte l'une ou l'autre :
 *   · un RUBAN (est/ouest) est dessus PARTOUT, et cela tient à son ART, pas à sa géométrie :
 *     son dessus et son flanc sont peints du même ton pour qu'aucune couture ne le coupe ;
 *   · une bande NORD/SUD est dessus au-dessus de sa crête, et c'est un SEUIL.
 */
export function estDessus(c: CorpsPose, yw: number): boolean {
  if (c.arete === 0 || !suitLaRegleDesFaces(c)) return false
  if (estRuban(c)) return true
  return auDessusDeLaCrete(c, yw)
}

/**
 * CE CORPS EST-IL RÉGI PAR LA RÈGLE DES FACES (LG-R7 O, LG-R16) ? — UNE SEULE PORTE POUR LES DEUX
 * MOITIÉS DE LA RÈGLE, et c'est délibéré.
 *
 * O (la face a un sens) et LG-R16 (le dessus regarde le ciel) sont les deux faces d'une même
 * question : *ce corps a-t-il un dessus et une face, ou est-il plat ?* Les gouverner par deux
 * prédicats séparés laisserait une famille parquée à moitié — une clôture sans orientation mais
 * AVEC une coiffe, une demi-position que personne n'a choisie. Une famille que la règle ne nomme
 * pas garde E ENTIÈREMENT, comme la composition ratifiée l'a rendue.
 */
export function suitLaRegleDesFaces(c: CorpsPose): boolean {
  if (c.fut === true) return true
  return c.arete !== 0 && c.famille !== undefined && FAMILLES_DRESSEES.has(c.famille)
}

/**
 * LE COSINUS DE L'ANGLE ENTRE LE SUD ET LA DIRECTION DE LA SOURCE (LG-R7, O) — le sud est `+y`,
 * donc `cos = dy / d` : `+1` quand la source est droit devant la face, `−1` quand elle est derrière.
 *
 * Mesuré depuis la position LOGIQUE du pied (`ligneDuPied` + `lift`), jamais depuis l'ancrage du
 * sprite : au nord les deux diffèrent d'une tuile entière.
 */
function cosDuSud(c: CorpsPose, source: Point): number {
  const dx = source.x - c.x
  const dy = source.y - (ligneDuPied(c) + (c.lift ?? 0))
  const d = Math.hypot(dx, dy)
  return d > 0 ? dy / d : 0
}

/**
 * L'EXPOSITION DE CE CORPS À LA FLAMME (LG-R7, O — Alexis, planche 16 : « ok pour O »), ou `null`
 * s'il n'a pas de face dressée et garde donc la lecture sous le pixel (E).
 *
 *   un mur   → max(0, cos θ)     il s'éteint franchement quand le feu passe derrière son arête
 *   un fût   → (1 + cos θ)/2     un cylindre : il tourne, il ne s'éteint pas
 *
 * Rendent `null` : un ruban (vu de champ, il garde E), une cime, une roche, un acteur, le sol — et
 * la clôture, question ouverte (voir `FAMILLES_DRESSEES`).
 */
export function expositionAuFeu(c: CorpsPose, feu: Point): number | null {
  if (!suitLaRegleDesFaces(c)) return null
  if (c.fut === true) return (1 + cosDuSud(c, feu)) / 2
  if (estRuban(c)) return null
  return Math.max(0, cosDuSud(c, feu))
}

/** OÙ ET COMBIEN ce pixel lit de la part DIRECTE du feu — les trois branches, nommées. */
export type LectureDuFeu =
  /** Un DESSUS : rien de direct n'y monte (LG-R16). */
  | { readonly ou: 'nul' }
  /** Une FACE DRESSÉE : la part lue à `y` (sa ligne du pied), multipliée par `facteur` (LG-R7, O). */
  | { readonly ou: 'auPied'; readonly y: number; readonly facteur: number }
  /** Tout le reste : sous le pixel, comme le plat et l'astre (E). */
  | { readonly ou: 'sousLePixel' }

/**
 * LE CONTRAT DE LA PASSE DES CORPS, en une fonction — pour qu'aucun appelant ne puisse tenir
 * `pointAuSol` sans l'exposition. Les avoir séparés rejouerait E en silence : un mur allumé
 * par-derrière, le défaut même que O a été choisi pour remplacer.
 *
 * L'ORDRE COMPTE : un dessus l'emporte sur l'orientation. Un ruban tombe dans les deux branches
 * (`estDessus` vrai, `expositionAuFeu` nulle) et elles s'accordent — mais c'est `estDessus` qui doit
 * répondre, parce que sa raison est l'ART du ruban et non l'absence de sens de sa face.
 */
export function lectureDuFeu(c: CorpsPose, yw: number, feu: Point): LectureDuFeu {
  if (estDessus(c, yw)) return { ou: 'nul' }
  const facteur = expositionAuFeu(c, feu)
  if (facteur === null) return { ou: 'sousLePixel' }
  return { ou: 'auPied', y: ligneDuPied(c), facteur }
}

/**
 * ═══ LA NORMALE, ET SA PORTÉE `g` (LG-R7, « La normale ») ═══
 *
 * *« chaque part directionnelle multiplie le texel par n·ℓ depuis sa source, portée par
 * g = |pied → source|/z, de sorte qu'un dessus plat reçoit exactement sa part et qu'une face
 * reçoit plus ou moins selon qu'elle regarde la source. »* — `lumiere-globale.md:168`.
 *
 * ⚠ CE TERME MANQUAIT À CE MODULE, et il est de la même classe qu'`orient` : opératoire dans la
 * spec, présent dans la composition ratifiée (`planche9.mjs:176-177`), absent de la loi livrée.
 * Trouvé en relisant la spec avant d'écrire le shader, et non en déboguant un mur noir.
 *
 * ═══ `g` APPARTIENT AU POINT LU, PAS AU CORPS ═══
 * Le harnais calcule DEUX `g` dans le même pixel et ne les confond jamais : `gA`/`gF` au point lu
 * `p` (`:176-177`), `gAD`/`gFD` à l'ancrage du sprite `s.x, s.y` (`:131-132`, la branche qu'on
 * retire à l'image d'aujourd'hui). « Le pied » de la spec, c'est donc `pointAuSol` — le pied pour
 * une face, une hauteur de crête plus bas pour un dessus.
 *
 * ═══ LA FORME SANS RACINE ═══
 * `g × n·ℓ` se simplifie : n·ℓ = n·d/|d|, donc g × n·ℓ = (|d|/z) × (n·d/|d|) = **n·d / z**, avec `d`
 * NON NORMALISÉ. Le shader n'a donc ni racine ni division par une longueur : un produit scalaire et
 * une division par la hauteur de la source. `porteeDeLaNormale` reste exportée parce que la spec
 * NOMME `g` — un lecteur qui cherche le terme de la spec doit le trouver dans le code — et un test
 * tient les deux formes égales.
 *
 * ═══ LE REPÈRE, ET LA DETTE QU'IL LAISSE ═══
 * `d` se bâtit en px monde : `+x` est l'est, `+y` le SUD (l'écran descend), `+z` le haut. `n` doit
 * être dans CE repère-là. Or une normal map encode `y` selon deux conventions opposées (OpenGL vers
 * le haut, DirectX vers le bas) et rien ici ne peut trancher laquelle `bati-art` a peinte : c'est
 * au CÂBLAGE de l'établir, et par une mesure — deux rendus de la même face avec la source au nord
 * puis au sud, celle qui s'allume face à la source a la bonne convention. Poser le signe ici au
 * jugé donnerait un relief inversé sur toutes les faces à la fois, ce qui ne se voit pas sur une
 * image plate mais retourne chaque mur. `Source3` et `Normale` ont sciemment la même forme : les
 * distinguer nominalement coûterait une classe, or c'est leur NOM au point d'appel qui documente.
 *
 * ⚠ LES DEUX SOURCES N'ONT PAS DU TOUT LA MÊME HAUTEUR — mesuré sur la donnée qui a servi à ratifier
 * la règle (`p16-nuit-grilles.json`) : la lune est à `z = 620` px, le feu à **`z = 9,6`** px. C'est
 * ce 9,6 que LG-R16 invoque en disant « la flamme est à 10 px au-dessus de son sol ». Il tombe
 * AU-DESSUS de `CLOT_HT` (8 px) et SOUS `PALIS_HT` (24) : la contradiction de la clôture
 * (`FAMILLES_DRESSEES`) n'est plus déduite d'une phrase, elle est dans la mesure. Et un feu si bas
 * donne un `g` qui explose à quelques tuiles — c'est voulu, c'est ce qui fait qu'une face à peine
 * inclinée prend presque tout, et c'est aussi pourquoi l'écrêtage à 1 par canal n'est pas décoratif.
 */

/** Une source de lumière dans l'espace, en px monde — `z` est sa hauteur au-dessus du sol. */
export interface Source3 extends Point {
  readonly z: number
}

/** Une normale de surface, dans le repère du monde : `+x` est, `+y` SUD, `+z` haut. */
export interface Normale {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * `g` — LA PORTÉE DE LA NORMALE (LG-R7) : `|pied → source| / z`, le facteur qui ramène à 1 la
 * réponse d'un dessus plat. `0` si la source n'a pas de hauteur : sans `z`, « n·ℓ porté par g »
 * n'a pas de sens, et diviser rendrait ±∞. La garde ne se déclenche sur aucune donnée ratifiée
 * (lune 620, feu 9,6) — elle est là pour la source qu'un appelant futur poserait au sol.
 */
export function porteeDeLaNormale(p: Point, s: Source3): number {
  if (!(s.z > 0)) return 0
  return Math.hypot(s.x - p.x, s.y - p.y, s.z) / s.z
}

/**
 * LE FACTEUR D'UNE PART DIRECTIONNELLE : `max(0, n·ℓ) × g`, écrit `max(0, n·d) / z`.
 *
 * Vaut EXACTEMENT 1 sur un dessus plat (`n = (0, 0, 1)`), où que soit la source — c'est la phrase
 * « de sorte qu'un dessus plat reçoit exactement sa part », et c'est le test qui compte.
 */
export function facteurDeNormale(n: Normale, p: Point, s: Source3): number {
  if (!(s.z > 0)) return 0
  const d = n.x * (s.x - p.x) + n.y * (s.y - p.y) + n.z * s.z
  return d > 0 ? d / s.z : 0
}
