/**
 * LES DRAPEAUX DE FONCTIONNALITÉ — ce qu'on peut éteindre sans le démonter.
 *
 * ── POURQUOI CE FICHIER EXISTE, ET PAS UNE LIGNE DANS `balance.ts` ──────────────
 *
 * `balance.ts` porte « tout nombre d'ÉQUILIBRAGE » (CLAUDE.md), c'est-à-dire ce qui
 * se règle en JOUANT. Un drapeau n'est pas un réglage : c'est une décision de
 * CHANTIER — « ce pan du jeu n'est pas la question du moment ». Le confondre avec de
 * l'équilibrage ferait chercher un drapeau parmi six mille lignes de nombres.
 *
 * ── LES RÈGLES DU JEU POUR CE FICHIER ──────────────────────────────────────────
 *
 * ① **Un drapeau masque, il ne supprime pas.** Le code éteint reste compilé, testé
 *    (par les gardes qui rallument le drapeau chez elles) et exact. Rallumer doit
 *    être SANS PERTE, et c'est une propriété qu'on GARDE, pas qu'on espère : voir
 *    la garde d'identité citée sous `VILLAGES_PNJ`.
 * ② **Un drapeau est une CONSTANTE, jamais une variable d'environnement.** Le lint
 *    de `/sim` interdit `process`, le Worker de la Veillée ne verrait pas l'`env` du
 *    serveur, et surtout `replay-log.ts` reconstruit un monde depuis sa seule graine
 *    SANS tamponner de version : un drapeau qui changerait au lancement ferait
 *    diverger un replay en silence.
 * ③ **Un drapeau est le DÉFAUT d'un paramètre explicite**, jamais une lecture en dur
 *    au fond d'une fonction — sinon un test ne peut pas rallumer localement ce que
 *    le monde joué éteint.
 * ④ **Chaque drapeau dit sa DATE, sa DÉCISION et où il se rallume.** Un drapeau sans
 *    provenance devient un mystère au bout de trois semaines.
 */

/*
 * ⚠ ═══ CE FICHIER N'A PLUS AUCUN DRAPEAU, ET SON PREMIER LOCATAIRE A UNE MORALE ═══
 *
 * `VILLAGES_PNJ: false` a vécu ici du 2026-09-26 au 2026-09-29. Il exécutait la décision
 * d'Alexis — *« stop les villages. Masque-les avec une feature flag (idem pour les tests) »*,
 * *« je veux qu'on finisse la worldgen avant »* — en coupant la SEULE porte de fondation
 * (`peuplerLesVoisins`, `worldgen.ts`, où passent les trois hôtes). La couture était choisie :
 * l'élection des sites et le RÉSEAU DE SENTES restaient en amont, donc les routes du monde joué
 * n'ont jamais bougé d'une tuile ; elles menaient à des clairières vides.
 *
 * Le pivot du 2026-09-28 a transformé l'extinction en RETRAIT, et le drapeau est parti avec son
 * sujet (tranche 4). `braise.md` § 3 étape 11 le dit en propres termes : « le drapeau devient un
 * retrait ; les gardes gelées par `it.skipIf` se suppriment au lieu de repartir ».
 *
 * ⚠ ET IL LAISSE UNE LEÇON QUI CONTREDIT LA RÈGLE ① CI-DESSUS, il faut la lire avant d'écrire
 * le prochain drapeau : **un drapeau MASQUE, il ne GARDE pas.** La règle ① promettait que
 * rallumer serait SANS PERTE et que ce serait « une propriété qu'on GARDE, pas qu'on espère ».
 * Ça n'a pas tenu : les gardes dont le village était le sujet étaient `skipIf`, donc elles ne
 * rallumaient rien chez elles, et `empreinte-sim` ne traversait pas `peuplerLesVoisins`. La
 * réversibilité est restée un fait MESURÉ UNE FOIS (le 26/09 : banc vert, villages écartés de
 * 221 tuiles, marge de ciblage 9,4 %), jamais un invariant surveillé. Trois jours plus tard,
 * personne n'aurait su dire si le rallumage marchait encore.
 *
 * Deux conséquences pratiques, pour la prochaine fois :
 *  · une garde `skipIf` est une garde ÉTEINTE — si la réversibilité compte, il faut une garde
 *    qui RALLUME le drapeau chez elle et compare, sinon la règle ① est un vœu ;
 *  · éteindre n'est pas soustraire. MESURÉ : sans `foundNpcVillage`, les emplacements gardent
 *    leur terrain et leurs nœuds naturels (plus de place nette), et une quinzaine de corps en
 *    moins DÉCALE LE FLUX DU PRNG pour tout ce qui suit — hordes, météo, faune. Un monde
 *    « éteint » n'est jamais le monde d'avant moins la chose éteinte.
 *
 * La doctrine des quatre règles ci-dessus, elle, reste bonne et attend le prochain drapeau.
 */

export const FEATURES = {
} as const
