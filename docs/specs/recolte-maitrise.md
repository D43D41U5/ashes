# La maîtrise de récolte — trois gestes qui récompensent

*Source : GDD §400 (« le geste : actif, jamais AFK » — les cinq mini-gameplays et les deux interdits), spec `recolte.md` (l'ossature du geste nu : G6 clic maintenu, G8 cible ré-évaluée, G10 tressaillement), spec `economie.md` (ce qu'un coup PRODUIT). Décisions d'Alexis prises en session, voir `decisions.md`.*

*Statut (2026-07-19) : **les TROIS verbes — SIM + RENDU livrés.***

- *Abattage : `harvest_charge_start`/`harvest_release`, `harvestStrike`, `fellGreenWidth`/`isCleanFell` ; jauge + auto-frappe dans `advanceEconomy` ; `Entity.harvestCharge` ; **pas de cooldown — la jauge est la cadence, relâcher avant le vert annule**. Client : jauge au-dessus de l'arbre (`world/fell-gauge.ts`), clic-arbre en charge/relâche.*
- *Minage : le `harvest` porte `aimX/aimY` ; `flankOfAim`, `mineGoodFlank` (seedé, `hash2`), `mineTolerance`, `isCleanMine` ; coup propre via `harvestStrike` (bonus `CLEAN_*` partagé). **Plus de « trop tôt » — la LUEUR porte le tempo** (se reforme sur le rechargement). Client : clic-rocher VERROUILLE le nœud (curseur = flanc, zones grosses), lueur du bon flanc + voisins, avec tempo (`world/flank-glow.ts`).*
- *Cueillette : geste NU (aucun jugement au coup) ; `forageRichness` (seedé, `hash2`) module le stock des SEULES plantes (centré sur 1 → moyennes par cercle intactes) ; `forageRevealed` gate la perception. Client : lueur des bons coins À DISTANCE, révélée par le `foraging` LOCAL (`world/forage-glow.ts`, gate client, zéro snapshot par joueur). Le bonus de rendement passif de `foraging` (P4) était déjà dans `harvestStrike`.*

*~18 tests headless (économie), 145 tests client, smoke `abattage`/`minage`/`cueillette`. Reste ouvert : le CALIBRAGE des nombres (largeurs de vert, cooldown, seuils/fourchette de richesse) — à faire en playtest.*

## Objectif de design

`recolte.md` a rendu le geste **lisible et tenable** : on voit ce qu'on vise, le clic maintenu répète à la cadence du cooldown, le nœud tressaille au coup qui porte. Mais récolter reste, aujourd'hui, **sans skill** — dix clics identiques vident un arbre. Le GDD §400 promet mieux : *un geste court, actif, où la maîtrise se sent*. Cette spec ajoute cette maîtrise, sans jamais casser le survivant maladroit.

Elle ne touche pas à l'économie (ce qu'un nœud produit) ni à `recolte.md` (comment on vise). Elle **greffe une réussite** sur le coup déjà cadencé de G6.

## Les trois décisions actées (Alexis, 2026-07-19)

- **D1 — Le défi vit dans la SIM, pas dans le client.** La sim génère le défi depuis son RNG seedé ; le client ne fait que le **dessiner** et renvoyer l'instant/le lieu de frappe. Le client ne rapporte JAMAIS un « résultat » de mini-jeu (ce serait l'invariant 3 cassé, et triché en une ligne dès le multi). Conséquence : le défi doit être **déterministe** (rejouable au bit près) et **lisible depuis le snapshot**.
- **D2 — Trois verbes distincts**, un par famille de nœud, honorant les trois promesses du GDD : **timing** (bois), **point faible spatial** (pierre/fer/charbon), **perception** (plantes). Pas un geste unique décliné.
- **D3 — Écart DOUX (« la caresse »).** Un coup raté rend TOUJOURS le baseline (jamais zéro). Un coup propre récompense d'environ **+50 % de rendement** et **un peu moins d'usure**. La maîtrise est un confort qui se cumule sur une partie, pas un péage sur chaque arbre. *(Chiffres = ordre de grandeur, calibrés en playtest — CLAUDE.md ; on MESURE avant de figer, façon `recolte.md` G11.)*

## Le contrat commun (D1)

Ce contrat régit les deux verbes à **défi au moment du coup** — l'abattage et le minage. **La cueillette en est exempte** : elle n'a aucun défi de frappe, sa maîtrise vit dans le monde (verbe 3), donc rien à juger côté sim au moment du coup.

Chaque coup de récolte (`harvest`) est déjà daté du tick où la sim le traite, et déjà cadencé au `GATHER_COOLDOWN_TICKS`. Le défi se juge **au moment de ce coup**, sans machine à états longue :

- **C1 — Le défi est une pure fonction du seed et du tick/lieu.** La sim recalcule le défi depuis `(nodeId, node.depletions, state.tick)` et l'état RNG — pas de longue machine à états. **Exception assumée, l'abattage** (verbe 1, charge-relâche) : il garde un état MINIMAL par acteur, vivant seulement le temps d'un maintien — le tick de pression et le nœud chargé (`chargeStartTick`, `chargeNodeId`, deux nombres JSON-sérialisables, invariant état-de-sim). Toujours déterministe : la durée tenue = `tick − chargeStartTick`.
- **C2 — Pas de fonction Math approximée.** Tout est arithmétique entière : la jauge de l'abattage est un compte de ticks tenus ; le point faible du minage est un **flanc** (un des quatre quadrants) tiré du RNG seedé, comparé au quadrant du curseur. Interdits `sin/cos/pow/exp` (invariant 2) : aucun n'est nécessaire.
- **C3 — Le client MIROITE le défi, il ne l'invente pas** (comme `recolte.md` G5). Le snapshot porte de quoi dessiner le défi (phase d'oscillation, sous-position du point faible, brins et leur tell). Si la sim juge autrement que ce que le client montrait, **la sim a raison**.
- **C4 — Le raté ne coûte rien de plus que le baseline** (D3) : même rendement de base, même cooldown, même XP. Il ne pose aucun refus (`action_rejected`), il n'inonde pas le flux d'événements. Le coup propre, lui, émet son bonus dans `resource_harvested` (un champ `clean: true` ou un `count` déjà majoré — à trancher à l'implémentation, mais l'événement PORTE l'info, pour la chronique et le retour de frappe).

## Verbe 1 — Abattage (bois) : charger la frappe, relâcher au vert

*Nœuds : `tree`, `old_tree`. Décision d'Alexis 2026-07-19 : le geste est une **jauge de charge**, pas un métronome.*

- **B1 — Charger, pas marteler.** Clic MAINTENU sur l'arbre → une **jauge se remplit** à l'écran, à vitesse fixe (`FELL_CHARGE_RATE`, en ticks). **Relâcher (mouseup) = LA frappe.** Ça **remplace le clic-maintenu-auto-répète de `recolte.md` G6 pour le bois** (assumé, D2) : tenir ne répète plus un coup toutes les ~600 ms, il charge UN coup de hache. Abattre un arbre = **plusieurs cycles charge-relâche délibérés** — chaque coup pèse.
- **B2 — La zone verte est FIXE, et c'est le point où la hache CONNECTE.** Une **zone verte à position fixe** sur la jauge (`FELL_GREEN_START_TICKS`) marque le moment de frappe. **Décision d'Alexis (cadence) — PAS de cooldown : la jauge EST la cadence.** D'où quatre cas au relâché :
  - **avant le vert → RIEN.** Le geste est annulé, aucun coup, rien de perdu — on rejoue. C'est aussi la garde anti-mitraillage qui remplace le cooldown : sans elle, un clic-relâche à zéro cracherait des coups baseline à 20 Hz.
  - **dans le vert → coup PROPRE** (+~50 % rendement, usure moindre — D3).
  - **après le vert → baseline** (jamais zéro).
  - **jauge pleine sans relâcher → frappe automatique au baseline** (tenir sans viser hache quand même — l'ancien G6 y survit).
- **B3 — La compétence `woodcutting` ÉLARGIT le vert.** Le novice vise une bande étroite ; le vétéran a un vert si large qu'il abat **en autopilote** — la maîtrise EFFACE l'effort (garde-fou GDD « un geste, pas un mini-jeu envahissant » pour une action faite des milliers de fois). `old_tree` : jauge plus lente et vert plus étroit à niveau égal — le hardwood se MÉRITE.
- **B4 — Tout dans la sim (D1/C1).** À la pression sur un nœud à portée, la sim arme `Entity.harvestCharge = { nodeId, ticks }` ; `advanceEconomy` fait monter `ticks` (plafonné à `FELL_CHARGE_MAX_TICKS`), le client dessine la jauge = `ticks / FELL_CHARGE_MAX_TICKS` (pur miroir, il n'invente rien — C3). Au relâché, la sim juge `ticks` contre le vert (`isCleanFell`, largeur selon le niveau) et produit le coup. Inputs : **`harvest_charge_start { nodeId, hold? }`** et **`harvest_release`** ; `hold` tait les refus du maintien (hors portée…). La cible se ré-évalue au relâché (`recolte.md` G8) : nœud vidé ou quitté pendant la charge → coup muet.

## Verbe 2 — Minage (pierre/fer/charbon) : frapper le bon flanc

*Nœuds : `rock`, `iron_vein`, `coal_seam`, `quarry`, `rubble`. Décision d'Alexis 2026-07-19 : le point faible est un **flanc grossier**, PAS un point — la précision au pixel est bannie (le nœud est trop petit à l'écran pour qu'on y vise un pixel).*

- **M1 — Le point faible est un FLANC, pas un pixel.** À chaque coup, l'un des **quatre flancs** du nœud (haut/bas/gauche/droite) est tiré du RNG seedé et **luit**. La cible est un QUART du nœud — grosse, couvrable sans effort. On ne vise jamais un point ; on lit « de quel côté ça cède ».
- **M2 — Frapper du bon flanc = éclat.** Clic MAINTENU (`recolte.md` G6 tient pour la pierre), curseur posé **du côté qui luit**. Le coup part propre si le curseur est sur le bon flanc au moment de la frappe : +~50 % rendement, ET le nœud rend **un cran de plus vers l'épuisement** — la maîtrise mine en moins de coups (le levier « vitesse » de D3 s'ajoute au rendement, sans le doubler : on reste DOUX). Mauvais flanc = baseline (jamais zéro). La sim déduit le flanc de la **position monde du curseur relative au centre du nœud** (quatre quadrants) et le compare au flanc seedé — coarse, robuste, déterministe.
- **M3 — La compétence `mining` éclaire plus tôt et ÉLARGIT la marge.** Novice : le bon flanc luit tard et faible, la tolérance est serrée sur son quadrant. Expert : il luit d'emblée, et l'acceptation **déborde sur les flancs voisins** — au niveau haut, presque tout coup porte. La maîtrise EFFACE l'effort (même esprit que le vert de l'abattage).
- **M4 — Le bon flanc SAUTE à chaque coup**, mais ne bouge pas pendant un même coup : on **suit la veine** posément, on ne court pas après un réflexe. Le réflexe/temps, c'est l'abattage ; le minage est *lecture spatiale grossière*.
- **M5 — PAS de « trop tôt » : la LUEUR porte le tempo** (décision d'Alexis). Le cooldown ne rejette plus (comme l'abattage) — un coup trop tôt ne porte pas, mais ne crache aucun refus. À la place, le point faible se **consomme** au coup (terne, petit) et se **reforme** sur le rechargement, **brillant quand on peut refrapper** : le joueur lit la lueur pour savoir QUAND frapper, la cadence se VOIT au lieu d'un timer caché qui punit. Rendu pur (`world/flank-glow.ts`, `readiness` = temps écoulé depuis le dernier coup / horloge client) ; le cooldown reste la garde d'économie, silencieuse. Combiné à M4, le point faible **se déplace ET se recharge** — un seul geste pace le joueur dans l'espace et le temps.

## Verbe 3 — Cueillette (plantes) : la perception du bon coin

*Nœuds : `fiber_plant`, `berry_bush`, `peat_cut`, `ash_heap`. Décision d'Alexis 2026-07-19 : la maîtrise vit **dans le monde**, pas au moment de la récolte. Cueillir n'a AUCUN geste d'adresse — les plantes sont la ressource du cercle domestique, celle qu'on ramasse, pas qu'on dispute.*

- **P1 — La récolte est nue.** Clic MAINTENU (`recolte.md` G6) : rien à viser, rien à charger, **aucune distinction coup propre/raté** — D3 ne s'applique pas aux plantes. Chaque unité passe quand même par un input (l'interdit AFK du GDD tient), mais le geste est sans friction, et c'est voulu.
- **P2 — La maîtrise, c'est SAVOIR OÙ.** Chaque nœud de cueillette porte une **richesse seedée** (maigre → riche) qui module son stock/rendement — c'est déjà une donnée du monde. Un `foraging` haut fait **luire les bons coins** que le novice voit tous pareils : « l'herboriste voit ce que le novice piétine », au pied de la lettre. La perception est un gain de **trajet** (aller droit au riche — le GDD §400 designe justement la collecte *comme des trajets*), pas un accès exclusif : le novice peut cueillir le même buisson, il ne sait pas lequel valait le détour. Doux (esprit D3).
- **P3 — Rendu GATÉ côté client, zéro snapshot par joueur.** La richesse voyage dans le flux partagé (seedée, déterministe, la même pour tous) ; le **client** ne peint la lueur que si le `foraging` du joueur LOCAL passe le seuil (il connaît son propre niveau — l'entité est dans le snapshot). L'archi « un seul flux partagé » (`protocol.ts`) tient : pas de N snapshots filtrés. **Fuite assumée** : un client trafiqué peindrait la lueur à tout niveau — enjeu dérisoire (baies, fibre, tourbe), et le rendement, lui, reste calculé par la sim. Cousin léger du `reveal` de `poi-discovery.ts`, mais continu avec le skill et *rendu*, pas *découvert*.
- **P4 — Le bonus de rendement passif de `foraging` DEMEURE** (`economy.ts`, micro-marche additive `+1` tous les `SKILL_YIELD_STEP` niveaux — l'ancien `SKILL_YIELD_BONUS` floté a été remplacé par `recolte-vivante.md` D3) : l'expert tire plus de CHAQUE nœud. La perception dit **où**, le bonus dit **combien** — les deux faces de la maîtrise, aucune n'étant un mini-jeu par plante.

## Hors périmètre

- **Chasse et pêche.** Leurs gestes GDD (pistage/approche/tir, ferrage) ont leurs propres systèmes (`chasse.ts`, `poisson.ts`) et leur propre spec (`chasse.md`). Cette passe ne concerne QUE les nœuds de récolte.
- **Le son.** Aucun son dans le jeu à ce jour ; le retour du coup propre est visuel (il se branchera plus tard sur le même événement, cf. `recolte.md`).
- **Les nombres exacts** (largeurs de fenêtre, rayon du point faible par niveau, N brins, seuils de révélation). D3 fixe l'ordre de grandeur (« doux », +~50 %) ; le calibrage se fait en playtest, mesures en main, et le changement de chiffres reste une décision utilisateur.

## Critères d'acceptation (à écrire AVANT le code, invariant tests)

- **A1 — Déterminisme.** Même seed + mêmes inputs (mêmes ticks/lieux de frappe) → même suite de coups propres/ratés et même flux d'événements. Couvert par un test dédié et par `replay.test.ts`.
- **A2 — Le raté est viable (D3).** Une suite de coups tous hors fenêtre / hors point faible / mauvais brin vide quand même le nœud, sans aucun `action_rejected`, avec le rendement baseline attendu.
- **A3 — Le propre paie ~+50 % (D3).** À niveau égal, une suite de coups propres vide le nœud en sensiblement moins de coups qu'une suite de ratés, dans l'ordre de grandeur visé — mesuré, pas affirmé.
- **A4 — L'événement porte l'info.** Un coup propre se distingue d'un coup raté dans le `resource_harvested` (champ/majoration), pour que chronique et retour de frappe le consomment sans deviner.
- **A5 — Abattage (B2-B3) :** relâcher à une durée-de-charge tombant dans le vert donne le coup propre, hors du vert le baseline ; et à `woodcutting` haut le vert est plus large qu'à niveau nul (une durée qui rate au niveau 0 porte à niveau haut) — testé sur la fonction de jugement, pas à l'œil. La charge (`chargeStartTick`) survit au snapshot/replay sans dériver.
- **A6 — Minage (M2-M3) :** un coup depuis le bon flanc porte propre, depuis un autre flanc le baseline ; le flanc jugé se déduit du quadrant du curseur relatif au centre du nœud ; et l'acceptation s'élargit avec `mining` (un flanc voisin qui rate au niveau 0 porte à niveau haut) — testé sur la fonction de jugement.
- **A7 — Cueillette (P2-P3) :** deux nœuds de richesse seedée différente rendent des stocks/rendements différents (jugé sim, déterministe) ; la lueur « bon coin » est une pure fonction du `foraging` LOCAL (testable côté client), **aucun champ caché par joueur n'est introduit dans le snapshot** ; et récolter une plante n'émet aucune distinction propre/baseline (P1).
- **A8 — Le bot headless joue avec** (`bot.test.ts`) : la boucle de récolte complète tourne avec les trois verbes, et son replay reste identique au bit près.
