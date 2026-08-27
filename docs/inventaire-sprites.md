# Inventaire des sprites — tout est peint par code

**Relevé du 2026-07-27**, build de production, Veillée solo, seed par défaut.

BRAISES n'a **aucun asset binaire** : pas un PNG, pas un atlas, pas une spritesheet. `packages/client/dist/assets/`
ne contient que trois bundles JS et deux `.woff2` (JetBrains Mono, via `@fontsource`). Tout ce qui se voit à
l'écran est dessiné à l'exécution, au boot, en `Phaser.Graphics` ou au `CanvasRenderingContext2D` — sauf l'eau
et la brume, rendues par du GLSL compilé au runtime (`water-layer.ts`, `mist-layer.ts`), qui n'ont donc pas de
texture de sujet à inventorier.

La conséquence : **il n'y a pas de dossier d'art à ouvrir pour savoir ce qui existe.** Ce document est donc un
relevé, pas un catalogue tenu à la main.

## Comment il a été relevé

```bash
pnpm smoke --scenario textures     # → scratchpad/smoke/inventaire-textures.json
```

Le scénario lit `scene.textures.list` du **vrai jeu** après `worldReady` — la seule liste qui ne mente pas — et
en sort la clé, la taille, le nombre de frames et la nature (canvas peint une fois vs. surface de composition).
Refaire tourner le scénario après tout ajout d'art : ce fichier-ci se périme, le JSON non.

## Sortir l'art en PNG

```bash
pnpm smoke --scenario png          # → art-export/<famille>/<clé>.png + art-export/index.html
```

**628 clés → 473 fichiers PNG** (2,1 Mo), rangés par famille, plus une planche-contact `index.html` qui les
montre toutes au ×4 en NEAREST. Trois choses ne sortent pas, et chacune pour une raison :

- les **champs** pleine-carte (nappe d'eau, masques de brume, terrain) — repeints à chaque partie depuis les
  données de la sim, propres à la graine : les retoucher ne mène nulle part ;
- la **surface de composition** du voile de nuit — une cible de rendu WebGL, pas un dessin ;
- les **cartes de normales** des `_lit` — `normalFromCanvas` les redérive de l'albédo à chaque boot. Retoucher
  l'albédo suffit, le relief suit tout seul.

Deux pièges que la planche signale, et qu'un export naïf laisserait passer :

1. **155 clés partagent le dessin d'une autre** (139 fichiers portent des alias). Un fichier, plusieurs usages :
   la planche liste les clés jumelles sous chaque vignette.
2. **Le jeu affiche `<clé>_lit`, pas `<clé>`,** dès que l'éclairage est armé — c'est-à-dire presque toujours
   (`snapshot-view.ts`). Quand l'albédo `_lit` diffère de sa base, les deux sortent en deux fichiers : **85**
   fichiers sont ce que l'écran montre (marqués ◆), **69** sont des replis non éclairés (grisés). Retoucher un
   repli ne se verrait jamais en jeu.

### Tous les fichiers ne se valent pas à la retouche

Sur les 473, **~178 ne sont pas des sujets mais des expansions de variantes** : `st-` (162 fichiers) tient en
une poignée de sujets démultipliés par masque de voisinage, `-coupe-e*` et `-ruine` ; `cf-` (16) est 8 masques
× 2 variantes. Changer l'allure d'un mur voudrait dire retoucher ~62 PNG **de façon cohérente** — strictement
pire qu'éditer `bati-art.ts`. Les ~295 autres (`spr-`, `it-`, `poi-`, `cl-`, `nd-`, `vt-`, `fx-`) sont un
fichier par sujet : là, la retouche en PNG est un vrai gain.

**Le tour ne se referme pas encore** : rien ne recharge ces PNG. L'art reste peint par code au boot, donc une
retouche est pour l'instant une maquette, pas un changement de jeu. Brancher le retour demande un chargeur qui
préfère `art/<clé>.png` quand le fichier existe et retombe sur le générateur sinon — décision non prise.

## Le compte

**808 textures enregistrées**, dont **634 dessins**.

| catégorie | n | ce que c'est |
|---|---:|---|
| natives Phaser | 4 | `__DEFAULT`, `__MISSING`, `__NORMAL`, `__WHITE` |
| canvas de **texte** | 169 | un par `Phaser.Text` vivant — clé UUID, hauteur 16 à 32 px. Du texte, pas de l'art |
| surface de composition | 1 | la `DynamicTexture` plein écran (1280×720) du voile de nuit, redessinée chaque frame. Clé UUID elle aussi |
| **dessins** | **1598** | 695 dessins de base + 529 compagnons `_lit` + 374 miroirs `_lit_m` |

4 + 169 + 1 + 634 = 808.

Parmi les 407 dessins de base, **6 ne sont pas des sprites** mais des *champs* peints à la taille de la carte
entière (1581 × 2372 px) : `water-field`, `water-fond`, `water-rive`, `combe-mist-mask`, `morning-mist-mask`,
`map-demo`. Reste **401 sprites** à proprement parler.

### `_lit` et `_lit_m` ne sont pas de l'art en plus

`render/normal-map.ts` dérive d'un albédo sa carte de normales et enregistre le couple sous `<clé>_lit`
(pipeline d'éclairage, spec da-feeling R1). `_lit_m` est le **miroir pré-retourné** du même dessin — une
symétrie, pas un second dessin. Les compter comme des sprites doublerait l'inventaire pour rien.

**Depuis le 2026-08-27, le miroir est la règle et non l'exception** (demande d'Alexis : « la même technique
pour tout sprite qui correspond à quelque chose de dressé »). Les 23 miroirs du clutter sont devenus **374** :
tout ce qui se tient debout — arbres (fûts et cimes), murs, murets, mobilier, lieux, socles minéraux, bornes
de seuil, nœuds récoltables — passe par `registerLitPaire`, qui pose la paire d'un coup. Ce qui n'en a pas
le dit : au ras du sol (lichen, branche tombée, dalle de gué, tarn, friche) ou symétrique au pixel (les
humains). Trois familles gardent une exception motivée — la **porte** (son vantail s'ouvrirait à l'envers)
et les **masques d'autotile asymétriques** (le retourné du masque 6 est le sprite du masque 12, qui existe
déjà : seuls les sept masques que le miroir laisse en place ont un retourné).

## Les familles

*(Relevé du 2026-08-27, `pnpm smoke --scenario textures`. Les clés de cime portent leur `_lit` au
milieu — `nd-<slug>_crown_lit-<cime>` — d'où un compte `_lit` de `nd-` bien supérieur à ses bases.)*

| préfixe | base | `_lit` | `_lit_m` | ce que c'est | peint dans |
|---|---:|---:|---:|---|---|
| `st-` | 275 | 206 | 84 | structures, murs, meubles, sol/toit | `BootScene.ts` (les 16×16 de base) + `render/bati-art.ts` (murs, clôtures, encadrements, usures) + `render/lit-structures.ts` (`_lit`) |
| `nd-` | 56 | 222 | 218 | nœuds récoltables + les cimes et fûts d'arbres, cinq cimes par variante | `BootScene.ts` + `render/lit-trees.ts` + `render/lit-props.ts` |
| `it-` | 92 | — | — | icônes d'objets, une par `ItemId` | `render/item-art.ts` |
| `poi-` | 50 | 57 | 47 | 33 lieux + 18 couronnes + les trois erratiques | `scenes/world/poi-art.ts` + `render/poi-lit.ts` / `poi-lit-defs.ts` |
| `fx-` | 97 | — | — | effets : sang, terrier, plouf, poissons, feuilles, bancs de brume, halos | `BootScene.ts`, `eau-fx.ts`, `poissons-ombres.ts`, `feuilles-derive.ts`, `mist-banks.ts`, `fire-fx.ts`, `night-veil.ts`, `fire-ground-glow.ts`, `contact-shadow.ts` |
| `spr-` | 50 | 2 | — | acteurs : avatar, PNJ, Cendreux, faune et ses poses | `BootScene.ts` (`makeSprite`, `makeFauna`) |
| `cl-` | 25 | 24 | 22 | *clutter* : touffes, buissons, troncs, cailloux, fleurs, lichen | `render/lit-props.ts` |
| `pave-` | 18 | — | — | le sol dessiné : pavés autotile | `render/paves.ts` |
| `cf-` | 16 | — | — | falaise vue de dessus : 8 masques × 2 variantes | `render/cliff-art.ts` |
| `essai-` | — | 14 | — | les planches d'essai DA (hors jeu) | `render/essai-da-caillou.ts` |
| `vt-` | 5 | — | — | icônes de vitales : PV, endurance, faim, température, charge | `render/vital-art.ts` |
| `ic-` | 4 | — | — | pictogrammes d'interface | `render/item-art.ts` |
| `seuil-` | 3 | 3 | 3 | bornes de seuil (entière, brisée, couronne) | `scenes/world/borne-layer.ts` |
| `water-` | 3 | — | — | champs pleine-carte : nappe, fond, rive | `scenes/world/water-layer.ts` |
| `gue-` | 1 | 1 | — | pierre de gué — **couchée**, donc sans miroir | `scenes/world/gue-stones.ts` |
| `glow` | 1 | — | — | halo radial doux (le seul en filtrage LINEAR) | `BootScene.ts` |
| `combe-`, `morning-` | 2 | — | — | masques de brume, pleine carte | `combe-mist.ts`, `morning-mist.ts` |
| `map-` | 1 | — | — | `map-demo`, le terrain peint en une texture | `WorldScene.ts` |

### Le détail des grosses familles

**`st-` (174)** — la famille explose par **variantes de masque**, pas par nombre de sujets. Un mur existe en
`st-wall` + 16 masques de voisinage (`-0`…`-15`) + 15 « coupés » (`-e1`…`-e15`) + 15 `-coupe-e*`, et le tout
re-décliné en `-ruine`. Idem clôtures (`st-cloture-*`), encadrements, terre et friche. Les sujets *distincts*
sont : mur, porte, sol, toit, coffre, atelier, four, enclume, four à acier, tour méca, atelier lourd, silo,
cave, réserve, parcelle, serre, terroir, maison, feu (`st-fire`), plus le mobilier de `bati-art` (table, banc,
étagère, tonneau, âtre, poutre, abreuvoir, meule, paillasse, mur bas).

**`poi-` (48)** — **32 lieux** peints depuis la table `POI_ART` ; **16** d'entre eux ont en plus une
**couronne** (`-crown`), la part haute redessinée au-dessus des houppiers. Les `_lit` sont plus nombreux que les bases (55 pour 48) car
`poi-lit.ts` ajoute des sujets qui n'ont pas d'albédo autonome : les trois erratiques (`poi-erratique-0..2`,
chacun avec sa `-curl`) et les couronnes de `poi-cabane` / `poi-ferme_ruinee`.

**`spr-` (23)** — 4 sujets debout (`player`, `npc`, `cendreux`, `corpse`) et 19 clés de faune, qui
sont des **poses** : cerf (debout, broute, fuit, couché), lapin (debout, broute, fuit), sanglier (debout,
fouille, charge), loup (debout, traque, mange, alpha), oiseau (posé, picore, alerte, envol, en vol). Tailles de
12×9 à 36×28 px. Seuls `spr-player` et `spr-npc` ont un `_lit`.

**`cl-` (25)** — le premier jeu **entièrement** normal-mappé et miroité, et le patron de tous les autres
depuis le 2026-08-27 (25 base / 24 `_lit` / 22 `_lit_m` — le lichen et la poussière sont des taches sur le
sol, pas des masses debout) : c'est le décor le plus dense à l'écran, donc celui qui doit le moins se répéter.

## Ce que ce relevé ne contient pas

Un dump ne voit que ce que la session a effectivement généré. Familles **conditionnelles**, absentes ici et
attendues ailleurs :

- **`cendre-<suffixe>`** — `scenes/world/cendre-layer.ts`, peint à taille de carte. N'existe qu'à partir de
  l'acte III (jour 58). Se relève avec `pnpm smoke --scenario cendre --dev`.
- **`map-fog`** — `scenes/UIScene.ts:417`, le brouillard de la carte. Créé à la première ouverture de l'écran
  de carte, jamais avant.

Rien d'autre : toutes les autres clés déclarées en source (`fx-ember`, `fx-night-hole`, `fx-fire-ground`,
`fx-contact-shadow`, les bancs de brume, les poissons, les feuilles) étaient bien présentes au boot.

## Ce qui n'est pas peint

Deux `.woff2` (JetBrains Mono 400 et 700), embarqués depuis `@fontsource`. C'est le seul binaire livré, et
c'est du texte. L'audio est synthétisé lui aussi (`src/audio/`, WebAudio) : aucun fichier son dans le dépôt.
