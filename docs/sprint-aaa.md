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

- **V1.4 — GARDE-FOU d'effacement sur « nouvelle Veillée »** (saves). Le bouton du menu pause effaçait la partie au PREMIER clic, sans retour, à côté de « REPRENDRE ». Confirmation explicite (rouge d'alerte) qui nomme ce qu'on perd ; désarmée à la fermeture. Pas de garde-fou à la stèle de fin de saison (rien à protéger). Deux bugs attrapés par la CAPTURE et non l'assertion (`[hidden]` écrasé par `display:flex` ; confirmation sous le pli). Détail : `docs/decisions.md`.
- **V1.3 — les ombres de contact s'étendent aux NŒUDS** (rendu #1b, décidé sur capture). La futaie flottait encore autour d'un avatar posé : même fonction, pool parallèle au `nodePool` servi/libéré par le même compteur. Décor plat toujours exclu.
- **V1.2 — OMBRES DE CONTACT sous les acteurs** (rendu #1). Les billboards flottaient ; une flaque sombre bakée en NEAREST les pose au sol. Noir en alpha normal (pas MULTIPLY), CENTRÉE (pas de `sunDirection` — ce serait la promotion de l'éclairage dynamique, réservée à Alexis), constante. Posée depuis `syncActor` via `setData('shadow')` — un seul point, joueur + autres. Bornée aux ACTEURS ; troncs = suite, décor plat = jamais. Smoke `ombres`. Détail : `docs/decisions.md`.
- **V1.1 — JUS des boucles FABRIQUER / MONTER DE MÉTIER** (audit UI/UX P0, « le trou le plus visible au regard du standard AAA »). Deux bandeaux dédiés, branchés sur `item_crafted`/`skill_level_up` (jamais le clic), signature plus lourde qu'une récolte (chip **FABRIQUÉ**, bandeau doré 2 lignes **NIVEAU**), lueur du palier gatée reduced-motion. Libellés de métier dédupliqués (`ui/skill-labels.ts`). Smoke `juice` (fige la boucle Phaser pour capturer les toasts malgré l'horloge headless rapide). Client-only, zéro `/sim`. Détail : `docs/decisions.md`.
- **V1.6 — MOUVEMENT RÉDUIT, garde-fou GLOBAL** (accessibilité). 2 modules sur ~11 respectaient `prefers-reduced-motion` ; une règle unique dans `index.html` couvre tout l'existant ET le futur. Écrase la DURÉE (0.01ms) et non `none`, sinon `transitionend` ne se déclenche plus et le voile de mort — qui n'a pas de timer de secours — resterait à l'écran. Smoke `mouvement` prouve la règle dans les deux sens + rejoue le cycle du voile.
- **V1.5 — VIGNETTE** (rendu #2, moitié libre). Bords assombris vers l'encre : l'image gagne un centre. En DOM (un post-FX Phaser risquait de rendre blanc sous swiftshader = perte du juge visuel). N'ajoute AUCUNE teinte — l'étalonnage, lui, est différé à Alexis (invariant « encre + 2 accents »). Assertion : `elementFromPoint` au centre renvoie le CANVAS (sinon la vignette mangeait tous les clics monde).
- **V1.7 — INDICATEUR DE SAUVEGARDE** (saves). La sauvegarde était déjà solide (autosave 30 s, écriture à la sortie) mais MUETTE. L'hôte répond `saved {at, ok}` ; le HUD dit « partie sauvegardée » (fugace) et « SAUVEGARDE IMPOSSIBLE » (rouge, permanent) — un échec silencieux est pire que pas d'indicateur. Testé de bout en bout (ESC → écriture réelle → message → HUD). Ajout de TYPE seul dans `/sim`.
