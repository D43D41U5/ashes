# Le client — rendu, Worker, protocole

*Source : GDD §11 (stack, client « bête »), roadmap V2. Statut : **implémenté** (2026-07-05 — A1-A3 vérifiés en headless Playwright, A4 vérifié en code, le cycle de 48 min n'a pas été attendu). Jalon : V2.*

## Objectif de design

Afficher la simulation sans jamais la posséder. La sim tourne dans un **Web Worker** (mode Veillée) ; le client Phaser envoie des intentions et interpole des snapshots. Le protocole défini ici est la **répétition générale du réseau** : en Phase LAN, on remplace le transport (Worker → WebSocket/Colyseus), pas les messages ni le code de rendu.

## Règles

### Le protocole (transport-agnostique)

- **R1 — Client → hôte** : `init` (seed, `WorldMap`, `calendarScale`, spawn du joueur) puis `input` (`{dx, dy}` ∈ {-1,0,1}²), envoyé à chaque changement d'intention — jamais de position, jamais de résultat.
- **R2 — Hôte → client** : `ready` (id du joueur) puis un `snapshot` par tick : `{ tick, time (GameTime), entities, events (drainés) }`. La carte n'est **jamais** dans les snapshots (transmise une fois à l'init).
- **R3 — L'hôte est autoritatif.** Le Worker exécute `step()` à `TICK_RATE_HZ` et est la seule vérité. Le client ne fait tourner aucune logique de jeu — à une exception près (R5).

### Le rendu

- **R4 — Interpolation** : les entités distantes sont rendues ~100 ms dans le passé, interpolées entre les deux derniers snapshots (GDD §11).
- **R5 — Prédiction locale : le déplacement de son propre avatar, rien d'autre.** Le client rejoue `resolveMove` de `/sim` (fonctions pures partagées — c'est le bénéfice du monorepo) à la cadence du rendu, et se réconcilie en douceur vers la position autoritative (snap si l'écart dépasse 1,5 tuile).
- **R6 — 16 px par tuile**, `pixelArt: true`, `roundPixels: true`, zoom ×2, échelle FIT 1280×720, caméra `startFollow` lerp 0.12 (config héritée de Manif, éprouvée).
- **R7 — Le temps se voit** : teinte nocturne pilotée par `GameTime.hourOfCycle` (aube/crépuscule en rampe), HUD jour/acte/heure. Le lighting normal-mapped de Manif arrive avec les vrais assets (V3+), pas en V2.
- **R8 — Placeholders assumés** : tuiles et sprites générés par code au boot (pattern Manif) tant que la direction artistique n'est pas posée. La carte est bakée une fois dans une RenderTexture (elle est statique en V2).

### L'hôte Worker

- **R9 — Le Worker est un hôte, pas de la logique** : boucle d'intervalle à 12 Hz, applique le dernier input du joueur + les inputs des PNJ de test (marcheurs aléatoires — l'aléatoire des *inputs* appartient à l'hôte, pas à `/sim`), poste le snapshot. Tout le reste vit dans `/sim`.

## Critères d'acceptation

- **A1** — `pnpm check`, `pnpm lint` et `vite build` passent ; le bundle isole Phaser en chunk séparé.
- **A2** — En jeu : on se déplace au clavier (ZQSD/WASD/flèches) dans la vallée de démo, collisions et glissement identiques à la sim (c'est le même code), caméra qui suit, ~60 fps rendu / 12 Hz sim.
- **A3** — Des PNJ marcheurs bougent, interpolés sans à-coups (le rendu ne saute pas au rythme des ticks).
- **A4** — La nuit tombe visuellement en ~48 min de cycle ; le HUD affiche jour de saison et acte qui avancent (échelle de démo accélérée).

## Hors périmètre (et où ça revient)

- Lighting normal-mapped (capital Manif : `deriveNormalCore.mjs`, `SceneLightingManager`) → avec les vrais tilesets, V3+.
- Boucle d'hôte à accumulateur/compensation de dérive → Phase LAN (le serveur en aura besoin, le Worker de démo non).
- UI de jeu réelle, onboarding → V10.
- Reconnexion, sérialisation/restauration de partie → V3 (sauvegarde Veillée).
