# Design — La Vallée de la Veillée (192×192)

**Date** : 2026-07-06 · **Statut** : validé en brainstorming, en attente de relecture écrite

## Objectif

Remplacer la carte de démo procédurale 64×64 (`packages/client/src/demo-map.ts`) par une
vallée 192×192 plus intéressante pour la Veillée solo (GATE 1) : des lieux nommables, une
variété de terrain lisible, une navigation au paysage plutôt qu'au bruit uniforme.

Approche retenue : **squelette déclaratif + chair procédurale** — la décision actée du
GDD §9 (« squelette artisanal, chair procédurale ») transposée en code, sans éditeur
externe. Tiled reste l'outil des vraies cartes (V9/S0, roadmap) ; le squelette déclaratif
est exactement ce que l'import Tiled remplira plus tard — l'architecture ne sera pas à
refaire.

Décisions cadrées en session : cible = Veillée solo d'abord ; priorités = landmarks,
variété de terrain, lisibilité ; tout en code ; 192×192 (traversée ~1 min à pied).

## La géographie

Une enceinte montagneuse ferme la carte, percée d'un seul passage (le Col). La rivière
descend du nord-est et se jette dans un lac au sud. Deux franchissements — le Pont (sur
la route, rapide, exposé) et le Gué (au nord, détour, eau peu profonde lente) : chaque
trajet vers la Mine est un choix.

```
┌─────────────────────────────────────────┐
│ ▲▲▲▲▲▲▲▲▲▲▲ le Col ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ │
│ ▲ le Plateau ═╨═  ~riv.~   ▲▲▲▲▲▲▲▲▲▲▲ │
│ ▲  (sauvage)      ~~  le Gué  Collines ▲│
│ ▲ la Vieille Forêt ~~   ≋  la Mine     ▲│
│ ▲  ♣♣♣♣♣♣♣        ~~        du Levant  ▲│
│ ▲ ♣♣ tanières ♣  ~~~                   ▲│
│ ▲                ~~                    ▲│
│ ▲ la Plaine ── la Croisée ═ le Pont ══ ▲│
│ ▲ (spawn,       │        ~~    village ▲│
│ ▲  vill. Foyer) │       ~~~    Meute   ▲│
│ ▲            le Hameau  ~~~            ▲│
│ ▲            (ruines)  le Lac          ▲│
│ ▲▲▲▲▲▲▲▲▲▲▲▲ le Marais ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲ │
└─────────────────────────────────────────┘
```

### Cinq régions au caractère marqué

| Région | Où | Caractère |
|---|---|---|
| la Plaine | ouest | Prairies, bosquets épars. Cercle domestique : spawn, village Foyer, sûr et médiocre. |
| la Vieille Forêt | nord-ouest | Massif dense percé de clairières, tanières de sangliers. Bois abondant, visibilité nulle. |
| les Collines du Levant | nord-est | Éboulis rocheux, la Mine (`kind: 'gisement'`, fer + charbon). Y aller coûte : Pont ou Gué. |
| le Marais et le Lac | sud | Terrain `marsh` (0.6×), fibres et baies riches, zombies. Bonne récolte parce qu'on y est vulnérable. |
| le Plateau | nord, derrière le Col | Cercle sauvage : cul-de-sac dangereux hors des routes, contenu haut risque pour plus tard. |

### Landmarks nommés (chacun une `Zone` → HUD et chronique)

le Col, le Gué, le Pont, la Croisée (carrefour des routes), le Hameau abandonné (ruines
pillables, zombies), la Mine du Levant, la Clairière (spawn), les tanières.

### Routes

Une principale ouest-est (Clairière → Croisée → Pont → Mine), deux sentiers (nord vers
le Gué et la Forêt, sud vers le Hameau et le Marais). À 1.25×, la route concentre le
trafic — la structure du GDD §8 en miniature.

### Villages PNJ

Le Foyer dans la Plaine près du spawn (donateur, comme aujourd'hui) ; la Meute à l'est
du Pont — sur la route de la Mine.

## Architecture

### Nouveau module pur : `packages/sim/src/valleygen.ts`

La génération quitte le client pour `/sim` — le scénario appartient à l'hôte, et la LAN
réutilisera ce module tel quel.

```ts
// Le squelette — de la donnée artisanale, pas du code de dessin
interface ValleySkeleton {
  width: number; height: number
  river: { x: number; y: number }[]        // polyligne, élargie en eau profonde + berges
  roads: { x: number; y: number }[][]      // polylignes, tracées en route
  crossings: { kind: 'bridge' | 'ford'; x: number; y: number }[]
  regions: Region[]                         // rect + params de biome (densité forêt/roche/marais)
  landmarks: Zone[]                         // deviennent map.zones telles quelles
}

function generateValley(skeleton: ValleySkeleton, seed: number): WorldMap
```

Ordre de génération : enceinte montagneuse bruitée → biomes des régions (bruit de valeur
multi-octaves sur `hash2`, déplacé dans `/sim`) → rivière + lac → routes et
franchissements (qui *percent* forêt et berges — connectivité garantie par construction)
→ clairières et ruines des landmarks → zones. Uniquement des opérations autorisées par
l'invariant de déterminisme (`imul`, arithmétique entière — pas de `sin`/`pow`).

Le squelette de la Veillée est une constante exportée (`VEILLEE_SKELETON`) à côté du
générateur — `veillee.ts` (client) et `scenario.ts` (calibrage `pnpm scenario`)
consomment la même vallée.

### Changements périphériques

- `balance.ts` : `TERRAIN_MARSH = 8` (marchable, `speedFactor 0.6`) — seul nouveau terrain.
- `demo-map.ts` : supprimé ; `WorldScene` ne change presque pas (la carte arrive déjà
  par le message `ready` ; une couleur pour le marais, l'import de `hash2` repointé).
- `veillee.ts` : consomme `VEILLEE_SKELETON`, repositionne villages/monstres/spawn sur
  les nouveaux landmarks (tanières → sangliers, Marais et Hameau → zombies).
- `docs/decisions.md` : une ligne (vallée 192×192, squelette déclaratif en code, Tiled
  reporté aux vraies cartes).

### Ce qui ne change pas

Le format `WorldMap` (grille + zones), l'importeur Tiled, `generateNodes` (la chair
« ressources » existante tourne telle quelle sur la nouvelle carte), le protocole client
(la carte est envoyée une fois dans `ready` ; texture générée 3072 px, sans enjeu).

## Critères d'acceptation (`valleygen.test.ts`)

1. **Déterminisme** : même seed → même `terrain` (bit à bit) et mêmes zones.
2. **Connectivité** : flood-fill depuis le spawn → chaque landmark marchable est
   atteignable (le test le plus important : une Mine inaccessible = vallée cassée).
3. **Présence** : tous les landmarks du squelette existent en zones ; la Mine a
   `kind: 'gisement'`.
4. **Sanité** : proportion de tuiles marchables dans une fourchette (55-80 %), enceinte
   étanche (tout le bord hors-col est bloquant).
5. **Chair** : `generateNodes` sur la vallée produit fer/charbon dans la Mine et des
   ressources T1 (arbres, baies, fibres) en Plaine.

## Estimation

`valleygen.ts` ~250-350 lignes + squelette ~80 lignes de données + tests. Un lot.
