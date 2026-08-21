# Les Cendreux — le monstre, c'est toi sans ta braise

> **⚠ RÉVISION MAJEURE DU 2026-08-21 — « LA PRESSION CROISSANTE » (19 décisions d'Alexis,
> plan détaillé : `docs/superpowers/specs/2026-08-21-cendreux-pression-croissante-design.md`).**
> Le cadran unique du Cendreux est désormais LA TEMPÉRATURE LOCALE (« presque amorphe quand il
> fait chaud ») : l'éveil est une pente continue (`CENDREUX.TORPEUR`, `eveilCendreuxAt`) qui
> module vue, allure et cadence — et qui REMPLACE la bascule d'espèce par acte (R11 :
> `UNDEAD_SHARE` n'existe plus ; sur la nuit de plaine la pente rend l'ancienne table au bit
> près). S'y ajoutent : la LONGUE MARCHE des solitaires vers les feux (champ multi-sources SCINDÉ : Foyers de
> village à l'échelle de la vallée — ensemble stable, ~170 ms mesurés payés une poignée de
> fois par saison — et feux libres bornés à 150 tuiles de marche, ~10 ms par flambée),
> la mémoire du dernier lieu vu, LE FEU QUI REPOUSSE au lieu d'annuler (A27 renversée — voir
> plus bas), « ILS BOIVENT LA CHALEUR » (feux et corps), le CRI DE FUREUR qui réveille le sol,
> un PLAFOND GLOBAL en rampe de saison, la horde en pente continue décidée à l'AUBE (présage)
> et FIGÉE à l'aube suivante, la fin de la méga-horde scriptée, la milice qui ne se fauche
> plus elle-même (3e alliance), le gibier chassé et effrayé, le repaire qui respire et le
> charnier qui se brûle. Les sections ci-dessous restent la référence des règles NON touchées ;
> les passages amendés sont marqués **[RÉVISÉ 2026-08-21]**.


*Source : la direction de lore **A×C** (design `docs/superpowers/specs/2026-07-08-levee-cendreux-design.md`, livré), `feu-station.md` **S4-S6** (le feu rempart ET phare, le Foyer assiégé — actés le 2026-07-25 et **jamais livrés côté siège**), `tension.md` **T12-T15** (la nuit chasse, elle a une parade, elle est bornée), GDD §7 (le PvE école de guerre, la méga-horde du Grand Froid). Statut : **en cours** (2026-07-31). Décisions utilisateur du 2026-07-31, actées — ne pas les rouvrir : **le Cendreux absorbe le zombie**, **la levée s'ouvre à toute mort**, **la contagion existe et elle est bornée**.*

## Le constat, mesuré (2026-07-31)

Le monstre qui donne son nom au jeu, personne ne le rencontre. Mesuré sur la carte de
production et une saison Veillée complète (6 cycles, `tools`/banc, seed 2026) :

| | mesuré |
|---|---|
| Repaires de Cendrés sur la carte solo | **9** pour 3,75 M tuiles, 1 résident chacun → **un Cendreux pour 417 000 tuiles** |
| La levée sur une saison entière | **1** cadavre marqué (jour 60), **0** levée |
| Ce que la nuit envoie vraiment | 5 hurlements → des **loups** ; 4 hordes → des **zombies** |

Le 0 de la levée ne dit pas qu'elle est cassée : un PNJ en est **exclu par construction** — il
meurt chez lui, donc avec un villageois à moins de `WITNESS_RADIUS` (8) *et* son feu à moins de
`HEARTH_WARD_RADIUS` (12). Les deux gardes se ferment ensemble. Le sujet de la levée, c'est le
**joueur** mort seul au loin. Ce que la mesure établit, c'est qu'**aucune autre source ne
l'alimente**, et que le bestiaire porte **deux lores pour un seul rôle** : le zombie vient du
GDD, le Cendreux de la direction A×C.

Et son comportement avait un trou. Trois montages headless, avant correctif :

| | avant |
|---|---|
| feu allumé, joueur assis derrière | il s'arrête à 1,4 tuile du feu, **0 tick ciblé, 0 dégât** en 4 000 ticks |
| même joueur, sans feu (contrôle) | il vient, il mord : 2 652 PV |
| joueur enclos dans quatre murs | il garde sa cible 4 000/4 000 ticks, **ne bouge pas d'une tuile**, ne touche aucun mur |

Arrivé au feu, **plus aucun humain ne peut battre le foyer** dans `nearestWarmth` : il faudrait
se tenir sur la braise. **Le feu du joueur était donc son meilleur bouclier** — l'exact inverse
de S5/S6.

## Les règles

### 1. Un seul mort-vivant

- **R1 — Le Cendreux absorbe le zombie.** Le type `zombie` sort du bestiaire : partout où une
  horde marchait, ce sont désormais des Cendreux. Un monde ne porte pas deux morts-vivants avec
  deux lores. *Les loups de la nuit qui chasse restent* — ce sont des bêtes, et `faune.ts` est
  fini (audit : « on n'y touche pas »).
- **R2 — Les hordes lèvent des Cendreux.** La horde nocturne (`worldevents.ts`) naît en
  `cendreux`. Le Grand Froid devient littéralement *les morts qui reviennent au feu*.
  **[RÉVISÉ 2026-08-21, décision ⑲ : la MÉGA-HORDE scriptée du premier crépuscule de la
  Cendre n'existe plus** — cadence et taille sont une PENTE de saison (`HORDE_TAILLE`,
  `seasonRamp`), la dernière nuit est naturellement la pire.]

### 2. Le siège (S6, acté et jamais livré)

- **R3 — Ce qui barre la route se prend un coup.** Un Cendreux qui ne peut pas atteindre sa
  cible frappe le franchissement qui le bloque — en horde (descente de gradient) **comme seul**
  (chasse). Le mécanisme existe déjà (`crossingBlocker` + `attackBlockingStructure`, murs
  d'arête compris) : il n'était simplement pas câblé sur cette branche d'IA. C'est ce qui donne
  enfin une raison d'être aux murs, au toit et à la porte.
- **R4 — Le feu ne le rend pas aveugle.** Un vivant dans sa **vue** (`aggroRange`) prime sur le
  foyer, dans les deux régimes. Le feu l'amène de loin ; ses yeux font le reste — on ne lui
  apprend pas une deuxième règle. *(Livré le 2026-07-31.)*
- **R5 — La convergence de masse passe par le champ de flux, jamais par l'A\*.** Un membre de
  horde coule vers le Feu ciblé par `computeFlowField` (partagé, mis en cache) ; un Cendreux
  **seul** garde son A\* court dans `WARMTH_SEEK_RANGE`. Élargir le rayon d'A\* pour simuler la
  convergence coûterait un BFS par bête et par demi-seconde : c'est exactement ce que le champ
  de flux existe pour éviter.

### 3. La levée s'ouvre

- **R6 — Toute mort se relève, plus seulement le froid.** Le critère perd `cause === 'cold'` :
  n'importe quelle mort d'un non-monstre, **seul** (`WITNESS_RADIUS`) et **loin d'un feu actif**
  (`HEARTH_WARD_RADIUS`), marque le cadavre. Le froid n'était pas une règle, c'était un goulot :
  il ne tue la plaine qu'en acte III, et la mesure ci-dessus en a compté **une** sur une saison.
- **R7 — La contagion existe.** La victime d'un Cendreux se relève à son tour. C'est le lore
  pris au mot : la vallée peut basculer.
- **R8 — …et elle est BORNÉE.** Aucune levée au-delà de `CENDREUX.MAX_ALIVE` Cendreux **nés
  d'un cadavre** (`Monster.risen`) encore vivants. C'est T15 appliqué (« on peut perdre, on ne
  doit pas être submergé ») — sans plafond, une mauvaise nuit ne fait pas une histoire, elle
  ferme la porte. Abattre un levé rouvre une place.
  Le plafond ne compte **que les levés** : ni les résidents de Repaire, ni les hordes, ni les
  gardes de convoi, qui ont déjà leurs propres bornes (`cap` du POI, `HORDE_SIZE`, dissipation
  à l'aube). Les compter aussi **refermait la levée qu'on venait d'ouvrir** — MESURÉ : 24
  vivants, le plafond pile, dès le **jour 21**, rien qu'avec les 5 Repaires et les gardes de
  convoi accumulés, donc plus une seule levée sur les deux tiers de la saison.

  **R8bis — LE PLAFOND SE LIT À LA LEVÉE, PAS SEULEMENT À LA MORT** *(correctif 2026-08-02)*.
  Il n'était consulté que dans `willRiseAsCendreux`, c'est-à-dire à la MORT — or un cadavre ne se
  lève que `RISE_DELAY` plus tard. Entre les deux, une nuit qui tourne mal marque des CENTAINES de
  cadavres alors que pas un seul ne marche encore : le plafond ne bornait donc **rien**.
  **MESURÉ** : **460 Cendreux vivants pour un `MAX_ALIVE` de 24** (banc : un avatar sans village
  qui remeurt sur place, `tools/mesure-touche.mts` en marge). Ça ne se voyait pas parce qu'une
  DEUXIÈME béquille tenait le compte : le nouveau-né naît sur le cadavre, donc sous ce qui vient
  d'y tuer — un loup, le meurtrier — et se faisait abattre dans le tick de sa levée. R23 avait
  réparé la version cendreux-contre-cendreux ; la version loup-contre-levé survivait. Le **recul**
  de combat (spec combat R4sexies, 2026-08-02) écarte les corps d'un quart de tuile, l'exécution à
  la naissance a cessé, et la contagion est partie à 460. Le recul n'a rien cassé : il a retiré la
  béquille qui masquait un plafond mort.
  **Plein, la vallée ne relève plus personne** — le cadavre redevient un cadavre et se décompose.
  Il ne fait PAS la queue : une file de quatre cents morts qui se viderait à mesure qu'on abat
  rendrait le plafond à son inutilité. Conséquence à connaître : « abattre un levé rouvre une
  place » vaut pour les morts À VENIR, pas pour un cadavre déjà arrivé à son heure pendant que le
  plafond était plein.
- **R23 — TOUS LES CENDREUX SONT ALLIÉS ENTRE EUX** *(décision d'Alexis, 2026-07-31 ; livré)*.
  Un Cendreux ne blesse jamais un Cendreux. L'alliance est de l'**ESPÈCE** : ni la harde, ni le
  voisinage, ni le lien tueur→levé — n'importe lesquels, n'importe où. `resolveStrike` écarte la
  cible de l'arc, il n'annule pas le geste (le coup part, il porte sur tout le reste).

  **Pourquoi la règle existe.** Sans elle, R7-R8 étaient MORTS, et le détail est cruel : la levée
  pose le Cendreux **exactement sur le cadavre**, c'est-à-dire sous le meurtrier qui s'y tient
  encore ; `advanceCendreux` court avant `advanceCombat` ; et un Cendreux frappe à 34 pour 20 PV
  (R10). Le levé était donc abattu **dans le tick même de sa levée**, par celui qui l'avait fait.
  MESURÉ sur une nuit d'acte III : **313 levées, 313 abattues dans leur tick**, `risenAlive` à 0
  en permanence — donc le plafond de R8 ne mordait jamais et la contagion ne blessait personne.
  La promesse *on veille ses morts au feu, ou ils reviennent* était détruite par son exécutant.
  Détail complet et mesures : `docs/mesure-contagion.md`.

  **Pourquoi l'espèce et pas le couple tueur→levé.** La version étroite laissait le défaut revenir
  dès qu'un TROISIÈME Cendreux passait par là — et c'est le cas nominal, pas le cas rare : sur la
  nuit mesurée, **deux** rôdeurs suffisaient à eux seuls pour les 313.

  **Ce que la règle ne fait pas** : elle ne rend pas le Cendreux invulnérable. Un loup, un PNJ, le
  joueur le frappent comme avant (A35). Et elle ne touche pas la harde, qui reste l'alliance
  LOCALE des bêtes qui chassent ensemble (spec faune R11) — les deux coexistent.

- **R9 — Le feu veille les morts, et c'est LE geste.** Inchangé (S4) : un cadavre près d'un feu
  allumé ou en braises ne se relève pas, et l'annulation est **revérifiée au réveil**. La règle
  ne bouge pas d'un iota — mais avec R6-R7 elle cesse d'être une ligne de lore pour devenir la
  parade quotidienne. On veille ses morts au feu, ou ils reviennent.

### 4. La tension croissante — c'est la NUIT qui monte, pas la horde

*(décision du 2026-07-31 « basculement d'espèce par acte », **[RÉVISÉE 2026-08-21 : le FROID
DU LIEU décide, plus l'acte]**.)*

- **R11 — [RÉVISÉ 2026-08-21] La nuit change de visage avec le FROID.** La part de morts dans
  ce que la nuit envoie est l'ÉVEIL du sol au point de la proie (`eveilCendreuxAt` —
  `UNDEAD_SHARE` n'existe plus). Sur la nuit de plaine, la pente REND l'ancienne table au bit
  près (60/35/10 de froid → 0 / 0,5 / 1) ; partout ailleurs la géographie parle enfin : le
  Névé envoie des morts dès l'acte I, la Brume et le front météo pèsent. Le reste de la
  machine est réutilisé tel quel — la naissance autour de la proie, l'annonce, le plafond.
  **La parade au feu, elle, n'épargne plus que le VIVANT** : le loup ne chasse pas dans la
  lumière ; le mort vient, et son site se plante hors de la bulle (décision ⑦).
- **R11bis — Deux dangers, deux signes.** Un Cendreux ne hurle pas : il émet
  `cendreux_prowl`, pas `wolf_howl` — son propre bandeau (« un raclement dans le noir ») et
  son propre son (bruit filtré bas, sourd, sans hauteur, contre la note haute qui porte du
  loup). Le joueur doit savoir CE QUI vient, parce qu'on distance un Cendreux (1,3 tuile/s
  contre 4) et jamais un loup : **la parade n'est pas la même** (T16).
- **R11ter — [RÉVISÉ 2026-08-21] Le plafond diffère par espèce, et celui des morts MONTE EN
  CONTINU.** Les loups gardent `MAX_ALIVE` 2 ; les morts ont round(1 + (`UNDEAD_MAX_FIN` − 1)
  × jour/60) — la table de trois valeurs mangeait la montée (le ×1,6 d'A13). Deux loups sont déjà la mort parce qu'ils courent plus
  vite que vous — le nombre n'y ajoute rien de lisible. Un Cendreux se distance toujours : se
  faire encercler par eux est une faute de POSITION, donc leur danger EST le nombre (R10), et
  le borner à deux les rendrait inoffensifs.

**Pourquoi la nuit et pas la horde** — mesuré : une saison de Veillée ne compte que **six
nuits**, et la horde se tire **une seule fois par nuit** (`HORDE_CHANCE_PER_NIGHT`), soit
**3 hordes sur toute la partie**. Une échelle à trois actes ne se sent pas en trois
événements. La nuit qui chasse se tire à la **minute** (~18 fois par nuit) et son taux
quadruple d'un bout à l'autre (0,12 → 0,55) : c'est la seule montée perceptible, et la seule
qui naisse autour du joueur plutôt que sur un village.

### 5. Le sol en est plein — il ne naît pas, il SE RÉVEILLE

*(décisions utilisateur du 2026-07-31, actées — ne pas les rouvrir : **le Cendreux ne naît pas,
la vallée en contient déjà** ; **le sol en est plein par un CHAMP de densité, et les charniers
sont les pics de ce champ**.)*

Le constat qui a ouvert le chantier : la nuit qui chasse **téléportait** un mort. Un loup qui
arrive du noir est juste ; un cadavre qui se matérialise dans un pré ne l'est pas — et le
monstre qui donne son nom au jeu méritait mieux qu'un `spawnMonster` à un offset.

On a d'abord cherché à le faire **sortir d'une trace du monde** (cendre, sol brûlé, repaire).
MESURÉ sur la carte de production (seed 2026, spawn joueur en 264,760), c'est impossible :

| autour de là où le joueur vit vraiment | mesuré |
|---|---|
| sol brûlé **statique** dans la couronne de naissance | **0 / 1 095 tuiles** (le plus proche à **74** t) |
| cendre du **front** dans la couronne, jours 5 → 50 | **0** — elle n'arrive qu'au **jour 60** |
| Repaire de Cendrés le plus proche | **110** t |
| coins de chasse (le semis de référence, espacement 200) | **2 sur toute la carte**, le plus proche à **130** t |

Gater la naissance sur une trace aurait donc supprimé le Cendreux de la nuit **jusqu'au jour
~55**. La trace peut être une *couleur* ; elle ne peut jamais être une *condition*. C'est cette
mesure qui donne leur forme aux règles ci-dessous.

- **R14 — Le Cendreux ne naît pas, il se réveille.** La vallée en est déjà pleine. La nuit qui
  chasse ne fabrique plus un monstre à un offset : elle **réveille le sol** à un endroit que le
  monde a choisi. Le nom du jeu se paie enfin — la Cendre n'est pas un décor, c'est ce qu'il y a
  sous les pieds.
- **R15 — Le champ des morts est DÉRIVÉ, jamais rangé.** « Combien de morts dorment ici » est une
  fonction pure de la carte et du tick, calculée à la lecture — le modèle exact de `cendre.ts`
  (*« le tick est la seule horloge ; toute notion dérivée est une fonction pure du numéro de
  tick »*, `monde.md` R1). Le champ n'ajoute **aucun octet au `SimState`** et **aucun tableau à
  la carte** : il se lit de `zoneTierAt` et de `estCendre`, tous deux déjà là, en O(1).
- **R16 — Le champ décide COMBIEN et OÙ, jamais SI.** C'est la leçon des trois mesures ci-dessus,
  et elle est structurelle : toute règle qui laisse la géographie *autoriser* la nuit reproduit
  le zéro. `UNDEAD_SHARE` possède déjà le « si », par acte, et il marche. Le champ possède
  l'**intensité** — et il porte un **PLANCHER** qui garantit qu'une couronne rend toujours un
  site, y compris chez soi, en t0, à l'acte I.
- **R17 — Une carte sans zones est une carte sans géographie.** Le champ y vaut son plancher
  partout, uniformément. Même précédent, même raison que `zoneTierAt` (qui rend 0), que
  `faunaCap` (0 par défaut) et que `grounds` (vide) : *on n'impose pas une géographie à qui n'en
  a pas demandé*. Un banc headless garde donc exactement le comportement qu'il avait.
- **R18 — Une couronne est une COURONNE, et son sol MÈNE à la proie.** `SPAWN_DIST` était
  documenté comme un rayon et n'en était pas un : `ox` **et** `oy` valaient tous deux
  ±`SPAWN_DIST`, donc **quatre positions diagonales à 21,2 tuiles**, jamais de côté, jamais à 15.
  Et le point n'était que *clampé aux bords* — aucune marchabilité, aucune joignabilité, le bug
  exact que R12 vient de corriger pour la horde. MESURÉ sur 1 600 points de naissance :
  **14,0 % naissaient dans la roche ou un mur**, 4,2 % sur un sol libre **sans aucun chemin**
  vers la proie — **18,2 % de nuits perdues**. On tire désormais dans une vraie couronne, pondérée
  par le champ, et on exige un sol qui mène à la proie.
- **R19 — Un seul tirage pour placer.** Le placement consomme **un** tirage (choix pondéré sur la
  somme cumulée des densités de la couronne) là où l'ancien en consommait deux, et son repli —
  si la tuile élue est bloquée ou injoignable — est un **parcours déterministe** de l'ordre
  cumulé, jamais une boucle qui retire. Une boucle de rejet aurait fait dépendre le flux du PRNG
  de la forme du terrain : le déterminisme serait resté vrai, mais illisible.
- **R19bis — La ROCHE disqualifie, le MUR non.** Le sol qui « mène à la proie » se juge sur le
  **terrain seul**. Un mort qui naît de l'autre côté d'une falaise est un décor, et la roche doit
  l'écarter ; une enceinte, jamais — R3 dit précisément qu'un Cendreux qui ne peut pas atteindre
  sa cible **frappe le franchissement qui le bloque**. Exiger un chemin à travers les structures
  aurait rendu le joueur enclos intouchable **une seconde fois, par l'autre bout** : plus aucun
  réveil autour de lui, donc plus de siège — l'exact bug qu'A4 venait de fermer.
  Et c'est aussi le chemin le moins cher : ni index d'occupation à bâtir, ni A\* qui butte sur un
  mur jusqu'à épuiser son budget.
- **R19ter — Le repli est BORNÉ.** Écarter une tuile bloquée est gratuit ; vérifier qu'elle mène
  à la proie coûte un A\*, et un A\* qui **échoue** coûte son budget entier (4 096 tuiles).
  MESURÉ sans plafond, sur une proie ceinte de roche : **1 593 ms pour un seul réveil**, soit
  **32× le budget d'un tick à 20 Hz**. Avec `MORTS.ESSAIS_MAX` (12) : **33 ms** dans ce même pire
  cas, **0,61 ms** en cas normal sur la carte de production. Épuisés, on **refuse** — la nuit
  passe son tour, ce que l'ancien code ne savait pas faire (il gardait son dernier essai).
- **R21 — Le réveil DURE, et pendant qu'il dure le feu peut l'étouffer.**
  *(décision utilisateur du 2026-07-31 : « il dure, il est jouable, et il naît PRÈS ».)*
  Un réveil planté vit dans l'état (`SimState.reveils` — quatre nombres : `x`, `y`, `at`,
  `preyId`), travaille `MORTS.REVEIL_TICKS` (4 s), s'annonce par `cendreux_prowl` (qui portait
  déjà `x, y`) — et **un feu actif dans `CENDREUX.HEARTH_WARD_RADIUS` l'annule**, en émettant
  `reveil_etouffe`.
  C'est **S4 généralisé, et c'est tout l'intérêt** : *« on veille ses morts au feu, ou ils
  reviennent »* ne servait que la levée d'un cadavre — laquelle, MESURÉ, ne s'est déclenchée
  **qu'une fois sur une saison entière**. Autant dire jamais. Le réveil lui donne sa fréquence :
  la parade devient le geste de chaque nuit au lieu d'une ligne de lore. La garde est la MÊME
  (même rayon, même `fireActive`, braises comprises) — on ne lui apprend pas une deuxième règle.
  **Aucun tirage** n'est consommé ni à l'étouffement ni à l'émergence : le site et l'instant
  sont décidés à la plantation, sans quoi *allumer un feu* déplacerait le flux seedé du monde
  entier.
  L'état est **le seul neuf du chantier**, et il n'a pas été porté par `Corpse` malgré la forme
  qui collait (`risesAt` existe déjà) : un cadavre est **mangé** par les prédateurs, **fouillé**
  par les PNJ, ouvrable au conteneur et expédié en entier à chaque client — un faux cadavre
  aurait fait venir les loups renifler un réveil.
- **R22 — Deux dangers, deux DISTANCES.** Le mort naît à `SPAWN_DIST_UNDEAD` (**7**) quand le
  loup garde ses **15**. À 1,3 tuile/s, quinze tuiles font **seize secondes** de marche contre
  cinq pour un loup : face à un joueur qui se déplace à 4 t/s, le Cendreux n'atteignait
  **jamais rien**. Le rapprocher est la seule chose qui le rende dangereux sans toucher à sa
  vitesse, et la seule qui rende possible l'encerclement sur lequel R10 fonde tout son danger.
  Naître à sept tuiles serait injuste **sans préavis** — c'est exactement ce que R21 achète :
  4 s de sol qui travaille, puis 5,4 s d'approche, soit **9,4 s d'avertissement**. Plus court
  qu'avant, et bien plus tendu : la menace est **arrivée**, elle ne s'approche plus.
  On ne rapproche que ce qui est lent — le loup couvre ses quinze tuiles en trois secondes,
  le rapprocher n'ajouterait qu'une mort sans recours. *(Ordres de grandeur, à calibrer en
  playtest — GDD §15.)*
- **R21bis — LE PRÉAVIS DOIT SE VOIR** *(livré le 2026-07-31 ; demande d'Alexis : « ils creusent
  le sol vers le haut et s'extraient du sol »)*. R21 et R22 forment un marché : le mort naît à
  **sept** tuiles au lieu de quinze, et il paie ce rapprochement avec **4 s de sol qui
  travaille**. Or la moitié « préavis » du marché n'existait que dans la sim — `state.reveils`
  partait bien dans le snapshot (`protocol.ts`, worker solo ET serveur LAN), et **le client le
  jetait** : aucune lecture de `reveils` dans `packages/client`. Le jeu encaissait donc le
  rapprochement sans rendre la contrepartie, et le Cendreux **poppait** à sept tuiles, de nuit.
  La couche de rendu (`scenes/world/reveil-fx.ts`) est cette contrepartie, en deux temps :
  - **le sol creuse vers le haut** — un tertre au sol, tiré de `state.reveils`, qui enfle en
    continu sur toute la rampe et se **rompt en quatre crans francs**, chacun projetant de la
    terre. Il n'y a pas d'entité pendant ce temps : c'est une couche au sol, voisine des
    terriers. **Aucun état neuf** : l'avancement se déduit de `(at − tick)`, dans l'esprit de
    R15 ;
  - **il s'extrait** — le corps monte de 95 % enfoui à 0 en ~1 s, par la **même géométrie que
    l'immersion dans l'eau** (`syncActor` : `setCrop` + décalage en Y). Un corps qui entre dans
    l'eau et un corps qui sort de terre se découpent pareil ; on ne lui apprend pas une
    deuxième règle. L'ombre de contact suit, sans quoi un corps aux trois quarts enfoui
    projetterait l'ombre d'un corps entier.

  **`cendreux_risen` a DEUX émetteurs, et /sim n'a pas bougé.** `advanceCendreux` (un cadavre
  qui se lève — déjà couché SUR le sol, il ne creuse rien) et `advanceReveils`. Le client les
  distingue sur le **site** : `spawnMonster` naît aux coordonnées exactes du réveil, donc un
  `cendreux_risen` dont la tuile a travaillé récemment est une émergence, et tout autre est une
  levée. Un second événement aurait forcé chaque consommateur à connaître deux noms pour un
  fait (ce que `morts.ts` refuse déjà), et toucher au décompte d'entités de `/sim` pour une
  question de rendu est le plus court chemin vers un flux RNG décalé.
  *La reconnaissance se fait sur l'ÂGE du site, jamais sur sa présence : `advanceReveils`
  retire le réveil de l'état au tick même où il émet l'événement, donc le message qui porte le
  fait ne porte plus le site.*
  **Seul le réveil du sol reçoit ce geste** (décision d'Alexis, 2026-07-31) : la levée d'un
  cadavre garde le sien pour un autre jour.

  **ET ÇA S'ATTEINT** — `debug_reveil`, touche **F6** du mode debug (et bouton du panneau P).
  Sans lui, voir le sol travailler demandait de réunir trois conditions à la fois (acte III,
  la nuit, hors bulle de tout feu — et le jour de saison n'a ni touche ni bouton, il fallait
  la console), puis d'attendre un tirage à la minute à 55 % ; le plafond de l'acte saturant
  après **2 réveils sur une nuit entière**, le geste le plus caractéristique du monstre qui
  donne son nom au jeu était en pratique **inobservable**. La touche plante un VRAI réveil —
  mêmes constantes, même `state.reveils`, même chaîne jusqu'au Cendreux, et un feu à portée
  l'étouffe toujours : la parade se teste par ce chemin aussi. Elle ne court-circuite que le
  TIRAGE de `advanceNightHunt`. **Aucun tirage consommé** (le `tirage` de placement vient du
  tick) : appuyer sur une touche de dev ne déplace pas le flux seedé du monde.
- **R20 — Les charniers sont les PICS du champ.** Là où la densité culmine, on pose un lieu
  VISIBLE — qu'on apprend, qu'on évite, qu'on brûle de jour. Le champ garantit que la nuit n'est
  jamais vide où qu'on soit ; les charniers donnent au danger une adresse qu'on peut lire avant
  la nuit. *Ils suivent le précédent de `placeHuntingGrounds` : fonction pure de `(map, seed)`,
  calculée à la génération.* **[RÉVISÉ 2026-08-21 : LIVRÉ, et plus encore]** — les charniers
  sont posés par `placeCharniers` (semis de Poisson propre, `MORTS.CHARNIER_ESPACEMENT`,
  quota par zone) ; et depuis la décision ⑧ ils s'ASSAINISSENT : un feu libre allumé de JOUR
  dans leur empreinte les marque *brûlés* (`state.lieuxBrules`, `charnier_brule`) — la densité
  du champ tombe autour (`MORTS.BRULE`) pour un temps. La pression devient négociable : le
  joueur choisit quel secteur il purge, et le paie en bois, en trajet et en jour perdu.

### 6. La horde naissait dans la falaise (bug)

- **R12 — [RÉVISÉ 2026-08-21, décisions ⑫⑬⑱] Une horde SE DÉCIDE À L'AUBE, naît du sol le
  plus mort, et vise le feu le plus PROCHE.** Le présage (`state.presage`, `presage_horde`)
  se tire à l'aube pour le crépuscule à venir — les signes tombent un jour d'avance (bandeau
  directionnel, faune qui déserte l'origine). L'origine s'élit PAR LA DENSITÉ DES MORTS
  (poids densité³) sur les anneaux de bande des feux allumés ; la cible est le feu le plus
  proche de l'origine — **village OU simple feu de camp : « pas de village = jamais assiégé »
  est mort**. Et l'aube suivante ne dissipe plus : elle FIGE (reliques `hordeRelic`,
  `expiresAt`, reprises hors regard — décision ⑮). L'exigence historique demeure :* Le point d'entrée se cherchait sur
  un bord de carte en 40 essais, **sans garde en cas d'échec** : `ex, ey` gardaient le dernier
  essai, bloqué ou non. Or la vallée est ceinte de roche — MESURÉ : **zéro tuile de bord
  marchable**, sur les quatre bords et pour les trois villages. Chaque horde naissait donc
  DANS le mur, hors du champ de flux, et `hordeStep` concluait « coincé hors champ ».
  Résultat sur une saison : **0 arrivée sur 3**, et **1 à 3 tuiles parcourues** — la
  méga-horde du Grand Froid, le climax, a bougé de **3 tuiles** là où un Cendreux en couvre
  1 400 par nuit. On tire désormais le point d'entrée du **champ de flux lui-même**, qui sait
  quelles tuiles mènent au Feu, dans la couronne qu'une horde franchit en une demi-nuit
  (`HORDE_APPROACH_FRACTION`) — l'autre moitié est le temps du siège.

### 7. La fuite des gardes de convoi (bug)

- **R13 — Une bête d'événement part avec son événement.** `spawnConvoy` posait
  `CONVOY_GUARDS` (2) gardes tous les `CONVOY_PERIOD_DAYS` (2) jours de saison, et **rien ne
  les retirait jamais** — ni dissipation d'ambiant, ni décantation avec la carcasse, qui
  disparaît pourtant en `CONVOY_DECAY_TICKS`. MESURÉ : la vallée passait de 5 à **39 Cendreux
  au jour 36**, puis **75** en fin de saison, par ce seul canal. Le bug était antérieur (les
  gardes étaient des zombies, tout aussi éternels) mais il **portait** depuis R1 : un zombie
  errait, un Cendreux converge sur les feux la nuit et frappe les murs.
  Les gardes reçoivent donc `Monster.expiresAt`, calé sur la décantation de la carcasse
  qu'ils veillent. Le retrait n'a **jamais lieu sous les yeux de quelqu'un**
  (`DEN_SPAWN_CLEARANCE`) : une bête qui s'évapore devant vous, c'est le décor qui avoue —
  la règle exacte que `advanceDens` applique déjà au sens inverse.

### 8. Ce qu'on ne touche pas

- **R10 — Le Cendreux reste un glass cannon LENT.** 20 PV (deux coups d'arme basique), 34 dégâts
  (trois coups tuent un avatar), 1,3 tuile/s (le joueur en fait 4). Ce n'est pas un elite mal
  calibré : c'est une unité de **horde**, et ce profil est celui qui marche — on la découpe
  vite, elle ne rattrape personne, et se laisser encercler tue. Le danger est la **densité**,
  purement émergent. *Les nombres restent des ordres de grandeur, calibrés en playtest.*

### 9. Les sens honnêtes — la vue qui se trompe, le sol qui porte **[2026-08-21]**

*Chantier acté par Alexis le 2026-08-21 (« fidélité Project Zomboid, sans dénaturer ») : le
Cendreux gagne des SENS au lieu d'un rayon nu. Peau diégétique tranchée en QCM : **la
VIBRATION DU SOL** — les morts du sol n'entendent pas, ils SENTENT ce qui ébranle le sol.
Jusqu'ici, la furtivité du joueur (`chasse.md` C2-C5) n'existait que pour le gibier et les
loups : s'accroupir ne servait à rien contre un mort, sprinter au milieu des dormeurs ne
coûtait rien, marteler une palissade à six tuiles d'une carcasse ne la réveillait pas.*

- **R24 — LA VUE EST HONNÊTE : l'allure, le couvert et la pluie comptent, enfin.** La détection
  d'une proie (`nearestPrey` du Cendreux) se multiplie par le STIMULUS que la proie offre — le
  même vocabulaire que la chasse lit depuis toujours, entré UNE fois (le patron
  d'`avatarThreat`) : le max de deux canaux.
  - **Le canal VUE** : visibilité de l'allure (`VIS_STILL` 0,25 → `VIS_SPRINT` 1,4) × couvert
    effectif de la tuile × « bander se voit » (`DRAW_VISIBILITY`, T7 — un mort a des yeux)
    × **la météo** (`meteoVisionFactor` au point de la proie, `meteo.md` R7 — la pluie voile
    des yeux).
  - **Le canal VIBRATION** : bruit d'allure (`NOISE_STILL` 0,25 → `NOISE_SPRINT` 1,6, portage
    lourd plancher à la marche — C2 vaut pour les morts aussi) × litière du sol
    (`bruitDuSol`) × `SENS.VIBRATION`. **Ni couvert, ni météo** : la végétation cache des
    YEUX et le brouillard les voile, mais ni l'une ni l'autre n'étouffent le sol — au cœur des
    feuillus la litière vous porte, et dans le brouillard un sprint se sent à la même distance
    qu'au clair.
  Le marcheur à découvert garde ses 5 tuiles (stimulus 1 : statu quo au bit près) ; l'accroupi
  tombe vers 2-3 ; le sprinteur porte AU-DELÀ de la vue nominale (5 × 1,6 = 8 tuiles à plein
  éveil — pire cas : la litière profonde, × 1,5, soit 12). **La chaleur, elle, ne se cache
  pas** : `nearestWarmth` reste un rayon nu — au cœur du froid votre propre chaleur vous
  trahit à 20 tuiles. La furtivité est un verbe de jour et de tiède ; la nuit profonde
  d'acte III reste la leur (T12-T13 : la nuit chasse et elle a une parade — ils approchent,
  mais le VERROU des yeux reste négociable).
- **R24bis — LE CONTACT EST UN PLANCHER ABSOLU** (`SENS.CONTACT`). Quiconque à une tuile d'un
  Cendreux est détecté, quels que soient l'allure, le couvert ET la météo : marcher SUR une
  carcasse la réveille TOUJOURS. C'est l'ancienne garantie `VUE_PLANCHER`, désormais tenue
  aussi sous la pluie — elle ne l'était pas (le facteur météo la trouait : 0,85 tuile sous la
  pluie, 0,5 sous le brouillard). Le nettoyage au matin (décision ⑮) reste un geste risqué,
  jamais gratuit.
- **R25 — LES IMPACTS ÉBRANLENT LE SOL, et le sol porte jusqu'aux morts.** Un coup qui PORTE
  secoue le sol (`secouerLeSol`, module feuille `sens.ts`) : tout Cendreux HORS HORDE dans
  `portée × éveil` prend le **lieu du geste** pour **dernier lieu vu** (`lastSeenX/Y`,
  décision ⑨ — il ira VÉRIFIER, n'y trouvera rien, reprendra sa marche ; aucun état neuf,
  aucun tirage). Le lieu du geste : le **nœud** frappé pour la récolte, la **tuile** posée pour
  le chantier, la **position du frappeur** pour la mêlée (une zone peut toucher plusieurs
  corps ; le pied qui se plante n'en a qu'une — l'écart tient dans la portée de l'arme).
  - **Ce qui porte** : la mêlée qui TOUCHE (un corps ou une structure — les raiders qui
    défoncent un grenier ameutent les morts), le coup de récolte sur un nœud À OUTIL (hache,
    pioche — `def.tool` non nul : c'est l'affinité du nœud qui compte, un coup à mains nues
    sur un arbre ébranle aussi), la pose d'une pièce (`build`, `place_component`). Portées de
    départ : `SENS.COUP` 8, `SENS.BATIR` 12.
  - **Ce qui ne porte PAS, et c'est la peau du sens** : la corde d'arc (`DRAW_NOISE` reste un
    truc d'oreilles — T7 intact, le tir long reste propre), la flèche qui se plante (trop
    légère), le coup dans le vide (pas d'impact), la cueillette à la main (`tool: null`),
    l'allumage d'un feu et la pose d'un feu de camp (pas un choc — et le feu attire déjà par
    la chaleur : pas de double peine). **Jamais un monstre n'émet** (décision ⑤ : pas d'alerte
    goule→goule, même par le sol — le loup non plus, une bête n'est pas un marteau).
  - **Silences NON tranchés** (hors liste, à décider si le besoin se présente) : réparer,
    démolir, monter une pièce d'un palier, et la croissance PNJ (`village-growth.ts`, qui pose
    par `addStructure` direct) n'ébranlent rien aujourd'hui.
  - **L'éveil module la portée** : de jour au chaud (éveil ≈ 0), le village martèle sans
    réveiller personne ; la rampe de saison rend le monde de plus en plus à l'écoute,
    gratuitement (le patron du cadran ②). Un membre de horde n'écoute pas : il a déjà son Feu
    (R5 — pas d'A\* par bête).

## Constantes (`balance.ts`, bloc `CENDREUX`)

| Constante | Départ | Rôle |
|---|---|---|
| `WITNESS_RADIUS` | 8 | « seul » : aucun allié vivant dans ce rayon à la mort |
| `HEARTH_WARD_RADIUS` | 12 | le ward : la couronne s'y REPOUSSE (⑦), la veillée du cadavre y annule (R9) |
| `RISE_DELAY` | `ticksFor(300)` | délai mort→levée ; le cadavre marqué ne décante pas |
| `WARMTH_SEEK_RANGE` | 20 | rayon d'A\* PRÉCIS d'un solitaire ; au-delà, le champ des feux (①) |
| `TORPEUR` (CHAUD 60, FROID 10…) | — | **[2026-08-21]** le cadran : éveil, allure, vue, `CONVERGE_SOUS` 65, `FUREUR` 12 |
| `CONVERGE_TILES` | [20, 80, 10000] | portée de la longue marche par acte (①) |
| `BOIRE` (CONTACT, CONSO, COUP_TEMP…) | — | **[2026-08-21]** ils boivent la chaleur (⑯⑰) — plancher : jamais les braises, Foyer ≥ 1 |
| `CRI` (COOLDOWN 30 s, PLAFOND_FIN 6) | — | **[2026-08-21]** la fureur appelle le sol, en salve, plafond en rampe (④⑤⑥) |
| `GLOBAL` (12 → 60) | — | **[2026-08-21]** le plafond global de PRESSION, en rampe de saison (⑳, hypothèse) |
| `SENS` (VIBRATION 1, CONTACT 1, COUP 8, BATIR 12) | — | **[2026-08-21]** les sens honnêtes : stimulus de chasse, plancher de contact, secousses (R24-R25) |
| **`MAX_ALIVE`** | **24** | **plafond de Cendreux LEVÉS vivants — la borne INTERNE de la contagion (R8)** |

## Critères d'acceptation (`cendreux.test.ts`, headless)

- **A1 — Un seul mort-vivant.** `MonsterType` ne porte plus `'zombie'` ; aucun site du jeu n'en
  fait naître. Le compilateur en est témoin (union exhaustive).
- **A2 — La horde est faite de Cendreux.** Horde nocturne et méga-horde font naître des
  `cendreux` ; leur nombre par acte est inchangé.
- **A3 — Le siège, en horde.** Un mur entre la horde et le Feu ciblé se fait frapper, casse, et
  la horde passe. *(Non-régression : c'était vrai des zombies.)*
- **A4 — Le siège, seul.** Un Cendreux dont la proie est enclose frappe l'enceinte au lieu de
  rester planté. **Mesure de référence : 0 mur touché avant, sur 4 000 ticks.**
- **A5 — Le feu n'efface plus l'homme.** Joueur assis derrière un feu allumé, Cendreux venu de
  l'autre côté : il mord. **Mesure de référence : 0 dégât avant, 2 584 après.**
- **A6 — Toute mort se relève.** Une mort par arme, seule et loin d'un feu, marque le cadavre
  (avant : seul `cold` le faisait).
- **A7 — La contagion.** Un PNJ tué par un Cendreux, seul et loin d'un feu, se relève à son tour.
- **A8 — Le plafond.** À `MAX_ALIVE` Cendreux **levés** vivants, une mort qui remplit tous les
  critères ne marque plus rien ; en abattre un rouvre la porte.
- **A8bis — …et lui seul.** Repaires, hordes et convois ne consomment pas le plafond, même
  au-delà de `MAX_ALIVE`.
- **A11 — Le sac ne suit que le levé.** Un Cendreux de horde ou de convoi naît **sans case**
  (`MONSTER_DEFS.cendreux.sac` = 0) ; seul celui qui hérite d'un cadavre reçoit ses 40 cases,
  demandées à la levée. Sinon 12 à 16 inventaires vides partaient dans chaque snapshot, vingt
  fois par seconde — la régression exacte que la note de `spawnMonster` documente.
- **A13 — Le basculement.** Sur des nuits entières jouées à l'acte I, II puis III : acte I
  **que des loups**, acte III **que des Cendreux**, acte II les deux. **Mesuré sur 8 nuits par
  acte, PROIE MAINTENUE EN VIE : 22 hurlements / 0 raclements → 29 / 6 → 0 / 16.**

  **Le montage a été corrigé le 2026-07-31, et l'ancien étalon (19/0 → 18/10 → 0/38) est CADUC.**
  Le banc laissait sa proie mourir — or une proie morte **n'est plus une proie** (`preys()` filtre
  `hp > 0`) : il mesurait une nuit éteinte, et chaque mort semait un cadavre qui se levait (jusqu'à
  **119 levés** une fois R23 posée). On la maintient désormais en vie, comme le fait déjà
  `tools/recensement-cendreux.mts` pour la même raison.

  **Et la MESURE DE LA MONTÉE a changé de grandeur avec lui.** L'assertion opposait les
  *raclements* d'acte III aux *hurlements* d'acte I — deux événements que deux espèces n'émettent
  pas au même rythme, donc un rapport qui ne dit rien ; il ne passait (38 > 19) que grâce à la
  fontaine à cadavres. Le test compare maintenant ce qui se compare : **les chasseurs envoyés,
  10 → 11 → 16**. ⚠ **CHIFFRE DE CALIBRAGE OUVERT (Alexis)** : c'est **×1,6**, quand le taux par
  minute, lui, **quadruple** (0,12 → 0,55) — le plafond de l'acte mangeait la différence.
  **[SOLDÉ le 2026-08-21, décision ⑥ : le plafond des morts MONTE EN CONTINU
  (round(1 + 4 × jour/60), `UNDEAD_MAX_FIN`) — la table de trois valeurs est morte, et le cri
  de fureur ajoute son propre canal en rampe par-dessus.]** C'est le défaut que `saison-sans-fin.md` nomme (« une table de trois valeurs, et une
  table est plate »), ici chiffré sur la nuit, qui est pourtant le canal censé porter la tension
  (R11). Voir `docs/mesure-contagion.md` §7.
- **A14 — Deux signes.** Un rôdeur mort émet `cendreux_prowl`, jamais `wolf_howl`.
- **A16 — Les gardes partent avec leur carcasse.** À l'heure dite, un témoin sur place les
  garde en vie ; personne alentour, ils s'en vont — **et leurs entités avec** (aucune orpheline).
- **A15 — La horde marche.** Une horde naît sur une tuile dont le champ de flux du Feu visé
  donne une distance finie, et elle réduit cette distance. **Mesure de référence : 0 arrivée
  sur 3, 1 à 3 tuiles parcourues.**
- **A12 — La horde coule, elle ne calcule pas.** Un membre de horde ne cherche pas la chaleur :
  `nearestWarmth` lui trouvait un vivant jusqu'à 20 tuiles — or une horde marche sur un village,
  donc sur des PNJ — et chacun de ses 12 à 16 membres posait son propre A\* à 2 Hz au lieu du
  champ de flux partagé. Ses yeux restent : ce qui passe à `aggroRange` se fait mordre.
- **A17 — Le champ a un plancher.** `densiteDesMorts` ne rend jamais zéro, nulle part. C'est la
  garde structurelle de R16 : un champ qui peut rendre 0 est un interrupteur déguisé.
- **A18 — …et du relief.** Marges > ceinture > pré du village, d'un facteur ≥ 2 ; borné à 1.
- **A19 — Une carte sans zones vaut son plancher, uniformément.** Un banc headless garde son
  comportement (R17). **Vérifié : les 928 tests de `/sim` passent sans re-calibrage.**
- **A20 — Le champ module le NOMBRE, il ne le supprime pas.** `rodeursPortes` reste ≥ 1 et
  ≤ le plafond de l'acte… **A20bis** — sauf quand l'acte l'a mis à zéro : l'acte I n'envoie
  pas de morts, et le plancher du champ ne doit pas ressusciter ce que `UNDEAD_SHARE` éteint.
- **A21 — C'est une couronne, pas quatre diagonales.** Les 8 secteurs sont touchés et la
  distance tient dans `SPAWN_DIST ± SPAWN_RING`. **Mesuré sur la carte de production : 21,2
  tuiles fixes sur 4 diagonales → 12,0-18,0 tuiles sur tout le tour.**
- **A22 — Le sol porte et il mène à la proie.** Aucune naissance dans la roche, aucune sans
  chemin ; et quand rien ne convient, on REFUSE au lieu de poser dans le mur (le bug exact de
  R12). **Mesuré sur 1 600 réveils autour d'un joueur en dérive : 18,2 % de naissances perdues
  → 0,0 %.**
- **A22ter — Une enceinte ne disqualifie rien.** Une proie ceinte de murs reçoit quand même un
  site de réveil, et le Cendreux ira frapper à la porte (R19bis, A4). **Coût borné : 1 593 ms →
  33 ms dans le pire cas, 0,61 ms en cas normal.**
- **A23 — Un seul tirage, et il est PASSÉ, pas pris.** `siteDansLaCouronne` ne touche pas
  `state.rngState` ; même tirage → même site.
- **A24 — La pondération n'est pas décorative.** Sur une carte mi-t2 mi-t0, les réveils
  penchent d'au moins 1,5 contre 1 vers le pire sol — et le meilleur sol en produit quand même
  (le plancher, vu depuis le placement).
- **A25 — La nuit plante un réveil, et il mûrit.** Le sol travaille (`state.reveils` non vide),
  puis rend un Cendreux qui porte les trois marques du rôdeur (`ambient`, `nightHunter`,
  `huntTargetId`) — un réveil qui les perdrait ferait un mort errant, pas un chasseur.
- **A26 — Il naît PRÈS.** Le site tient dans `SPAWN_DIST_UNDEAD ± SPAWN_RING_UNDEAD`, et cette
  distance est strictement inférieure à celle du loup (R22).
- **A27 — [RÉVISÉ 2026-08-21, décision ⑦ : LE FEU REPOUSSE, IL N'ANNULE PLUS.]** L'ancienne
  assertion (« le feu étouffe, rien n'en sort ») est renversée SCIEMMENT : un feu activé
  pendant que le sol travaille fait s'effondrer le tertre ICI (`reveil_etouffe`, même geste à
  l'écran) et le réveil REPREND hors de la bulle, timer remis à neuf ; à la plantation, la
  couronne écarte les tuiles sous ward et se REPOUSSE au bord de la bulle si tout est couvert.
  Le feu achète de la DISTANCE et du TEMPS — chaque bulle se paie en bois — jamais l'immunité
  (c'est aussi la ligne de la bible diégétique : le Feu OCCUPE, il n'a aucune vertu propre).
  La veillée du CADAVRE (R9/S4), elle, n'a pas bougé d'un iota.
- **A28 — Le réveil ne consomme aucun tirage.** `advanceReveils` laisse `state.rngState`
  intact : allumer un feu est une décision de joueur, elle ne doit pas déplacer le monde.
- **A29 — Un cadavre qui se lève ne creuse pas** (R21bis). Un `cendreux_risen` dont le site n'a
  jamais travaillé ne déclenche **aucune** extraction — et il ne doit pas non plus voler celle
  d'un réveil en cours ailleurs. C'est la garde centrale du rendu : la confondre ferait creuser
  un cadavre, et ça ne se remarquerait qu'en tombant sur la seule levée de la saison.
- **A30 — Le site survit à sa disparition du snapshot** (R21bis). Le message qui porte
  `cendreux_risen` ne porte plus le réveil : une reconnaissance par PRÉSENCE n'aurait jamais
  rien reconnu, et rien n'aurait cassé — l'animation serait simplement restée muette. Vérifié
  sur le vrai flux, snapshot par snapshot à 20 Hz.
- **A31 — Le tertre POUSSE, il ne pulse pas.** L'échelle monte en continu sur **toute** la
  rampe, bornes exactes, et ne redescend jamais — malgré le recalage de chaque snapshot sur
  l'horloge du rendu. Rapportée au cran, elle serait repartie à zéro quatre fois en quatre
  secondes. Et un cran ne cède qu'**une** fois, quel que soit le nombre d'images : la terre
  reprojetée à chaque frame noierait le tertre sous sa propre gerbe.
- **A32 — Le corps sort par la COUPE, pas par la valeur.** La découpe réelle du sprite va de
  ~0,95 à 0 sur l'extraction, et l'ombre de contact suit — une rampe juste qui n'atteindrait
  pas le sprite ne se verrait pas davantage. **Constaté à l'écran** (`smoke --scenario reveil
  --dev`, jour 50, 1 h) : coupe **0,945 → 0,491 → 0**, ombre **0,023 → 0,214 → 0,42**, et les
  quatre crans du tertre à **0,526 → 0,592 → 0,729 → 0,867**.
- **A33 — Ce qui sort du trou est de la TERRE, teintée par ce qu'il y a dessus.** Sur **tous**
  les terrains où l'on peut creuser, le tas se détache de sa surface — et **jamais en vert**,
  sur aucun d'eux : c'est le défaut constaté à l'écran quand la couleur était simplement le
  terrain assombri (le tertre se lisait comme un buisson de plus). La part de la surface vient
  des familles de sol de `grain-sol`, déjà exhaustives : sous la neige il y a de la neige,
  sous l'herbe il y a de la terre. Aucune table de couleurs de plus.
- **A34 — Le levé survit à son meurtrier** (R23). Dans un tick **COMPLET** (et non
  `advanceCendreux` appelé seul, ce que faisait le reste du fichier à sept endroits contre deux —
  hors du tick aucun wind-up ne se résout, et le banc ne pouvait donc pas produire le phénomène),
  un Cendreux se lève sous le coup en cours de son meurtrier : il en sort **intact**, et
  `risenAlive` vaut 1. **Mesure de référence : 313 levées / 313 abattues avant, 0 après.**
  *(Contre-épreuve jouée : à `hp` 100, le test échoue — il mesure bien « un coup, un mort », pas
  une coïncidence d'ordonnancement.)*
- **A35 — L'alliance est de l'espèce, et elle est étroite** (R23). Même géométrie, deux cibles
  dans le même arc : sous le coup d'un Cendreux le Cendreux est intact **et le vivant encaisse**
  (le coup porte, il n'est pas annulé) ; sous le coup d'un **loup**, le même Cendreux encaisse ;
  et le joueur l'abat à la hache comme avant.
- **A9 — Le rempart tient toujours.** Un feu allumé ou en braises à portée empêche la levée, à la
  mort comme au réveil. (Non-régression S4 — c'est la parade, elle ne doit jamais céder.)
- **A10 — Déterminisme et pureté.** Même seed + mêmes inputs → même flux d'événements ;
  `pnpm lint` vert. La bascule zombie→cendreux **change la consommation du PRNG** (la branche
  zombie tirait un `roll` d'errance que le Cendreux ne tire pas) : le contrat à tenir est la
  reproductibilité, pas la compatibilité avec les seeds d'avant.

*Les sens honnêtes (R24-R25) :*

- **A36 — L'allure se lit** (R24). Même froid, même distance, à découvert : le marcheur est
  acquis, l'accroupi passe. (Portées : marche 5, accroupi ~2,75 — la marge du montage vit
  entre les deux.)
- **A37 — Le sprint porte au-delà de la vue** (R24). À ~7 tuiles d'un Cendreux à plein éveil :
  le sprinteur est acquis (8), le marcheur non (5) — **et dans le brouillard** (vue × 0,5) le
  sprinteur l'est toujours : le sol ne se voile pas.
- **A38 — Le contact ne se négocie pas** (R24bis). Immobile (stimulus 0,25), SOUS LA PLUIE
  (vue × 0,85 — le front est FORCÉ dans le montage, et sa prémisse prouvée), à moins d'une
  tuile d'un Cendreux amorphe : détecté ; à une tuile et demie : non. (Avant ce chantier, la
  pluie trouait la garantie du plancher.)
- **A39 — Le coup d'outil ameute** (R25). Un coup de hache à 6 tuiles d'un Cendreux éveillé
  hors horde lui donne le point d'impact pour dernier lieu vu, et il marche dessus. Le même
  coup près d'un Cendreux AMORPHE (au chaud) ne fait rien — l'éveil module la portée.
- **A40 — La corde ne vibre pas le sol** (R25). Un tir à l'arc résolu (`ranged`) ne plante
  aucun dernier lieu ; la pose d'une pièce (`SENS.BATIR`) en plante un.
- **A41 — La horde n'écoute pas** (R25). Un membre de horde ignore la secousse (il a déjà son
  Feu — R5) ; et une secousse ne consomme AUCUN tirage (`state.rngState` intact, le patron
  A28).

## Hors périmètre

- **Repaires** : **[RÉVISÉ 2026-08-21, décision ⑪ : IL RESPIRE]** — `advanceDens` repeuplait
  déjà un occupant ; le repaire porte désormais un CAP DE SAISON en rampe (1 → `MORTS.RESPIRE`
  résidents au fil des jours), suspendu quand le lieu est brûlé (décision ⑧). La densité des
  repaires sur la carte (9) reste un chantier à part.
- *(corrigé le 2026-07-31 — voir R13.)*
- **Traînage de cadavre** vers un feu ; **Cendreux qui ouvrent une porte** plutôt que la casser.
- **Rendu client** au-delà du réveil du sol. Livré le 2026-07-31 : le tertre qui travaille et
  l'extraction du corps (R21bis). **Pas** livré, et assumé : la **levée d'un cadavre** garde
  son apparition sèche (décision d'Alexis — un corps déjà couché ne creuse pas, et c'est une
  autre animation) ; le Cendreux n'a toujours qu'une silhouette de pion (`spr-cendreux`), sans
  posture ni marche.
