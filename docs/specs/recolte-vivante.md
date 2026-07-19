# La récolte vivante — le monde bouge, la maîtrise ouvre l'outil

*Source : GDD §8bis (« les filons s'épuisent localement et **rouvrent ailleurs** — les points de friction se DÉPLACENT » ; « on la use, elle se ferme, on tourne »), spec `economie.md` (ce qu'un coup PRODUIT), spec `recolte-maitrise.md` (le geste qui récompense — cette passe s'y greffe sans le casser), spec `craft-fortune.md` (**révisée ici** : l'outil de fortune n'est plus l'égal de l'atelier). Décisions d'Alexis prises en session, voir `decisions.md`.*

*Statut (2026-07-19) : **LIVRÉ — SIM + RENDU.** Rendement en chaîne (`effectiveTier`/`maxTierByLevel`, gate doux, barème 1/2/3/4, micro-marche) et dérive du bosquet (`relocateNode`, seedée `hash2`, index patché, `RELOCATE_RADIUS`) dans `economy.ts` ; position + `regrowAt` joints au `NodeDelta` à l'épuisement (protocole v2) ; rendu client : fin du fantôme à 25 %, pousse/reformation à l'échelle, souches transitoires, sprites blocky (`nd-sapling`/`nd-stump`/`nd-scar` + nœuds redessinés en rectangles). Tests : `recolte-vivante.test.ts` (A1-A6), `economy`/`session`/`tension`/`saison` mis à jour ; smoke `recolte_vivante` (dérive vérifiée en jeu). Reste ouvert : le CALIBRAGE des nombres (seuils de gate, pas de marche, rayon, `GROWTH_MIN`) — en playtest.*

## Le problème

Deux choses sonnent faux dans la récolte d'aujourd'hui, et les deux tiennent à un écart entre le GDD et le code.

1. **Le nœud ne vit pas.** Un `ResourceNode` est posé une fois, à une tuile fixe. On le vide → `stock` tombe à 0 → le client le peint **fantôme à 25 %** (`setAlpha(stock > 0 ? 1 : 0.25)`) et, après le délai de repousse, la sim le **remplit à plein, au même pixel, même id**. Or le GDD §8bis — cité mot pour mot dans le commentaire de `depletions` — promet l'inverse : la ressource *rouvre ailleurs*, le joueur *tourne*. Le code referme et rouvre sur place.
2. **Les deux leviers de rendement sont morts.** `base = max(1, floor(TOOL_YIELD[tier] × (1 + 0.04 × niveau) × harvestFactor))`. Le `+4 %/niveau` est **écrasé par le `floor`** dès que les nombres sont petits (avec un outil ×2, monter le métier de 0 à 10 laisse le rendement à 2 → 2 : la compétence est invisible là où on passe le jeu). Et **fortune = atelier** en rendement (les deux à ×2) : améliorer son outil du bricolé au forgé ne se sent pas au sac.

## Les trois décisions actées (Alexis, 2026-07-19)

- **D1 — Le monde se déplace, par famille.** À l'épuisement, un nœud de **bois ou de plante** (métier `woodcutting` / `foraging`) **meurt sur sa tuile et rouvre sur une tuile voisine seedée du même amas** — le bosquet dérive, il ne clignote plus. Un nœud de **pierre / minéral** (métier `mining` : `rock`, `iron_vein`, `coal_seam`, `quarry`, `rubble`) **reste sur place** : ton camp bâti contre un affleurement reste prévisible. Le prédicat est exactement la famille de métier (`def.skill !== 'mining'` ⇒ se déplace).
- **D2 — Fini le fantôme.** Un nœud épuisé ne se peint plus à 25 % d'opacité. Il porte un **vrai état d'épuisement** (souche pour l'arbre, buisson pelé pour la plante, roche éclatée pour le minéral) et la repousse est **visible** (une pousse qui grandit sur la durée du timer, un minéral qui se reforme), pas un pop.
- **D3 — La compétence OUVRE l'outil ; l'outil DONNE le rendement.** Plutôt que deux petits multiplicateurs indépendants qui s'écrasent dans le `floor`, on les met **en chaîne** : la compétence du métier du nœud **gate l'usage effectif** de l'outil (gate **DOUX** : un outil trop bon pour ton niveau rend comme le meilleur palier que tu maîtrises, jamais rien), et **les quatre paliers d'outil deviennent quatre rendements distincts** — `main 1 / fortune 2 / atelier 3 / fer 4`. Ça **révise `craft-fortune`** (l'outil de fortune n'est plus l'égal de l'atelier : il *dépanne*, il ne remplace pas). Le `+4 %/niveau` se réduit à une **micro-marche additive** qui remplit le tunnel entre deux déblocages. *(Chiffres = ordre de grandeur, calibrés en playtest — CLAUDE.md.)*

## Invariants respectés (non négociables)

- **Déterminisme (invariant §2).** Le choix de la tuile de relocalisation est une **pure fonction de `(nodeId, depletions)`** via `hash2` — **positionnelle, sans tirer dans `state.rng`**, donc elle ne décale PAS le flux RNG seedé et ne casse aucun test sans rapport (leçon connue : le RNG est fragile au décompte/à l'ordre des entités). Aucune fonction Math approximée : que `+ − × ÷`, `floor`, `hash2`. Même seed + mêmes inputs ⇒ mêmes relocalisations, mêmes rendements, même flux d'événements.
- **État sérialisable (invariant état-de-sim).** Rien de neuf dans `SimState` : la relocalisation **mute `tx/ty` du nœud existant** (même id, même objet) — le **nombre de nœuds ne change jamais**, l'index n'a ni ajout ni retrait à gérer, seulement une **position qui a bougé**. La souche à l'ancien emplacement et la pousse au nouveau sont des **transitoires CLIENT** (aucun état de sim), dérivés du changement de position d'un id connu.
- **Sim pure, client bête (invariants §1/§3).** La sim déplace le nœud et fixe `regrowAt` ; le client **miroite** — il repositionne le sprite de cet id, peint la souche qui s'efface à l'ancien coin et la pousse qui grandit au nouveau. Il n'invente aucune position.

## Mécanisme 1 — La dérive du bosquet (D1)

À l'épuisement d'un nœud `woodcutting`/`foraging` (dans `harvestStrike`, quand `stock <= 0`) :

- **R1 — Tuile cible seedée.** On sonde une **séquence déterministe de tuiles candidates** dans un rayon `RELOCATE_RADIUS` autour de l'origine, tirées de `hash2(nodeId, depletions, k)` pour `k = 0..RELOCATE_PROBES-1`. La première candidate **valide** gagne. Valide = même classe de terrain que le type du nœud accepte (le nœud ne saute pas de la forêt à la lande), **libre** (pas d'autre nœud, pas de structure, pas bloquée), **hors clairière de lieu** (`poiClearings`). L'amas `groveBoost` existant fait déjà pencher les candidates vers le cœur du bosquet — la dérive suit la densité, elle ne s'éparpille pas.
- **R2 — Dégradation gracieuse.** Si aucune des `RELOCATE_PROBES` candidates n'est valide (coin saturé, cerné d'eau…), le nœud **reste sur place** — jamais de perte, jamais de nœud coincé hors-carte. C'est le même esprit que « le raté rend le baseline » : le pire cas est l'ancien comportement, pas un bug.
- **R3 — La repousse EST l'animation.** À la relocalisation on met `stock = 0` et `regrowAt` (barème inchangé : `NODE_REGROW_TICKS × acte × usure d'épuisement`). Le client peint alors, sur toute la durée `[tick, regrowAt]`, une pousse qui grandit au nouveau coin (stock 0 = pas encore récoltable) ; à `regrowAt` la sim remplit le stock (riche, `withForageRichness` pour les plantes) et l'arbre/le buisson est adulte. Le timer caché DEVIENT lisible.
- **R4 — L'index tuile→nœud suit le déménagement.** `nodeAt` mémoïse un `Map` tuile→nœud par référence de tableau ; une relocalisation mute `tx/ty` **sans** changer la référence du tableau, donc l'index doit être **invalidé/mis à jour** à ce moment précis (rebuild paresseux ou patch ciblé de l'entrée déplacée). C'est le seul point d'implémentation délicat, et il est purement technique.

## Mécanisme 2 — L'épuisement sur place, mais VIVANT (D1/D2)

Nœud `mining` : **position inchangée**. À `stock <= 0`, `regrowAt` comme aujourd'hui, refill sur place à l'échéance. Le seul changement est **le rendu** (D2) : plus de fantôme à 25 %, mais une **roche éclatée / un filon éventré**, et une reformation visible sur `[tick, regrowAt]`. Aucun changement de sim au-delà de ce qui existe — c'est la promesse « vivant » tenue par le client sur un fait de sim déjà présent (`stock`, `regrowAt`).

## Mécanisme 3 — Le rendement en chaîne (D3)

Dans `harvestStrike` / `toolMultiplier`, on remplace le multiplicateur floté par une **chaîne compétence → outil** :

- **Y1 — Barème d'outil à quatre marches distinctes.** `TOOL_YIELD = { none: 1, crude: 2, basic: 3, iron: 4 }`. Chaque amélioration d'outil paie **au sac**, pas seulement en accès. *(Révise `craft-fortune`.)*
- **Y2 — Gate DOUX de la compétence sur le palier EFFECTIF.** `effectiveTier = min(heldTier, maxTierByLevel(level))` où `level` = niveau du **métier du nœud** (woodcutting pour la hache, mining pour la pioche). `maxTierByLevel` : `crude` toujours ; `basic` si `level ≥ GATE_BASIC_LEVEL` ; `iron` si `level ≥ GATE_IRON_LEVEL`. Un outil trop bon pour toi **rend comme le palier que tu maîtrises** — jamais rien (l'esprit « doux » de `recolte-maitrise` D3). Le rendement lit `TOOL_YIELD[effectiveTier]`.
- **Y3 — Le gate touche le RENDEMENT, jamais l'ACCÈS.** La vérif `minTool` (`strikeRejection`) reste sur le **rang réel de l'outil tenu** : avec une pioche d'atelier et un `mining` faible, tu **ouvres** le filon de fer (rang OK) mais tu le mines au rendement `crude` tant que ton niveau n'a pas rejoint `basic`. C'est indispensable pour **éviter le blocage de progression** (il faut miner du fer pour monter `mining` ; si le skill gâtait l'accès, on ne pourrait jamais commencer).
- **Y4 — Micro-marche de compétence, additive et entière.** `base = max(1, floor((TOOL_YIELD[effectiveTier] + floor(level / SKILL_YIELD_STEP)) × harvestFactor))`. Additive ⇒ **survit au `floor`** (contrairement au `× (1 + 0.04·niveau)`) ; `SKILL_YIELD_STEP` grand ⇒ un `+1` rare, l'avantage du spécialiste, qui **remplit le tunnel** entre deux déblocages sans doubler l'outil. Le bonus de coup PROPRE (`recolte-maitrise`, `+50 %`, plancher `+1`) et `harvestFactor` (alignement) s'appliquent au-dessus, inchangés.

## Nombres proposés (ordre de grandeur — à caler en playtest)

| Constante | Aujourd'hui | Proposé | Pourquoi |
|---|---|---|---|
| `TOOL_YIELD` | `none 1, crude 2, basic 2, iron 3` | `none 1, crude 2, basic 3, iron 4` | Quatre marches distinctes (Y1). |
| `SKILL_YIELD_BONUS` (×/niv) | `0.04` | *supprimé* | Remplacé par la marche additive. |
| `SKILL_YIELD_STEP` (nouveau) | — | `8` | `+1` rendement tous les 8 niveaux (Y4). |
| `GATE_BASIC_LEVEL` (nouveau) | — | `2` | ~400 récoltes : l'atelier se mérite tôt. |
| `GATE_IRON_LEVEL` (nouveau) | — | `5` | ~2 500 récoltes : le fer est un cap. |
| `RELOCATE_RADIUS` (nouveau) | — | `12` tuiles | « la même zone environ » (R1). |
| `RELOCATE_PROBES` (nouveau) | — | `8` | Assez pour trouver une tuile libre, borné (R2). |
| `NODE_DEFS[*].stock` | inchangé | inchangé (1er jet) | Levier de cadence de rotation — calé après avoir mesuré. |

## Hors périmètre

- **Le stock par nœud.** On garde les valeurs actuelles au premier jet ; c'est le levier qui règle *à quelle fréquence on tourne*, et il se cale une fois le reste mesuré (pas d'aveugle).
- **La chasse et la pêche** (`chasse.ts`, `poisson.ts`) : leurs gestes et leurs ressources ont leurs specs. Cette passe ne touche QUE les nœuds de récolte.
- **Le son** : aucun son dans le jeu à ce jour ; le retour d'épuisement/repousse est visuel.

## Critères d'acceptation (à écrire AVANT le code, invariant tests)

- **A1 — Déterminisme.** Même seed + mêmes inputs ⇒ même suite de relocalisations (tuiles cibles), mêmes rendements, même flux d'événements. Couvert par un test dédié et `replay.test.ts`. La relocalisation ne consomme pas `state.rng` (vérifiable : l'état RNG après une récolte avec relocalisation est identique à sans).
- **A2 — La dérive reste dans la zone (R1/R2).** Un nœud `woodcutting`/`foraging` relocalisé atterrit sur une tuile **valide** (terrain/libre/hors clairière) à **≤ `RELOCATE_RADIUS`** de son origine ; un nœud `mining` **ne bouge jamais** ; coin saturé ⇒ le nœud reste sur place, sans perte.
- **A3 — Nombre de nœuds invariant (R4).** Une relocalisation change `tx/ty` d'un id existant, **jamais la longueur** du tableau de nœuds ; après le déménagement, `nodeAt(ancienne)` est vide et `nodeAt(nouvelle)` rend ce nœud.
- **A4 — Gate DOUX du rendement (Y2/Y3).** Sous `GATE_BASIC_LEVEL`, une pioche/hache d'atelier tenue rend comme `crude` (palier effectif), pas `basic` ; au seuil, elle rend `basic` ; et **l'accès** (ouvrir un nœud `minTool: 'basic'`) fonctionne SOUS le seuil (pas de blocage de progression). Testé sur la fonction de jugement.
- **A5 — Quatre paliers strictement croissants (Y1).** À niveau et clean égaux, `none < crude < basic < iron` en rendement, strictement — mesuré sur la fonction, pas affirmé.
- **A6 — La compétence se sent encore (Y4).** Le rendement monte d'un cran additif au niveau élevé, **indépendamment de l'outil** ; et deux joueurs mêmes outils, niveaux écartés d'un pas de `SKILL_YIELD_STEP`, diffèrent d'exactement `+1`.
- **A7 — Économie viable (mesurée).** Un bot headless avec outil d'atelier et compétence médiane **soutient** un débit de craft cible sans famine — mesuré (façon `recolte-maitrise` A3), pas asserté. On MESURE la source moyenne par minute contre le puits d'une recette de référence avant de figer les nombres.
- **A8 — Le rendu tient la promesse (D2).** (Client) un nœud épuisé peint son **état d'épuisement** (souche/pelé/éclaté) et non `alpha 0.25` ; un nœud relocalisé **repositionne** son sprite d'id, efface la souche à l'ancien coin et fait grandir la pousse au nouveau. Testé côté client (cadrage) sur le mapping snapshot→sprite.
- **A9 — Le bot headless joue avec** (`bot.test.ts`) : la boucle de récolte complète tourne avec la dérive et le gate, et son replay reste identique au bit près.
