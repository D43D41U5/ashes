/**
 * Tous les nombres d'équilibrage du jeu vivent ici, et seulement ici.
 *
 * Règle du projet : jamais de nombre d'équilibrage en dur dans la logique.
 *
 * ── OÙ VIT QUOI, EXACTEMENT (audit du 2026-08-02) ──
 * « Ici et seulement ici » a UNE exception, et elle est délibérée : **le réglage d'un
 * générateur de carte vit à côté de son générateur**. `MONDE` (zonegraph) · `RELIEF`
 * (zonegen) · `EAU` (zonegen-water) · `SENTES` · `SET_PIECES` · `CREUX` (racine-relief) ·
 * `CONTENU` (zone-content) · `POI_PLACEMENT` (poi) · `CENDRE`.
 *
 * La ligne de partage n'est pas le sujet, c'est **comment on calibre** :
 *   • ce fichier = ce qui se règle EN JOUANT (vitesses, dégâts, faim, portées, prix) ;
 *   • les blocs du worldgen = ce qui se règle EN REGARDANT UNE CARTE (densité de lacs,
 *     largeur d'une sente, taille d'un set-piece). Les rapatrier ici les éloignerait de
 *     la seule chose qui permet de les juger — le générateur qui les lit.
 *
 * Ce qui n'a JAMAIS d'excuse, en revanche, c'est un nombre d'équilibrage **en clair dans
 * un corps de fonction** : personne ne peut le trouver sans lire le code. L'audit en a
 * remonté une douzaine (heures d'éveil de la faune, répartition des plaies, seuils de
 * faim, rayon d'atteinte d'un jalon…) ; s'il en reste, ils vont ici, pas à côté.
 *
 * Le GDD (§15) précise que tous les chiffres sont des ordres de grandeur à
 * calibrer en playtest — les centraliser rend le tuning diffable en une
 * ligne et testable par bots headless sans toucher aux systèmes.
 *
 * Durées exprimées en ticks : la source de vérité est le TEMPS RÉEL (secondes,
 * cycles), converti une seule fois via `ticksFor`/`ticksForCycles` ci-dessous.
 * Changer TICK_RATE_HZ (ou CYCLE_REAL_MINUTES) recalcule tout automatiquement —
 * ne jamais coller un nombre de ticks en dur ailleurs dans /sim ou les tests ;
 * dériver de BALANCE.TICK_RATE_HZ (voir docs/decisions.md, 2026-07-05).
 *
 * ── LE REGISTRE DES PIÈCES (2026-08-01) ──
 * Tout ce qui décrit une PIÈCE (coût, PV, accès, capacité, palier, fonction) vit
 * désormais dans `pieces.ts`, et ce fichier n'en garde que des PROJECTIONS dérivées :
 * `STRUCTURE_COSTS`, `STRUCTURE_HP`, `COMPONENTS`, `FUNCTIONS.recipeByTier`. Elles
 * existent pour que leurs ~30 lecteurs ne changent pas d'import — ce sont des VUES,
 * pas des tables : on ne les édite jamais, on édite le registre.
 * `pieces.ts` n'importe aucune valeur : le graphe reste sans cycle (items → balance → pieces).
 */
import { CAPACITE_COFFRE, CAPACITE_GRENIER, COMPONENT_TYPES, FUNCTION_IDS, coutObjet, palierDe, parPiece, piece, type ComponentType, type FunctionId, type StructureType } from './pieces'

export { COMPONENT_TYPES }
export type { ComponentType, FunctionId }

/** Fréquence de la simulation, en ticks par seconde (GDD §11 : 10-15 Hz ;
 * dérogation actée à 20 Hz le 2026-07-05, voir docs/decisions.md). */
const TICK_RATE_HZ = 20
/** Durée du cycle jour/nuit diégétique, en minutes réelles (non accéléré). */
const CYCLE_REAL_MINUTES = 48

/** Convertit une durée réelle (secondes) en nombre de ticks, à la fréquence courante. */
const ticksFor = (seconds: number): number => Math.round(seconds * TICK_RATE_HZ)
/** Convertit un nombre de cycles jour/nuit (ex. 1/24 = une heure de cycle) en ticks. */
const ticksForCycles = (cycles: number): number => Math.round(cycles * CYCLE_REAL_MINUTES * 60 * TICK_RATE_HZ)

/**
 * LE CARRÉ ×PALIER (spec construction R2) — rayon (Chebyshev) de la zone du Feu
 * par palier (1→3). Le carré vaut `(2R+1)×(2R+1)` tuiles ; il est RÉSERVÉ à sa
 * taille max dès la fondation (R2, validation R1 contre `R_max`), mais ne s'ouvre
 * à la pose qu'au fur et à mesure des paliers. Ordres de grandeur, à calibrer.
 */
const FIRE_RADIUS_BY_TIER = [10, 13, 16] as const

/** Jauge Température (spec 2026-07-08). Ordres de grandeur, à calibrer en playtest. */
export const TEMPERATURE = {
  BASE: 90, // cible d'un bas de vallée, jour, acte I
  // LA NUIT MORD, DÈS L'ACTE I (était 20). Sans elle, le Feu n'était qu'un
  // établi : on pouvait passer la nuit dehors sans y penser. Rentrer avant la
  // nuit — ou emporter de quoi faire du feu — devient une décision.
  NIGHT_COLD: 30,
  // Par acte (I, Grand Froid, Cendre), soustrait de BASE. L'acte III passe 40→50 (fork
  // tranché cette session, GDD « froid létal en acte III ») : plaine de nuit en acte III
  // = 90 − 50 − 30 = 10 < HYPOTHERMIA(20) → le froid TUE la plaine, comme le discours le
  // promet. La réponse est la TENUE D'HIVER (elle plafonne l'exposition, voir temperature.ts).
  ACT_COLD: [0, 25, 50] as const,
  /**
   * Décalage signé par terrain (id de TERRAINS). Absent = 0.
   *
   * LE FROID VIENT DU BIOME, pas de l'altitude (la carte est plate — façon RimWorld). Ce qui était
   * autrefois « le froid, prix de la verticalité » (un terme `elevation × ALT_COLD`) est re-sourcé
   * ici : la neige et surtout le glacier portent leur froid dans leur terrain, ce qui garde le Névé
   * et le Glacier mortellement froids sans aucune hauteur. Ordres de grandeur, à calibrer en playtest.
   */
  BIOME_OFFSET: {
    3: 5, 13: 5, 14: 5, 22: 5, 24: 5, // forêts (couvert — la saulaie aussi)
    8: -5, 18: -5, 19: -5, 25: -5, // marais/tourbière/roselière/prairie humide (mouillé)
    10: -40, // neige — un seuil qu'on paie en froid (le Névé)
    15: -75, // glacier — glacial, une gate de froid (le Glacier)
  } as Record<number, number>,
  FIRE_WARMTH: 80, // cible au contact d'un feu
  FIRE_RANGE: 6, // tuiles
  SHELTER_FACTOR: 0.5, // sous toit : nuit+biome × 0.5
  /** Fraction de l'écart à l'ambiant comblée par tick (÷ isolation). Calibrage :
   *  ~2 min réelles vers l'engourdissement, ~6 min vers l'hypothermie à ambiant 0. */
  K_DRIFT: 0.0002,
  /** Isolation du corps nu (stub ; la Couture la fera monter plus tard). */
  INSULATION_BODY: 1,
  /** LA TENUE D'HIVER PLAFONNE LE FROID (spec cuir/température, V2-16). Porter une
   *  `tenue_hiver` plancher l'ambiant ressenti à cette valeur — au-dessus de
   *  HYPOTHERMIA, donc le froid ne tue plus : c'est ce qui rend la plaine survivable en
   *  acte III. Vraie protection (un plancher), pas un simple ralentissement de dérive. */
  TENUE_FLOOR: 32,
  COMFORT: 60, // au-dessus : aucun effet
  HYPOTHERMIA: 20, // en dessous : dégâts
  HYPOTHERMIA_DAMAGE_MAX: 0.3, // PV/tick à température 0
  SPEED_FLOOR: 0.6, // vitesse au plus froid
  STAMINA_FLOOR: 0.5, // régén d'endurance au plus froid
}

/**
 * Les lieux chargés (spec `docs/specs/lieux.md`). Ordres de grandeur, à
 * calibrer en jeu — pas des vérités.
 */
export const POI = {
  /**
   * Du Belvédère, on voit loin : rayon de révélation, en tuiles.
   *
   * CALIBRÉ EN JEU (2026-07-11) sur la vraie carte (1200×1800, 5 seeds). Les 40
   * tuiles d'origine étaient MORTES : le semis Poisson espace les lieux d'au
   * moins 96 tuiles (`POI_PLACEMENT.SPACING_FRAC × min(w,h)`), donc un Belvédère
   * posé n'importe où ne révélait RIEN, sur 79 lieux et 5 seeds. Aucun test
   * headless ne pouvait le voir : ils posent leurs propres zones à 10 tuiles.
   * À 300 : ~8 lieux révélés en moyenne, jamais zéro — une grappe.
   */
  REVEAL_BELVEDERE_TILES: 300,
  /** Le Grand Chêne de la Racine : plus court qu'un belvédère (on est en plaine), mais c'est
   *  le premier « voir plus loin » de la partie — assez pour désigner la sortie de la zone. */
  REVEAL_CHENE_TILES: 180,
  /**
   * De l'Arche, on voit les abris de l'autre versant. Même portée que le
   * Belvédère, mais filtrée aux `shelter` : ~2 abris en moyenne (ils sont plus
   * rares). Même erreur d'origine — 30 tuiles ne révélaient jamais rien.
   */
  REVEAL_ARCHE_TILES: 300,
  /** La Source chaude est un feu qu'on n'a pas allumé (mêmes unités que FIRE_WARMTH/FIRE_RANGE). */
  HOTSPRING_WARMTH: 75,
  HOTSPRING_RANGE_TILES: 4,
  /** Le Tarn est une halte : régén d'endurance multipliée sur son empreinte. */
  TARN_STAMINA_FACTOR: 1.5,
  /**
   * LA PORTÉE DE VUE (2026-07-11), en tuiles. On ne se plante pas sur un
   * Sanctuaire pour savoir qu'il existe : on l'APERÇOIT, et il entre dans la
   * carte. Calé sur ce qui tient à l'écran (viewport 1280×720, tuile 16 px,
   * zoom ~2,25 → ~35 tuiles de large) : 14 tuiles = un lieu bien dans le cadre,
   * pas un coin d'écran. C'est aussi la raison d'être de la passe d'art : un
   * monument qui dépasse la canopée SE VOIT VENIR, donc s'apprend de loin.
   *
   * ATTENTION — voir ne donne PAS la charge. Le Belvédère ne révèle sa grappe
   * que si l'on MONTE dessus (sinon il ne ferait plus grimper), et « le premier
   * à ATTEINDRE le Sanctuaire » ne peut pas être quelqu'un qui l'a vu de loin.
   */
  /*
   * 14 → 30 (2026-07-24). La valeur d'origine était PLUS COURTE que ce que l'écran montre
   * (~35 tuiles) : on « découvrait » donc un lieu déjà bien visible depuis un moment, ce qui
   * vide de sens la phrase ci-dessus (« se voit venir »). Depuis l'arrivée du brouillard de
   * guerre (R19), c'était même incohérent : le sol se dévoilait à 22 tuiles, soit AVANT le
   * monument posé dessus — on éclairait le décor avant l'objet qu'il porte. 30 tuiles remet
   * l'ordre juste : on repère le monument à peu près quand il entre dans l'image.
   */
  SIGHT_TILES: 30,
  /**
   * LA CLAIRIÈRE (2026-07-11) : marge dégagée autour de l'empreinte d'un lieu,
   * en tuiles. Rien n'y pousse — ni arbre, ni buisson, ni rocher, ni décor.
   * Un lieu enseveli sous la forêt n'est pas un lieu : on ne le voit pas venir,
   * et on ne sait pas qu'on y est. Rayon total = demi-empreinte + cette marge.
   * Ne s'applique PAS aux gisements/carrières : on ne dégage pas une mine.
   */
  CLEARING_MARGIN_TILES: 3,
  /** Ce que les Pétroglyphes savent montrer : les lieux ANCIENS. */
  ANCIENT_KINDS: ['ruines', 'mine', 'sanctuaire', 'oratoire'] as readonly string[],
  /**
   * LA TOUR DE GUET EFFONDRÉE — le Belvédère de la plaine (spec t0-exploration R1-R2).
   * On grimpe aux décombres, on voit. Entre le Chêne (180 — un arbre, on est dessous) et le
   * Belvédère (300 — on domine tout) : une tour éboulée domine un peu.
   */
  REVEAL_TOUR_TILES: 240,
  /** Ce qu'une Pierre levée sait montrer : LES PIERRES SE RÉPONDENT (spec t0-exploration R2).
   *  La chaîne des menhirs mène au Cercle — le patron Vegvisir de Valheim : un indice ne
   *  révèle que le prochain maillon, jamais la carte. */
  PIERRES_KINDS: ['pierre_levee', 'cercle_pierres'] as readonly string[],
  /**
   * LES SET-PIECES (spec t0-exploration R9-R10) — des lieux dont le corps est le TERRAIN.
   * Deux exemptions en découlent : pas de clairière (`poiClearings` — on ne « dégage » pas
   * un endroit dont le contenu est la raison d'être, même logique que gisement/carrière),
   * et pas de sprite-corps côté client (l'étiquette seule — le sol parle).
   */
  SET_PIECE_KINDS: ['bois_noir', 'cercle_pierres', 'combe_brumeuse'] as readonly string[],
}

export const BALANCE = {
  TICK_RATE_HZ,

  /** Durée d'une saison en jours réels (GDD §2). */
  SEASON_DAYS: 60,

  /** Vitesse de marche d'un avatar, en tuiles par seconde. */
  WALK_SPEED_TILES_PER_S: 4,

  /**
   * ═══ ATTEINDRE UN JALON — le rayon, et POURQUOI il ne peut pas rétrécir ═══
   *
   * Tout ce qui suit un chemin (PNJ, bête qui contourne, Cendreux qui se replie) avance
   * vers `path[0]` et le retire quand il est « atteint ». Ce rayon dit atteint.
   *
   * **IL DOIT RESTER PLUS GRAND QUE LE PAS D'UN TICK**, sinon le suiveur enjambe le jalon
   * sans jamais entrer dedans : il fait demi-tour, l'enjambe en sens inverse, et ORBITE
   * indéfiniment. À 20 Hz, une bête à 4,8 t/s couvre 0,24 tuile par tick — 0,45 laisse
   * donc une marge d'environ ×1,9. Toucher à `TICK_RATE_HZ` ou accélérer une bête EXIGE de
   * revenir ici : c'est le rapport des deux qui compte, jamais la valeur seule.
   *
   * Le rayon FIN (`WAYPOINT_RADIUS_LAST`) sert au DERNIER jalon, où l'on veut arriver
   * précisément et non « dans le coin » ; il reste > pas/2, donc l'oscillation converge
   * en ≤ 2 ticks.
   *
   * *(Ce nombre était écrit en clair dans `npc.ts`, `faune.ts` ET `cendreux.ts` — trois
   * copies, et le raisonnement ci-dessus n'existait que dans la première. Les deux autres
   * se seraient mises à tourner en silence le jour d'un changement de cadence.)*
   */
  WAYPOINT_RADIUS: 0.45,
  WAYPOINT_RADIUS_LAST: 0.2,

  /** Durée du cycle jour/nuit diégétique, en minutes réelles (non accéléré). */
  CYCLE_REAL_MINUTES,

  /** Part du cycle qui est de jour (0.625 → 30 min de jour, 18 min de nuit). */
  CYCLE_DAY_FRACTION: 0.625,

  /** Heure murale de l'aube — le cycle démarre au lever du jour, mais l'horloge
   * affichée est une horloge murale : minuit (0h) au cœur de la nuit, midi en plein
   * jour. Avec DAWN=6 et DAY_FRACTION=0.625 : jour 6h→21h, nuit 21h→6h. */
  CYCLE_DAWN_HOUR: 6,

  /** Derniers jours des actes I et II (GDD §2 : semaines 1-3, 4-6, 7-8+). */
  ACT_BOUNDARIES: [21, 42],

  /**
   * LA HITBOX D'UN AVATAR : **12 × 6 px**, soit 0,75 × 0,375 tuile (décision d'Alexis,
   * 2026-07-27). `AVATAR_HITBOX_TILES` en est la LARGEUR (est-ouest, spec monde R9).
   *
   * DEUX CHOSES S'Y JOUENT, ET AUCUNE N'EST DÉCORATIVE.
   *
   * ① **LARGEUR = LARGEUR DU DESSIN.** L'avatar est rendu sur 12 px de large : le corps et le
   *    dessin s'arrêtent donc ENSEMBLE. Avec 0,6 (9,6 px) sous un dessin de 16, on voyait
   *    l'avatar entrer dans la pierre alors que la collision l'arrêtait à fleur ; avec 1 tuile
   *    pleine, aucun passage d'une tuile ne se franchissait plus sans être aligné au pixel (un
   *    zombie s'immobilisait pour de bon dans une chicane — MESURÉ). 0,75 laisse un quart de
   *    tuile de jeu : on se faufile encore, et le dessin ne ment plus.
   *
   * ② **LE CORPS EST UN RECTANGLE.** Vu de dessus, des épaules sont plus larges que profondes :
   *    0,375 tuile en nord-sud. C'est ce qui permet de longer un mur au sud sans le chevaucher,
   *    et de se glisser entre deux obstacles décalés.
   */
  AVATAR_HITBOX_TILES: 0.75,
  AVATAR_HITBOX_DEPTH_TILES: 0.375,

  /** Résolution de la collision sous-tuile : sous-tuiles par côté de tuile.
   * PUISSANCE DE DEUX obligatoire — la collision multiplie et divise par cette
   * valeur, et seule une puissance de deux garantit `fl(8a − 8b) = 8·fl(a − b)`,
   * donc l'exactitude au bit près face à l'ancienne collision en tuiles pleines
   * (invariant 2).
   *
   * CE QUE 8 ACHÈTE, AU 2026-07-28 : un tronc de 3 sous-tuiles (0,375 tuile, 6 px) ne laisse
   * que 0,625 tuile entre deux troncs voisins NON décalés — moins que l'avatar (0,75). C'est
   * le DÉCALAGE D'ORIGINE qui ouvre les couloirs, et il ne les ouvre pas tous : MESURÉ sur
   * 360 000 tuiles, l'avatar se faufile entre **31,3 %** des paires d'arbres voisines d'est en
   * ouest et **83,1 %** du nord au sud (il n'est profond que de 0,375). Avant l'épaississement
   * du tronc : 50,1 % et 93,0 %. La forêt est un couvert qui accroche — et ces deux nombres
   * sont ceux qu'on relit le jour où l'on trouvera qu'elle accroche trop. */
  SUBTILES_PER_TILE: 8,

  /**
   * L'ÉPAISSEUR D'UN MUR SUR ARÊTE, en SOUS-TUILES (modèle d'arête, décision d'Alexis).
   *
   * **2 sur 8 = 0,25 tuile**, et cette épaisseur est À CHEVAL sur la limite : **2 px de dessin
   * dans une tuile, 2 px dans l'autre** (décision d'Alexis, 2026-07-27, le mot pour mot). Une
   * arête est une LIMITE, pas une bordure intérieure — la coller d'un seul côté mettait toute
   * la maçonnerie dans la tuile du dehors, et le mur ne tombait pas là où l'œil le place.
   *
   * Le chiffre vit ICI et non dans le rendu, parce que le rendu en DÉRIVE (`bati-art.ts`) :
   * épaissir le dessin seul donnerait le pire des défauts — un mur qu'on voit ici et qui arrête
   * là — et personne ne saurait lequel des deux a tort.
   *
   * CE QUE LE PARTAGE COÛTE AU DEDANS : la tuile de la salle qui borde le mur perd une
   * demi-épaisseur (1 sous-tuile, 0,125 tuile). Il lui en reste 0,875, l'avatar (0,75) y tient
   * encore — la salle reste praticable jusqu'au pied de ses murs. Et la tuile du dehors garde
   * autant : on longe un mur des deux côtés.
   */
  WALL_EDGE_SUB: 2,

  /** Amplitude du décalage pseudo-aléatoire de l'origine d'un arbre, en tuiles
   * (spec décalage d'origine). Chaque arbre est décalé de ±cette valeur en X et
   * en Y pour casser l'alignement des troncs en grille. BORNE DURE :
   * `TREE_JITTER_TILES + blockHalfSub(tree)/SUBTILES_PER_TILE ≤ 0.5`, sinon le
   * carré bloquant d'un arbre décalé déborde dans la tuile voisine et échappe à
   * la collision (testé). Avec blockHalfSub **1,5** et SUB 8 : plafond **0,3125**.
   * Calibré en jeu (départ 0,22 ; 0,3 depuis).
   *
   * LA MARGE EST DEVENUE MINCE — 0,3 sous un plafond de 0,3125 : le tronc épais du 2026-07-28
   * a mangé le reste. Épaissir encore (blockHalfSub 1,75) EXIGERAIT de baisser ce décalage,
   * donc de réaligner les troncs sur la grille — ce que ce nombre existe précisément pour
   * empêcher. Les deux ne peuvent plus monter ensemble. */
  TREE_JITTER_TILES: 0.3,

  /** Accélération du calendrier : jours de saison écoulés par jour réel. */
  DEFAULT_CALENDAR_SCALE: 1,

  /** LE CARRÉ ×PALIER (spec construction R2) : rayon Chebyshev de la zone du Feu,
   *  par palier (1→3). Remplace l'ancien `FIRE_BUILD_RADIUS` fixe. */
  FIRE_RADIUS_BY_TIER,

  /**
   * Distance minimale entre deux Feux (spec construction R1) = 2 · R_max, en
   * CHEBYSHEV. Garantit zéro chevauchement des carrés à taille max, pour toujours,
   * et que les landmarks ne se font jamais avaler. Ne s'applique qu'à la PROMOTION
   * d'un feu en foyer (found_village) : on pose autant de feux libres qu'on veut.
   */
  FIRE_MIN_DISTANCE: 2 * FIRE_RADIUS_BY_TIER[FIRE_RADIUS_BY_TIER.length - 1]!,

  /**
   * Coût pour ATTEINDRE chaque palier du Feu (spec construction R6). Index =
   * palier−1 : [0] est la fondation (gratuite), [1] mène au palier 2, [2] au 3.
   * Monter agrandit le carré (R2) et débloque des composants (R6). À calibrer.
   */
  FIRE_UPGRADE_COST: [{}, { wood: 40, stone: 30 }, { cut_stone: 30, iron_ingot: 8 }] as import('./items').ItemBag[],

  /**
   * PROXIMITÉ D'UN AMAS (spec construction R9) : deux composants séparés d'au plus
   * AMAS_RADIUS (Chebyshev) appartiennent au même amas, dont le contenu fait
   * émerger une fonction et fixe son palier (R10). À calibrer.
   */
  AMAS_RADIUS: 3,

  /** Portée des interactions (coffres, invitations), en tuiles. */
  INTERACT_RANGE: 1.5,

  /** Portée de bras pour bâtir/démolir, en tuiles (vraisemblance, GDD §11). */
  BUILD_RANGE: 6,

  /** Part des matériaux remboursée à la démolition. */
  DEMOLISH_REFUND: 0.5,

  /**
   * Ticks avant qu'un nœud épuisé repousse à plein.
   *
   * ÉTAIT 5 MINUTES. Un seul buisson de baies nourrissait alors 34 joueurs en
   * continu : le monde se remplissait plus vite qu'on ne le vidait. À 45 minutes
   * (≈ un cycle), une clairière qu'on rase reste vide pour la journée — on va donc
   * VOIR AILLEURS, et c'est là que tout commence (GDD §8bis : la collecte est le
   * tissu conjonctif ; elle met les joueurs sur les routes, donc dans les
   * rencontres). Modulé par l'acte (SEASON.REGROW_ACT_FACTOR) : le Grand Froid
   * contracte les sources.
   *
   * ⚠ CE FACTEUR S'APPLIQUE AUSSI AU MINÉRAL, et ce n'est pas une distraction : c'est un
   * cadran d'ABONDANCE, pas une affirmation de biologie. Un filon de fer ne « pousse » pas
   * moins vite parce qu'il gèle — les sources de la vallée se contractent à mesure que la
   * saison serre, et le fer en fait partie. Le froid VRAI, celui qui lit la température du
   * lieu, ne mord que sur ce qui vit (`flore-froid.md` F7) et ne passe jamais par ici.
   */
  NODE_REGROW_TICKS: ticksFor(45 * 60),

  /**
   * L'ÉPUISEMENT LOCAL (GDD §8bis : « les filons s'épuisent localement et rouvrent
   * ailleurs — les points de friction se DÉPLACENT »). Chaque passage à vide
   * rallonge la repousse suivante : on rase un coin, il met de plus en plus de
   * temps à revenir. On ne peut donc pas camper une clairière : on tourne.
   */
  DEPLETION_REGROW_PENALTY: 0.5,
  /**
   * LA DÉRIVE DU BOSQUET (spec recolte-vivante D1/R1). Un nœud de bois/plante épuisé
   * ne repousse PLUS sur son pixel : il ROUVRE sur une tuile voisine seedée, dans ce
   * rayon (tuiles). Le bosquet dérive, il ne clignote plus — le GDD §8bis « rouvrent
   * ailleurs » enfin tenu. La pierre/le minéral, eux, restent sur place (le camp bâti
   * contre un affleurement reste prévisible). `PROBES` = candidates sondées avant
   * d'abandonner (et de repousser sur place — dégradation gracieuse, jamais de perte).
   */
  RELOCATE_RADIUS: 12,
  RELOCATE_PROBES: 8,
  /** …borné, sinon un coin très fréquenté ne reviendrait JAMAIS (et un monde mort
   *  n'est pas un monde tendu, c'est un monde fini). */
  DEPLETION_MAX: 4,
  /** Le compteur d'épuisement s'oublie : un cycle sans y toucher efface une marche. */
  DEPLETION_FORGET_TICKS: ticksForCycles(1),

  /** Rythme minimal entre deux récoltes/crafts (1 s) — borne de vraisemblance. */
  GATHER_COOLDOWN_TICKS: ticksFor(1),

  /**
   * L'ABATTAGE À MAÎTRISE (spec recolte-maitrise, verbe 1). Le clic maintenu EMPLIT
   * une jauge ; relâcher dans le VERT (position FIXE, largeur croissant avec
   * `woodcutting`) = coup PROPRE (+rendement, −usure). Ces nombres sont des ORDRES
   * DE GRANDEUR — on mesure en playtest avant de les figer (spec G11 / D3 « doux »).
   * Garde : `GREEN_START + GREEN_WIDTH_MAX ≤ CHARGE_MAX` (le vert tient dans la jauge).
   */
  FELL_CHARGE_MAX_TICKS: ticksFor(1.2), // 24 : temps pour emplir la jauge à fond
  FELL_GREEN_START_TICKS: ticksFor(0.7), // 14 : bord bas du vert (FIXE — la maîtrise efface l'effort par la LARGEUR, pas la place)
  FELL_GREEN_WIDTH_BASE_TICKS: ticksFor(0.15), // 3 : largeur du vert à woodcutting 0 (le novice vise serré)
  FELL_GREEN_WIDTH_PER_LEVEL: 1, // +1 tick de vert par niveau
  FELL_GREEN_WIDTH_MAX_TICKS: ticksFor(0.4), // 8 : plafond (au niveau haut, quasi imratable — pas infaillible)
  // Le coup PROPRE (abattage dans le vert, minage sur le bon flanc) — bonus DOUX
  // PARTAGÉ par les deux verbes (harvestStrike est générique).
  CLEAN_YIELD_BONUS: 0.5, // +50 % de rendement (plancher +1, voir harvestStrike)
  CLEAN_WEAR_FACTOR: 0.6, // usure atténuée (l'outil mord au lieu d'encaisser)

  /**
   * LE MINAGE À MAÎTRISE (spec recolte-maitrise, verbe 2). Le point faible est un des
   * QUATRE FLANCS du nœud ; frapper le bon = coup propre. `mining` élargit l'acceptation
   * aux flancs voisins : tous les N niveaux, la tolérance (distance circulaire admise)
   * gagne un cran — 0 (exact) → 1 (+2 voisins) → 2 (tous, autopilote). Ordre de grandeur.
   */
  MINE_LEVELS_PER_TOLERANCE: 5,

  /**
   * LA CUEILLETTE À MAÎTRISE (spec recolte-maitrise, verbe 3, révisée 2026-07-25). Chaque coin
   * porte une RICHESSE seedée (facteur de stock, centré sur ~1 pour que les moyennes par cercle ne
   * bougent pas) : maigre → riche. La maîtrise ne fait plus LUIRE les coins (l'ancien halo, retiré) ;
   * elle ouvre une ÉCHELLE : d'abord un bonus de SEMENCE sur le geste nu (`forageBounty`, dès
   * `FORAGE_SEED_LEVEL` — relie le potager), puis, au sommet, l'accès aux PATCHES DE CHAMPIGNONS
   * (`champignon`, un vrai nœud humide/ombragé, gaté par le savoir `FORAGE_QUALITY_LEVEL`). Le tirage
   * de semence est POSITIONNEL (`hash2(nodeId, tick)`, aucun flux RNG, déterministe au replay). Ordres
   * de grandeur, calibrés en playtest.
   */
  FORAGE_RICHNESS_MIN: 0.55,
  FORAGE_RICHNESS_MAX: 1.45,
  /** Sous cette richesse, un coin ne rend AUCUN bonus de semence (les coins pauvres restent nus). */
  FORAGE_BOUNTY_RICH_FLOOR: 1.0,
  /** Le bonus de SEMENCE s'ouvre à ce niveau. */
  FORAGE_SEED_LEVEL: 3,
  /** Le SAVOIR pour récolter les patches de champignons (gate d'accès du nœud `champignon`). */
  FORAGE_QUALITY_LEVEL: 6,
  /** Pente de la proba de semence par niveau au-dessus du palier (× la richesse au-dessus du plancher).
   *  La graine reste RARE à dessein : la recette d'amorçage (baies→graine au Feu) garde le rôle fiable. */
  FORAGE_SEED_CHANCE_PER_LEVEL: 0.05,
  /** Plafond doux de la proba de semence — la cueillette n'est pas une imprimante. */
  FORAGE_BOUNTY_CHANCE_MAX: 0.35,

  /** Coups outillés avant qu'un outil soit consommé. */
  TOOL_DURABILITY: 100,

  /** Usure minimale par coup, quel que soit le niveau d'artisan — le PLANCHER de
   *  l'évier (V0-7). Relevé 0.25 → 0.6 : la spécialisation ne doit pas éroder l'un des
   *  deux seuls éviers de l'économie de flux (GDD §8). Un maître use encore ses outils
   *  à 60 % ; le talent récompense, il n'exonère pas. */
  TOOL_WEAR_MIN: 0.6,

  /**
   * Perte de faim par heure de cycle (jauge 0-100).
   *
   * ÉTAIT 1,4 — soit 0,7 point par minute RÉELLE : on pouvait ignorer la faim
   * **2h23**. À 4, la jauge pleine dure ~50 minutes réelles, soit un cycle : on
   * mange une à deux fois par jour, comme dans tout jeu de survie qui tient debout
   * (Don't Starve vide sa jauge en deux jours de jeu, et elle TUE).
   */
  HUNGER_PER_CYCLE_HOUR: 4,

  /**
   * LA FAIM TUE (nouveau — elle ne faisait que ralentir, ce qui n'est pas une
   * punition, c'est une remarque). À 0, les PV fondent : ~17 minutes réelles pour
   * mourir d'une jauge pleine de vie. Assez pour comprendre et réagir ; pas assez
   * pour l'ignorer. Don't Starve draine 1,25 PV/s — nous sommes bien plus doux,
   * parce que nos cycles sont six fois plus longs.
   */
  STARVE_HP_PER_MIN: 6,

  /** Multiplicateur de faim par acte — le Grand Froid mord (GDD §2). */
  ACT_HUNGER_FACTOR: [1, 2, 3],

  /** Facteur de vitesse le ventre vide (faim à 0). */
  HUNGER_SPEED_MALUS: 0.5,

  /** XP par action. */
  XP_PER_GATHER: 1,
  XP_PER_CRAFT: 5,

  /**
   * L'ARTISAN ÉCONOMISE LE TEMPS DES AUTRES (GDD §8bis, spec craft-file F6) :
   * `durée = max(1, floor(base / (1 + CRAFT_SPEED_BONUS × niveau)))`. C'est ici,
   * et pas dans un bonus de rendement, que la spécialisation prend son sens — le
   * spécialiste fait en 20 min ce que le novice fait en 45.
   */
  CRAFT_SPEED_BONUS: 0.15,
  /**
   * BONUS D'ENCEINTE — VITESSE (construction.md R13, table §4bis). Un atelier CLOS+TOITÉ
   * façonne plus vite : la durée de craft est multipliée par ce facteur quand un amas ENCLOS
   * de la fonction `atelier` couvre la station. C'est ce qui PAIE murer+toiter (jusque-là,
   * l'enceinte n'était qu'un drapeau reconnu sans effet). 0,75 = 25 % plus vite — ordre de
   * grandeur, à caler en playtest (la friction reste d'acquérir les matériaux, pas le temps).
   */
  ENCLOSURE_CRAFT_SPEED: 0.75,
  /**
   * BONUS D'ENCEINTE — DURABILITÉ (construction.md R13, table §4bis : « les pièces forgées
   * s'usent moins »). La spec assigne ce bonus à la FORGE, qui ne fait pourtant que des lingots
   * (sans usure) — contradiction résolue par une lecture défendable : un village dont la forge
   * est CLOSE+TOITÉE fait de MEILLEURS outils, qui s'usent moins pour TOUS ses membres (l'usure
   * ×(1−ce facteur)). C'est la moitié FORGE du bonus, symétrique de la VITESSE côté atelier.
   * 0,25 = −25 % d'usure — ordre de grandeur playtest. (Interprétation à valider ; le veto
   * peut la basculer vers un tag-à-l'objet si Alexis préfère.)
   */
  ENCLOSURE_WEAR_REDUCTION: 0.25,
  /** Lignes maximum dans la file : l'écran doit pouvoir la montrer ENTIÈRE (F4). */
  CRAFT_QUEUE_MAX: 6,

  /**
   * LE RENDEMENT EN CHAÎNE (spec recolte-vivante D3/Y2-Y4). La compétence n'est PLUS
   * un `× (1 + 0,04·niveau)` — floté, il s'écrasait dans le `floor` : avec un outil ×2,
   * monter le métier de 0 à 10 laissait le rendement à 2. Deux leviers désormais :
   *
   *  1. La compétence GATE l'usage effectif de l'outil (gate DOUX) : un outil trop bon
   *     pour ton niveau rend comme le meilleur palier que tu maîtrises. `basic` (atelier)
   *     dès `GATE_BASIC_LEVEL`, `iron` (fer) dès `GATE_IRON_LEVEL` ; `crude`/`none`
   *     toujours. Le gate touche le RENDEMENT, jamais l'ACCÈS (`minTool`) — sinon on ne
   *     pourrait jamais miner le fer pour monter `mining` (blocage circulaire).
   *  2. Une MICRO-MARCHE additive et entière (`+1` tous les `SKILL_YIELD_STEP` niveaux),
   *     qui SURVIT au `floor` (contrairement au bonus floté) et remplit le tunnel entre
   *     deux déblocages — l'avantage du spécialiste, sans doubler l'outil.
   *
   * Ordre de grandeur, calibré en playtest (CLAUDE.md).
   */
  SKILL_YIELD_STEP: 8,
  GATE_BASIC_LEVEL: 2,
  GATE_IRON_LEVEL: 5,
  /** Le palier ACIER (T3) exige la maîtrise — au-delà du fer : le meilleur outil du jeu
   *  ne se rend pas à un débutant même s'il en trouve un. (Spec construction R10 : l'acier
   *  est le sommet ; GDD §220 : « le forgeron débloque l'acier ».) */
  GATE_STEEL_LEVEL: 8,

  /** Réduction d'usure par niveau d'artisan (V0-7). Divisée 0.03 → 0.015 : la pente
   *  était trop forte (jusqu'à −75 %), la spécialisation éteignait l'évier d'usure. À
   *  0.015, même un artisan chevronné use ses outils de façon significative. */
  SKILL_WEAR_REDUCTION: 0.015,

  /** Freinage d'XP par la somme des niveaux des AUTRES métiers (spec R14). */
  SKILL_SPREAD_PENALTY: 0.5,

  /** PNJ qui rejoignent un village fondé par un joueur (spec pnj R9). */
  NPC_PER_VILLAGE: 3,

  /** Sous ce seuil de faim, un PNJ va manger (spec pnj R3). */
  NPC_HUNGER_EAT_THRESHOLD: 30,

  /** Sous ce seuil d'énergie, la nuit, un PNJ va dormir. */
  NPC_ENERGY_SLEEP_THRESHOLD: 40,

  /** Sous ce seuil de température, un PNJ lâche sa tâche et rentre au feu (spec IA chaleur).
   *  Sous l'ambiant vallée acte III (50) → la vie normale ne le déclenche pas ; au-dessus de
   *  l'hypothermie (20) avec marge (dérive lente). */
  NPC_COLD_SEEK: 40,
  /** Hystérésis : arrêt de la recherche au retour au confort. */
  NPC_COLD_RESUME: 60,

  /** Énergie perdue par heure de cycle, éveillé. */
  ENERGY_AWAKE_PER_CYCLE_HOUR: 4,

  /** Récupération par heure de cycle en dormant — la maison vaut double (spec R4). */
  SLEEP_RECOVERY_HOME_PER_HOUR: 12,
  SLEEP_RECOVERY_FIRE_PER_HOUR: 6,

  /** Cadence de recalcul du tableau du village (5 s). */
  BOARD_REFRESH_TICKS: ticksFor(5),

  /** Cibles du grenier (spec R5). Score nourriture = baies + 3×ragoûts. */
  VILLAGE_FOOD_TARGET: 12,
  VILLAGE_WOOD_TARGET: 20,
  VILLAGE_STEW_TARGET: 3,

  /** Quantités visées par sortie de récolte PNJ, par item. */
  NPC_CARRY_TARGETS: { berries: 6, wood: 8, fiber: 3, stone: 6, cut_stone: 4 },
} as const

/**
 * L'ÉVOLUTION DES VILLAGES PNJ (spec `village-pnj-evolution.md`, décisions d'Alexis
 * 2026-07-31). PUREMENT ÉCONOMIQUE : aucune clé de jour — le palier de bâti monte à
 * l'aube quand le grenier porte la barre, la prospérité attire les colons. MESURÉ
 * avant chantier : les greniers plafonnaient sur les CIBLES du tableau (bois cloué à
 * 24), pas sur la capacité des bras — ces barres sont donc atteignables dès que le
 * tableau les demande. Magnitudes à calibrer au banc (R11).
 */
export const VILLAGE_GROWTH = {
  /**
   * LE GRENIER D'UN VILLAGE PNJ À SA NAISSANCE (`foundNpcVillage`). De quoi tenir les
   * premiers cycles sans avoir déjà travaillé — c'est ce qui fait qu'un village
   * d'accueil EXISTE au tick 0 au lieu d'être un chantier affamé. Écrit en clair dans
   * `worldgen.ts`, où aucun calibrage ne l'aurait trouvé.
   */
  STOCK_INITIAL: { berries: 10, wood: 10, fiber: 2 } as const,
  /** Rayon (Chebyshev) du DISQUE de l'enceinte — la PALISSADE se dérive sur l'anneau
   *  extérieur (rayon+1), dans le carré du Feu palier 1 (rayon 10). 8 depuis que les
   *  logis font 4×4 (retour d'Alexis, 2026-08-01) : leurs bandes montent à ±8. */
  ENCEINTE_RADIUS: 8,
  /**
   * Les BARRES DE SURPLUS au grenier qui ouvrent chaque palier de bâti (index =
   * palier visé − 2). Nourriture = score baies + 3×ragoût. C'est la SEULE porte :
   * pas de seuil de jour (décision n°2) — le pivot saison-sans-fin ne périme rien.
   */
  STAGE_BARS: [
    { food: 15, wood: 40 }, //           → palier 2 : le hameau de bois
    { food: 25, wood: 30, stone: 20 }, // → palier 3 : le bourg de pierre
  ] as { food: number; wood?: number; stone?: number }[],
  /** Nourriture au grenier qui ATTIRE un colon à l'aube (décision n°3). 18 puis 30 aux
   *  premiers jets — MESURÉ (sonde 12 j, seed 42, deux fois) : à 18 les colons arrivaient
   *  à la simple subsistance et les villages mouraient à J5 ; à 30, un pic de ragoûts
   *  (31-33) suffisait encore à faire entrer une bouche qui mangeait exactement la marge
   *  (mort à J11, quand le témoin sans chantier tient J12 à nourriture 15-20). La
   *  prospérité qui attire est un GRAS que seule une zone riche soutient — la géographie
   *  module la croissance, l'accueil de réfugiés reste le levier fiable partout. */
  ATTRACT_FOOD: 40,
  /** Effectif maximal par palier de bâti — un campement ne loge pas sept personnes.
   *  7 au plafond : c'est le nombre de logis 4×4 que l'enceinte loge en gardant la
   *  ruelle centrale LIBRE du Feu à la porte charretière. */
  POP_CAP: [3, 6, 7],
  /** Récolteurs de bois simultanés quand le chantier a un gros déficit. */
  BIG_DEFICIT_WOOD: 30,
  /**
   * ON NE BÂTIT PAS LE VENTRE VIDE, ET ON NE BRÛLE PAS LA RÉSERVE DU FEU — les deux
   * planchers du chantier, MESURÉS (sonde 12 j, seed 42) : sans eux, la construction
   * siphonnait le grenier jusqu'à `bois 0` (le Feu tombait à sec pendant que les murs
   * montaient) et occupait des bras pendant la famine — trois villages morts à J5.
   * Le tableau ne poste une tâche `build` que si le grenier garde CES planchers
   * APRÈS le coût de la pièce.
   */
  BUILD_FOOD_FLOOR: 16,
  /** 12 → 18 avec l'enceinte-d'abord (R15, calibré au banc) : à 12, le chantier de
   *  l'anneau mangeait la part du Feu ; à 24, l'équilibre de bois d'un village pauvre
   *  (~20-40 au grenier) ne payait plus UNE palissade — l'anneau gelait, tout l'objet
   *  de R15 mourait. 18 laisse le Feu sa marge ET l'anneau son droit de passage. */
  BUILD_WOOD_RESERVE: 18,
  /**
   * LA CADENCE DU CHANTIER — une pièce au plus par fenêtre. MESURÉ (sonde 12 j) :
   * sans cadence, une pièce par rafraîchissement du tableau (~12/min) bâtissait le
   * hameau entier en une matinée — ~250 bois prélevés en deux jours sur une zone
   * qui en régénère ~30, toutes les mains au chantier, la nourriture à zéro, trois
   * villages morts à J5. Deuxième leçon (mesurée aussi, économie pure vs témoin) :
   * à 16 pièces/cycle les villages tenaient 8 jours puis ÉPUISAIENT leur zone
   * (~25-30 bois/jour prélevés en continu > la régénération) — mort à J11 quand le
   * témoin sans chantier tient indéfiniment. À ~7 pièces par cycle, le prélèvement
   * passe sous le débit de la zone et le hameau se monte sur une vingtaine de
   * jours : un ARC DE SAISON, qui est exactement le rythme voulu (« qu'ils
   * évoluent au fur et à mesure du temps »). Multiple de BOARD_REFRESH_TICKS
   * (la fenêtre se teste au rafraîchissement).
   */
  BUILD_PACE_TICKS: ticksFor(420),
  /** LA CADENCE DE L'ENCEINTE (spec R15) — la palissade n'est pas de l'esthétique, c'est
   *  la DÉFENSE : à la cadence commune (420 s), l'anneau de 66 rondins prenait ~10 jours
   *  de plafond théorique et n'était JAMAIS fermé du vivant du village (sonde de siège,
   *  2026-08-17). Plus vite pour elle seule ; le hameau, lui, garde son arc de saison.
   *  CALIBRÉ AU BANC : 120 s asphyxiait l'économie du départ (le chantier dévorait ~130
   *  bois en 3 jours, évinçait la cueillette — Feu affamé au j6, famine, graine 7) ;
   *  240 s laisse l'anneau fermer avant la fenêtre des sièges meurtriers (j13-19) sans
   *  étrangler le bois. Multiple de BOARD_REFRESH_TICKS, comme la cadence commune. */
  BUILD_PACE_TICKS_ENCEINTE: ticksFor(240),
} as const

export interface TerrainDef {
  name: string
  walkable: boolean
  /** Multiplicateur de vitesse de déplacement — de l'équilibrage. */
  speedFactor: number
  /**
   * LE COUVERT (spec chasse C3) : ce qui RESTE de la visibilité d'une menace qui
   * se tient sur cette tuile. 1 = à découvert (prairie rase, neige), 0.5 = on n'y
   * existe presque plus (vieille forêt, roselière). Multiplie la furtivité de
   * TOUTE menace — le chasseur comme le loup qui traque : mêmes règles pour tous.
   */
  cover: number
}

/** Table des terrains. L'id est la valeur stockée dans WorldMap.terrain. */
export const TERRAINS: Record<number, TerrainDef> = {
  0: { name: 'void', walkable: false, speedFactor: 0, cover: 1 },
  1: { name: 'grass', walkable: true, speedFactor: 1, cover: 1 },
  2: { name: 'road', walkable: true, speedFactor: 1.25, cover: 1 },
  3: { name: 'forest', walkable: true, speedFactor: 1, cover: 0.6 }, // plein régime : pas de malus en forêt (décision Alexis 2026-07-18 ; pins/mélèzes/vieille sylve gardent le leur)
  4: { name: 'shallow_water', walkable: true, speedFactor: 0.5, cover: 1 },
  5: { name: 'rock', walkable: false, speedFactor: 0, cover: 1 },
  6: { name: 'deep_water', walkable: false, speedFactor: 0, cover: 1 },
  7: { name: 'wall', walkable: false, speedFactor: 0, cover: 1 },
  8: { name: 'marsh', walkable: true, speedFactor: 0.6, cover: 0.85 },
  9: { name: 'scree', walkable: true, speedFactor: 0.7, cover: 1 },
  /**
   * LA NEIGE EST PRATICABLE — décision d'Alexis, 2026-07-14.
   *
   * Elle était `walkable: false`, et c'était une faute de conception qui se dénonçait
   * elle-même : `TEMPERATURE.BIOME_OFFSET` inflige **−10 sur la neige** — un malus pour qui
   * S'Y TIENT. Or on ne pouvait jamais s'y tenir : **cette ligne était du code mort**, et toute
   * la conception « le froid, prix de la verticalité » était inerte. Avec la roche et le
   * glacier, ça faisait 24 % de la carte en décor peint.
   *
   * Lente (0,5 — on s'enfonce) et mortellement froide : c'est ce qui rend le Névé Blanc
   * possible, et avec lui toute la moitié haute de l'arbre de zones.
   */
  10: { name: 'snow', walkable: true, speedFactor: 0.5, cover: 1 },
  11: { name: 'heath', walkable: true, speedFactor: 0.9, cover: 0.75 },
  12: { name: 'alpine_meadow', walkable: true, speedFactor: 1, cover: 0.9 },
  13: { name: 'pine', walkable: true, speedFactor: 0.85, cover: 0.65 },
  14: { name: 'larch', walkable: true, speedFactor: 0.85, cover: 0.7 },
  15: { name: 'glacier', walkable: false, speedFactor: 0, cover: 1 },
  16: { name: 'boulders', walkable: true, speedFactor: 0.6, cover: 0.8 },
  17: { name: 'flower_meadow', walkable: true, speedFactor: 1, cover: 0.8 },
  18: { name: 'peat_bog', walkable: true, speedFactor: 0.45, cover: 0.9 },
  19: { name: 'reed_marsh', walkable: true, speedFactor: 0.55, cover: 0.5 },
  20: { name: 'alpine_flowers', walkable: true, speedFactor: 1, cover: 0.85 },
  21: { name: 'burnt_forest', walkable: true, speedFactor: 0.9, cover: 0.9 },
  // La futaie ancienne à PLEIN RÉGIME (décision d'Alexis, 2026-08-16 : « il ne faudrait pas
  // que les déplacements soient ralentis à l'intérieur ») — révise la parenthèse du
  // 2026-07-18 qui la laissait à 0,7 : depuis la couronne, le Bois Noir EST de la futaie
  // ancienne, et son intérieur doit se parcourir. Le coût d'y être reste réel, mais il est
  // ailleurs : le couvert (0,5), la litière qui craque, la profondeur. Pins/mélèzes gardent
  // leur 0,85 — Alexis n'a parlé que du dedans des feuillus.
  22: { name: 'old_growth', walkable: true, speedFactor: 1, cover: 0.5 },
  /**
   * LA FALAISE — le mur qui SÉPARE, et le squelette de toute la carte (spec worldgen R2).
   *
   * Elle n'est pas de la roche : la roche est un caillou qu'on contourne, la falaise est une
   * PAROI qu'on longe. La distinction n'est pas cosmétique, elle est le cœur du modèle : une
   * falaise a un **bord**, et un bord se suit. *On ne trouve pas une porte, on suit un mur.*
   * C'est ce qui rachète l'objection qui avait tué les cols (« la porte est introuvable au
   * sol ») — les anciens murs étaient des bandes de roche amorphes de soixante tuiles, sans
   * arête lisible.
   *
   * Le client la dessine comme une paroi, avec son ombre portée : c'est ce qui donne enfin la
   * VERTICALITÉ que le faux-relief (`elevation × RELIEF_H`) n'a jamais su rendre.
   */
  23: { name: 'cliff', walkable: false, speedFactor: 0, cover: 1 },
  /**
   * LE VOCABULAIRE DU PRÉ (spec t0-exploration §2ter, décision d'Alexis 2026-08-15) — trois
   * terrains DÉRIVÉS du socle de la Racine : la saulaie longe l'eau qui coule, la prairie
   * humide est le quantile mouillé de l'humidité, la lande à genévriers son quantile sec.
   * `juniper_heath` est un id NEUF exprès : `heath` reste le mot du gradient sud (« le feu
   * approche ») et du sol des Ruines — deux landes, deux sens (R36).
   */
  24: { name: 'willow', walkable: true, speedFactor: 1, cover: 0.7 },
  25: { name: 'wet_meadow', walkable: true, speedFactor: 0.9, cover: 0.9 },
  26: { name: 'juniper_heath', walkable: true, speedFactor: 1, cover: 0.85 },
}

export const TERRAIN_VOID = 0
export const TERRAIN_GRASS = 1
export const TERRAIN_ROAD = 2
export const TERRAIN_ROCK = 5

export const TERRAIN_FOREST = 3
export const TERRAIN_SHALLOW_WATER = 4
export const TERRAIN_DEEP_WATER = 6
export const TERRAIN_WALL = 7
export const TERRAIN_MARSH = 8
export const TERRAIN_SCREE = 9
export const TERRAIN_SNOW = 10
export const TERRAIN_HEATH = 11
export const TERRAIN_ALPINE_MEADOW = 12
export const TERRAIN_PINE = 13
export const TERRAIN_LARCH = 14
export const TERRAIN_GLACIER = 15
export const TERRAIN_BOULDERS = 16
export const TERRAIN_FLOWER_MEADOW = 17
export const TERRAIN_PEAT_BOG = 18
export const TERRAIN_REED_MARSH = 19
export const TERRAIN_ALPINE_FLOWERS = 20
export const TERRAIN_BURNT_FOREST = 21
export const TERRAIN_OLD_GROWTH = 22
export const TERRAIN_CLIFF = 23
export const TERRAIN_WILLOW = 24
export const TERRAIN_WET_MEADOW = 25
export const TERRAIN_JUNIPER_HEATH = 26

/**
 * VUE DÉRIVÉE du registre (`pieces.ts`) — ce que coûte chaque pièce : pose au marteau,
 * chantier d'un village PNJ, remboursement à la démolition. Pour `wall`/`door`, c'est le
 * coût du palier de matériau de BASE (bois) — les paliers pierre/métal vivent dans
 * `WALL_TIERS` (spec construction R8). NE PAS ÉDITER : éditer `PIECES`.
 */
export const STRUCTURE_COSTS: Record<StructureType, import('./items').ItemBag> = parPiece((t) => piece(t).cout)

export type WallMaterial = 'wood' | 'stone' | 'metal'

/**
 * LES PALIERS DE MATÉRIAU des murs et portes (spec construction R8, §4bis) :
 * bois → pierre maçonnée → métal. Chaque palier monte les PV et coûte plus cher ;
 * on améliore SUR PLACE au marteau (`upgrade_structure`) en payant `upgrade` — la
 * « différence » (R8), moins cher que rebâtir. `wall`/`door` = coût d'une pose
 * NEUVE à ce matériau. La résistance à la dégradation (upkeep R16, différée) montera
 * elle aussi avec le palier. Magnitudes à calibrer.
 */
export const WALL_TIERS: Record<WallMaterial, {
  wall: { hp: number; cost: import('./items').ItemBag }
  door: { hp: number; cost: import('./items').ItemBag }
  /** La « différence » à payer pour ATTEINDRE ce palier depuis le précédent (R8). */
  upgrade: import('./items').ItemBag
}> = {
  // Le palier BOIS reflète exactement `STRUCTURE_HP`/`STRUCTURE_COSTS` (héritage V3).
  wood: { wall: { hp: 200, cost: { wood: 2 } }, door: { hp: 150, cost: { wood: 3 } }, upgrade: {} },
  stone: { wall: { hp: 500, cost: { wood: 2, cut_stone: 3 } }, door: { hp: 375, cost: { wood: 2, cut_stone: 2 } }, upgrade: { cut_stone: 3 } },
  metal: { wall: { hp: 1000, cost: { cut_stone: 3, iron_ingot: 3 } }, door: { hp: 750, cost: { cut_stone: 2, iron_ingot: 2 } }, upgrade: { iron_ingot: 3 } },
}

/** L'ordre des paliers de matériau — on n'améliore que vers le suivant. */
export const WALL_MATERIAL_ORDER: readonly WallMaterial[] = ['wood', 'stone', 'metal']

/**
 * LES COMPOSANTS (spec construction R8, §4bis) — l'atome ACTIF d'une fonction. Une
 * `ComponentType` est aussi une `StructureType` (le composant EST une structure) et
 * a un objet-jumeau du même nom (`ItemId`) qu'on fabrique et pose. Les tranches
 * suivantes (Atelier, Grenier, Ferme) étendent ce type.
 */


/** Coût (recette de l'objet à poser), palier du Feu qui débloque (R6) et PV. À calibrer. */
/**
 * VUE DÉRIVÉE du registre (`pieces.ts`) — les COMPOSANTS, l'atome ACTIF d'une fonction
 * (spec construction R8, §4bis). `cost` est le coût de l'OBJET qu'on fabrique et qu'on
 * pose (`coutObjet`, qui ne diffère du coût de la pièce que pour le four — voir la
 * dérive documentée dans le registre). NE PAS ÉDITER : éditer `PIECES`.
 */
export const COMPONENTS: Record<ComponentType, { cost: import('./items').ItemBag; unlockTier: number; hp: number }> =
  (() => {
    const table = {} as Record<ComponentType, { cost: import('./items').ItemBag; unlockTier: number; hp: number }>
    for (const t of COMPONENT_TYPES) {
      table[t] = { cost: coutObjet(t), unlockTier: piece(t).unlockTier ?? 1, hp: piece(t).pv }
    }
    return table
  })()

/**
 * LE GRENIER (spec construction §4bis) : la CONSERVATION anti-pourriture, branchée
 * sur `SPOIL_CYCLES`. Le facteur MULTIPLIE le temps de péremption d'un aliment rangé
 * dans un conteneur de l'amas : par palier (silo → cave → réserve), et ×`ENCLOSED`
 * en plus si l'amas est clos+toité (bonus « conservation renforcée », R13). À calibrer.
 */
export const GRENIER = {
  PRESERVATION_BY_TIER: [2, 3, 5],
  ENCLOSED_BONUS: 1.5,
} as const

/**
 * LES FONCTIONS ÉMERGENTES (spec construction R9-R10, §4bis). Une fonction émerge
 * d'un AMAS de composants ; son palier = la richesse de l'amas. `recipeByTier[T−1]`
 * = les TYPES de composants requis (cumulatif) pour atteindre le palier T ; le
 * premier élément de `recipeByTier[0]` est le composant PRIMAIRE (il ancre la
 * fonction — identité stable quand on enrichit/appauvrit l'amas). `enclosureBonus` =
 * le bonus thématique quand l'amas est muré + toité (R13) ; `null` = plein air.
 */


/** Le BONUS D'ENCEINTE de chaque fonction (R13) — le seul trait qui ne soit pas
 *  déductible des pièces : il appartient à la fonction, pas à un composant.
 *  `null` = plein air (la Ferme n'en a aucun ; la reconnaissance ne la déclare jamais close). */
const ENCLOSURE_BONUS: Record<FunctionId, string | null> = {
  forge: 'durabilite',
  atelier: 'vitesse',
  grenier: 'conservation',
  ferme: null,
}

/**
 * VUE DÉRIVÉE : `recipeByTier` se CALCULE du registre. Chaque composant y déclare la
 * fonction qu'il sert et le palier auquel il la porte (`fonction` + `palier`), donc le
 * cumulatif « pour atteindre T, il faut tout ce qui est de palier ≤ T » n'a plus à être
 * recopié — et le composant PRIMAIRE (celui de palier 1) tombe en tête tout seul.
 *
 * C'est ce qui rend la promesse de D4 tenable : déclarer `fonction: 'dortoir', palier: 1`
 * sur la paillasse fera émerger le Dortoir sans une ligne de logique neuve.
 */
export const FUNCTIONS: Record<
  FunctionId,
  { recipeByTier: readonly (readonly ComponentType[])[]; enclosureBonus: string | null }
> = (() => {
  const table = {} as Record<
    FunctionId,
    { recipeByTier: readonly (readonly ComponentType[])[]; enclosureBonus: string | null }
  >
  for (const fid of FUNCTION_IDS) {
    // Triés par palier : le composant PRIMAIRE (palier 1) tombe donc en tête tout seul,
    // et `recognizeFunctions` y lit l'ancre de la fonction sans rien recopier.
    const membres = COMPONENT_TYPES.filter((t) => piece(t).fonction === fid).sort((a, b) => palierDe(a) - palierDe(b))
    const paliers = [...new Set(membres.map(palierDe))].sort((a, b) => a - b)
    table[fid] = {
      recipeByTier: paliers.map((p) => membres.filter((t) => palierDe(t) <= p)),
      enclosureBonus: ENCLOSURE_BONUS[fid],
    }
  }
  return table
})()



/**
 * LES TROIS CERCLES (GDD §8bis). Le cercle DOMESTIQUE — le rayon du camp — est
 * « sûr, renouvelable vite, MÉDIOCRE : un village y survit, n'y prospère jamais ».
 * Le cercle sauvage est riche et dangereux.
 *
 * C'était la promesse du GDD, et elle n'était pas codée : les nœuds étaient
 * UNIFORMES partout, donc le meilleur bois était à dix pas du Feu et il n'y avait
 * aucune raison de sortir. C'est ce qui rendait le poids inutile — et c'est
 * pourquoi la géographie vient APRÈS lui : maintenant que s'éloigner coûte, il faut
 * que ça rapporte.
 */
export const CIRCLES = {
  /** Rayon du cercle domestique, en tuiles, autour du point de départ. */
  DOMESTIC_RADIUS: 28,
  /** Au-delà de ce rayon : le cercle sauvage. */
  WILD_RADIUS: 70,
  /** Ce qu'un nœud rend, par cercle. Le domestique nourrit ; il n'enrichit pas. */
  DOMESTIC_STOCK: 0.5,
  CONTESTED_STOCK: 1,
  WILD_STOCK: 1.6,
} as const

export type NodeType =
  | 'tree'
  | 'rock'
  | 'fiber_plant'
  | 'berry_bush'
  /** Le PATCH DE CHAMPIGNONS (cueillette à maîtrise verbe 3) — pousse à l'humide/l'ombre.
   *  Visible de tous (un TRAJET), mais on ne sait le récolter qu'expert (`minForageLevel`). */
  | 'champignon'
  /** Le TAS DE FEUILLES (forêts-vivantes §1) — la fouille du sous-bois, dans la bande du
   *  CORPS des feuillus (la lisière a ses baies, le cœur ses champignons). Se gratte à
   *  mains nues ; les feuilles retombent (renewable). Il donne les VERS — l'appât dédié. */
  | 'leaf_pile'
  | 'iron_vein'
  | 'coal_seam'
  /** LE BLOC D'AFFLEUREMENT (t0-exploration §2sexies R48bis) — « un bloc = une tuile pleine de
   *  non traversable » (Alexis, 2026-08-18). Un cube de roche qui REMPLIT sa tuile, en trois
   *  TAILLES (`tailleDeBloc` — la taille fait le stock : un gros bloc se taille plus longtemps).
   *  Il bloque tant qu'il a du stock — se frayer un passage se CREUSE. Monde réduit seul. */
  | 'bloc'
  // ── LES NŒUDS STRUCTURANTS DES ZONES (spec worldgen R9) — chacun n'existe QUE chez lui ──
  /** La Vieille Sylve : un fût de trois cents ans. Il faut une hache d'atelier pour l'abattre. */
  | 'old_tree'
  /** La Tourbière : la tourbe se lève à la bêche, dans l'eau noire. */
  | 'peat_cut'
  /** Les Hauts Alpages : la carrière. Un bloc, pas un caillou. */
  | 'quarry'
  /** Le Versant Brûlé : un tas de cendre, au pied d'une souche. */
  | 'ash_heap'
  /** La Combe aux Ruines : on FOUILLE des gravats. Ce qu'on en tire est ce que d'autres ont fait. */
  | 'rubble'

/**
 * Les quatre paliers d'outil, ORDONNÉS (spec craft-fortune C4). Le rang décide
 * de ce qu'on OUVRE (les filons), le rendement de ce qu'on RAMÈNE — ce sont deux
 * questions distinctes, et les confondre était le bug latent : `crude` rend
 * autant que `basic` (×2), mais il ne doit ouvrir NI le fer NI le charbon.
 */
export type ToolTier = 'none' | 'crude' | 'basic' | 'iron' | 'steel'
export const TOOL_RANK: Record<ToolTier, number> = { none: 0, crude: 1, basic: 2, iron: 3, steel: 4 }

export interface NodeDef {
  item: import('./items').ItemId
  stock: number
  /** Demi-côté du carré bloquant, en SOUS-TUILES depuis le centre de la tuile
   * (spec économie R1, spec arbres hauts). La tuile `t` couvre les sous-tuiles
   * `[8t, 8t+8)`, son centre est `8t+4`, et le carré bloquant est
   * `[8t+4−h, 8t+4+h)`. `h = 4` → tuile entière ; `h = 0` → ne bloque pas ;
   * `h = 1` → tronc de 0,25 tuile ; `h = 1,5` → 0,375 tuile.
   *
   * DEMI-ENTIER ADMIS, MAIS SEULEMENT SUR UN NŒUD DÉCALÉ. Le test porte sur des index
   * ENTIERS de sous-tuile : à centre entier, une fenêtre demi-ouverte de largeur impaire
   * penche d'un côté — `h = 1,5` sur un centre à `8t+4` bloque `{3,4,5}`, soit un pixel
   * de trop à l'est (vérifié). L'arbre, lui, porte un décalage d'origine continu : sa
   * bande fait toujours 3 sous-tuiles pleines, où que le décalage la pose. D'où 1,5 pour
   * `tree` et 1 pour `old_tree`, qui n'est pas décalé. */
  blockHalfSub: number
  skill: import('./items').SkillId
  /** Famille d'outil qui multiplie le rendement. */
  tool: 'axe' | 'pickaxe' | null
  /**
   * Le palier MINIMAL pour entamer le nœud (spec craft-fortune C5).
   *
   * C'était un booléen « il faut un outil », testé par « rendement > 1 ». Le pic
   * de fortune rendant ×2, il aurait ouvert le fer et le charbon — trois pierres
   * et une corde court-circuitant l'atelier, la forge, et toute la géopolitique
   * de la mine (GDD §8 : la puissance T2 passe OBLIGATOIREMENT par un bâtiment).
   * Les filons exigent donc un outil FORGÉ, pas un caillou ficelé.
   *
   * La PIERRE, elle, reste à `none` pour toujours (C3) : tout outil de fortune
   * est fait de pierre — la gater derrière un outil serait le blocage circulaire
   * que `recolte.md` G13 a déjà refusé pour le marteau.
   */
  minTool: ToolTier
  /**
   * Le niveau de MÉTIER minimal pour entamer le nœud (spec recolte-maitrise verbe 3). Sœur de
   * `minTool` côté SAVOIR, pas outil : le patch de champignons est VISIBLE de tous (un trajet),
   * mais on ne sait reconnaître les bons qu'expert. Absent = aucun palier de savoir (le défaut).
   */
  minForageLevel?: number
  /**
   * CE QUI EST VIVANT REPOUSSE, CE QUI S'EXTRAIT NE REVIENT PAS (décision d'Alexis,
   * 2026-08-06) — et ça ne se lit QUE dans l'emprise d'un village (`nodeDefriche`).
   *
   * Dehors, rien ne change : tout repousse comme avant. Mais on ne défriche pas deux
   * fois le même carré : un tronc abattu, une pierre cassée, un filon vidé chez soi ne
   * reviennent JAMAIS — le bois d'un village vient du dehors, définitivement, et le Feu
   * (évier permanent, `advanceUpkeep`) fait sortir. Les plantes du quotidien, elles,
   * restent : baies, fibre, champignons repoussent sur place, jusque dans le village.
   * C'est le potager qui vient tout seul, et ça ne dispute rien au bois.
   *
   * Absent = le nœud s'extrait (bois, pierre, minerai, tourbe, cendre, gravats).
   */
  renewable?: true
  /**
   * CE QUI VIT SENT LE FROID (spec `flore-froid.md` F7, décision d'Alexis 2026-08-19).
   *
   * Sœur de `renewable`, et DISTINCTE d'elle : `renewable` dit « ça repousse sur place, même
   * défriché », `vivant` dit « c'est de la flore ». L'arbre est vivant SANS être `renewable`
   * (on le défriche chez soi et il ne revient pas) ; la tourbe est `foraging` sans être
   * vivante. Les deux ensembles se croisent, aucun ne contient l'autre.
   *
   * Absent = minéral ou inerte (pierre, fer, charbon, tourbe, cendre, gravats) : le gel n'a
   * aucune prise dessus — un filon ne gèle pas, et `FLORE.SEUIL_GEL` ne le lit jamais.
   */
  vivant?: true
  /**
   * LA CUEILLETTE QUE LE GEL EMPORTE (spec `flore-froid.md` F3, décision d'Alexis
   * 2026-08-20) — baies, champignons, vers : ce que la plante produit FRAIS, et qui n'est
   * simplement plus là sous la neige.
   *
   * **LA FIBRE EN EST EXCLUE, et c'est un choix, pas un oubli.** Ce sont des tiges SÈCHES :
   * elles ne disparaissent pas l'hiver, c'est même la saison où on les ramasse. Et la règle
   * de jeu suit la botanique — `tenue_hiver` coûte 2 fibres, or c'est LA parade au froid
   * d'acte III : la geler ferait fermer au froid sa propre contre-mesure, ce qui n'est pas
   * une difficulté mais une impasse. (L'arbre non plus : le Feu est la survie de l'acte III.)
   *
   * Sous-ensemble strict de `vivant` — la plante, elle, reste bien vivante et sa REPOUSSE
   * gèle comme les autres (F2). C'est son RENDEMENT qui ne gèle pas.
   */
  gelif?: true
}

export const NODE_DEFS: Record<NodeType, NodeDef> = {
  // LE TRONC S'ÉPAISSIT (décision d'Alexis, 2026-07-28) : 1 → 1,5, soit 0,375 tuile (6 px),
  // la largeur de la colonne dessinée (`client/render/arbre-art.ts`, qui confronte les deux).
  tree: { item: 'wood', stock: 10, blockHalfSub: 1.5, skill: 'woodcutting', tool: 'axe', minTool: 'none', vivant: true },
  rock: { item: 'stone', stock: 12, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', minTool: 'none' },
  // Le stock du BLOC est un DÉFAUT : la pose le remplace par celui de sa taille (`tailleDeBloc`
  // — 8/12/18), même patron que `stockDArbre`. La boîte pleine (`blockHalfSub: 4`) fait la règle.
  bloc: { item: 'stone', stock: 12, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', minTool: 'none' },
  fiber_plant: { item: 'fiber', stock: 6, blockHalfSub: 0, skill: 'foraging', tool: null, minTool: 'none', renewable: true, vivant: true },
  berry_bush: { item: 'berries', stock: 8, blockHalfSub: 0, skill: 'foraging', tool: null, minTool: 'none', renewable: true, vivant: true, gelif: true },
  // LE PATCH DE CHAMPIGNONS : cueilli à mains nues (E), mais gaté par le SAVOIR — on ne récolte
  // les bons qu'à `FORAGE_QUALITY_LEVEL` (le novice les voit sans savoir les prendre). Humide/ombre.
  champignon: { item: 'champignons', stock: 6, blockHalfSub: 0, skill: 'foraging', tool: null, minTool: 'none', minForageLevel: BALANCE.FORAGE_QUALITY_LEVEL, renewable: true, vivant: true, gelif: true },
  leaf_pile: { item: 'worms', stock: 4, blockHalfSub: 0, skill: 'foraging', tool: null, minTool: 'none', renewable: true, vivant: true, gelif: true },
  iron_vein: { item: 'iron_ore', stock: 8, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', minTool: 'basic' },
  coal_seam: { item: 'coal', stock: 8, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', minTool: 'basic' },

  // ── LES STRUCTURANTES. Toutes exigent l'outil d'ATELIER (`basic`) : la ressource d'une zone
  //    T1 ne se prend pas à mains nues. L'outil est la porte du palier, pas un bonus — et la
  //    ZONE est la porte de l'outil. Les deux verrous se répondent.
  // Le gros bois GARDE le cœur d'un tronc mince, alors qu'il se dessine bien plus large : il
  // n'a pas de décalage d'origine (un demi-entier lui décentrerait sa bande), et à 30 % de la
  // Vieille Sylve un cœur d'une demi-tuile y rendrait deux voisins infranchissables. On se
  // faufile au pied d'un géant. Voir `client/render/arbre-art.ts` pour la dérogation déclarée.
  old_tree: { item: 'hardwood', stock: 6, blockHalfSub: 1, skill: 'woodcutting', tool: 'axe', minTool: 'basic', vivant: true },
  peat_cut: { item: 'peat', stock: 10, blockHalfSub: 0, skill: 'foraging', tool: null, minTool: 'none' },
  quarry: { item: 'cut_stone', stock: 6, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', minTool: 'basic' },
  ash_heap: { item: 'ash', stock: 8, blockHalfSub: 0, skill: 'foraging', tool: null, minTool: 'none' },
  rubble: { item: 'components', stock: 4, blockHalfSub: 4, skill: 'mining', tool: 'pickaxe', minTool: 'basic' },
}

/** Les trois paliers outillés de chaque famille. Le barème, lui, est `TOOL_YIELD`. */
export const TOOL_TIERS: Record<
  'axe' | 'pickaxe',
  { crude: import('./items').ItemId; basic: import('./items').ItemId; iron: import('./items').ItemId; steel: import('./items').ItemId }
> = {
  axe: { crude: 'crude_axe', basic: 'axe', iron: 'iron_axe', steel: 'steel_axe' },
  pickaxe: { crude: 'crude_pickaxe', basic: 'pickaxe', iron: 'iron_pickaxe', steel: 'steel_pickaxe' },
}

/**
 * Rendement par palier : mains nues ×1, fortune ×2, atelier ×3, fer ×4.
 *
 * QUATRE MARCHES DISTINCTES (spec recolte-vivante Y1, révise craft-fortune C4-C6) :
 * chaque amélioration d'outil se sent AU SAC, plus seulement en accès. L'outil de
 * fortune n'est plus l'ÉGAL de l'atelier — il DÉPANNE : il rend moins (2 < 3), il
 * casse vite (20 coups contre 100, `TOOL_DURABILITIES`) ET il n'ouvre pas les filons.
 * Trois handicaps qui en font ce qu'il doit être : le geste du survivant nu, pas un
 * raccourci vers l'atelier. Le rendement lu est celui du palier EFFECTIF (gaté par la
 * compétence, voir `effectiveTier`), pas forcément celui de l'outil tenu.
 */
export const TOOL_YIELD: Record<ToolTier, number> = { none: 1, crude: 2, basic: 3, iron: 4, steel: 5 }

/**
 * Durabilité par objet — défaut : `BALANCE.TOOL_DURABILITY` (100 coups). Seuls
 * les objets de fortune dérogent : 20 coups. C'est le prix de la couche 1 (C6).
 */
export const TOOL_DURABILITIES: Partial<Record<import('./items').ItemId, number>> = {
  crude_axe: 20,
  crude_pickaxe: 20,
  crude_spear: 20,
  // L'ACIER dure PLUS que le fer (défaut 100) : le palier 3 se sent aussi à l'usure.
  steel_axe: 180,
  steel_pickaxe: 180,
}

/**
 * Valeur nutritive des consommables (spec R9).
 *
 * LE CRU NE NOURRIT PAS UN HOMME. Les baies passent de 15 à 6 : un buisson entier
 * (8 baies) vaut désormais 48 points, soit ~24 minutes de survie — contre 171
 * minutes avant. On ne vit plus de cueillette : on cuisine, donc on a besoin d'un
 * FEU, donc on a besoin de bois, donc on rentre. C'est la boucle qui manquait.
 */
export const FOOD_VALUES: Partial<Record<import('./items').ItemId, number>> = {
  berries: 6,
  champignons: 12, // la trouvaille de l'herboriste (cueillette à maîtrise) : 2× les baies, mais bien sous le cuit
  legume: 6, // le potager (agriculture) : « nourriture de base » (GDD §8), au niveau des baies
  raw_meat: 8,
  quartier: 20, // V0-5 : un gros repas cru (plus que raw_meat) — le gros gibier nourrit longtemps
  cooked_meat: 40,
  stew: 60,
}

/**
 * L'AGRICULTURE — le potager (voie A, spec `agriculture.md`). Le GARDE-FOU (GDD §8bis) : le
 * cercle domestique est « sûr, renouvelable vite, MÉDIOCRE » — un village y SURVIT, n'y
 * PROSPÈRE jamais. Ces nombres sont donc des ORDRES DE GRANDEUR À CALIBRER en playtest ;
 * ils ne doivent JAMAIS faire du potager un remplaçant de la chasse/cueillette (décision T3
 * réservée à Alexis s'il devait dépasser « médiocre »).
 *
 * Déterminisme : la pousse est une fonction PURE du tick sur `Structure.plantedAt` (aucune
 * entité, aucun PRNG) — voir `agriculture.ts`.
 */
export const AGRICULTURE = {
  /** Temps de pousse d'une parcelle (semée → mûre). Long à dessein (médiocre = lent). */
  GROW_TICKS: ticksForCycles(0.5),
  /** Récolte d'une parcelle/serre mûre — modeste, mais au-dessus du coût en graine (un vrai filet). */
  YIELD: 5,
  /** Récolte d'un TERROIR (le meilleur palier de la ferme) : plus généreux, sans être un jackpot. */
  YIELD_TERROIR: 9,
  /** Baies → 1 graine (au Feu) : l'investissement d'amorçage. Forer une fois, semer ensuite. */
  SEED_FROM_BERRIES: 3,
} as const

/**
 * LA PÉREMPTION (spec `evier.md`) — l'évier qui manquait.
 *
 * Rien ne se consommait dans Braises hors l'usure des outils : le grenier était un
 * TAS, pas un flux. Le GDD §8 dit pourtant « une économie de flux, pas de stock —
 * un serveur où tout le monde a plafonné en semaine 2 est mort en semaine 3 ».
 *
 * Modèle repris de Don't Starve, parce qu'il est éprouvé et LISIBLE : frais →
 * rassis → avarié → pourri (l'objet disparaît). Chaque cran divise la valeur
 * nutritive. On ne demande AUCUNE microgestion au joueur : pas de date par objet,
 * pas de tri permanent — une pile a une fraîcheur, elle se voit dans sa case, et
 * elle décide toute seule.
 *
 * La durée est en CYCLES (jours). Un objet absent de cette table ne pourrit pas.
 */
export const SPOIL_CYCLES: Partial<Record<import('./items').ItemId, number>> = {
  worms: 1, // l'appât se pose FRAIS — plus périssable que tout ce qui se mange
  berries: 2,
  champignons: 2, // périssable comme les baies — la trouvaille ne se thésaurise pas
  raw_meat: 1.5, // la viande crue est une bombe à retardement : on la cuit, ou on la perd
  quartier: 1.5, // V0-5 : périme comme la viande crue (le dilemme du retour : poids ET péremption)
  cooked_meat: 4,
  stew: 5,
}

/** Les crans de fraîcheur, et ce qu'ils font à la valeur nutritive. */
export const SPOIL = {
  /** Au-dessus : FRAIS (pleine valeur). */
  STALE_AT: 0.5,
  /** Au-dessus : RASSIS. En dessous : AVARIÉ. À 0 : POURRI — la pile disparaît. */
  SPOILED_AT: 0.2,
  /** Ce que rend un aliment selon son cran (Don't Starve : ⅓ puis ⅙). */
  NUTRITION_STALE: 0.5,
  NUTRITION_SPOILED: 0.2,
} as const

export type RecipeId =
  | 'rope'
  | 'crude_axe'
  | 'crude_pickaxe'
  | 'crude_spear'
  | 'crude_bow'
  | 'bow'
  | 'arrow'
  | 'stew'
  | 'graine'
  | 'axe'
  | 'pickaxe'
  | 'iron_ingot'
  | 'iron_axe'
  | 'iron_pickaxe'
  | 'steel_ingot'
  | 'steel_axe'
  | 'steel_pickaxe'
  | 'spear'
  | 'hammer'
  | 'cooked_meat'
  | 'leather'
  | 'tenue_hiver'
  | 'campfire'
  // Les COMPOSANTS EN OBJET (spec construction R20) : fabriqués au Feu, portés, posés.
  | 'enclume'
  | 'furnace'
  | 'four_acier'
  | 'workshop'
  | 'tour_meca'
  | 'atelier_lourd'
  | 'silo'
  | 'cave'
  | 'reserve'
  | 'parcelle'
  | 'serre'
  | 'terroir'
  | 'chest'

export interface Recipe {
  /**
   * CE QUE LE LIEU DOIT OFFRIR — une CAPACITÉ, plus un objet précis (2026-08-01).
   *
   * `null` = À LA MAIN : nulle part, donc partout (spec craft-fortune C1). Sinon une
   * fonction et son palier minimal : `{fonction:'atelier', niveau:1}` se lit « il me faut
   * un Atelier, au moins N1 », et n'importe quelle station de l'Atelier de rang ≥ 1 y
   * répond. Avant, la recette nommait `'workshop'` : poser une station neuve obligeait
   * alors à revenir éditer les recettes, le libellé client et la liste des stations
   * connues — trois listes pour une seule notion.
   *
   * Le palier haut reste payé par la POSE : le four d'acier et l'atelier lourd exigent le
   * palier 3 du village (`unlockTier`, registre), donc « forge N3 = l'acier » (R10) tient
   * toujours, sans qu'aucune recette n'ait à le savoir.
   */
  requiert: import('./pieces').Exigence | null
  inputs: import('./items').ItemBag
  output: import('./items').ItemId
  /**
   * LE LOT — combien d'unités une exécution rend. Absent = 1.
   *
   * Le champ avait été RETIRÉ avant livraison, exprès : aucune des 34 recettes n'en
   * produisait, il n'aurait eu que des lecteurs et jamais d'auteur. La note d'alors
   * disait « il revient avec la première recette par lot, et pas avant » —
   * **c'est la FLÈCHE** (spec `tir.md` T9). On ne taille pas une flèche, on en taille
   * cinq : un consommable qui se fabrique à l'unité serait une corvée, pas une économie.
   */
  count?: number
  /**
   * Le TEMPS DE TRAVAIL d'une unité, en secondes (spec craft-file F5). Le craft
   * n'est plus instantané : il entre dans une file, et le tick la fait descendre.
   * En secondes et non en ticks — comme tout le reste de ce fichier, la conversion
   * passe par `ticksFor` : changer TICK_RATE_HZ ne doit rien recalibrer à la main.
   */
  seconds: number
}

/**
 * LES CINQ EXIGENCES DE LIEU, nommées une fois. Ce sont les seules qu'un catalogue de
 * trente-quatre recettes emploie, et les nommer rend la table LISIBLE : on lit « il faut
 * un Atelier N1 », pas un objet de mobilier dont il faudrait connaître le rang.
 */
const FEU = { fonction: 'feu', niveau: 1 } as const
const FORGE_N2 = { fonction: 'forge', niveau: 2 } as const
const FORGE_N3 = { fonction: 'forge', niveau: 3 } as const
const ATELIER_N1 = { fonction: 'atelier', niveau: 1 } as const
const ATELIER_N3 = { fonction: 'atelier', niveau: 3 } as const

/** Chaînes ≤ 3 étapes, stations distinctes (GDD §8, spec R10-R11). */
export const RECIPES: Record<RecipeId, Recipe> = {
  /**
   * LE FEU DE CAMP — un OBJET qu'on fabrique à mains nues, puis qu'on pose au sol
   * (action `place_campfire`). Même prix que l'ancien `light_fire` (10 bois) : on
   * n'a pas rendu le feu plus cher, on a séparé le fabriquer/porter/poser de
   * l'allumer-ici. `requiert: null` — le survivant nu doit pouvoir se chauffer.
   */
  campfire: { requiert: null, inputs: { wood: 10 }, output: 'campfire', seconds: 6 },
  // LE COFFRE EN OBJET (décision d'Alexis) : fabriqué à la main, posé comme un
  // composant — plus jamais au marteau. Coût inchangé (`STRUCTURE_COSTS.chest`).
  chest: { requiert: null, inputs: { wood: 4 }, output: 'chest', seconds: 6 },

  // ── La couche 1 : à mains nues, sans poste, dès la minute 0 (spec craft-fortune).
  // Tout y passe par la CORDE : le goulot est volontaire (C8) — la fibre cesse
  // d'être ce qu'on ramasse sans y penser, et le cueilleur a un client tout de suite.
  rope: { requiert: null, inputs: { fiber: 3 }, output: 'rope', seconds: 3 },
  crude_axe: { requiert: null, inputs: { wood: 2, stone: 3, rope: 1 }, output: 'crude_axe', seconds: 5 },
  crude_pickaxe: { requiert: null, inputs: { wood: 3, stone: 2, rope: 1 }, output: 'crude_pickaxe', seconds: 5 },
  crude_spear: { requiert: null, inputs: { wood: 3, stone: 1, rope: 1 }, output: 'crude_spear', seconds: 5 },
  // ── LE TIR (spec `tir.md` T9) ──
  // L'ARC DE FORTUNE est de la couche 1 : une branche et deux cordes, sans poste. Il coûte
  // DEUX cordes quand l'épieu n'en coûte qu'une — la corde est le goulot volontaire de la
  // couche 1 (craft-fortune C8), et c'est là que se paie l'allonge.
  crude_bow: { requiert: null, inputs: { wood: 2, rope: 2 }, output: 'crude_bow', seconds: 6 },
  // L'ARC LONG à l'atelier : il PAIE l'installation, au rang de la lance.
  bow: { requiert: ATELIER_N1, inputs: { wood: 4, rope: 2, fiber: 2 }, output: 'bow', seconds: 10 },
  // LA FLÈCHE RESTE COUCHE 1, ET PAR LOT DE CINQ : on en fabrique en boucle, quel que soit
  // l'arc, et toute flèche décochée se ramasse (T6) — le stock est un investissement qu'on
  // va rechercher sur le terrain, pas un consommable qui s'évapore.
  arrow: { requiert: null, inputs: { wood: 1, stone: 1, fiber: 1 }, output: 'arrow', count: 5, seconds: 4 },

  stew: { requiert: FEU, inputs: { berries: 4, fiber: 1 }, output: 'stew', seconds: 8 },
  // LA GRAINE (agriculture voie A) : des baies deviennent une semence, au Feu. L'amorçage du
  // potager — cueillir une fois, semer ensuite. Se pose ensuite dans une parcelle (`plant`).
  graine: { requiert: FEU, inputs: { berries: AGRICULTURE.SEED_FROM_BERRIES }, output: 'graine', seconds: 4 },
  axe: { requiert: ATELIER_N1, inputs: { wood: 5, stone: 3, fiber: 2 }, output: 'axe', seconds: 8 },
  pickaxe: { requiert: ATELIER_N1, inputs: { wood: 5, stone: 3, fiber: 2 }, output: 'pickaxe', seconds: 8 },
  iron_ingot: { requiert: FORGE_N2, inputs: { iron_ore: 2, coal: 1 }, output: 'iron_ingot', seconds: 10 },
  iron_axe: { requiert: ATELIER_N1, inputs: { iron_ingot: 2, wood: 2 }, output: 'iron_axe', seconds: 12 },
  iron_pickaxe: { requiert: ATELIER_N1, inputs: { iron_ingot: 2, wood: 2 }, output: 'iron_pickaxe', seconds: 12 },
  // L'ACIER (V2-17, spec construction R10, GDD §372) — le T3, ce qui PAIE le palier 3 :
  // le lingot se fond au FOUR D'ACIER (forge N3), les outils se façonnent à l'ATELIER LOURD
  // (atelier N3). Chaque station exige le palier 3 du village pour être posée (unlockTier 3),
  // donc l'acier est bien « l'événement pour tout le village » (GDD §220). Plus cher, plus long.
  steel_ingot: { requiert: FORGE_N3, inputs: { iron_ingot: 2, coal: 2 }, output: 'steel_ingot', seconds: 16 },
  steel_axe: { requiert: ATELIER_N3, inputs: { steel_ingot: 2, wood: 2 }, output: 'steel_axe', seconds: 16 },
  steel_pickaxe: { requiert: ATELIER_N3, inputs: { steel_ingot: 2, wood: 2 }, output: 'steel_pickaxe', seconds: 16 },
  spear: { requiert: ATELIER_N1, inputs: { wood: 4, stone: 2, fiber: 1 }, output: 'spear', seconds: 8 },
  // LE MARTEAU SE FORGE AU FEU, PAS À L'ATELIER — et ce n'est pas un détail : bâtir
  // exige déjà un village, donc un Feu allumé. Le mettre à l'atelier créerait un
  // blocage circulaire (il faudrait bâtir l'atelier pour pouvoir bâtir). Au Feu, il
  // n'ajoute AUCUNE porte : qui peut bâtir peut le forger.
  hammer: { requiert: FEU, inputs: { wood: 4, stone: 2, fiber: 2 }, output: 'hammer', seconds: 8 },
  cooked_meat: { requiert: FEU, inputs: { raw_meat: 1 }, output: 'cooked_meat', seconds: 5 },
  // LA CHAÎNE DU CUIR (spec cuir) — au Feu, pas de station neuve (réutilise le Feu).
  // Le tannage sèche la peau brute ; la couture assemble la tenue d'hiver, la seule
  // protection contre le froid létal d'acte III. La chasse propre irrigue la survie.
  leather: { requiert: FEU, inputs: { raw_hide: 1, fiber: 1 }, output: 'leather', seconds: 8 },
  tenue_hiver: { requiert: FEU, inputs: { leather: 3, fiber: 2 }, output: 'tenue_hiver', seconds: 12 },
  // Les COMPOSANTS EN OBJET (spec construction R20) : assemblés AU FEU, coût =
  // `COMPONENTS[type].cost`. On les pose ensuite (`place_component`) pour faire émerger
  // une fonction. Le four garde sa station-jumelle de fusion (`furnace`) à la pose.
  enclume: { requiert: FEU, inputs: COMPONENTS.enclume.cost, output: 'enclume', seconds: 12 },
  furnace: { requiert: FEU, inputs: COMPONENTS.furnace.cost, output: 'furnace', seconds: 12 },
  four_acier: { requiert: FEU, inputs: COMPONENTS.four_acier.cost, output: 'four_acier', seconds: 16 },
  workshop: { requiert: FEU, inputs: COMPONENTS.workshop.cost, output: 'workshop', seconds: 12 },
  tour_meca: { requiert: FEU, inputs: COMPONENTS.tour_meca.cost, output: 'tour_meca', seconds: 14 },
  atelier_lourd: { requiert: FEU, inputs: COMPONENTS.atelier_lourd.cost, output: 'atelier_lourd', seconds: 16 },
  silo: { requiert: FEU, inputs: COMPONENTS.silo.cost, output: 'silo', seconds: 10 },
  cave: { requiert: FEU, inputs: COMPONENTS.cave.cost, output: 'cave', seconds: 14 },
  reserve: { requiert: FEU, inputs: COMPONENTS.reserve.cost, output: 'reserve', seconds: 16 },
  parcelle: { requiert: FEU, inputs: COMPONENTS.parcelle.cost, output: 'parcelle', seconds: 8 },
  serre: { requiert: FEU, inputs: COMPONENTS.serre.cost, output: 'serre', seconds: 12 },
  terroir: { requiert: FEU, inputs: COMPONENTS.terroir.cost, output: 'terroir', seconds: 16 },
}

/**
 * LA FORME D'UN COUP — ce que la sim frappe VRAIMENT.
 *
 * Avant, tout le monde frappait pareil : un arc de 90° à 1,4 tuile, 0,4 s d'armement,
 * et l'arme ne changeait QUE les dégâts. Une lance touchait donc à la même distance
 * qu'un poing, et un télégraphe honnête n'avait qu'une chose à dire de chaque arme :
 * rien. C'est la géométrie qui porte l'identité d'une arme, pas son chiffre.
 *
 * Deux primitives suffisent à tout ce que le combat demande :
 *   · `cone` — un secteur depuis le corps. `arcCos = 1` → une ligne (le pic de la
 *     lance) ; `0` → ±90° ; `-1` → 360° (le tourbillon de hache). Un seul test.
 *   · `disc` — un disque posé DEVANT, à `range` du corps (l'overhead à deux poings
 *     qui s'écrase au sol).
 *
 * La portée est mesurée CENTRE À CENTRE, comme la sim : deux corps qui se touchent
 * ont leurs centres à `AVATAR_HITBOX_TILES` (0,75) l'un de l'autre. Tout s'ancre là —
 * un poing porte à un bras (1,1), une lance à deux mètres de bois (2,3).
 */
export interface Strike {
  shape: 'cone' | 'disc'
  /** Cône : portée depuis le centre du corps. Disque : distance de son CENTRE. */
  range: number
  /** Cône : cosinus du DEMI-angle (1 = une ligne, 0 = ±90°, −1 = tout le tour). */
  arcCos: number
  /** Disque : son rayon. Ignoré par le cône. */
  radius: number
  damage: number
  stamina: number
  windupTicks: number
  /**
   * LA RÉCUPÉRATION, ET ELLE EST À DEUX VALEURS. Le coup qui MORD rend la main ;
   * celui qui fend l'air laisse à découvert. C'est le whiff qui punit — jamais le
   * fait d'avoir chargé. Un coup chargé qui touche est un investissement qui paie ;
   * raté, c'est une seconde de trop, immobile, devant un loup.
   * `0` = « je n'impose rien » (les monstres tiennent leur cadence de MONSTER_DEFS).
   */
  recoveryHit: number
  recoveryWhiff: number
  /** LE PAS : distance parcourue pendant l'armement, en tuiles. On avance en frappant. */
  lunge: number
  /** Le pas DÉVIE, gauche/droite/gauche… (les poings dansent). `false` = tout droit. */
  weave: boolean
  /**
   * LE TRAIT NE PREND QU'UN CORPS (spec `tir.md` T4). Un cône qui embroche quatre loups
   * n'est pas une flèche : la cible est LA PLUS PROCHE DU TIREUR parmi celles de la zone,
   * et un allié planté dans l'axe la mange. C'est ce qui rend une ligne de tir *dégagée*
   * signifiante.
   *
   * Porté par le `Strike` et non par l'arme : rien n'interdit demain une volée qui ne le
   * porte pas, ni un coup de mêlée qui ne prendrait qu'un corps.
   */
  single?: true
}

/** Les deux coups d'une arme, et le temps de maintien qui bascule de l'un à l'autre. */
export interface WeaponProfile {
  light: Strike
  charged: Strike
  /** Ticks de maintien du clic à partir desquels le coup part CHARGÉ. */
  chargeTicks: number
  /**
   * ARME DE TIR (spec `tir.md` T1). Trois conséquences, et elles tiennent toutes à ce
   * seul booléen — c'est pourquoi il vit sur l'ARME et non sur le coup :
   *   · le geste est au clic DROIT (lever l'arc), le clic gauche décoche (T2) ;
   *   · elle consomme une `arrow` et ne se bande pas sans (T6) ;
   *   · **elle ne frappe pas** (décision d'Alexis, T2) : pas de coup de crosse, aucun
   *     corps à corps. Un archer serré de près a la ceinture, pas un bouton.
   * Elle exige aussi une ligne dégagée, et ne repousse rien (T5, T10).
   */
  ranged?: true
}

export type WeaponKind = 'unarmed' | 'crude_spear' | 'spear' | 'iron_axe' | 'steel_axe' | 'crude_bow' | 'bow'

/** Cosinus tabulés — `Math.cos` est interdit dans /sim (invariant §2, moteurs JS). */
const COS_3 = 0.9986
const COS_7 = 0.9925
const COS_8 = 0.9903
const COS_10 = 0.9848
const COS_12 = 0.9781
const COS_22 = 0.9272
const COS_24 = 0.9135
const COS_50 = 0.6428
const COS_60 = 0.5

/**
 * LES TROIS ARMES, ET LEUR VÉRITÉ (décision utilisateur 2026-07-13).
 *
 *   · LES POINGS — rapides, courts, et ils AVANCENT : chaque coup fait un pas, en
 *     zigzag. On ne rate pas de beaucoup, mais on ne fait mal à personne. Chargés :
 *     un overhead à deux mains qui s'abat sur un disque au sol — le geste du
 *     désespoir, quand deux zombies vous collent et qu'on n'a rien en main.
 *   · LA LANCE — l'ALLONGE. Un pic étroit : on tient le loup à distance, on frappe
 *     avant d'être mordu. Mais un raté est un VRAI raté (l'arc est fin), et le pic
 *     chargé emmène le corps en avant : s'il ne trouve pas de chair, on reste planté.
 *   · LA HACHE — le gros coup lent qui BALAIE. Arc large : elle prend deux corps
 *     serrés là où la lance n'en sort qu'un. Chargée, elle fait le tour complet.
 *
 * La lance garde sa raison d'être face à la hache (l'allonge), la hache garde la
 * sienne (la horde). Ce n'est pas une échelle de puissance, c'est un choix.
 *
 * SUR LES DEUX CÔNES DE LA LANCE (±22° simple, ±10° chargé) : le pic chargé DOIT être
 * fin — c'est lui qui punit le raté, et un engagement qu'on ne peut pas rater n'en est
 * pas un. Mais le coup SIMPLE, lui, est l'outil du quotidien : à ±14° (premier jet),
 * il ratait un sanglier qui bronchait à un mètre. Une arme dont le coup de base est
 * une loterie n'est pas « exigeante », elle est cassée.
 */
export const WEAPON_PROFILES: Record<WeaponKind, WeaponProfile> = {
  unarmed: {
    light: {
      shape: 'cone',
      range: 1.1,
      arcCos: COS_50,
      radius: 0,
      damage: 6,
      stamina: 8,
      windupTicks: ticksFor(0.2),
      recoveryHit: ticksFor(0.25),
      recoveryWhiff: ticksFor(0.45),
      lunge: 0.35,
      weave: true,
    },
    charged: {
      shape: 'disc',
      range: 1.2,
      arcCos: 0,
      radius: 0.9,
      damage: 18,
      stamina: 26,
      windupTicks: ticksFor(0.4),
      recoveryHit: ticksFor(0.5),
      recoveryWhiff: ticksFor(1.2),
      lunge: 0.5,
      weave: false,
    },
    chargeTicks: ticksFor(0.55),
  },
  crude_spear: {
    light: {
      shape: 'cone',
      range: 1.9,
      arcCos: COS_24,
      radius: 0,
      damage: 10,
      stamina: 13,
      windupTicks: ticksFor(0.4),
      recoveryHit: ticksFor(0.35),
      recoveryWhiff: ticksFor(0.65),
      lunge: 0.2,
      weave: false,
    },
    charged: {
      shape: 'cone',
      range: 2.5,
      arcCos: COS_10,
      radius: 0,
      damage: 20,
      stamina: 28,
      windupTicks: ticksFor(0.4),
      recoveryHit: ticksFor(0.5),
      recoveryWhiff: ticksFor(1.3),
      lunge: 2.2,
      weave: false,
    },
    chargeTicks: ticksFor(0.65),
  },
  spear: {
    light: {
      shape: 'cone',
      range: 2.3,
      arcCos: COS_22,
      radius: 0,
      damage: 16,
      stamina: 15,
      windupTicks: ticksFor(0.45),
      recoveryHit: ticksFor(0.4),
      recoveryWhiff: ticksFor(0.7),
      lunge: 0.2,
      weave: false,
    },
    charged: {
      shape: 'cone',
      range: 3.1,
      arcCos: COS_10,
      radius: 0,
      damage: 32,
      stamina: 32,
      windupTicks: ticksFor(0.4),
      recoveryHit: ticksFor(0.55),
      recoveryWhiff: ticksFor(1.5),
      // LA CHARGE : le corps parcourt TROIS TUILES ET DEMIE — 8 tuiles/s, le double de
      // la marche. Ce n'est plus un pas, c'est un ENGAGEMENT : on ferme la distance et
      // on embroche. Elle TRAVERSE ce qui est trop proche (décision utilisateur) : le
      // coup se résout à l'arrivée, donc une cible collée finit dans le dos et le pic
      // fend l'air. La charge est une arme de DISTANCE — mal jugée, elle cloue sur place
      // (`recoveryWhiff`, 1,5 s). C'est le prix, et il se voit.
      lunge: 3.2,
      weave: false,
    },
    chargeTicks: ticksFor(0.7),
  },
  iron_axe: {
    light: {
      shape: 'cone',
      range: 1.5,
      arcCos: COS_60,
      radius: 0,
      damage: 14,
      stamina: 18,
      windupTicks: ticksFor(0.55),
      recoveryHit: ticksFor(0.45),
      recoveryWhiff: ticksFor(0.8),
      lunge: 0.25,
      weave: false,
    },
    charged: {
      // LE TOURBILLON : un cône de 360°, donc pas une troisième géométrie. Et une zone
      // LARGE — 2,6 tuiles tout autour du corps. À 1,8 (premier jet) il ne se distinguait
      // pas du disque des poings : deux ellipses de même taille, et le joueur ne lisait
      // plus rien. Ce qui sépare deux coups, c'est ce qu'on VOIT au sol, pas leur nom.
      shape: 'cone',
      range: 2.6,
      arcCos: -1,
      radius: 0,
      damage: 24,
      stamina: 34,
      windupTicks: ticksFor(0.5),
      recoveryHit: ticksFor(0.6),
      recoveryWhiff: ticksFor(1.6),
      lunge: 0,
      weave: false,
    },
    chargeTicks: ticksFor(0.8),
  },
  // L'ACIER (V2-17) : la hache de fer, mais qui MORD plus fort — le sommet de l'arsenal du
  // survivant. Même géométrie (on ne réapprend pas le geste), dégâts au-dessus du fer.
  steel_axe: {
    light: {
      shape: 'cone',
      range: 1.5,
      arcCos: COS_60,
      radius: 0,
      damage: 18,
      stamina: 18,
      windupTicks: ticksFor(0.55),
      recoveryHit: ticksFor(0.45),
      recoveryWhiff: ticksFor(0.8),
      lunge: 0.25,
      weave: false,
    },
    charged: {
      shape: 'cone',
      range: 2.6,
      arcCos: -1,
      radius: 0,
      damage: 30,
      stamina: 34,
      windupTicks: ticksFor(0.5),
      recoveryHit: ticksFor(0.6),
      recoveryWhiff: ticksFor(1.6),
      lunge: 0,
      weave: false,
    },
    chargeTicks: ticksFor(0.8),
  },

  // ═══ LES DEUX ARCS (spec `tir.md` T9, décision d'Alexis) ═══
  //
  // L'archerie a une progression, comme les haches. Et les deux arcs suivent la MÊME
  // grammaire que le reste (`light` = le tir sec, `charged` = le tir bandé, `chargeTicks`
  // bascule) : le clic bref est une corde à peine tirée, le maintien est la bande pleine.
  //
  // Ce qui les distingue de toute autre arme tient en deux champs — `ranged` et `single` —
  // et non en une mécanique de plus. Le reste (endurance, armement, récupération, blessures,
  // sang, usure, coup propre) tombe des règles déjà écrites.
  //
  // LA GÉOMÉTRIE FAIT L'IDENTITÉ (R4bis) : le tir bandé n'est pas « le tir sec en plus
  // fort », c'est un cône QUI SE RESSERRE (±8° → ±3°) en s'allongeant (6 → 16,5 tuiles).
  // Viser devient un problème de géométrie, jamais un jet de dé.
  //
  // ═══ ET LA PORTÉE MONTE AVEC LA BANDE, LINÉAIREMENT (décision d'Alexis, 2026-08-02) ═══
  //
  // Les deux `range` ci-dessous ne sont plus deux valeurs mais les DEUX BOUTS D'UNE PENTE :
  // à corde molle on porte à `light.range`, à pleine bande à `charged.range`, et tout ce
  // qui est entre les deux s'interpole (`porteeBandee`, combat.ts). C'est ce qui donne à la
  // bande une lecture CONTINUE : on ne choisit plus entre deux coups, on choisit une
  // DISTANCE — et le télégraphe, qui dessine la zone réelle, la montre s'allonger.
  //
  // LA PORTÉE A ÉTÉ HALVÉE le 2026-08-02 (décision d'Alexis, « diminue la distance de tir
  // de moitié ») : elle était montée à 12/33, elle redescend à 6/16,5. Le nombre qui compte
  // est 16,5 — c'est très exactement CE QU'ON PEUT VOIR : le demi-écran vertical vaut 10
  // tuiles et la caméra de visée en ajoute jusqu'à 6 (`LOOKAHEAD_MAX_TILES`). À pleine
  // bande, le point de chute arrive donc au BORD du champ visible, et non deux écrans plus
  // loin. On tire au bout de son regard, ce qui est le bon endroit pour un arc.
  crude_bow: {
    // L'ARC DE FORTUNE — une branche et de la corde, dès la première nuit.
    //
    // IL EST SOUS L'ÉPIEU TAILLÉ EN DÉGÂTS (8 contre 10) et très au-dessus en portée
    // (5 contre 1,9) : c'est un ÉCHANGE, pas une domination — sans quoi le premier soir
    // changerait d'arme et tout le calibrage de la nuit 1 serait à refaire. Le sanglier
    // (30 PV) ne tombe PAS d'un tir de fortune, même propre (8 × 3 = 24) : il tombe
    // blessé et SAIGNANT. L'arc de fortune n'abat pas — il OUVRE une traque (chasse C8).
    light: {
      shape: 'cone',
      range: 3,
      arcCos: COS_12,
      radius: 0,
      damage: 3,
      stamina: 4,
      windupTicks: ticksFor(0.15),
      recoveryHit: ticksFor(0.45),
      recoveryWhiff: ticksFor(0.6),
      lunge: 0,
      weave: false,
      single: true,
    },
    charged: {
      shape: 'cone',
      range: 7.5,
      arcCos: COS_7,
      radius: 0,
      damage: 8,
      stamina: 10,
      windupTicks: ticksFor(0.2),
      recoveryHit: ticksFor(0.6),
      recoveryWhiff: ticksFor(0.95),
      lunge: 0,
      weave: false,
      single: true,
    },
    // TRÈS LENT À BANDER — c'est de la ficelle et une branche verte. 1,3 s : à 1,3 t/s,
    // un Cendreux couvre les 5 tuiles en 3,8 s, soit DEUX tirs placés avant le contact
    // pour 20 PV et 8 de dégâts. Il ne le solde pas ; la première nuit reste dure.
    chargeTicks: ticksFor(1.3),
    ranged: true,
  },
  bow: {
    // L'ARC LONG (palier 2) — ce qui PAIE l'installation, au moment où le grenier
    // réclame du gros gibier.
    //
    // ONZE TUILES, ET C'EST DÉLIBÉRÉMENT PLUS LOIN QU'ON NE VOIT : le demi-écran vertical
    // vaut 10 tuiles (`VISIBLE_TILES_TALL` = 20). Tirer à pleine portée EXIGE donc la
    // caméra de visée (client R11, jusqu'à 6 tuiles de décalage) — la portée et le geste
    // sont calibrés l'un sur l'autre, ce n'est pas un débordement.
    //
    // Le loup (35 PV, 4,8 t/s) NE TOMBE PAS d'un tir bandé (26) : il couvre les 11 tuiles
    // en ~2,3 s, soit un bandé plus un sec avant le contact, et un raté coûte 1,1 s —
    // presque la moitié de sa course. L'arc donne une ouverture, il ne rend pas la meute
    // décorative. Le cerf (45), lui, tombe d'un tir bandé PROPRE (78) : la promesse de
    // chasse C6, portée à distance.
    light: {
      shape: 'cone',
      range: 6,
      arcCos: COS_8,
      radius: 0,
      damage: 8,
      stamina: 6,
      windupTicks: ticksFor(0.15),
      recoveryHit: ticksFor(0.4),
      recoveryWhiff: ticksFor(0.5),
      lunge: 0,
      weave: false,
      single: true,
    },
    charged: {
      shape: 'cone',
      range: 16.5,
      arcCos: COS_3,
      radius: 0,
      damage: 26,
      stamina: 18,
      windupTicks: ticksFor(0.25),
      recoveryHit: ticksFor(0.6),
      recoveryWhiff: ticksFor(1.1),
      lunge: 0,
      weave: false,
      single: true,
    },
    chargeTicks: ticksFor(0.9),
    ranged: true,
  },
}

/**
 * Dégâts des armes portées — mains nues : COMBAT.UNARMED_DAMAGE. DÉRIVÉ des profils :
 * une seule source de vérité, sinon les deux tables divergent au premier réglage.
 * Sert aussi de REGISTRE : ce qui figure ici est une arme (un outil ne l'est pas).
 */
export const WEAPON_DAMAGE: Partial<Record<import('./items').ItemId, number>> = {
  spear: WEAPON_PROFILES.spear.light.damage,
  iron_axe: WEAPON_PROFILES.iron_axe.light.damage,
  steel_axe: WEAPON_PROFILES.steel_axe.light.damage,
  // L'épieu taillé se glisse entre les mains nues (6) et la lance (16), à 10 : une
  // réponse au loup et au sanglier dès la première nuit, sans rendre la lance
  // inutile — elle frappe 60 % plus fort et tient cinq fois plus (spec C9).
  crude_spear: WEAPON_PROFILES.crude_spear.light.damage,
  // LES ARCS Y FIGURENT, et c'est ce qui leur donne l'USURE au tir (`combat.ts`, la
  // garde `WEAPON_DAMAGE[held.item] !== undefined`) : une corde se fatigue.
  //
  // ⚠ MAIS LE NOMBRE INSCRIT EST UN CHIFFRE DE TIR, PAS DE MÊLÉE, et cette table sert
  // aussi de BARÈME DE DANGEROSITÉ à `equipBestWeapon` (npc.ts). Un PNJ qui n'aurait
  // qu'un arc s'en équiperait — et, puisqu'un arc ne frappe pas (spec `tir.md` T2), il
  // marcherait au Cendreux SANS DÉFENSE. L'exclusion est posée là-bas, dans le barème,
  // pas ici : tant qu'aucune IA ne sait tirer, aucune IA ne s'arme d'un arc.
  crude_bow: WEAPON_PROFILES.crude_bow.light.damage,
  bow: WEAPON_PROFILES.bow.light.damage,
}

/**
 * Une arme de TIR ? (spec `tir.md` T1) — la question se pose partout, elle se lit ici.
 *
 * Elle accepte un objet QUELCONQUE et non le seul `WeaponKind` : ses deux appelants sont
 * le combat (qui tient un `WeaponKind`) et le barème d'équipement du PNJ (qui balaie un
 * sac entier, tourbe comprise). Un `?.` plutôt qu'un `!` — sans lui, demander « ce
 * caillou est-il un arc ? » ferait planter le tri d'inventaire d'un PNJ.
 */
export function isRangedWeapon(item: WeaponKind | import('./items').ItemId): boolean {
  return WEAPON_PROFILES[item as WeaponKind]?.ranged === true
}

/**
 * UN SEUL MORT-VIVANT (spec `cendreux.md` R1, décision 2026-07-31). Le `zombie` a été retiré
 * du bestiaire : le monde ne porte pas deux morts-vivants avec deux lores — celui du GDD et
 * le Cendreux de la direction A×C. Partout où une horde marchait, ce sont des Cendreux.
 */
export type MonsterType = 'boar' | 'cendreux' | 'rabbit' | 'deer' | 'wolf'

/**
 * Le RYTHME d'une bête (spec faune R10). C'est ce qui donne une identité à
 * l'heure : le jour appartient aux cerfs, la nuit aux sangliers et aux loups,
 * et les lisières du jour aux lapins. Sortir de nuit n'est alors plus une
 * question d'éclairage — c'est une question de qui est réveillé.
 */
export type Activity = 'diurnal' | 'nocturnal' | 'crepuscular'

/**
 * Tailles de sac (spec inventaire R7). La longueur du tableau EST la capacité.
 *
 * DÉCLARÉ ICI, AVANT SES LECTEURS, et ce n'est pas cosmétique : `MONSTER_DEFS` lit
 * `SLOTS.NPC` dans son littéral, donc à l'ÉVALUATION du module. Placé plus bas, il
 * tombait dans sa zone morte temporelle — « Cannot access 'SLOTS' before
 * initialization » au premier import, et `tsc` ne disait RIEN. Une constante lue par
 * une autre constante du même fichier doit la précéder ; l'ordre est ici une règle,
 * pas un rangement.
 */
export const SLOTS = {
  /** Les N premières cases du sac du joueur SONT la ceinture (la hotbar). */
  BELT: 6,
  PLAYER: 18,
  /** Les PNJ ont un GRAND sac : ils portent une journée de corvées sans buter sur
   *  leur borne. Ils la voient quand même (npc.ts TASK_INTAKE, handleHunger) —
   *  sinon un sac plein les figerait. Une DONNÉE, pas une règle à part : la sim
   *  n'a qu'un seul jeu de règles. */
  NPC: 40,
  /** La taille d'un coffre est une propriété de la PIÈCE : elle vit dans le registre. */
  CHEST: CAPACITE_COFFRE,
  /** Le conteneur d'un composant de Grenier (silo/cave/réserve) : plus grand qu'un
   *  coffre — c'est une réserve de village, pas une malle (spec construction §4bis). */
  GRENIER: CAPACITE_GRENIER,
  /** Assez grand pour que le cadavre ne tronque JAMAIS le butin (spec R11). */
  CORPSE: 48,
} as const

export interface MonsterDef {
  hp: number
  damage: number
  /** Vitesse en tuiles/s (les avatars marchent à WALK_SPEED_TILES_PER_S). */
  speed: number
  windupTicks: number
  attackCooldownTicks: number
  aggroRange: number
  /** Cadence de réflexion de l'IA (elle agit à chaque tick, elle DÉCIDE ici). */
  thinkEveryTicks: number
  /**
   * Zombie sans proie : probabilité de changer d'errance à chaque réflexion.
   * Pour le GIBIER : probabilité de CHANGER DE CAP. Le reste du temps, la bête
   * garde sa direction (ou s'arrête, cf. FAUNA.PAUSE_CHANCE) — c'est ce qui la
   * fait déambuler plutôt que trembler sur place.
   */
  wanderChance: number
  /** Sanglier blessé : probabilité de charger (sinon il fuit) à chaque réflexion. */
  chargeChance: number
  loot: import('./items').ItemBag
  /**
   * LA TAILLE DU SAC DE LA BÊTE — et pour presque toutes, c'est ZÉRO.
   *
   * Toutes les bêtes naissaient avec le sac d'un PNJ (40 cases), pour une seule raison
   * écrite dans `spawnMonster` : « le Cendreux levé hérite du butin d'un cadavre entier ».
   * Vrai — pour le Cendreux. Les cinq autres espèces ne portent RIEN : leur butin vient de
   * `loot` ci-dessus, versé dans le CADAVRE à la mort (`combat.ts`), jamais de leur sac.
   *
   * Le prix était MESURÉ et absurde : un lapin pesait **574 octets de JSON, dont 201 pour
   * son sac vide** — un sac plus GRAND que celui d'un humain (18 cases, 91 o) —, et ça
   * partait dans le snapshot de chaque client, vingt fois par seconde, pour ~600 bêtes.
   *
   * C'est le champ qui manquait pour que le type dise la vérité : une bête n'est pas un
   * porteur. `Record<MonsterType, MonsterDef>` étant exhaustif, une espèce ajoutée devra
   * répondre — et répondre `0` est la réponse ordinaire.
   */
  sac: number
  /**
   * Le gibier (spec faune R2) : les terrains où l'espèce vit. Non vide = c'est
   * une BÊTE — elle broute, s'alerte, fuit, et le peuplement ambiant peut la
   * faire naître ici. Vide = c'est un monstre (zombie, cendreux).
   */
  habitat?: number[]
  /** Un avatar à cette distance : la bête s'arrête et regarde (spec faune R5). */
  alertRange?: number
  /** Un avatar à cette distance : la bête détale (spec faune R6). */
  flightRange?: number
  /**
   * Le GRÉGARISME (spec faune R9) : bornes de la taille d'une harde/meute à la
   * naissance. Absent = solitaire. Un cerf seul n'existe pas ; un sanglier de
   * tanière, si — et c'est ce qui le rend inquiétant.
   */
  herdSize?: [number, number]
  /** Le rythme (spec faune R10) : quand cette bête est éveillée. */
  activity?: Activity
  /** Le PRÉDATEUR (spec faune R11) : il chasse, il ne broute pas. */
  predator?: boolean
  /**
   * LE CROCHET (spec chasse C15), dans [0, 1] : combien cette bête zigzague en
   * fuite, à découvert. Le lapin crochète à fond (1), le cerf à moitié (0,5), le
   * sanglier jamais (absent) — lui ne zigzague pas, il se retourne.
   */
  jink?: number
}

export const MONSTER_DEFS: Record<MonsterType, MonsterDef> = {
  boar: {
    hp: 30, damage: 8, speed: 3.6,
    windupTicks: ticksFor(0.4), attackCooldownTicks: ticksFor(2), aggroRange: 0,
    thinkEveryTicks: ticksFor(1), wanderChance: 0.25, chargeChance: 0.25,
    loot: { raw_meat: 3 },
    sac: 0, // elle ne porte rien : son butin est `loot`, versé au cadavre
    // Le sanglier tient sa forêt. Il laisse approcher — et c'est le piège.
    habitat: [TERRAIN_FOREST, TERRAIN_PINE, TERRAIN_LARCH, TERRAIN_OLD_GROWTH, TERRAIN_WILLOW],
    alertRange: 7, flightRange: 0,
    activity: 'nocturnal', // il fouge de nuit — le vrai sanglier aussi
  },
  cendreux: {
    hp: 20, damage: 34, speed: 1.3,
    windupTicks: ticksFor(0.7), attackCooldownTicks: ticksFor(2.5), aggroRange: 5,
    thinkEveryTicks: ticksFor(0.5), wanderChance: 0, chargeChance: 0,
    loot: {}, // il porte celui du cadavre (voir levée)
    // ZÉRO comme toutes les bêtes. Le Cendreux LEVÉ hérite du butin d'un cadavre entier et
    // réclame ses 40 cases — mais il les demande à la levée (`spawnMonster(..., SLOTS.NPC)`
    // dans `cendreux.ts`), pas ici : depuis R1-R2, l'écrasante majorité des Cendreux naissent
    // en HORDE ou en garde de convoi, et ceux-là ne portent rien. Un sac d'espèce à 40 cases
    // aurait mis 201 octets de JSON vide dans chaque snapshot, par bête, vingt fois par
    // seconde (voir la note de `spawnMonster`).
    sac: 0,
  },
  // Le petit gibier (GDD §8bis) : il détale avant qu'on l'ait vu. L'école de l'approche.
  rabbit: {
    hp: 8, damage: 0, speed: 5,
    windupTicks: ticksFor(0.3), attackCooldownTicks: ticksFor(2), aggroRange: 0,
    thinkEveryTicks: ticksFor(0.6), wanderChance: 0.4, chargeChance: 0,
    loot: { raw_meat: 1 },
    sac: 0, // elle ne porte rien : son butin est `loot`, versé au cadavre
    habitat: [TERRAIN_GRASS, TERRAIN_HEATH, TERRAIN_FLOWER_MEADOW, TERRAIN_ALPINE_MEADOW, TERRAIN_ALPINE_FLOWERS, TERRAIN_WET_MEADOW, TERRAIN_JUNIPER_HEATH],
    alertRange: 11, flightRange: 7,
    activity: 'crepuscular', // à l'aube et au crépuscule : les heures du lapin
    jink: 1, // il crochète À FOND : on ne l'attrape pas en courant droit (chasse C15)
  },
  // Le gros gibier : le vrai repas. Il voit de loin, part tôt, et court plus vite que vous.
  deer: {
    hp: 45, damage: 0, speed: 4.6,
    windupTicks: ticksFor(0.4), attackCooldownTicks: ticksFor(2), aggroRange: 0,
    thinkEveryTicks: ticksFor(1.2), wanderChance: 0.2, chargeChance: 0,
    loot: { quartier: 2 }, // V0-5 : le gros gibier rend des QUARTIERS lourds (portage)
    sac: 0, // elle ne porte rien : son butin est `loot`, versé au cadavre
    habitat: [TERRAIN_ALPINE_MEADOW, TERRAIN_HEATH, TERRAIN_GRASS, TERRAIN_FOREST, TERRAIN_LARCH, TERRAIN_WILLOW, TERRAIN_WET_MEADOW],
    alertRange: 14, flightRange: 9,
    herdSize: [3, 5], // la harde : ils broutent ensemble et détalent ensemble
    activity: 'diurnal', // le grand gibier du plein jour
    jink: 0.5, // il crochète, mais moins sec que le lapin (chasse C15)
  },
  /**
   * LE LOUP (spec faune R11) — « le danger de fond des trajets » (GDD §9bis).
   *
   * Ce n'est pas un zombie : il ne marche pas droit sur vous jusqu'à mourir. Il
   * chasse EN MEUTE, il préfère le gibier à l'homme, il rompt quand il saigne,
   * et un loup seul n'ose pas. Voilà pourquoi il est dangereux et pourquoi on
   * peut le battre : il a une psychologie, et elle s'exploite.
   *
   * Vitesse 4,8 : plus rapide qu'un joueur qui marche (4), plus lent qu'un
   * joueur qui sprinte (6). On ne distance pas une meute, on lui échappe.
   */
  wolf: {
    hp: 35, damage: 14, speed: 4.8,
    windupTicks: ticksFor(0.45), attackCooldownTicks: ticksFor(1.5), aggroRange: 13,
    thinkEveryTicks: ticksFor(0.5), wanderChance: 0.2, chargeChance: 0,
    loot: { raw_meat: 2 },
    sac: 0, // elle ne porte rien : son butin est `loot`, versé au cadavre
    habitat: [TERRAIN_FOREST, TERRAIN_PINE, TERRAIN_LARCH, TERRAIN_OLD_GROWTH, TERRAIN_HEATH],
    alertRange: 0, flightRange: 0, // il ne fuit pas parce qu'on approche : il fuit parce qu'il saigne
    herdSize: [3, 4], // la meute
    activity: 'nocturnal',
    predator: true,
  },
}

/**
 * La faune ambiante (spec faune) — elle vit dans un ANNEAU autour des avatars,
 * pas dans la carte. Population bornée par `CAP`, indépendante de la taille du
 * monde : le coût par tick ne dépend donc pas de la carte, mais du nombre de
 * gens qui la regardent.
 *
 * `SPAWN_RING_MIN` (28) est calé au-delà de TOUT ce que la caméra peut montrer :
 * la demi-diagonale du champ (~20.6 tuiles à VISIBLE_TILES_TALL=20) PLUS le
 * décalage « Foxhole » vers le curseur (LOOKAHEAD_MAX_TILES = 6). Sans ce second
 * terme, une bête née à 22 tuiles apparaît à l'écran dès que le joueur regarde
 * dans sa direction — un lapin qui se matérialise sous les yeux. Si le cadrage
 * ou le lookahead du client changent, ce nombre monte avec eux.
 */
export const FAUNA = {
  /**
   * LE GRADIENT DE DANGER (spec tension.md, GDD §8bis). Près du foyer, les
   * prédateurs sont RARES ; aux marges, le monde leur appartient. Sans lui, le
   * cercle sauvage était riche sans être dangereux : s'éloigner rapportait sans
   * faire peur, et le PORTAGE — qui rend la distance coûteuse — n'achetait aucune
   * tension. Les deux règles se tiennent la main.
   */
  PREDATOR_BIAS_DOMESTIC: 0.2,
  PREDATOR_BIAS_WILD: 2.5,
  /**
   * RICHESSE ↔ DANGER (V2-19, tension.md T11bis). Le gradient radial ne suffisait pas : le
   * système de ressources est GÉOGRAPHIQUE (chaque zone T1 a son minerai), mais s'y rendre ne
   * FAISAIT pas peur. On re-corrèle : une zone plus riche (tier plus haut) attire plus de
   * prédateurs — facteur `1 + DANGER_PER_TIER × tier`. Le Karst (fer, T1) et les marges (T2)
   * deviennent somptueux ET brûlants ; la racine (T0) reste le refuge. Ordre de grandeur, à
   * caler en playtest : T1 ×1,35, T2 ×1,7 — cumulé au radial (loin+riche = très chaud).
   */
  DANGER_PER_TIER: 0.35,
  /**
   * Plafond de bêtes ambiantes vivantes (hors bêtes de lieu, résidentes).
   *
   * CALIBRÉ EN JEU (2026-07-11) : ce qui compte n'est pas le plafond mais la
   * DENSITÉ dans le disque utile. À 30 bêtes sur un rayon de 62 (12 000 tuiles)
   * pour un écran de ~710 tuiles, on attend ~2 bêtes en vue — et on n'en voyait
   * effectivement qu'une. En resserrant le disque (52) et en montant le plafond,
   * on vise ~4 : assez pour que la forêt bruisse, trop peu pour un zoo.
   */
  /**
   * LE PLAFOND DU MONDE — un GARDE-FOU DE SERVEUR, pas un réglage de jeu.
   *
   * Il ne borne plus ce qu'un joueur RESSENT (c'est `GROUND_CAP` qui le fait) :
   * il borne ce que la MACHINE doit tenir, quel que soit le nombre de joueurs
   * éparpillés dans la vallée. On ne le sent jamais en jouant ; on le sentirait
   * s'il n'existait pas, le jour où quarante joueurs se dispersent sur quarante
   * coins de chasse.
   *
   * MESURÉ (banc multi, vallée réelle) : 16 joueurs dans 16 coins → 480 bêtes,
   * chacun avec sa clairière PLEINE, pour 10,9 ms de tick sur un budget de 50
   * (20 Hz). 600 laisse donc la place à vingt joueurs par salle — et le jour où
   * la Vallée découpera le monde en rooms (une par zone), c'est le serveur qui
   * posera ce nombre, salle par salle.
   */
  CAP: 600,
  /**
   * LE PLAFOND D'UN COIN DE CHASSE (spec faune R17) — et C'EST LUI qu'on règle.
   *
   * Le plafond était GLOBAL, et ça ne survivait pas au multi : trente bêtes pour
   * TOUT le monde, c'est trois bêtes par joueur à dix joueurs — un monde mort.
   * Pire : le peuplement tirait UN SEUL avatar au sort par tick, donc à dix
   * joueurs chacun attendait quatre secondes entre deux naissances.
   *
   * Le budget appartient donc au COIN, pas au monde. Deux joueurs dans deux
   * clairières différentes ont chacun leur clairière pleine ; deux joueurs dans
   * LA MÊME clairière la partagent — ce qui est exactement juste : c'est le même
   * pré, il porte les mêmes bêtes. Le coût par tick ne dépend ni de la carte, ni
   * du nombre de coins : seulement du nombre de coins QU'ON REGARDE.
   */
  GROUND_CAP: 30,
  /**
   * LA PART DES PRÉDATEURS dans un coin de chasse — le garde-fou du DANGER.
   *
   * Mesuré : la nuit, un coin se remplissait de DIX-NEUF LOUPS (cinq ou six
   * meutes), et neuf coins sur dix-neuf en portaient dix ou plus. Le loup ne
   * débordait pas du plafond : il le RAFLAIT. Hors de leurs heures, le cerf et le
   * lapin tombent au plancher (`SPAWN_FLOOR`) pendant que le loup est à son
   * maximum ; il gagne six tirages sur dix, et il naît par trois ou quatre.
   *
   * Ce n'était plus « la nuit est dangereuse », c'était un MUR. Et c'était
   * d'autant plus fâcheux que LA NUIT QUI CHASSE avait été bornée avec soin
   * (`NIGHT_HUNT.MAX_ALIVE` : « on peut perdre, pas être submergé ») — le
   * peuplement ambiant contournait cette borne par la porte de derrière.
   *
   * On ne rend donc PAS le loup plus rare (ça viderait la nuit de son sens) : on
   * borne sa PART. Le reste du coin va au gibier — qui, la nuit, DORT (R10). Une
   * clairière nocturne devient alors ce qu'elle doit être : des cerfs couchés, et
   * quelques loups qui rôdent entre eux. C'est l'écosystème, pas un mur.
   *
   * 0,2 × 30 = SIX loups au plus dans une clairière : une meute pleine, plus un
   * rôdeur. Assez pour tuer un homme sans lance (une meute de quatre inflige déjà
   * ~37 dégâts/s) ; pas assez pour qu'il n'ait jamais eu sa chance.
   */
  PREDATOR_SHARE: 0.2,
  /* ── LES COINS DE CHASSE (spec faune R17) ───────────────────────────────── */
  /**
   * LE GIBIER A DES ADRESSES (décision utilisateur, 2026-07-13).
   *
   * La faune était un BROUILLARD UNIFORME : elle naissait autour du joueur, où
   * qu'il aille. Marcher dix minutes dans n'importe quelle direction donnait
   * exactement la même chose — donc la carte ne s'apprenait pas, et « le gibier
   * est une ressource de TERRITOIRE, pas de temps » (R16) n'était qu'une phrase.
   *
   * Le monde porte maintenant des COINS DE CHASSE : des lieux FIXES, semés une
   * fois pour la saison, où le gibier vit. Entre eux, la vallée est VIDE — et
   * c'est ce vide qui donne leur valeur aux coins.
   *
   * Ils sont posés à des endroits LOGIQUES (retour utilisateur) : un biome OUVERT
   * (on y broute) À PORTÉE D'EAU (on y boit). Un semis de Poisson donne
   * l'espacement, ces deux conditions donnent l'adresse — le gibier ne vit pas
   * sur un éboulis.
   */
  GROUND_SPACING: 200, // deux coins ne se touchent jamais (semis de Poisson)
  GROUND_RADIUS: 46, // le territoire : hors de ce disque, rien ne naît
  /**
   * …ET ELLE NE REDEVIENT UNE BROUTEUSE QU'ICI (hystérésis — même leçon que la
   * cohésion, la séparation et le retour au pays : TOUT SEUIL QUI COMMANDE UN
   * MOUVEMENT VEUT SON HYSTÉRÉSIS).
   *
   * MESURÉ (`tools/diag-cerf.mts`, 2026-08-01, plainte « parfois ils tremblent »)
   * : une harde dont la dérive avait atteint la frontière de son canton vibrait à
   * un cycle de TROIS TICKS — un pas de trot vers l'intérieur (WARY_SPEED, donc
   * DEUX fois plus long qu'un pas de broutage), qui la faisait repasser dedans,
   * puis deux pas de broutage qui la ressortaient. Le sprite se retournait sept
   * fois par seconde. Onze demi-tours dans la pire seconde, sur une bête.
   *
   * Quatre tuiles de marge : la bête rentre franchement (≈ 25 ticks de trot) et
   * il lui faut le double pour re-dériver dehors. La frontière redevient une
   * limite qu'on franchit, au lieu d'un fil sur lequel on danse.
   */
  GROUND_COMFORT: 42,
  GROUND_SNAP: 30, // depuis le point tiré, on cherche la bonne tuile dans ce rayon
  GROUND_WATER_NEAR: 40, // « à portée d'eau » : le gibier boit tous les jours
  GROUND_WATER_CELL: 8, // maille de la grille d'eau (précalcul du worldgen)
  /**
   * LA MIGRATION DANS SON COIN. Une bête d'un coin de chasse ne dérive pas
   * n'importe où : elle se donne un BUT à l'intérieur de son territoire, et elle
   * y va. Le troupeau traverse sa clairière ; il ne quitte pas le canton.
   */
  MIGRATE_SLICE_TICKS: ticksFor(45),
  MIGRATE_REACH: 0.7, // …dans les 70 % intérieurs du disque : elle ne rase pas la frontière
  SPAWN_EVERY_TICKS: ticksFor(0.4),
  SPAWN_TRIES: 8, // tirages de tuile par tentative de peuplement
  SPAWN_RING_MIN: 28,
  SPAWN_RING_MAX: 42,
  DESPAWN_RADIUS: 52,
  SAFE_RANGE: 20, // menace au-delà : la bête se calme et se remet à brouter
  GRAZE_SPEED: 0.35, // × la vitesse de l'espèce : brouter, c'est flâner
  /**
   * Chance de s'arrêter brouter à chaque réflexion. Le reste du temps la bête
   * GARDE son cap (voir `wanderChance` = chance de CHANGER de cap) : sans cette
   * persistance, tirer une direction neuve chaque seconde donne une marche
   * aléatoire qui piétine sur place — la bête s'agite sans jamais aller nulle
   * part, et le monde ne se repeuple pas autour d'un joueur immobile.
   */
  PAUSE_CHANCE: 0.28,
  FLEE_SPEED: 1, // × la vitesse de l'espèce : l'allure de rompue des prédateurs
  BURST_RUN_TICKS: ticksFor(1.6), // le sprint burst promis par combat.md R12…
  BURST_PAUSE_TICKS: ticksFor(0.7), // …et le souffle qui le rend LISIBLE (plus « chassable » : voir R6)

  /* ── La fuite ENGAGÉE (R6, refondue 2026-07-13) ─────────────────────────── */
  /**
   * LE SURRÉGIME. En fuite, le gibier court à ça × sa vitesse : cerf ~6,9 t/s,
   * lapin ~7,5 — plus vite qu'un sprint de joueur (6), TOUJOURS. Le playtest
   * était sans appel : à-coups inconditionnels + peur courte = un cerf rattrapé
   * à la course, ce qu'aucun cerf du monde n'accorde. La chasse à course droite
   * est morte ; restent l'approche (spec chasse) et le tir à venir. Conséquence
   * actée : le loup (4,8) ne rattrape plus un cerf SAIN — c'est CHASSE II (le
   * sang) qui lui rendra ses proies : la ruée blesse, le sang ralentit.
   */
  FLEE_SPRINT: 1.5,
  /**
   * LE SOUFFLE EST UN LUXE DE LA MARGE. La bête ne marque la pause de burst que
   * si la menace PERÇUE est plus loin que ça — serrée de près, elle court plein
   * pot. (Et un chasseur qui se fige pendant qu'elle souffle redevient presque
   * imperceptible : le stop-and-go vaut aussi en poursuite.)
   */
  BREATHE_GAP: 12,
  /**
   * LE POINT DE PEUR. Une bête levée mémorise D'OÙ est venue la peur et fuit
   * jusqu'à en être à cette distance — menace visible ou pas. C'est ce qui fait
   * « partir loin avant de reprendre une vie normale », au lieu de s'arrêter à
   * quatorze tuiles et de rebrouter sous le nez du chasseur.
   */
  FLEE_GOAL: 30,
  /** La borne dure de l'engagement — pour la bête ACCULÉE contre une falaise. */
  FLEE_MAX_TICKS: ticksFor(15),

  /* ── L'espace vital et l'impatience (R6bis) ─────────────────────────────── */
  /**
   * L'ESPACE VITAL. Une menace repérée (jauge ≥ alerte) à moins de ça : LEVÉE,
   * immobile ou pas. Sans lui, un joueur AFK finissait ENCERCLÉ de cerfs
   * statufiés — la jauge d'un immobile converge sous 1, et le gel n'avait pas
   * d'issue. Un cerf ne broute pas à trois mètres d'une silhouette identifiée.
   * (Le sanglier est exempté : son trop-près à lui, c'est la MENACE, R14.)
   *
   * 3,5 et pas plus : il ne mord que sur la jauge ≥ ALERTE — le chasseur du
   * stop-and-go, qui approche SOUS le seuil, ne le rencontre jamais (le coup
   * propre exige déjà d'être sous l'alerte). L'espace vital punit l'approche
   * RATÉE, pas l'approche.
   */
  PERSONAL_SPACE: 3.5,
  /**
   * L'IMPATIENCE. Alertée depuis plus de ça sans résolution, la bête ne reste
   * pas statue : elle s'éloigne au trot jusqu'à retomber sous le seuil — le
   * cerf tape du sabot, fixe, puis s'écarte.
   */
  IMPATIENCE_TICKS: ticksFor(6),
  /** Le trot du méfiant : s'écarter, se regrouper, rentrer chez soi — plus vite que brouter. */
  WARY_SPEED: 0.7,
  /**
   * LE RETOUR AU PAYS. Rayon de sondage d'une bête qui se réveille HORS de son
   * habitat (la fuite engagée l'y a jetée) : elle cherche sa tuile de biome la
   * plus proche et y rentre. Sans ça elle se figeait à jamais — `stepStaysHome`
   * refuse tous les caps de qui est déjà dehors (bug attrapé au banc).
   */
  HOMING_SEEK: 24,
  /**
   * ET ELLE RENTRE JUSQU'AU CŒUR DE SA TUILE. Rendre la main dès que la bête a
   * franchi la lisière, c'est la lâcher PILE SUR LE BORD — où le moindre pas de
   * cohésion ou de séparation (qui ne connaissent pas les biomes) la rejette
   * dehors, et où `goHome` la rappelle aussitôt : elle danserait sur la frontière.
   */
  HOMING_ARRIVE: 0.35,

  /* ── La harde (spec faune R9) ───────────────────────────────────────────── */
  /**
   * Une bête qui voit un congénère de sa harde détaler à moins de ça détale
   * aussi, SANS avoir rien vu elle-même. C'est le cœur du grégarisme : la harde
   * est un organe de perception collectif, et c'est ce qui rend l'approche
   * difficile — il suffit qu'UNE bête vous repère pour que tout parte.
   */
  HERD_ALARM_RADIUS: 12,
  /**
   * …et l'alarme est un CRI : on n'entend une sœur que pendant ce délai après SA
   * levée, pas pendant toute sa course. Sans cette péremption, une bête qui avait
   * fini sa fuite se faisait relever par la sœur qui courait encore, sa fuite
   * s'achevait dans le même tick (elle était déjà loin du point de peur), et elle
   * repartait au suivant : un aller-retour PAR TICK. Deux secondes laissent
   * largement le temps à la vague de traverser une harde — chaque bête levée
   * devient elle-même un cri frais pour ses voisines.
   */
  HERD_ALARM_TICKS: ticksFor(2),
  /** Au-delà de cet écart au centre de sa harde, la bête revient vers les siens. */
  HERD_SPREAD: 5,
  /**
   * LE POIDS DU RAPPEL EN FUITE : combien la direction du centre de la harde pèse dans
   * le cap d'une bête qui court (mêlée à sa direction de fuite, puis renormalisée). Bas
   * = chacun sauve sa peau, haut = le troupeau reste soudé quitte à courir vers la
   * menace. Écrit en clair dans `faunaStep`, où aucun réglage ne pouvait le trouver.
   */
  HERD_COHESION_WEIGHT: 0.35,
  /**
   * …ET ELLE NE LÂCHE QU'ICI. Le rappel est COLLANT (hystérésis), comme la peur :
   * elle se déclenche à `flightRange` et ne retombe qu'à `SAFE_RANGE`.
   *
   * Sans ce second seuil, la bête franchissait HERD_SPREAD, se faisait rappeler
   * d'un pas, repassait sous le seuil — et RESSORTAIT aussitôt (son cap d'errance
   * pointait toujours dehors). Deux à trois allers-retours par seconde : les
   * cerfs TREMBLAIENT en pâturant, et c'est ce que le playtest a vu.
   */
  HERD_COMFORT: 2.5,
  /** Rayon de dispersion d'une harde à la naissance (tuiles). */
  HERD_SPAWN_SPREAD: 3,

  /* ── Le troupeau qui vit (R9bis, 2026-07-13) ────────────────────────────── */
  /** LA SÉPARATION (boids-lite) : deux bêtes plus proches que ça s'écartent d'un pas. */
  HERD_SEPARATION: 1.2,
  /**
   * …et elle ne lâche qu'ICI (hystérésis, comme la cohésion et la peur). Un seuil
   * unique relâchait la bête à un cheveu du contact : son cap d'errance la
   * ramenait sur sa voisine au tick suivant, elles se repoussaient encore, et ça
   * frémissait. TOUT SEUIL QUI COMMANDE UN MOUVEMENT VEUT SON HYSTÉRÉSIS.
   */
  HERD_SEPARATION_COMFORT: 1.9,
  /**
   * LA ZONE MORTE DE L'ÉQUILIBRE. En dessous de ce déséquilibre (en unités de
   * poids `radius/d` — une voisine pile au rayon pèse 1), la bête ne s'écarte
   * plus : coincée entre deux voisines, chaque pas la faisait DÉPASSER le point
   * d'équilibre et repartir en sens inverse au tick suivant. Vingt demi-tours
   * par seconde, mesurés — le tremblement qu'Alexis voyait. Un pas de broutage
   * déplace le déséquilibre d'environ 0,14 : la zone morte le double, pour
   * qu'aucun pas ne puisse traverser l'équilibre.
   */
  SEPARATION_DEADBAND: 0.3,
  /**
   * LA DÉRIVE DE PÂTURE. La harde a un cap de broutage partagé qui tourne à
   * cette cadence (dérivé de `herdId` + tranche de temps par `hash2` — pur,
   * zéro état, zéro tirage) : le troupeau TRAVERSE le paysage en broutant au
   * lieu de trembler sur place.
   */
  DRIFT_SLICE_TICKS: ticksFor(20),
  /** La part des re-décisions de cap qui suivent la dérive plutôt que le hasard. */
  DRIFT_BIAS: 0.6,
  /** LE REPOS GROUPÉ : hors de ses heures, la harde se couche resserrée sous ça. */
  REST_SPREAD: 2.5,
  /**
   * …et le rappel du dormeur est COLLANT lui aussi. Le centre de la harde bouge
   * dès qu'une dormeuse se recale : sans second seuil, celle qui vient tout juste
   * de rentrer sous 2,5 en ressortait au tick suivant et repartait d'un pas. Une
   * bête couchée qui pas-à-pas indéfiniment, c'est un tremblement — et de nuit,
   * c'est le seul mouvement de l'écran.
   */
  REST_COMFORT: 1.5,
  /**
   * LA SENTINELLE (spec chasse C13, livrée ici — R9bis). Dans une harde de
   * gibier ≥ 3, UNE bête à la fois est de garde : tête haute, immobile, regard
   * qui balaie, perception accrue — pendant que les brouteuses relâchent.
   * Le tour se DÉRIVE (rang + tick ÷ SHIFT) : zéro état, déterminisme gratuit.
   */
  SENTINEL_SHIFT: ticksFor(20),
  SENTINEL_SWEEP_TICKS: ticksFor(2.5), // son regard passe d'un relèvement au suivant
  SENTINEL_ACUITY: 1.4,
  HERD_RELAX: 0.85,

  /* ── Le rythme jour/nuit (spec faune R10) ───────────────────────────────── */
  /**
   * En-deçà de cette vigueur (0-1, voir `activityAt`), la bête DORT : elle ne
   * broute plus, elle ne chasse plus. Elle reste réveillable — un dormeur qu'on
   * approche fuit quand même. Ce n'est pas un interrupteur, c'est un seuil.
   */
  REST_BELOW: 0.25,
  /**
   * ═══ LES HEURES D'ÉVEIL, PAR PROFIL (spec faune R10) ═══
   *
   * Chaque profil est un TRAPÈZE `[up0, up1, down0, down1]` en heures murales, lu par
   * `ramp` : 0 avant `up0`, plein éveil de `up1` à `down0`, retombé à 0 en `down1`.
   * Des rampes et non des sinusoïdes — `Math.sin` n'est pas garanti au bit près d'un
   * moteur JS à l'autre, et cette valeur décide de QUI NAÎT (invariant n°2).
   *
   *   diurne      ▁▁▁▃▇███▇▃▁▁▁    plein éveil 9h-17h
   *   nocturne    ██▇▃▁▁▁▁▁▃▇██    plein éveil 22h-4h  (enjambe minuit : lu sur deux
   *                                 rampes décalées de 24 h, on garde la plus forte —
   *                                 d'où des bornes qui dépassent 24)
   *   crépuscule  ▁▃█▇▃▁▁▁▃▇█▃▁    deux bosses : 5h-8h et 18h-21h
   *
   * C'est de l'ÉQUILIBRAGE (quand le gibier est dehors décide de quand on chasse), et
   * ça vivait en clair dans `activityAt` — vingt nombres qu'aucun playtest ne pouvait
   * trouver sans ouvrir le code.
   */
  ACTIVITY_DIURNAL: [6, 9, 17, 20] as const,
  ACTIVITY_NOCTURNAL: [19, 22, 28, 31] as const,
  /** Les deux bosses du crépusculaire : l'aube, puis le soir. */
  ACTIVITY_CREPUSCULAR_DAWN: [4, 5.5, 8, 9.5] as const,
  ACTIVITY_CREPUSCULAR_DUSK: [17, 18.5, 21, 22.5] as const,
  /**
   * Plancher de peuplement d'une espèce hors de ses heures : elle ne disparaît
   * jamais tout à fait. Sans ce plancher, le monde se recomposerait d'un coup à
   * 21h — or un cerf assoupi existe encore la nuit, il est juste plus rare.
   */
  SPAWN_FLOOR: 0.15,

  /* ── La meute (spec faune R11) ──────────────────────────────────────────── */
  /**
   * L'APPEL. Un loup qui n'a rien vu, mais dont un frère de meute chasse à moins
   * de ça, converge sur la MÊME cible. La meute chasse comme un seul animal —
   * c'est ce qui la rend mortelle.
   */
  PACK_CALL_RADIUS: 22,
  /**
   * LE COURAGE. Un loup n'engage un HOMME que s'il compte au moins autant de
   * frères vivants autour de lui. En dessous, il rôde, il suit, il attend — mais
   * il ne mord pas. Tuer des loups ne fait donc pas que réduire leur nombre :
   * ça brise la meute, et une meute brisée cesse d'être un danger.
   * (Le petit gibier, lui, se chasse seul : le courage ne vaut que face à l'homme.)
   */
  PACK_COURAGE: 2,
  /** Rayon dans lequel un loup compte ses frères pour se donner du courage. */
  PACK_COHESION_RADIUS: 14,
  /**
   * LA ROMPUE. Sous cette fraction de ses PV, le loup DÉCROCHE. Un loup ne meurt
   * pas au contact comme un zombie : il calcule. C'est ce qui rend la meute
   * battable sans en faire un mur de points de vie.
   */
  PACK_BREAK_HP: 0.35,
  /**
   * Le prédateur PRÉFÈRE le gibier à l'homme : la distance à une proie animale
   * est divisée par ça avant comparaison. Un cerf à 12 tuiles « pèse » donc plus
   * qu'un joueur à 8 — et un joueur qui traverse une zone de chasse peut voir la
   * meute l'ignorer pour un cerf. Le monde ne tourne pas autour de lui.
   */
  PREY_PREFERENCE: 1.8,
  /**
   * L'ENCERCLEMENT. Rayon du cercle sur lequel les loups prennent leur poste
   * autour de la proie — chacun sur un relèvement différent, donné par son rang
   * dans la meute. Une meute qui fonce en ligne droite est une file indienne :
   * on la fuit tout droit, et elle ne vaut pas mieux qu'un loup seul.
   */
  ENCIRCLE_RADIUS: 3.5,
  /**
   * En-deçà de cette distance, on ne manœuvre plus : c'est la curée. Assez large
   * pour que les traînards aient pris leur place avant que le premier ne morde.
   */
  COMMIT_RANGE: 2.6,
  /**
   * L'HOMME QUI S'ÉLOIGNE EST LEVÉ (décision d'Alexis, 2026-08-01 — voir
   * `preyFleeing`). Produit scalaire minimal entre son sens de marche et la
   * direction « dos au loup » : 0,5 vaut 60°, donc il faut vraiment s'en aller.
   * Passer DEVANT une meute en la longeant ne la lève pas — elle vous traque, et
   * c'est le moment où l'on voit des loups se placer.
   */
  FLEEING_DOT: 0.5,
  /* Ce seuil commande DEUX choses — l'allure (rampe 2,0 ↔ course 4,8) et la silhouette
   * (`stalking`, deux hauteurs de sprite) — donc la question se pose : lui faut-il son
   * hystérésis, comme à tous les autres ? MESURÉ exprès sur les régimes qui le font
   * retraverser (zigzag à 0,75 s et à 2 s, et un homme qui TOURNE autour de la meute, où
   * chaque loup voit un cap différent) : DEUX bascules dans la pire seconde, au pire — le
   * même ordre que les bancs les plus calmes. Le verrou n'a pas lieu d'être ; si un
   * battement apparaît un jour, c'est ici qu'il faudra le poser. */
  /**
   * LA TRAQUE. Allure du loup qui gagne son poste (× sa vitesse). Il RAMPE — et
   * c'est la condition même de l'encerclement : une meute qui charge à pleine
   * vitesse pour se placer lève le gibier avant que le cercle ne soit bouclé, et
   * l'encerclement ne se produit jamais. La lenteur n'est pas un handicap qu'on
   * leur inflige : c'est ce qui rend la manœuvre possible.
   */
  STALK_SPEED: 0.42,
  /**
   * LE CAMOUFLAGE. Ce qu'il reste des portées de détection d'une proie face à un
   * loup qui traque (× alertRange et flightRange). À 0,42, un cerf qui voit un
   * chasseur à 9 tuiles ne lève la tête sur un loup rampant qu'à 4 — le temps
   * qu'il faut à la meute pour se placer. Dès que le loup se rue, le camouflage
   * tombe : c'est la course, plus la traque.
   */
  STALK_STEALTH: 0.42,
  /**
   * LA DISTANCE DE RÔDAILLE, en multiples de `COMBAT.MELEE_ENGAGE_RANGE` : un prédateur
   * qui n'ose PAS engager (meute trop maigre, proie trop verte) se maintient à ce
   * multiple de sa portée de morsure — assez près pour peser, trop loin pour mordre.
   * Exprimé en MULTIPLE et non en tuiles : c'est « juste hors de portée » qu'on veut
   * dire, donc ça doit suivre la portée si elle bouge.
   */
  PROWL_RANGE_FACTOR: 2.5,
  /** À cette distance de son poste, un loup est « en place ». */
  POST_TOLERANCE: 1.3,

  /* ── L'ALPHA (spec faune R12) ───────────────────────────────────────────── */
  /**
   * LE MÂLE ALPHA. Chaque meute en a un, et un seul : le premier-né. Il est plus
   * lourd, il frappe plus fort, ON LE RECONNAÎT à sa taille — et c'est là tout
   * l'enjeu : il est visible, donc ciblable.
   *
   * Tuer l'alpha DISPERSE la meute sur-le-champ. C'est la seule chose qui
   * transforme un combat perdu d'avance en combat gagnable : au lieu d'abattre
   * quatre loups, on en abat UN — le bon. Une meute cesse alors d'être un mur de
   * points de vie pour devenir une question : lequel, et comment l'atteindre.
   */
  ALPHA_HP: 1.9,
  ALPHA_DAMAGE: 1.45,

  /* ── La rencontre (spec faune R13) — ce doit être un moment ─────────────── */
  /**
   * LA POURSUITE. Une meute qui vous a choisi ne vous oublie pas à treize tuiles :
   * elle vous suit jusqu'à CELLE-CI. Le loup court à 4,8, le joueur sprinte à 6 —
   * il gagne 1,2 tuile par seconde, et son endurance lui offre ~12 s de sprint,
   * soit ~15 tuiles d'avance. Ce n'est PAS assez pour semer la meute.
   *
   * C'est délibéré, et c'est tout le propos : on ne distance pas des loups. On
   * leur échappe — par le Feu, ou en les faisant rompre. Sans quoi on meurt.
   */
  PURSUIT_RANGE: 26,
  /**
   * L'HEURE DU LOUP (spec faune R10bis, 2026-07-13). Sa VIGUEUR (`activityAt`,
   * nocturne) pondère ce qu'il ose : ses portées d'acquisition ET de poursuite
   * sont multipliées par `WOLF_DAY_FLOOR + (1 − FLOOR) × vigueur`.
   *
   * R10 couchait le gibier hors de ses heures, mais le loup, lui, chassait à
   * PLEINE portée à midi comme à 3 h : la nuit ne tenait pas sa promesse, et
   * traverser la forêt de jour n'était pas plus sûr. Désormais un loup diurne
   * est somnolent — on passe au large d'une meute assoupie (elle est VISIBLE,
   * c'est un choix, pas une loterie) — et la nuit lui rend ses treize tuiles.
   *
   * Le plancher n'est pas zéro : une meute de plein jour reste dangereuse à qui
   * lui marche dessus. On ne fabrique pas un interrupteur, on incline le monde.
   */
  WOLF_DAY_FLOOR: 0.45,
  /* ── Le sanglier (spec faune R14) — il ne fuit pas, il décide ───────────── */
  /**
   * LA FOUILLE. Le sanglier fouge : groin au sol, il ne voit plus rien. C'est la
   * FENÊTRE DU CHASSEUR — la seule façon d'approcher une bête qui, autrement, ne
   * fuit pas et vous voit venir. Un sanglier qui fouille est un sanglier qu'on
   * peut atteindre ; c'est le geste que le GDD §8bis appelle « l'approche ».
   */
  ROOT_CHANCE: 0.4, // probabilité de se mettre à fouir, à chaque réflexion
  ROOT_TICKS: ticksFor(4),
  ROOT_ALERTNESS: 0.4, // × ses portées de détection pendant qu'il fouge
  /**
   * LA MENACE. Sous cette distance, le sanglier ne fuit pas et ne charge pas
   * encore : il se plante face à vous. Un temps. C'est un AVERTISSEMENT, et c'est
   * la dernière seconde où l'on peut encore reculer (GDD §9bis).
   */
  THREAT_RANGE: 4.5,
  THREAT_TICKS: ticksFor(1.1), // le temps qu'il vous laisse pour comprendre
  /**
   * LA CHARGE. Droite, engagée, plus rapide qu'un sprint (6,1 contre 6) : on ne
   * la distance PAS. On s'en écarte. Le sanglier ne tourne pas — il passe, il
   * dépasse, et il se retrouve essoufflé, dos à vous. C'est là qu'on frappe.
   *
   * Une bête qu'on esquive plutôt qu'on ne fuit : le GDD veut un combat
   * positionnel, et le sanglier en est la première leçon.
   */
  CHARGE_SPEED: 1.7, // × sa vitesse (3,6 → 6,1)
  CHARGE_TICKS: ticksFor(1.3), // il court tout droit pendant ce temps, sans dévier
  WINDED_TICKS: ticksFor(1.7), // puis il souffle, immobile — la fenêtre pour frapper
  /**
   * LE BOND DU LOUP (spec faune R19, décision d'Alexis 2026-08-01). Ces quatre
   * nombres ne sont pas un goût : ils sortent de l'arithmétique de la panne qu'ils
   * réparent.
   *
   * LA PANNE : le wind-up de la morsure dure 0,45 s et FIGE le loup ; l'homme y
   * parcourt 1,8 tuile quand la morsure n'en porte que 1,2. MESURÉ — quatre loups
   * collés à UNE tuile d'un homme qui marche, 46 coups armés, ZÉRO dégât.
   *
   * LA PORTÉE EST DICTÉE PAR L'ESQUIVE, ET C'EST TOUT L'INVERSE DE L'INTUITION :
   * un bond COURT n'est pas esquivable, il est seulement plus proche. Ce qui rend
   * un bond évitable, c'est le TEMPS DE VOL — l'homme se décale à 4 t/s pendant que
   * le loup, cap verrouillé, ne se corrige plus. MESURÉ sur la première version
   * (portée 3,5, vol 0,5 s) : le pas de côté passait à **1,17 tuile** du loup, sous
   * la portée de morsure — 14 dégâts gratuits, sans recours. Ce n'est pas une
   * rencontre, c'est un impôt.
   *
   * À 5 tuiles et 0,8 s de vol : l'homme qui va TOUT DROIT est rejoint à 0,68 s
   * (dans le vol, avec la marge) ; celui qui se DÉCALE passe à **1,93 tuile** — hors
   * de portée, franchement. Le même geste, deux issues, décidées par le joueur :
   * c'est la leçon que le sanglier enseigne déjà (R14), et c'est pourquoi son bond
   * est LONG. Contre un homme qui SPRINTE (6 t/s) le bond ne rattrape pas — mais il
   * n'a jamais été à 5 tuiles d'un sprinteur (dit dans R19 : la fuite au sprint est
   * un problème d'APPROCHE, pas de morsure).
   *
   * LA RETOMBÉE est le PRIX du bond, et c'est elle qui garde le combat jouable :
   * un loup qui a manqué est parti CINQ TUILES trop loin, puis reste immobile et
   * offert. Plus courte que le souffle du sanglier (1,7 s) — un sanglier est une
   * rencontre, une meute est un combat : à quatre loups, 1,7 s de gel chacun
   * rendrait l'encerclement inoffensif. Sur le cycle complet (vol + retombée) le
   * loup avance encore à 4,8 t/s : bondir ne le fait pas perdre du terrain sur un
   * homme qui marche — un correctif qui ralentirait la meute n'en serait pas un.
   */
  /**
   * LE PASSAGE (spec faune R20, décision d'Alexis : « les loups n'ont aucune raison
   * d'être trop malins, sauf si l'un d'entre eux trouve un chemin — il peut le
   * communiquer aux autres »).
   *
   * CE QU'ON RÉPARE, MESURÉ : une barre de roche avec UNE ouverture de trois tuiles.
   * En face, la meute mord (3/3 graines). Décalée de quinze tuiles — le tour d'une
   * palissade de village — elle ne mord **JAMAIS** : elle pousse contre la roche à
   * 6,7 tuiles pendant soixante secondes. Un mur dont le trou n'est pas en face
   * annulait une meute entière.
   *
   * CE QUE ÇA COÛTE, ET POURQUOI C'EST NÉGLIGEABLE. Un A* vaut ~1,6 ms à l'échelle
   * de production (3,75 M tuiles, 125 000 nœuds) contre 50 ms de budget de tick.
   * Le coût ne vient donc pas du chemin, il vient de sa FRÉQUENCE : quatre loups qui
   * chercheraient chacun deux fois par seconde, ce sont 13 ms/tick — le défaut que
   * le Cendreux en horde a déjà payé une fois (voir `cendreux.ts`). Ici : **UNE
   * recherche par meute et par `PATH_COOLDOWN_TICKS`**, les autres copiant le chemin
   * trouvé. Soit ~0,03 ms/tick, six cents fois moins.
   *
   * `PATH_EXPLORE` EST UN BOUTON DE DESIGN, PAS DE PERF — c'est lui qui décide de ce
   * que la bête est capable de comprendre. Budget minimal mesuré pour trouver :
   * ouverture en face **200** · décalée de 15 tuiles **700** · palissade 20×20 dont la
   * porte est à l'opposé **1 200** · détour de 40 tuiles, enceinte 40×40, LABYRINTHE
   * **4 096**. À 1 200, le loup fait le tour d'un obstacle et **ne résout pas un plan
   * de village** : il reste une bête. Conséquence de jeu assumée et signalée : une
   * petite enceinte ne protège plus par sa FORME, une grande si.
   */
  STUCK_TICKS: ticksFor(1), // une seconde à se cogner avant de chercher
  STUCK_PROGRESS: 1, // gagné moins d'une tuile en une seconde (il en couvre 4,8) = retenu
  PATH_COOLDOWN_TICKS: ticksFor(3), // une recherche par meute et par 3 s
  PATH_EXPLORE: 1200, // ce qu'une bête peut comprendre — pas un labyrinthe
  PATH_STALE: 6, // la proie a bougé de tant : le chemin ne mène plus à elle
  LEAP_RANGE: 5, // il part de LOIN : c'est la distance qui rend l'esquive possible
  LEAP_SPEED: 2.0, // × son allure (4,8 → 9,6 t/s)
  LEAP_TICKS: ticksFor(0.8), // le temps de vol, cap verrouillé
  LEAP_RECOVER_TICKS: ticksFor(0.8), // il retombe, immobile — la fenêtre pour frapper
  /**
   * LE FEU. Aucun loup n'approche à moins de ça d'un Feu allumé : il rompt, il
   * s'écarte, il attend dans le noir. C'est la seule vraie issue d'une poursuite,
   * et elle donne à la fuite une DESTINATION plutôt qu'une direction.
   *
   * Que le salut d'une nuit de chasse soit le Foyer n'est pas un hasard : c'est
   * le jeu qui dit son nom.
   */
  FIRE_WARD: 8,

  /* ── La satiété (spec faune R15) — un prédateur mange ────────────────────── */
  /**
   * LE REPAS. Un loup ne chasse pas pour le sport : il chasse, il tue, et IL
   * MANGE. Tant qu'il n'a pas mangé, il traque ; une fois repu, il vous laisse
   * passer. C'est ce qui achève de faire de la vallée un écosystème plutôt qu'un
   * distributeur d'agression : on peut voir une meute prendre un cerf, se
   * rassasier — et vous ignorer.
   *
   * C'est aussi une TACTIQUE offerte au joueur : jeter de la viande à une meute
   * qui vous serre, c'est lui donner autre chose à faire. (Le GDD §9bis prévoyait
   * déjà de détourner une horde « avec de la viande ou du bruit ».)
   */
  CARCASS_SEEK: 16, // rayon où un prédateur affamé cherche une carcasse
  EAT_RANGE: 1.6, // il doit être dessus pour manger
  EAT_TICKS: ticksFor(9), // le temps qu'il passe à la carcasse, immobile
  SATED_TICKS: ticksFor(210), // ~3 min 30 de tranquillité — puis la faim revient

  /* ── La pression de chasse (spec faune R16) ─────────────────────────────── */
  /**
   * LE PIÈGE DU FARM. Le peuplement ambiant remplit l'anneau dès qu'une place se
   * libère : tuer une bête en fait naître une autre en une demi-seconde. Planté
   * dans une clairière, un joueur récolterait de la viande à l'infini sans faire
   * un pas — et la chasse, qui devait être un geste, deviendrait un robinet.
   *
   * LA RÈGLE : **le gibier déserte ce qu'on vient de chasser.** Une bête abattue
   * fait taire les bois autour d'elle : aucune naissance ambiante à moins de
   * `QUIET_RADIUS` pendant `QUIET_TICKS`. Le rayon est plus grand que l'anneau de
   * naissance (42) — donc un chasseur qui reste sur place ne voit plus rien venir.
   *
   * Il faut LEVER LE CAMP. C'est ce que fait un vrai chasseur, et c'est ce qui
   * rend la carte utile : le gibier est une ressource de TERRITOIRE, pas de temps.
   *
   * Et l'inverse est gardé : la zone se rouvre au bout de deux minutes, le plafond
   * global n'est pas touché, et abattre un LOUP ne fait taire personne (tuer un
   * prédateur n'a jamais fait fuir le gibier — au contraire).
   */
  QUIET_RADIUS: 46,
  QUIET_TICKS: ticksFor(120),
  /**
   * LE RETOUR DES BÊTES DE LIEU. Le sanglier d'une tanière est résident : tué, il
   * ne revenait JAMAIS, et le lieu devenait une coquille vide. Il repeuple sa
   * tanière après ce délai — mais jamais sous les yeux d'un joueur (voir
   * `DEN_SPAWN_CLEARANCE`) : un sanglier qui se matérialise devant vous, c'est le
   * décor qui avoue.
   */
  DEN_RESPAWN_TICKS: ticksFor(240),
  DEN_SPAWN_CLEARANCE: 24, // aucun avatar à moins de ça, sinon on attend
  /**
   * REPU N'EST PAS INOFFENSIF. Un loup rassasié ne chasse plus, mais il se DÉFEND :
   * qui le frappe le trouve en face. Il ne poursuit pas, il ne rôde pas, il ne
   * hurle pas — il rend le coup, et il rompt s'il saigne. Un prédateur repu qui se
   * laisserait tuer sans réagir serait un décor, pas un animal.
   */
}

/**
 * LA CHASSE (spec chasse, CHASSE I) — l'approche, la mise à mort, le sang.
 *
 * Le cœur en une phrase : LA MÉFIANCE remplace les murs. Une bête ne compare
 * plus une distance à deux rayons — elle porte une jauge (0-1) qui POURSUIT un
 * stimulus continu, vite en montée, lentement en descente. C'est ce qui achète
 * le stop-and-go du chasseur : elle lève la tête, on se fige, elle se rassure,
 * on regagne trois mètres. Être vu n'est plus perdre — c'est un événement à gérer.
 *
 * Tous les nombres sont des ordres de grandeur (GDD §15) : les vitesses de
 * montée/descente de la jauge feront ou déferont le stop-and-go, et ça se
 * calibre À L'ÉCRAN (`pnpm smoke --scenario chasse`), pas au raisonnement.
 */
export const HUNT = {
  /* ── La méfiance (chasse C1) ─────────────────────────────────────────────── */
  /** Plafond de perception : au-delà d'`alertRange × ça` (perçu), rien ne monte. */
  PERCEIVE_FACTOR: 1.25,
  /** CURIEUSE : elle s'arrête et REGARDE. Le joueur sait qu'il a été vu (R5). */
  SUSPICION_CURIOUS: 0.35,
  /**
   * …ET ELLE NE S'EN REMET QU'ICI (verrou `Monster.wary`). La curiosité est un
   * ÉTAT, pas une comparaison : sans seuil de sortie, la jauge — qui SUIT son
   * stimulus tick par tick — rasait 0,35 et le franchissait dans les deux sens
   * plusieurs fois par seconde.
   *
   * MESURÉ (`tools/diag-cerf.mts`, 2026-08-01, approche stop-and-go à 14 tuiles)
   * : QUINZE bascules dans la pire seconde. Chacune fait trois choses à l'écran
   * — la silhouette passe de 1,8 à 1,4 tuile, la teinte saute du jaune curieux au
   * gris broutage, et le gel lâche d'un pas. Le cerf grelottait.
   *
   * 0,25 : la bête reste curieuse ≈ 0,8 s de plus qu'avant (à décrue nominale)
   * avant de rebrouter. Le stop-and-go (C1) tient — c'est la MÊME jauge, la même
   * décrue ; seule la sortie est franche.
   */
  SUSPICION_CALM: 0.25,
  /** ALERTÉE : fixée, tendue, prête à partir — et un coup n'est plus PROPRE (C6). */
  SUSPICION_ALERT: 0.7,
  /** À stimulus plein, la jauge sature en ce temps (secondes). Près = bien plus vite. */
  RISE_S: 1.2,
  /** Sans stimulus, la jauge retombe en ce temps (secondes) — c'est la fenêtre du figé. */
  DECAY_S: 8,
  /**
   * LA NERVOSITÉ. Chaque franchissement du seuil d'alerte ralentit la décrue
   * (facteur cumulé, plafonné) : on ne refait pas indéfiniment la même approche
   * ratée sur la même bête.
   */
  NERVOUS_FACTOR: 1.6,
  NERVOUS_MAX: 3,
  /**
   * LA PANIQUE : une menace à cette distance BRUTE lève la bête, quelle que soit
   * la furtivité — on ne marche pas SUR un cerf. Sous la portée de la lance (2,3) :
   * la mise à mort propre au contact reste possible, la caresse non. Ne vaut que
   * pour les bêtes qui fuient (`flightRange > 0`) : le sanglier, lui, MENACE.
   */
  PANIC_RANGE: 1.8,

  /* ── Les deux sens (chasse C2-C5) : la VUE et l'OUÏE ─────────────────────── */
  /**
   * La bête perçoit par DEUX canaux, et retient le plus fort :
   *   — la VUE : visibilité de l'allure × couvert du terrain × REGARD (l'angle).
   *     C'est elle qu'on bat en se cachant, en se figeant, en passant derrière.
   *   — l'OUÏE : le bruit de l'allure, OMNIDIRECTIONNEL — ni le fourré ni le dos
   *     tourné n'y peuvent rien. C'est elle qui interdit d'arriver au CONTACT en
   *     marchant, même de dos : le pas s'entend.
   * Un seul produit aurait menti deux fois (attrapé par les tests A5/A6) : un
   * marcheur dans le dos devenait inaudible, et une bête en fuite devenait
   * aveugle à ce qu'elle fuit — l'angle multipliait aussi le bruit.
   */
  /** La VISIBILITÉ par allure : un corps immobile se voit mal, un sprint saute aux yeux. */
  /**
   * L'immobile disparaît presque (0,25) : c'est LA condition du stop-and-go.
   * À 0,4, une bête curieuse qui vous FIXAIT maintenait la jauge à flot même
   * figé — se geler ne servait à rien, mesuré au banc A2. L'œil du gibier
   * accroche le MOUVEMENT ; une silhouette plantée redevient un rocher.
   */
  VIS_STILL: 0.25,
  VIS_SNEAK: 0.55, // plié en deux : mesuré au banc, il gagne ~2 tuiles sur le marcheur
  VIS_WALK: 1,
  VIS_SPRINT: 1.4,
  /**
   * Le BRUIT par allure : immobile ≪ pas lent ≪ marche ≪ sprint. Le pas lent est
   * VRAIMENT feutré (0,4) — mesuré au banc : à 0,55, la distance de levée d'un
   * approcheur lent ne gagnait que 0,8 tuile sur un marcheur, et le verbe
   * « approcher » ne valait pas son coût en vitesse.
   */
  NOISE_STILL: 0.25,
  NOISE_SNEAK: 0.4,
  NOISE_WALK: 1,
  NOISE_SPRINT: 1.6,
  /** L'ouïe porte un peu moins loin que la vue (× les portées de l'espèce). */
  HEARING_FACTOR: 0.8,
  /**
   * BANDER SE VOIT (spec `tir.md` T7, décision d'Alexis) — le prix de la visée.
   *
   * Ce sont les deux nombres qui empêchent l'arc de SUPPRIMER le jeu d'approche : sans
   * eux, à douze tuiles le stimulus de méfiance est nul, donc tout tir long serait
   * automatiquement propre et `chasse.md` C1-C7 deviendrait du décor.
   *
   * L'ORDRE DE GRANDEUR SE LIT CONTRE L'ALLURE : bander vaut à peu près « passer du pas
   * lent à la marche » côté vue (0,55 → 0,88 : la silhouette figée redevient un corps
   * qui remue), et beaucoup moins côté ouïe — une corde qu'on tire n'est pas un pas.
   * C'est délibérément un COUP DE POUCE, pas un mur : à douze tuiles il ne change rien,
   * à cinq ou six il fait lever la tête. Se calibre en JOUANT, pas en lisant.
   */
  DRAW_VISIBILITY: 1.6,
  DRAW_NOISE: 1.3,
  /** Le pas lent (input `sneak`) : discret, et lent — c'est le prix. */
  SNEAK_SPEED_FACTOR: 0.5,

  /* ── Le regard (chasse C4) — le canal de la VUE seulement ───────────────── */
  /**
   * La vue d'une bête est DIRECTIONNELLE : pleine devant, réduite de flanc,
   * faible dans le dos. Trois secteurs par produit scalaire (littéraux — pas de
   * trigo, invariant §2) : approcher devient un problème de POSITION.
   */
  ANGLE_FRONT_COS: 0.5, // dot ≥ : devant (±60°)
  ANGLE_BACK_COS: -0.3, // dot ≤ : dans le dos
  ANGLE_FRONT: 1,
  ANGLE_SIDE: 0.75,
  ANGLE_BACK: 0.45,
  /** Le loup est quasi silencieux : son « bruit » est une fraction de sa furtivité visuelle. */
  PREDATOR_NOISE: 0.5,

  /* ── La mise à mort propre (chasse C6) ───────────────────────────────────── */
  /**
   * Un coup dont le wind-up DÉMARRE sur une bête sauvage non alertée frappe ça
   * fois plus fort. La lance (16) couche un cerf (45) d'un seul coup propre ;
   * l'épieu (10) prend le sanglier ; les poings, le lapin. L'approche parfaite a
   * enfin un payoff décisif — c'est la règle du loup rendue au joueur.
   */
  CLEAN_KILL_FACTOR: 3,

  /* ── CHASSE II — LE SANG (C8-C12) ───────────────────────────────────────── */
  /**
   * LA PLAIE. L'échec devient FÉCOND : une bête touchée mais pas tuée saigne, et
   * la GRAVITÉ décide de tout. Sous cette fraction de ses PV max, la plaie est
   * MORTELLE : elle saigne jusqu'à mourir — elle est à vous, si vous la
   * retrouvez. Au-dessus, la plaie est LÉGÈRE : elle se referme, la piste
   * s'éteint, la bête survit (décision utilisateur n°3 — sans quoi « toucher une
   * fois et attendre » deviendrait la stratégie dominante et la traque perdrait
   * son horloge).
   *
   * Le choix du chasseur devient réel : FRAPPER FORT — chargé, de près, propre —
   * OU PERDRE LA BÊTE. L'éraflure de loin ne « réserve » pas un cerf.
   */
  MORTAL_BELOW: 0.5,
  BLEED_HP_PER_S: 0.5,
  LIGHT_BLEED_TICKS: ticksFor(25),
  /**
   * LE SANG AU SOL. Une goutte à cette cadence, pour tout ce qui saigne — bête
   * blessée ET avatar (combat R7 : le sang est le sang). De l'ÉTAT, pas des
   * événements (haute fréquence ≠ domaine). Borné : TTL + plafond FIFO.
   *
   * La piste est LISIBLE PAR TOUS : suivre du sang frais ne demande aucune
   * maîtrise. Les empreintes, l'âge des traces, le sens de la course — ça, c'est
   * l'arbre Chasse, plus tard, par-dessus.
   */
  BLOOD_EVERY_TICKS: ticksFor(0.8),
  BLOOD_TTL: ticksFor(180),
  BLOOD_CAP: 256,
  /**
   * LA BÊTE DIMINUÉE. Sa vitesse suit ses PV : `FLOOR + (1 − FLOOR) × hp/hpMax`.
   * L'écart se referme à mesure qu'elle saigne — PRESSER une bête mortellement
   * atteinte devient une stratégie, au prix de l'endurance. (L'autre stratégie,
   * c'est d'ATTENDRE qu'elle se couche… mais le sang appelle d'autres nez.)
   */
  WOUNDED_SLOW_FLOOR: 0.55,
  /**
   * LE COUCHÉ. Une bête à plaie mortelle qui ne perçoit plus rien pendant ce
   * temps gagne le meilleur couvert à portée et s'y TAPIT : immobile, perception
   * effondrée. On la retrouve PAR LE SANG, pas en battant la carte.
   */
  BED_AFTER: ticksFor(10),
  BED_SEEK: 8,
  BED_ALERTNESS: 0.4,
  /**
   * LE SANG APPELLE LES LOUPS (C12). Une carcasse FRAÎCHE porte loin : le
   * prédateur affamé la sent à `CARCASS_SEEK_FRESH` au lieu de `CARCASS_SEEK`.
   * Mis bout à bout avec le portage (qui interdit le silence, C2) : TUER ARME UN
   * MINUTEUR. On tue, on charge la viande — et on entend le hurlement.
   */
  CARCASS_FRESH_TICKS: ticksFor(240),
  CARCASS_SEEK_FRESH: 40,
  /** Le poids de spawn des prédateurs près d'une carcasse fraîche ou d'un blessé. */
  BLOOD_PREDATOR_BIAS: 2,
  BLOOD_SCENT_RADIUS: 30,
  /**
   * LE PRÉDATEUR PRÉFÈRE LE SANG. Une cible qui saigne « pèse » ça de plus au
   * choix de proie (même mécanique que PREY_PREFERENCE). La meute cueille les
   * diminués — y compris VOTRE cerf blessé, et y compris VOUS (décision
   * utilisateur n°2 : le sang du joueur appelle les loups ; le bandage devient
   * un geste de survie en territoire à loups).
   */
  WOUNDED_PREFERENCE: 1.5,

  /* ── CHASSE III — la ruse (C14-C18) ─────────────────────────────────────── */
  /**
   * LA SCISSION (C14). Une harde levée éclate en DEUX : les rangs pairs
   * infléchissent leur fuite d'un côté, les impairs de l'autre (rotation ±45°,
   * matrice à coefficients littéraux). Le chasseur qui charge « la harde » court
   * entre deux moitiés et n'a rien : ON CHOISIT SA BÊTE AVANT DE LEVER LE GROUPE.
   */
  SPLIT_COS: 0.7071,
  SPLIT_SIN: 0.7071,
  /**
   * LE CROCHET (C15). En terrain DÉCOUVERT, la bête jinke : à chaque nouveau
   * burst, son vecteur de fuite tourne de ±40° (au PRNG). Courir droit derrière
   * ne marche plus ; anticiper le crochet et COUPER, si. En couvert, elle file :
   * le terrain décide du geste.
   */
  JINK_COS: 0.766,
  JINK_SIN: 0.6428,
  JINK_OPEN_COVER: 0.85, // au-dessus de ce couvert, le terrain est « découvert »
  /**
   * LE CŒUR DU MASSIF COUVRE MIEUX (spec t0-exploration §2quater R41) : facteur appliqué au
   * couvert du terrain quand la tuile est au CŒUR d'un massif boisé (et encore boisée — le
   * bonus meurt avec l'arbre). Une seule fonction le porte (`couvertEffectif`) pour ses trois
   * lecteurs : la détectabilité du chasseur, le rôdeur qui traque, le choix de couche du
   * gibier. < 1 = mieux caché.
   */
  COVER_COEUR: 0.8,
  /**
   * LA LITIÈRE QUI CRAQUE (forêts-vivantes §2 R3) : sur le sol des FEUILLUS, le bruit d'un
   * pas se multiplie en PENTE CONTINUE de 1 (lisière) à ce plafond (au PROF_CAP de
   * l'érosion). L'arbitrage spatial de la chasse : le cœur cache mieux (COVER_COEUR) mais
   * s'y déplacer s'entend mieux — et le bruit est omnidirectionnel, ni le fourré ni le dos
   * tourné ne le masquent. Un seul lecteur (`bruitDuSol`, dans `avatarThreat`).
   */
  LITIERE_BRUIT_COEUR: 1.5,
  /**
   * L'ENVOL DE LA LISIÈRE (forêts-vivantes §3 R4) : franchir une lisière de bois à un
   * bruit effectif ≥ ENVOL_SEUIL fait gicler les oiseaux. 0,9 : la marche (1) déclenche,
   * le pas lent (0,4) passe — et le PORTAGE LOURD, qui rehausse tout pas au niveau de la
   * marche, trahit même le prudent : le retour de chasse fait lever les nuées. Le gibier
   * dans le rayon d'alarme prend un coup de méfiance ; les perchoirs se REPOSENT (un envol
   * par zone de COOLDOWN_RAYON tous les COOLDOWN_TICKS) — la forêt n'est pas une sirène.
   */
  ENVOL_SEUIL: 0.9,
  ENVOL_ALARME_RAYON: 14,
  ENVOL_SUSPICION: 0.35,
  ENVOL_COOLDOWN_RAYON: 24,
  ENVOL_COOLDOWN_TICKS: 900, // 45 s à 20 Hz
  /** L'APPÂT SUR UNE COULÉE porte plus loin (forêts-vivantes §4) : le chemin du gibier
   *  amène le nez dessus. Multiplie BAIT_SEEK pour les piles posées sur un chemin. */
  BAIT_COULEE_FACTEUR: 1.5,
  /**
   * LA HARDE EMPRUNTE SA COULÉE (forêts-vivantes §4 R5quater) : aux heures crépusculaires,
   * le gibier attaché à un coin proche d'une fin de coulée DESCEND le chemin et BOIT — tête
   * baissée (BAIT_ALERTNESS), la fenêtre d'affût que la géographie enseigne. Une descente
   * par fenêtre, jamais un tirage : la trace ne ment plus.
   */
  COULEE_AUBE_DE: 5,
  COULEE_AUBE_A: 8,
  COULEE_SOIR_DE: 17,
  COULEE_SOIR_A: 20,
  COULEE_ATTACHE: 28, //     coin → fin de coulée, en tuiles (et bête → chemin, au raccord)
  COULEE_BOIRE_TICKS: 200, // 10 s tête baissée au bord de l'eau
  /**
   * LE TERRIER (C16). Le lapin naît avec le sien (sa tuile de naissance, hors
   * champ par construction). Levé, il fuit VERS lui — sauf à devoir traverser la
   * menace — et il y DISPARAÎT. La chasse au lapin devient une géométrie :
   * couper la ligne du terrier, ou le perdre.
   */
  BURROW_RANGE: 1.2, // il y entre à cette distance
  /**
   * LE CHASSEUR COUPE-T-IL LA ROUTE DU TERRIER ? Cosinus entre « vers mon terrier » et
   * « vers la menace » : au-dessus, la menace est GROSSO MODO dans l'axe du terrier, et
   * le lapin renonce à y foncer (il détourne plutôt que courir dans les bras). 0,6 ≈ 53°
   * de demi-cône. Monter la valeur rend le lapin plus téméraire.
   */
  BURROW_BLOCKED_DOT: 0.6,
  /**
   * LE VENT (C17). Il tourne lentement, au PRNG de l'état. L'ODEUR DESCEND LE
   * VENT : une menace au vent d'une bête (alignement > SCENT_COS, dans
   * SCENT_RANGE_FACTOR × sa portée) fait monter sa méfiance QUELS QUE SOIENT
   * l'allure, le couvert et le dos tourné. Le nez se moque des précautions — et
   * c'est le seul sens qui s'en moque. La parade n'est pas un facteur de plus :
   * c'est UN CÔTÉ. Approcher sous le vent.
   */
  WIND_SHIFT_TICKS: ticksFor(300),
  SCENT_RANGE_FACTOR: 1.2,
  SCENT_COS: 0.8,
  /** Ce que « sentir » vaut comme perception (× la portée) : le nez porte fort. */
  SCENT_STRENGTH: 1,
  /**
   * L'APPÂT (C18). Le gibier est attiré par la nourriture au sol, s'y plante et
   * mange — la fenêtre du chasseur, POSÉE PAR LE CHASSEUR. Et un prédateur mange
   * une pile de viande comme une carcasse : jeter de la viande à une meute qui
   * vous serre (faune R15, GDD §9bis) devient enfin un geste exécutable.
   */
  BAIT_SEEK: 12,
  BAIT_RANGE: 1.2,
  BAIT_TICKS: ticksFor(6),
  BAIT_ALERTNESS: 0.4, // tête dans l'appât : ses portées s'effondrent
  /** Une pile au sol périt : le monde ne se jonche pas (~10 min). */
  GROUND_TTL: ticksFor(600),
} as const

/** La levée des Cendreux (spec 2026-07-08). Ordres de grandeur, calibrage playtest. */
export const CENDREUX = {
  WITNESS_RADIUS: 8, // « seul » : aucun allié vivant dans ce rayon à la mort
  HEARTH_WARD_RADIUS: 12, // « loin d'un feu » : aucune structure feu (mort ET réveil)
  RISE_DELAY: ticksFor(300), // délai mort→levée (~5 min ; le cadavre marqué ne décante pas d'ici là)
  WARMTH_SEEK_RANGE: 20, // rayon de recherche de chaleur en A* précis (au-delà : champ longue portée)
  /**
   * ═══ LE CADRAN UNIQUE DU CENDREUX : LA TEMPÉRATURE LOCALE ═══
   * *(décisions d'Alexis 2026-08-21, spec `2026-08-21-cendreux-pression-croissante-design.md` —
   * « un cendreux doit être presque amorphe lorsqu'il fait chaud ».)*
   *
   * L'ÉVEIL est une PENTE CONTINUE : clamp01((CHAUD − T) / (CHAUD − FROID)) sur le froid de BASE
   * (`baselineTemperatureAt` — hors feu, sinon oscillation à la lisière de la bulle, la note
   * historique de S5). Il module la VUE, l'ALLURE et la cadence de décision — jamais de seuil qui
   * commande un mouvement (ce dépôt a payé quatre fois l'hystérésis manquante d'un seuil).
   *
   * CHAUD=60 / FROID=10 ne sont pas choisis au doigt : la nuit de plaine vaut 60 / 35 / 10 selon
   * l'acte (BASE 90 − ACT_COLD − NIGHT_COLD), donc l'éveil nocturne y vaut 0 / 0,5 / 1 — LA TABLE
   * EXACTE de feu `UNDEAD_SHARE` [0, 0.5, 1], retrouvée par la température au lieu d'être posée
   * par l'acte. La montée de la saison n'est plus décrétée : elle TOMBE de la table du froid, et
   * la géographie vient gratuitement (neige −40, glacier −75, brume, front météo, froid de cendre
   * — le Névé est dangereux dès le jour 1, et c'est voulu).
   */
  TORPEUR: {
    CHAUD: 60, // à cette température et au-dessus : éveil 0 (amorphe — il mord encore au contact)
    FROID: 10, // à cette température et en dessous : éveil 1 (plein régime)
    /** La vue ne tombe jamais à zéro : aggroRange × max(éveil, ceci). Marcher SUR une carcasse
     *  réveille la carcasse — le nettoyage de jour reste risqué, jamais gratuit. */
    VUE_PLANCHER: 0.2,
    /** L'allure d'un cendreux QUI A UN BUT ne tombe jamais sous ce facteur : « presque amorphe »
     *  n'est pas « statue » (constat du panel : l'acte I aurait figé toute marche). Sans but, il
     *  ne bouge pas du tout — c'est là que vit l'amorphe. */
    GAIT_MIN: 0.25,
    /** Sous ce froid de base, il CHERCHE la chaleur (l'ancien COLD_ATTRACT_THRESHOLD, 55, ne
     *  couvrait pas la nuit d'acte I à 60 — or le levé d'acte I converge à 20 tuiles, statu quo
     *  acté). 65 : toute nuit de plaine, les biomes froids de jour, la plaine d'acte III à midi. */
    CONVERGE_SOUS: 65,
    /** LE CRAN DE FUREUR (décisions ④⑤) : à ce froid EFFECTIF (base + satiété déduite) ou en
     *  dessous, un cendreux qui voit une proie S'APPELLE — le cri réveille le sol. ≤ 12 et non
     *  < 10 : la plaine de nuit d'acte III vaut EXACTEMENT 10, un strict ne tirait jamais dans
     *  le cas-phare (constat du panel). */
    FUREUR: 12,
  },
  /**
   * ═══ LES SENS HONNÊTES (décision d'Alexis, 2026-08-21 — spec R24-R25) ═══
   *
   * Le Cendreux cesse d'être un rayon nu : sa détection lit le STIMULUS de chasse (allure,
   * couvert, météo sur la vue — `stimulusPourLesMorts`) et le sol lui PORTE les impacts
   * (`secouerLeSol`, module `sens.ts`). Peau diégétique tranchée en QCM : la VIBRATION DU SOL —
   * les morts du sol n'entendent pas, ils sentent ce qui l'ébranle. D'où les exclusions de
   * R25 : la corde d'arc, la flèche, la main qui cueille et le coup dans le vide ne portent
   * pas ; un monstre n'émet jamais (décision ⑤ : pas d'alerte goule→goule, même par le sol) ;
   * et le brouillard voile des yeux, jamais le sol.
   */
  SENS: {
    /** Facteur du canal vibration du PAS (bruit d'allure × litière × ceci). À 1, le marcheur
     *  à découvert garde ses 5 tuiles au bit près et le sprint porte à 5 × 1,6 = 8. */
    VIBRATION: 1,
    /** Plancher ABSOLU de détection, en tuiles — après stimulus ET météo : marcher SUR une
     *  carcasse la réveille TOUJOURS, même immobile sous la pluie (la garantie VUE_PLANCHER,
     *  que le facteur météo trouait : 0,85 tuile sous la pluie, 0,5 sous le brouillard). */
    CONTACT: 1,
    /** Portée de secousse d'un coup qui PORTE (mêlée qui touche, coup d'OUTIL de récolte),
     *  multipliée par l'éveil du Cendreux qui la sent. */
    COUP: 8,
    /** Portée de secousse d'une pose de pièce (`build`, `place_component`) — le chantier
     *  s'entend de plus loin que le coup, comme la construction de PZ (15) devant sa marche (7). */
    BATIR: 12,
  },
  /**
   * PORTÉE D'ÉLECTION DU FEU-CIBLE d'un solitaire qui converge (décision ① — « il marche, et de
   * plus en plus loin ») : acte I, ses 20 tuiles historiques (statu quo) ; acte II, la ceinture ;
   * acte III, toute la vallée se referme sur les feux. La table est par ACTE et c'est assumé :
   * c'est une PORTÉE de perception, pas une intensité — le continu vit dans l'éveil.
   */
  CONVERGE_TILES: [20, 80, 10000] as const,
  /**
   * ═══ « ILS BOIVENT LA CHALEUR » (décision d'Alexis, 2026-08-21) ═══
   *
   * Le Cendreux cherche ardemment la chaleur — feu ou vie — pour la CONSOMMER. Deux bouches :
   * au contact d'un feu en flammes, le combustible se consume plus vite (le patron exact de
   * `meteoFeuConso` : on recule l'ancre `burnAt`, et tout ce qui s'en dérive — état, budget,
   * indicateur client — voit la même faim) ; au coup porté sur un vivant, la température du
   * corps chute (l'aval existe déjà tout entier : engourdissement, souffle, dégâts sous 20).
   *
   * LE PLANCHER, ET C'EST LA SPEC : on boit les FLAMMES, jamais les braises. Un feu bu tombe
   * en braises et y RESTE tant qu'elles durent — le ward tient jusqu'aux braises, et sans ce
   * plancher un feu vidé ouvrait la spirale interdite : plus de rempart contre les réveils au
   * moment précis où l'on ne peut plus rien (décision ⑦ : le feu achète, il ne trahit pas).
   */
  BOIRE: {
    /** Distance (tuiles) feu→cendreux ou centre à centre pour boire. */
    CONTACT: 1.5,
    /** La bûche en cours vieillit de N ticks par tick et par buveur (patron `meteoFeuConso`). */
    CONSO: 3,
    /** Température volée à la victime par coup qui porte (l'aval : engourdi < 60, PV < 20). */
    COUP_TEMP: 12,
    /** Satiété gagnée par coup porté sur un vivant (bête comprise — la chair est chaude). */
    SATIETE_COUP: 25,
    /** Satiété gagnée par tick passé à boire un feu. */
    SATIETE_FEU_PAR_TICK: 0.5,
    /** L'échelle de la satiété. Plein = (CHAUD − FROID) degrés portés : il s'affaisse. */
    SATIETE_MAX: 100,
    /** Refroidissement par tick (~5 min réelles pour redevenir affamé). */
    SATIETE_DECAY: 100 / 6000,
    /** Le Foyer de village bu ne descend JAMAIS sous ce stock par la seule bouche d'un
     *  cendreux : tuer un Feu reste une affaire d'attaque à sec (V1-12), pas de sangsue. */
    FOYER_PLANCHER: 1,
  },
  /**
   * ═══ LE CRI (décisions ④⑤⑥) — le cran de fureur appelle, et l'appel réveille LE SOL ═══
   *
   * Sous `TORPEUR.FUREUR` de froid effectif, un cendreux qui VOIT une proie crie : le sol se
   * lève autour du lieu où il l'a vue — des réveils VRAIS (tertres, préavis, feu qui repousse),
   * jamais des apparitions. La salve plante UN site par tick de décision, pas K d'un coup :
   * le pire cas mesuré d'un site coûte 33 ms (proie murée), on l'étale au lieu de l'empiler.
   */
  CRI: {
    /** Un cendreux ne crie pas deux fois de suite : ~30 s entre deux appels. */
    COOLDOWN: ticksFor(30),
    /**
     * COMBIEN UN CRI LÈVE, EN FIN DE SAISON — le plafond du jour J est round(FIN × jour/60),
     * une MONTÉE CONTINUE (décision ⑥ : « un plafond qui monte en continu », le remède au
     * défaut « une table de trois valeurs est plate »). Jour 10 : 1. Jour 30 : 3. Jour 60 : 6.
     */
    PLAFOND_FIN: 6,
  },
  /**
   * ═══ LE PLAFOND GLOBAL (hypothèse de travail actée — la question ⑳ d'Alexis reste OUVERTE) ═══
   *
   * Toutes les sources de PRESSION puisent dans la même réserve, qui monte avec le jour de
   * saison : levées, réveils de la nuit, salves du cri, hordes et leurs reliques. Pleine, plus
   * rien ne se lève nulle part ; abattre rouvre une place partout. C'est T15 tenu par
   * construction (« on peut perdre, on ne doit pas être submergé »).
   *
   * IL COMPTE CE QU'IL BORNE, et rien d'autre — la loi mesurée du dépôt (R8bis : compté sur
   * l'espèce entière, un plafond de 24 était SATURÉ au jour 21 par les seuls résidents de
   * Repaire et gardes de convoi, et la règle qu'il protégeait était morte). Les résidents
   * (`homePoi`) ont le cap de leur lieu ; les gardes de convoi (`expiresAt` sans relique) ont
   * leur balayage : ils ne consomment PAS cette réserve-ci. Constat du panel (C10/C17),
   * conforme à la mémoire « un plafond compte ce qu'il borne ».
   */
  GLOBAL: {
    DEBUT: 12,
    FIN: 60,
  },
  /**
   * LE PLAFOND DE LA LEVÉE (spec `cendreux.md` R8, décision 2026-07-31). Au-delà de ce nombre
   * de Cendreux VIVANTS dans la vallée, plus aucune mort ne se relève — la porte se rouvre
   * dès qu'on en abat un.
   *
   * C'est T15 de `tension.md` appliqué à la lettre : « on peut perdre, on ne doit pas être
   * submergé ». Depuis que la contagion existe (R7 — la victime d'un Cendreux se relève à son
   * tour), une nuit qui tourne mal pourrait s'emballer sans jamais retomber ; bornée, elle
   * fabrique une histoire au lieu de fermer la porte.
   *
   * L'ordre de grandeur se lit contre les deux autres sources : la carte solo porte déjà 9
   * Repaires résidents (mesuré, 3,75 M tuiles), et une horde d'acte III en lève 12. 24 laisse
   * donc respirer une horde pleine plus la contagion d'une mauvaise nuit, sans permettre à la
   * vallée de se remplir jusqu'à l'étouffement. À calibrer en playtest.
   */
  MAX_ALIVE: 24,
}

/** Le combat (GDD §7, spec combat) — lent, positionnel, gagné avant l'échange. */
export const COMBAT = {
  ATTACK_STAMINA: 15,
  SPRINT_STAMINA_PER_S: 8,
  BLOCK_STAMINA_BASE: 10,
  STAMINA_REGEN_IDLE_PER_S: 10,
  STAMINA_REGEN_MOVING_PER_S: 5,
  /** Modulateurs de régén : bien nourri (faim > `FED_REGEN_HUNGER`) / affamé (faim 0). */
  FED_REGEN_BONUS: 1.25,
  STARVED_REGEN_MALUS: 0.5,
  /** Au-dessus de cette faim, le souffle revient plus vite (`FED_REGEN_BONUS`). */
  FED_REGEN_HUNGER: 70,
  /**
   * ON NE CICATRISE PAS LE VENTRE VIDE : en-dessous de cette faim, les PV ne remontent
   * plus du tout. Distinct de `FED_REGEN_HUNGER` (qui module le SOUFFLE, pas les PV) —
   * deux jauges, deux seuils, et ils étaient tous les deux écrits en clair dans
   * `advanceCombat`.
   */
  HP_REGEN_HUNGER_MIN: 50,
  /**
   * LE SOUFFLE SE PAIE EN VENTRE (décision Alexis, 2026-08-01) : chaque point
   * d'endurance REGAGNÉ coûte ce nombre de points de faim. Facturé sur les points
   * réellement CRÉDITÉS (après le clamp à 100) — sinon une barre pleine draine la
   * faim à l'arrêt, pour rien.
   *
   * L'ordre de grandeur se lit contre la faim passive, ~2 points par minute réelle
   * (jauge pleine ≈ 50 min, un cycle) : refaire une barre entière coûte 2 de faim,
   * soit ~1 minute de survie. Une fuite qui vide la barre trois fois brûle donc une
   * demi-heure de ventre en deux minutes. Ça se sent sans dominer — la faim reste
   * réglée par les repas, la course l'accélère. Ne s'applique PAS aux monstres
   * (leur faim n'est jamais drainée) ni à l'acte de saison (le coût est par point
   * récupéré, pas par saison : c'est ACT_HUNGER_FACTOR qui porte le Grand Froid).
   */
  STAMINA_REGEN_HUNGER_COST: 0.02,
  /**
   * ON RESSORT D'ÉPUISEMENT ICI, PAS AU PREMIER POINT REGAGNÉ — l'hystérésis du souffle.
   *
   * Sans elle, la garde « la course ne régénère pas » se retourne contre elle-même : à 0
   * d'endurance la course est refusée, donc l'allure retombe à `walk`, donc la régén
   * crédite, donc au tick suivant il reste de quoi repartir — qui reponctionne à 0.
   * MESURÉ : **200 ticks de sprint sur 400**, un cycle de deux ticks à 10 Hz, SHIFT jamais
   * relâchée. Une tuile sur deux courue, soit 5 t/s en moyenne et pour toujours — quand le
   * loup court à 4,8. Le joueur semait ENCORE la meute, à endurance nulle : très
   * exactement la plainte qui a ouvert le chantier.
   *
   * C'est la quatrième fois que ce dépôt l'apprend (cohésion et séparation de `faune.ts`,
   * verrou `wary`) : **un seuil qui commande un mouvement veut son hystérésis**. Le
   * verrou vit dans `Entity.exhausted` ; il se pose à 0 et ne se lève qu'ici.
   *
   * 25 : ~2,5 s de récupération à l'arrêt (10/s), ~4 s en marchant. Assez pour qu'un
   * essoufflement se PAIE — on ne repart pas en courant, on souffle d'abord — sans clouer
   * le joueur au sol le temps d'une barre entière. À calibrer en playtest.
   */
  SPRINT_RECOVER_STAMINA: 25,
  /** UNE PLAIE NON SOIGNÉE FREINE LA GUÉRISON (V1-14, GDD §6bis) — c'est ce qui fait
   *  exister le médecin : le bandage clôt la plaie et rend la régén pleine. On ne coupe
   *  pas à zéro (sans soin PNJ autonome, les villageois spiraleraient) : on freine fort,
   *  le bandage reste la vraie cure (modèle Project Zomboid : on guérit une fois traité). */
  WOUNDED_REGEN_FACTOR: 0.25,
  /** Armement par DÉFAUT — celui des BÊTES (les avatars suivent WEAPON_PROFILES). */
  WINDUP_TICKS: ticksFor(0.4),
  /** Portée par DÉFAUT — celle des BÊTES. Un avatar frappe à la portée de son arme. */
  ATTACK_RANGE: 1.4,
  /**
   * LE PAS QUI DANSE (spec combat R4bis). Les coups de poing successifs portent le
   * corps en avant, mais en zigzag : gauche, droite, gauche… Le pas dévie de 25° de
   * la visée — on frappe TOUJOURS là où l'on vise, seul le PIED change de côté.
   * Tabulés : `Math.cos`/`Math.sin` sont interdits dans /sim (invariant §2).
   */
  WEAVE_COS: 0.9063,
  WEAVE_SIN: 0.4226,
  /** On ne charge pas un coup en courant : maintenir le clic ralentit (spec R4ter). */
  CHARGE_MOVE_FACTOR: 0.55,
  /** Distance à laquelle une BÊTE déclenche sa morsure (sa portée est ATTACK_RANGE).
   *  Un AVATAR, lui, engage à la portée de son arme × ENGAGE_MARGIN (`engageRange`). */
  MELEE_ENGAGE_RANGE: 1.2,
  /** On entre DANS sa zone, on ne s'arrête pas pile sur son bord : la cible bouge. */
  ENGAGE_MARGIN: 0.85,
  /** Portée du coup porté à une structure (murs, portes — cibles larges). */
  STRUCTURE_STRIKE_RANGE: 2.2,
  /** Rythme minimal entre deux attaques d'un avatar (PNJ compris). */
  ATTACK_COOLDOWN_TICKS: ticksFor(1),
  /** Temps d'immobilisation des mains après un bandage. */
  BANDAGE_COOLDOWN_TICKS: ticksFor(1),
  ATTACK_ARC_COS: 0.7071, // cos(45°) — arc total de 90°
  /**
   * LE CORPS COMPTE, PAS SON SEUL CENTRE (décision d'Alexis, 2026-08-02).
   *
   * `inStrikeZone` a longtemps testé le POINT `target.x/target.y` : un loup dont la
   * moitié du corps baignait dans l'arc, mais dont le centre en dépassait d'un cheveu,
   * ne prenait rien. MESURÉ (`tools/mesure-touche.mts`) : compter un corps de ce rayon
   * ajoute de +16 % (lance) à +36 % (poings) de surface réellement touchée — c'est la
   * part du combat qui avait l'air de porter sans porter.
   *
   * Le rayon est celui du corps en profondeur (`AVATAR_HITBOX_DEPTH_TILES / 2`), la
   * plus PETITE des deux mesures d'un avatar : la plus prudente. Et il vaut pour TOUT
   * LE MONDE — joueurs, PNJ, bêtes — parce que c'est le même pipeline de résolution qui
   * les sert tous (« personne ne triche »). Conséquence assumée : les loups et les
   * Cendreux touchent aussi plus souvent, donc la nuit mord plus fort.
   *
   * À 0, on retrouve exactement l'ancien test au point.
   */
  HIT_BODY_RADIUS: 0.1875,
  /**
   * LE COUP REPOUSSE (demande d'Alexis, 2026-08-02 : « un petit knockback ») — en tuiles,
   * pour un coup SIMPLE. La règle est ÉCRITE, TESTÉE (A16) et SPÉCIFIÉE (combat R4sexies).
   *
   * ═══ ELLE EST LIVRÉE À ZÉRO, ET C'EST UNE MESURE QUI LE DIT ═══
   *
   * Le recul et la MEUTE sont incompatibles. Mécanisme : un coup qui porte pousse la proie
   * hors du cône DÉJÀ ARMÉ du loup suivant — celui-ci fend l'air, mange sa récupération de
   * raté (longue, exprès), et une seule morsure protège ainsi des trois d'après. La
   * pression de meute s'effondre en cascade.
   *
   * MESURÉ (`tools/diag-recul.mts`, 6 graines, banc de `faune.test.ts`, 2 h du matin) :
   *
   *     recul   encerclement (≥ 2 côtés tenus)   l'homme désarmé MEURT
   *     0                6/6                            6/6   (2,5 à 3,7 s)
   *     0,10             0/6                            4/6
   *     0,25             0/6                            3/6
   *
   * **Dès 0,10 tuile — un pixel et demi — le cercle ne se ferme plus sur AUCUNE graine.**
   * C'est l'encerclement construit le 2026-08-01, et R13 (« la mort doit être l'issue
   * probable ») avec lui. Un recul qu'on sent est un « sortez de prison » contre les loups :
   * ce n'est pas un réglage, c'est un arbitrage entre deux règles, et il revient à Alexis.
   *
   * Le remonter est UN SEUL NOMBRE. Ce qui l'accompagne est déjà en place : la poussée est
   * radiale, passe par `resolveMove` (un mur l'arrête), se joue AVANT les dégâts, n'interrompt
   * rien, et se verrouille à un recul par tick (une horde ne catapulte pas).
   *
   * En attendant, le coup se SENT quand même : le recul du corps frappé est peint côté
   * client (`attack-fx.ts`), sans toucher à la position — donc sans rien coûter à la meute.
   */
  /**
   * UNE FLÈCHE SUR DEUX SE RAMASSE (décision d'Alexis, 2026-08-02) — la probabilité qu'un
   * trait décoché retombe en pile ramassable ; sinon il est PERDU.
   *
   * La première version rendait tout, et le coût de la munition n'était que le temps
   * d'aller la reprendre. À une chance sur deux, le carquois se vide pour de bon : tirer
   * devient une dépense, fabriquer des flèches une corvée qui revient, et le lot de cinq
   * prend son sens. C'est le seul tirage de PRNG que le tir ajoute — il n'a lieu qu'à un
   * tir, donc aucun banc sans archer n'en consomme.
   */
  ARROW_RECOVERY: 0.5,
  KNOCKBACK_TILES: 0,
  /** Le coup CHARGÉ repousse le double : le poids du geste se lit au sol. */
  KNOCKBACK_CHARGED_FACTOR: 2,
  BLOCK_ARC_COS: 0.5, // cos(60°) — arc frontal de 120°
  BLOCK_REDUCTION: 0.7,
  BLOCK_MOVE_FACTOR: 0.3,
  SPRINT_FACTOR: 1.5,
  UNARMED_DAMAGE: 6,
  WOUND_THRESHOLDS: [66, 33],
  /**
   * QUELLE PLAIE TOMBE — les bornes du tirage, dans l'ordre `jambe · bras · saignement`.
   * `roll < 0.34` → jambe ; `< 0.67` → bras ; sinon saignement. Soit trois tiers, à un
   * cheveu près. Ce sont des NOMBRES D'ÉQUILIBRAGE (la jambe coûte la vitesse, le bras
   * les dégâts ET le travail, le saignement le temps) et ils vivaient en clair dans
   * `applyDamage` : on ne pouvait pas rendre les plaies de jambe plus rares sans aller
   * lire le code.
   */
  WOUND_ROLL_LEG: 0.34,
  WOUND_ROLL_ARM: 0.67,
  LEG_WOUND_SPEED: 0.6,
  ARM_WOUND_DAMAGE: 0.6,
  BLEED_HP_PER_S: 1.5,
  BANDAGE_FIBER_COST: 3,
  HP_REGEN_PER_MIN: 2, // si faim > 50 ; FREINÉ ×WOUNDED_REGEN_FACTOR par une plaie non soignée (§6bis)
  RESPAWN_HP: 50,
  RESPAWN_HUNGER: 50,
  RESPAWN_STAMINA: 20,
  RESPAWN_TEMPERATURE: 100,
  /** Épuisement post-mort de BASE : régén d'endurance ÷2 (~5 min). Le coût CROÎT avec
   *  les morts rapprochées (V2-21) — voir DEATH_EXHAUSTION_*. */
  EXHAUSTION_TICKS: ticksFor(300),
  /** Chaque mort rapprochée rallonge l'épuisement de +50 %… */
  DEATH_EXHAUSTION_GROWTH: 0.5,
  /** …plafonné à +6 crans (soit ×4 l'épuisement de base : le respawn n'est plus gratuit,
   *  sans devenir une spirale de mort). */
  DEATH_EXHAUSTION_CAP: 6,
  /** Survivre ce temps SANS mourir remet le compteur de morts à zéro (on oublie). */
  DEATH_FORGET_TICKS: ticksForCycles(1),
  EXHAUSTED_REGEN_FACTOR: 0.5,
  CORPSE_TICKS: ticksFor(600),
  DEFEND_RADIUS: 10,
} as const

/**
 * PV des structures (spec événements R1). LE FEU EST TUABLE — MAIS SEULEMENT À SEC
 * (V1-12) : `applyStructureDamage` ignore tout dégât tant que `village.fuel > 0` (un
 * Feu nourri est un totem inviolable). À sec, ces PV finis peuvent tomber sous un
 * assaut soutenu → la RUINE. Assez haut pour qu'un joueur seul ne perde pas en un
 * souffle, assez bas pour qu'une horde vienne à bout d'un village abandonné.
 *
 * VUE DÉRIVÉE du registre (`pieces.ts`) — NE PAS ÉDITER : éditer `PIECES`. Ce sont
 * aussi les PV de RÉFÉRENCE de l'usure : `poi-batis.ts` pose une ruine à une fraction
 * de ce nombre, et le client l'assombrit d'autant. Pour `wall`/`door`, c'est le palier
 * de matériau de BASE (bois) ; les paliers montent via `WALL_TIERS`.
 */
export const STRUCTURE_HP: Record<StructureType, number> = parPiece((t) => piece(t).pv)

/**
 * L'UPKEEP DU FEU (spec construction R16-R17) — le seul évier PERMANENT de
 * l'économie de flux (GDD §8). Le Feu consomme lentement du combustible pour tenir
 * sa zone : PLEIN → les murs/barrières ne se dégradent pas ; à SEC → ils cèdent, et
 * le village finit en ruine. Le plein tient ~3,5 cycles d'ABANDON (GDD §6ter « survit
 * à 3-4 jours d'abandon »), plus vite au Grand Froid. BRAISES DORMANTES : le Feu ne
 * s'éteint jamais (la chaleur tient), seule l'architecture cède — les COMPOSANTS
 * jamais (R17). Calibrage à valider en playtest (décision de session, cf. decisions.md).
 */
export const FIRE_UPKEEP = {
  /** Capacité de stock — plein = 10 bois (via FEED_PER_WOOD). */
  CAPACITY: 240,
  /** À la fondation : un demi-plein. Une grâce (~1,75 cycle), pas un cadeau. */
  START: 120,
  /** 1 bois nourrit le Feu de tant. */
  FEED_PER_WOOD: 24,
  /** Combustion par tick à l'acte I ; ×ACT_FACTOR ensuite. Calé pour que le PLEIN
   *  tienne ~3,5 cycles à l'acte I (spec « 3-4 jours »). */
  DRAIN_PER_TICK: 240 / ticksForCycles(3.5),
  /** Le Grand Froid brûle plus (même montée que la faim, §2). */
  ACT_FACTOR: [1, 1.5, 2] as const,
  /** À SEC, un mur/barrière perd tant de PV/tick — un mur neuf (200) tombe en ~1,5 cycle. */
  WALL_DECAY_PER_TICK: 200 / ticksForCycles(1.5),
  /** Sous ce stock, le tableau poste « nourrir le Feu » (la tâche communautaire zéro, R16). */
  TASK_THRESHOLD: 96,
} as const

/**
 * LE FEU COMME STATION (spec `docs/specs/feu-station.md`) — le combustible du feu
 * LIBRE, porté par la STRUCTURE (et non le village : l'upkeep du Foyer reste séparé,
 * migration différée S16). Mêmes unités que FIRE_UPKEEP. Calibrage à valider en playtest.
 */
export const FIRE = {
  /** Le combustible d'un feu libre est un inventaire de tant de SLOTS (bûches). */
  FUEL_SLOTS: 3,
  /** À la pose : le feu démarre avec tant de bois dans ses slots combustible. */
  FUEL_START_WOOD: 10,
  /** Durée de combustion d'UNE bûche (ticks) — le feu en brûle une à la fois. Calé pour que
   *  10 bois tiennent ~1,5 cycle (comme avant). C'est aussi la durée de l'indicateur de
   *  consommation du slot combustible. */
  BURN_TICKS: ticksForCycles(0.15),
  /** Fenêtre de BRAISES après épuisement, avant l'extinction totale — le sas d'alerte (S2). */
  EMBER_TICKS: ticksFor(30),
  /** Chaleur des braises = fraction de la chaleur pleine (S3). */
  EMBER_WARMTH_FACTOR: 0.4,
  /** Slots de cuisson : 3 ENTRÉES (aliments cuisant en parallèle), 3 SORTIES (cuits + sous-produits). */
  COOK_INPUTS: 3,
  COOK_OUTPUTS: 3,
} as const

/**
 * CE QUI SE CUIT AU SLOT D'UNE STATION (spec feu-station S10-S11) — par type de station :
 * l'entrée BRUTE → le résultat + la durée (ticks). C'est LA donnée réutilisable : le futur
 * Fumoir déclarera les siennes, le modal se rend à partir d'ici. Ce passage : le feu cuit
 * la VIANDE, rien d'autre (S10) ; `stew`/`graine`/cuir/outils restent au panneau de craft.
 */
export const COOK_SLOT: Partial<
  Record<
    import('./items').StructureType,
    Partial<
      Record<
        import('./items').ItemId,
        { output: import('./items').ItemId; byproducts?: { item: import('./items').ItemId; count: number }[]; ticks: number }
      >
    >
  >
> = {
  // Le feu cuit la VIANDE (S10). `byproducts` déclare d'éventuels SOUS-PRODUITS (graisse, os… —
  // items à définir par Alexis) qui tombent dans les 3 slots de SORTIE avec le résultat.
  fire: { raw_meat: { output: 'cooked_meat', ticks: ticksFor(5) } },
}

/** Hordes & événements du monde (spec événements). */
export const WORLD_EVENTS = {
  REPAIR_WOOD_COST: 1,
  REPAIR_HP: 50,
  /** Sous cette fraction de PV, le tableau poste une tâche de réparation. */
  REPAIR_TASK_THRESHOLD: 0.6,
  /** Une alarme par vague : cooldown d'une heure de cycle. */
  ALARM_COOLDOWN_TICKS: ticksForCycles(1 / 24),
  /**
   * ═══ LA HORDE EN PENTE CONTINUE (décision d'Alexis ⑭, 2026-08-21) ═══
   *
   * Probabilité par nuit et taille montent JOUR APRÈS JOUR (`seasonRamp`, clampée au jour
   * 60) au lieu de deux tables de trois valeurs — « une table de trois valeurs, et une table
   * est plate ». Nuit 1 : une chance sur six d'une poignée de goules lentes (le cadran de
   * température les ralentit encore) ; dernière nuit : l'assaut est presque certain et
   * large — c'est LE climax, la méga-horde scriptée n'existe plus (décision ⑲).
   * La taille reste clampée par le plafond global au moment du spawn.
   */
  HORDE_CHANCE: { DEBUT: 0.15, FIN: 0.95 },
  HORDE_TAILLE: { DEBUT: 3, FIN: 14 },
  /**
   * LE PRÉAVIS DE LA VEILLE (décision ⑱) — la horde de ce soir se DÉCIDE À L'AUBE : les
   * signes tombent le jour d'avant (`presage_horde`, la faune qui déserte l'origine), et le
   * joueur PRÉPARE sa nuit. Le rayon est celui de l'effarouchement du gibier à l'émission.
   */
  PRESAGE_FUITE_RAYON: 24,
  /**
   * OÙ NAÎT UNE HORDE — en distance de MARCHE au Feu visé (le champ de flux la donne), et
   * non plus sur un bord de carte : la vallée est ceinte de roche, et zéro tuile de bord
   * n'était marchable (MESURÉ). Les hordes naissaient dans le mur et n'ont jamais marché.
   *
   * `HORDE_APPROACH_FRACTION` est la part d'une nuit qu'on leur laisse pour la traversée —
   * le reste est le temps du SIÈGE. À 0,5, une horde arrive à mi-nuit : on la voit venir, et
   * il reste la moitié de la nuit pour tenir. `HORDE_MIN_DIST` empêche l'autre excès, une
   * horde qui se matérialise sur le camp : le décor avouerait.
   */
  HORDE_APPROACH_FRACTION: 0.5,
  HORDE_MIN_DIST: 60,
  /**
   * L'ÉCART DES GOULES (décision d'Alexis, 2026-08-20) — « ils doivent se comporter comme
   * dans Project Zomboid ».
   *
   * Sans lui, une horde est une COLONNE : ses membres descendent le même gradient du même
   * champ de flux, calculent donc tous la même tuile suivante, et s'empilent. Constaté à
   * l'écran — treize goules relevées par la sim, DEUX silhouettes visibles.
   *
   * Le mécanisme est celui du gibier (`ecart.ts`, spec faune R9bis), avec ses deux seuils
   * pour l'hystérésis : sans elle, tout seuil qui commande un mouvement oscille.
   *
   * LES VALEURS SONT MESURÉES, pas devinées — balayage sur quatre graines, part des ticks de
   * marche où douze goules occupent douze tuiles distinctes :
   *     0,9 / 1,4 →  96 %, 63 %, 93 %, 97 %
   *     1,1 / 1,7 → 100 %, 68 %, 100 %, 100 %
   *     1,3 / 2,0 → 100 %, 69 %, 100 %, 100 %
   * On prend le premier réglage qui SATURE : au-delà, on écarte davantage sans gagner un
   * tick de plus. La graine 7 plafonne à 68 % dans tous les cas — et c'est très bien : sa
   * horde se serre dans un GOULOT (la porte de l'enceinte). Une foule qui s'engouffre dans
   * une porte doit se serrer ; c'est en marchant à découvert qu'elle ne doit plus le faire.
   */
  HORDE_SEPARATION: 1.1,
  HORDE_SEPARATION_COMFORT: 1.7,
  /** Une carcasse de convoi tous les N jours de saison. */
  CONVOY_PERIOD_DAYS: 2,
  CONVOY_GUARDS: 2,
  /** Le butin dure 2 cycles avant de se dissiper. */
  CONVOY_DECAY_TICKS: ticksForCycles(2),
} as const

/**
 * LA BRUME (spec `brume.md`, décisions Alexis 2026-08-18) — le froid mobile qui sort de la
 * Cendrière : annoncée au crépuscule (le gibier se tait), levée de l'aube au crépuscule,
 * elle dénie sa zone par le froid (la tenue d'hiver est « l'équipement requis » du GDD
 * §9bis) et découvre à son retrait un filon minier gardé — la menace qui paie ceux qui la
 * suivent. Ordres de grandeur, à calibrer en jouant.
 */
export const BRUME = {
  /** Chance qu'une Brume se lève, par jour de saison et par acte (acte I : jamais). */
  CHANCE_PER_DAY: [0, 0.35, 0.5],
  /** Rayon de la nappe, en tuiles. */
  RAYON: 8,
  /** Profondeur de l'incursion dans T0, depuis le front de Cendre (tuiles). */
  PROFONDEUR: 28,
  /** Largeur des bandes d'élection du corridor (en tuiles de champ de Cendre). */
  BANDE: 6,
  /**
   * Le froid de la nappe — une EXPOSITION (amortie par l'abri, planchée par feu et tenue).
   * Calibré pour tuer la plaine de JOUR dès l'acte II : 90 − 25 − 55 = 10 < HYPOTHERMIA (20).
   */
  COLD_MALUS: 55,
  /** Marge entre le bord de la nappe et un Feu de village (R3 : elle ne mange pas les villages). */
  GARDE_FEU: 6,
  /** Essais d'élection de corridor avant que la Brume ne renonce pour ce jour. */
  ESSAIS: 8,
  /** Le filon découvert au retrait : stock (sans repousse), part de charbon, vie en jours de saison. */
  FILON_STOCK: 12,
  FILON_PART_CHARBON: 0.4,
  FILON_JOURS: 3,
  /** Les traînards qui gardent le filon, et leur heure de départ (patron carcasse). */
  TRAINARDS: 2,
  TRAINARD_TTL: ticksForCycles(1),
} as const

/**
 * LA MÉTÉO (spec `meteo.md`, décisions Alexis 2026-08-18) — des fronts spatiaux qui
 * traversent la vallée : au plus une BANDE cardinale par jour, élue par `hash2`, qui met la
 * pression sur les systèmes EXISTANTS (froid, Feu, faune, vitesse, perception) sans mécanique
 * parallèle. La courbe de pression du GDD §8 vit dans les tables par acte : la pluie bénigne
 * de l'Éclosion cède aux neiges puis aux blizzards du Grand Froid. Ordres de grandeur, à
 * calibrer en jouant et au banc.
 *
 * ═══ CES CONSTANTES SONT DU CONTRAT DE REPLAY ═══
 *
 * L'occurrence, le type, le bord et la fenêtre d'un front se DÉRIVENT de ces nombres
 * (élection `hash2` + géométrie pure du tick, `meteo.ts`) : les changer fait sauter la météo
 * de toute sauvegarde et de tout replay EN VOL — la bande d'hier ne rejoue plus au même
 * endroit. On les change ENTRE les saisons, pas dedans.
 */
export const METEO = {
  /**
   * Chance qu'un front se lève, par CYCLE et par acte.
   *
   * LA CADENCE EST RÉELLE, LA MIXTURE EST SAISONNIÈRE. Un front est un phénomène de temps
   * RÉEL : il dure `TRAVERSEE_TICKS` (~une demi-heure de jeu), on le voit venir, on le
   * traverse, il s'éloigne. Sa cadence se compte donc en CYCLES — sinon elle dépend du
   * `calendarScale` de l'hôte, et c'est très exactement le défaut qu'on a corrigé : élire
   * par jour de saison ne faisait ÉVALUER que 6 jours sur 60 en Veillée (qui compresse la
   * saison en 6 cycles), toujours les mêmes, dans tous les mondes — deux fronts de neige
   * pour une saison solo entière, et jamais un éclair ni une annonce.
   *
   * L'ACTE, lui, vient toujours du JOUR DE SAISON : c'est la saison qui commande la
   * FRÉQUENCE (ici) et la MIXTURE (`TYPES`) — la courbe de pression du §8 est intacte.
   */
  CHANCE_PER_CYCLE: [0.5, 0.65, 0.8],
  /**
   * La table des types par acte (poids sommant à 1) : la pluie domine l'acte I, la neige
   * entre en II, le blizzard hante II-III, l'orage vit en I-II. L'ORDRE des clés est le
   * découpage du tirage cumulatif — le changer rebat les élections (contrat de replay).
   */
  TYPES: [
    { pluie: 0.5, brouillard: 0.25, orage: 0.25 },
    { pluie: 0.3, neige: 0.35, brouillard: 0.15, blizzard: 0.1, orage: 0.02, vent_de_cendre: 0.08 },
    { neige: 0.5, blizzard: 0.3, brouillard: 0.15, orage: 0.01, vent_de_cendre: 0.04 },
  ],
  /** Largeur de la bande, en tuiles. Le blizzard ≈ la carte jouée (~1 580 de large) :
   *  « carte entière » par CALIBRAGE, pas par mécanisme (spec R1). */
  LARGEUR: { pluie: 60, brouillard: 50, neige: 70, orage: 55, blizzard: 1600, vent_de_cendre: 420 },
  /** La traversée complète (le bord AVANT entre → le bord ARRIÈRE sort), ~une demi-journée.
   *  STRICTEMENT sous un cycle : la fenêtre élue tient dans son cycle, donc au plus un front
   *  actif à la fois — par construction, pas par garde (voir `meteo.ts`). */
  TRAVERSEE_TICKS: ticksForCycles(0.5),
  /** Fraction de la LARGEUR en rampe d'intensité à CHAQUE bord de bande — un gradient
   *  bord → cœur (`meteoIntensity` : 0 dehors, 1 au cœur), jamais un mur. */
  RAMPE: 0.15,
  // ── Les quatre accroches (R4-R7) et la foudre (R8) : consommées par les tranches
  // suivantes, posées ICI dès la tranche 1 — le contrat de constantes est complet d'un coup.
  /** R4 — le froid sous l'empreinte : une EXPOSITION de plus (patron Brume — amortie par
   *  l'abri, planchée par le Feu et la tenue). Le blizzard est calibré létal en plaine de
   *  jour dès l'acte II (90 − 25 − 55 = 10 < HYPOTHERMIA) ; le brouillard ne refroidit pas. */
  COLD: { pluie: 10, brouillard: 0, neige: 25, orage: 10, blizzard: 55, vent_de_cendre: 8 },
  /** R5 — multiplicateur de consommation des feux sous l'empreinte d'un front mouillé.
   *  JAMAIS d'extinction : la pression, pas la spirale de mort. */
  FEU_CONSO: { pluie: 1.5, neige: 1.5, orage: 1.5, blizzard: 2, brouillard: 1, vent_de_cendre: 1.8 },
  /** R5 — les types MOUILLÉS : l'eau qui tombe. Porte le refus de pose d'un feu NEUF à
   *  découvert et arme `FEU_CONSO` (`meteoMouille`/`meteoFeuConso`). Cette table COÏNCIDE
   *  aujourd'hui avec `QUIET` — et ce n'est PAS une redondance à fusionner : deux axes
   *  sémantiques distincts. QUIET dit le silence du GIBIER (comportement de faune),
   *  MOUILLE dit l'EAU qui tombe (physique du feu) ; un futur type peut mouiller sans
   *  faire taire, ou l'inverse — on calibre chaque axe sans toucher l'autre. */
  MOUILLE: { pluie: true, brouillard: false, neige: true, orage: true, blizzard: true, vent_de_cendre: false },
  /** R6 — la faune se terre : les types qui FONT TAIRE les naissances ambiantes sous leur
   *  empreinte (prédicat pur `meteoQuiet` — un front MOBILE ne sème pas de points
   *  `faunaQuiet`, on interroge sa bande du tick). Le BROUILLARD ne fait pas taire le
   *  gibier : c'est le front tactique (visibilité, R7), pas un front mouillé — la table
   *  d'effets décidée avec Alexis lui donne « faune : néant ». */
  QUIET: { pluie: true, brouillard: false, neige: true, orage: true, blizzard: true, vent_de_cendre: true },
  /** R7 — multiplicateur de vitesse sous l'empreinte (pendant le front, pas après). */
  SPEED: { pluie: 0.95, brouillard: 1, neige: 0.9, orage: 0.95, blizzard: 0.8, vent_de_cendre: 0.9 },
  /** R7 — multiplicateur de perception des IA, évalué au point de la CIBLE (on se cache
   *  dans la pluie, on n'aveugle pas le loup au soleil). Le brouillard en est le porteur
   *  principal : fort, sans froid — équilibrable isolément. */
  VISION: { pluie: 0.85, brouillard: 0.5, neige: 0.8, orage: 0.85, blizzard: 0.6, vent_de_cendre: 0.55 },
  /** R8 — la foudre de l'orage : impacts par minute dans l'empreinte, télégraphe au point
   *  visé (le patron wind-up, en plus long), dégâts sérieux jamais létaux à PV pleins,
   *  rayon d'impact en tuiles. */
  FOUDRE_PAR_MIN: 3,
  FOUDRE_TELEGRAPHE_TICKS: ticksFor(1.5),
  FOUDRE_DEGATS: 35,
  FOUDRE_RAYON: 1.5,
} as const

/**
 * LE GEL (spec `gel.md`, décision Alexis 2026-08-19) — le monde change d'état avec sa
 * température, sans qu'une tuile ne bouge. Tout est dérivé de `baselineTemperature` : ces
 * quatre seuils sont des TEMPÉRATURES, lues sur la même échelle 0-100 que `TEMPERATURE`.
 *
 * ═══ CES NOMBRES SONT CALCULÉS, PAS CHOISIS ═══
 *
 * `baselineTemperature` sur une tuile d'EAU à découvert vaut, exactement :
 *
 *     T = BASE − ACT_COLD[acte] − (nuit ? NIGHT_COLD : 0) − brume − météo
 *       = 90 − {0, 25, 50} − {0, 30} − {0, 55} − METEO.COLD[type]
 *
 * (l'eau — terrains 4 et 6 — n'a AUCUNE entrée dans `BIOME_OFFSET`, donc biome = 0 ; et
 * une tuile d'eau n'est jamais sous un toit, donc `SHELTER_FACTOR` ne joue pas). La table
 * complète du ciel clair, à découvert :
 *
 *              acte I    acte II   acte III
 *     jour       90        65        40
 *     nuit       60        35        10
 *
 * Et les fronts retranchent en plus : pluie/orage 10, neige 25, blizzard 55, Brume 55 —
 * sachant que l'acte I ne tire NI neige NI blizzard (`METEO.TYPES[0]`) et JAMAIS de Brume
 * (`BRUME.CHANCE_PER_DAY[0] = 0`). Le point le plus froid possible de l'acte I est donc
 * une nuit sous l'averse : 60 − 10 = **50**.
 *
 * De là, la promesse G2 (« les gués prennent dès les nuits froides d'acte II, les lacs
 * attendent l'acte III et les blizzards ») borne chaque seuil des DEUX côtés, et on prend
 * le MILIEU de la fenêtre — la marge est ce qui fait survivre le calibrage à une retouche
 * de `ACT_COLD` ou de `NIGHT_COLD` :
 *
 *     SEUIL_GUE     > 40 (le gué prend en acte III de JOUR)
 *                   ≤ 50 (rien ne gèle en acte I, même la nuit sous l'averse)   → 45
 *     SEUIL_PROFOND > 10 (le lac prend en acte III de nuit ET sous tout blizzard :
 *                         65 − 55 = 10 dès l'acte II, 0 ensuite)
 *                   ≤ 35 (le lac NE prend PAS aux nuits d'acte II à ciel clair)  → 20
 *
 * Ni l'un ni l'autre ne tombe sur une égalité de la table (10, 35, 40, 50, 60, 65) : un
 * seuil posé PILE sur une valeur atteinte se déciderait au bit de flottant près.
 *
 * `SEUIL_PROFOND` tombe par ailleurs exactement sur `TEMPERATURE.HYPOTHERMIA` (20), et
 * ce n'est pas un hasard qu'on garde : **le lac devient un chemin là où l'homme nu
 * commence à mourir de froid.** C'est la lisibilité de « tard et lisible ».
 *
 * ═══ ET L'HYSTÉRÉSIS SE DÉDUIT DES MÊMES MARGES (G8) ═══
 *
 * Le dégel est décalé : l'eau prend sous `seuil`, elle ne rend la main qu'au-dessus de
 * `seuil + HYSTERESIS`. La marge ne se choisit pas non plus — elle est la PLUS GRANDE qui
 * ne casse aucune des deux promesses ci-dessus :
 *
 *     SEUIL_GUE + H     ≤ 50  (sinon un gué gelé en acte II survivrait à l'acte I d'après…
 *                              et surtout la nuit d'acte I sous l'averse gèlerait par la
 *                              bande morte)                              → H ≤ 5
 *     SEUIL_PROFOND + H ≤ 35  (sinon le lac tiendrait les nuits d'acte II) → H ≤ 15
 *
 * La contrainte du gué est la plus serrée : **H = 5**.
 */
export const GEL = {
  /** L'eau PEU PROFONDE (gué, terrain 4) gèle sous ce seuil : on ne patauge plus
   *  (`speedFactor` 0,5), on glisse (`VITESSE_GLACE`). Elle était DÉJÀ praticable —
   *  le gel ne change ici que la façon d'y marcher. */
  SEUIL_GUE: 45,
  /** L'eau PROFONDE (lac, rivière, terrain 6) gèle sous ce seuil et devient PRATICABLE :
   *  la carte change de forme, un village protégé par une boucle d'eau perd ses douves
   *  (G4 — la horde traverse aussi). « Nettement plus froid » : 25 points sous le gué. */
  SEUIL_PROFOND: 20,
  /**
   * G8 — LA MARGE DU DÉGEL, en points de température. L'eau PREND sous son seuil ; elle ne
   * DÉGÈLE qu'au-dessus de `seuil + HYSTERESIS`. Entre les deux s'étend une BANDE MORTE où
   * la glace garde l'état qu'elle avait — sans quoi une température qui oscille autour du
   * seuil (l'aube, le crépuscule, la lisière d'un front qui passe) ferait clignoter la carte
   * d'un tick à l'autre. Conséquence de jeu VOULUE : **la vallée se referme derrière ceux
   * qui l'ont traversée.** Valeur : la plus grande qui ne casse aucune promesse de G2 (5).
   */
  HYSTERESIS: 5,
  /**
   * G8 — LA PORTÉE DE MÉMOIRE de l'hystérésis, en ticks. Rien n'étant stocké, l'état
   * « c'était gelé » se relit en RECALCULANT la température de ce point il y a `RETARD`
   * ticks (`baselineTemperatureAt`). La bande morte tient donc au plus ce temps-là après le
   * dernier froid décisif — au-delà, la glace rend la main. ~2,4 min réelles : dix fois la
   * durée qu'une lisière de front met à balayer un point (~27 s mesurées sur la rampe d'un
   * front de neige), et assez court pour qu'une seule lecture de plus suffise.
   */
  RETARD_TICKS: ticksForCycles(0.05),
  /**
   * G6 — LE JOUR DE SAISON où les feuillus commencent à se dénuder, et sur combien de jours
   * la forêt entière y passe.
   *
   * **LA FEUILLAISON SUIT LA SAISON, JAMAIS L'INSTANT** — et c'est une correction, pas un
   * détail. La première version keyait le dénuement sur une TEMPÉRATURE : or aucune valeur
   * ne sépare la nuit d'acte II (40 sur un terrain boisé) du jour d'acte III (45), si bien
   * que la forêt entière aurait repoussé ses feuilles à chaque aube et les aurait reperdues
   * à chaque crépuscule. Une feuille qui tombe ne remonte pas : le jour de saison, lui, ne
   * redescend jamais — la monotonie est acquise par construction.
   *
   * `JOUR_DEFEUILLAISON` = le dernier jour de l'acte I : **la forêt se dépouille à l'entrée
   * du Grand Froid**, sur une semaine, tuile par tuile (un décalage par `hash2` : les arbres
   * ne tombent pas tous le même matin).
   */
  JOUR_DEFEUILLAISON: BALANCE.ACT_BOUNDARIES[0],
  DEFEUILLAISON_JOURS: 7,
  /** On glisse un peu plus vite que sur l'herbe (le `speedFactor` d'une eau gelée,
   *  quelle que soit sa profondeur). Il remplace 0,5 sur le gué et 0 (infranchissable)
   *  sur le lac : le contraste AVANT/APRÈS est tout le sel de la règle. */
  VITESSE_GLACE: 1.1,
  /** G7 — combien de cycles en arrière `neigeAuSol` rembobine l'élection des fronts.
   *  Trois : au-delà, la couverture a fondu de toute façon (voir `FONTE_CYCLES`), et
   *  chaque cycle rembobiné coûte deux `hash2` par appel. */
  MEMOIRE_CYCLES: 3,
  /** G7 — la neige met ce nombre de CYCLES à disparaître **par grand froid** (à
   *  `SEUIL_PROFOND` ou en dessous). Au-dessus, la fonte accélère linéairement jusqu'à
   *  `FONTE_CYCLES_CHAUD` à `SEUIL_FEUILLES` et au-delà : la même neige tient un jour
   *  sur le Névé et une heure au bord de l'eau. */
  FONTE_CYCLES: 3,
  FONTE_CYCLES_CHAUD: 0.25,
  /** G7 — EN COMBIEN DE TRANCHES la fonte s'intègre, par cycle. La vitesse de fonte dépend
   *  de la température, qui varie d'heure en heure : l'appliquer telle qu'elle est MAINTENANT
   *  à tout le temps écoulé faisait REMONTER la neige au crépuscule (mesuré : +0,133 au
   *  coucher, dix-neuf fois la dérive réelle). On somme donc la fonte par tranches, chacune
   *  évaluée à son propre instant. Une cadence technique, pas un réglage de jeu : huit
   *  tranches suffisent à suivre le pas jour/nuit (la seule marche du signal), et le total
   *  reste borné par `MEMOIRE_CYCLES`. */
  FONTE_TRANCHES_PAR_CYCLE: 8,
} as const

/**
 * LE FROID MORD SUR LA FLORE (spec `flore-froid.md`, décision d'Alexis 2026-08-19) — « le
 * froid SUSPEND le sauvage et TUE le cultivé ».
 *
 * ═══ POURQUOI DEUX SEUILS, ET PAS UN FACTEUR ═══
 *
 * Ce qui existait — `SEASON.REGROW_ACT_FACTOR` — est keyé sur l'ACTE : il ne peut dire ni
 * OÙ ni À QUELLE HEURE. Le champ thermique, lui, sait déjà que le Névé est glacial, que la
 * forêt tient mieux que le marais et qu'un blizzard traverse la vallée ; il n'était pas lu.
 * Ces deux seuils le lisent — via `climatFlore`, le froid du monde À DÉCOUVERT (ni abri, ni
 * feu : le feu réchauffe les hommes, pas la terre, sinon il devient une serre gratuite).
 *
 * ═══ CE QUE LA TABLE DONNE (climat de JOUR = 90 − ACT_COLD + biome ; la nuit ôte 30) ═══
 *
 *              acte I     acte II    acte III
 *   forêt      95 / 65    70 / 40    45 / 15
 *   plaine     90 / 60    65 / 35    40 / 10
 *   marais     85 / 55    60 / 30    35 /  5
 *   Névé       50 / 20    25 /  0     0 /  0
 *   Glacier    15 /  0     0 /  0     0 /  0
 *
 * ═══ AUCUN DES DEUX N'EST UN MULTIPLE DE 5 ═══
 *
 * Hors front, la table n'atteint QUE des multiples de 5 (les trois termes le sont) : un seuil
 * posé pile sur une valeur atteinte se déciderait au bit de flottant près — le raisonnement
 * exact des seuils de `GEL`. Sous un front la rampe est continue et traverse le seuil : c'est
 * un franchissement normal, pas un aléa de précision.
 */
export const FLORE = {
  /**
   * LA PLANTE EST GELÉE : sa repousse n'aboutit pas (F2), la cueillette ne lui prend rien
   * (F3), et on ne sème pas la terre qu'elle occupe (F4).
   *
   * 52 se lit dans la table ci-dessus, et il tient à trois bornes :
   *  - **l'acte I reste entièrement libre, nuit comprise** — le plus froid des trois biomes
   *    de vallée y est à 55 la nuit. Le jeu d'aujourd'hui ne change pas d'un pouce (A4) ;
   *  - **la nuit fige dès l'acte II** (35) : « cueille de jour » devient une règle ;
   *  - **la vallée entière s'arrête en acte III** (45 au mieux, en forêt et de jour).
   * Et il stérilise le Névé (50) et le Glacier dès le premier jour, sans une ligne de plus.
   */
  SEUIL_GEL: 52,
  /**
   * LE GEL TUE LA CULTURE À CIEL OUVERT (F5) — le seul endroit où le froid DÉTRUIT.
   *
   * 22, soit juste au-dessus de `TEMPERATURE.HYPOTHERMIA` (20) : **la culture meurt là où
   * l'homme meurt.** Ce que ça donne, lu dans la table : l'acte I ne tue JAMAIS (son pire
   * point de vallée est 50, et aucun blizzard n'y est tiré) ; en acte II un blizzard (−55)
   * tue de jour comme de nuit et un front de neige (−25) tue la nuit ; en acte III toute
   * nuit tue. Le potager de plein air devient un pari, puis n'est plus jouable — et c'est
   * ce qui donne enfin son prix à la serre (`agriculture.md` R7).
   */
  SEUIL_MORTEL: 22,
} as const

/**
 * LES RÉFUGIÉS (V2-25, GDD §520) — « l'événement d'alignement par excellence, et la seule
 * source de PNJ supplémentaires hors paliers du Feu ». Un groupe de survivants arrive sur une
 * route ; on les RECRUTE (+PNJ, Foyer), les NOURRIT (Foyer), les refoule (rien) ou les
 * DÉPOUILLE (Meute). Ordres de grandeur, à caler en playtest.
 */
export const REFUGEES = {
  /** Un groupe tous les N jours de saison (plus rare que les convois, ×2). */
  PERIOD_DAYS: 6,
  /** Survivants par groupe — autant de PNJ si on les recrute. */
  COUNT: 3,
  /** Ils stationnent ~1 cycle, puis repartent (refouler = ne rien faire). */
  STAY_TICKS: ticksForCycles(1),
  /** LA FENÊTRE DU JOUEUR (spec village-pnj-evolution R12) : passé ce délai d'attente
   *  (un demi-séjour), un village PNJ sous son effectif de fondation recrute le groupe —
   *  le joueur garde la main s'il agit d'abord. Décision d'Alexis, 2026-08-17 : le banc
   *  de saison a montré 10 groupes/saison, 0 recrutés, et des villages morts d'attrition. */
  NPC_CLAIM_TICKS: ticksForCycles(0.5),
  /** LE GRENIER QUI PEUT NOURRIR (R12, β-garde) : un village sous ce score de nourriture
   *  ne recrute pas — le piège MESURÉ au banc de saison (2026-08-17) : trois recrues
   *  arrivées au j24 dans un grenier vide, mortes de faim au j25. Deux baies par tête
   *  de groupe : de quoi tenir le premier jour, pas un label de prospérité (ça, c'est
   *  ATTRACT_FOOD). */
  NPC_CLAIM_MIN_FOOD: 6,
  /** Chaleur (Foyer) à les recruter/nourrir ; froid (Meute) à les dépouiller. */
  WARMTH_SAVE: 12,
  WARMTH_ROB: -12,
  /** Ce qu'un nourrissage COÛTE (des vivres offerts). */
  FEED_COST: { berries: 4 } as import('./items').ItemBag,
  /** Leur maigre bien (pour qui les dépouille). */
  LOOT: { fiber: 4, berries: 3 } as import('./items').ItemBag,
} as const

export const CONVOY_LOOT: import('./items').ItemBag = {
  components: 2,
  iron_ingot: 3,
  coal: 4,
}

/** La saison (GDD §2, spec saison) : la pression, la Cendre, la fin. */
export const SEASON = {
  /** Les sources se contractent : repousse des nœuds ralentie par acte. */
  REGROW_ACT_FACTOR: [1, 1.5, 2],
  /* (la méga-horde scriptée du premier crépuscule de la Cendre est SUPPRIMÉE — décision ⑲,
   *  2026-08-21 : la horde est une pente continue, la dernière nuit est naturellement la pire.) */
  /** Le jour où l'évacuation s'ouvre, et son rayon de « sauvetage ». */
  EVAC_DAY: 55,
  EVAC_RADIUS: 6,
  /** L'ARCHE LÈVE L'ANCRE (V2-24) ce nombre de jours APRÈS l'ouverture : la fenêtre pour
   *  embarquer. Départ au jour EVAC_DAY + EVAC_DEPART_DAYS (58) — avant la fin (60), pour que
   *  le départ soit un ACTE, pas la fin passive. Ordre de grandeur playtest. */
  EVAC_DEPART_DAYS: 3,
} as const

/** Valeur de butin pour le verdict de la Meute (spec saison R4). */
export const LOOT_VALUES: Partial<Record<import('./items').ItemId, number>> = {
  components: 10,
  iron_ingot: 5,
  iron_axe: 3,
  iron_pickaxe: 3,
  spear: 3,
  axe: 2,
  pickaxe: 2,
  // La fortune ne vaut presque rien : piller un camp qui n'a que des cailloux
  // ficelés ne doit pas nourrir le verdict de la Meute.
  crude_axe: 1,
  crude_pickaxe: 1,
  crude_spear: 1,
}

/** Noms de villages, attribués par id (une chronique exige des noms). */
export const VILLAGE_NAMES = [
  'le Feu du Gué',
  'le Clan du Levant',
  'les Braises Hautes',
  'le Foyer des Saules',
  'la Bande du Ravin',
  'le Feu Dormant',
  'les Cendres Douces',
  'le Camp du Vieux Pont',
] as const

/** L'alignement émergent (GDD §3, spec alignement). */
export const ALIGNMENT = {
  /** Chaleur par point de faim utile donné (spec R2). */
  GIVE_WARMTH_PER_HUNGER: 0.2,
  /** Multiplicateur si le receveur est affamé (< `NEED_HUNGER`). */
  NEED_FACTOR: 3,
  /** En-dessous de cette faim, le receveur est AFFAMÉ : le don répond à un vrai besoin
   *  et vaut `NEED_FACTOR` fois plus. Le seuil vivait en clair dans `applyVillageAction`,
   *  alors que le facteur qu'il commande était ici, deux lignes plus haut. */
  NEED_HUNGER: 30,
  /**
   * LE CARACTÈRE ENSEMENCÉ d'un village PNJ à sa fondation (spec alignement R12) — la
   * chaleur de départ d'un Foyer, et son opposée pour une Meute. L'archétype ÉMERGE
   * ensuite des actes ; ceci n'est qu'une inclination initiale.
   *
   * `SEED_ENGAGEMENT` : assez d'inertie pour que le caractère survive à la décroissance
   * (`DECAY_PER_DAY`) le temps que les actes — dons, raids — prennent le relais. Un
   * village neutre part à 0 : il n'a pas encore d'avis.
   */
  SEED_WARMTH: 60,
  SEED_ENGAGEMENT: 60,
  /** Multiplicateur par acte de la saison (le Grand Froid vaut cher). */
  ACT_FACTOR: [1, 2, 3],
  /** Dépôt de nourriture au grenier d'autrui : chaleur par point de valeur. */
  FOREIGN_DEPOSIT_WARMTH_PER_FOOD: 0.3,
  HEAL_OUTSIDER_WARMTH: 15,
  FIRST_BLOOD_WARMTH: -20,
  ONGOING_HIT_WARMTH: -2,
  RIPOSTE_WARMTH: -2,
  KILL_WARMTH: -40,
  /** Tuer un agresseur en défense « ne coûte presque rien » (GDD §3). */
  RIPOSTE_KILL_WARMTH: -4,
  DESTROY_STRUCTURE_WARMTH: -15,
  ENGAGEMENT_PER_ACT: 8,
  /**
   * Décroissance linéaire vers 0, en points par jour de saison (le paquebot).
   * Calibrage 2026-07-06 : 4 → 2. À 4/jour, une chaleur ensemencée à 60
   * passait sous le seuil d'archétype (40) en 5 jours — aucun rythme d'actes
   * réaliste ne pouvait entretenir un caractère (banc de scénario, 6 jours).
   */
  DECAY_PER_DAY: 2,
  /** Mémoire d'agression entre villages : 1 cycle. */
  AGGRESSION_MEMORY_TICKS: ticksForCycles(1),
  /** Plafond par tête à l'agrégation du Feu (GDD : un seul berserker…). */
  WARMTH_CAP_PER_HEAD: 50,
  /** Seuils d'archétype. */
  ARCHETYPE_WARMTH: 40,
  ARCHETYPE_ENGAGEMENT: 20,
  /** Effets continus : régén PV de ×0.75 (froid) à ×2 (chaud). */
  REGEN_MIN: 0.75,
  REGEN_MAX: 2,
  /** Paliers. */
  FOYER_STRUCTURE_HP_BONUS: 1.25,
  FOYER_OFFENSE_MALUS: 0.6,
  MEUTE_DAMAGE_BONUS: 1.2,
  MEUTE_HARVEST_MALUS: 0.75,
  /** Cadence de recalcul du Feu (5 s). */
  REFRESH_TICKS: ticksFor(5),
  /** Le don du Foyer PNJ (spec R14). */
  GIFT_BERRIES: 5,
} as const

/**
 * LA NUIT QUI CHASSE (spec `tension.md`). « La nuit, loin d'un feu, on est chassé. »
 *
 * Une règle, une parade (un Feu, ou rentrer), une annonce (le hurlement), une
 * borne (jamais plus de MAX_ALIVE). C'est ce quatuor qui fait la différence entre
 * une tension et une brimade : le joueur doit pouvoir PERDRE, jamais être submergé,
 * et toujours savoir ce qu'il aurait dû faire.
 */
export const NIGHT_HUNT = {
  /**
   * Probabilité par minute réelle, par acte. Le Grand Froid affame les loups.
   *
   * CALIBRÉ SUR LE COMBAT RÉEL, pas au doigt mouillé. Un loup : 35 PV, 14 dégâts,
   * et il court PLUS VITE que nous — on ne le distance pas, on le combat ou on
   * rejoint un feu. À mains nues (6 dégâts, un coup/seconde) on en tue UN, de
   * justesse, à ~30 PV près. DEUX, jamais.
   *
   * L'acte I est donc doux (~2 rôdeurs sur une nuit de 18 minutes) : la première
   * nuit doit être un DANGER, pas une exécution. Le Grand Froid, lui, serre la vis —
   * mais à ce moment-là le joueur a un épieu, un feu, et il sait pourquoi.
   */
  CHANCE_PER_MIN: [0.12, 0.3, 0.55],
  /** Rôdeurs simultanés sur une même proie. On peut perdre ; on ne doit pas être noyé. */
  MAX_ALIVE: 2,
  /** Ils naissent à cette distance : hors de vue, mais on les voit VENIR. */
  SPAWN_DIST: 15,

  /* ── LE BASCULEMENT D'ESPÈCE : LE FROID DÉCIDE (décision d'Alexis 2026-08-21) ─────────── */

  /**
   * QUI VIENT, CETTE NUIT-LÀ : la part de morts est l'ÉVEIL du sol au point de la proie
   * (`eveilAt` — voir `CENDREUX.TORPEUR`), plus une table par acte. Sur la nuit de plaine, la
   * température rend EXACTEMENT l'ancienne table (60/35/10 → 0/0,5/1) ; partout ailleurs, la
   * géographie parle enfin — le Névé envoie des morts dès l'acte I, et c'est voulu.
   *
   * C'est toujours ICI que vit la tension croissante, et pas dans la horde — MESURÉ : une
   * saison de Veillée ne compte que six nuits, la horde ne se tire qu'une fois par nuit.
   * La nuit qui chasse se tire à la MINUTE (~18 fois par nuit) : c'est la seule machine dont
   * la montée soit perceptible, et la seule qui naisse AUTOUR du joueur.
   */

  /**
   * Plafond de Cendreux rôdeurs simultanés sur une même proie — EN FIN de saison. Le plafond
   * du jour J est round(1 + (FIN − 1) × jour/60) : la montée est CONTINUE, jour après jour,
   * plus une table de trois valeurs (le défaut chiffré d'A13 : ×1,6 mesuré quand le taux
   * quadruple — « une table de trois valeurs, et une table est plate »).
   *
   * Distinct du plafond des loups, et plus haut, parce que les deux dangers ne se jouent pas
   * pareil : un loup court plus vite que vous, deux c'est déjà la mort ; un Cendreux se
   * distance toujours, son danger EST le nombre (R10). À calibrer en playtest.
   */
  UNDEAD_MAX_FIN: 5,

  /* ── LE RÉVEIL : LA COURONNE (spec `cendreux.md` R18) ─────────────────────────────── */

  /**
   * L'ÉPAISSEUR de la couronne de naissance, autour de `SPAWN_DIST`.
   *
   * Il n'y avait PAS de couronne. `ox` et `oy` valaient tous deux ±`SPAWN_DIST`, donc chaque
   * rôdeur naissait sur l'une de QUATRE diagonales, à 21,2 tuiles — jamais 15, jamais de côté.
   * Le commentaire de `SPAWN_DIST` disait « à cette distance » ; c'était faux depuis toujours.
   *
   * Une vraie couronne rend deux choses. Le tour complet, d'abord : le danger peut venir de
   * n'importe où, et le joueur ne peut plus apprendre quatre angles. Et de la MATIÈRE à
   * pondérer, ensuite — sur quatre points, un champ de densité n'aurait rien à dire ; sur
   * ~200 tuiles d'anneau, il choisit vraiment (R16).
   */
  SPAWN_RING: 3,

  /**
   * LA COURONNE DU MORT — plus SERRÉE que celle du loup, et c'est le réveil qui la paie.
   *
   * *Décision d'Alexis, 2026-07-31 : le réveil dure, il est jouable, et il naît PRÈS.*
   *
   * À 15 tuiles et 1,3 tuile/s, un Cendreux met **16 secondes** à joindre une proie IMMOBILE,
   * contre 5 pour un loup ; face à un joueur qui se déplace à 4 t/s, il n'atteint jamais rien.
   * Le rapprocher est la seule chose qui rende ce monstre dangereux sans toucher à sa vitesse —
   * et c'est aussi ce qui rend l'encerclement de l'acte III possible, alors que R10 fonde tout
   * son danger sur le NOMBRE.
   *
   * Naître à 7 tuiles serait injuste SANS PRÉAVIS ; c'est exactement ce que le réveil achète.
   * Le sol se soulève, ça s'annonce (`cendreux_prowl`), et le joueur a `MORTS.REVEIL_TICKS`
   * pour rallumer son feu, s'éloigner, ou tenir la position.
   *
   * DEUX DANGERS, DEUX DISTANCES — le pendant de R11bis. Le loup GARDE ses 15 tuiles : il court
   * à 4-5 t/s, il les couvre en trois secondes, et le rapprocher n'ajouterait rien qu'une mort
   * sans recours. On ne rapproche que ce qui est lent.
   */
  SPAWN_DIST_UNDEAD: 7,
  SPAWN_RING_UNDEAD: 2,
} as const

/**
 * LE CHAMP DES MORTS (spec `cendreux.md` R14-R17) — « combien de morts dorment ici ».
 *
 * Ces nombres décident de l'INTENSITÉ de la nuit, jamais de son existence. C'est une leçon
 * mesurée, pas une préférence : autour de là où le joueur vit réellement, il n'y a ni cendre
 * (le front n'arrive qu'au jour 60), ni sol brûlé (le plus proche à 74 tuiles), ni Repaire
 * (110 tuiles). Tout seuil géographique qui pourrait rendre `false` rend la nuit MUETTE
 * pendant cinquante-cinq jours. D'où le plancher, qui n'est pas une précaution mais la règle.
 */
export const MORTS = {
  /**
   * LE PLANCHER — partout, à toute heure, sous n'importe quel ciel.
   *
   * C'est lui qui garantit qu'une couronne rend toujours un site, et c'est lui qui interdit
   * structurellement au champ de devenir un interrupteur. Sur une carte sans zones (banc
   * headless), le champ ne vaut QUE ça, uniformément — même précédent que `zoneTierAt` qui
   * rend 0 : on n'impose pas une géographie à qui n'en a pas demandé (R17).
   */
  PLANCHER: 0.15,
  /**
   * CE QUE LE TIER DE ZONE AJOUTE. Mesuré sur la carte de production : t0 = 18 % de la carte
   * (les Prés Bas — et c'est LÀ, et nulle part ailleurs, que le joueur habite), t1 = 44 %,
   * t2 = 38 %. Le signal est donc réel et il épouse déjà la pression de migration du GDD.
   *
   * Chez soi 0,25 ; dans la ceinture 0,50 ; aux marges 0,75. Un rapport de trois entre le pré
   * de son village et l'alpage : assez pour que l'endroit où l'on dort soit une décision, pas
   * assez pour que quitter la racine soit un suicide.
   */
  PART_TIER: [0.1, 0.35, 0.6],
  /**
   * CE QUE LA CENDRE AJOUTE. Sous le front, le sol EST fait de morts — et comme le front
   * avance d'acte en acte, la montée de l'acte III arrive par la GÉOGRAPHIE en plus d'arriver
   * par `UNDEAD_SHARE`. Les deux racontent la même histoire, chacun à sa manière.
   *
   * Aux marges et sous la cendre, le champ sature à 1 : c'est le pire sol de la vallée, et il
   * doit se sentir comme tel.
   */
  PART_CENDRE: 0.35,
  /**
   * ═══ LA HANTISE : LE VIEUX BRÛLÉ EST PLUS HABITÉ QUE LE NEUF ═══
   * *(spec `cortege-cendre.md` R4 — décision d'Alexis 2026-08-21, « la pression doit être
   * appliquée par l'environnement ».)*
   *
   * `PART_CENDRE` était **à plat** : une tuile passée sous le front à l'instant valait autant
   * qu'une tuile brûlée depuis vingt jours. Or la marge de cendre (`margeDeCendre`, négative
   * dans le brûlé) dit GRATUITEMENT depuis combien de temps le front l'a dépassée — le champ
   * portait déjà l'information, personne ne la lisait.
   *
   * CE QUE ÇA ACHÈTE, ET C'EST LE PLUS ÉLÉGANT DES QUATRE SENS : tenir une ligne longue coûte
   * plus de nuits que tenir une ligne courte. **Le joueur raccourcit donc sa ligne lui-même.**
   * L'environnement ne lui confisque rien — il rend le trop-grand intenable, et le sacrifice
   * reste SON geste. C'est très exactement ce que « la pression vient de l'environnement »
   * demandait, sans une entité de plus (R7 de `saison-sans-fin.md` : le tick diverge si
   * l'escalade se paie en population).
   *
   * `HANTISE_MAX` est le terme atteint à `HANTISE_TUILES` de profondeur dans le brûlé. À 0,60,
   * combiné au tier 2 de la Cendrière (`PART_TIER` 0,6), le champ **sature à 1** au cœur du
   * vieux brûlé : le pire sol de la vallée, et il se sent comme tel.
   */
  HANTISE_MAX: 0.6,
  /**
   * LA PROFONDEUR À LAQUELLE LA HANTISE PLAFONNE — EN PART DE LA COURSE DU FRONT, pas en tuiles.
   *
   * Même correction que pour les bandes du cortège (`CENDRE.STERILE_PART`), et pour la même
   * raison : MESURÉ sur la carte de production, `cendreMax` — la course TOTALE du front sur une
   * saison — vaut **74 tuiles**. Une profondeur écrite « 60 tuiles » aurait couvert 80 % de tout
   * ce que le front parcourra jamais : le dégradé n'aurait jamais atteint son plafond, et le
   * « vieux brûlé » n'aurait pas existé.
   *
   * À 0,35, le plafond est atteint après un tiers de la course : le joueur traverse un dégradé
   * complet en reculant d'une bande, et le cœur du brûlé se distingue franchement de sa lisière.
   */
  HANTISE_PART: 0.35,
  /**
   * COMBIEN LE CHAMP FAIT VARIER LE NOMBRE DE RÔDEURS. Le plafond de l'acte
   * (`NIGHT_HUNT.UNDEAD_MAX_ALIVE`) reste le toit ; la densité dit quelle part on en atteint,
   * avec un plancher de UN — le champ module (R16), il n'interdit pas.
   *
   * Acte III (plafond 5) : deux rôdeurs chez soi, cinq aux marges sous la cendre. Le joueur ne
   * lit pas un nombre, il lit un LIEU — et c'est ça qu'on voulait.
   */
  MIN_RODEURS: 1,
  /**
   * COMBIEN DE TUILES DE LA COURONNE ON TESTE À L'A\* AVANT DE RENONCER.
   *
   * Le repli parcourt l'anneau (~200 tuiles) ; écarter une tuile BLOQUÉE est gratuit, mais
   * vérifier qu'elle mène à la proie coûte un A\*, et un A\* qui ÉCHOUE coûte son budget entier
   * (`maxExplored` = 4 096). MESURÉ sans ce plafond, sur une proie ceinte d'un anneau de roche :
   * **1 593 ms pour un seul réveil** — trente-deux fois le budget d'un tick à 20 Hz. Ce n'est
   * pas un cas d'école : c'est exactement le montage du siège (A4), le joueur qui s'enclot.
   *
   * Douze essais suffisent parce qu'ils sont dispersés — le tirage pondéré part d'un point
   * quelconque de l'anneau, et les tuiles bloquées défilent sans en consommer. Épuisés, on
   * REFUSE : la nuit passe son tour, ce qui est la réponse loyale (A22bis) et celle que
   * l'ancien code ne savait pas donner — il gardait son dernier essai, bloqué ou non.
   */
  ESSAIS_MAX: 12,
  /**
   * COMBIEN DE TEMPS LE SOL SE SOULÈVE avant que le Cendreux n'en sorte.
   *
   * C'est ce délai qui achète le droit de naître PRÈS (`NIGHT_HUNT.SPAWN_DIST_UNDEAD`), et
   * c'est lui qui rend le réveil JOUABLE plutôt que décoratif : pendant qu'il dure, un feu à
   * portée l'ANNULE (R21). La parade de S4 — *« on veille ses morts au feu, ou ils
   * reviennent »* — cesse d'être la règle du seul cadavre pour devenir le geste de chaque nuit.
   *
   * Le compte, en secondes : l'annonce part au tick 0, le sol travaille 4 s, puis il sort à
   * 7 tuiles et met 5,4 s à joindre une proie immobile — **9,4 s de préavis** contre 16 s de
   * marche auparavant. C'est plus court, et c'est bien plus tendu : la menace est ARRIVÉE,
   * elle ne s'approche plus.
   *
   * *Ordre de grandeur, à calibrer en playtest (GDD §15).*
   */
  REVEIL_TICKS: ticksFor(4),
  /**
   * L'ESPACEMENT DU SEMIS DES CHARNIERS, en tuiles (spec `cendreux.md` R20).
   *
   * Les charniers ont leur PROPRE semis — ils ne jouent pas la loterie des lieux (`horsSemis`),
   * parce que celle-ci est à somme nulle et adressée par ZONE : y entrer aurait affamé les
   * vingt-six autres types et rendu le charnier absent d'où le joueur habite. C'est le précédent
   * exact de `placeHuntingGrounds` — un semis à soi quand l'adresse ne se dit pas en zones.
   *
   * 160 contre 96 pour les lieux : plus rare qu'un lieu ordinaire, mais présent PARTOUT. C'est la
   * décision d'Alexis du 2026-07-31 — *« une distribution logique, mais en mettre un peu partout
   * quand même »* : le champ décide du COMBIEN (un point sur quatre accepté chez soi, trois sur
   * quatre aux marges), le semis décide de l'écart minimal. *Ordre de grandeur, à calibrer.*
   */
  CHARNIER_ESPACEMENT: 160,
  /**
   * DISTANCE MINIMALE À UN LIEU DÉJÀ POSÉ. Bien plus petite que l'espacement des lieux entre eux
   * (96) : un charnier au pied des Ruines ou contre un Repaire est une HISTOIRE, pas une faute —
   * on veut seulement qu'il ne se pose pas DANS l'empreinte d'un autre. L'écart entre charniers,
   * lui, est déjà garanti par leur semis de Poisson : ce rayon-ci ne le borne jamais.
   */
  CHARNIER_ECART_LIEU: 32,
  /**
   * ═══ LE REPAIRE RESPIRE (décision ⑪, 2026-08-21) ═══
   *
   * `advanceDens` repeuplait déjà UN occupant ; le repaire porte désormais un CAP DE SAISON
   * en rampe — round(1 + (CAP_FIN − 1) × jour/60) résidents — et relâche à sa propre cadence.
   * C'est une ADRESSE qu'on apprend, qu'on évite, qu'on ASSAINIT (le brûlage suspend la
   * respiration). Ses résidents ne consomment PAS le plafond global : le cap du lieu est leur
   * borne (« un plafond compte ce qu'il borne »).
   */
  RESPIRE_CAP_FIN: 3,
  /** Le délai de retour d'un résident de repaire (2 cycles réels — la cadence du lieu,
   *  distincte du délai des tanières : le repaire RESPIRE, la tanière repeuple). */
  RESPIRE_TICKS: ticksForCycles(2),
  /**
   * ═══ ON BRÛLE LE CHARNIER (décision ⑧, 2026-08-21) — la riposte du joueur ═══
   *
   * Un feu LIBRE allumé de JOUR à `BRULE_RAYON` du centre d'un charnier ou d'un repaire le
   * marque BRÛLÉ (`state.lieuxBrules`) pour `BRULE_DUREE_JOURS` jours de saison : la densité
   * du champ des morts tombe à `BRULE_FACTEUR` dans `BRULE_SUPPRESSION_RAYON`, et la
   * respiration du repaire se suspend. La pression devient NÉGOCIABLE : le joueur choisit
   * quel secteur il assainit, et le paie en bois, en trajet et en jour perdu.
   * Péremption en JOURS DE SAISON (deux horloges : c'est un effet de saison, pas de cycle).
   */
  BRULE_RAYON: 6,
  BRULE_DUREE_JOURS: 15,
  BRULE_FACTEUR: 0.25,
  BRULE_SUPPRESSION_RAYON: 48,
  /**
   * LE PLANCHER DU QUOTA — aucune zone de la vallée sans son charnier.
   *
   * C'est `MIN_RODEURS` au niveau du placement, et il vient de la même mesure, refaite : un
   * tirage indépendant par point laissait les **Prés Bas à zéro** sur la seed du jeu (quatorze
   * points éligibles, quatorze échecs à 0,25 — une chance sur cinquante-cinq, et elle est tombée
   * là où le joueur habite). Le champ MODULE (R16) ; un champ qui peut rendre zéro quelque part
   * est un interrupteur, qu'il le soit par règle ou par malchance.
   */
  CHARNIER_MIN_PAR_ZONE: 1,
} as const

/** L'IA des PNJ (spec pnj, alignement R13-R14) — les seuils de décision. */
export const NPC_AI = {
  /** Réserve personnelle de baies conservée au dépôt d'une récolte (spec pnj R6). */
  FOOD_KEEP: 2,
  /** Bois retiré au grenier pour une sortie de réparation. */
  REPAIR_WOOD_WITHDRAW: 4,
  /** Baies retirées au grenier pour un repas (à défaut de ragoût). */
  EAT_BERRIES_WITHDRAW: 3,
  /** Cible de fibres au grenier (tableau du village). */
  VILLAGE_FIBER_TARGET: 2,
  /**
   * L'ORDRE DANS LEQUEL UN VILLAGE PNJ TRAVAILLE — priorité de chaque tâche du tableau,
   * la plus haute d'abord. C'est le CARACTÈRE économique du village : nourrir le Feu
   * prime sur tout (sans combustible, la ruine — construction R16), réparer avant
   * bâtir (le chantier attend, pas les murs percés), et la cueillette avant l'extraction.
   *
   * Ces neuf nombres décident de ce que fait un village quand il a le choix, et ils
   * vivaient dans le corps de `refreshBoard` — on ne pouvait pas rééquilibrer la
   * diligence d'un village sans ouvrir le code de son tableau.
   */
  TASK_PRIORITIES: {
    feed_fire: 5,
    repair: 4,
    build: 3, // bâtir avant de cuisiner, après réparer
    cook_stew: 3,
    gather_berries: 2,
    gather_fiber: 2,
    gather_wood: 1,
    gather_stone: 1,
    gather_cut_stone: 1,
  } as const,
  /**
   * LA ZONE MORTE D'UN PAS DE PNJ — en-deçà de cet écart sur un axe, il ne pousse pas
   * dans cette direction. Sans elle, un PNJ à 0,001 tuile de sa cible pousse quand même
   * et tremble sur place.
   *
   * DEUX valeurs, et la différence est voulue : en SUIVANT UN CHEMIN on veut le jalon
   * précisément (fine), en MARCHANT SUR UNE MENACE on veut une trajectoire franche et
   * pas un zigzag de correction (large).
   */
  STEP_DEADZONE: 0.05,
  STEP_DEADZONE_COARSE: 0.2,
  /** Cuisiner exige la recette + une marge de baies, et la fibre de la recette. */
  COOK_MIN_BERRIES: 5,
  COOK_MIN_FIBER: 1,
  /** Raid (spec alignement R13) : un raider décroche sous ce seuil de PV… */
  RAID_DISENGAGE_HP: 40,
  /** …la Meute ne raide pas exsangue, et envoie ce nombre de raiders par nuit. */
  RAID_MIN_ALIVE: 3,
  RAIDERS_PER_RAID: 2,
  /** Rayon de fouille des cadavres autour d'un raider, en tuiles. */
  CORPSE_SEARCH_RANGE: 2,
  /**
   * ÊTRE À SON GÎTE : à quelle distance d'un lit (ou du Feu) un PNJ est considéré
   * ARRIVÉ — il s'y couche, et c'est de là qu'il récupère au tarif « chez soi »
   * (`SLEEP_RECOVERY_HOME_PER_HOUR`) plutôt qu'au tarif « près du feu ». Rien à voir
   * avec `BALANCE.WAYPOINT_RADIUS`, qui fait avancer un chemin : celui-ci décide d'un
   * ÉTAT, et c'est pourquoi il est plus large.
   */
  HOME_ARRIVAL_RANGE: 1.0,

  /* ── LA DÉFENSE NE DOIT PAS TUER SON DÉFENSEUR (correctif 2026-07-12) ────────
   * `handleDefense` prime sur TOUT (sommeil, froid, faim) et ne renonçait jamais.
   * Or il marche GLOUTONNEMENT vers la menace — sans pathfinding, « le village est
   * un terrain ouvert », disait le commentaire. La vallée, elle, ne l'est pas : le
   * PNJ bute sur un rocher, n'atteint jamais le zombie… et rend `true` à chaque
   * tick, pour toujours. Il ne mange plus (deux baies dans sa poche, dix au
   * grenier), ne dort plus, et meurt de faim en montant la garde.
   *
   * C'est le livelock exact que les trois AUTRES besoins gardent explicitement
   * (« la faim ne tue pas ; le figeage, si »). Le seul handler prioritaire était
   * le seul sans garde. */

  /** Sous ce seuil de faim, MANGER passe avant la défense. Un défenseur mort de
   *  faim ne défend rien — et manger prend UN tick : le village n'est pas désarmé. */
  DEFENSE_YIELD_HUNGER: 15,
  /**
   * Sous ce seuil de faim, MANGER passe avant le SOMMEIL — et c'est le pendant exact de la garde
   * ci-dessus, qui manquait.
   *
   * `handleSleep` rend `true` inconditionnellement tant qu'il fait nuit : un PNJ endormi ne mange
   * donc JAMAIS, quelle que soit sa faim. Or la faim décroît d'environ 12 par tranche de 7 200
   * ticks : partie de 88 au matin, elle franchit le seuil de repas (30) en pleine nuit — chaque
   * nuit, systématiquement. Mesuré sur le banc : la faim tombe à 4 puis 0 avant l'aube, et le
   * village compte 177 relevés d'affamés en quatre jours pour un seuil de 10.
   *
   * Un dormeur mort de faim ne se réveille pas. Manger prend UN tick, puis il se rendort.
   */
  SLEEP_YIELD_HUNGER: 15,
  /** LA NUIT RASSEMBLE (spec village-pnj-evolution R14) : un oisif de nuit se replie à
   *  cette distance (Chebyshev) du Feu. L'autopsie du banc de saison (2026-08-17) l'a
   *  mesuré cueilli SEUL à 7-8 tuiles — se serrer au Feu concentre aussi la milice. */
  NIGHT_RALLY_TILES: 3,
  /** Ticks sans le moindre PROGRÈS vers la menace (jamais plus près qu'avant) au
   *  bout desquels on LÂCHE la garde : on ne fige pas une vie devant un rocher. */
  DEFENSE_GIVE_UP_TICKS: ticksFor(3),
  /** …et on l'IGNORE ce temps-là avant de retenter. Sans ce répit, le PNJ
   *  repartirait à la charge au tick suivant : trois secondes de course, une de
   *  renoncement, pour toujours — il n'aurait toujours jamais le temps de manger. */
  DEFENSE_IGNORE_TICKS: ticksFor(30),
} as const

/**
 * LE PORTAGE (spec `portage.md`) — « collecter est facile, rapporter est le jeu »
 * (GDD §8bis). Le poids de chaque objet, et le prix de la charge.
 *
 * Mesuré avant d'écrire la règle : le sac tenait 18 cases × 20 = **360 unités**,
 * soit 180 murs, portés EN SPRINTANT. La distance ne coûtait rien, le sac n'était
 * pas un choix, la route n'était pas un risque, et mourir chargé ne coûtait rien.
 *
 * `Record<ItemId, number>` : exhaustif par construction — un objet ajouté à la sim
 * sans poids ne compile plus. Un objet sans poids serait un objet gratuit à porter,
 * et le trou passerait inaperçu jusqu'au playtest.
 *
 * La cueillette est LÉGÈRE (fibre, baies : 0,2) ; la PIERRE et le MINERAI font mal
 * (2 et 3). Ce sont les « hottes de minerai » du GDD — c'est la mine qui doit faire
 * transpirer, pas la promenade en forêt.
 */
export const ITEM_WEIGHT: Record<import('./items').ItemId, number> = {
  wood: 1,
  stone: 2,
  fiber: 0.2,
  berries: 0.2,
  champignons: 0.2, // léger comme les baies
  worms: 0.1, // une poignée de vers dans la mousse, presque rien
  legume: 0.2, // le potager : léger comme les baies
  graine: 0.1, // une poignée de graines, presque rien
  stew: 0.5,
  raw_meat: 1,
  quartier: 4.5, // V0-5 : LOURD — deux quartiers = un cerf = ~9 de charge (le portage remord)
  cooked_meat: 0.8,
  // La peau brute est BULKY : elle pèse plus que la viande d'une même bête — rentrer
  // sa chasse ET ses peaux force un arbitrage de charge (spec portage).
  raw_hide: 1.5,
  leather: 0.5, // tanné, plus léger que la peau brute
  tenue_hiver: 2, // une tenue d'hiver, ça pèse — mais ça sauve du Grand Froid
  rope: 0.4,
  iron_ore: 3,
  coal: 2,

  // ── LES STRUCTURANTES : elles sont LOURDES, et c'est le second verrou de la zone.
  //
  //    La zone dit OÙ ; le poids dit COMBIEN. Un sac de trente unités ne ramène que **dix**
  //    pierres de taille des Hauts Alpages, ou dix gros bois de la Vieille Sylve : la ressource
  //    d'une zone T1 ne se rapporte pas par brassées, elle se rapporte par convois. C'est ce qui
  //    rend le PORTAGE (et donc la route, et donc le risque) intéressant — au lieu de
  //    `circleFactor`, qui multipliait le stock d'un nœud sans que ça change rien à ce qu'on
  //    ramenait (« on revient avec trente bois du bout du monde comme du coin du feu »).
  hardwood: 3, // un fût, pas une bûche
  cut_stone: 3, // un bloc, pas un caillou
  peat: 1, // la tourbe est légère, mais il en faut beaucoup
  ash: 0.4, // de la cendre : ça ne pèse rien, et c'est un composant, pas un combustible
  iron_ingot: 4,
  steel_ingot: 4.5, // l'acier pèse un peu plus que le fer
  components: 1.5,
  crude_axe: 2,
  crude_pickaxe: 2.5,
  crude_spear: 1.5,
  // LE TIR : les arcs sont LÉGERS (du bois et de la corde, pas de tête de pierre), et
  // la flèche presque rien à l'unité — mais on en porte vingt. C'est le POIDS DU STOCK
  // qui devient l'arbitrage de l'archer, comme la hotte de minerai pour le mineur.
  crude_bow: 1.2,
  bow: 1.8,
  arrow: 0.1,
  axe: 2,
  pickaxe: 3,
  iron_axe: 3.5,
  iron_pickaxe: 4,
  steel_axe: 4,
  steel_pickaxe: 4.5,
  spear: 2,
  hammer: 3,
  // Le feu de camp en ballot : LOURD (un tiers de la besace). On ne trimballe pas
  // trois foyers dans son dos — le poser est un engagement, pas un réflexe.
  campfire: 8,
  // Les COMPOSANTS en objet : LOURDS (une enclume, un four…). On les porte un par un.
  enclume: 10,
  furnace: 9,
  four_acier: 12,
  workshop: 8,
  tour_meca: 10,
  atelier_lourd: 12,
  silo: 8,
  cave: 10,
  reserve: 12,
  parcelle: 6,
  serre: 9,
  terroir: 11,
  chest: 5,
}

/**
 * Le prix de la charge (spec portage.md P4-P7). ON N'EST JAMAIS BLOQUÉ : on peut
 * toujours ramasser, et se surcharger (décision utilisateur) — « je laisse la
 * moitié du minerai, ou je rentre à 20 % de vitesse avec des loups dehors ? ».
 * C'est un CHOIX ; un blocage dur ne ferait que refuser un clic.
 */
export const CARRY = {
  /** Capacité de base. La besace de peau (couche 1 ter) la fera monter. */
  CAPACITY: 60,

  /*
   * QUATRE PALIERS (décision utilisateur, 2026-07-13) : léger, moyen, lourd,
   * surchargé. Les trois premiers sont BORNÉS et leur effet est UNIFORME — pas de
   * pente continue.
   *
   * C'est un choix de LISIBILITÉ, et il vaut mieux que la pente que j'avais posée :
   * une pente, on la subit sans jamais savoir où l'on est ; un palier, on le
   * FRANCHIT — on sent le cran, on peut décider de rester en dessous, et on sait ce
   * qu'une baie de plus va coûter (rien, jusqu'au prochain cran).
   *
   * La SURCHARGE, elle, est proportionnelle : c'est le seul endroit où l'on veut
   * que la peine grandisse à chaque objet ramassé — c'est là qu'est le drame.
   */

  /** Bornes HAUTES des paliers, en fraction de la capacité. */
  LIGHT_MAX: 0.33,
  MEDIUM_MAX: 0.66,
  HEAVY_MAX: 1,

  /** L'effet sur la vitesse, UNIFORME dans le palier. */
  SPEED_LIGHT: 1,
  SPEED_MEDIUM: 0.85,
  SPEED_HEAVY: 0.7,

  /** SURCHARGÉ : la peine devient PROPORTIONNELLE — par unité de capacité au-delà
   *  du plein. À 200 % de la capacité, on touche déjà le plancher. */
  OVERLOAD_MALUS_PER_RATIO: 0.5,
  /** On rampe, mais on avance : sans plancher, une surcharge extrême fige le joueur
   *  — et un joueur figé n'a plus de choix du tout, ce qui est l'inverse du but. */
  SPEED_FLOOR: 0.2,

  /** Le sprint tombe au palier LOURD : il est REFUSÉ (pas ralenti). C'est le cran
   *  qu'on sent en premier, avant même de regarder une jauge. */
  SPRINT_MAX_TIER: 'medium',

  /** SURCHARGÉ, l'endurance ne revient presque plus : on ne se bat pas, on ne fuit
   *  pas, on rentre. Le porteur est une PROIE — c'est le PvP léger des routes que
   *  veut le GDD §8bis. */
  OVERLOAD_STAMINA_REGEN: 0.25,
} as const

/** Les quatre paliers de charge (spec portage.md P5). */
export type CarryTier = 'light' | 'medium' | 'heavy' | 'overloaded'

/** Durée d'un tick en secondes — le seul dt qui existe dans /sim. */
export const TICK_DT_S = 1 / BALANCE.TICK_RATE_HZ

/**
 * L'INVENTAIRE À CASES (spec inventaire R5, R7). Piles COURTES, exprès : les
 * coûts de Braises sont à un chiffre (un mur = 2 bois), donc des piles de 1000
 * façon Rust rendraient la capacité purement décorative — et le coffre inutile.
 * Les outils et les armes ont une pile de 1 : chaque exemplaire occupe sa case,
 * donc chaque exemplaire porte son usure.
 */
export const STACK_DEFAULT = 20
export const STACK_SIZES: Partial<Record<import('./items').ItemId, number>> = {
  wood: 20,
  stone: 20,
  fiber: 20,
  iron_ore: 20,
  coal: 20,
  components: 10,
  berries: 10,
  champignons: 10, // s'empile comme les baies
  rope: 10,
  stew: 5,
  iron_ingot: 5,
  raw_meat: 5,
  quartier: 3,
  cooked_meat: 5,
  raw_hide: 5,
  // Outils et armes : un par case (l'usure est portée par la case).
  crude_axe: 1,
  crude_pickaxe: 1,
  crude_spear: 1,
  axe: 1,
  pickaxe: 1,
  iron_axe: 1,
  iron_pickaxe: 1,
  spear: 1,
  hammer: 1,
  // Un feu de camp par case : c'est un objet-structure, pas un consommable qu'on empile.
  campfire: 1,
  // Les composants en objet : un par case (objets-structures, pas des consommables).
  enclume: 1,
  furnace: 1,
  four_acier: 1,
  workshop: 1,
  tour_meca: 1,
  atelier_lourd: 1,
  silo: 1,
  cave: 1,
  reserve: 1,
  parcelle: 1,
  serre: 1,
  terroir: 1,
  chest: 1,
}

