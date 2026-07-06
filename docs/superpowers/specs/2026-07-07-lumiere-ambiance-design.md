# Lumière & ambiance — design

**Date** : 2026-07-07
**Statut** : spec validée, prête pour le plan d'implémentation
**Portée** : `packages/client` uniquement (rendu). `/sim` intact.

## Intention

Donner au monde une **lumière et une ambiance réalistes** :

1. Une **teinte (« hue ») selon l'heure** — chaude tôt le matin et tard le soir
   (heure dorée), froide et bleutée la nuit, neutre à midi.
2. Une **nuit sombre mais lisible partout** (choix acté : « nuit bleutée
   lisible », pas de cécité). Les Feux forment des **îlots chauds** ; ils ne sont
   pas vitaux pour voir, mais réchauffent et éclairent leur voisinage.
3. Le **couvert forestier** assombrit **localement** : traverser une zone très
   boisée fait baisser la luminosité *là où sont les arbres* (pénombre du décor),
   proportionnellement à la densité.

C'est de la **pure ambiance visuelle** — aucune conséquence de gameplay
autoritative.

## Contrainte cardinale — pureté & déterminisme

- **100 % client, aucune touche à `/sim`.** `/sim` reste headless et déterministe
  (invariants d'architecture §1-2). La lumière ne *consomme* que ce que la sim
  expose déjà :
  - `time.hourOfCycle` (déjà publié au HUD registry) ;
  - la grille statique `WorldMap.terrain` ;
  - les structures `fire` du snapshot (position `tx/ty` + `warmth` du village).
- Le client est libre d'utiliser `Math.sin` / smoothstep / gradients : l'interdit
  des fonctions Math approximées est **sim-only** (déterminisme cross-moteur).
  UIScene emploie déjà `Math.sin` (pulsation d'alarme).
- Non-autoritatif : deux clients peuvent afficher une ambiance légèrement
  différente sans conséquence — ce n'est pas de l'état de simulation.

## Architecture

### Module central — `render/lighting.ts` (pur, testé)

Sur le modèle de `render/framing.ts` (+ `framing.test.ts`) : des **fonctions
pures** de l'heure/terrain, sans dépendance Phaser, couvertes par
`lighting.test.ts`.

```ts
// Teinte d'ambiance globale selon l'heure murale (hourOfCycle ∈ [0,24)).
ambientTint(hour: number): { color: number; alpha: number }

// Facteur de lumière du jour : 0 = nuit noire … 1 = plein midi.
daylight(hour: number): number

// Paramètres du halo d'un Feu, selon l'alignement (warmth) et l'obscurité.
fireGlow(warmth: number, daylight: number): { color: number; radius: number; alpha: number }
```

**Courbes (constantes nommées dans le module, ajustables) :**

- `ambientTint` — keyframes interpolées sur l'heure :
  - Midi (~10h–15h) : `alpha ≈ 0` (aucune teinte).
  - **Aube (~5h–7h)** et **crépuscule (~19h–22h)** : ambre chaud
    (~`#c8702a`) à alpha modéré → heure dorée.
  - **Nuit profonde (~22h–5h)** : bleu froid `#0b1030`, alpha **plafonné**
    (`NIGHT_ALPHA_MAX ≈ 0.5`) — jamais le noir total.
  - Transitions douces (interpolation linéaire ou smoothstep entre keyframes),
    cohérentes avec la frontière `isNight` de la sim (nuit à 21h murales).
- `daylight` — monotone, ≈ 0 en cœur de nuit, ≈ 1 vers midi, transitions à l'aube
  et au crépuscule. Sert à moduler canopée et halos.
- `fireGlow` — `color` dérivé de `warmth` (réutilise le mapping existant de
  `snapshot-view.ts` : `warmth>0` → chaud/blanc/rouge, `warmth<0` → bleu) ;
  `radius`/`alpha` croissent avec `|warmth|` (engagement, GDD §5/§11) **et** avec
  `(1 - daylight)` (le Feu éclaire fort la nuit, quasi nul à midi).

### Trois couches composées (dans `WorldScene`, au-dessus des sprites du monde)

Ordre de profondeur (bas → haut), en s'appuyant sur `framing.ts`
(`ACTOR_DEPTH_BASE = 1000`, acteurs/structures ~1000–1200, `OVERLAY_DEPTH = 100000`) :

```
map (-1)
  → nœuds / cadavres / acteurs / structures (~3–1200)
    → [1] canopée      (~2000, monde)
      → [2] ambiance   (~2100, écran)
        → [3] halos Feux (~2200, monde, additif)
          → ghost de construction / HUD (100000+)
```

**[1] Pénombre de canopée — locale, cuite une fois**

- Une texture `canopy` de la taille de la carte (comme `map-demo`, cuite dans
  `WorldScene.onReady`). Par tuile : couleur sombre + `alpha` ∝ densité d'arbres
  du terrain, avec bruit `hash2(tx,ty)` pour le moucheté (dappling).
- Densités par terrain (constante dans le module lighting, valeurs de départ) :
  - `forêt (3)` : forte (~0.45)
  - `marais (8)` : légère (~0.15)
  - tout le reste : 0
- Rendue comme **image monde** au-dessus des acteurs (elle ombre donc aussi
  joueur/PNJ/structures sous les arbres — réaliste), sous l'ambiance.
- Son **alpha global** est multiplié par un facteur ∝ `daylight` (l'ombre du
  sous-bois se lit surtout de jour ; la nuit, l'ambiance domine déjà et on évite
  de sur-assombrir). Mise à jour chaque frame depuis la dernière `time` reçue.

**[2] Teinte d'ambiance globale — écran**

- Un rectangle plein écran (`scrollFactor 0`), `fillStyle`/`alpha` =
  `ambientTint(hour)`. Remplace l'actuel `nightAlpha` + overlay plat de UIScene.
- Se redimensionne au `resize` (comme les autres éléments plein écran).

**[3] Îlots de lumière des Feux — locale, additive**

- Par structure `fire` : un sprite de **halo radial doux** (blend `ADD`) centré
  sur le Feu, `setTint` = `fireGlow(...).color`, échelle = rayon, `alpha` =
  intensité. L'additif *repousse* localement l'obscurité ambiante+canopée → îlot
  chaud lisible qui perce la nuit (il est au-dessus de la couche ambiance).
- Cycle de vie greffé sur les sprites de Feu existants dans `snapshot-view.ts`
  (qui connaît déjà `villages[].warmth`) — création/màj/destruction par le même
  diff `seen` que les sprites de structures. Chaque frame : rafraîchir
  couleur/rayon/alpha avec `warmth` courant et `daylight` courant.
- La **texture de dégradé radial** (blanc centre → transparent bord) est générée
  **une fois** via un canvas `createRadialGradient` (DOM autorisé côté client),
  puis teintée par sprite.

### Alimentation en temps

`WorldScene` reçoit déjà `msg.time` à chaque snapshot (`onHostMessage`). On
mémorise la dernière `time` (`this.lastTime`) pour piloter canopée + halos dans
`update()`. UIScene lit déjà `time` via le registry pour l'ambiance globale.

## Fichiers touchés

| Fichier | Changement |
|---|---|
| `render/lighting.ts` | **NOUVEAU** — `ambientTint`, `daylight`, `fireGlow`, densités canopée, constantes. Pur. |
| `render/lighting.test.ts` | **NOUVEAU** — tests des courbes. |
| `scenes/WorldScene.ts` | Cuisson texture `canopy` ; image canopée + rect ambiance ; `lastTime` ; passage de `daylight` aux couches. |
| `scenes/world/snapshot-view.ts` | Halos additifs par Feu (ou extrait dans `world/fire-glow.ts` si le fichier grossit trop). |
| `scenes/UIScene.ts` | **Retire** `nightAlpha` + l'overlay `nightOverlay` (l'ambiance passe dans WorldScene) ; l'**alarme** garde/obtient son **propre overlay rouge dédié** (elle réutilisait `nightOverlay`). |

> Décision : l'ambiance globale peut vivre soit dans WorldScene (sous les halos),
> soit dans UIScene (au-dessus de tout). Pour que les halos additifs **percent**
> la teinte, l'ambiance doit être **sous** les halos → elle vit dans WorldScene.
> UIScene ne garde que le HUD et l'alarme (overlay rouge dédié).

## Critères d'acceptation

Testables en unitaire (`lighting.test.ts`) sauf mention visuelle :

1. **Midi neutre** : `ambientTint(12).alpha` ≈ 0 (± epsilon).
2. **Nuit plafonnée** : `ambientTint(0).alpha === NIGHT_ALPHA_MAX` et la couleur
   est le bleu de nuit (jamais alpha ≥ ce plafond → jamais noir total).
3. **Heure dorée** : à l'aube (~6h) et au crépuscule (~20h30), la teinte est
   *chaude* (composante rouge > bleue) et d'alpha intermédiaire (> midi, < nuit).
4. **`daylight` monotone & borné** : `daylight ∈ [0,1]`, ≈ 0 à minuit, ≈ 1 à midi,
   croissant de la nuit vers midi.
5. **Halo nuit > jour** : `fireGlow(w, daylight_nuit).alpha > fireGlow(w, daylight_midi).alpha`
   pour un même `warmth` ; à `daylight ≈ 1` le halo est ~nul.
6. **Halo coloré par l'alignement** : `fireGlow(+80, …).color` est chaud/rouge,
   `fireGlow(-80, …).color` est bleu (cohérent avec le tint de Feu existant).
7. **Canopée par terrain** : la densité forêt > marais > 0 = reste
   (fonction/constante testable).
8. **(Visuel)** Captures build+preview à l'aube / midi / crépuscule / minuit et
   près d'un Feu la nuit : progression chaud→neutre→chaud→bleu lisible, sous-bois
   plus sombre que la clairière, îlot chaud autour du Feu.

## Vérification

- `pnpm check`, `pnpm test` (client teste déjà via vitest : `framing`, `keymap`),
  `pnpm lint` — verts avant commit.
- Vérif visuelle : build+preview + Chromium en cache (voir mémoire
  `browser-smoke-test`), pilotage via `window.__BRAISES__`, captures aux heures
  clés.

## Hors scope (YAGNI)

- Pas de torche / objet de lumière portable (absent du GDD ; le froid se répond
  par feux/vêtements/abris, §7).
- Pas de fog-of-war ni de visibilité autoritative (resterait pur client).
- Pas de pipeline Phaser Light2D ni de normal maps (invasif, art placeholder).
- Pas de lune/étoiles dynamiques, pas de météo.
- Pas de halo personnel autour du joueur (choix acté « lisible partout » : les
  Feux sont les seules sources chaudes).
