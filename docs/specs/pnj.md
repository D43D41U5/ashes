# Les PNJ — villageois simulés, tableau du village

*Source : GDD §10 (mode Veillée, RimWorld-light), §5 (PNJ = main-d'œuvre, pas citoyens ; « plus d'humains = moins de bras »), §6 (le tableau du village). Statut : **implémenté** (2026-07-05, A1-A8 verts — dont la survie 10 jours — + smoke test navigateur). Jalon : V5.*

## Objectif de design

Peupler les villages. Un village 100 % PNJ doit *survivre* seul (le joueur y prospère, GDD §10) : les villageois mangent, dorment, travaillent, et le tableau du village orchestre le travail — le même tableau que les joueurs liront et alimenteront plus tard. C'est le système qui fait du solo un jeu et du serveur un monde déjà habité.

## Règles

### Principe fondateur : les PNJ jouent au même jeu

- **R1 — Un PNJ agit par le pipeline d'actions validées**, exactement comme un joueur : son IA émet des intentions (`move + action`) qui passent par `applyEconomyAction`/`applyVillageAction`. Aucun PNJ ne triche (pas de téléportation, pas de ressources ex nihilo) — l'égalité des règles est ce qui rend le remplacement PNJ → humain honnête (GDD §10 : « prendre la place d'un PNJ »).
- **R2 — L'IA vit dans `/sim`** (GDD §11) et tire son aléa du PRNG de la sim : un village PNJ est rejouable au bit près. `step()` fait agir les PNJ après les inputs des joueurs, dans l'ordre des ids.

### L'IA : deux étages, pas de GOAP

- **R3 — Étage 1, les besoins** (priorité absolue) : faim < 30 → manger (inventaire, sinon aller retirer au grenier) ; nuit et énergie < 40 → aller dormir. **Étage 2, le tableau** : sinon, prendre la tâche libre la plus prioritaire compatible, l'exécuter, recommencer. Les égalités se départagent par id (déterminisme). Pas d'arbre de comportement, pas de planification — des seuils et une file.
- **R4 — L'énergie est un besoin de PNJ** (0-100, dans l'état PNJ, pas sur l'Entity) : elle baisse éveillé, remonte endormi — **×2 plus vite dans sa maison qu'au Feu**. La maison n'est pas cosmétique : elle est le régulateur de la main-d'œuvre (GDD §5).

### Le tableau du village (GDD §6)

- **R5 — Le système poste, les PNJ prennent.** Des règles de seuil sur les stocks du **grenier** (= les coffres d'accès `village`) génèrent les tâches : nourriture < cible → `récolter baies` ; bois < cible → `couper du bois` ; baies ≥ 4 et ragoûts < cible → `cuisiner` ; structure endommagée → `réparer` (le PNJ va chercher du bois puis répare, `executeRepair`). Recalcul toutes les `BOARD_REFRESH_TICKS` (5 s). Une tâche a `{ id, kind, priority, claimedBy }` — une seule réclamation à la fois. *(Hors tableau : un PNJ peut aussi porter une **expédition** inter-villages — raid de Meute / don de Foyer selon l'alignement, cf. `alignement.md` R13-R14 ; l'expédition prime sur le tableau mais cède à la survie du porteur.)*
- **R6 — Le fruit du travail va au grenier** : le PNJ dépose sa récolte dans un coffre `village` (il garde de quoi manger). Les joueurs voient le tableau (HUD) — en V5 ils ne postent pas encore de tâches manuelles (ça vient avec la réputation locale).

### La maison et la navigation

- **R7 — La maison** entre au catalogue (reportée de V3) : 8 bois, 1×1, un PNJ s'y assigne (première maison libre du village). Sans maison, il dort au Feu (récupération ÷2). *Plus tard : un humain qui rejoint prend la maison d'un PNJ.*
- **R8 — A\* sur la grille en V5.** Les arbres et les murs bloquent : la marche gloutonne ne suffit plus. A\* déterministe (coûts entiers, départage stable), chemin recalculé si bloqué. Les flow fields restent pour les hordes (V7) — l'A\* individuel et le flow field de masse sont deux outils différents.

### Le peuplement

- **R9 — Fonder attire** : quand un joueur allume un Feu, `NPC_PER_VILLAGE` (3) PNJ arrivent et deviennent membres (spawn aux abords). Le régulateur « plus d'humains = moins de bras » attend le multi.
- **R10 — `foundNpcVillage(state, tx, ty, count)`** : crée un village autonome complet (Feu, grenier, `count` maisons et PNJ) — l'outil du mode Veillée, des tests, et du peuplement de la vallée. La vallée de démo en reçoit un. *(> ⚠️ **À trancher.** La Veillée réellement jouée n'en fonde aujourd'hui aucun — seul le banc `scenario.ts` le fait, donc l'alignement ne se déclenche jamais en solo ; peupler la Veillée de voisins est le chantier R-A / tension T1, cf. `direction-design.md`.)*

## Critères d'acceptation

- **A1** — Grenier sous les seuils → le tableau génère les tâches attendues ; deux PNJ ne réclament jamais la même tâche.
- **A2** — Un PNJ affamé sans vivres va au grenier, retire, mange — sa faim remonte.
- **A3** — La nuit tombée, le PNJ fatigué dort (dans sa maison si assignée) ; son énergie remonte ×2 en maison vs au Feu ; au matin il retravaille.
- **A4** — A\* : un PNJ atteint une cible derrière un bosquet d'arbres bloquants (la ligne droite échouerait) ; le chemin est identique à chaque run.
- **A5** — Cycle complet du travail : tâche `récolter baies` → le PNJ y va, récolte, revient, dépose au grenier — le stock du village monte.
- **A6** — Fonder en tant que joueur → 3 PNJ membres apparaissent ; `foundNpcVillage` produit un village complet et fonctionnel.
- **A7 — LE critère (roadmap)** : un village 100 % PNJ (4 PNJ, grenier, maisons, buissons et arbres alentour) tient **10 jours simulés** en calendrier accéléré, headless : aucun PNJ ne tombe à 0 de faim après la mise en route, et le grenier n'est jamais à sec plus d'un cycle.
- **A8** — Le déterminisme tient avec l'IA active : même seed = même village au bit près après 10 jours, et le replay d'une partie avec PNJ est exact (l'IA ne consomme que le PRNG de la sim).

## Hors périmètre (et où ça revient)

- Patrouilles (rondes proactives) → plus tard. *(La **milice réactive** et la **réaction aux alarmes** sont livrées : `npc.ts` `handleDefense`, spec combat R13 — tout PNJ combat une menace près du Feu.)*
- Tâches postées par les joueurs, réputation locale, promotion → quand de vrais groupes jouent (LAN/Vallée).
- PNJ bâtisseurs (construire des structures) → plus tard ; en V5 ils récoltent, cuisinent, transportent, **réparent** et **défendent** (la construction, elle, reste au joueur).
- Un humain prend la maison d'un PNJ → Phase LAN (il faut des humains qui rejoignent).
- Simulation dégradée hors zone active → Phase Vallée (multi-rooms).
- Dialogue, personnalité, humeurs → jamais en mécanique pure ; de la texture plus tard.

## Ajouts à `balance.ts`

`NPC_PER_VILLAGE = 3`, `NPC_HUNGER_EAT_THRESHOLD = 30`, `NPC_ENERGY_SLEEP_THRESHOLD = 40`, `ENERGY_PER_CYCLE_HOUR` (baisse éveillé), `SLEEP_RECOVERY_HOME = 2` (×maison), `SLEEP_RECOVERY_FIRE = 1`, `BOARD_REFRESH_TICKS = 60`, cibles du grenier `VILLAGE_FOOD_TARGET`, `VILLAGE_WOOD_TARGET`, `VILLAGE_STEW_TARGET`, coût maison `{ wood: 8 }`.
