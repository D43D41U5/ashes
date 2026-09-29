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

export const FEATURES = {
  /**
   * LES VILLAGES PNJ SONT ÉTEINTS — décision d'Alexis du 2026-09-26 : *« stop les
   * villages. Masque-les avec une feature flag (idem pour les tests) »*, et la raison
   * qu'il a donnée juste après : *« je veux qu'on finisse la worldgen avant »*.
   *
   * ── CE QUE LE DRAPEAU COUPE, ET CE QU'IL NE COUPE PAS ────────────────────────
   *
   * Il coupe **la seule FONDATION** des villages PNJ, à la porte unique qui la fait
   * (`peuplerLesVoisins`, `worldgen.ts` — les trois hôtes y passent : la Veillée, le
   * banc de scénario et la zone LAN). Il ne coupe RIEN d'autre, et la couture a été
   * choisie pour ça :
   *
   *   · **l'élection des sites reste** — donc le décalage du site de la Meute pour la
   *     marge du raideur reste, donc les sites sont ceux de HEAD ;
   *   · **le réseau de sentes reste** (`tracerLeReseau`, tracé ENTRE l'élection et la
   *     fondation), donc les routes du monde joué sont **inchangées**. Elles mènent
   *     désormais à des clairières vides : c'est le réseau de HEAD, V-A7 reste verte,
   *     et rallumer rend les villages au bout de leurs routes sans retoucher un tracé ;
   *   · **le Feu du JOUEUR reste entier** — `light_fire`, `found_village`, le tableau,
   *     le grenier, l'upkeep. Le drapeau ne connaît que `chiefId: 0`, le village PNJ.
   *     La boucle de survie (le froid, la cuisson, le Grand Froid) n'y touche pas.
   *
   * ── CE QU'IL CHANGE, MESURÉ — et ce n'est pas « rien » ───────────────────────
   *
   * Éteint, le monde n'est PAS celui de HEAD moins les villages :
   *   · `foundNpcVillage` faisait **place nette** sous chaque village ; sans lui, ces
   *     emplacements gardent leur terrain et leurs nœuds naturels ;
   *   · une quinzaine de PNJ en moins **décale le flux du PRNG** pour tout ce qui suit
   *     — hordes, tirages de météo, faune. C'est le piège connu du décompte d'entités.
   * ── LA RÉVERSIBILITÉ : CE QUI EST MESURÉ, ET CE QUI N'EST PAS GARDÉ ──────────
   *
   * **MESURÉ le 2026-09-26** : le drapeau remis à `true`, le banc de scénario rend ses QUATRE
   * gardes vertes et les mêmes chiffres qu'avant le drapeau — *villages écartés de 221 tuiles,
   * marge de ciblage 9,4 %*. La raison en est structurelle et c'est ce qui fonde la confiance :
   * allumé, le code exécuté est `if (true) { … }` autour de la boucle de HEAD, à l'identique.
   *
   * ⚠ **MAIS AUCUNE GARDE PERMANENTE NE TIENT CETTE PROPRIÉTÉ**, et il ne faut pas le lire
   * autrement. Alexis a demandé le masquage *« idem pour les tests »* : les gardes dont le
   * village est le sujet sont donc `skipIf`, elles ne rallument pas le drapeau chez elles.
   * `empreinte-sim` n'éprouve PAS cette identité non plus : il appelle `foundNpcVillage` en
   * direct et ne traverse jamais `peuplerLesVoisins`. *(Cette phrase nommait aussi
   * `replay-monde-reel` — MESURÉ FAUX le 2026-09-29 : ce test n'appelle `foundNpcVillage` nulle
   * part, il ne fonde aucun village du tout. Corrigé plutôt que recopié.)* Tant que
   * le drapeau est éteint, la réversibilité est un fait MESURÉ UNE FOIS, pas un invariant
   * surveillé : la revérifier veut dire refaire le geste ci-dessus (basculer, jouer le banc).
   * La règle ① de ce fichier n'est donc, pour ce drapeau-ci, PAS honorée par une garde.
   *
   * ── OÙ ON LE RALLUME ────────────────────────────────────────────────────────
   *
   * Passer `true` en dernier argument de `peuplerLesVoisins` — ou, pour tout rallumer d'un
   * coup, remettre ce champ à `true` ici. Les gardes dont le village est le SUJET sont
   * `it.skipIf(!FEATURES.VILLAGES_PNJ)` : elles repartent seules. Celles qui se servent d'un
   * village comme DÉCOR (un feu, un coffre) appellent `foundNpcVillage` en direct et n'ont
   * jamais été concernées — le drapeau ne les traverse pas.
   *
   * Côté navigateur, `tools/smoke.mjs` lit ce champ dans la SOURCE (`drapeau('VILLAGES_PNJ')`,
   * node nu ne sait pas importer du TypeScript) : `gi-face` et `village-pnj`, dont le village
   * PNJ est le sujet, déclarent alors n'avoir plus de sujet au lieu de rougir ou, pire, de
   * verdir sur une liste vide. L'audit des autres scénarios est en tête de cette porte.
   *
   * ⚠ **CE QUI EST PARQUÉ AVEC, et n'est PAS fait** : la passe sur la machine du
   * village (`docs/specs/pnj.md`), dont P-A1 et P-A3 sont livrées mais dont **les
   * quatre conditions de terminaison inatteignables de P-A2 sont inventoriées et NON
   * CORRIGÉES** — au premier chef la réparation qui ne s'achève jamais quand le Feu
   * est à sec, et qui mange le bois même qui manque au Feu. Rallumer les villages
   * sans lire P-A2 rallumerait ces défauts-là avec.
   */
  VILLAGES_PNJ: false,
} as const
