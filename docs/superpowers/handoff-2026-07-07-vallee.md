# Handoff — la Vallée (état au 2026-07-07)

Pour reprendre le travail sur la carte dans une future session. Deux sous-projets livrés, un lot différé.

## Livré et mergé sur `main`

### Sous-projet 1 — la Vallée de la Veillée 192×192
Spec `docs/superpowers/specs/2026-07-06-vallee-veillee-design.md`, plan `…/plans/2026-07-06-vallee-veillee.md`.
Générateur `packages/sim/src/valleygen.ts` (squelette déclaratif + chair procédurale, GDD §9) ;
squelette de la carte solo dans `valley-veillee.ts` (`VEILLEE_SKELETON`, `VEILLEE_SITES`). Terrain
`marsh` ajouté. Les villages PNJ ont été **retirés de la Veillée** en jeu (le banc `scenario.ts`
les garde) — décision « finir une map vivante d'abord ».

### Sous-projet 2 — la Vallée organique
Spec `…/specs/2026-07-06-vallee-organique-design.md`, plan `…/plans/2026-07-06-vallee-organique.md`.
8 tâches TDD, revue finale « prêt à merger avec corrections », corrections sûres appliquées
(commit `e2d3d1c`, behavior-preserving, terrain prouvé byte-identique). Contenu :
- **Contours bruités** : `stampBlob` (berge du Lac irrégulière), roche de biome en **amas** (fbm) au
  lieu de confetti, enceinte multi-octave + éboulis + crête bruitée (anneau externe toujours scellé
  par `sealBorderRing`).
- **Réseau d'eau** (`valleygen-water.ts`) : ruisseaux peu profonds franchissables (jamais bloquants)
  tracés vers l'eau la plus proche, étangs rares (exclus bordure/clairières). Par densité.
- **Mines** (`valleygen-mines.ts`) : galeries dans la bordure — une profonde (gisement fer+charbon,
  artisanale) + carrières de pierre procédurales (`kind:'carriere'` dans `generateNodes`). Collines
  dégagées et habitables.
- **Scalabilité** : aucune quantité en dur, tout est `round(densité × mesure)` lu des dimensions ;
  prouvé par le test R6 à deux tailles. Primitives partagées dans `valleygen-primitives.ts`.

**Convention** : les densités/amplitudes de carte sont du **contenu** (à côté du générateur), pas de
l'équilibrage (`balance.ts`).

## Lot DIFFÉRÉ — « la mine » (mémoire `[[mine-follow-up]]`)

Décidé le 2026-07-07 : reporté car rebat les nœuds et exige un recalibrage du scénario.
1. **La mine profonde n'est pas encore creusée DANS la bordure** — `carveGallery` creuse vers
   l'intérieur → chambre en terrain ouvert des Collines (roche 3+ tuiles plus loin). Clairière-avec-
   minerai adossée, pas un tunnel. Marqué `// TODO (suivi mine)` dans `valleygen-mines.ts` /
   `valley-veillee.ts`. Fix : creuser VERS la bordure + garantir la roche autour de la chambre.
2. **Longueur de galerie figée** (14/6, mouth `base+1`) vs bordure ~3·base → chambre enclavée si
   `borderThickness ≥ 6`. VEILLEE (base 4, seed 2026) OK mais latent. Fix : longueur ∝ borderThickness.

**Racine commune** (vaut un ticket à part) : `generateNodes` tire son RNG **ligne par ligne**, donc
tout changement de terrain décale l'écosystème entier (c'est l'origine de l'incident de calibrage T8
et le même mécanisme que le livelock milice, mémoire `[[milice-livelock]]`). Passer à des tirages
**positionnels** `hash2(tx,ty,seed)` découplerait le placement des nœuds des changements de terrain
et supprimerait cette fragilité — à faire avant/avec le lot mine.

## Autre chantier ouvert connu

- **Le Pont à deux niveaux** (sous-projet 2 du travail carte) : passer du blob rond à une travée
  droite en bois + pouvoir passer dessous par le bas-fond. C'est une vraie mécanique (état `onBridge`,
  collision par niveau, profondeur au rendu, flag snapshot) — son propre cycle brainstorm→spec→plan.
- **Calibrage moyen terme** : le scénario 60 jours s'effondre (dette pré-existante `balance.ts`,
  documentée dans `docs/decisions.md`).

## Comment reprendre

Lire d'abord `braises-gdd.md` (§9 carte, §8 économie). Le générateur est pur et testé : itérer par
`pnpm --filter @braises/sim exec vitest run src/valleygen.test.ts src/valley-veillee.test.ts`, puis
`pnpm scenario` pour la non-régression écosystème, puis smoke navigateur (build + preview, cf. mémoire
`[[browser-smoke-test]]`). Ajuster le **squelette** (contenu), jamais le sens des tests.
