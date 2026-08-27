# L'encyclopédie — un savoir qui se gagne, section par section

*Source : décisions d'Alexis du 2026-08-24 (« plutôt que faire un bestiaire avec les poissons, je
veux qu'on fasse une encyclopédie et la partie poisson n'en sera qu'une section parmi d'autres »,
puis, sur la question du muet : « muet partout »). **Amende `peche.md` R11/B5** : le bestiaire des
prises devient la SECTION *poissons* d'un écran plus large, sans changer sa promesse. Statut :
**IMPLÉMENTÉ le 2026-08-24** — E1-E9 vivent dans `packages/sim/src/encyclopedie.test.ts` (10) et
`packages/client/src/scenes/ui/encyclopedie.test.ts` (15).*

## Objectif de design

L'onglet BESTIAIRE ne portait que les dix-huit prises. Il devient **l'ENCYCLOPÉDIE** : un rail de
sections (ressources, nourriture, outils, armes, poissons, animaux sauvages, monstres, saisons), une
grille par section, et **une fiche au survol par type d'entrée**. Le savoir du joueur sur son monde
tient dans un seul écran, et il se **gagne** — rien n'y est donné.

## Règles

### Le muet (E1-E3)

- **E1 — UNE ENTRÉE JAMAIS RENCONTRÉE NE DIT RIEN.** Ni nom, ni effigie, ni chiffre, ni conditions,
  **et aucune fiche n'est posée dessus** : la case porte un `?`, `???`, `—`. Une fiche vide cachée en
  CSS serait la même fuite à un inspecteur près.
- **E2 — La règle vaut pour TOUTES les sections**, y compris ce qui se fabrique et ce qui se
  traverse. *Conséquence acquise et assumée : le panneau ARTISANAT liste, lui, toutes les recettes
  découvertes — la recette d'une hache d'acier se lit là-bas, et pas ici.*
- **E3 — Ce qui filtre encore, et c'est assumé : la POSITION.** Les rangées nommées (les trois
  classes de prise, les quatre paliers d'outil, le gibier vs ce qui rend les coups) enseignent ce
  qu'une case ne peut pas dire. Une case muette avoue donc sa rangée.

### Le carnet (E4-E6)

- **E4 — Le carnet est un CONSOMMATEUR du flux d'événements**, jamais une instrumentation de la
  logique : `advanceEncyclopedie` lit `state.events` en fin de tick et n'ajoute pas une ligne dans
  la récolte, le craft ou le combat. Cinq verbes — `recolte`, `fabrique`, `mange`, `abat`, `vecu`.
- **E5 — Il ne lit que la tranche du tick.** Le buffer d'événements n'est vidé que par l'HÔTE : un
  appelant qui ne draine pas (un test, un banc, un outil headless) le laisse grossir. On mémorise
  donc la longueur du buffer au début de `step`. *Sans cette borne, cinq flèches en comptaient 610.*
- **E6 — Seuls les joueurs en ont un**, et il **survit à la mort** : c'est une mémoire, pas un bien.
  Les poissons gardent leur carnet à part (`Entity.peche`), qui porte le RECORD en millimètres.

### L'écran (E7-E9)

- **E7 — Tout est DÉRIVÉ des tables de `/sim`** — `NODE_DEFS`, `TOOL_TIERS`, `WEAPON_PROFILES`,
  `MONSTER_DEFS`, `FISH_SPECIES`, `RECIPES`, `COOK_SLOT`/`DRY_SLOT`, `FOOD_VALUES`. Une entrée
  ajoutée à la sim apparaît sans qu'on touche à l'écran, et **le nombre de colonnes est celui de la
  rangée la plus peuplée** (aucun nombre de grille écrit à la main).
- **E7bis — AUCUN OBJET N'EST ORPHELIN PAR ACCIDENT.** Les sections ne couvrent pas l'union
  `ItemId` entière — matières intermédiaires, semences, bâti n'y ont pas leur place. Un test
  balaie donc `ITEM_LABELS` (un `Record<ItemId, string>`, donc l'union tenue par le compilateur)
  et exige que chaque objet soit *dans une section* ou *déclaré hors*, dans les deux sens. Un
  `ItemId` neuf fait rougir jusqu'à ce que quelqu'un tranche.
- **E8 — Aucune phrase.** Une fiche est une table `intitulé → valeur`, plus des jauges là où le
  nombre brut ne veut rien dire (un poids de tirage, une distance d'alerte) et des puces pour ce
  qui change tout (`⚑ coin exclusif`, `⚑ il boit le feu`).
- **E9bis — Ce qui se MANGE est une nourriture, pas une ressource** (Alexis, 2026-08-25 : « les
  baies sont dans ressources ET dans nourriture… retire de ressources »). Même doctrine que E9 :
  une entrée vit dans UNE section, celle qui répond à la question qu'on se pose devant elle —
  d'une baie on veut savoir ce qu'elle rassasie, pas d'où elle sort. La règle est DÉRIVÉE de
  `FOOD_VALUES` (baies et champignons quittent RESSOURCES, qui passe de 14 à 12) : une plante
  comestible ajoutée demain s'en va toute seule, sans liste d'exceptions à tenir.
- **E9 — Le poisson CRU est une prise, pas un plat.** `FOOD_VALUES` porte les dix-huit espèces :
  les laisser en NOURRITURE doublerait toute la section POISSONS (39 entrées au lieu de 21). Le
  cuit et le séché, eux, sont par CLASSE : ce sont des plats, ils restent.

### Ce qu'une fiche a le DROIT de dire (E11-E13, 2026-08-25)

- **E11 — Une fiche répond à « qu'est-ce que j'en fais », jamais à « comment c'est codé ».**
  (Alexis : « il y a trop d'infos techniques dans les tooltips — réduis la taille ET la nature des
  infos ».) Ont disparu de toutes les fiches : les durées en secondes (wind-up, repos, charge,
  ferrage), les cônes en degrés, l'endurance, la taille de pile, le stock par nœud, la durabilité
  chiffrée, le poids de tirage, la fourchette de taille, les portions, les portées en tuiles.
  **Un bloc, quatre lignes au plus** — le filet qui séparait les blocs a disparu avec eux.
- **E11bis — Le mot qui remplace un chiffre se DÉRIVE de sa table.** « solide », « un repas »,
  « farouche », « deux fois plus fort » se calculent par le RANG de la valeur parmi les valeurs
  distinctes que porte sa table (`motParRang`). Une hache d'acier ajoutée demain reclasse les
  autres toute seule ; un seuil écrit en dur aurait fait mentir la fiche au premier calibrage.
- **E12 — Chaque type de case a SA grammaire** (Alexis : « il faudrait que chaque type de tuile
  fournisse les informations différemment »). Une ressource dit *d'où elle sort*, et rien de
  plus (la repousse a été retirée le jour même, sur relecture d'Alexis) ; une nourriture, *ce
  qu'elle rassasie et si elle tient* ; un outil, *ce qu'il ouvre* ;
  une arme, *ce que le coup chargé ajoute* ; un poisson, *où et quand ça mord* ; un prédateur,
  *quand il sort et ce qu'il laisse* ; un gibier, la même chose **plus s'il est farouche** — c'est
  la seule question qu'on se pose d'un gibier et pas d'un loup.
- **E13 — La saison porte le RELEVÉ DU JOUEUR, pas les cardinaux de la table.** Le plus froid et
  le plus chaud qu'il a endurés dans cette saison-là (`froid:`/`chaud:` au carnet, relevés une
  fois par seconde sur `baselineTemperature` — le lieu, NI le feu NI la source chaude : sinon la
  fiche dirait « le plus chaud du Grand Froid : +20 °C » à qui a passé la saison contre son feu).
  La carte et sa fiche disent la même chose, **froid à gauche, chaud à droite**. Jamais traversée,
  jamais relevée : la case reste muette (E1).

### Le déverrouillage de relecture (E10, DEV seulement)

- **E10 — Un interrupteur ouvre TOUT le livre, en DEV, sans toucher au carnet.** Relire les
  fiches — les corriger, les calibrer — demandait autrement d'avoir joué la saison qui les
  débloque. Un interrupteur « TOUT RÉVÉLER », au pied du rail, **substitue** un carnet complet
  (`carnetComplet()`, qui MIROITE les énumérateurs de l'écran) à celui de l'avatar. C'est une
  substitution et non une dérogation : aucune fabrique de case ne connaît le levier, il n'existe
  donc toujours qu'une seule façon pour une case de parler, et E1-E3 restent gardés à
  l'identique. Le carnet du snapshot n'est pas écrit : on éteint, l'écran redit exactement ce que
  ce joueur a rencontré. `import.meta.env.DEV` l'élimine du bundle de production ; l'état est
  gardé en `localStorage` (`braises.dev.encyclo-tout`) parce qu'une séance de relecture recharge
  la page. *(Un déverrouillage PARTIEL serait silencieux : la garde est `su === tot` sur chaque
  entrée du rail, pas un coup d'œil.)*

## Critères d'acceptation

| # | Critère | Où |
|---|---|---|
| A1 | Carnet vide ⇒ **aucune** case ne porte d'id, de nom, d'effigie, de chiffre ni de fiche | client, `le muet` |
| A2 | Balayage EXHAUSTIF : aucun mot du domaine (libellés d'objets, espèces, bêtes, saisons, terrains) ne survit dans une case muette | client, `le muet` |
| A3 | La sonde sait voir : une entrée rencontrée porte bien son nom | client, `le muet` |
| A4 | Atteignabilité : un carnet omniscient ne laisse **aucune** entrée muette | client, `l'atteignabilité` |
| A5 | Couverture : chaque espèce, bête, ressource, outil et arme des tables a sa case | client, `la couverture` |
| A6 | Tout habitat cité a un nom français (jamais un slug anglais à l'écran) | client, `la couverture` |
| A7 | Le carnet se remplit par le GESTE : récolter, fabriquer (×5 pour une recette qui en rend cinq), manger, abattre | sim |
| A8 | Abattre n'écrit QUE chez le tueur — voir mourir n'apprend rien | sim |
| A9 | La saison en cours se compte une fois par tour, pas par tick ; un PNJ n'a pas de carnet ; le carnet survit à la mort ; même graine ⇒ même carnet | sim |
| A10 | Une bascule de saison JOUÉE tick par tick ouvre la saison ; un second tour la compte ×2 (garde de `entre` : la neutraliser rend le test rouge) | sim |
| A11 | Aucun objet orphelin : tout `ItemId` a une section ou est déclaré hors — dans les deux sens | client, `la couverture` |
| A12 | `carnetComplet()` ⇒ `su === tot` sur **chaque** entrée du rail, chaque case porte id/nom/effigie/fiche et un chiffre (jamais `—`), les quatre saisons sont vécues | client, `le déverrouillage de relecture (DEV)` |
| A14 | Aucune fiche ne passe UN bloc ni QUATRE lignes — balayage de toutes les sections + saisons | client, `des mots, pas des nombres de moteur` |
| A15 | Aucun mot de moteur ne survit (wind-up, endurance, cône, stock, pile, ferrage, portions, durabilité, usure, péremption, tuiles, station), ni aucune durée en secondes ou en ticks | client, idem |
| A16 | Une saison vécue SANS relevé se tait sur la température ; avec relevé, la carte et la fiche lisent le carnet — froid à gauche, chaud à droite | client, idem |
| A17 | Le froid et le chaud endurés se relèvent seuls, ce sont des EXTRÊMES (ils encadrent tout le cycle), et un relevé seul ne rend rien « connu » | sim, `le carnet de l'encyclopédie` |
| A13 | Le levier n'écrit rien : un carnet vide se tait toujours autant après son usage ; en jeu, éteint, le rail retrouve ses comptes d'avant | client + `smoke --scenario encyclopedie-tout --dev` |
