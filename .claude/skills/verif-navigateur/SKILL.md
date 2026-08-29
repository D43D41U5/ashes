---
name: verif-navigateur
description: Comment aller VOIR le jeu tourner dans un navigateur — quelle prise choisir, contre quel serveur on tourne vraiment, comment armer le debug, et comment capturer une image qui montre ce qu'on juge. À charger avant tout `pnpm smoke`, toute sonde Playwright, toute capture d'écran du jeu, et avant de croire le ✗ d'un scénario.
---

# ALLER VOIR — la recette du harnais navigateur

`tools/smoke.mjs` pilote le **vrai jeu** dans Chromium et rapporte ce qu'il voit. Ce qui suit
est ce qui a déjà coûté une session à quelqu'un. Les pièges ne sont pas des bugs : ce sont des
comportements corrects du harnais qui, ignorés, rendent un verdict FAUX — vert comme rouge.

## 1. Contre QUOI tu tournes — le piège le plus cher

`tools/smoke.mjs:72` : `SMOKE_URL ?? (dev ? 'http://ashes.test/' : localhost:PORT)`.

- `pnpm smoke` (sans drapeau) — bâtit le client, lance `vite preview --strictPort`, sert, éteint.
  **Autonome, mais le debug est MORT** (voir §2).
- `pnpm smoke --dev` — ne sert rien et vise **`http://ashes.test/`** : la **stack Docker
  PARTAGÉE**. Depuis un worktree, ou pendant qu'une autre session travaille, tu mesures alors
  le code de quelqu'un d'autre — et le ✗ accuse le tien.
- `SMOKE_URL=… pnpm smoke` **sans `--dev`** — `SMOKE_URL` ne pilote QUE l'URL visitée, jamais
  `serve()` : le client est bâti pour rien et un `vite preview --port 4173 --strictPort` démarre
  que personne ne visite. Plusieurs minutes brûlées — et `--strictPort` refuse de démarrer si un
  autre lot occupe déjà 4173.

**La seule incantation juste quand tu veux éprouver TON code avec le debug :**

```bash
pnpm --filter @ashes/client exec vite --port 3100 --strictPort   # ton vite, ton port, en fond
SMOKE_URL=http://localhost:3100/ pnpm smoke --dev --scenario <nom>
```

Ce vite se lance **en fond** ; l'attendre par `curl -s --retry 40 --retry-delay 1
--retry-connrefused http://localhost:3100/` (une boucle de `curl` nue rend `000` : elle épuise
ses tours en moins d'une seconde, avant que vite n'écoute). Éteindre : **`fuser -k 3100/tcp`**. ⚠ **JAMAIS `pkill -f vite` ni `pkill -f smoke.mjs`** —
d'autres sessions d'Alexis tournent en parallèle sur cette machine ; un `pkill` par motif a déjà
détruit sept lots de smoke en cours. Par port, ou par PID gardé, jamais par motif.

⚠ **Le HMR tue la prise** : éditer `packages/client/**` pendant qu'un run `--dev` tourne recharge
la page et avorte le scénario. Pendant un run, ne toucher que `tools/`.

## 2. Le debug n'existe qu'en DEV

`packages/client/src/worker/veillee.ts:167` — `debug: import.meta.env.DEV`. Dans un build de
production, les actions de debug sont **inertes et silencieuses** : elles ne rendent pas d'erreur,
il ne se passe rien. Tout scénario qui se téléporte, force l'heure ou s'octroie un objet **exige
un serveur de dev** (§1).

Les onze actions (`packages/sim/src/protocol.ts`) : `debug_teleport` · `debug_grant` · `debug_god`
· `debug_set_hour` · `debug_set_season_day` · `debug_speed` · `debug_meteo` · `debug_reveil` ·
`debug_horde` · `debug_carcass` · `debug_village_stage`.

⚠ **`debug_set_season_day` ne peut que MONTER.** Vers un jour antérieur, il rembobine le tick ; le
client jette alors tous les snapshots et **l'écran fige, sans un mot**.

⚠ **Empilées, elles se lisent au passé** : trois actions puis une sonde dans le même `evaluate`
relèvent l'état d'AVANT. Laisser passer des images entre l'action et la mesure.

## 3. L'API dans la page

Le jeu s'expose par `window.__BRAISES__.scene`. Le harnais **LIT** l'état, il ne le fabrique pas.

```js
const sc = window.__BRAISES__.scene
sc.sendAction({ type: 'debug_teleport', x: tx + 0.5, y: ty + 0.5 })  // envoyer une action
sc.view.structures | sc.view.villages | sc.playerId                   // l'état diffusé
sc.map.terrain[y * sc.map.width + x]                                  // la carte du jeu qui tourne
sc.game.loop.sleep() / .wake()                                        // arrêter / relancer la boucle
sc.game.step(t, dt)                                                   // avancer d'une image, à un t CONNU
```

Le helper des scénarios : `agir(action, ms)` = `page.evaluate(sendAction)` puis `waitForTimeout`.

## 4. Capturer une image

Cette machine **n'a pas de GPU** (VM KVM, SwiftShader). Conséquence directe :

⚠ **`page.screenshot` EXPIRE tant que Phaser tourne** → `game.loop.sleep()` **avant** la capture,
`wake()` après. Idem pour tout `page.evaluate` qui balaie la carte : sans `sleep()`, l'appel
attend derrière une frame de plusieurs minutes.

⚠ **Un FX éphémère se fond avant la capture** (l'horloge headless saute) : s'accrocher à la
FABRIQUE du FX pour figer à sa naissance, puis avancer par `game.step` — `fx.update` ne redessine
pas. Un nouveau-né se repère par son ÉTAT (`fade ≈ 0`), jamais par son rang dans un tableau.

⚠ **Une transition qui DOIT partir** se pilote en NIVEAU (`age ≥ seuil` dans `update`), pas par
`delayedCall` sur un front : l'horloge headless enjambe le front et rien ne se déclenche.

⚠ **Un maintien (hold) expire** quand une frame dure 800 ms : endormir la boucle et piloter le
hold depuis la page.

## 5. Avant de croire un verdict

- **Lire le SETUP du scénario avant son ✗.** Sur un lot mesuré, 12 verdicts rompus sur 15 étaient
  des artefacts du montage, pas des défauts du jeu.
- **Énoncer ce qui ferait ROUGIR la sonde avant d'accepter son vert.** Une sonde qui ne peut pas
  échouer donne le bon résultat par accident.
- **La caméra ne déplace pas les nœuds** : la bouger montre le sol de là-bas et les arbres d'ici.
  Pour voir ailleurs pour de vrai, il faut **téléporter** (donc `--dev`).
- **Vérifier que l'image MONTRE ce qu'on juge** — les aides d'affordance masquent aussi la photo.
- **Machine calme** : sous charge (vitest concurrents, autre Chromium), les gardes à horloge murale
  rougissent seules — jusqu'à 100-300 s par image de nuit. Vérifier `uptime`, rejouer au calme.
- Un `page.evaluate` à **trois** arguments jette « Too many arguments » : imprimer l'erreur de
  chaque échec avant de conclure que tout est bloqué.

## 6. Où écrire

Les images tombent **déjà hors du dépôt** : `OUT` vaut `scratchpad/smoke` par défaut
(`tools/smoke.mjs:52`), et `scratchpad/` est gitignoré. `SMOKE_OUT=<chemin>` le redirige —
utile pour ne pas écraser le lot d'une autre session.
Les autres leviers d'un scénario sont des variables `SMOKE_*` (heure, jour, lune, échelle,
montage… — les lire en tête de `tools/smoke.mjs`).
