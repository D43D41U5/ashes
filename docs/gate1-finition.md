# Finition GATE 1 — backlog priorisé

> **Nature.** Ce document est la liste de finition de la boucle solo (Veillée) en vue du **GATE 1** (« la boucle solo est-elle fun 5 sessions d'affilée ? »). Il naît d'un audit d'état réel (code + `decisions.md` + `axes-amelioration-phase2.md` + `audit-gameplay-phase1.md`), pas d'une relecture de backlog. Établi le 2026-07-23.

## Le fait cardinal

**Le périmètre solo *constructible en aveugle* est épuisé.** La campagne des 22-23 juillet a livré V0-1→V2-25 (parade, bandage, palier du Feu, upkeep + Feu tuable + ruine, villages voisins + verbes chauds, médecin, cuir + froid létal, acier, richesse↔danger, coût de mort, Arche, réfugiés, persistance, mort-suite, télégraphe Cendre). Vérifié au grep : les chemins de code existent et sont testés.

**Mais `livré-en-code ≠ prouvé-fun`.** Rien n'a encore été *joué* 5 sessions. Ce qui reste pour GATE 1 se répartit en trois natures :

1. **Calibration playtest** (le vrai reste) — presque chaque nombre livré est « ordre de grandeur, à valider ». → Décisions d'Alexis, au banc `pnpm scenario` + sessions réelles. Je peux *instruire* (faire tourner le banc, rapporter, recommander), pas *trancher*.
2. **Décisions réservées à Alexis** — chantier IA-village **en pause et flaggé** (ne pas rouvrir), esthétique audio (oreilles d'Alexis), sémantique du finale.
3. **Résidu de finition constructible** — ma voie. C'est ce backlog.

---

## Backlog de finition (ma voie) — classé par valeur GATE 1 × constructible-en-mandat

### P0 — Onboarding contextuel (la menace GATE 1 nommée par l'audit)
Les hints d'accueil sont **pilotés par un minuteur** (`WorldScene.ts:1236` : 2 s / 12 s / 24 s), pas par l'**état** du joueur. Un joueur qui a déjà fait un feu se fait quand même dire « il vous faut un feu ». Le canal conseil neutre existe déjà (P2-7, `hintText`). → Passer les hints à un déclenchement **par état** (a du bois → « fonde un Feu » ; Feu bas → « nourris-le » ; voisin proche → « donne, ou pille » ; nuit qui tombe sans feu → alerte). **Client only, risque de déterminisme nul.** Le plus fort ratio valeur/effort restant.

### P1 — Soin d'allié (résidu V1-10, referme le verbe chaud)
Le `give` est câblé (`aim.ts:205`), le bandage sur allié existe en sim (spec combat). Reste à confirmer/finir que le client permet de **panser un PNJ allié** (viser un membre/`isOutsider` blessé, fibres en main). Referme le dilemme chaud au-delà du seul « donner ». **Petit, client (+ vérif sim).**

### P2 — Passe de lisibilité & juice UI/UX (cœur du « prêt AAA » côté présentation)
À instruire depuis des captures du vrai jeu (smoke). Candidats : lisibilité des 4 jauges vitales, feedback de la ceinture (slot actif, quantités), lisibilité de la nuit, feedback de coup/parade, écran de fin de saison (verdict vs simple chronique). **Client only.** Choix esthétiques → panel d'agents + vote autorisé par le goal.

### P3 — Dette technique sûre (mienne, technique pure)
- **P3-24** `SPRINT_MAX_TIER` : seuil en dur `sim.ts:485` → `balance.ts` (viole « aucun nombre en dur »). Trivial, **valeur identique = zéro changement de comportement = zéro risque déterminisme.**
- **Resync specs** (`economie.md`, `inventaire.md`, `monde.md`, header `pnj.md`) au code livré. Dette doc, sûre.

### P4 — Instruire la calibration (QA, pas décision)
Faire tourner `pnpm scenario` (et `SCENARIO_DAYS`/`SEASON_CYCLES`) sur plusieurs seeds, rapporter populations/greniers/morts/chronique, **signaler** les nombres qui semblent cassés (froid, upkeep, danger, durée). Livrable = rapport + reco. **Alexis tranche les nombres.**

---

## Instantané de calibration — banc `pnpm scenario`, 6 cycles, seed 2026 (2026-07-23)

Passe QA (je rapporte, Alexis tune). Le banc tient sa promesse (personne ne meurt de faim, les Feux gardent leur caractère), mais un signal ressort :

| Village | Archétype | Membres J6 | Nourriture | Bois |
|---|---|---|---|---|
| le Feu du Gué | foyer | 4 | 15 | 24 |
| le Clan du Levant | **meute** | **0** | 9 | 24 |
| les Braises Hautes | neutre | 3 | 19 | 24 |

- **La Meute s'auto-détruit avant J6** (0 membre) : ses raiders meurent d'attrition. Dans le solo, le voisin Meute est censé *presser* le joueur (pilier n°1) — s'il est mort à J6, la pression sociale s'évapore avant que le joueur ne se développe. **Signal de calibration (agressivité/attrition Meute)** — déjà touché en V10 (« décrochage des raiders blessés ») mais pas résolu. À trancher/tuner par Alexis.
- Bornes du banc : lent (~5,6 min / 6 cycles) et n'atteint que l'acte I. **L'endgame** (froid létal acte III, méga-horde, évacuation, verdicts) demande un `SCENARIO_DAYS` élevé, lancé à part.
- Le `Timeout onTaskUpdate` est le flaky infra connu (`1 test passed` = OK).

## Propositions à trancher (finition non-autoriale bloquée — c'est TON ressort)

Après la passe QA, le buildable-en-aveugle est épuisé. Ce qui reste pour « prêt AAA » touche l'identité ou la voix du jeu — je le pose ici, prêt à exécuter dès ton feu vert.

1. ~~**Grappe entretien (`feed_fire` + `repair`).**~~ **✅ TRANCHÉ + FAIT (2026-07-23) :** câblés (bois + clic sur Feu/structure abîmée), onboarding mis à jour, 7 tests. Reste ta **calibration** de la vidange `FIRE_UPKEEP` en playtest.
2. ~~**Écran de fin de saison cérémoniel.**~~ **✅ FAIT (2026-07-23, vote de design 3 agents).** `ui/season-veil.ts` — une stèle terminale, sœur du voile de mort : fond chaud (on veille un monde, on ne le draine pas), verdict du joueur COURONNÉ (archétype nommé + `outcome` du /sim, teinte diégétique `warmthColor` — Foyer bleu / Meute rouge / neutre blanc, la couleur qu'a brûlée son Feu), voisins en contrepoint, chronique dépliable à ses trois poids, révélation par battements (CSS, gestes en dernier), `ROUVRIR LA VALLÉE`. Zéro serif (le vote a corrigé : `typography.test` l'exige). **DEUX points de ta voix à ratifier** (j'ai bâti le choix majoritaire/sûr, un flip est trivial) : (a) **registre** — j'ai mis VOUS (2/3, cohérent avec le voile de mort) ; un agent défendait le TU (« le jeu cesse d'être une interface pour te juger ») ; (b) **`ROUVRIR LA VALLÉE`** rejoue la MÊME vallée (seed fixe `VEILLEE_SEED`) — copie honnête ; si tu veux une vallée neuve à chaque fois, c'est un petit bump de seed dans `veillee.ts` (décision rejouabilité vs maîtrise d'un lieu connu). Et la copie de cadrage (titre « LA VALLÉE S'ÉTEINT », corps) reste tienne à peaufiner.
3. **Raffinement du garde réfugiés.** Mon correctif anti-double-envoi impose un geste par groupe. Si tu veux permettre nourrir-puis-recruter, je passe le garde de « par groupe » à « par (groupe, verbe) ». Ton appel.
4. ~~**Menu réglages / pause (nice-to-have AAA).**~~ **✅ FAIT (2026-07-23).** Menu PAUSE (ESC) : `ui/pause-menu.ts` — fige le monde solo (l'hôte se met en pause si onglet caché OU menu ouvert, `syncPause` centralisé), et surtout **rappelle les CONTRÔLES** — dont la règle centrale « l'objet en main décide du clic » enfin écrite (bois+Feu → nourrir, bois+mur → réparer, nourriture+voisin → donner, fibres+plaie → panser…). REPRENDRE + nouvelle Veillée. Grammaire du voile de mort. Nouveau smoke `pause`. *(Le mute reste sur N — un vrai curseur de volume viendra avec l'esthétique audio, ta voix.)*
5. **Calibration (au banc + tes sessions).** Le seul vrai reste de GATE 1. Signal déjà sorti : Meute auto-détruite avant J6. Je peux lancer un banc long (`SCENARIO_DAYS` élevé) sur demande.
6. **Couche de tokens couleur pour les overlays DOM (dette pré-existante, à trancher).** Une passe qualité multi-agents (reuse/simplification/altitude concordants) a pointé que TOUS les overlays DOM (`death-veil`, `menu-dom`, + les 3 fenêtres du bas, + mes `season-veil`/`pause-menu`) codent les teintes de `palette.ts` EN DUR dans leurs `<style>` inline — alors que `palette.ts` se veut « une seule source de couleurs ». La dérive est déjà là (3 rouges pour un accent unique). **Le bon niveau** (consensus des 3 agents) : injecter des CSS custom properties depuis `palette.HEX` une fois + une classe `.overlay-btn` partagée + un mini shell `createVeilShell` (glow + reflow-fondu + retrait idempotent) — PAS un `createVeil` composant (les corps divergent trop). **Je ne l'ai PAS fait** : ça touche `death-veil`/`menu-dom` (ta grammaire, hors de mon diff) et c'est une décision de cohérence de direction. Un chantier propre et borné quand tu veux — j'ai évité d'AJOUTER à la dette (mes 2 overlais neufs réutilisent `warmthColor`, un helper `reopen-veillee` partagé, etc.).

## Ce que je NE fais PAS (garde-fous)

- **Rouvrir le chantier IA-village** (P3-19/20, cuisine PNJ, portage hors camp, survie 100 % PNJ). Explicitement **en pause et flaggé** ; le commentaire du test A7 interdit de le rallumer en douce.
- **Trancher un fork de design** seul (raids en solo, froid gèle la plaine, sémantique du verdict Arche, cadence des hordes, forge=durabilité). → Je signale la conséquence, Alexis tranche, une question à la fois.
- **Toucher aux nombres d'équilibrage** comme si c'était un bug. Ce sont des décisions de calibration.
- **Les différés par design** (§E de l'audit : moral, marché franc, non-létal, besace, agriculture voie A, charrette, enseignement, maîtrises de combat). Hors GATE 1.
- **Changer un comportement `/sim`** sans traiter le risque déterminisme (isoler sur chemin neuf, jouer TOUTE la suite sim).

---

## Bugs client corrigés (QA GATE 1) — 2026-07-23

Trouvés par une passe QA du client jouable, vérifiés à la lecture du code, corrigés (client only, zéro /sim).

1. **Double-envoi des fenêtres du bas → double-dépense (HAUTE).** `fire-upgrade-prompt`, `found-village-prompt`, `refugee-prompt` fermaient « en optimiste » au clic, mais `UIScene.update` rappelle leur `update()` **chaque frame** avec la valeur du registre — inchangée jusqu'au snapshot de confirmation. La fenêtre rouvrait à la frame suivante et un second clic **renvoyait l'action**. Pour `upgrade_fire`, le handler sim retire le coût ET monte le palier à chaque appel → **double palier, double coût** ; pour les réfugiés, **double vivre**. La ré-apparition *induisait* le double-clic. → Corrigé par un garde pur `createPromptGate` (`ui/prompt-gate.ts`, 6 tests) : après un clic, la fenêtre se tait tant que le registre rejoue la même identité (palier/feu/groupe) ; elle rend la main dès que l'état change ou passe à null. Robuste à toute latence.

2. **Charge d'attaque non abandonnée à la mort → coup involontaire au respawn (MOYENNE).** `enterDying()` coupait l'input Phaser mais ne réinitialisait pas les drapeaux de geste d'`input-bindings`, et `update()` appelait `tickHold()` sans garde `dying`. Or la branche `charging` ne teste PAS l'état du bouton : `input.enabled = false` empêchant le `pointerup`, `charging` restait vrai pendant le voile ET après le respawn → un coup chargé involontaire au réveil au Feu, peut-être sur un PNJ posté là. → Corrigé : `cancelHold()` (abandonne charge/abattage/minage/récolte sans rien émettre) appelé dans `enterDying`, + `tickHold()` gardé par `!this.dying`.

Note (BASSE, non corrigé) : la boucle d'abattage (`input-bindings.ts:422`) ne garde pas l'épuisement du nœud comme le fait le minage — **sans symptôme observable** (`hold: true` rend le refus sim muet). Asymétrie de robustesse, laissée telle quelle.

### Passe 2 — sauvegarde/reprise + entrée en jeu

3. **Sauvegarde de sortie perdue sur collision avec l'autosave (MOYENNE).** `sim-worker.ts` `persist()` faisait `if (!sim || saving) return` : un `pause` (sortie/onglet caché) qui tombait pile sur un autosave en vol était **abandonné sans reprogrammation** — le trou du garde tombait exactement sur le cas à protéger. → Corrigé : un drapeau `pendingPersist` rejoue l'écriture avec l'état frais dès la fin de l'autosave (tant que l'onglet vit, la sortie est sauvée sans attendre les 30 s ; sur une vraie fermeture, IndexedDB reste best-effort — limite navigateur, pas un bug).
4. **Échelle calendaire figée envoyée au client à la reprise (BASSE).** Le message `ready` renvoyait la constante `VEILLEE_CALENDAR_SCALE` au lieu de `sim.calendarScale` : à la reprise d'une sauvegarde faite avec un autre `VEILLEE_SEASON_CYCLES`, la **chronique** datait ses lignes avec la mauvaise échelle. → Corrigé (`sim.calendarScale`).

Notes (BASSES, non corrigées — risque quasi nul) :
- **`?fresh` retombe sur une reprise si `clearSlot()` échoue** (`MenuScene.ts`) : rare (IndexedDB refusé), et aucun correctif propre (si le disque refuse d'effacer, on ne peut garantir la fraîcheur). Deep-link GATE-1 seulement.
- **`boot()` : un throw hors du try/catch fige le chargement** (`sim-worker.ts`) : `worker.onerror` n'écoute que le synchrone, une rejection async passe inaperçue. **Ne peut pas se déclencher aujourd'hui** (seed déterministe → un seed dégénéré échouerait à CHAQUE boot, attrapé avant livraison). Laissé tel quel.

**Vérifié SOLIDE (passe 2) :** sérialisation JSON de l'état (aucun `Map`/`Set`/`Date`/`TypedArray` sur `SimState` ni ses types peuplés), aucun id orphelin après reload (l'entité joueur n'est jamais retirée), restauration chronique/village/feu + republication, séquencement au démarrage (pas de tick fantôme), pas de corruption de slot0, pas de fuite de listener au menu.

## Audit de transmission (sim → main du joueur) — 2026-07-23

Croisement de TOUTES les `PlayerAction` du /sim avec ce que le /client émet réellement. Le but : trouver les mécaniques finies-et-testées jamais câblées jusqu'au joueur (le diagnostic n°1 de `direction-design`).

| Action sim | Joueur peut-il ? | Nature |
|---|---|---|
| `demolish` | Non | **Intentionnel** — clic droit débranché (keymap.ts) |
| `light_fire` | Non | **Intentionnel** — remplacé par feu de camp → `found_village` (commenté dans village.ts) |
| `banish` / `invite` | Non | **Différé** — gouvernance MVP (rang unique + Chef) |
| `set_access` | Non | **Différé/gouvernance** — l'accès est fixé par défaut à la pose ; pas de changement post-pose |
| `deposit` / `withdraw` | **Oui, via `transfer`** | Couvert — le coffre/grenier s'ouvre et le drag-drop `transfer` fait foi |
| `pick_up` | **Non** | **Ambigu** — les piles au sol (butin d'un coffre brisé, viande jetée) ne se ramassent pas. Borderline design (le jet est un geste à sens unique ; le butin répandu est-il perdu ?) |
| **`feed_fire`** | **Non** | **DÉCISION (grappe entretien)** — action joueur existante (`village.ts:820`, « le seul geste qui tient l'upkeep »), mais seuls les PNJ la font (tableau) |
| **`repair`** | **Non** | **DÉCISION (grappe entretien)** — idem : action joueur existante (`village.ts:864`), seuls les PNJ réparent (tableau) |

### La grappe « entretien » — une décision réservée à Alexis (T3-adjacent)

`feed_fire` et `repair` sont des actions **joueur** dans le /sim, mais le client ne les émet jamais : seuls les PNJ nourrissent le Feu et réparent les murs (via le tableau du village). Deux lectures cohérentes :

- **(A) C'est voulu** — l'entretien est un travail COMMUNAL (le fantasy RimWorld-light : le joueur dirige, fonde, défend ; le village vit et se maintient tout seul). Le levier du joueur sur l'upkeep est indirect : garder le bois qui afflue.
- **(B) C'est une lacune de transmission** — l'intention du /sim est clairement « le joueur (un membre) nourrit le Feu » (le commentaire le dit), et `direction-design` parle du « Feu qu'*on* nourrit ». Sans le geste, un joueur dont les PNJ meurent regarde son village tomber en ruine, bois en main — un *feel-bad* qui heurte le principe « chaque connexion rend une décision intéressante ».

**Ma reco : (B) — câbler `feed_fire` et `repair`.** Le risque « le solo tient l'upkeep à la main pour toujours » est un problème de **calibration** (régler la vidange `FIRE_UPKEEP`), pas une raison de retirer le verbe.

**✅ TRANCHÉ (Alexis, 2026-07-23) : câbler les deux — FAIT.** Grammaire : **bois en main + clic sur le Feu → `feed_fire`** ; **bois en main + clic sur une structure abîmée → `repair`**. Câblé dans le résolveur pur `aim.ts` (`onFire`/`repairableId` + branches `clickToAction`), `input-bindings` passe les structures, 7 tests. L'onboarding enseigne désormais « nourris le Feu » quand le combustible passe sous 30 % (`ui/onboarding` conseil `feed-fire`). Zéro nouveau chemin /sim (les handlers existaient). **À calibrer par Alexis en playtest : la vidange `FIRE_UPKEEP` — le verbe ouvert, un solo peut tenir l'upkeep à la main ; c'est le curseur T3 à régler.**

## Risques de déterminisme (rappel opérationnel)

Tout changement `/sim` qui déplace le *nombre* ou l'*ordre* des entités décale le flux RNG seedé et casse des tests de replay/événements sans rapport (mémoire projet). → Isoler, et juger sur « Tests N passed », pas sur l'exit code.
