# La saison — trois actes, la Cendre, la chronique

*Source : GDD §2 (60 jours, trois actes, wipe, Mémoires + chronique), §8 (robinets et éviers par acte). Statut : **implémenté** (2026-07-05, décisions prises en autonomie — révisables). Jalon : V9.*

## Objectif de design

La condamnation du monde devient jouable : la pression monte acte par acte, la Cendre converge, un objectif final apparaît, et à la fin **on raconte** — la chronique est la Mémoire v1, générée du bus d'événements posé en V0.

## Règles

- **R1 — La courbe de pression** : la faim coûte ×1/×2/×3 par acte (V4 ✓), les hordes grossissent 4/8/12 (V7 ✓), et désormais **les sources se contractent** : la repousse des nœuds est ralentie ×1/×1.5/×2 par acte.
- **R2 — La méga-horde de la Cendre** : au premier crépuscule de l'acte III, une horde de `MEGA_HORDE_SIZE` (16) déferle — à la place du tirage de horde de cette nuit-là (les hordes d'acte reprennent ensuite). Elle ne négocie avec personne (GDD §7).
- **R3 — L'évacuation** : au jour `EVAC_DAY` (55), un **point d'évacuation** s'ouvre sur la route (événement `evacuation_opened`, marqueur en jeu). Les avatars à ≤ `EVAC_RADIUS` (6) du point à la fin comptent « évacués ».
- **R4 — La fin de saison** : à l'aube du jour 61, `season_ended` est émis avec un **verdict par village** selon son archétype (GDD §2) : le **Foyer** gagne en *sauvant des vies* (membres vivants + évacués), la **Meute** en *partant les bras pleins* (valeur du grenier et des inventaires, table `LOOT_VALUES`), le neutre en *ayant tenu* (membres vivants). La sim continue de tourner (l'après-monde) ; le wipe est une affaire d'hôte.

> **⚠ Réserves de direction (audit 2026-07-19).** Ces règles sont vertes en calendrier accéléré, mais leur *jeu* est aujourd'hui creux : (1) la **méga-horde** (R2) se dissipe à l'aube comme les autres et n'atteint pas le Feu (`999999` PV) ; l'**évacuation** (R3) est un marqueur de proximité passif — aucun embarquement, aucune sortie de carte. (2) En Veillée temps réel, le cycle est **découplé** du calendrier : l'acte III et sa méga-horde arrivent *après* la fin de saison → la pression R1/R2 est inobservable en solo tant que V0-9 (cadence sur calendrier) n'a pas atterri. (3) Faute de **réfugiés** et de départ vérifié, le score Foyer « vies sauvées » (R4) ≈ ses propres membres. La direction en fait de vrais actes : méga-horde-siège sur Feu tuable (V1-12), arche à embarquer (V2-24), réfugiés scriptés (V2-25) — cf. `direction-design.md`.
- **R5 — Les villages ont un nom** (`village.name`, tiré d'une table déterministe) — « la bataille du Pont » exige un Pont, une chronique exige des noms.
- **R6 — La chronique v1** : `chronicleFromEvents(events, calendarScale, names)` — une fonction **pure** dans `/sim` qui transforme le flux d'événements en récit daté (« Jour 43 — La méga-horde a déferlé sur le Clan du Levant »). Consommateur du bus, comme promis en V0. Retenus : fondations, changements d'archétype, hordes ≥ 8, convois, morts d'avatars, dons inter-villages (le premier de chaque paire), évacuation, verdicts. La chronique EST la Mémoire v1 ; cosmétiques et blueprints inter-saisons attendent le méta-jeu.

## Critères d'acceptation

- **A1** — Un nœud épuisé en acte II repousse 1.5× plus lentement qu'en acte I.
- **A2** — Au premier crépuscule de l'acte III, une horde de 16 apparaît (une seule fois).
- **A3** — Au jour 55, l'évacuation s'ouvre sur une tuile route et l'événement est émis.
- **A4** — Au jour 61 : `season_ended` avec verdicts — un Foyer avec ses PNJ vivants score en vies, une Meute au grenier plein score en valeur ; l'événement n'est émis qu'une fois.
- **A5** — La chronique d'une saison accélérée est non vide, datée en jours croissants, nomme les villages, et contient fondations/actes/horde/verdicts.
- **A6** — Déterminisme : une saison complète accélérée rejoue au bit près, chronique comprise.

## Hors périmètre

Wipe/reset effectif et Mémoires persistées (méta-hôte, Phase Vallée) ; objectif final par archétype élaboré (arche, bunker — design Saison 0) ; météo visuelle du Grand Froid (habillage).

## Ajouts à `balance.ts`

`SEASON_PRESSURE.REGROW_ACT_FACTOR = [1, 1.5, 2]`, `MEGA_HORDE_SIZE = 16`, `EVAC_DAY = 55`, `EVAC_RADIUS = 6`, `LOOT_VALUES` (composants 10, lingot 5, outils 3, reste 1), `VILLAGE_NAMES` (table déterministe).
