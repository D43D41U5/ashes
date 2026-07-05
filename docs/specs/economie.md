# L'économie — récolte, faim, artisanat, spécialisation

*Source : GDD §8 (économie de flux, 3 tiers, chaînes courtes), §6 (spécialisation émergente, survie facile / prospérité collective), §2 (pression par acte). Statut : **implémenté** (2026-07-05, A1-A7 verts — dont le bot headless — + smoke test navigateur). Jalon : V4.*

## Objectif de design

Fermer la première boucle économique complète : récolter → crafter → s'équiper → user → refaire. Tout se consomme (économie de flux) ; la spécialisation émerge de la pratique ; la géographie des ressources commence à faire la politique (le T2 vit dans des zones contestées). `grantItems` meurt à la fin de ce jalon.

## Règles

### Les nœuds de ressources (la « chair » procédurale)

- **R1 — La carte porte des nœuds épuisables** : arbre (bois), affleurement (pierre), plante à fibres, buisson à baies, **filon de fer** et **veine de charbon** (T2). Un nœud a un stock ; épuisé, il repousse à plein après `NODE_REGROW_TICKS`. Arbres, affleurements et filons **bloquent le déplacement** (la forêt devient un terrain) ; plantes et buissons non.
- **R2 — Placement procédural déterministe** : `generateNodes(map, seed)` remplit la carte (le squelette artisanal reste Tiled, la chair est générée — GDD §9). Densités par terrain : arbres en forêt, affleurements près des roches, etc.
- **R3 — Le T2 est géographique** : fer et charbon n'apparaissent que dans les zones marquées `kind: 'gisement'`. Les zones gagnent un champ optionnel `kind` (importé du champ *type/class* des objets Tiled) — « la carte est l'économie ».

### La récolte

- **R4 — Un coup par action** (`harvest { nodeId }`) : à portée (`INTERACT_RANGE`), avec un rythme borné (`GATHER_COOLDOWN_TICKS = 12`, soit 1 s — le clic frénétique ne paie pas, et c'est une borne de vraisemblance anti-cheat). Rendement = base × outil × compétence, entier.
- **R5 — La main nue suffit en T1** (rendement ×1) ; l'outil multiplie (`hache`/`pioche` ×2, versions fer ×3). Le T2 **exige** la pioche (le filon ne cède rien à mains nues) : l'outillage est la porte du tier, pas un simple bonus.
- **R6 — L'usure est agrégée par type d'outil** : chaque coup outillé incrémente `wear[outil]` ; à `TOOL_DURABILITY` (100 coups), un outil est consommé du stack et le compteur repart. Pas de durabilité par instance — même effet économique (les outils sont des consommables, débouché permanent des artisans), zéro complexité d'inventaire.

### La faim (« faim simple », décision actée GDD §8)

- **R7 — Jauge 0-100**, décroissant avec le temps du cycle (`HUNGER_PER_CYCLE_HOUR = 1.4` ≈ une jauge pleine en ~3 cycles). **Multipliée par l'acte** : ×1, ×2 (Grand Froid), ×3 (Cendre) — la pression saisonnière du GDD §2 mord dès V4.
- **R8 — À 0 : vitesse ÷2.** Pas de mort de faim (la mort arrive en V6) ; le ventre vide rend lent et vulnérable, pas mort.
- **R9 — Manger** (`eat { item }`) : baies +15, **ragoût** +50 (cuit au Feu : 4 baies + 1 fibre). Le bonus de moral des repas variés attend d'avoir plusieurs recettes de cuisine (V5+).

### L'artisanat

- **R10 — Chaînes ≤ 3 étapes, stations distinctes** (GDD §8) : le **Feu cuit** (ragoût), le **four** fond (fer + charbon → lingot), l'**atelier** façonne (outils). Le four devient la 6e structure constructible (pierre ×8).
- **R11 — `craft { recipeId }`** : instantané, à portée de la station requise, coût débité, même cooldown que la récolte. Recettes V4 : ragoût (feu) ; hache, pioche (atelier : bois 5 + pierre 3 + fibre 2) ; lingot de fer (four : minerai 2 + charbon 1) ; hache de fer, pioche de fer (atelier : lingot 2 + bois 2). Le mini-jeu de forge (GDD §6) viendra habiller le geste plus tard.

### La spécialisation émergente (GDD §6)

- **R12 — Quatre métiers V4** : bûcheron, mineur, cueilleur, artisan. L'XP vient de la pratique (1/coup récolté, 5/craft). Niveau = `floor(sqrt(xp / 100))` — les premières marches sont rapides, la maîtrise est longue.
- **R13 — Bonus continus** (décision actée #3) : rendement de récolte +4 %/niveau (floor sur le résultat) ; l'artisan réduit l'usure qu'il inflige à ses outils de 3 %/niveau.
- **R14 — Progresser dans une branche ralentit les autres** : gain d'XP divisé par `1 + 0.5 × (somme des niveaux des AUTRES métiers)`. Le touche-à-tout plafonne vite ; « la trappeuse du village de l'Est » émerge des chiffres, pas d'un choix de classe.

## Critères d'acceptation

- **A1** — Récolter un arbre donne du bois, épuise le nœud, qui repousse à plein après `NODE_REGROW_TICKS` ; hors portée ou pendant le cooldown → rejeté.
- **A2** — La hache double le rendement ; l'usure s'accumule ; au 100e coup l'outil est consommé et le compteur repart ; le filon ne cède rien sans pioche.
- **A3** — La chaîne T2 complète : minerai + charbon → lingot **au four seulement** ; lingot + bois → hache de fer **à l'atelier seulement** ; loin de la station ou mauvaise station → rejeté.
- **A4** — La faim décroît (×2 en acte II — testé en calendrier accéléré), manger restaure, à 0 la vitesse est divisée par 2 et revient après un repas.
- **A5** — Récolter monte le métier ; un niveau supérieur rend plus ; l'XP d'un second métier progresse plus lentement quand le premier est haut (pression de spécialisation mesurable).
- **A6** — `generateNodes` est déterministe (même seed = mêmes nœuds) ; fer et charbon uniquement dans les zones `kind: 'gisement'`.
- **A7** — **Le bot headless** : un bot scripté joue la boucle entière — récolte bois/pierre/fibre, construit un atelier, crafte une hache, re-récolte plus vite — en pur `/sim`, et le replay de sa partie est identique au bit près.

## Hors périmètre (et où ça revient)

- Gibier et chasse → V6 (c'est du combat) ; la nourriture T1 est végétale.
- Moral des repas variés → V5+ (quand il y aura plusieurs recettes).
- Durabilité des structures, dégradation des murs → V6-V7 (avec les raids).
- Mini-jeux de station (forge, timing) → habillage V10.
- Échange entre joueurs, troc, caravanes → Phase LAN/Vallée (il faut d'autres humains).
- T3 (acier, composants) → événements PvE (V7) et fin de saison (V9).

## Ajouts à `balance.ts`

`NODE_REGROW_TICKS`, `NODE_STOCKS` (arbre 10, affleurement 12, filon 8…), `GATHER_COOLDOWN_TICKS = 12`, `TOOL_DURABILITY = 100`, `TOOL_MULTIPLIERS` (main 1, outil 2, fer 3), `HUNGER_PER_CYCLE_HOUR = 1.4`, `ACT_HUNGER_FACTOR = [1, 2, 3]`, `HUNGER_SPEED_MALUS = 0.5`, `FOOD_VALUES` (baies 15, ragoût 50), `RECIPES`, `XP_PER_GATHER = 1`, `XP_PER_CRAFT = 5`, `SKILL_YIELD_BONUS = 0.04`, `SKILL_SPREAD_PENALTY = 0.5`, coût du four.
