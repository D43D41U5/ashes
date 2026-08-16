# Forêts vivantes — la litière, l'envol, les coulées, la lumière

*Spec du 2026-08-16. Décision d'Alexis (« propose 5 choses pour améliorer les forêts » →
panel de 5 lentilles, 10 propositions vérifiées contre le code → « fais tout de manière
professionnelle ») : les CINQ retenues s'implémentent. Écartée et non rouverte : le jardin
de clairière (il rouvrirait la décision du 2026-07-18 « les clairières restent nues » —
décision d'Alexis à part si un jour). Ce chantier s'appuie partout sur la PROFONDEUR
intra-massif (`t0-exploration.md` §2quater) : la lisière, le corps et le cœur existent —
chaque feature en est un lecteur de plus, jamais une géographie parallèle.*

**Les invariants s'appliquent en entier** : /sim pur et déterministe (passes appendues,
hash positionnel salé — jamais un tirage sur le PRNG partagé), carte immuable au runtime,
« le monde n'est pas décoré, il est construit » (tout objet apparent est un vrai nœud), la
géographie module et n'autorise jamais, feel en pente continue, FX quantifiés pixel-art.

---

## §1 — LES TAS DE FEUILLES : la fouille du sous-bois (les VERS, premier appât dédié)

- **R1** — Des nœuds `leaf_pile` naissent sous les FEUILLUS (forêt, futaie ancienne,
  saulaie — jamais pin/mélèze : le sec ne fait pas de litière), dans la bande du CORPS
  (`PROF_LISIERE < d < PROF_COEUR`) — la seule bande sans objet propre : la lisière a ses
  baies ('LISI'), le cœur ses champignons ('COEU'), le corps gagne sa fouille ('FEUI').
  Passe appendue EN QUEUE de `placeZoneNodes`, tirage positionnel salé `'FEUI'`
  (0x46455549), chance `CONTENU.TAS_FEUILLES` par tuile libre — patron 'FIBR'.
- **R2** — Le tas se FOUILLE à mains nues (`skill: foraging`, `tool: null`, `renewable` —
  les feuilles retombent) et donne l'item **`worms`** (les vers) : le premier appât qui
  n'est PAS de la nourriture. `worms` entre dans `BAIT_ITEMS` (le gibier vient le manger au
  sol) mais ne se mange pas (nutrition 0 — le chasseur ne grignote pas ses vers) et périt
  vite (un appât se pose frais). Aujourd'hui appâter coûte des baies (6 pts de faim
  pièce) : la boucle d'affût cesse de se payer en nourriture.
- **A1** — Sur les seeds de garde : des `leaf_pile` existent ; TOUS sont sur terrain
  feuillu ET dans la bande du corps ; aucun sur sente/rampe ; le flux des nœuds d'avant est
  un préfixe intact (passe en queue). `worms` s'obtient en fouillant (test de récolte) et
  un gibier vient à une pile de `worms` posée (test d'appât, patron des baies).

## §2 — LA LITIÈRE QUI CRAQUE : le bruit du sol

- **R3** — Le sol des FEUILLUS porte le pas : le BRUIT d'une allure se multiplie par
  `bruitDuSol(state, x, y)` — 1 partout, et sur terrain feuillu une PENTE CONTINUE de
  `LITIERE_BRUIT_LISIERE` (1 en lisière) vers `LITIERE_BRUIT_COEUR` (max au plafond de
  profondeur) : s'enfoncer cache mieux (`COVER_COEUR` existant) mais s'entend mieux — et le
  bruit est OMNIDIRECTIONNEL : ni le fourré ni le dos tourné ne le masquent (contrairement
  à la vue). L'arbitrage spatial est le cœur de la règle : suivre la bête blessée jusqu'à
  sa couche au cœur la LÈVE — on attend près du sang, on approche par une clairière ou une
  sente, ou on paie.
- **R3bis** — UN SEUL canal : la modulation s'applique au POINT DE LECTURE du bruit
  (`avatarThreat`), jamais en doublon dans les consommateurs d'aval — le patron
  `couvertEffectif`. Sans champ de profondeur (banc, carte d'avant) : facteur 1, inerte au
  bit près.
- **A2** — Unitaire : pour un même terrain feuillu, `bruitDuSol` croît strictement de la
  lisière au cœur, vaut 1 hors feuillu et sans champ ; en jeu (headless) : la même
  approche au même gait est détectée de PLUS LOIN au cœur qu'en lisière (mesure au patron
  des distances de levée de `chasse.md`).

## §3 — L'ENVOL DE LA LISIÈRE : la forêt répond au bruit

- **R4** — Franchir une tuile de LISIÈRE (`estLisiere(d)`) à allure bruyante
  (`bruit effectif ≥ ENVOL_SEUIL`) fait gicler une nuée d'oiseaux : un événement de domaine
  **`bird_flush`** (émis par la sim au moment du fait — jamais instrumenté après coup),
  avec position. Le gibier dans `ENVOL_ALARME_RAYON` prend un coup de méfiance
  (`suspicion += ENVOL_SUSPICION`, plafonné comme le reste) : la forêt prévient AVANT que
  la bête entende — le sneak devient utile dès l'orée, et en LAN l'envol d'un autre joueur
  le trahit à travers le pré.
- **R4bis** — Les perchoirs se REPOSENT : un envol par zone de `ENVOL_COOLDOWN_RAYON`
  tuiles tous les `ENVOL_COOLDOWN_TICKS` ticks — l'état (`state.envols`, liste bornée
  `{x, y, tick}` JSON-sérialisable, purgée) empêche la mitraille. Le client rend l'envol
  depuis l'ÉVÉNEMENT (la texture `fx-bird` existe, l'en-tête d'`ambient-life` réservait
  cette évolution mot pour mot) : nuée au-dessus des houppiers + cri — vue et entendue à
  plusieurs écrans, mais JAMAIS une information que la sim n'a pas émise.
- **A3** — Headless : marcher (walk) sur une lisière émet `bird_flush` ; sneak n'émet PAS ;
  deux passages au même endroit dans le cooldown n'émettent qu'une fois ; la méfiance du
  gibier proche monte ; replay : même seed + mêmes inputs = même flux d'événements
  (`events.test` couvre par construction).

## §4 — LES COULÉES : les petits chemins de terre du gibier

- **R5** — Chaque massif boisé de la Racine dont le CŒUR est à portée d'eau porte UNE
  coulée : le chemin de terre du gibier entre sa couche (le pic d'érosion — le patron de la
  couronne) et l'eau la plus proche. Les bois secs de crête n'en ont AUCUNE — pas d'eau,
  pas de gibier, pas de chemin : la grammaire humide/giboyeux vs sec/silencieux gagne un
  lecteur au sol. Tracé au moindre coût sur l'altitude du socle (le patron des sentes —
  fond de vallon, jamais la ligne droite), quantifié, borné, départages stables.
- **R5bis** — La coulée est un CHAMP ADDITIF (`map.coulees: number[]`, patron `map.fil` —
  chemins séparés par -1, et la liste dit le chemin ENTIER, sentes comprises : c'est le
  DÉCAL qui s'interrompt sur la route, jamais le fait),
  JAMAIS une repeinture de terrain : une ligne non boisée percerait l'érosion et tuerait le
  cœur qui l'a fait naître (A19 de §2quater est la garde). Elle s'enregistre dans les
  champs de `carte-immuable` (statique, gelée). Conséquences de jeu : ① couloir SANS
  nœuds — le prédicat de stérilité (rampe) devient un helper PARTAGÉ (`tuileSterile`) que
  toutes les passes lisent — une passe future ne peut plus l'oublier ; ② un appât posé
  près d'une coulée porte plus loin (`BAIT_SEEK` majoré — le fait est mémorisé sur la pile
  à la PREMIÈRE lecture, fonction pure de la position : zéro coût par tick, déterministe et
  rejouable) — la géographie module le combien, jamais le si.
- **R5ter** — Le rendu : un décal de terre battue (NEAREST) sur les tuiles de coulée, usure
  en PENTE CONTINUE (plus marquée vers l'eau où les pas convergent — REGARDÉ et renforcé le
  2026-08-16 : 0,6-0,9, l'illisible ment par omission) ; le clutter s'y tait. Racine
  seulement en v1 (le champ de profondeur y vit) — la Sylve suivra avec lui.
- **R5quater** — LA HARDE EMPRUNTE SA COULÉE (décision d'Alexis, 2026-08-16 : « t'as fait
  en sorte que les hardes suivent les coulées ? ») — la trace ne ment plus. Aux heures
  CRÉPUSCULAIRES (aube `COULEE_AUBE_*`, soir `COULEE_SOIR_*`), le gibier dont le coin est à
  ≤ `COULEE_ATTACHE` d'une fin de coulée rejoint le chemin et le DESCEND, pas à pas dans
  l'ordre du tracé, jusqu'à l'eau — où il BOIT `COULEE_BOIRE_TICKS`, TÊTE BAISSÉE
  (`drinkUntil` → la fenêtre `BAIT_ALERTNESS` de l'appât) : l'affût au bout de la coulée à
  l'aube est la leçon que la géographie enseigne. UNE descente par fenêtre ; la priorité de
  la peur est intacte (fuite, sanglier, couché et appât passent avant) ; AUCUN tirage —
  l'attache est une fonction pure du coin et de la carte, mémorisée sur la bête (champs
  JSON optionnels) ; sur une carte sans coulées, la passe est inerte au bit près.
- **A6** — LA DESCENTE SE PROUVE : en headless sur une coulée posée à la main — au
  crépuscule, la bête attachée rejoint le chemin, le parcourt DANS L'ORDRE, atteint la
  dernière tuile et boit (`drinkUntil` posé, tête baissée) ; à midi, rien ; menacée, elle
  fuit (la priorité tient) ; une seule descente par fenêtre ; sans coulées, aucun champ
  n'apparaît sur la bête.
- **A4** — Sur les seeds de garde : ≥ 1 coulée ; chaque coulée relie un cœur (d ≥
  PROF_COEUR − 1 au départ) à une tuile ADJACENTE à l'eau (la liste dit le chemin entier,
  son bout est toujours enregistré) ; toute tuile de chemin est MARCHABLE, dans la Racine,
  jamais de l'eau (une sente peut en être — le décal s'y interrompt) ; aucun nœud sur une
  coulée ; double génération identique champ compris ; `carte-immuable` la hache.

## §5 — LES TACHES DE SOLEIL : la lumière du sous-bois

- **R6** — Le jour, le sol des bois se mouchette de taches de lumière : DENSES en lisière,
  éteintes vers le cœur (pente continue sur d — le canal existant de l'assombrissement,
  renforcé, jamais un second langage), PLEINES dans les clairières (les chambres de lumière
  que A22 protège déjà de l'assombrissement). Recette au patron des brumes : quantifié au
  grain 4 px NEAREST, frémissement au vent par ALPHA (jamais par taille — la leçon des
  halos), nuit = éteint (fenêtre pure sur l'heure, pente continue aux crépuscules).
- **A5** — Ambiance assumée : vérification à l'ŒIL sur capture (lisière mouchetée, cœur
  éteint, clairière pleine, midi vs nuit) + le coût par frame MESURÉ (patron mist-layer —
  un quad/shader, jamais des sprites par tuile).

---

*Réglages : `CONTENU.TAS_FEUILLES` (zone-content) ; `HUNT.LITIERE_BRUIT_COEUR`,
`ENVOL_*` (balance — se règlent en jouant) ; `COULEES` (bloc worldgen à côté du
générateur — se règle en regardant une carte) ; les constantes du FX taches côté client
(patron `CLUTTER_MEAN_SQ`). Ordre de livraison : §1+§2 (la litière), §3 (l'envol), §4
(les coulées), §5 (la lumière) — un commit par étage, revue déterminisme avant fusion.*
