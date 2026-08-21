# La saison sans fin — le plan en cinq tranches

*Source : `docs/specs/saison-sans-fin.md` (décidé 2026-07-31), les décisions d'Alexis du 2026-08-21 (**l'arc oscille** — « le jeu devient de plus en plus dur mais on peut survivre à plusieurs hivers » ; **la pression vient de l'environnement** — le cortège de cendre, livré), et la refonte **pression-croissante des Cendreux** (spec du 2026-08-21, 19 décisions, livrée — elle change la liste des lois, voir §1). Statut : **T1 à T4 livrées (2026-08-21) ; reste T5 (le scellement) et les deux questions de T2 (le nom de l'acte IV, les pentes)**. Jalon : le pivot systémique d'avant GATE 1 (question O7 de la spec — tranché de fait par « continue »).*

---

## §1 — L'état RECONNU, pas supposé

**La refonte pression-croissante a déjà fait un tiers du chemin, et il ne faut pas le refaire :**
- `UNDEAD_SHARE` est **mort** (la bascule d'espèce par acte est remplacée par le cadran de température — décisions 2-3) ; la **méga-horde** est morte (décision 19, la pente continue suffit) ; `HORDE_CHANCE` et `HORDE_TAILLE` sont déjà des **rampes continues sur le jour** (`{DEBUT, FIN}`), plus des tables d'acte.
- **« Le froid est le cadran »** fait de `T.ACT_COLD` la **loi maîtresse** : l'éveil des Cendreux, l'attraction des feux, la torpeur — tout dérive de la température locale, qui dérive de l'acte par `ACT_COLD`. **Refroidir sans fin escalade les Cendreux gratuitement** — c'est la convergence des deux chantiers, et c'est elle qui rend le pivot bon marché.

**Ce qui reste indexé sur l'acte dans `/sim`** (relevé le 2026-08-21, hors `ACT_NAMES` déjà rendu total) :

| quantité | table | consommateur |
|---|---|---|
| `T.ACT_COLD` | [0, 25, 50] | `temperature.ts` ×2 — **la maîtresse** |
| `BALANCE.ACT_HUNGER_FACTOR` | [1, 2, 3] | `economy.ts` |
| `SEASON.REGROW_ACT_FACTOR` | [1, 1.5, 2] | `economy.ts` |
| `ALIGNMENT.ACT_FACTOR` | [1, 2, 3] | `alignment.ts` |
| `FIRE_UPKEEP.ACT_FACTOR` | [1, 1.5, 2] | `village.ts` |
| `NIGHT_HUNT.CHANCE_PER_MIN` | [0.12, 0.3, 0.55] | `nighthunt.ts` |
| `BRUME.CHANCE_PER_DAY` | [0, 0.35, 0.5] | `brume.ts` ×2 |
| `METEO.CHANCE_PER_CYCLE` | [0.5, 0.65, 0.8] | `meteo.ts` |
| `METEO.TYPES` | 3 mixtures | `meteo.ts` — une **mixture**, pas un scalaire |
| `CENDREUX.CONVERGE_TILES` | [20, 80, 10000] | `monsters.ts` ×2 — **table ASSUMÉE** (plan pression-croissante : « une portée de perception, pas une intensité — le continu vit dans l'éveil ») : elle devient TOTALE, jamais continue sans décision d'Alexis |

**Le calendrier** : `actForDay` plafonne à 3 (`ACT_BOUNDARIES` [21, 42]), `type Act = 1 | 2 | 3` (`time.ts:19`) — le type du temps fige ce que la spec délie, comme `act_started.act` le figeait dans le bus (élargi le 2026-08-21). `season_ended` tombe au jour 61, l'Arche part au jour 58 et se verrouille à vie, le front gèle au jour 60 (`avanceeDuFront`, borne t ≤ 1).

## §2 — Les cinq tranches

### T1 — Les dix lois, à comportement IDENTIQUE *(prête ; aucune décision requise)*

Chaque table devient une **fonction totale** `loi(act)` dans son bloc de réglage — valeur d'acte III en **plafond provisoire** au-delà de 3 (« la pente par tour arrive en T2 ; cette fonction est le POINT UNIQUE où elle s'écrira »). `Act` s'élargit à `number`. **A3 par le compilateur, pas par grep** : les tables privées, l'indexation `[act - 1]` devient une erreur de compilation partout. `METEO.TYPES` et `CONVERGE_TILES` gagnent un accès total en restant des tables (une mixture et une portée assumée ne sont pas des pentes). Garde neuve : balayage A2 (10 lois × 200 actes — monotone, plafond **atteint et tenu**, jamais `undefined`/`NaN`), et l'égalité **aux littéraux** sur les actes 1-3 (jamais à la table qu'on teste — une garde écrite avec sa constante ne garde rien). **Sortie : bit-exact sur l'arc nominal — replay, events et les 4 suites verts sans amendement.**

### T2 — Le calendrier des tours *(LIVRÉE — 84 jours, quatre actes de 21, décision d'Alexis ; pentes à zéro en attendant O3)*

`actForDay` non borné et monotone (A1) ; l'**année** = 4 actes (l'option oscillante du scénariste) ; chaque loi devient `min(plafond, socle(k) + AMPLITUDE[(acte−1) mod 4])` avec `k` = numéro de tour et `socle(k+1) = socle(k) + PAS` — additions bornées, R1bis. **A2 se réénonce sur `k`** (une loi cyclique n'est pas monotone en acte — c'est la concession assumée de l'option). A5 (10×60 jours, la sim tourne, l'acte croît). Décisions à poser une à une : **la longueur de l'année en jours** (la vitesse R6 s'en dérive), **les noms des actes ≥ 4** (le baptême des tours — bible §5), **les PAS et plafonds** des lois (O3 — calibrage banc, mais l'ordre de grandeur se décide).

### T3 — Le front en escalier *(LIVRÉE — « oui » d'Alexis : il mord l'hiver, tient l'été, ne recule jamais ; bouchée 0,25 de la course de l'an 1)*

Le front **mord l'hiver, tient l'été, ne recule jamais** — l'érosion irréversible qui sauve « tout est condamné » sans amender le GDD *(ma reco en séance ; la parade d'Alexis — la braise qui repousse — l'a rendue tenable ; à confirmer en une ligne)*. Bouchée d'hiver = `PART_CIBLE / TOURS_NOMINAUX` de la course calibrée ; au-delà de l'arc nominal le front continue — la vallée finit par n'être plus qu'un refuge, **sauf parade** (chantier design séparé, contrainte déjà actée : elle repousse le SEUIL, jamais ne réchauffe le CLIMAT — bible I3, `flore-froid` F1bis). Le cortège suit gratuitement (il est en parts de la course). `cendre_prend` et la hantise suivent sans une ligne.

### T4 — La fin qui n'en est plus une *(LIVRÉE — « je suis ta reco » : en solo ni verdict ni Arche ; `finDeSaison` dans l'état, `null` en Veillée, repli `null` pour les vieilles sauvegardes ; le voile client ne tombe plus jamais en solo — aucune ligne à y changer)*

`season_ended` du jour 61 devient le **verdict de sortie d'hiver** (un par an — O6) ; l'Arche devient **caravane** (elle repasse, `arkDeparted` devient un compteur — O2, piste du scénariste, décision d'Alexis) ; le voile client `season-veil` cesse d'être terminal (chantier UI) ; le solo ne se réinitialise jamais (R4) et `VEILLEE_SEASON_CYCLES` devient le réglage de vitesse (R6). **Risque nommé** : `calendarScale` est FIGÉ dans les sauvegardes (`sim-worker` — « la sim garde son échelle figée ») ; une Veillée d'avant le pivot doit continuer de rejouer à l'identique — la migration est un chantier en soi, pas un détail.

### T5 — P5b : la mémoire des hivers *(1 décision : le scellement)*

La chronique d'un hiver écoulé **se scelle** à la sortie d'hiver (reco du scénariste : relisible à jamais, plus jamais augmentée — la seule borne propre à une mémoire sans fin) ; compaction de `SaveRecord.chronicle` ; la **fiche par lieu** (annales + chronique interfeuillées par la clef de LIEU, jamais fusionnées en données) ; clef de lieu sur les événements qui n'en ont pas. Le plus gros morceau est l'UI de lecture.

## §3 — Les risques, instrumentés d'avance

- **Le banc** : `starvationSamples ≤ 10` est calibré à l'ARC NOMINAL ; des années infinies le feront rougir tout seul — recalibrer le banc AVEC T2, pas après. Et le banc n'a pas de joueur : les verdicts « par joueur » y mesurent l'instrument.
- **Le RNG** : les lois ne tirent rien (T1 sûr), mais T3 (front en escalier) change les JOURS où les nœuds brûlent → le flux d'événements bouge ; contrat = reproductibilité, pas compatibilité de seeds.
- **Les deux horloges** : cadence réelle vs jours de saison, découplées par `calendarScale` — chaque tranche revalide les gardes de couplage (le bug historique : l'acte III après la fin).
- **Le client** : bandeau d'acte, ciel, `season-veil` — T2/T4 ont chacun un volet client qui se VOIT (smoke avant de livrer).
- **Le smoke et les scénarios épinglés** sur le jour 60/61 (évacuation, verdicts) : inventaire à faire en T4.

## §4 — Hors de ce plan, dit clairement

La **parade anti-cendre** (design à part, une décision d'Alexis) ; le **wipe multi** (LAN, R3b/R5) ; la **létalité post-seuil** (R7 — à construire quand le recensement dira que le nombre sature) ; la **toponymie** (question de l'écrivain, toujours ouverte).
