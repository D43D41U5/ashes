# L'Atelier des plans — le format `.plan` et l'éditeur graphique du bâti

*Spec du 2026-08-10. Décisions d'Alexis : éditeur **P2** (page autonome sans Phaser, vrais
albédos) et stockage **`.plan` + codegen** (voir `docs/decisions.md` du jour). Périmètre v1 :
les lieux de `BUILT_KINDS`. Les bourgs PNJ (`village-plan.ts` — des ordres incrémentaux, pas
des grilles) et les set-pieces du worldgen sont HORS périmètre, chacun une décision à part.*

## Le principe

Deux invariants qui ne se négocient pas :

1. **L'éditeur ne réimplémente RIEN — ni la dérivation, ni le rendu.** L'aperçu exécute le
   VRAI moteur dans la page (`/sim` est pur : `createSim` + `batirLieu` produisent les
   structures), et le RENDU est celui du jeu (décision d'Alexis du 2026-08-10, après avoir
   jugé illisible un composeur d'albédos) : la page embarque un `Phaser.Game` — le vrai
   `BootScene` génère les textures, l'`AtelierScene` rend par le vrai `SnapshotView` avec
   `DynamicLighting` (heure réglable). L'avatar fictif (`spawnEntity`) dedans/dehors fait
   jouer les VRAIES règles de révélation (nappe, pans). Hors-jeu assumé : le sol est un
   aplat d'herbe, ni brouillard ni météo — le monde complet se juge dans le jeu.
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
  jamais d'une liste recopiée ; les vignettes sont les albédos réels (`albedosAtelier`).
- **A7 — l'aperçu EST le jeu.** Chaque édition rebâtit via `batirLieu` et s'applique au vrai
  `SnapshotView` — jamais un dessin direct de la grille. Peinture au clic, arêtes
  brèches/seuils/passages au clic (édition en orientation 0), bascules sort/quart/usure,
  avatar dedans/dehors (les règles du jeu décident de ce qui s'efface), heure d'éclairage.
  Trois aides d'édition (demande d'Alexis) : la GRILLE par tuile (commutable, au-dessus de
  tout), le FANTÔME au survol (pièce translucide en vraie texture, liseré coloré sur l'arête
  visée, contour pour la gomme), la GOMME (outil, ou clic droit partout : le triplet de
  l'arête visée s'il existe, sinon la case redevient `·`).
- **A8 — la validation bloque.** `verifierPlans` + traversabilité dedans↔dehors affichées en
  direct ; une erreur interdit la sauvegarde (le bouton le dit).
- **A9 — la boucle complète.** POST → le `.plan` réécrit + le module régénéré (le MÊME
  émetteur que `pnpm plans`) → HMR du jeu en dev. Un smoke `atelier` charge la page, vérifie
  la liste (= `BUILT_KINDS`), peint une case, lit la validation, capture.

## L'Atelier PRO — l'Établi et les paquets (décisions d'Alexis, 2026-08-10)

Direction retenue sur maquettes : **l'Établi** (trois zones + barre d'outils + barre d'état,
école LDtk) avec les vignettes de variantes dans l'inspecteur, et tous les paquets. Critères
par étage — chaque étage se livre VÉRIFIÉ (smoke + captures) avant d'ouvrir le suivant :

- **P-A — le geste (l'étage 1, non négociable).** Annuler/refaire illimité par lieu
  (Ctrl+Z / Ctrl+Y, une entrée par TRAIT de pinceau, pas par case) ; glisser-peindre (et
  glisser-gommer) ; pipette (Alt+clic) ; raccourcis (chiffres = palette, B/E = outils) ;
  badges d'arêtes PERMANENTS (brèche rouge, seuil ambre, passage vert — visibles en
  orientation 0, commutables) ; zoom molette + pan (Espace ou bouton du milieu) avec
  recadrage ; indicateur ● modifié (barre d'état + liste des lieux).
- **P-Établi — le layout.** Barre d'outils (outils + raccourcis affichés, annuler/refaire,
  zoom, calques : toits / régions / arêtes / grille) ; gauche : lieux + palette (raccourcis
  affichés) ; centre : viewport ; droite : inspecteur (métadonnées, sort, avatar, heure,
  validation) ; bas : barre d'état (tuile + caractère sous le curseur, fautes, ● modifié).
  Le calque « toits » filtre les toits du snapshot montré — jamais un état de sim.
- **P-B — la sélection.** Rectangle ; copier/couper/coller/déplacer ; miroir H/V ; tampons
  nommés. GARDE : les triplets d'arête se transforment AVEC la sélection (N↔S, E↔O au
  miroir, rotation par quart) — testé à froid, le patron de `rotate()`.
- **P-C — les variantes.** Bande rotations/sorts/nuit en vignettes VIVANTES dans
  l'inspecteur + export PNG de planche. Le coût des rendus multiples se MESURE d'abord
  (patron A9 : pire seconde au décompte réel) ; au-delà du budget, re-rendus séquentiels
  en texture plutôt que vues simultanées.
- **P-D — le monde.** « Tester en jeu » (Veillée dev + téléport au premier exemplaire du
  kind) ; diff brouillon ↔ disque ; historique git du `.plan` (lecture seule).
- **P-E — la création.** Nouveau lieu, duplication, redimensionnement d'empreinte — côté
  ÉDITEUR seulement une fois la décision de jeu prise (la naissance d'un kind touche
  `POI_TYPES`, le recensement A7 et le semis : décision d'équilibrage à trancher à part).
