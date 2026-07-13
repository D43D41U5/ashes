# Le portage — « collecter est facile, rapporter est le jeu »

*Source : GDD §8bis (« le transport : la moitié du gameplay »), §8 (économie de flux), spec `inventaire.md` (le sac borné). Statut : **en cours** (2026-07-13). Décisions utilisateur du 2026-07-13.*

## Le constat, en chiffres

Mesuré sur la vraie carte de la Veillée (192×192, densité de jeu) avant d'écrire une ligne :

| | |
|---|---|
| Un buisson de baies | 8 × 15 = **171 minutes de survie**… et il **repousse en 5 minutes** |
| Nourriture à 20 tuiles du spawn | **11 heures** de survie (repousse non comptée) |
| La faim | 0,7 pt/min → on peut l'**ignorer 2h23** |
| **Le sac** | 18 cases × 20 = **360 unités = 180 murs, portés en sprintant** |

Le GDD dit « **collecter est facile, rapporter est le jeu** » et « le transport est la moitié du gameplay ». Or il n'existe **aucun poids** : la distance ne coûte rien, le sac n'est pas un choix, la route n'est pas un risque, et mourir chargé ne coûte rien non plus. Les robinets sont grands ouverts et il n'y a pas un seul évier.

## Objectif de design

Un **seul** système, et quatre tensions naissent d'un coup :

- le sac devient un **choix** (le minerai *ou* le bois — pas les deux) ;
- la distance devient un **coût** (donc la géographie du risque aura enfin prise) ;
- la route devient un **risque** (le vol de récolte en transit, GDD §8bis) ;
- mourir chargé devient une **catastrophe** — sans qu'on ait ajouté la moindre punition de mort.

**Le piège à éviter, nommé pour qu'on ne s'y jette pas** : ralentir la récolte ne crée pas de tension, ça crée du *grind*. On n'allonge pas les cooldowns, on ne baisse pas les rendements. On rend le **retour** coûteux.

## Règles

### Le poids

- **P1 — Chaque objet PÈSE** (`ITEM_WEIGHT`, un `Record<ItemId, number>` — donc exhaustif : un objet ajouté à la sim sans poids ne compile plus). Le poids porté est la somme `poids × quantité` de toutes les cases (`carryWeight`, pure).
- **P2 — Une capacité de base** (`CARRY.CAPACITY`), la même pour tous. La besace de peau (couche 1 ter, `craft-fortune.md`) la fera monter — c'est déjà son métier ; ne pas l'inventer deux fois.
- **P3 — Les cases restent la borne de VOLUME**, le poids devient la borne de PEINE. Deux limites, deux natures : on ne peut pas mettre 400 bois dans 18 cases (volume), et on ne peut pas *courir* avec 200 bois (poids). Le poids ne remplace pas les cases : il les double.

### La surcharge : on rampe, on n'est pas bloqué (décision utilisateur)

- **P4 — ON PEUT TOUJOURS RAMASSER.** Aucun refus « trop lourd » : la récolte, le craft et le loot ne regardent pas le poids. C'est un **choix**, pas un mur — « je laisse la moitié du minerai, ou je rentre à 20 % de vitesse avec des loups dehors ? ». Un blocage dur ne fait que refuser un clic ; c'est ici qu'est le drame.
- **P5 — La vitesse fond avec la charge**, continûment : libre jusqu'à `COMFORT` (la moitié de la capacité), puis décroissance linéaire, plancher à `SPEED_FLOOR`. À pleine capacité on marche encore ; au-delà, on rampe.
- **P6 — On ne SPRINTE PAS chargé** : au-dessus de `SPRINT_MAX`, le sprint est refusé — pas ralenti, refusé. C'est la première chose que le joueur sent.
- **P7 — SURCHARGÉ, ON NE FUIT PAS** : au-dessus de la capacité, la régénération d'endurance s'effondre (`OVERLOAD_STAMINA_REGEN`). Un porteur surchargé est une **proie** — et c'est exactement le PvP léger que le GDD veut sur les routes.

### Les conséquences qu'on NE code pas (elles viennent seules)

- **P8 — La mort ne change pas d'un iota.** Elle laisse déjà tout au cadavre. Le poids lui donne son prix : mourir à 60 tuiles du Feu avec une hotte de minerai est une catastrophe *parce que le retour coûte*, pas parce qu'on a puni le joueur. On n'ajoute **aucune** pénalité de mort (GDD §7 : « chère, pas cruelle »).
- **P9 — Les PNJ portent aux MÊMES règles.** Pas d'exception : un PNJ chargé est lent, comme tout le monde. Leurs cibles de portage (`NPC_CARRY_TARGETS`) sont déjà bornées — vérifier qu'aucune ne les met en surcharge permanente, et qu'aucun ne se fige.

### Le client

- **P10 — La vitesse vient de `/sim`, et d'elle seule.** `speedScaleFor` est DÉJÀ partagée par la sim et la prédiction locale du client : le poids entre là, et nulle part ailleurs. Une formule recopiée côté client divergerait au premier ajustement — et une divergence de vitesse, c'est un avatar qui se téléporte à chaque réconciliation.
- **P11 — La charge SE VOIT** dans le menu personnage : le poids porté, la capacité, et l'état (`libre` / `chargé` / `SURCHARGÉ`). Un malus qu'on subit sans le voir est un bug, pas une règle.

## Critères d'acceptation

- **A1** — `carryWeight` : sac vide = 0 ; le poids suit les quantités (une pile de 20 bois pèse 20 × le bois) ; pur, sans Phaser ni tirage.
- **A2** — **La courbe** : à ≤ 50 % de la capacité → vitesse ×1 ; à 100 % → le malus mord (strictement < 1) ; au-delà de 150 % → plancher, et il ne descend plus.
- **A3** — **Le sprint est REFUSÉ** au-dessus de `SPRINT_MAX` (pas ralenti : `sprinting: false`), même avec de l'endurance à revendre.
- **A4** — **Surchargé, l'endurance ne revient plus** (régén ×`OVERLOAD_STAMINA_REGEN`) : on ne se bat pas, on ne fuit pas, on rentre.
- **A5** — **On peut TOUJOURS ramasser** : à 300 % de la capacité, une récolte réussit encore (seules les cases refusent). Aucun événement « trop lourd » n'existe.
- **A6** — **Le client prédit la MÊME vitesse** : `speedScaleFor` reçoit l'inventaire, et le replay d'une partie chargée est identique au bit près.
- **A7** — **Le village PNJ tient toujours** : les 4 PNJ nourrissent leur village 10 jours (`npc.test.ts`), poids compris — personne ne se fige sous sa charge.
- **A8** — **Le déterminisme est intact** (`replay.test.ts`, `events.test.ts`) : la vitesse n'utilise que `+ − × ÷`, `min`, `max`.

## Nombres (ordres de grandeur, à calibrer en playtest)

`CARRY.CAPACITY = 30`. `COMFORT = 0.5` · `SPRINT_MAX = 0.75` · `MALUS_PER_RATIO = 0.8` · `SPEED_FLOOR = 0.2` · `OVERLOAD_STAMINA_REGEN = 0.25`.

`ITEM_WEIGHT` : bois 1 · pierre **2** · minerai **3** · lingot **4** · charbon 2 · fibre 0,2 · baies 0,2 · corde 0,4 · ragoût 0,5 · viande 1 · outils 2 à 4.

Ce que ça donne, concrètement : **une charge pleine = 30 bois** (contre 360 aujourd'hui), ou **10 minerais**. Fonder un village (Feu 10 bois + marteau + atelier + hache ≈ 44 de charge) demande **deux voyages**. La cueillette, elle, reste légère — c'est la **pierre et le minerai** qui font mal, exactement comme les « hottes de minerai » du GDD.

## Hors périmètre (les leviers suivants, dans l'ordre)

1. **Les éviers** : péremption de la nourriture, entretien/dégradation des bâtiments (GDD §8, §6ter). Rien ne se consomme aujourd'hui hors usure des outils.
2. **La géographie du risque** : les trois cercles (§8bis) — pauvre près du Feu, riche et dangereux au loin. *Sans le poids, s'éloigner ne coûte rien : c'est pour ça qu'il vient après.*
3. **Le temps qui ne rend rien** : repousse de 5 min → 45-90 min, et rotation des filons.
4. **La charrette** (GDD §8bis) : le premier vrai objet de logistique — et une cible.
