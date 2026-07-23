# Sprint POLISH AAA — porter l'existant au standard AAA

> **Mandat (Alexis, 2026-07-23).** Améliorer le jeu EXISTANT le plus loin possible — UX, UI, rendu, mapgen, feel de gameplay, gestion des sauvegardes, options — pour atteindre un **standard AAA**. **CONTRAINTE DURE : aucun NOUVEAU système de gameplay.** S'organiser comme un studio de 20 personnes (rôles/expertises), s'inspirer des meilleurs hits du marché, refontes profondes de la code-base autorisées.

## Le cadre

- **Ce qu'on fait** : polir, raffiner, approfondir, rendre plus beau/lisible/satisfaisant ce qui existe. Rendu (par la technique, pas des assets dessinés — on n'a pas d'artiste), UI/UX/juice, worldgen (déterministe pur), sauvegardes, options, feel.
- **Ce qu'on NE fait PAS** : de nouveaux systèmes/verbes de gameplay. (L'agriculture était le dernier.) On ne rouvre pas non plus le chantier IA-village (en pause).
- **Invariants non négociables** (rappel) : `/sim` pur et déterministe au bit près (pas de `sin/cos/pow`, pas de `Math.random`/`Date`, le décompte d'entités décale le PRNG) ; FX lumière pixellisés (alpha, pas taille) ; timing UI sur l'horloge Phaser ; palette encre+2 accents ; typo mono (`typography.test`). Vérifier à CHAQUE étape (`pnpm check`, tests, `lint`, smokes).

## Le process (production lead)

1. **Audit spécialiste** (fait) — 4 panels : rendu/atmosphère, UI-UX/juice, worldgen, saves/options. Chacun : références marché + audit code + liste priorisée d'améliorations buildables.
2. **Synthèse → backlog priorisé** (impact AAA × faisabilité × risque). Ci-dessous.
3. **Exécution en VAGUES** — une tranche verticale à la fois, menée au vert (tests + smoke) avant la suivante. Client-only d'abord (risque nul) ; `/sim` (worldgen) traité comme danger de déterminisme.
4. **Vérif visuelle** systématique au smoke pour tout ce qui se voit.

## Backlog priorisé — à remplir depuis les audits

*(Rempli au retour des 4 panels. Rangé par vague.)*

### Vague 1 — les plus gros leviers, client-only, risque nul
_(à définir)_

### Vague 2 — approfondissements
_(à définir)_

### Vague 3 — worldgen (déterministe) + saves
_(à définir)_

## Journal du sprint
_(chaque tranche livrée = une ligne, comme decisions.md)_

- **V1.1 — JUS des boucles FABRIQUER / MONTER DE MÉTIER** (audit UI/UX P0, « le trou le plus visible au regard du standard AAA »). Deux bandeaux dédiés, branchés sur `item_crafted`/`skill_level_up` (jamais le clic), signature plus lourde qu'une récolte (chip **FABRIQUÉ**, bandeau doré 2 lignes **NIVEAU**), lueur du palier gatée reduced-motion. Libellés de métier dédupliqués (`ui/skill-labels.ts`). Smoke `juice` (fige la boucle Phaser pour capturer les toasts malgré l'horloge headless rapide). Client-only, zéro `/sim`. Détail : `docs/decisions.md`.
