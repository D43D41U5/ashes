# Le monde — temps, carte, collisions

*Source : GDD §2 (saison), §9 (carte), §11 (stack). Statut : **implémenté** (2026-07-05, critères A1-A5 verts). Jalon : V1.*

## Objectif de design

Donner à `/sim` son substrat spatial et temporel, déterministe et testé — tout le reste (village, économie, PNJ, saison) se pose dessus. La carte porte la géographie politique (des *lieux* nommables : le Pont, le Col) ; le temps porte la saison (3 actes) et le rythme des sessions (cycle jour/nuit). Rien ici n'est du gameplay : c'est la scène.

## Règles

### Le temps

- **R1 — Le tick est la seule horloge.** Toute notion dérivée (heure du cycle, jour de saison, acte) est une fonction pure du numéro de tick et des paramètres du `SimState`. Aucun état temporel redondant.
- **R2 — Deux échelles de temps distinctes**, comme dans Rust :
  - **Le cycle** (jour/nuit diégétique) : `CYCLE_REAL_MINUTES = 48` minutes réelles — 30 min de jour, 18 min de nuit (`CYCLE_DAY_FRACTION = 0.625`). Une session de 45 min voit un jour *et* une nuit ; la nuit est assez longue pour une horde, assez courte pour ne pas frustrer.
  - **Le jour de saison** (calendrier) : 1 jour réel à l'échelle 1. La saison dure `SEASON_DAYS = 60` jours de saison. Actes : I = jours 1-21, II = 22-42, III = 43-60 (`ACT_BOUNDARIES = [21, 42]`).
- **R3 — `calendarScale` : l'accélération ne touche que le calendrier.** Multiplicateur stocké dans le `SimState` (donc sérialisé, donc rejouable) : 1 en multi ; libre en Veillée et en test (ex. 720 → la saison passe en 2 h de jeu, le cycle jour/nuit reste à 48 min, jouable). Les tests headless utilisent de grandes échelles pour jouer des saisons en secondes.
- **R4 — Le temps émet des événements de domaine** : `day_started`, `night_started`, `season_day_started`, `act_started`. Hordes (V7), saison (V9) et chronique seront des consommateurs — jamais des recalculs parallèles.

### La carte

- **R5 — Le déplacement est continu, la grille ne concerne que le décor.** Les entités bougent librement dans toutes les directions (à la Binding of Isaac / Zelda), positions en flottants — *jamais* de déplacement case par case. La tuile n'est que l'unité de mesure des distances (« vitesse = 4 tuiles/s ») et la résolution de la grille de collision du décor. Le rendu (16 px/tuile en pixel art, à confirmer en V2) est une affaire de `/client` ; `/sim` n'en sait rien.
- **R6 — `WorldMap` : grille JSON-sérialisable** dans le `SimState` : `width`, `height`, `terrain: number[]` (un id par tuile), plus une table statique `TERRAINS` (id → `{ walkable, speedFactor }`). Exemples v1 : herbe (1.0), route (1.25), forêt (0.8), eau peu profonde (0.5), roche/mur/eau profonde (bloquant).
- **R7 — Tiled est l'outil, jamais le format runtime.** Un importeur pur (`tiled.ts`) convertit le JSON Tiled → `WorldMap`. Couches reconnues : `terrain` (calque de tuiles), `obstacles` (calque de tuiles, prime sur le terrain), `zones` (calque d'objets rectangulaires nommés). Couche inconnue = ignorée avec avertissement à l'import, jamais d'erreur silencieuse.
- **R8 — Les zones nommées** (`{ name, x, y, w, h }`) sont la graine de trois systèmes futurs : les landmarks de la chronique (« la bataille du Pont »), les zones interdites de fondation (V3), et le découpage en rooms de la Phase Vallée. En V1 elles sont juste importées, stockées, requêtables (`zoneAt(x, y)`).

  *Amendement du 2026-07-14 — deux des trois promesses sont tenues, la troisième est annulée.* Le **découpage en rooms** arrive, mais ce ne sont pas des rectangles Tiled : c'est le **graphe de 12 zones** de `worldgen.md`, généré, avec ses paliers et ses seuils. Et les **zones interdites de fondation n'existeront jamais** : décision d'Alexis — *on ne dit jamais non au joueur ; **la distribution des ressources EST la règle de peuplement*** (personne ne s'installe dans le Névé parce qu'on n'y bâtit rien, faute de bois et d'eau liquide). Zéro code de restriction, zéro frustration. Un `Zone` rectangulaire reste ce qu'il est — un **toponyme**, une étiquette posée sur la carte — et ne prétend plus découper le monde.

- **R8bis — L'ALTITUDE EST UN ENTIER : des TERRASSES, des FALAISES, des RAMPES** (décision d'Alexis, 2026-07-14 ; spec `worldgen.md` R1-R6). Le champ d'altitude continu et son rendu en faux-relief (`elevation × RELIEF_H`) sont **abrogés** : illisibles (quelques pixels), fragiles (une seed sur quatre repliait l'image et faisait planter le jeu — `assertNoFold`), et ils n'ont jamais donné la profondeur qu'on leur demandait. La question « faut-il passer en 3D ? » a été posée et tranchée : **non** (l'art du projet *est du code* ; la 3D échangerait un système qui marche contre une dette d'art infinie). À la place : un **palier** entier par tuile ; entre deux paliers, une **falaise** bloquante et dessinée ; on ne monte **que par une rampe**, et les rampes sont **rares**. Une falaise ne se replie pas : c'est un mur. Ce qu'on cherchait n'était pas de la perspective, c'était de la **verticalité** — et la 2D top-down la donne mieux que le lift.

### Les collisions

- **R9 — AABB centrée par entité.** Avatar : `0.6 × 0.6` tuile (passe une porte d'une tuile avec de la marge ; deux avatars se croisent dans un couloir de deux tuiles).
- **R10 — Résolution par axe** (X puis Y, style classique) : on glisse le long des murs, on ne s'y colle pas. Pas de moteur physique, pas de résolution itérative — arithmétique `+ - * /` uniquement (déterminisme inter-moteurs).
- **R11 — Le terrain module la vitesse** (`speedFactor`) au tick du déplacement. La nuit ne module rien en v1.
- **R12 — Pas de collision entité-entité en v1.** Les entités se traversent (sinon : bouchons aux portes avec les PNJ). À rouvrir en V6 : le combat voudra du blocage de ligne — ce sera une décision de design de combat, pas de monde.

## Critères d'acceptation

- **A1** — Fonction du temps pure : pour un `calendarScale` donné, `getGameTime(state)` retourne heure du cycle, `isNight`, jour de saison et acte corrects pour des ticks choisis (bornes d'actes incluses). Même tick + mêmes paramètres = même résultat, toujours.
- **A2** — Une saison complète à l'échelle 720 tourne headless en **< 60 s**, émet exactement 60 `season_day_started` et 3 `act_started`, dans l'ordre.
- **A3** — Une entité pilotée par inputs pseudo-aléatoires (PRNG seedé) pendant 10 000 ticks contre un labyrinthe ne pénètre *jamais* une tuile bloquante, et glisse le long des murs (le mouvement diagonal contre un mur produit un déplacement sur l'axe libre).
- **A4** — L'import d'une carte Tiled de test restitue dimensions, terrains, obstacles et 2 zones nommées ; une couche inconnue est ignorée avec avertissement collecté.
- **A5** — Le contrat de replay est étendu : même seed + même carte + mêmes inputs = même état et même flux d'événements au bit près (y compris les événements de temps).

## Hors périmètre (et où ça revient)

- Remplissage procédural de la « chair » (ressources, ruines mineures) → V4, sur les marqueurs de zones.
- Pathfinding et flow fields → V5/V7.
- Météo et effets du Grand Froid → V9 (mais l'acte courant est déjà exposé par R4).
- Collision entité-entité → V6.
- Chunking/rooms réels, streaming de carte → Phase Vallée.

## Ajouts à `balance.ts`

`CYCLE_REAL_MINUTES = 48`, `CYCLE_DAY_FRACTION = 0.625`, `ACT_BOUNDARIES = [21, 42]`, `AVATAR_HITBOX_TILES = 0.6`, table `TERRAINS` (les `speedFactor` sont de l'équilibrage), `DEFAULT_CALENDAR_SCALE = 1`.
