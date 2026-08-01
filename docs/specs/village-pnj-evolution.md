# Villages PNJ — l'évolution du bâti

*Spec extraite de la session du 2026-07-31 (cinq décisions d'Alexis, consignées dans
`docs/decisions.md`). Complète `pnj.md` (R7/R9/R10) et amende `construction.md` (R15).*

Le spawn actuel (`foundNpcVillage`) pose un feu, un coffre et N chips `house` d'une
tuile : le village se lit comme trois images posées dans l'herbe. Ce chantier le
remplace par de **vrais bâtiments assemblés avec les pièces du joueur** (le patron
`poi-batis.ts` : murs d'arêtes, encadrements, mobilier), qui **évoluent** — et c'est
le village qui se les construit.

## Les cinq décisions (Alexis, 2026-07-31)

1. **PNJ bâtisseurs.** Les habitants construisent réellement (tâche `build` au
   tableau du village). Réouverture MINIMALE du chantier IA-village : la tâche et
   son exécuteur, rien d'autre — A7 (« village 100 % PNJ tient 10 jours ») reste en
   pause.
2. **Purement économique.** Aucun seuil de jour : le village monte de palier dès que
   son grenier porte le surplus voulu. Les barres vivent dans `balance.ts` et se
   calibrent au banc.
3. **La prospérité attire.** Nourriture au-dessus d'une barre à l'aube → un habitant
   de plus, plafonné par palier de bâti. Le nombre d'habitants commande le nombre de
   logis.
4. **Stations réelles mais réservées.** Le village évolué gagne de vraies stations
   (établi, four, silo), posées par les mêmes objets que le joueur — accès
   `village`, comme son grenier. L'ouverture aux joueurs bien alignés est post-MVP.
5. **Porte rituelle.** L'enceinte a une vraie porte : ouverte à l'aube, fermée au
   crépuscule. Un visiteur surpris au crépuscule passe la nuit à l'abri — c'est une
   qualité, pas un bug. *(Scopé aux villages PNJ : la décision R26 « une porte ne
   bouge jamais seule » reste entière pour les portes des joueurs.)*

## MESURÉ (sonde du 2026-07-31, banc seed 42, 8 jours)

Sans ce système, les greniers PLAFONNENT — nourriture ~15-22, bois cloué à 24 —
parce que le tableau est à seuils (`VILLAGE_FOOD_TARGET` 12, `VILLAGE_WOOD_TARGET`
20) : les cibles sont atteintes dès J1, puis les PNJ chôment. **Le plafond est la
politique du tableau, pas la capacité des bras.** Le troisième village (zone sans
baies) meurt en 3 jours — avec ce système, il restera figé au palier 1 : le bâti
devient le baromètre lisible de la santé d'un village. Le carburant existe ; ce
chantier ne fait qu'élever les cibles et donner des gestes à l'oisiveté.

**MESURÉ (même sonde, après le premier jet)** : sans garde-fous, le chantier tuait
ses bâtisseurs — bois siphonné à 0 (le Feu à sec pendant que les murs montent),
colons attirés à la simple subsistance, trois villages morts à J5, murs neufs.
D'où les trois planchers de `balance.ts` : `BUILD_FOOD_FLOOR` (on ne bâtit pas le
ventre vide), `BUILD_WOOD_RESERVE` (la part du Feu est intouchable), et
`ATTRACT_FOOD` monté à 30 (la prospérité qui attire est un GRAS, pas un équilibre).

## Modèle

- **`village.buildTier`** (1→3) : le palier de BÂTI. Distinct du palier du Feu
  (`village.tier`, actions joueur) — le palier 3 du Feu exige la chaîne du fer,
  hors de portée d'une IA de corvées. Seuls les villages PNJ (`chiefId === 0`)
  évoluent ; les villages à chef humain ne sont jamais touchés.
- **Le plan directeur** (`village-plan.ts`) : fonction pure de
  (feu, `buildTier`, effectif) → pièces voulues. **Additif** : on ne démolit jamais
  l'existant ; ce qui manque devient tâches. Une pièce sur terrain inconstructible
  ou tuile prise est SAUTÉE (le patron `poi-batis` : on ne bâtit pas dans une
  falaise).
- **Tout se paie au vrai prix**, depuis le grenier, et **toute pose passe par le
  pipeline joueur** (`build` / `place_component` / `upgrade_structure`, marteau en
  main) — spec pnj R1 : l'IA émet des intentions, jamais des résultats.

## Les trois paliers

| Palier | Nom | Contenu ajouté |
|---|---|---|
| 1 | le campement | Feu, grenier, 1 **paillasse** par habitant (aux emplacements des futurs logis). Plus aucune `house` — et **pas de mobilier** : MESURÉ (seed 15), un tonneau et une étagère près du grenier font couverture et retournent le combat calibré « horde de 10 contre 2 » ; le mobilier-couverture sera un choix exprès, pas un effet de bord. |
| 2 | le hameau de bois | Un **logis 3×3** par habitant (sol, murs bois en arêtes, encadrement) bâti AUTOUR de sa paillasse ; l'**enceinte** de bois (murs d'arêtes, carré de rayon `ENCEINTE_RADIUS`) percée d'une **porte charretière de 2 arêtes** au sud. |
| 3 | le bourg de pierre | Les **stations** (établi, four, silo — accès `village`) assemblées au Feu et posées ; les murs et portes de l'enceinte **améliorés en pierre** (`upgrade_structure`, `cut_stone`). |

## Règles

- **R1 — Fondation au campement.** `foundNpcVillage` pose le palier 1 : plus aucune
  `house`. Le type `house` survit dans le code (parties sauvées) mais plus rien n'en
  pose. *Critère : un village fondé n'a aucune structure `house` ; il a
  `count` paillasses.*
- **R2 — La paillasse est le domicile.** `homeId` d'un PNJ pointe sa paillasse
  (récupération ×2 en dormant, comme la maison). *Critère : un PNJ sans domicile en
  reçoit un ; sa récup de sommeil vaut `SLEEP_RECOVERY_HOME_PER_HOUR`.*
- **R3 — Le tableau porte la construction.** Quand le plan directeur a des pièces
  manquantes, le tableau porte **UNE** tâche `build` à la fois (séquentielle —
  priorité sous `feed_fire` et `repair`), pour la **première** pièce manquante dont
  le grenier paie le coût. Les cibles de récolte du tableau s'élèvent du coût du
  chantier en attente (c'est la levée du plafond MESURÉ). *Critère : village au
  palier 2 avec grenier garni → une tâche `build` au tableau ; grenier vide → zéro.*
- **R4 — L'exécuteur bâtit par le pipeline.** `fetch` (marteau + coût, retirés du
  grenier) → site → pose validée (`applyVillageAction`). `structure_built` porte
  `ownerId` = le PNJ. Empêchement propre au PNJ → la tâche retourne au tableau ;
  refus de pose (`action_rejected`) → elle le quitte (le rafraîchissement la
  repostera si le plan la veut toujours).
- **R5 — Le marteau se forge.** Ni au sac ni au grenier → le bâtisseur le FORGE au
  Feu (recette existante), ingrédients du grenier. *Critère : village sans marteau
  finit par en poser un mur quand même.*
- **R6 — Montée de palier au surplus.** À l'aube, si le grenier atteint
  `VILLAGE_GROWTH.STAGE_BARS[buildTier+1]` (nourriture ET matériaux), `buildTier`
  monte de 1 et `village_stage_up` est émis. Aucune clé de jour de saison : la barre
  est la seule porte. *Critère : grenier garni à la main → palier 2 à l'aube
  suivante ; grenier vide → jamais.*
- **R7 — Porte rituelle.** Les portes d'un village PNJ s'ouvrent à l'aube et se
  ferment au crépuscule (`door_toggled`, `byEntityId: 0`). Jamais celles des
  villages à chef humain. *Critère : franchir l'aube ouvre, franchir le crépuscule
  ferme ; une porte de village joueur ne bouge pas.*
- **R8 — La pierre se récolte.** Dès le palier 2, le tableau veut de la pierre
  (`gather_stone`, nœud `rock`, mains nues) vers la barre du palier 3 ; le palier 3
  veut du `cut_stone` (`gather_cut_stone`, nœud `quarry`) — le PNJ fabrique une
  `crude_pickaxe` (corde comprise) si le village n'en porte pas. *(Si la chaîne
  pioche déborde du chantier : différer `gather_cut_stone` explicitement ici — le
  palier 3 pose alors ses stations et garde ses murs de bois.)*
- **R9 — La prospérité attire.** À l'aube, si la nourriture du grenier ≥
  `ATTRACT_FOOD` et l'effectif vivant < `POP_CAP[buildTier]`, un colon arrive
  (`spawnNpcsAround` +1, `settler_arrived`). Le plan exige alors un logis de plus →
  la construction suit en cascade. *Critère : village prospère sous plafond → +1 à
  l'aube ; au plafond → rien.*
- **R10 — Déterminisme.** Aucune de ces passes ne tire sur `state.rng` : tout dérive
  du tick et de l'état (patron `advanceRefugees`). *Critère : `sim.test.ts`,
  `replay.test.ts`, `events.test.ts` inchangés et verts.*
- **R11 — Le banc le voit, et le chantier ne tue pas.** Sur 12 jours de banc, au
  moins un village atteint le palier 2 et bâtit — et les villages qui survivaient
  SANS chantier survivent AVEC (le témoin `HEAD` fait foi). La croissance de
  population ne se montre que si la zone porte le gras (`ATTRACT_FOOD`) : la
  géographie module la croissance, le recrutement de réfugiés reste le levier
  fiable partout. *(Calibrage des barres — c'est le critère qui remplace tout
  seuil de jour.)*

## Hors périmètre (assumé)

- La réouverture complète d'A7 (survie 10 jours) — toujours en pause.
- Les stations de la chaîne du fer (enclume et au-delà) — exigent le minerai.
- L'ouverture des stations aux joueurs par réputation — post-MVP alignement.
- La refondation d'un village mort (le village figé EST le récit, pour l'instant).
- Le sol de cour (`terre`) sur toute l'emprise — coût en structures, à voir après
  le rendu réel.
