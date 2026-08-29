/**
 * Les POIs de la Vallée alpine (spec figée 2026-07-08, 26 types). Placement PUR :
 * un semis bruit bleu pose ~90 points, chacun reçoit un type valide pour son biome
 * local (table pondérée, plafonds durs), et devient une Zone nommée. hash2 = seul aléa.
 */
import { hash2 } from './noise'
import { poissonPoints } from './poisson'
import { isWater, terrainAt, isBlockingTile, type FaitDeGeneration, type WorldMap, type Zone } from './map'
import { spawnMonster } from './monsters'
import type { SimState } from './sim'
import { setTile } from './map'
import { FAUNA, MONSTER_DEFS, MORTS, TERRAIN_FOREST, TERRAIN_LARCH, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_ROAD, TERRAIN_SCREE } from './balance'
import { jourDeSaison, seasonRamp } from './time'
import { distSq } from './geometry'
import { type CarveField, carveDistanceToMain, walkableComponents } from './connectivity'
import { nomSelonSort, sortDuLieu } from './sort-des-lieux'
import { directionCendriere, directionOpposee } from './cendre'
import { saillant } from './annales'
import { BUILT_KINDS } from './poi-batis'

// ids terrain (balance.ts) — repris localement pour lisibilité de la table.
const SCREE = 9, ROCK = 5, SNOW = 10, BOULDERS = 16, GLACIER = 15, BURNT = 21, PEAT = 18, REED = 19,
  AL_MEADOW = 12, AL_FLOWERS = 20, OLD_GROWTH = 22, HEATH = 11, PINE = 13, FLOWER = 17,
  FOREST = 3, GRASS = 1, MARSH = 8, LARCH = 14, WILLOW = 24, WET_MEADOW = 25, JUNIPER = 26,
  // LA CLAIRIÈRE (2026-08-25) — elle est du BOIS et de l'OUVERT à la fois. D'où la règle qui
  // décide où elle entre, et qui n'est pas un goût : **une ligne éligible à la fois sur FOREST
  // et sur GRASS l'est sur CLAIRIERE** — le lieu marche déjà sous les arbres ET au grand jour,
  // donc il marche dans une trouée. Sans ça, faire de la clairière un terrain retire ~12 % du
  // massif au tirage des lieux : MESURÉ, un lieu perdu sur 136 (`charniers.test.ts`), et rien
  // n'aurait dit lequel.
  CLAIRIERE = 30

export interface PoiType {
  slug: string
  name: string
  family: 'eco' | 'shelter' | 'danger' | 'reward'
  biomes: number[]
  /**
   * LES ZONES OÙ CE LIEU PEUT NAÎTRE (slugs — spec `worldgen.md` R7).
   *
   * C'est ce qui donne enfin une ADRESSE aux lieux. Un lieu sans `zones` reste libre d'apparaître
   * partout où son biome le porte — c'est le cas du Cairn, et c'est voulu : les cairns sont les
   * jalons de TOUTE la vallée, et c'est leur métier de se suivre de proche en proche.
   *
   * Sur une carte sans zones (l'ancienne vallée), ce champ est simplement ignoré : `poi.ts` reçoit
   * un accesseur, il ne connaît pas `zonegraph.ts`.
   */
  zones?: string[]
  /** Chance d'être tiré quand on est ÉLIGIBLE. Ce n'est PAS la rareté — voir `cap`. */
  weight: number
  /** La rareté vit ICI : plafond dur. Un Sanctuaire est précieux parce qu'il y en a deux. */
  cap: number
  /**
   * Exemplaires GARANTIS, servis avant le tirage général (spec lieux ; décision
   * 2026-07-11).
   *
   * **TOUS LES TYPES RÉSERVENT DÉSORMAIS** (2026-07-14). En donnant une ADRESSE aux lieux (la
   * Grotte au Karst, la Mine au Gouffre), on a réduit d'un ordre de grandeur le nombre de points
   * de semis où chacun est éligible — et **le tirage est à SOMME NULLE** : neuf types se
   * disputent les points d'une même zone, donc les perdants disparaissent. Mesuré : « la Mine
   * abandonnée » ne naissait NULLE PART sur la seed 7. C'est exactement la faute que R6 avait
   * nommée en juillet (« le semis décide de l'ABONDANCE ; la réservation décide de l'EXISTENCE »)
   * — l'adressage l'a simplement généralisée à toute la table. Une ligne morte est une ligne
   * morte : on ne joue plus AUCUN type à la loterie. Un lieu dont une mécanique dépend ne peut pas se permettre de
   * perdre la loterie : mesuré, le Belvédère avait 10 points de semis éligibles
   * sur la seed du jeu — et sortait quand même **zéro fois**, écrasé par le Cairn
   * (poids 12, éligible partout). Monter son poids ne réglait rien : le tirage
   * est à SOMME NULLE (le semis borne le total), donc gaver l'un affame l'autre.
   * On ne joue donc plus les lieux chargés à la loterie : **ils réservent leur
   * point.** Absent = 0 (le type prend sa chance comme avant).
   */
  reserve?: number
  /**
   * CE LIEU EST UNIQUE AU MONDE — son plafond ne suit PAS la taille de la carte.
   *
   * `capFor` multiplie normalement le plafond par la surface : une vallée deux fois plus
   * grande porte deux fois plus de Cairns, ce qui est juste pour du mobilier. Mais un REPÈRE
   * ne se duplique pas : deux « Grands » Chênes, et il n'y a plus de grand chêne du tout —
   * on ne s'oriente pas sur un objet qu'on peut confondre avec un autre. Sans ce drapeau,
   * `cap: 1` rendait bel et bien 2 exemplaires sur une carte de production (attrapé par un test).
   */
  unique?: boolean
  /**
   * CE TYPE A SON PROPRE SEMIS — il ne joue PAS la loterie des lieux (spec `cendreux.md` R20).
   *
   * Le tirage général est adressé par ZONE et à SOMME NULLE : le semis borne le total, donc tout
   * type qui s'y ajoute en affame un autre. Un lieu qui doit se poser *partout* mais *pondéré par
   * autre chose que sa zone* n'y a donc rien à faire — il affamerait les vingt-six autres, et son
   * abondance serait décidée par un poids qui ne sait rien de ce qui la commande vraiment.
   *
   * Un type marqué ainsi est invisible à `candidatesFor` et à `reserveCharged` : la loterie est
   * BIT À BIT celle d'avant (une garde le vérifie). Il se pose dans une passe à lui, après elle —
   * `placeCharniers` pour le seul type qui porte ce drapeau aujourd'hui.
   */
  horsSemis?: boolean
  minElev?: number
  maxElev?: number
  footprint: number
  nodeKind?: 'gisement' | 'carriere'
  monster?: 'boar' | 'cendreux' | 'wolf'
  /**
   * CE LIEU EST HUMAIN, ET IL S'EST INSTALLÉ POUR UNE RAISON (stratigraphie S-R13/S-R14).
   *
   * `'eau'` : le lieu exige de l'eau à portée (une ferme s'installe au bord de l'eau douce) ;
   * `'route'` : il exige une sente (une charrette s'abandonne sur le chemin, pas dans un pré).
   * Le prédicat filtre les points du MÊME semis de Poisson — la causalité choisit PARMI les
   * candidats neutres, elle ne fabrique pas de points : la garde de neutralité spatiale reste
   * vraie du pool, et le filet de réservation (qui balaie la carte) garantit l'existence.
   */
  pres?: 'eau' | 'route'
}

/** La portée du prédicat `pres`, en tuiles (Chebyshev). À 26, le semis n'offrait plus qu'UNE
 *  ferme par carte (mesuré) : la cause devenait une pénurie. 40 — deux écrans — reste une
 *  ferme « au bord de l'eau », et le semis respire. */
const PRES_RAYON = 40

export const POI_PLACEMENT = {
  /**
   * L'ESPACEMENT DU SEMIS, EN TUILES ABSOLUES — et ce mot est tout le correctif.
   *
   * C'était `SPACING_FRAC = 0,08`, une FRACTION de `min(w,h)`. Le rayon d'exclusion
   * grandissait donc avec la carte, et le semis obtenu était une HOMOTHÉTIE exacte
   * du même tirage : le nombre de points ne dépendait pas de la surface. Mesuré :
   *
   *     1200×1800 (le jeu)  → 75 lieux
   *     2400×3600 (la cible, décision du 2026-07-07) → 69 lieux
   *
   * **Quatre fois plus de terre, autant de lieux.** À la taille cible, la vallée
   * aurait été quatre fois plus vide — l'inverse exact de ce qu'on cherche. (Le
   * phénomène était connu et documenté dans `poi.test.ts` ; sa conséquence à
   * l'échelle ne l'était pas.)
   *
   * 96 tuiles = ce que valait `0,08 × 1200` : à la taille du jeu, **rien ne change**.
   * Au-delà, la densité suit enfin la surface.
   */
  SPACING_TILES: 96,
  /**
   * LE GARDE-FOU DES PETITES CARTES. Un espacement absolu est la bonne règle — mais
   * appliqué tel quel à une carte de 240×360 (les tests, les vignettes), il n'y
   * laisserait que six points, et la vallée n'aurait plus aucun lieu. On borne donc
   * l'espacement à une fraction du petit côté : une vallée minuscule reste une
   * vallée peuplée, à sa mesure.
   *
   * À la taille du jeu (1200) les deux règles coïncident exactement — `0,08 × 1200
   * = 96` — et rien ne bouge. Ce n'est donc un garde-fou QUE pour les petites cartes.
   */
  SPACING_MAX_FRAC: 0.08,
  /**
   * La surface de RÉFÉRENCE des plafonds — celle où toute la table a été calibrée
   * (et où elle est jouée aujourd'hui). Les plafonds croissent proportionnellement :
   * une vallée deux fois plus grande porte deux fois plus de Cairns, sinon
   * l'espacement absolu ne servirait à rien — les plafonds la videraient à sa place.
   *
   * La RARETÉ, elle, ne change pas : elle est une DENSITÉ (« deux Sanctuaires par
   * vallée de cette taille »), pas un compte absolu.
   */
  CAP_REFERENCE_AREA: 1200 * 1800,
  CANONICAL: { width: 2400, height: 3600 },

  /**
   * LE RYTHME, ESSAYÉ PUIS RETIRÉ — et la raison mérite d'être consignée, parce que
   * l'idée est bonne et reviendra.
   *
   * Le bruit bleu de Poisson espace parfaitement, et c'est son défaut : il pose les
   * lieux avec une régularité de papier peint, alors qu'on voudrait des GRAPPES
   * (« il y a quelque chose dans ce coin ») et des VIDES (« il n'y a rien, et ce
   * rien se traverse »). Un champ basse fréquence qui écarte les points de ses
   * creux le donne en trois lignes, et la carte y gagne.
   *
   * Mais il fait aussi passer au ROUGE la garde de neutralité spatiale de
   * `poi.test.ts` — et à juste titre : cette garde protège contre un vrai bug (les
   * plafonds raflés par les premiers points de la vague de croissance du semis, un
   * gradient de densité mesuré à 1,31–2,50), et un regroupement volontaire est,
   * pour elle, exactement le même signal. Distinguer la grappe VOULUE de la grappe
   * BUG demande un test bien plus fin que celui-ci.
   *
   * On ne relâche pas une garde durement gagnée pour un agrément. Le rythme
   * reviendra quand il aura son propre critère — c'est-à-dire quand on saura DIRE
   * ce qu'est une bonne grappe, et pas seulement la reconnaître.
   */

  /**
   * LE SEUIL, PAS LE TUNNEL — combien de tuiles de roche un lieu a-t-il le droit
   * de percer pour s'ouvrir sur le monde ?
   *
   * Le correctif du 2026-07-11 (« le lieu creuse son propre sol ») garantissait
   * au lieu une tuile MARCHABLE dans son empreinte. Il ne lui garantissait pas
   * d'être ATTEIGNABLE : mesuré sur la vraie carte, 16 lieux sur 81 (seed du jeu)
   * étaient des poches parfaitement marchables au cœur d'un massif, où nul ne
   * mettra jamais les pieds. La Grotte, la Source chaude et le Belvédère étaient
   * morts à 100 % — les trois devises de la spec `lieux.md`.
   *
   * La distribution mesurée tranche : **10 lieux murés ne sont séparés du monde
   * que par UNE tuile** (une porte), et **29 en sont à plus de vingt-quatre**
   * (ensevelis, sans espoir). Il n'y a donc rien à gagner à creuser loin : au-delà
   * du seuil, le lieu n'est pas mal fermé, il est mal PLACÉ.
   *
   * D'où la règle : la connexité entre dans l'ÉLIGIBILITÉ. Un type qui ne peut
   * pas s'ouvrir ici n'est pas creusé de force — il est écarté DE CE POINT, et
   * `candidatesFor` en propose un autre (ou le point reste sauvage). La Grotte
   * naît alors au BORD du massif, ce qui est précisément l'endroit où se trouve
   * la bouche d'une grotte. Le mécanisme existait déjà ; on lui donne juste les
   * yeux qui lui manquaient.
   *
   * 3 : une porte, une vire, une margelle. Jamais un tunnel.
   */
  MAX_CARVE_TILES: 3,
}

export const POI_TYPES: PoiType[] = [
  // Économie
  { slug: 'gisement', zones: ['karst', 'aiguilles', 'gouffre'], name: 'le Gisement', family: 'eco', biomes: [SCREE, ROCK, BOULDERS], minElev: 0.55, weight: 2, cap: 3, reserve: 1, footprint: 4, nodeKind: 'gisement' },
  { slug: 'carriere', zones: ['alpages', 'aiguilles', 'karst'], name: 'la Carrière', family: 'eco', biomes: [SCREE, BOULDERS], weight: 3, cap: 4, reserve: 1, footprint: 4, nodeKind: 'carriere' },
  { slug: 'saline', zones: ['alpages', 'ruines'], name: 'la Saline', family: 'eco', biomes: [AL_MEADOW, AL_FLOWERS, HEATH], weight: 2, cap: 3, reserve: 1, footprint: 3 },
  { slug: 'verger', zones: ['pres_bas', 'sylve'], name: 'le Verger sauvage', family: 'eco', biomes: [FLOWER, GRASS, AL_MEADOW], weight: 3, cap: 4, reserve: 1, footprint: 3 },
  // Abris — les empreintes des lieux BÂTIS (étage 1) sont dimensionnées pour leur PLAN
  // (`poi-batis.ts` : côté du plan = empreinte, garde `verifierPlans`), plus pour un sprite.
  // Élargies le 2026-08-10 sous garde de recensement A7 (chaque type doit continuer de naître).
  { slug: 'ruines', zones: ['ruines'], name: 'les Ruines', family: 'shelter', biomes: [OLD_GROWTH, FOREST, GRASS, CLAIRIERE], weight: 3, cap: 4, reserve: 1, footprint: 6 },
  { slug: 'cabane', zones: ['alpages'], name: 'la Cabane de berger', family: 'shelter', biomes: [AL_MEADOW, AL_FLOWERS], weight: 4, cap: 5, reserve: 1, footprint: 5 },
  { slug: 'abri', zones: ['karst', 'aiguilles', 'gouffre', 'ruines'], name: "l'Abri sous roche", family: 'shelter', biomes: [ROCK, BOULDERS, SCREE], weight: 5, cap: 6, reserve: 1, footprint: 4 },
  // Mine et grotte : 5→7 le 2026-08-11 (l'anneau de MASSIF d'une tuile pleine + un antre qui
  // respire ne tiennent pas en 5×5) — même garde de recensement A7/A19 que l'élargissement
  // du 2026-08-10 : si le type cesse de naître, on resserre.
  { slug: 'mine', zones: ['karst', 'gouffre'], name: 'la Mine abandonnée', family: 'shelter', biomes: [SCREE, ROCK], minElev: 0.5, weight: 3, cap: 3, reserve: 1, footprint: 7 },
  { slug: 'oratoire', zones: ['alpages', 'karst'], name: 'l’Oratoire', family: 'shelter', biomes: [SCREE, ROCK, AL_MEADOW], minElev: 0.55, weight: 3, cap: 3, reserve: 1, footprint: 3 },
  { slug: 'bivouac', name: 'le Vieux bivouac', family: 'shelter', biomes: [GRASS, AL_MEADOW, HEATH, FOREST, SCREE, FLOWER, OLD_GROWTH, PINE, CLAIRIERE], weight: 4, cap: 4, reserve: 1, footprint: 3 },
  // Danger
  { slug: 'taniere', zones: ['sylve', 'pres_bas'], name: 'la Tanière', family: 'danger', biomes: [FOREST, PINE, GRASS, CLAIRIERE], weight: 6, cap: 8, reserve: 1, footprint: 3, monster: 'boar' },
  /**
   * LA LOUVIÈRE (spec `loup.md` L1-L3, décisions d'Alexis 2026-08-28) — le gîte de la meute.
   *
   * `horsSemis`, comme le Charnier : son adresse n'est ni une zone ni une loterie, c'est une
   * RELATION — la lisière d'un coin de chasse (`placeGitesLoup`, appelé par zonegen après
   * `placePois`). Un coin au plus par gîte, un gîte au plus par coin ; la géométrie de pose
   * vit dans `LOUVIERE` plus bas (elle se calibre en regardant une carte). Ses biomes sont le
   * COUVERT : la meute vit à couvert, en lisière du pré où elle mange — jamais dedans.
   * Le cap est large (le nombre réel est borné par les coins) ; `monster: 'wolf'` la fait
   * entrer d'office dans `nidsAMonstre` (on ne fonde pas un village au seuil d'une meute) et
   * dans la machinerie des lieux peuplés (`spawnPoiMonsters`/`advanceDens`).
   */
  { slug: 'louviere', name: 'la Louvière', family: 'danger', horsSemis: true, weight: 0, cap: 14, footprint: 3, biomes: [FOREST, PINE, LARCH, OLD_GROWTH, SCREE, BOULDERS], monster: 'wolf' },
  { slug: 'repaire', zones: ['brule', 'cendriere'], name: 'le Repaire de Cendrés', family: 'danger', biomes: [BURNT, ROCK, SCREE], weight: 4, cap: 5, reserve: 1, footprint: 3, monster: 'cendreux' },
  { slug: 'epave', zones: ['aiguilles', 'glacier'], name: "l'Épave d'avalanche", family: 'danger', biomes: [SCREE, BOULDERS], minElev: 0.55, weight: 3, cap: 3, reserve: 1, footprint: 4 },
  { slug: 'fondriere', zones: ['tourbiere', 'lac_mort'], name: 'la Fondrière', family: 'danger', biomes: [PEAT, REED], weight: 3, cap: 3, reserve: 1, footprint: 3 },
  /**
   * LE CHARNIER — le pic du champ des morts, rendu VISIBLE (spec `cendreux.md` R20).
   *
   * Ni `zones` ni `weight` ni `reserve` : il ne joue pas la loterie (`horsSemis`), donc aucun de
   * ces trois champs ne le concerne. Son adresse n'est pas une zone, c'est une DENSITÉ — un point
   * sur quatre accepté dans les Prés Bas, un sur deux dans la ceinture, trois sur quatre aux
   * marges (`densiteDeBase`). C'est ce qui le met « un peu partout » sans mentir sur où la vallée
   * a le plus enterré (décision d'Alexis, 2026-07-31).
   *
   * SES BIOMES SONT TOUS CEUX OÙ L'ON PEUT CREUSER, la neige et l'éboulis compris — et ce n'est
   * pas de la générosité, c'est la leçon de R16 mesurée trois fois : le Névé, le Glacier, le
   * Gouffre et les Aiguilles n'ont QUE de la neige, de l'éboulis et des blocs. Les écarter aurait
   * vidé de charniers les quatre cinquièmes du tier 2 — le pire sol de la vallée serait le seul
   * sans fosse. Seule l'eau est exclue : on n'y creuse rien.
   *
   * `cap` est large à dessein : ce qui borne le nombre est le SEMIS et le champ, pas un plafond.
   * Il ne reste ici que comme garde-fou contre une carte dégénérée.
   */
  { slug: 'charnier', name: 'le Charnier', family: 'danger', horsSemis: true, weight: 0, cap: 80, footprint: 2,
    biomes: [GRASS, FOREST, HEATH, FLOWER, AL_MEADOW, AL_FLOWERS, OLD_GROWTH, PINE, LARCH, BURNT, PEAT, REED, MARSH, SCREE, BOULDERS, SNOW, CLAIRIERE] },
  /**
   * LE CHAMP DE CREVASSES — était une LIGNE MORTE (mesuré 2026-07-13) : biome
   * `GLACIER` seul, or le glacier est `walkable: false` et se cache derrière la
   * neige et la roche, elles aussi bloquantes. Sur la vraie carte, 176 000 tuiles
   * de glacier existaient et **pas une seule** n'était à moins de trois tuiles du
   * monde. Le lieu ne pouvait donc naître nulle part — problème déjà noté au
   * journal le 2026-07-09 (« disparaît des 5 seeds testées ») et laissé en suspens.
   *
   * On lui rend l'accès sans lui retirer son sujet : il naît désormais sur le haut
   * pierrier (le sol brisé sous la glace), et son empreinte de 4 mord dans le
   * minéral au-dessus. Les biomes de glace et de neige RESTENT dans sa liste : le
   * jour où la neige deviendra praticable (question ouverte, cf. la note de session
   * sur les 24 % de carte-mur), il remontera de lui-même vers la vraie marge du
   * glacier, sans qu'on retouche cette ligne.
   */
  { slug: 'crevasses', zones: ['glacier'], name: 'le Champ de crevasses', family: 'danger', biomes: [GLACIER, SNOW, SCREE, BOULDERS], minElev: 0.66, weight: 3, cap: 3, reserve: 1, footprint: 4 },
  // Récompense / paysage
  /**
   * LE BELVÉDÈRE — `minElev` était à 0,75, **au-dessus du plafond du marchable**
   * (`BANDS.SCREE = 0,73` : tout ce qui monte plus haut est roche, neige ou glace,
   * et tout cela bloque). Il ne pouvait donc naître QUE sur du bloquant, et
   * n'existait que par la grâce d'un percement — 16 000 tuiles ouvrables sur 2,16
   * millions, soit 0,7 % de la carte. Il a fini par perdre : sur la seed 31415, il
   * ne sortait pas (garde de réservation au rouge).
   *
   * Un point de vue où l'on ne peut pas se tenir n'est pas un point de vue. Il se
   * pose désormais sur le HAUT PIERRIER (0,66-0,73) — l'endroit le plus élevé où
   * l'on puisse poser le pied, ce qui est très exactement la définition d'un
   * belvédère. `AL_MEADOW` sort de sa liste : cette bande s'arrête à 0,64, elle
   * était inatteignable sous ce `minElev` — une ligne qui mentait.
   */
  { slug: 'belvedere', zones: ['alpages', 'aiguilles'], name: 'le Belvédère', family: 'reward', biomes: [SCREE, ROCK], minElev: 0.66, weight: 3, cap: 4, reserve: 1, footprint: 2 },
  // Élargie 2→5 à la promotion en plan (étage 3, le précédent des sept de l'étage 1) : la
  // grotte est ENTRABLE — son plan creuse un antre derrière la gueule, et un antre exige la
  // marge des régions. Sous garde de recensement : si la Grotte cesse de naître, on resserre.
  { slug: 'grotte', zones: ['karst', 'gouffre'], name: 'la Grotte', family: 'reward', biomes: [ROCK, SCREE], weight: 4, cap: 5, reserve: 1, footprint: 7 },
  { slug: 'cascade', zones: ['alpages', 'karst', 'aiguilles'], name: 'la Cascade', family: 'reward', biomes: [ROCK, SCREE], minElev: 0.4, weight: 2, cap: 4, reserve: 1, footprint: 2 },
  { slug: 'erratique', zones: ['pres_bas', 'alpages', 'ruines'], name: 'le Bloc erratique', family: 'reward', biomes: [BOULDERS, AL_MEADOW, GRASS, FLOWER], weight: 4, cap: 5, reserve: 1, footprint: 2 },
  { slug: 'arbre', zones: ['sylve'], name: "l'Arbre remarquable", family: 'reward', biomes: [OLD_GROWTH], weight: 2, cap: 3, reserve: 1, footprint: 2 },
  // ═══ LE GRAND CHÊNE — l'HORIZON de la zone de départ ═══
  // La Racine était la SEULE zone du jeu sans skyline : ses cinq lieux plafonnaient à 50 px de
  // haut quand la canopée en fait 44, donc aucun ne perçait, donc rien ne se voyait venir et
  // rien n'indiquait une direction. `lieux.md` promet pourtant qu'« un monument qui dépasse la
  // canopée se voit venir, donc s'apprend de loin » : la promesse n'était tenue nulle part ici.
  //
  // Il est RÉSERVÉ à `pres_bas`, et c'est ce qui le garantit : `reserve` est un compte GLOBAL,
  // donc un type qui ne peut se poser QUE dans la Racine y place forcément son exemplaire.
  // `cap: 1` — un repère n'en est un que s'il est seul. Sa devise est le SAVOIR : l'atteindre
  // ouvre la carte alentour (et le brouillard avec), ce qui enseigne la boucle du jeu —
  // on voit un repère, on y va, on y gagne de quoi voir plus loin.
  // ═══ LE FILON AFFLEURANT — « ça existe. Pas ici. », enfin DIT ═══
  // Le teaser de fer existait depuis toujours : UN filon au stock dérisoire, posé à la tuile la
  // plus lointaine de la Racine. Son intention — « il faut l'avoir cherché pour le trouver, et
  // l'avoir trouvé pour se demander où sont les autres » — n'était jamais délivrée : un
  // `ResourceNode` n'entre pas dans `knownPois`, n'a pas d'art, n'apparaît sur aucune carte.
  // Chercher était impossible : une tuile sur 700 000, sans le moindre signal. Ce n'était pas
  // caché, c'était absent. En faire un LIEU garde l'intention (loin, maigre, unique) et rend
  // la quête possible : il se voit, il se retient, il se raconte.
  //
  // Il ne porte VOLONTAIREMENT aucune charge de découverte : le projet réserve les charges à
  // la famille `reward` (un garde-fou le vérifie), et le filon est `eco` — il porte un vrai
  // minerai. Sa charge serait d'ailleurs redondante : le voir sur la carte sous son nom dit
  // déjà « le fer existe », et l'épuiser en trois coups dit « pas ici ». Le message passe par
  // le LIEU et par son stock dérisoire, pas par une ligne de chronique.
  { slug: 'filon', zones: ['pres_bas'], name: 'le Filon affleurant', family: 'eco', biomes: [GRASS, FOREST, SCREE, ROCK, BOULDERS, FLOWER, CLAIRIERE], weight: 2, cap: 1, reserve: 1, unique: true, footprint: 2 },
  { slug: 'chene', zones: ['pres_bas'], name: 'le Grand Chêne', family: 'reward', biomes: [GRASS, FOREST, FLOWER, CLAIRIERE], weight: 3, cap: 1, reserve: 1, unique: true, footprint: 2 },
  // ═══ LES REPÈRES D'HORIZON DE LA RACINE (spec t0-exploration §1) ═══
  // Le Grand Chêne prouvait la boucle « voir un repère → y aller → y gagner de quoi voir plus
  // loin » — mais il était SEUL dans 614 000 tuiles. On généralise le langage sans le diluer :
  // chaque repère a une crown qui perce la canopée, et une charge qui suit les devises de
  // `lieux.md` (aucune inventée).
  //
  // LA TOUR DE GUET EFFONDRÉE — le Belvédère de la plaine : on grimpe aux décombres, on voit
  // (savoir/radius, REVEAL_TOUR_TILES). Unique : un repère n'en est un que s'il est seul. Et
  // c'est une RUINE : le pays d'avant guettait déjà le sud — la tour regarde la Cendrière.
  { slug: 'tour_guet', zones: ['pres_bas'], name: 'la Tour de guet effondrée', family: 'reward', biomes: [GRASS, FLOWER, HEATH, FOREST, CLAIRIERE], weight: 2, cap: 1, reserve: 1, unique: true, footprint: 3 },
  // LES PIERRES LEVÉES — les menhirs se RÉPONDENT (savoir/nearest parmi PIERRES_KINDS) : une
  // chaîne d'indices qui mène au Cercle, le patron Vegvisir de Valheim. reserve 2 : la chaîne
  // exige au moins deux maillons, sinon c'est un caillou qui pointe vers rien.
  { slug: 'pierre_levee', zones: ['pres_bas'], name: 'la Pierre levée', family: 'reward', biomes: [GRASS, FLOWER, HEATH], weight: 3, cap: 3, reserve: 2, footprint: 2 },
  /**
   * LA STÈLE — le lecteur de pierre du pays d'avant (spec `annales.md` R8-R11). HORS-SEMIS,
   * comme le charnier : elle ne joue pas la loterie, elle se pose SUR les faits saillants de
   * l'ère 2 (`placeSteles` — croisées et gués, au bord du chemin, jamais dessus). Basse, sans
   * couronne : un lecteur, pas un repère d'horizon.
   */
  { slug: 'stele', name: 'la Stèle', family: 'reward', horsSemis: true, weight: 0, cap: 7, footprint: 1, biomes: [GRASS, FLOWER, HEATH, FOREST, PINE, CLAIRIERE] },
  // ═══ LES RUINES BASSES DU PAYS D'AVANT (spec t0-exploration R19) ═══
  // Des abris au sens des shelters existants, AUCUN butin (lieux.md A9). Avec la Tour, le pré
  // raconte : on vivait ici, on guettait le sud, on est partis.
  // La ferme AU bord de l'eau, la charrette SUR le chemin (S-R14) : le pays d'avant s'est
  // installé pour des raisons qu'on peut lire.
  // `reserve: 2` : le prédicat d'eau raréfie les points qualifiés du semis, et la loterie
  // diluait la ferme à UN exemplaire (mesuré) — or c'est LA grande ruine explorable du T0.
  // La réservation garantit l'existence ; le semis garde l'abondance.
  { slug: 'ferme_ruinee', zones: ['pres_bas'], name: 'la Ferme ruinée', family: 'shelter', biomes: [GRASS, FLOWER, HEATH], weight: 3, cap: 2, reserve: 2, footprint: 18, pres: 'eau' },
  { slug: 'charrette', zones: ['pres_bas'], name: 'la Charrette abandonnée', family: 'shelter', biomes: [GRASS, FLOWER, HEATH, FOREST, CLAIRIERE], weight: 3, cap: 3, reserve: 1, footprint: 3, pres: 'route' },
  // ═══ LES SET-PIECES — des lieux HORS SEMIS (spec t0-exploration R9-R10) ═══
  // `biomes: []` : jamais éligibles au tirage — ils se posent en passe dédiée du worldgen
  // (`zonegen-setpieces.ts`), leur corps est leur TERRAIN. Ils figurent ici pour que la garde
  // A19 (« chaque type naît vraiment ») les couvre, et que `poiFamily` sache répondre (le
  // garde-fou des charges exige la famille reward pour le Cercle, qui porte un récit).
  { slug: 'bois_noir', zones: ['pres_bas'], name: 'le Bois Noir', family: 'eco', biomes: [], weight: 0, cap: 1, unique: true, footprint: 40 },
  { slug: 'cercle_pierres', zones: ['pres_bas'], name: 'le Cercle de pierres', family: 'reward', biomes: [], weight: 0, cap: 1, unique: true, footprint: 24 },
  { slug: 'combe_brumeuse', zones: ['pres_bas'], name: 'la Combe brumeuse', family: 'eco', biomes: [], weight: 0, cap: 1, unique: true, footprint: 32 },
  { slug: 'cairn', name: 'le Cairn', family: 'reward', biomes: [GRASS, AL_MEADOW, HEATH, SCREE, ROCK, FLOWER, AL_FLOWERS, FOREST, PINE, CLAIRIERE], weight: 12, cap: 14, reserve: 1, footprint: 1 },
  { slug: 'sanctuaire', zones: ['aiguilles', 'alpages', 'karst'], name: 'le Sanctuaire', family: 'reward', biomes: [SCREE, ROCK, AL_MEADOW], minElev: 0.7, weight: 1, cap: 2, reserve: 1, footprint: 2 },
  { slug: 'source_chaude', zones: ['alpages', 'karst'], name: 'la Source chaude', family: 'reward', biomes: [SCREE, ROCK, AL_MEADOW], minElev: 0.55, weight: 2, cap: 2, reserve: 1, footprint: 2 },
  { slug: 'arche', zones: ['aiguilles', 'karst'], name: "l'Arche de roche", family: 'reward', biomes: [ROCK, SCREE], weight: 2, cap: 2, reserve: 1, footprint: 2 },
  { slug: 'tarn', zones: ['alpages', 'glacier'], name: 'le Tarn', family: 'reward', biomes: [AL_MEADOW, SCREE, AL_FLOWERS], minElev: 0.45, weight: 3, cap: 3, reserve: 1, footprint: 3 },
  { slug: 'petroglyphes', zones: ['karst', 'gouffre', 'aiguilles'], name: 'les Pétroglyphes', family: 'reward', biomes: [ROCK, SCREE], minElev: 0.55, weight: 2, cap: 2, reserve: 1, footprint: 2 },
]

/**
 * L'HÉRITAGE D'ÉLIGIBILITÉ (spec t0-exploration §2ter, 2026-08-15) : les mots neufs du pré
 * sont des ÉTAGES du même thème, pas des biomes étrangers — un lieu qui acceptait l'herbe
 * accepte ses héritiers (la prairie humide, la lande à genévriers), un lieu qui acceptait le
 * bosquet accepte la saulaie. Déclaré ICI, en un point, pour que le repeint du vocabulaire
 * n'APPAUVRISSE jamais le semis (mesuré sans cette règle : 134 → 132 lieux sur la seed de
 * production) — et pour qu'un futur lieu l'obtienne sans y penser. Hors T0, c'est un no-op :
 * ces terrains n'existent nulle part ailleurs.
 */
for (const t of POI_TYPES) {
  if (t.biomes.includes(GRASS)) t.biomes.push(WET_MEADOW, JUNIPER)
  if (t.biomes.includes(FOREST)) t.biomes.push(WILLOW)
}

/**
 * Empreinte qu'aurait la Zone d'un type de POI centrée sur (tx,ty) — même calcul
 * (`Math.floor(footprint / 2)`) que celui utilisé plus bas par `placePois` pour
 * poser la Zone réellement : les deux doivent rester en accord. Clampée à la
 * carte (revue « les lieux », Minor « clamp zones aux bords ») : un point proche
 * d'un bord peut recevoir une empreinte qui déborde en négatif ou au-delà de
 * `width`/`height` — une tuile hors carte n'est ni lisible (`terrainAt` la
 * traite en void) ni creusable, et une Zone non clampée fuit dans les boucles
 * qui balayent `[z.x, z.x+z.w)` (rendu, `poisAt`…).
 */
function footprintAt(map: WorldMap, t: PoiType, tx: number, ty: number): Pick<Zone, 'x' | 'y' | 'w' | 'h'> {
  const half = Math.floor(t.footprint / 2)
  return clampFootprint(map, { x: tx - half, y: ty - half, w: t.footprint, h: t.footprint })
}

/** Clampe un rectangle d'empreinte aux limites de la carte [0,width) × [0,height). */
function clampFootprint(map: WorldMap, z: Pick<Zone, 'x' | 'y' | 'w' | 'h'>): Pick<Zone, 'x' | 'y' | 'w' | 'h'> {
  const x0 = Math.max(0, z.x)
  const y0 = Math.max(0, z.y)
  const x1 = Math.min(map.width, z.x + z.w)
  const y1 = Math.min(map.height, z.y + z.h)
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

/**
 * L'empreinte TOUCHE-T-ELLE l'anneau de bordure ? Alors le lieu n'a rien à faire
 * là : `footprintAt` clampe à la carte, donc un point de semis tiré près du bord
 * reçoit une empreinte rognée qui mord sur le mur scellé. Mesuré : sept lieux sur
 * cinq seeds (dont deux Mines et un Repaire) naissaient à cheval sur l'enceinte —
 * moitié dans le monde, moitié dans un mur qu'on ne perce jamais. On les écarte,
 * on ne les rafistole pas.
 */
function touchesBorderRing(map: WorldMap, z: Pick<Zone, 'x' | 'y' | 'w' | 'h'>): boolean {
  return z.x <= 0 || z.y <= 0 || z.x + z.w >= map.width || z.y + z.h >= map.height
}

/**
 * LA TUILE D'ENTRÉE — celle de l'empreinte qui coûte le moins cher à relier au
 * monde, et `undefined` si aucune ne tient dans le budget (cf.
 * `POI_PLACEMENT.MAX_CARVE_TILES`). Départage par balayage row-major : le premier
 * minimum rencontré gagne — déterministe, aucun aléa requis.
 */
function entryTile(
  map: WorldMap, field: CarveField, z: Pick<Zone, 'x' | 'y' | 'w' | 'h'>,
): { index: number; cost: number } | undefined {
  // L'ENTRÉE DOIT MENER AU CŒUR (2026-08-11). À empreinte 7, le carré d'une île de roche
  // enjambe son anneau d'eau et TOUCHE la rive : la rive (dist 0) devenait tuile d'entrée
  // d'un lieu dont le cœur reste inaccessible — la Mine naissait sur l'île, à cheval sur
  // le lac. On n'accepte donc que les tuiles d'entrée RELIÉES au centre de l'empreinte
  // sans franchir une tuile scellée (l'eau, la bordure — la même loi que le creusement :
  // la roche se perce, l'eau jamais). Flood 4-connexe borné à l'empreinte : ≤ 49 tuiles.
  const scellee = (tx: number, ty: number): boolean =>
    tx <= 0 || ty <= 0 || tx >= map.width - 1 || ty >= map.height - 1 || isWater(map.terrain[ty * map.width + tx] ?? 0)
  const cx = z.x + Math.floor(z.w / 2)
  const cy = z.y + Math.floor(z.h / 2)
  const relie = new Set<number>()
  if (!scellee(cx, cy)) {
    const file: number[] = [cy * map.width + cx]
    relie.add(file[0]!)
    let tete = 0
    while (tete < file.length) {
      const k = file[tete]!
      tete += 1
      const kx = k % map.width
      const ky = Math.floor(k / map.width)
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = kx + dx
        const ny = ky + dy
        if (nx < z.x || ny < z.y || nx >= z.x + z.w || ny >= z.y + z.h) continue
        const nk = ny * map.width + nx
        if (relie.has(nk) || scellee(nx, ny)) continue
        relie.add(nk)
        file.push(nk)
      }
    }
  }
  let best: { index: number; cost: number } | undefined
  for (let ty = z.y; ty < z.y + z.h; ty++) {
    for (let tx = z.x; tx < z.x + z.w; tx++) {
      const i = ty * map.width + tx
      if (!relie.has(i)) continue // séparée du cœur (une île dans l'empreinte)
      const d = field.dist[i]!
      if (d > field.limit) continue // hors d'atteinte, ou séparé par de l'eau
      if (best === undefined || d < best.cost) best = { index: i, cost: d }
    }
  }
  return best
}

/**
 * Types valides pour la tuile : biome, altitude, plafond — ET **le lieu s'ouvre
 * sur le monde**.
 *
 * Ce dernier critère est le correctif du 2026-07-13. Il remplace l'ancien
 * (« l'empreinte contient une tuile marchable, ou peut en recevoir une »), qui
 * était vrai et insuffisant : une tuile marchable au cœur d'un massif de roche
 * reste une tuile où nul ne va. On ne demande donc plus au lieu d'avoir un SOL,
 * on lui demande d'avoir un SEUIL — cf. `POI_PLACEMENT.MAX_CARVE_TILES` pour la
 * mesure qui a fixé la règle.
 */
/**
 * OÙ EST-ON ? — le slug de la zone d'une tuile, ou `undefined` sur une carte sans zones.
 *
 * C'est le SEUL lien entre les lieux et le graphe de zones, et il est volontairement mince : un
 * accesseur, pas une dépendance. `poi.ts` ne connaît toujours pas `zonegraph.ts` — il reçoit une
 * fonction, et il s'en sert si elle existe. L'ancienne carte (qui n'a pas de zones) continue donc
 * de poser ses lieux exactement comme avant, sans une ligne de branche.
 */
export type ZoneLookup = (tx: number, ty: number) => string | undefined

function isEligible(
  map: WorldMap,
  field: CarveField,
  t: PoiType,
  tx: number,
  ty: number,
  used: Map<string, number>,
  zoneDe?: ZoneLookup,
): boolean {
  const terr = terrainAt(map, tx, ty)
  if (!t.biomes.includes(terr)) return false

  // LA ZONE donne son ADRESSE au lieu : la Grotte au Karst, le Champ de crevasses au Glacier,
  // l'Arbre remarquable dans la Vieille Sylve. La carte étant plate, il n'y a plus d'altitude à
  // filtrer — la zone est le seul critère de placement (les `minElev`/`maxElev` de la table sont
  // des vestiges de l'ancien champ d'altitude continu, désormais ignorés).
  //
  // Un lieu SANS `zones` reste libre d'apparaître partout où son biome le porte : c'est le cas du
  // Cairn, et c'est voulu — les cairns sont les jalons de TOUTE la vallée, et c'est leur métier de
  // se suivre de proche en proche.
  if (t.zones && zoneDe) {
    const z = zoneDe(tx, ty)
    if (z === undefined || !t.zones.includes(z)) return false
  }
  if ((used.get(t.slug) ?? 0) >= capFor(map, t)) return false // le plafond suit la SURFACE
  // LA RAISON D'ÊTRE d'un lieu humain (S-R14) : la ferme exige son eau, la charrette sa route.
  if (t.pres !== undefined && !aProximite(map, tx, ty, t.pres)) return false
  const fp = footprintAt(map, t, tx, ty)
  if (touchesBorderRing(map, fp)) return false
  // AUCUN LIEU À CHEVAL SUR UNE SENTE (spec t0-exploration R18) : un lieu se poste AU BORD du
  // chemin, pas dessus — et un Verger coupé par la route perdrait ses baies (sa garde A29 le
  // compterait). L'empreinte entière doit être libre de route.
  for (let y = fp.y; y < fp.y + fp.h; y++) {
    for (let x = fp.x; x < fp.x + fp.w; x++) {
      if (terrainAt(map, x, y) === TERRAIN_ROAD) return false
    }
  }
  return entryTile(map, field, fp) !== undefined
}

/** Y a-t-il de l'eau (toute eau : `isWater`) ou une route à portée de (tx,ty) ? — le
 *  prédicat de `pres`. */
function aProximite(map: WorldMap, tx: number, ty: number, quoi: 'eau' | 'route'): boolean {
  const r = PRES_RAYON
  const y0 = Math.max(0, ty - r)
  const y1 = Math.min(map.height - 1, ty + r)
  const x0 = Math.max(0, tx - r)
  const x1 = Math.min(map.width - 1, tx + r)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const t = map.terrain[y * map.width + x]!
      if (quoi === 'route' ? t === TERRAIN_ROAD : isWater(t)) return true
    }
  }
  return false
}

/**
 * LE POINT EST-IL TROP PRÈS D'UN LIEU DÉJÀ ENREGISTRÉ ? (spec t0-exploration R10.)
 *
 * Les set-pieces se posent AVANT le semis, hors Poisson — sans cette garde, un Cairn pouvait
 * naître au milieu du Cercle de pierres. Elle protège aussi, gratuitement, contre un point de
 * semis qui tomberait près d'un lieu posé par le FILET de réservation (lui aussi hors Poisson).
 */
function tropPres(map: WorldMap, tx: number, ty: number, radius: number): boolean {
  const r2 = radius * radius
  return map.zones.some((z) => z.kind !== undefined && distSq(tx, ty, z.x + z.w / 2, z.y + z.h / 2) < r2)
}

function candidatesFor(
  map: WorldMap, field: CarveField, tx: number, ty: number, used: Map<string, number>, zoneDe?: ZoneLookup,
): PoiType[] {
  // `horsSemis` D'ABORD, et pas seulement par économie : le tirage pondéré retombe sur
  // `cands[cands.length - 1]` quand la somme des poids ne couvre pas le tirage, donc un type de
  // poids 0 laissé dans la liste FINIRAIT par être choisi. Le drapeau doit l'écarter ici, à la
  // source — une garde le vérifie sur toute la table.
  return POI_TYPES.filter((t) => t.horsSemis !== true && isEligible(map, field, t, tx, ty, used, zoneDe))
}

/**
 * Pose le lieu : la Zone, son nom numéroté, et **le percement de son seuil** —
 * la file des tuiles bloquantes qui le séparent encore du monde, remontée par
 * `field.parent` depuis sa tuile d'entrée. Chacune devient de l'éboulis : la
 * Grotte perce sa porte, le Belvédère sa vire, la Source chaude sa margelle.
 *
 * `isEligible` a déjà garanti que ce seuil tient dans le budget — `entryTile` ne
 * peut donc rendre `undefined` qu'en théorie (défense en profondeur).
 *
 * NOTE D'ORDRE : le champ de creusement est calculé UNE fois, avant toute pose.
 * Percer un seuil ne le met pas à jour — et c'est voulu : les lieux sont espacés
 * d'au moins 96 tuiles, la porte de l'un n'ouvre jamais le seuil de l'autre. Un
 * champ figé est donc exact ici, et il épargne au générateur de tout recalculer
 * quatre-vingts fois.
 */
/** Les terrains BOISÉS — l'essart n'existe que là où le dégagement a mangé du bois. */
const BOISE: readonly number[] = [TERRAIN_FOREST, TERRAIN_OLD_GROWTH, TERRAIN_PINE, TERRAIN_LARCH]

/** La portée, en tuiles, à laquelle une mine « suit la pierre » (annales `taille`). */
const TAILLE_PORTEE = 24

/** La ressource de l'affleurement le plus proche à portée — ou `undefined`. Distance au rect
 *  (Chebyshev au bord), départage par ordre de table : déterministe, et O(affleurements) sur
 *  une liste qui se compte en dizaines. */
function affleurementProche(map: WorldMap, cx: number, cy: number): 'fer' | 'charbon' | undefined {
  let best: 'fer' | 'charbon' | undefined
  let bestD = TAILLE_PORTEE + 1
  for (const a of map.affleurements ?? []) {
    const dx = cx < a.x ? a.x - cx : cx > a.x + a.w - 1 ? cx - (a.x + a.w - 1) : 0
    const dy = cy < a.y ? a.y - cy : cy > a.y + a.h - 1 ? cy - (a.y + a.h - 1) : 0
    const d = dx > dy ? dx : dy
    if (d < bestD) { bestD = d; best = a.ressource }
  }
  return best
}

function placeOne(
  map: WorldMap, field: CarveField, t: PoiType, tx: number, ty: number, used: Map<string, number>,
): void {
  const count = (used.get(t.slug) ?? 0) + 1
  used.set(t.slug, count)
  const z = footprintAt(map, t, tx, ty)
  // LE NOM DIT LE SORT (spec stratigraphie S-R19) : un lieu bâti est nommé d'après ce que la
  // Cendre et les routes ont fait de lui — dérivé, jamais tiré. Le champ de cendre est posé
  // avant tout POI (zonegen passe 4), le sort est donc lisible ici.
  const sort = sortDuLieu(map, z.x, z.y, z.w, z.h)
  const nom = nomSelonSort(t.slug, t.name, sort)
  map.zones.push({ name: `${nom} ${roman(count)}`, ...z, kind: t.slug })
  // ═══ LES ANNALES (S-R16, vocabulaire élargi : spec `annales.md` R2) ═══
  //
  // Chaque fait DÉRIVE de ce que cette passe sait déjà — jamais d'une simulation, jamais d'un
  // tirage : les émissions ne touchent pas le PRNG, le monde hors annales reste au bit près
  // celui d'avant (A3). Le livrable réel est la JUXTAPOSITION de faits vrais : `guet` + un
  // sort `brule` = « ils ont vu venir, et sont restés » — personne n'écrit cette phrase,
  // elle tombe du croisement.
  {
    const cx = Math.floor(z.x + z.w / 2)
    const cy = Math.floor(z.y + z.h / 2)
    const annales = (map.annales ??= [])
    const fait = (f: Omit<FaitDeGeneration, 'x' | 'y' | 'lieu'>): void => {
      annales.push({ ...f, x: cx, y: cy, lieu: t.slug })
    }

    // Un lieu HUMAIN écrit sa fondation (et sa raison), puis ce que la Cendre en a fait.
    // Les lieux naturels n'ont pas d'état civil — un tarn ne se fonde pas.
    if (t.pres !== undefined || BUILT_KINDS.includes(t.slug)) {
      fait({ ere: 1, type: 'fondation', ...(t.pres ? { cause: t.pres } : {}) })
      fait({ ere: 3, type: 'sort', cause: sort })
      // L'ESSART : le dégagement du lieu a mangé du BOIS — en pré il n'a rien mangé, donc pas
      // de fait (et c'est ce qui le garde RARE : les fermes vivent en herbe, seuls les lieux
      // plantés en forêt essartent — la saillance R4 aime les faits nés clairsemés).
      if (BOISE.includes(terrainAt(map, cx, cy))) fait({ ere: 1, type: 'essart' })
    }

    // LA GRAVURE (ère 0) : une écriture plus vieille que les routes. Les pierres ne desservent
    // rien, elles POINTENT (la chaîne `PIERRES_KINDS`) — le fait donne au lecteur le droit de
    // le dire sans jamais dire QUI gravait (bible I2).
    if (t.slug === 'pierre_levee' || t.slug === 'cercle_pierres' || t.slug === 'petroglyphes') {
      fait({ ere: 0, type: 'gravure' })
    }

    // LE GUET : la Tour regarde VERS la Cendrière — « ils guettaient le sud », donc ils
    // SAVAIENT. Absent sur une carte sans Cendrière (un banc ne guette rien, R3).
    if (t.slug === 'tour_guet') {
      const dir = directionCendriere(map, cx, cy)
      if (dir !== undefined) fait({ ere: 1, type: 'guet', cause: dir })
    }

    // LA FUITE : la charrette tourne le DOS à la Cendrière — l'exode a un sens, qu'on peut
    // suivre de charrette en charrette.
    if (t.slug === 'charrette') {
      const dir = directionCendriere(map, cx, cy)
      if (dir !== undefined) fait({ ere: 3, type: 'fuite', cause: directionOpposee(dir) })
    }

    // LA FOSSE : où la vallée a enterré. La hantise nocturne penche du même côté PAR
    // CONSTRUCTION (`morts.ts` : le semis des charniers et l'intensité de la nuit lisent le
    // même champ) — l'inférence du joueur sera donc VRAIE, et c'est toute la valeur du fait.
    if (t.slug === 'charnier') fait({ ere: 3, type: 'fosse' })

    // LA TAILLE : la mine est où elle est parce que la roche AFFLEURE. Dérivé d'une simple
    // portée au rect d'affleurement le plus proche — « suis la pierre » devient une règle de
    // prospection que les morts enseignent.
    if (t.slug === 'mine' || t.slug === 'carriere' || t.slug === 'gisement') {
      const res = affleurementProche(map, cx, cy)
      if (res !== undefined) fait({ ere: 1, type: 'taille', cause: res })
    }
  }

  const entry = entryTile(map, field, z)
  if (entry === undefined || entry.cost === 0) return // déjà de plain-pied sur le monde

  // Du seuil vers le monde, en suivant le chemin que le champ a mémorisé. On
  // s'arrête à `dist === 0` — c'est-à-dire au monde — et NON à la première tuile
  // marchable rencontrée : le chemin peut très bien traverser une POCHE (des
  // tuiles marchables, mais murées elles aussi) avant de retomber sur la roche
  // qui la sépare encore du monde. S'arrêter là rouvrirait le lieu sur la poche,
  // et la poche sur rien.
  for (let i = entry.index; i !== -1 && field.dist[i]! > 0; i = field.parent[i]!) {
    const ex = i % map.width
    const ey = (i / map.width) | 0
    if (isBlockingTile(map, ex, ey)) setTile(map, ex, ey, TERRAIN_SCREE)
  }
}

/**
 * LA RÉSERVATION (décision d'Alexis, 2026-07-11) — les lieux chargés ne jouent
 * plus à la loterie.
 *
 * Un lieu dont une mécanique dépend ne peut pas se permettre de ne pas exister.
 * Or le tirage pondéré est à **somme nulle** : le semis borne le nombre total de
 * lieux (~66 points pour une somme de plafonds de ~107), donc chaque lieu tiré
 * en prive un autre. Mesuré sur la seed du jeu : le Belvédère avait **10 points
 * éligibles** et sortait pourtant **zéro fois**, écrasé par le Cairn (poids 12,
 * éligible dans neuf biomes) ; et monter son poids ne faisait qu'affamer l'Arche.
 * Un jeu de taupes.
 *
 * D'où : chaque type à `reserve` prend d'abord ses exemplaires garantis, AVANT
 * que le tirage général ne consomme les points. Le reste du semis se joue comme
 * avant — la réservation garantit l'existence, elle ne fixe pas l'abondance.
 *
 * Neutralité spatiale : on sert dans l'ordre de `pts`, qui est DÉJÀ mélangé
 * (Fisher-Yates déterministe, cf. `shuffled`) — donc « le premier point éligible »
 * n'est pas « le point le plus proche de pts[0] ». Le correctif de biais du
 * 2026-07-09 tient, et son test le vérifie.
 *
 * Retourne les INDEX des points consommés, que le tirage général doit sauter.
 */
function reserveCharged(
  map: WorldMap,
  field: CarveField,
  pts: readonly { x: number; y: number }[],
  used: Map<string, number>,
  seed: number,
  radius: number,
  zoneDe?: ZoneLookup,
): Set<number> {
  const taken = new Set<number>()
  // Ordre déterministe : celui de POI_TYPES. Les premiers servis ont priorité
  // sur les points contestés — c'est la table qui arbitre, pas le hasard.
  for (const t of POI_TYPES) {
    if (t.horsSemis === true) continue // il a son propre semis : il ne réserve rien ici
    const want = Math.min(t.reserve ?? 0, capFor(map, t))
    let got = 0
    for (let i = 0; i < pts.length && got < want; i++) {
      if (taken.has(i)) continue
      const p = pts[i]!
      const tx = Math.floor(p.x)
      const ty = Math.floor(p.y)
      if (tropPres(map, tx, ty, radius)) continue // un set-piece a déjà pris ce coin
      if (!isEligible(map, field, t, tx, ty, used, zoneDe)) continue
      placeOne(map, field, t, tx, ty, used)
      taken.add(i)
      got += 1
    }
    // LE FILET — si le SEMIS n'avait aucun point pour lui, on lui en trouve un.
    while (got < want && placeReserveAnywhere(map, field, t, used, seed, radius, zoneDe)) got += 1
  }
  return taken
}

/**
 * LE FILET DE LA RÉSERVATION — le dernier trou de la promesse, bouché.
 *
 * `reserve` dit : « ce lieu porte une mécanique, il ne peut pas se permettre de ne
 * pas exister » (décision d'Alexis, 2026-07-11). Mais la réservation ne cherchait
 * son point que **dans le semis de Poisson** — soixante-six points sur toute la
 * carte. Un lieu dont le biome est rare pouvait donc perdre une DEUXIÈME loterie :
 * non plus celle du tirage pondéré (celle-là était réglée), mais celle du semis.
 * Vu en direct : l'Arbre remarquable (seul biome possible : la vieille forêt) ne
 * sortait sur aucune carte de la seed 7 — pas faute de vieille forêt, mais faute
 * qu'un des soixante-six points y tombe.
 *
 * On balaie donc la carte à gros pas, on récolte toutes les tuiles où ce lieu
 * pourrait naître **en respectant l'espacement du semis** (sinon il s'agglutinerait
 * contre un voisin), et on en tire une au sort. Déterministe (hash2), spatialement
 * neutre (le tirage porte sur la liste entière, pas sur le premier trouvé — un
 * balayage row-major aurait toujours choisi le coin nord-ouest).
 *
 * Ce n'est PAS un chemin dégradé : c'est ce que « réserver » veut dire. Le semis
 * décide de l'abondance ; la réservation décide de l'existence.
 */
function placeReserveAnywhere(
  map: WorldMap,
  field: CarveField,
  t: PoiType,
  used: Map<string, number>,
  seed: number,
  radius: number,
  zoneDe?: ZoneLookup,
): boolean {
  const step = Math.max(4, Math.round(radius / 4)) // assez fin pour trouver, assez gros pour rester bon marché
  const r2 = radius * radius
  const libres: number[] = []
  for (let ty = step; ty < map.height - step; ty += step) {
    for (let tx = step; tx < map.width - step; tx += step) {
      if (!isEligible(map, field, t, tx, ty, used, zoneDe)) continue
      // L'espacement du semis vaut aussi pour lui : un lieu réservé n'a pas le
      // droit de se coller à un autre (une garde le vérifie).
      let libre = true
      for (const z of map.zones) {
        if (z.kind === undefined) continue
        if (distSq(tx, ty, z.x + z.w / 2, z.y + z.h / 2) < r2) { libre = false; break }
      }
      if (libre) libres.push(ty * map.width + tx)
    }
  }
  if (libres.length === 0) return false // la carte ne peut vraiment pas le porter
  const k = Math.min(libres.length - 1, Math.floor(hash2(t.cap, seed ^ 0x52535620, 0x9f) * libres.length))
  const i = libres[k]!
  placeOne(map, field, t, i % map.width, (i / map.width) | 0, used)
  return true
}

/**
 * Mélange Fisher-Yates déterministe (pur : hash2, pas de Math.random).
 *
 * Indispensable ici : `poissonPoints` renvoie ses points dans l'ORDRE D'ACCEPTATION,
 * c'est-à-dire une vague de croissance partant de `pts[0]`. Comme `placePois` consomme
 * des plafonds durs au fil de l'itération, les points proches de `pts[0]` épuisaient les
 * quotas et les points atteints tard restaient sans POI — un gradient de densité orienté
 * vers `pts[0]` (mesuré : 54 POIs au nord contre 31 au sud sur la seed 2026). Les positions
 * du semis, elles, n'ont jamais été biaisées ; seul leur ordre l'était.
 */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(hash2(i, seed, 0x53484655) * (i + 1))) // salt 'SHFU'
    const tmp = out[i]!
    out[i] = out[j]!
    out[j] = tmp
  }
  return out
}

/**
 * L'ESPACEMENT DU SEMIS sur cette carte — absolu, sauf sur les petites cartes où il
 * se borne à une fraction du petit côté (sinon elles n'auraient aucun lieu). À la
 * taille du jeu, les deux règles donnent le même nombre : 96.
 */
export function poiSpacing(width: number, height: number): number {
  return Math.min(POI_PLACEMENT.SPACING_TILES, POI_PLACEMENT.SPACING_MAX_FRAC * Math.min(width, height))
}

/**
 * LES NIDS À MONSTRE RÉSIDENT (worldgen R17bis) — les rectangles des lieux dont le type
 * porte `monster` (tanière, repaire). DÉRIVÉ de la table : un type de nid ajouté demain est
 * couvert d'office, sans liste de slugs à la main. Consommé par `emplacementsDeVillage`
 * (via `DangersDePlacement`) : on ne fonde pas un village au seuil d'un nid.
 */
export function nidsAMonstre(map: WorldMap): { x: number; y: number; w: number; h: number }[] {
  const kinds = new Set(POI_TYPES.filter((t) => t.monster !== undefined).map((t) => t.slug))
  return map.zones.filter((z) => z.kind !== undefined && kinds.has(z.kind)).map((z) => ({ x: z.x, y: z.y, w: z.w, h: z.h }))
}

/**
 * Le plafond EFFECTIF d'un type sur cette carte — le plafond de la table, mis à
 * l'échelle de la surface. Voir `CAP_REFERENCE_AREA` : la rareté est une densité,
 * pas un compte. Jamais moins d'un exemplaire si la table en prévoyait au moins un.
 */
export function capFor(map: WorldMap, t: PoiType): number {
  const k = (map.width * map.height) / POI_PLACEMENT.CAP_REFERENCE_AREA
  // LE PLAFOND CROÎT AVEC LA CARTE, IL NE RÉTRÉCIT JAMAIS. Une vallée deux fois plus
  // grande porte deux fois plus de Cairns ; une vallée deux fois plus PETITE garde
  // les siens. (Sans ce `max`, une carte de test de 240×360 — soit 4 % de la surface
  // de référence — voyait TOUS ses plafonds tomber à 1 : vingt-six lieux au total,
  // dont onze pris par les réservations. La carte se vidait, et les tests le disaient.)
  // Un lieu UNIQUE ne se multiplie pas avec la carte : son plafond est son plafond.
  if (t.unique === true) return t.cap
  return Math.max(t.cap, Math.round(t.cap * k))
}

/**
 * LE SEMIS, ET SON RYTHME. Poisson espace les points d'au moins `SPACING_TILES` —
 * une régularité parfaite, et c'est bien le défaut : on n'explore pas un papier
 * peint. Un champ basse fréquence abandonne donc les points qui tombent dans ses
 * creux : il reste des GRAPPES (« il y a quelque chose dans ce coin ») et des VIDES
 * (« il n'y a rien, et ce rien se traverse »). L'espacement minimal est intact — on
 * ne fait que renoncer à des points, jamais en rapprocher.
 */
export function poiSemis(width: number, height: number, seed: number): { x: number; y: number }[] {
  const bruts = poissonPoints(width, height, seed, poiSpacing(width, height))
  // Mélangé : les plafonds doivent se consommer dans un ordre SPATIALEMENT NEUTRE (cf. `shuffled`).
  return shuffled(bruts, seed)
}

/**
 * Pose les POIs comme Zones nommées dans map.zones (pur, déterministe).
 *
 * REND SON CHAMP DE CREUSEMENT — la passe des charniers a besoin du même, et le recalculer
 * coûtait **2,5 s** sur la carte de production (MESURÉ : génération de 4,8 s passée à 7,4 s ;
 * un test de la Veillée dépassait son budget de 30 s). C'est un balayage de 3,75 M tuiles, deux
 * fois, pour la même réponse.
 */
export function placePois(map: WorldMap, seed: number, zoneDe?: ZoneLookup): CarveField {
  const radius = poiSpacing(map.width, map.height)
  const pts = poiSemis(map.width, map.height, seed)
  const used = new Map<string, number>()

  // CE QUI COMMUNIQUE AVEC QUOI — calculé une fois, pour toute la carte. Sans ce
  // champ, un lieu peut naître dans une poche marchable au cœur d'un massif : des
  // tuiles parfaitement praticables où nul n'ira jamais. Voir
  // `POI_PLACEMENT.MAX_CARVE_TILES`.
  const field = carveDistanceToMain(map, walkableComponents(map), POI_PLACEMENT.MAX_CARVE_TILES)

  // D'ABORD les lieux chargés : ils réservent leur point (voir `reserveCharged`).
  const taken = reserveCharged(map, field, pts, used, seed, radius, zoneDe)

  // PUIS le tirage général, sur ce qui reste du semis.
  for (let i = 0; i < pts.length; i++) {
    if (taken.has(i)) continue // point déjà pris par une réservation
    const p = pts[i]!
    const tx = Math.floor(p.x)
    const ty = Math.floor(p.y)
    if (tropPres(map, tx, ty, radius)) continue // un set-piece (ou un filet) a déjà pris ce coin
    const cands = candidatesFor(map, field, tx, ty, used, zoneDe)
    if (cands.length === 0) continue // biome sans POI valide → point sauvage (l'entre-deux)
    // Tirage pondéré déterministe.
    const total = cands.reduce((s, t) => s + t.weight, 0)
    let r = hash2(tx, ty, seed ^ 0x504f49) * total
    let picked = cands[cands.length - 1]!
    for (const t of cands) {
      if (r < t.weight) { picked = t; break }
      r -= t.weight
    }
    placeOne(map, field, picked, tx, ty, used)
  }
  return field
}

/**
 * LES CHARNIERS — « là où la densité culmine, on pose un lieu visible » (spec `cendreux.md` R20),
 * mais posé PARTOUT, en penchant vers les pics (décision d'Alexis, 2026-07-31 : *« une
 * distribution logique, mais en mettre un peu partout quand même »*).
 *
 * ═══ POURQUOI UNE PASSE À PART, ET PAS UNE LIGNE DE PLUS DANS LA TABLE ═══
 *
 * La loterie des lieux est adressée par ZONE et à SOMME NULLE. Un charnier adressé au tier 2 y
 * aurait été juste — MESURÉ, il n'aurait pourtant existé QUE dans la Cendrière à portée du joueur
 * (513 pas de marche), les cinq autres zones de tier 2 étant à 2 166-3 360 pas. Et adressé
 * partout, il aurait affamé les vingt-six autres types. Son adresse n'est ni une zone ni un
 * biome : c'est une DENSITÉ, celle-là même que la nuit lit pour savoir combien de morts dorment
 * ici. D'où un semis à lui, comme `placeHuntingGrounds` en a un.
 *
 * ═══ UN QUOTA PAR ZONE, ET NON UN TIRAGE PAR POINT (R16) ═══
 *
 * La première version acceptait chaque point avec une probabilité égale à sa densité. C'était
 * juste en espérance et FAUX en pratique — MESURÉ sur la seed du jeu : les Prés Bas ne recevaient
 * **aucun charnier**. Leurs quatorze points de semis étaient tous éligibles (plain-pied, bon
 * biome, loin de tout lieu) ; ils avaient simplement tous raté un tirage à 0,25, ce qui arrive
 * une fois sur cinquante-cinq. Zéro charnier là où le joueur habite, c'est l'interrupteur
 * déguisé que R16 interdit — et la quatrième fois que la géographie rend le jeu muet chez soi.
 *
 * Le quota le rend impossible PAR CONSTRUCTION plutôt que par chance : chaque zone reçoit
 * `somme des densités de ses points`, arrondi, avec un **plancher de `CHARNIER_MIN_PAR_ZONE`**.
 * C'est exactement `rodeursPortes` (plafond × densité, borné par `MIN_RODEURS`) transposé au
 * placement — la même idée, appliquée au même champ, une fois de plus.
 *
 * Le quota répare aussi le silence des rejets : un point écarté (route, biome, empreinte d'un
 * autre lieu) ne consomme plus le quota, on descend la liste. Une zone difficile reçoit donc
 * autant qu'une zone facile, ce qui est le sens du mot.
 *
 * ═══ PUR, ET SANS FLUX ═══
 *
 * Aucun tirage n'est consommé : le mélange (`shuffled`) est un Fisher-Yates déterministe, et
 * c'est lui qui décide QUELS points d'une zone servent — spatialement neutre, reproductible.
 * Deux cartes de même seed portent les mêmes charniers.
 *
 * ═══ ET UNE CARTE SANS ZONES GARDE SON COMPORTEMENT (R17) ═══
 *
 * `zoneDe` absent, tout tombe dans un groupe unique de densité plancher : la carte reçoit son
 * quota uniforme, sans géographie. Même précédent que `zoneTierAt` qui rend 0.
 *
 * ═══ IL NE PERCE RIEN ═══
 *
 * Contrairement aux lieux du semis, un charnier exige d'être DE PLAIN-PIED sur le monde
 * (`field.dist === 0`) au lieu de percer son seuil : une fosse n'a pas de porte, et surtout la
 * passe ne doit modifier AUCUNE tuile — la carte reste bit à bit celle d'avant, en dehors des
 * zones ajoutées. C'est ce qui rend la garde de non-régression possible.
 */
export function placeCharniers(
  map: WorldMap,
  seed: number,
  densite: (tx: number, ty: number) => number,
  zoneDe?: ZoneLookup,
  champ?: CarveField,
): void {
  const t = POI_TYPES.find((p) => p.slug === 'charnier')
  if (!t) return
  // LE CHAMP DE `placePois`, quand il nous est passé — le recalculer coûtait 2,5 s pour la même
  // réponse. Il est ANTÉRIEUR aux percements de la passe précédente, exactement comme lui-même
  // l'est aux siens (voir la note d'ordre de `placeOne`) : un charnier ne se posera donc jamais
  // sur le seuil qu'une Grotte vient d'ouvrir, ce qui est la lecture prudente et la bonne.
  const field = champ ?? carveDistanceToMain(map, walkableComponents(map), POI_PLACEMENT.MAX_CARVE_TILES)
  const pts = shuffled(poissonPoints(map.width, map.height, seed ^ 0x43484152 /* 'CHAR' */, MORTS.CHARNIER_ESPACEMENT), seed)

  // UN GROUPE PAR ZONE. L'ordre d'insertion d'une Map suit celui de `pts`, déjà mélangé de façon
  // déterministe : l'ordre des groupes ne dépend donc ni du hasard, ni de la géométrie.
  const groupes = new Map<string, { x: number; y: number }[]>()
  for (const p of pts) {
    const cle = zoneDe?.(Math.floor(p.x), Math.floor(p.y)) ?? ''
    const g = groupes.get(cle)
    if (g) g.push(p)
    else groupes.set(cle, [p])
  }

  const used = new Map<string, number>()
  for (const groupe of groupes.values()) {
    // LE QUOTA — la somme des densités, pas la moyenne fois le compte : si le champ gagne un jour
    // un terme qui varie DANS une zone, la formule tient toujours.
    let somme = 0
    for (const p of groupe) somme += densite(Math.floor(p.x), Math.floor(p.y))
    const quota = Math.max(MORTS.CHARNIER_MIN_PAR_ZONE, Math.round(somme))

    let poses = 0
    for (const p of groupe) {
      if (poses >= quota) break
      const tx = Math.floor(p.x)
      const ty = Math.floor(p.y)
      // De plain-pied sur le monde : ni percement, ni poche murée (voir l'en-tête).
      if (field.dist[ty * map.width + tx] !== 0) continue
      // Pas DANS l'empreinte d'un autre lieu — mais le voisinage est permis, et c'est voulu : un
      // charnier au pied des Ruines est une histoire. L'écart entre charniers, lui, est déjà tenu
      // par le semis de Poisson ; ce rayon-ci ne le borne jamais.
      if (tropPres(map, tx, ty, MORTS.CHARNIER_ECART_LIEU)) continue
      if (!isEligible(map, field, t, tx, ty, used, zoneDe)) continue
      placeOne(map, field, t, tx, ty, used)
      poses += 1
    }
  }
}

/**
 * ═══ LA LOUVIÈRE — la géométrie de pose (spec `loup.md` L1) ═══
 *
 * Elle se calibre en REGARDANT UNE CARTE, comme tout le worldgen (règle de
 * balance.ts) : c'est pour ça qu'elle vit ici et pas dans `FAUNA`.
 */
const LOUVIERE = {
  /**
   * LA LISIÈRE : le gîte se pose entre ces deux distances du CŒUR d'un coin de
   * chasse — jamais dans le pré (la meute vit à couvert), jamais si loin que la
   * boucle gîte↔chasse ne se voie plus (30-60 t ≈ 10-18 s au trot : le cycle
   * tient dans une session).
   */
  FROM_GROUND_MIN: 30,
  FROM_GROUND_MAX: 60,
  /** Pas DANS l'empreinte d'un autre lieu — le voisinage, lui, est permis (précédent : charnier). */
  ECART_LIEU: 12,
} as const

/**
 * LES GÎTES À LOUPS (spec `loup.md` L1) — un par coin de chasse, en lisière.
 *
 * `horsSemis`, par sa PROPRE règle (précédent : le Charnier) : l'adresse d'une
 * Louvière n'est pas un biome tiré au sort, c'est une RELATION — le coin de
 * chasse dont sa meute vivra. On balaie l'anneau [FROM_GROUND_MIN, FROM_GROUND_MAX]
 * autour du cœur du coin, on garde les tuiles ÉLIGIBLES (couvert de la table,
 * plain-pied, hors route, hors empreinte d'un autre lieu), et on en TIRE une par
 * hachage du coin — sans quoi l'ordre de balayage mettrait tous les gîtes au
 * NORD de leur pré, et le joueur apprendrait un mensonge. Un coin sans couvert
 * dans l'anneau ne reçoit RIEN : la vallée a le droit d'avoir des clairières
 * sans meute, et c'est ce qui donne leur poids à celles qui en ont une.
 *
 * Appelée par zonegen APRÈS `placePois` (les empreintes sont posées, `tropPres`
 * les respecte) et AVANT `placeCharniers`/`placeSteles` (qui respectent la
 * sienne). Les coins lui sont PASSÉS : `poi.ts` ne connaît pas `faune.ts` —
 * même frontière que le champ des morts pour les charniers.
 */
export function placeGitesLoup(
  map: WorldMap,
  seed: number,
  grounds: readonly { x: number; y: number }[],
  champ?: CarveField,
): void {
  const t = POI_TYPES.find((p) => p.slug === 'louviere')
  if (!t || grounds.length === 0) return
  const field = champ ?? carveDistanceToMain(map, walkableComponents(map), POI_PLACEMENT.MAX_CARVE_TILES)
  const used = new Map<string, number>()
  // Les lieux déjà posés comptent dans `used` : le cap de la table reste un cap.
  for (const z of map.zones) if (z.kind === 'louviere') used.set('louviere', (used.get('louviere') ?? 0) + 1)

  for (const g of grounds) {
    const cx = Math.floor(g.x)
    const cy = Math.floor(g.y)
    // Toutes les tuiles éligibles de l'anneau, en ordre de balayage déterministe…
    const candidats: { tx: number; ty: number }[] = []
    const rMax = LOUVIERE.FROM_GROUND_MAX
    const min2 = LOUVIERE.FROM_GROUND_MIN * LOUVIERE.FROM_GROUND_MIN
    const max2 = rMax * rMax
    for (let oy = -rMax; oy <= rMax; oy += 2) {
      for (let ox = -rMax; ox <= rMax; ox += 2) {
        const d2 = ox * ox + oy * oy
        if (d2 < min2 || d2 > max2) continue
        const tx = cx + ox
        const ty = cy + oy
        if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
        if (tropPres(map, tx, ty, LOUVIERE.ECART_LIEU)) continue
        if (!isEligible(map, field, t, tx, ty, used)) continue
        candidats.push({ tx, ty })
      }
    }
    if (candidats.length === 0) continue // pas de couvert en lisière : ce pré vit sans meute
    // …et le HASARD DU LIEU en choisit une — `hash2` du coin, pur, zéro tirage :
    // le PRNG d'état n'existe pas encore ici, et deux graines proches donnent
    // deux lisières différentes.
    const idx = Math.min(candidats.length - 1, Math.floor(hash2(cx, cy, seed ^ 0x4c4f5556 /* 'LOUV' */) * candidats.length))
    const spot = candidats[idx]!
    placeOne(map, field, t, spot.tx, spot.ty, used)
  }
}

/**
 * Le numéro d'un lieu, en chiffres romains. La table figée s'arrêtait à XIV et retombait sur des
 * chiffres arabes au-delà — inoffensif tant qu'aucun type ne dépassait quatorze exemplaires, ce
 * que les charniers font (leur plafond est large à dessein). Rend l'identique de I à XIV.
 */
const ROMANS: readonly (readonly [number, string])[] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
]
function roman(n: number): string {
  let reste = n
  let out = ''
  for (const [valeur, signe] of ROMANS) {
    while (reste >= valeur) { out += signe; reste -= valeur }
  }
  return out
}

/**
 * Tuiles marchables de l'empreinte de la zone [z.x, z.x+z.w) × [z.y, z.y+z.h).
 * Si aucune (repaire/tanière posé sur du rock, glacier…), retombe sur l'anneau
 * de tuiles à +1 autour de l'empreinte. Ordre de construction déjà stable
 * (balayage row-major) : un index dans cette liste est donc un tirage
 * déterministe reproductible d'un run à l'autre.
 */
function walkableTilesFor(map: WorldMap, z: Pick<Zone, 'x' | 'y' | 'w' | 'h'>): Array<{ tx: number; ty: number }> {
  const inFootprint: Array<{ tx: number; ty: number }> = []
  for (let ty = z.y; ty < z.y + z.h; ty++) {
    for (let tx = z.x; tx < z.x + z.w; tx++) {
      if (!isBlockingTile(map, tx, ty)) inFootprint.push({ tx, ty })
    }
  }
  if (inFootprint.length > 0) return inFootprint
  const ring: Array<{ tx: number; ty: number }> = []
  for (let ty = z.y - 1; ty < z.y + z.h + 1; ty++) {
    for (let tx = z.x - 1; tx < z.x + z.w + 1; tx++) {
      const inside = tx >= z.x && tx < z.x + z.w && ty >= z.y && ty < z.y + z.h
      if (inside) continue
      if (!isBlockingTile(map, tx, ty)) ring.push({ tx, ty })
    }
  }
  return ring
}

/** L'écart minimal entre deux stèles, en tuiles — des stèles partout ne parlent nulle part. */
const STELE_ECART = 90
/** La couronne de pose autour du fait : la stèle est AU BORD du carrefour, pas dessus. */
const STELE_POSE_RAYON = 5

/**
 * LES STÈLES (spec `annales.md` R8) — posées SUR les faits saillants de l'ère 2, AU BORD.
 *
 * Après `placePois` et `placeCharniers` : les lieux ont leurs empreintes, `tropPres` (dans
 * `isEligible`) les respecte donc, et les annales de l'ère 2 (croisées, gués) sont écrites
 * depuis la passe 4.5. La couronne s'explore en ordre déterministe (rayon croissant, dy puis
 * dx) et s'arrête à la PREMIÈRE tuile de plain-pied éligible — le biome de la table exclut la
 * route par construction (t0 R18 : rien ne s'adosse à une sente).
 *
 * Aucun tirage : l'ordre des candidats est l'ordre d'émission des annales, qui est celui des
 * passes — le monde hors zones/annales reste au bit près celui d'avant.
 */
export function placeSteles(map: WorldMap, champ?: CarveField): void {
  const t = POI_TYPES.find((p) => p.slug === 'stele')
  if (!t) return
  const field = champ ?? carveDistanceToMain(map, walkableComponents(map), POI_PLACEMENT.MAX_CARVE_TILES)
  const used = new Map<string, number>()
  const posees: { x: number; y: number }[] = []
  const ecart2 = STELE_ECART * STELE_ECART

  for (const f of map.annales ?? []) {
    if (posees.length >= t.cap) break
    if (f.type !== 'croisee' && f.type !== 'gue') continue
    if (!saillant(map, f)) continue // le rare se dit — une stèle par carrefour qui compte
    if (posees.some((q) => (q.x - f.x) * (q.x - f.x) + (q.y - f.y) * (q.y - f.y) < ecart2)) continue

    couronne: for (let r = 1; r <= STELE_POSE_RAYON; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const tx = f.x + dx
          const ty = f.y + dy
          if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) continue
          // De plain-pied sur le monde (patron charnier) : une stèle n'a pas de porte.
          if (field.dist[ty * map.width + tx] !== 0) continue
          if (!isEligible(map, field, t, tx, ty, used)) continue
          placeOne(map, field, t, tx, ty, used)
          posees.push({ x: f.x, y: f.y })
          break couronne
        }
      }
    }
  }
}

/**
 * Spawn runtime des monstres de POI (tanière → sanglier, repaire → cendreux).
 * Déterministe, et garanti sur une tuile marchable : le tirage naïf dans
 * l'empreinte pouvait tomber sur du rock/glacier non praticable (repaire en
 * biome ROCK, tanière en lisière FOREST/rock…) et bloquer le monstre. Si
 * l'empreinte et son anneau +1 n'offrent aucune tuile marchable, le monstre
 * ne spawne pas (rare — un repaire sans sol praticable ne pose rien).
 */
export function spawnPoiMonsters(state: SimState, seed: number): void {
  for (let zone = 0; zone < state.map.zones.length; zone++) {
    // On RETIENT les lieux peuplés : eux seuls repeupleront (spec faune R16). Le
    // peuplement appartient à l'hôte, et un monde qui n'a jamais voulu de bêtes de
    // lieu ne doit pas en voir apparaître au bout de quatre minutes.
    if (populateDen(state, zone, seed) && !state.dens.includes(zone)) state.dens.push(zone)
  }
}

/** Pose la bête d'un lieu sur son empreinte. Sans effet si le lieu n'en a pas. */
function populateDen(state: SimState, zone: number, seed: number): boolean {
  const z = state.map.zones[zone]
  if (!z) return false
  const t = POI_TYPES.find((p) => p.slug === z.kind)
  if (!t?.monster) return false
  const candidates = walkableTilesFor(state.map, z)
  if (candidates.length === 0) return false // aucune tuile praticable dans/autour de l'empreinte
  if (t.monster === 'wolf') return populateLouviere(state, zone, candidates, seed)
  const r = hash2(z.x, z.y, seed ^ 0x4d4f4e) // 'MON'
  const idx = Math.min(candidates.length - 1, Math.floor(r * candidates.length))
  const tile = candidates[idx]!
  const id = spawnMonster(state, t.monster, tile.tx + 0.5, tile.ty + 0.5)
  const born = state.monsters.find((m) => m.entityId === id)
  if (born) born.homePoi = zone // elle appartient à ce lieu, et elle y reviendra
  return true
}

/**
 * LE CLAN D'UNE LOUVIÈRE (spec `loup.md` L2-L3) : 1 alpha + `FAUNA.DEN_ADULTES`
 * adultes + `FAUNA.DEN_PETITS` petits. La fonction RÉTABLIT la composition — elle
 * ne pose pas cinq loups au hasard : l'alpha d'abord s'il manque, puis les
 * adultes, puis les petits. Les survivants sont gardés : un gîte qui a perdu ses
 * adultes se repeuple AUTOUR de ses petits, dans le même clan (`herdId`), et
 * chacun retient le nouveau chef (`alphaId`, rafraîchi partout).
 *
 * Aucun n'est `ambient` : les résidents ne se dissipent jamais (R16). Les adultes
 * naissent repus (`faim: 0` — le clan qui s'installe a mangé) ; un petit n'a pas
 * de jauge (L6, le clan le nourrit). Tout est dérivé de `hash2` : pur, zéro
 * tirage sur le PRNG d'état.
 */
function populateLouviere(
  state: SimState,
  zone: number,
  candidates: Array<{ tx: number; ty: number }>,
  seed: number,
): boolean {
  const z = state.map.zones[zone]!
  const clan = state.monsters.filter((m) => m.homePoi === zone)
  const clanAdultes = 1 + FAUNA.DEN_ADULTES

  let alpha = clan.find((m) => m.alpha === true)
  let herdId = clan.find((m) => m.herdId !== undefined)?.herdId
  if (herdId === undefined) {
    herdId = state.nextHerdId
    state.nextHerdId += 1
  }

  let poses = 0
  const pose = (petit: boolean, n: number): void => {
    const r = hash2(z.x + n * 7, z.y + (petit ? 131 : 0), seed ^ 0x4c4f5550 /* 'LOUP' */)
    const tile = candidates[Math.min(candidates.length - 1, Math.floor(r * candidates.length))]!
    const id = spawnMonster(state, 'wolf', tile.tx + 0.5, tile.ty + 0.5)
    const born = state.monsters.find((m) => m.entityId === id)!
    born.homePoi = zone
    born.herdId = herdId
    if (petit) {
      born.petit = true
      const e = state.entities.find((x) => x.id === id)!
      e.hp = MONSTER_DEFS.wolf.hp * FAUNA.PETIT_HP
    } else {
      born.faim = 0
      born.clanAdultes = clanAdultes
    }
    clan.push(born)
    poses += 1
  }

  // L'ALPHA D'ABORD : sans chef, le gîte n'a pas de meute — juste des loups.
  if (!alpha) {
    pose(false, 0)
    alpha = clan[clan.length - 1]!
    alpha.alpha = true
    const e = state.entities.find((x) => x.id === alpha!.entityId)!
    e.hp = MONSTER_DEFS.wolf.hp * FAUNA.ALPHA_HP // le chef prend sa taille, et ses PV sont pleins
  }
  let adultes = clan.filter((m) => m.petit !== true).length
  for (let n = 1; adultes < clanAdultes; n++, adultes++) pose(false, n)
  let petits = clan.filter((m) => m.petit === true).length
  for (let n = 0; petits < FAUNA.DEN_PETITS; n++, petits++) pose(true, n)

  // Tout le clan retient le chef — les petits d'un ancien clan compris.
  for (const m of clan) {
    m.alphaId = alpha.entityId
    m.herdId = herdId
  }
  return poses > 0
}

/**
 * LE RETOUR DES BÊTES DE LIEU (spec faune R16).
 *
 * La bête d'une tanière est RÉSIDENTE : elle ne se dissipe pas avec la faune
 * ambiante. Mais tuée, elle ne revenait jamais — et le lieu devenait une coquille
 * vide pour le reste de la saison. Un joueur qui « nettoyait » les tanières
 * supprimait définitivement une source de viande de sa vallée.
 *
 * Elle repeuple donc son lieu après `DEN_RESPAWN_TICKS` — mais **jamais sous les
 * yeux de quelqu'un** (`DEN_SPAWN_CLEARANCE`) : une bête qui se matérialise devant
 * vous, c'est le décor qui avoue. Tant qu'un avatar campe la tanière, on attend.
 *
 * Ce n'est PAS un robinet : le délai est long, et un seul occupant par lieu. On ne
 * farme pas une tanière — on y revient.
 */
export function advanceDens(state: SimState, seed: number): void {
  if (state.dens.length === 0) return // aucun lieu peuplé par l'hôte : rien à repeupler

  const monsterIds = new Set(state.monsters.map((m) => m.entityId))
  const avatars = state.entities.filter((e) => !monsterIds.has(e.id) && e.hp > 0)
  // COMBIEN de résidents chaque lieu porte — un COMPTE, plus un booléen : depuis que le
  // repaire RESPIRE (décision ⑪, 2026-08-21), son cap de saison monte au-delà de un.
  const residents = new Map<number, number>()
  for (const m of state.monsters) {
    if (m.homePoi === undefined) continue
    residents.set(m.homePoi, (residents.get(m.homePoi) ?? 0) + 1)
  }
  const jour = jourDeSaison(state)

  for (const zone of state.dens) {
    const z = state.map.zones[zone]
    if (!z) continue
    // LE CAP DU LIEU : 1 pour une tanière (le comportement historique, à l'identique) ;
    // pour un repaire de Cendrés, la rampe de saison — il respire de plus en plus fort.
    const t = POI_TYPES.find((p) => p.slug === z.kind)
    // LE CAP DU LIEU : 1 pour une tanière ; la rampe de saison pour un repaire ;
    // le CLAN ENTIER pour une Louvière (spec loup.md L3 — 1 alpha + adultes +
    // petits). Les déserteurs ne comptent pas : `routClanMember` leur retire
    // `homePoi` — un plafond compte ce qu'il borne.
    const cap = t?.monster === 'cendreux'
      ? Math.round(seasonRamp(1, MORTS.RESPIRE_CAP_FIN, jour))
      : t?.monster === 'wolf'
        ? 1 + FAUNA.DEN_ADULTES + FAUNA.DEN_PETITS
        : 1
    if ((residents.get(zone) ?? 0) >= cap) continue // le lieu est plein : rien à faire
    // UN LIEU BRÛLÉ NE RESPIRE PAS (décision ⑧) : l'assainissement suspend le retour.
    if (state.lieuxBrules.some((lb) => lb.zone === zone && state.tick < lb.until)) continue

    const pending = state.denRespawns.find((d) => d.zone === zone)
    if (!pending) {
      // Elle vient de tomber : on note l'heure de son retour. LE REPAIRE A SA CADENCE À LUI
      // (décision ⑪ — `MORTS.RESPIRE_CYCLES`, la respiration du lieu) ; la tanière garde le
      // délai historique des bêtes de lieu.
      const delai = t?.monster === 'cendreux' ? MORTS.RESPIRE_TICKS : FAUNA.DEN_RESPAWN_TICKS
      state.denRespawns.push({ zone, at: state.tick + delai })
      continue
    }
    if (state.tick < pending.at) continue

    // L'heure est venue — mais pas devant témoin.
    const cx = z.x + z.w / 2
    const cy = z.y + z.h / 2
    let watched = false
    for (const a of avatars) {
      if (distSq(a.x, a.y, cx, cy) <= FAUNA.DEN_SPAWN_CLEARANCE * FAUNA.DEN_SPAWN_CLEARANCE) {
        watched = true
        break
      }
    }
    if (watched) continue

    if (populateDen(state, zone, seed)) {
      state.denRespawns = state.denRespawns.filter((d) => d.zone !== zone)
    }
  }
}
