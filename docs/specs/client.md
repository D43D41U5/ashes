# Le client — rendu, Worker, protocole

*Source : GDD §11 (stack, client « bête »), roadmap V2. Statut : **implémenté** (2026-07-05 — A1-A3 vérifiés en headless Playwright, A4 vérifié en code, le cycle de 48 min n'a pas été attendu). Jalon : V2.*

## Objectif de design

Afficher la simulation sans jamais la posséder. La sim tourne dans un **Web Worker** (mode Veillée) ; le client Phaser envoie des intentions et interpole des snapshots. Le protocole défini ici est la **répétition générale du réseau** : en Phase LAN, on remplace le transport (Worker → WebSocket/Colyseus), pas les messages ni le code de rendu.

## Règles

### Le protocole (transport-agnostique)

- **R1 — Client → hôte** : `init` (seed, `WorldMap`, `calendarScale`, spawn du joueur) puis `input` (`{seq, dx, dy, sprint, block}`, `dx/dy` ∈ {-1,0,1}²), un par tick de prédiction, numéroté pour la réconciliation (spec `reconciliation.md` R1) — jamais de position, jamais de résultat.
- **R2 — Hôte → client** : `ready` (id du joueur) puis un `snapshot` par tick : `{ tick, lastProcessedInput, time (GameTime), entities, events (drainés)… }`. `lastProcessedInput` acquitte le dernier input appliqué (spec `reconciliation.md` R2). La carte n'est **jamais** dans les snapshots (transmise une fois à l'init).
- **R3 — L'hôte est autoritatif.** Le Worker exécute `step()` à `TICK_RATE_HZ` et est la seule vérité. Le client ne fait tourner aucune logique de jeu — à une exception près (R5).

### Le rendu

- **R4 — Interpolation** : les entités distantes sont rendues ~100 ms dans le passé, interpolées entre les deux derniers snapshots (GDD §11).
- **R5 — Prédiction locale : le déplacement de son propre avatar, rien d'autre.** Le client rejoue `moveAvatar` de `/sim` (fonctions pures partagées) **à pas de tick fixe** (`predictFrame`) — pas à la cadence de rendu, sinon divergence de coin près des murs. Il se réconcilie **par rejeu** des inputs non acquittés et lisse la correction au rendu (spec dédiée `reconciliation.md`). Snap dur si l'écart dépasse 1,5 tuile (respawn).
- **R6 — 16 px par tuile**, `pixelArt: true`, `roundPixels: true`, zoom ×2, échelle FIT 1280×720, caméra `startFollow` lerp 0.12 (config héritée de Manif, éprouvée). *Le cadrage, les proportions et le découplage art↔grille sont précisés et resserrés par la section « Cadrage & proportions » ci-dessous (qui supersede le « zoom ×2 » figé).*
- **R7 — Le temps se voit** : teinte nocturne pilotée par `GameTime.hourOfCycle` (aube/crépuscule en rampe), HUD jour/acte/heure. Le lighting normal-mapped de Manif arrive avec les vrais assets (V3+), pas en V2.
- **R8 — Placeholders assumés** : tuiles et sprites générés par code au boot (pattern Manif) tant que la direction artistique n'est pas posée. La carte est bakée une fois dans une RenderTexture (elle est statique en V2).

### L'hôte Worker

- **R9 — Le Worker est un hôte, pas de la logique** : boucle d'intervalle à `TICK_RATE_HZ`, applique le dernier input du joueur (et acquitte son `seq` dans le snapshot, spec `reconciliation.md` R2) + les inputs des PNJ de test (marcheurs aléatoires — l'aléatoire des *inputs* appartient à l'hôte, pas à `/sim`), poste le snapshot. Tout le reste vit dans `/sim`.

## Critères d'acceptation

- **A1** — `pnpm check`, `pnpm lint` et `vite build` passent ; le bundle isole Phaser en chunk séparé.
- **A2** — En jeu : on se déplace au clavier (ZQSD/WASD/flèches) dans la vallée de démo, collisions et glissement identiques à la sim (c'est le même code), caméra qui suit, ~60 fps rendu / 12 Hz sim.
- **A3** — Des PNJ marcheurs bougent, interpolés sans à-coups (le rendu ne saute pas au rythme des ticks).
- **A4** — La nuit tombe visuellement en ~48 min de cycle ; le HUD affiche jour de saison et acte qui avancent (échelle de démo accélérée).

## Cadrage & proportions (façon V Rising) — cadre découplé

*Statut : **implémenté** (2026-07-06 — R10-R13). Incrément client, zéro impact sur `/sim` (identité top-down orthogonale du GDD préservée — pas de perspective ¾, pas de hauteur 3D). Objectif : des proportions à l'écran proches d'un V Rising (avatar présent, cadrage resserré) **et** ne plus être prisonnier de l'art 16×16 le jour où l'on peaufine les sprites. Math pure isolée et testée dans `packages/client/src/render/framing.ts` (`framing.test.ts`, vitest ajouté au package client), câblée dans `WorldScene`. Vérification : A5/A9 par tests unitaires ; A6/A7/A8 en jeu (smoke Chromium piloté — zoom 2,25 mesuré, avatar ancré aux pieds 16×25,6 px issu d'un art natif 12×12, lookahead qui décale le scroll de ~90 px vers le curseur et se clampe aux bords, `playerDepth` ≈ 1000+feetY vivant) ; A8 (occlusion) vrai par construction du schéma de profondeur + tests d'ordre nord/sud.*

Le nœud : aujourd'hui `TILE_PX = 16` cumule **deux rôles** — l'échelle grille↔pixels (le pont entre l'espace-tuile de `/sim` et l'écran) *et* la résolution d'autoring de l'art. `/sim` ne connaît que des tuiles abstraites ; la résolution de l'art est donc un choix 100 % client. On sépare les deux rôles pour que l'art puisse monter en résolution sans refonte.

### Les règles

- **R10 — Cadrage dérivé d'une constante unique.** Le zoom n'est plus le `2` magique : il se calcule depuis un cadrage voulu. `VISIBLE_TILES_TALL = 20` → `zoom = 720 / (VISIBLE_TILES_TALL × TILE_PX)` (≈ 2,25). Changer `VISIBLE_TILES_TALL` recadre tout le jeu d'un seul endroit. (La résolution interne restant 1280×720 en FIT, le cadrage est constant quelle que soit la fenêtre.)
- **R11 — Caméra « Foxhole » : voir plus loin là où l'on vise.** **Uniquement en visée** (clic droit maintenu) : au repos, la caméra reste centrée sur l'avatar (offset nul) ; au relâchement, le lerp du follow la ramène en douceur. Le point suivi = position de l'avatar + un décalage borné vers le curseur. Le décalage se calcule en **écran-espace** — écart du pointeur au centre (640, 360) × `LOOKAHEAD_STRENGTH`, clampé à `LOOKAHEAD_MAX_TILES` — **jamais** depuis la position *monde* du curseur (sinon boucle de rétroaction caméra↔curseur). `setBounds` clampe le décalage aux bords de carte (aucun hublot sur le void). Ces constantes sont du réglage **client** (pas dans `/sim`). Le mapping souris↔tuile (visée, ghost de construction) n'est pas affecté : `positionToCamera` intègre le scroll caméra.
- **R12 — Découplage art↔grille.** `TILE_PX` désigne désormais **uniquement** l'échelle grille↔pixels (le pont), plus « la taille de l'art ». Chaque acteur porte son **emprise en tuiles** et se dessine en **origine pieds (0,5 ; 1)** posée au bas de sa tuile logique, via `setDisplaySize(footprintTiles × TILE_PX)`. Conséquence : remplacer un placeholder par un asset de résolution arbitraire ne change **ni sa taille monde ni son emprise** — aucune math de layout touchée. L'emprise *logique* (collision/clic, `AVATAR_HITBOX_TILES`) est inchangée : c'est le *visuel* qui se découple et peut être plus haut que l'emprise. Le sol, les nœuds et les structures gardent leur ancrage grille actuel.
- **R13 — Profondeur par Y (Y-sort).** Les acteurs « hauts » (joueur, PNJ, monstres) et les structures verticales (murs, à terme arbres) trient leur profondeur par `depth = base + y` monde, au lieu de constantes fixes → un acteur passe **derrière** ce qui est au nord de lui et **devant** ce qui est au sud. Le sol/route reste sous tout le monde.

### Embranchements laissés ouverts (à trancher à la définition de la direction artistique — pas maintenant)

Le cadre ci-dessus est **agnostique au style**. Deux décisions dépendront du style choisi et ne sont pas figées ici :

- **Pixel-art plus fin** → on reste `pixelArt: true` + nearest-neighbor, et l'on monte `TILE_PX` en **multiples entiers** (32/48). **Art peint/lissé** → filtrage **linéaire** (par texture ou global) et art autoré en très haute résolution, downscalé en douceur.
- **Résolution interne.** 1280×720 plafonne le détail affichable quelle que soit la résolution des PNG (l'art est downscalé à 720p). Pour que du bel art serve, monter l'interne (1920×1080, voire piloté par `devicePixelRatio`).

### Dette technique à traiter *le jour où* l'on monte l'échelle (pas avant)

- **Chunker le bake carte.** `bakeMapTexture` génère **une** texture `largeur × TILE_PX` ; au-delà de la limite GPU (4096/8192 px) → écran noir. Avant toute hausse de `TILE_PX` ou de taille de carte : baker par blocs, ou passer à un tilemap Phaser, ou ne baker que le visible.

### Critères d'acceptation

- **A5** — Le zoom dérive de `VISIBLE_TILES_TALL` (constante nommée) ; en la modifiant, le cadrage change de façon cohérente, sans autre édition.
- **A6** — Clic droit maintenu : la caméra se décale vers le curseur, bornée par `LOOKAHEAD_MAX_TILES`, et ne montre jamais le void près des bords de carte. Déplacer le curseur ne crée aucune oscillation (calcul écran-espace). Sans clic droit, déplacer la souris ne bouge pas la caméra ; au relâchement, elle revient en douceur sur l'avatar.
- **A7** — Un acteur est ancré aux pieds ; un sprite dont l'art est plus haut que son emprise « monte » au-dessus de sa tuile **sans** décaler sa collision ni sa cible de clic.
- **A8** — Y-sort : un acteur est occulté par une structure située au nord de lui, et recouvre une structure située au sud.
- **A9** — Remplacer un placeholder par une texture de résolution arbitraire (ex. 4×) ne change ni la taille monde de l'acteur ni son emprise logique (mêmes collisions, même cible de clic).

## Hors périmètre (et où ça revient)

- Lighting normal-mapped (capital Manif : `deriveNormalCore.mjs`, `SceneLightingManager`) → avec les vrais tilesets, V3+.
- Boucle d'hôte à accumulateur/compensation de dérive → Phase LAN (le serveur en aura besoin, le Worker de démo non).
- UI de jeu réelle, onboarding → V10.
- Reconnexion, sérialisation/restauration de partie → V3 (sauvegarde Veillée).
