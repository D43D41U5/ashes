# Reprise — le chantier de l'eau

*État au 2026-09-12 (soir), écrit pour reprendre dans un contexte neuf. À lire dans cet ordre : ce fichier, `docs/specs/qualite-eau.md`, `docs/specs/piste-de-sang.md`, puis les entrées du 2026-09-12 du volet `docs/decisions/gameplay-systemes.md` (`grep 2026-09-12 docs/decisions.md`).*

*La cartographie complète — l'état de toute l'eau au matin du 12 et quatorze propositions — vit sur une page publiée : https://claude.ai/code/artifact/792fac97-fe51-43a2-9bed-19fe218a269d. Ses propositions sont résumées au §3 pour ne pas en dépendre.*

## 1. Ce qui est livré — le lot SANG côté `/sim`, en trois commits

Trois commits, trois coupables désignés (`git log --grep "qualité de l'eau"`, `--grep "Q9"`, `--grep "piste de sang"`) : le porteur, puis chacun des deux consommateurs seul, suite et empreinte entre les deux — parce que chaque consommateur **bouge le flux PRNG seedé**, et un test sans rapport qui rougit doit avoir un coupable. La méthode a payé au troisième commit (voir §5).

### 1a. Le PORTEUR de la qualité de l'eau (`81687bf`)

- **`coulee.ts` est le porteur unique** (décision n° 2) : `qualiteDeLEau` rend une force dans [0,1], plusieurs causes, **le maximum, jamais la somme** ; `eauSouillee` n'est plus qu'un seuil (`SANG.SEUIL_SOUILLE`). La suie (R26) garde son verdict **au bit près** (A1, relevé sur le monde joué avant/après).
- **L'eau gagne un état local borné** (décision n° 1) : `SimState.souillures[]` — `{ i, tick, crans, pas, homme? }`, jamais dans `map` (`carte-immuable.test.ts` inchangé). Expiration `SANG.TACHE_TICKS` (5 min), plafond `SANG.TACHES_MAX` (64) qui évince la souillure **nourrie le moins récemment**. Persistance : `REPLIS_EPHEMERES`, sans bump de format.
- **La loi** (`faune.ts`, `souiller` dans `advanceBlood`) : une goutte qui tombe sur une eau d'aujourd'hui crée ou rafraîchit la souillure de SA tuile. Refus : l'étage, la glace. **Le marais et la roselière se souillent toujours, crue ou pas** (décisions d'Alexis). En rivière, la traînée **descend** le fil sur `DILUTION_PAS` pas et ne remonte jamais ; en eau dormante, un disque de `PORTEE_DORMANTE` ; la berge jamais. Attache au fil par plus-proche-point, borne **Chebyshev** `ATTACHE = DEMI_LIT + 1`.
- **Le fait `water_fouled`**, une fois par création, déclaré `muet` à l'inventaire audio.
- **Mesuré** : empreinte `/sim` (12 scénarios) — `rngState` et les 13 compteurs identiques, seul écart les `water_fouled`. Coût : 5,7 µs par création, 0,28 µs par lecture d'eau propre, 8,8 µs au plafond.

### 1b. Q9 — la bête renonce à boire une eau ensanglantée (`e9e4751`)

- `couleeStep` (`faune.ts`) : au bout de sa coulée, avant d'armer `drinkUntil`, la harde lit `eauSouillee` sur **l'anneau de 1** autour de la tuile du bout — parce que `zonegen-coulees` arrête la descente sur la BERGE. Souillée, elle ne boit pas ; la descente est consommée pour la fenêtre.
- **Pas de paramètre d'étage, et pas de sceau** : l'eau lue est celle du sol, la seule qui se souille, et tout bout de coulée est au sol (MESURÉ par la revue : 3 graines, 50 coulées, 0 bout d'étage). Un sceau sur `entity.etage` a été essayé puis retiré : sur la gueule d'un karst noyé il se trompait de sens.
- 3 gardes (A7, témoin, seuil) ; empreinte 12/12 identique — aucun scénario ne fait boire une eau saignée en 4 000 ticks.

### 1c. La piste de sang — les loups vivants remontent le sang de l'HOMME (troisième commit)

Spec `piste-de-sang.md`, statut LIVRÉ, 22 gardes (`piste-de-sang.test.ts`). Les trois décisions d'Alexis tiennent (sol et eau une seule règle ; la piste guide, elle ne réveille pas ; en silence jusqu'au contact — `wolf_on_trail` muet).
- `pisteStep` dans la branche « rien sous la dent » de `wolfStep`, avant `sortieTravel` ; bloc `PISTE` (`FLAIR`, `PAS` dérivé, `REPRISE_TICKS`) ; trois champs de mémoire `piste` / `pisteEau` / `pisteVue`.
- **UNE HYPOTHÈSE POSÉE SANS ALEXIS, à lui soumettre en premier à la reprise** : le loup ne remonte que **le sang de l'homme** (avatar ou villageois). La goutte et la souillure portent `homme?: true`. Pourquoi : la première écriture suivait tout sang, et la suite a rougi sur les deux gardes A26 du quota de prédateurs — MESURÉ en A/B sur le même monde (`tools/__a26-piste.mts`) : quatre loups ambiants pistaient chaque sanglier blessé jusqu'au bout, **9 → 19 sangliers tués en 150 s, le coin vidé de 15 à 5 bêtes, 2 → 4 loups tués par les sangliers**. R18 (« le reste du coin va au gibier ») tombait. **Réversible en deux lignes** (les deux `homme !== true` de `faune.ts`). Variante possible pour « le loup vole la prise du chasseur » : suivre aussi la bête blessée PAR un homme. Voir la spec P1 et Réserves.
- Mesuré : 8,4 µs par loup en chasse et par tick au plafond ; empreinte avant/après relevée (voir la ligne du journal).

## 2. Ce qui reste du lot SANG

### 2c. La teinte du sang dans l'eau — client

**Pourquoi c'est pressant** : sans elle, dans l'eau, la traque est silencieuse **et** invisible (sur la berge, les gouttes se voient déjà — `sang-sol.ts`).
- Ce qui existe : le canal B du champ d'eau porte un régime par tuile (`water-layer.ts` : `REGIME_LAC_MORT`, `REGIME_SUIE`) ; il lit `eauSouillee` avec un `EtatDeCendre` **sans** `tick` ni `souillures` (donc jamais le sang) ; il ne se recuit qu'au changement de jour de saison (`WorldScene.ts`, `recuireSuie`).
- Ce qui manque : **les souillures ne voyagent pas** — ni `protocol.ts` ni `interest.ts` ne les portent (les gouttes, si : même patron à suivre, et `homme` voyage déjà avec elles). Puis une cadence de recuisson qui tienne une souillure de 5 min — **à mesurer avant de promettre** (`perf`), et un rendu à juger à l'œil (`da-rendu`, skill `verif-navigateur`).
- À poser à Alexis (après l'hypothèse du §1c) : un régime distinct de la suie ? une teinte qui pâlit avec la force ?

## 3. Les autres axes de la cartographie — rien de commencé

Ordre recommandé par la page (§6) : **A1 → A2 → B1 + B3 → D1 → C1**.

- **A1 — Le débit, persisté** (donnée gelée). `map.debit`, un rang 0-7 par tuile, patron `distEau`/`natureEau`, additif, haché par `carte-immuable`. Le « geste zéro » : sans lui, A4, B1, B2 et C2 devinent la taille de l'eau.
- **A2 — Tous les fleuves.** **Défaut latent** : `natureEau` et les coins de pêche ne reçoivent que `map.fil` (le premier des `fils`) — un second fleuve passe pour un lac. Change combien de coins de pêche se posent, donc le PRNG : seul, empreinte sous les yeux.
- **A3 — La source devient un fait.** Les résurgences existent au worldgen puis deviennent un haut-fond anonyme : `FaitDeGeneration.type` n'a pas de `'source'`. Un type d'annale, un lieu découvrable.
- **B1 — La cascade a une voix** (client). `cascade-fx.ts` est parfaitement muet. Banc d'écoute : Atelier, onglet SON.
- **B2 — Le lit s'entend** (client). Une nappe qui suit la magnitude du champ de flux (déjà cuit côté client).
- **B3 — Spatialiser les deux voix d'eau** qui ne passent pas leur position au moteur. **Correctif technique**, sans question à poser.
- **C1 — La carte du joueur montre l'eau du jour** (client). Elle peint le terrain immuable : ni mare asséchée, ni gué fermé. Même cadence que la cendre sur la carte, au savoir « vu ».
- **C2 — Le régime du bief généralisé.** Le porteur existe maintenant (§1). Causes suivantes, chacune un geste : la crue turbide, le charnier en amont, le feu de village, **la carcasse dans l'eau** (une source continue, pas une goutte).
- **D1 — Les événements d'eau** : le bief qui prend, le dégel qui replie un corps, la mare qui part, le gué que la crue ferme. Ce sont des bascules de prédicat : observer au bord de cycle, un événement par bascule (piège : le clignotement dans la bande morte de l'hystérésis).
- **D2 — La corvée d'eau des PNJ.** Question pour Alexis : l'eau devient un stock de village, ou seulement un temps de trajet ?
- **D3 — Les roseaux récoltables.** Il faut d'abord savoir à quoi sert un roseau (question d'artisanat) ; semis positionnel contre le décalage du PRNG.
- **E2 — La mare qui meurt vraiment** (état local, patron des souillures). Frontière mince avec le marnage refusé le 26 juillet : à regarder à l'œil avant de coder.
- **E3 — Barrer un bief** : non recommandé (la carte immuable est ce qui rend l'autosave abordable).

## 4. Réserves connues

- **Le sang de l'homme seulement** (§1c) est une hypothèse, pas une décision d'Alexis. La chronique et la réputation consomment `wolf_on_trail` : si un jour le loup doit aussi voler la prise du chasseur, c'est le tag qu'on déplace (posé par l'attaquant), pas la piste qu'on réécrit.
- **La mémo de la suie est au niveau du module** : deux sims dans un processus (deux rooms) se la voleraient ; et `cendreAge.join(',')` alloue à chaque lecture. Noté, non corrigé.
- **Le disque ignore les paliers** (SUSPECTÉ) : le sang d'une mare basse pourrait teindre une eau en haut d'une falaise. Sonde à écrire sur le monde joué.
- **La lecture lit le terrain statique**, l'émission l'eau du jour : un haut-fond qui s'assèche garde sa teinte jusqu'à 5 min. Mineur.
- **Un rembobinage de jour en debug** laisse vivre des souillures « du futur » (même défaut que les gouttes).
- **La tourbière** n'existe sur aucun monde joué : non tranchée.

## 5. Méthode — ce que ce chantier a appris à ses dépens

- **Une autre session travaille sur le même arbre** (étages : `docs/specs/etages.md`, `npc.ts`, `etages-etancheite.test.ts`, une ligne du 2026-09-11 au volet, un commentaire de `suites.mjs`). Ne jamais commiter ses hunks : indexer par contenu (`git hash-object -w` + `git update-index --cacheinfo`), et régénérer `docs/decisions.md` depuis les volets **indexés**. Trois commits ont été faits ainsi ; l'arbre reste sale, et c'est voulu.
- **Le plancher `sim` de `suites.mjs` (2345)** a été relevé contre un compte qui inclut les 5 gardes non commitées de l'autre session (2363 sur l'arbre, 2358 sur l'arbre commité seul). Il passe dans les deux cas ; quand l'étage sera commité, vérifier que son commit n'écrase pas la ligne `plancher` avec un chiffre plus ancien.
- **Un commit par consommateur a désigné son coupable** : la suite a rougi sur deux gardes A26 sans rapport apparent avec l'eau, et il n'y avait qu'un suspect. Le diagnostic s'est fait par une sonde A/B **sans toucher `/sim`** (`tools/__a26-piste.mts` : muter `PISTE.FLAIR` à 0 au runtime, même monde, même graine — un `as const` ne gèle rien à l'exécution), en relevant l'espèce des morts AVANT leur retrait de l'état (après, on ne voit que des `?`).
- **Un test qui rougit par des chiffres n'est pas un timeout** : sous charge (load 12), onze gardes à horloge murale ont rougi et se sont rejouées vertes seules ; les deux A26 ont rougi à 3 s — ce sont elles qu'il fallait lire.
- **Le relecteur `determinisme-sim` travaille dans un worktree avec son propre cache de cartes** (`node_modules/.cache/ashes-cartes` sous SA racine, clé = empreinte de SON `packages/sim/src`) : éditer `/sim` dans l'arbre principal pendant sa suite ne l'empoisonne pas. La règle « ne jamais éditer `/sim` pendant une suite » vaut pour une suite lancée sur le MÊME arbre.
- **Le banc de l'eau** : sur `meteoActive: false`, le niveau d'eau vaut −1 à l'Ardeur (le gué est à sec) — travailler aux Pluies, ou dans un marais (il se souille toujours) ; l'eau profonde bloque (saigner sur le bord du lit) ; un avatar qui saigne meurt vers le tick 1 440 ; une piste posée à la main sur un `tick` à 0 a des ticks négatifs, que la piste refuse (`s.tick += 2000` d'abord).
- **Le domaine d'une garde ne dépend jamais de la borne qu'elle éprouve.** Prouver la morsure par mutation : l'ancien code remis, le bon message qui rougit, restauration par copie + `cmp`.
- **Une question de design à la fois** à Alexis, la reco en premier, l'impact concret chiffré.
