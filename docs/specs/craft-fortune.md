# L'artisanat de fortune — la couche 1, celle qui n'exige aucun poste

*Source : GDD §8 (chaînes courtes, économie de flux), §8bis (catalogue des ressources), specs `economie.md` (R10-R11), `recolte.md` (G12-G13, le marteau). Statut : **en cours** (2026-07-12). Jalon : chantier « le craft », couche 1/3.*

> **Révisions ultérieures (à lire avec ce doc) :** le craft n'est plus instantané mais une FILE avec durées (`craft-file.md`) ; le barème d'outil a été réécrit — la fortune n'est plus l'égale de l'atelier (`recolte-vivante.md` D3/Y1).

## Objectif de design

Aujourd'hui, **il n'existe aucun craft sans station** : `Recipe.station` est obligatoire, et `applyEconomyAction` refuse tout craft hors de portée d'un Feu, d'un atelier ou d'un four. La première marche du jeu est donc : mains nues → 10 bois → Feu → marteau → atelier. Il n'y a **rien avant le village**, et les mains nues n'ont aucune réponse à donner à la faim, au froid, au loup ou à la lenteur.

Cette couche ouvre le craft **à mains nues, partout** : des objets de fortune, faits de ce qu'on ramasse au sol, qui font passer du survivant nu au survivant équipé — sans jamais court-circuiter l'atelier ni la mine.

Le fil rouge : **la fortune accélère, elle n'ouvre rien.** Ce qui déverrouille le T2 (le fer, le charbon, donc la géopolitique de la mine) reste l'outil *forgé*, donc un bâtiment, donc une cible de raid (GDD §8 : « l'acier ne se ramasse pas »).

## Règles

### Le craft sans poste

- **C1 — `Recipe.station` devient nullable.** `station: null` = « à la main » : craftable n'importe où, sans structure, sans village. Le reste de `craft` ne change pas (coût débité au clic, XP d'artisan à l'échéance) — hormis qu'il est désormais ENFILÉ avec une durée et non plus instantané (voir `craft-file.md`).
- **C2 — Aucune autre porte.** Pas de niveau d'artisan minimal, pas d'outil requis pour crafter à la main : la couche 1 est ce que le joueur nu peut faire à la minute 0. Elle est la *rampe*, pas une récompense.

### La pierre reste à mains nues — non négociable

- **C3 — `rock` ne demandera JAMAIS d'outil** (`minTool: 'none'`, comme aujourd'hui). Tout outil de fortune est fait *de pierre* : gater la pierre derrière un outil, c'est le blocage circulaire que `recolte.md` G13 a déjà refusé pour le marteau, en pire. La pierre n'est jamais bloquée — elle est **lente** (×1, 1 s par coup, 12 par affleurement).

### Le palier d'outil remplace le booléen

- **C4 — Quatre paliers, ordonnés** : `none` < `crude` < `basic` < `iron`. Rendement : mains nues ×1, **fortune ×2**, atelier ×3, fer ×4. La fortune *dépanne* — elle ne remplace pas l'outil forgé (barème révisé, `recolte-vivante.md` D3/Y1) : elle paie aussi en durabilité (C6).
- **C5 — `NodeDef.requiresTool: boolean` devient `NodeDef.minTool: ToolTier`.** Le booléen actuel teste « rendement > 1 » : tel quel, un pic de fortune ×2 **ouvrirait le fer et le charbon sans jamais bâtir d'atelier**, et trois pierres court-circuiteraient toute la géopolitique de la mine. Les filons (`iron_vein`, `coal_seam`) exigent donc `minTool: 'basic'` — **un outil forgé**, pas un caillou ficelé. Tous les autres nœuds : `minTool: 'none'`.
- **C6 — La durabilité devient propre à l'objet.** `TOOL_DURABILITY = 100` reste le défaut ; les objets de fortune valent **20 coups** (`TOOL_DURABILITIES`). C'est là que se paie la fortune : même rendement, **un cinquième de la vie**. L'outil d'atelier n'est pas « le même en mieux » — il est *durable*, et il ouvre la mine.
- **C7 — Le PNJ empoigne au PALIER, pas au rendement.** `equipBestTool` classait par `toolYield` : fortune et atelier étant tous deux à ×2, un PNJ aurait pu saisir le caillou et laisser la vraie hache au sac. Le classement passe au rang (`toolRank`).

### Les recettes de fortune

| Recette | Station | Intrants | Sortie |
|---|---|---|---|
| `rope` — Corde | *à la main* | fibre 3 | 1 corde (le liant de tout le reste) |
| `crude_axe` — Hachereau de fortune | *à la main* | bois 2 + pierre 3 + corde 1 | hache `crude` (×2, 20 coups) |
| `crude_pickaxe` — Pic de fortune | *à la main* | bois 3 + pierre 2 + corde 1 | pioche `crude` (×2, 20 coups, **n'ouvre pas les filons**) |
| `crude_spear` — Épieu taillé | *à la main* | bois 3 + pierre 1 + corde 1 | arme 10 dégâts, 20 coups |

- **C8 — La corde est le goulot volontaire.** Les trois objets passent par elle : la fibre cesse d'être la ressource qu'on ramasse sans y penser, et le cueilleur a un client dès la minute 0.
- **C9 — L'épieu taillé se glisse entre les mains nues (6) et la lance d'atelier (16), à 10.** Il donne une réponse au loup et au sanglier la nuit sans rendre la lance inutile — elle reste 60 % au-dessus, et cinq fois plus endurante.

## Critères d'acceptation

- **A1** — `craft { recipeId: 'rope' }` **réussit loin de toute structure**, sans village, sans Feu : 3 fibres entrent, 1 corde sort, le cooldown et l'XP d'artisan tombent comme pour un craft de station.
- **A2** — Une recette à station (`axe`, `iron_ingot`…) reste refusée hors de portée de sa station : la nullabilité de `station` n'ouvre **que** les recettes qui la déclarent.
- **A3** — **Le pic de fortune n'ouvre pas la mine** : `harvest` sur un `iron_vein`, pic de fortune EN MAIN, est refusé (`il faut un outil forgé en main`). Avec la pioche d'atelier en main, le même coup passe.
- **A4** — Le hachereau de fortune donne **×2** sur un arbre (comme la hache d'atelier), et **casse au 20ᵉ coup** — la hache d'atelier, elle, tient ses 100 coups.
- **A5** — `equipBestTool` préfère la hache d'atelier au hachereau quand les deux sont au sac (rang, pas rendement).
- **A6** — **La rampe complète, headless** (`bot.test.ts`) : un bot nu récolte fibre/bois/pierre à mains nues → tresse une corde → taille un hachereau → coupe **deux fois plus vite** → fonde le Feu → forge le marteau → bâtit l'atelier. Et son replay est identique au bit près.
- **A7** — Aucun craft de fortune n'émet d'événement menteur : sac plein → les intrants reviennent, ni `item_crafted`, ni cooldown, ni XP (règle existante `economie.md`).

## Nombres (à calibrer)

`RECIPES.rope/crude_axe/crude_pickaxe/crude_spear` (ci-dessus), `TOOL_YIELD = { none: 1, crude: 2, basic: 3, iron: 4 }`, `TOOL_RANK = { none: 0, crude: 1, basic: 2, iron: 3 }`, `TOOL_DURABILITIES = { crude_axe: 20, crude_pickaxe: 20, crude_spear: 20 }` (défaut : `TOOL_DURABILITY = 100`), `WEAPON_DAMAGE.crude_spear = 10`, `STACK_SIZES.rope = 10`.

## Hors périmètre — les deux couches suivantes

Décidées avec l'utilisateur le 2026-07-12, à ne pas ré-ouvrir :

- **Le bandage** (couche 1 bis) : fibre 2 + plante 1. Attention, **l'action `bandage` EXISTE DÉJÀ** (`combat.ts`, touche X) : elle consomme des **fibres brutes** (`COMBAT.BANDAGE_FIBER_COST`) et soigne une blessure (saignement, puis jambe, puis bras). Le chantier n'est donc pas « créer un soin » mais **le faire passer par un objet** : la ressource **`plant`** (nouveau nœud de cueillette, prés fleuris / lande / marais), un objet `bandage` craftable à la main, et l'**usage à la ceinture** — l'objet se sélectionne, puis s'emploie en **maintenant le clic gauche** (comme la récolte), la touche X devenant un raccourci et non plus le seul chemin.
- **La cape de peau** (couche 1 ter) : peau 2 + corde 1. Exige la ressource **`hide`** (butin de faune : lapin 1, loup 1, sanglier 2, cerf 2) et de vrais **slots de vêtement**, distincts des cases d'inventaire. Le branchement thermique, lui, est **déjà prêt** : `driftStep(current, ambient, insulation)` prend l'isolation en paramètre et `advanceTemperature` lui passe la constante `INSULATION_BODY: 1`, commentée « stub ; la Couture la fera monter plus tard ».
- **La torche** est **abandonnée** : le client n'a aucun système de lumière, et une source de chaleur portable saperait le Feu.
