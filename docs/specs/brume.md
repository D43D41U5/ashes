# La Brume — froid mobile, déni de zone, la menace qui paie ceux qui la suivent

> ⛔ **LA BRUME NE SE LÈVE PLUS DEPUIS LE 2026-08-24** — et ce n'est pas une décision sur la
> Brume, c'est une conséquence. Son corridor s'élisait sur le **front de Cendre** (R1 : « point
> d'entrée sur le front de Cendre → profondeur `BRUME.PROFONDEUR` tuiles dans T0 »), et le front
> est retiré avec la Cendrière (décision d'Alexis, `docs/decisions.md`). `elireCorridor` rend
> `null` à chaque jour éligible : tout le mécanisme est intact, il n'a plus d'ANCRE. Lui en
> redonner une est un point de la nouvelle mécanique de cendre.

*Source : GDD §9bis (« Brume irradiée — zone mobile, déni de zone, en se retirant elle découvre des ruines fraîches »), décisions Alexis 2026-08-18 (journal). Statut : **décidé, à implémenter**. Ouvre le chantier « catalogue §9bis » (deux événements construits sur onze promis avant elle — les menaces ont rattrapé le contrat, pas les opportunités).*

## Objectif de design

Une opportunité contestée : une nappe de froid létal sort de la Cendrière, roule sur T0 pendant un jour, puis se retire en découvrant un filon minier riche et temporaire. Fuir ou suivre — la tenue d'hiver est « l'équipement requis » du GDD, le Feu la tient à distance, et le retrait paie ceux qui ont marché derrière elle. Contrat §9bis tenu à la lettre : **annoncée pas surprise** (le gibier se tait la veille), **le monde ne s'adapte pas** (trajectoire propriété du monde), **rien n'est instancié** (le filon est un lieu partagé).

Deux décisions actées la fondent (2026-08-18) :
1. **Le déni de zone est un froid.** Pas d'équipement dédié (masque = Vallée/T3), pas de DoT neuf : la nappe abaisse la température de BASE du lieu, et toute la chaîne vitale existante fait le reste. Reskin de fiction assumé : « irradiée » → glacée (dans ASHES, la Cendre porte le froid). *(Précision d'implémentation : T2 était en réalité déjà tranché — `ACT_COLD[2] = 50`, la plaine de NUIT tue en acte III. La Brume étend donc la raison d'être de la tenue au JOUR et à l'acte II — elle n'ouvre ni ne ferme T2.)*
2. **Le retrait découvre un filon affleurant gardé.** Fusionne deux événements du catalogue (Brume + Filon affleurant) en un chantier ; patron carcasse de convoi pour la garde et l'expiration.

## Règles

### La nappe (R1-R3)

- **R1 — Géométrie : un disque qui fait l'aller-retour.** La nappe est un disque de rayon `BRUME.RAYON` dont le centre suit un segment : point d'entrée sur le front de Cendre → profondeur `BRUME.PROFONDEUR` tuiles dans T0 (aller pendant la première moitié de la fenêtre, retour pendant la seconde). Position **calculée du tick** par une fonction pure `brumeAt(state)` (interpolation linéaire — patron `frontActuel` de `cendre.ts`), partagée sim/client. Le corridor (les deux extrémités du segment) est élu à l'annonce et posé dans `state.brume` (record JSON nullable, purgé au retrait — patron `refugees`).
- **R2 — Cadence et fenêtre.** Éligibilité du jour de saison par `hash2(jour, seed)` contre `BRUME.CHANCE_PER_DAY[acte]` — la Brume n'existe pas en acte I. Au plus **une nappe à la fois, une par cycle réel**. L'annonce tombe au crépuscule du cycle précédent ; la nappe entre à l'**aube** et se retire au **crépuscule** du même cycle — le jour du passage, la zone est déniée, et le filon se découvre à la nuit tombante : y courir de nuit est le pari, attendre l'aube laisse les traînards s'évaporer. Derrière `state.worldEvents`, comme tout événement du monde.
- **R3 — Le corridor évite les Feux.** À l'élection, tout corridor dont le SEGMENT passe à moins de `RAYON + GARDE_FEU` d'un Feu de village est rejeté (candidats suivants par hash2) — le bord de la nappe reste donc à ≥ `GARDE_FEU` (= `FIRE_RANGE`) de tout Feu, et la bulle plancherait de toute façon (A5 le prouve). La Brume est un déni de zone sauvage, pas un tueur de villages — le Blizzard (autre événement, carte entière) portera ce rôle-là.

### Le froid (R4-R5)

- **R4 — La nappe abaisse la température de BASE.** Dans le disque, `baselineTemperature` subit `−BRUME.COLD_MALUS` (assez pour passer sous `HYPOTHERMIA` en plaine de jour dès l'acte II). Conséquences **par construction**, zéro code neuf côté vitals : le Feu et la source chaude planchent (`ambientTemperature` est un max) — la bulle d'un Feu actif est un refuge ; la `tenue_hiver` planche l'ambiant à `TENUE_FLOOR` — suivre la Brume bien vêtu est survivable, mal vêtu on fuit ; la dérive (`driftStep`) laisse le temps de sortir — pas de mort-couperet.
- **R5 — Effet de bord à garder à l'œil (pas à empêcher).** Le gate d'attraction des Cendreux (spec feu-station S5) lit `baselineTemperature` : une nappe froide peut moduler leur comportement à proximité. Thématiquement juste (« la Brume est hantée ») — à couvrir d'un test de non-régression, pas d'une garde.

### Les signes et le retrait (R6-R8)

- **R6 — Le gibier se tait la veille.** À l'annonce : `faunaQuiet` posé sur le corridor (le silence EST le signe lisible in-world), événement `brume_annonce` (chronique : « le gibier se tait — un souffle froid descend de la Cendrière »). À la levée : `brume_levee`. Le silence tient jusqu'au retrait.
- **R7 — Le retrait paie.** Au crépuscule : `brume_retiree`, et au point profond du corridor (élu par hash2, vérifié marchable et vierge à l'élection) apparaît un **filon affleurant** : nœud minier riche (`iron_vein`/`coal_seam`), type par hash2 (part charbon `BRUME.FILON_PART_CHARBON` — le charbon est le goulot mesuré), stock `BRUME.FILON_STOCK`, **sans repousse** (un événement, pas un gisement), retiré après `BRUME.FILON_JOURS` jours de saison s'il n'est pas épuisé. Son id vit dans un **espace dédié dérivé du jour** (`FILON_ID_BASE + jour`) — jamais `max+1`, jamais réutilisé (axiome PART_DU_NOEUD : un id est fixe). Événements : `filon_decouvert` (chronique) à la pose ; **`filon_retire`** quand la fenêtre se referme SANS coup de pioche final (périmé, remplacé par une Brume suivante, ou mangé par la Cendre) — le filon vidé, lui, a déjà son `node_depleted`.
- **R8 — Les traînards.** `BRUME.TRAINARDS` Cendreux gardent le filon, `expiresAt` ~1 cycle, dissipés **jamais sous les yeux** (patron carcasse, purge `worldevents.ts`).

### Déterminisme (R9)

- **R9 — Zéro tirage sur le PRNG d'état.** Occurrence, corridor, type et position du filon : tout par `hash2` du jour de saison (patron réfugiés, `refugees.ts:13-14`). Activer la Brume ne décale AUCUN tirage existant — les tests replay/events du dépôt passent inchangés. C'est une exigence, pas une préférence (mémoire projet : le décompte d'entités décale le flux seedé).

## Critères d'acceptation

- **A1** — Même seed → mêmes jours de Brume, même corridor, même filon ; replay exact avec Brume active.
- **A2** — Le flux RNG des autres systèmes est bit-identique avant/après le chantier (suites replay/events existantes vertes sans retouche).
- **A3** — `brume_annonce` précède la levée d'au moins un crépuscule→aube ; `faunaQuiet` couvre le corridor dès l'annonce.
- **A4** — Un avatar sans tenue au centre de la nappe : température sous `HYPOTHERMIA`, PV qui baissent ; il sort, il récupère — la dérive laisse fuir.
- **A5** — Les planchers tiennent : dans la bulle d'un Feu actif, aucun dégât ; avec `tenue_hiver`, jamais sous `TENUE_FLOOR`, donc jamais de dégât de froid.
- **A6** — Au retrait : filon posé (type, stock, expiration paramétrés), gardé ; traînards jamais dissipés dans le champ de vision d'un avatar ; filon retiré après `FILON_JOURS`.
- **A7** — Banc 6 cycles × 3 seeds : **zéro mort PNJ** par froid de nappe (le corridor tient les Feux à distance par construction — R3).
- **A8** — `worldEvents=false` → aucune annonce, aucune nappe, aucun filon (un banc qui n'a pas demandé de guerre n'a pas non plus demandé de brume).

## Hors périmètre (et où ça revient)

- **Le rendu de la nappe** — chantier client séparé (da-rendu, scénario smoke dédié) ; le contrat sim est prêt : `state.brume` dans le snapshot + `brumeCentre` pure partagée (exportée d'`index.ts`). La nappe doit se voir DE LOIN (annoncée, pas surprise). **Deux points de protocole relevés à l'audit, à traiter dans CE chantier-là** : (a) la liste des nœuds ne part qu'au `ready` et `applyNodeDeltas` jette les ids inconnus — le client doit MATÉRIALISER le filon depuis `filon_decouvert` (qui porte tout : nodeId, nodeType, tx, ty) ; (b) il doit le DÉMATÉRIALISER depuis `filon_retire` (périmé/remplacé/mangé) et `node_depleted` (vidé), sinon nœud fantôme.
- Équipement dédié (masque, « irradiée » à la lettre) → Vallée, avec le T3.
- Blizzard (carte entière), interaction spéciale avec la nuit-qui-chasse, PNJ qui exploitent le filon, multi → plus tard.
- La sous-décision « teaser du Filon » (nœud statique de worldgen, stock de naissance) est un fil À PART — la Brume ne la préempte pas.

## Ajouts à `balance.ts`

Bloc `BRUME` (ordres de grandeur, à calibrer en jouant) : `CHANCE_PER_DAY = [0, 0.35, 0.5]` (par acte), `RAYON = 8` tuiles, `PROFONDEUR = 28` tuiles, `BANDE = 6`, `COLD_MALUS = 55` (la promesse R4 le contraint : 90 − 25 − 55 = 10 < HYPOTHERMIA 20 — un 40 laisserait la plaine d'acte II au-dessus du seuil), `GARDE_FEU = 6` tuiles (la garde balaie à `RAYON + GARDE_FEU` du segment), `ESSAIS = 8`, `FILON_STOCK = 12`, `FILON_PART_CHARBON = 0.4`, `FILON_JOURS = 3`, `TRAINARDS = 2`, `TRAINARD_TTL` (~1 cycle). Événements : `brume_annonce`, `brume_levee`, `brume_retiree`, `filon_decouvert` (+ entrées `CHRONICLE_EVENT_TYPES` pour annonce et filon).
