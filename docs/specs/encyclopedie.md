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
  nombre brut ne veut rien dire (une fenêtre de ferrage en ticks, un poids de tirage, des dégâts)
  et des puces pour ce qui change tout (`⚑ coin exclusif`, `⚑ il boit le feu`).
- **E9 — Le poisson CRU est une prise, pas un plat.** `FOOD_VALUES` porte les dix-huit espèces :
  les laisser en NOURRITURE doublerait toute la section POISSONS (39 entrées au lieu de 21). Le
  cuit et le séché, eux, sont par CLASSE : ce sont des plats, ils restent.

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
