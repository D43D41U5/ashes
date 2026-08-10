# L'Atelier des plans — le format `.plan` et l'éditeur graphique du bâti

*Spec du 2026-08-10. Décisions d'Alexis : éditeur **P2** (page autonome sans Phaser, vrais
albédos) et stockage **`.plan` + codegen** (voir `docs/decisions.md` du jour). Périmètre v1 :
les lieux de `BUILT_KINDS`. Les bourgs PNJ (`village-plan.ts` — des ordres incrémentaux, pas
des grilles) et les set-pieces du worldgen sont HORS périmètre, chacun une décision à part.*

## Le principe

Deux invariants qui ne se négocient pas :

1. **L'éditeur ne réimplémente aucune dérivation.** L'aperçu exécute le VRAI moteur dans la
   page — `/sim` est pur, il tourne au navigateur : `createSim` + `batirLieu` produisent les
   structures (murs dérivés du pourtour, sort, rotation), l'éditeur ne fait que les PEINDRE.
   Seule la composition d'image lui appartient, et c'est sa limite assumée : albédos réels,
   mais ni lumière ni normales — le juge final reste le jeu (`pnpm smoke --scenario lieux-batis`).
2. **Les gardes restent la loi.** `verifierPlans`, la traversabilité, le déterminisme et la
   parité d'amorce vivent en vitest comme avant ; l'éditeur les EXÉCUTE en direct pour le
   confort, il ne les remplace jamais.

## Le format `.plan`

Un fichier par lieu : `packages/sim/src/plans/<kind>.plan` — le nom du fichier EST le kind.

```
# ═══ LA CABANE DE BERGER ═══
#
# La prose du lieu vit ICI, en lignes #, et survit à l'éditeur.
usure: 1
seuils: 2,3,S
grille:
·····
·:::·
·L:K·
·:::·
·····
```

- Lignes `#` et lignes vides : commentaires, ignorés du parseur, PRÉSERVÉS par l'éditeur
  (sauvegarde chirurgicale : seules les lignes de données changent).
- Métadonnées `cle: valeur` — `usure` (nombre, requis), `breches`/`seuils`/`passages`
  (triplets `x,y,D` séparés d'espaces), `fixe` (`oui`).
- `grille:` en DERNIER : toutes les lignes non vides / non-`#` qui suivent sont les rangées.

## Critères d'acceptation

- **A1 — le parseur est pur et honnête.** `parserPlan` (`packages/sim/src/plan-format.ts`,
  zéro fs, zéro Node) rend un `Plan` identique à l'ancien littéral pour les neuf lieux ;
  toute entrée invalide (usure absente, grille non carrée après `verifierPlans`, clé inconnue,
  triplet malformé) échoue avec un message en français, jamais silencieusement.
- **A2 — la sauvegarde est chirurgicale.** `serialiserPlan(texteOriginal, plan)` ne réécrit
  que les lignes de données ; toute ligne `#` survit au round-trip, et
  `parserPlan(serialiserPlan(t, parserPlan(t)))` ≡ `parserPlan(t)`.
- **A3 — le généré est gardé.** `tools/plans-compile.mts` émet
  `packages/sim/src/plans-batis.genere.ts` (déterministe : deux exécutions, mêmes octets ;
  kinds en ordre alphabétique), commité. Une garde vitest reparse les `.plan` (import `?raw`)
  et exige l'égalité profonde avec le `PLANS` importé — éditer un `.plan` sans régénérer
  rougit la suite.
- **A4 — le moteur ne bouge pas.** `buildPoiStructures` garde les dérivations (sort,
  orientation) et délègue à `batirLieu(state, plan, x0, y0, sort, quart)` ; les suites
  passent inchangées, le déterminisme (A6 lieux-batis) et la parité d'amorce (A5) tiennent.
- **A5 — l'éditeur est dev-seulement.** `atelier.html` est servi par `pnpm dev` et ABSENT de
  `dist` ; l'endpoint (`/atelier/api/plans`) n'existe qu'en serve, borné au dossier `plans/`,
  kinds `[a-z_]+` seulement.
- **A6 — la palette se dérive.** Les caractères proposés viennent de `LEGENDE` (exportée),
  jamais d'une liste recopiée ; une pièce sans albédo hors-Phaser s'affiche en tuile neutre
  + glyphe et se DÉCLARE dans le panneau (jamais silencieuse).
- **A7 — l'aperçu montre ce que le moteur a bâti.** Grille peinte au clic, arêtes
  brèches/seuils/passages au clic (édition en orientation 0), bascules sort
  (intact/pillé/brûlé), quart de tour, usure ; les toits levés de `MUR_HT` avec bascule
  dedans/dehors. Chaque édition rebâtit via `batirLieu` — jamais un dessin direct de la grille.
- **A8 — la validation bloque.** `verifierPlans` + traversabilité dedans↔dehors affichées en
  direct ; une erreur interdit la sauvegarde (le bouton le dit).
- **A9 — la boucle complète.** POST → le `.plan` réécrit + le module régénéré (le MÊME
  émetteur que `pnpm plans`) → HMR du jeu en dev. Un smoke `atelier` charge la page, vérifie
  la liste (= `BUILT_KINDS`), peint une case, lit la validation, capture.
