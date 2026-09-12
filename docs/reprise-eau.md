# Reprise — le chantier de l'eau

*État au 2026-09-12, écrit pour reprendre dans un contexte neuf. À lire dans cet ordre : ce fichier, `docs/specs/qualite-eau.md`, `docs/specs/piste-de-sang.md`, puis les entrées du 2026-09-12 du volet `docs/decisions/gameplay-systemes.md` (`grep 2026-09-12 docs/decisions.md`).*

*La cartographie complète — l'état de toute l'eau au matin du 12 et quatorze propositions — vit sur une page publiée : https://claude.ai/code/artifact/792fac97-fe51-43a2-9bed-19fe218a269d. Ses propositions sont résumées au §3 pour ne pas en dépendre.*

## 1. Ce qui est livré — le PORTEUR de la qualité de l'eau

Commit `feat(sim): la qualité de l'eau — le sang entre dans l'eau et descend le fil` (`git log --grep "qualité de l'eau"`).

- **`coulee.ts` est le porteur unique** (décision n° 2) : `qualiteDeLEau` rend une force dans [0,1], plusieurs causes, **le maximum, jamais la somme** ; `eauSouillee` n'est plus qu'un seuil (`SANG.SEUIL_SOUILLE`). La suie (R26) garde son verdict **au bit près** (A1, relevé sur le monde joué avant/après).
- **L'eau gagne un état local borné** (décision n° 1) : `SimState.souillures[]` — `{ i, tick, crans, pas }`, jamais dans `map` (`carte-immuable.test.ts` inchangé). Expiration `SANG.TACHE_TICKS` (5 min), plafond `SANG.TACHES_MAX` (64) qui évince la souillure **nourrie le moins récemment**. Persistance : `REPLIS_EPHEMERES`, sans bump de format.
- **La loi** (`faune.ts`, `souiller` dans `advanceBlood`) : une goutte qui tombe sur une eau d'aujourd'hui crée ou rafraîchit la souillure de SA tuile. Refus : l'étage (le sang sur un plancher reste sur le plancher), la glace. **Le marais et la roselière se souillent toujours, crue ou pas** (décisions d'Alexis). En rivière, la traînée **descend** le fil sur `DILUTION_PAS` pas et ne remonte jamais ; en eau dormante, un disque de `PORTEE_DORMANTE` ; la berge jamais. Attache au fil par plus-proche-point, borne **Chebyshev** `ATTACHE = DEMI_LIT + 1`.
- **Le fait `water_fouled`**, une fois par création, déclaré `muet` à l'inventaire audio.
- **Mesuré** : empreinte `/sim` (12 scénarios) — `rngState` et les 13 compteurs identiques, seul écart les `water_fouled` ; haché d'état identique sur les 24 jalons une fois le champ neuf retiré du texte. Coût : 5,7 µs par création, 0,28 µs par lecture d'eau propre, 8,8 µs au plafond. Première lecture d'une journée sur le monde joué : 2,4 ms (le balayage de la suie, antérieur).
- **Gardes** : `qualite-eau.test.ts`, 28 tests. Suites au commit : sim 2 338 (plancher 2 328), client 1 565, serveur 36, banc 3 — comptes relevés avec, en plus, 5 tests non commités de l'autre session (étages). **Le plancher 2 328 a donc été posé contre un compte qui inclut des tests absents du commit** : l'arbre commité seul fait 2 333 (40 `it` d'`etages-etancheite.test.ts` à HEAD, 45 dans l'arbre). Il passe, mais il n'a pas été relevé sur l'arbre commité seul — le recaler quand l'étage sera commité, et vérifier que son commit n'écrase pas la ligne `plancher` de `suites.mjs` avec un chiffre plus ancien.
- **L'arbre de travail n'est pas propre, et c'est voulu** : au moment de ces commits, `docs/specs/etages.md`, `packages/sim/src/npc.ts`, `packages/sim/src/etages-etancheite.test.ts`, une ligne du 2026-09-11 au volet `gameplay-systemes.md`, un commentaire de `tools/suites.mjs` (et donc le delta régénéré de `docs/decisions.md`) sont le travail **en cours d'une autre session**, laissé intact. Rien n'est cassé ni oublié — ne pas les commiter ni les annuler dans ce chantier.

## 2. La suite du lot SANG — dans cet ordre, un commit chacun

Chacun des deux consommateurs **bouge le flux PRNG seedé** (des bêtes font autre chose, d'autres tirages en découlent) : un par commit, `pnpm test` et l'empreinte entre les deux, sinon un test sans rapport qui rougit n'a plus de coupable. Convoquer `determinisme-sim` avant chaque fusion.

### 2a. Q9 — la bête renonce à boire une eau ensanglantée

Spec : `qualite-eau.md` Q9, critère A7 (avec son témoin obligatoire).
- Où : `couleeStep` (`faune.ts`) — au bout du chemin, avant d'armer `drinkUntil`, lire `eauSouillee` sur la tuile d'eau.
- Réserve de la revue : `qualiteDeLEau` n'a pas de paramètre d'étage — une bête qui boirait depuis un étage lirait l'eau du sol. Sceller (`niveauDuCorps`) ou écrire pourquoi c'est impossible.

### 2b. La piste de sang — les loups vivants remontent le sang

Spec complète : `docs/specs/piste-de-sang.md` (règles P1-P8, critères PA1-PA9). Décisions d'Alexis : sol et eau une seule règle ; **la piste guide, elle ne réveille pas** ; **en silence jusqu'au contact** (dérogation assumée au GDD §9bis).
- Points d'ancrage : `wolfStep`, branche « rien à chasser sous la dent », **avant** `sortieTravel` ; `feedStep` passe avant ; l'acquisition (`chooseQuarry`) et le hurlement (`howlOnce`) ne changent pas.
- Données : `state.blood[]` `{x, y, tick, etage?}` (le temps donne le sens), `state.souillures[]` (l'origine `i` donne l'amont), `attacheAuFil`, `atteignableEntreEtages`, `underFireWard`.
- Neuf : bloc `PISTE` dans `balance.ts` (`FLAIR` ; `PAS` **dérivé** de la vitesse de sprint × `BLOOD_EVERY_TICKS`, + 1) ; `monster.piste` (un nombre) ; le fait `wolf_on_trail` — l'inventaire audio est exhaustif par le compilateur : entrée `muet`, et les trois compteurs à recaler (`inventaire.test.ts` 99→100 faits et 42→43 silences, `sound.test.ts` 99→100).
- Coût à mesurer (dans `tools/`) : un loup en chasse sans cible balaie ≤ 256 gouttes + ≤ 64 souillures par tick.

### 2c. La teinte du sang dans l'eau — client

**Pourquoi c'est pressant** : sans elle, dans l'eau, la traque est silencieuse **et** invisible (sur la berge, les gouttes se voient déjà — `sang-sol.ts`).
- Ce qui existe : le canal B du champ d'eau porte un régime par tuile (`water-layer.ts` : `REGIME_LAC_MORT`, `REGIME_SUIE`) ; il lit `eauSouillee` avec un `EtatDeCendre` **sans** `tick` ni `souillures` (donc jamais le sang) ; il ne se recuit qu'au changement de jour de saison (`WorldScene.ts`, `recuireSuie`).
- Ce qui manque : **les souillures ne voyagent pas** — ni `protocol.ts` ni `interest.ts` ne les portent (les gouttes, si : même patron à suivre). Puis une cadence de recuisson qui tienne une souillure de 5 min — **à mesurer avant de promettre** (`perf`), et un rendu à juger à l'œil (`da-rendu`, skill `verif-navigateur`).
- À poser à Alexis : un régime distinct de la suie ? une teinte qui pâlit avec la force ?

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

- **La mémo de la suie est au niveau du module** : deux sims dans un processus (deux rooms) se la voleraient ; et `cendreAge.join(',')` alloue à chaque lecture. Noté, non corrigé.
- **Le disque ignore les paliers** (SUSPECTÉ) : le sang d'une mare basse pourrait teindre une eau en haut d'une falaise. Sonde à écrire sur le monde joué.
- **La lecture lit le terrain statique**, l'émission l'eau du jour : un haut-fond qui s'assèche garde sa teinte jusqu'à 5 min. Mineur.
- **Un rembobinage de jour en debug** laisse vivre des souillures « du futur » (même défaut que les gouttes).
- **La tourbière** n'existe sur aucun monde joué : non tranchée.

## 5. Méthode — ce que cette session a appris à ses dépens

- **Une autre session travaille sur le même arbre** (étages : `docs/specs/etages.md`, `npc.ts`, `etages-etancheite.test.ts`, une ligne du 2026-09-11 au volet, un commentaire de `suites.mjs`). Ne jamais commiter ses hunks : indexer par contenu (`git hash-object -w` + `git update-index --cacheinfo`), et régénérer `docs/decisions.md` depuis les volets **indexés**.
- **Le banc de l'eau** : sur `meteoActive: false`, le niveau d'eau vaut −1 à l'Ardeur (le gué est à sec) — travailler aux Pluies ; l'eau profonde bloque (saigner sur le bord du lit) ; un avatar qui saigne meurt vers le tick 1 440.
- **Le domaine d'une garde ne dépend jamais de la borne qu'elle éprouve** — et le même défaut de domaine avait gonflé un chiffre annoncé (18,4 % au lieu de 6,8 %). Prouver la morsure par mutation : l'ancien code remis, le bon message qui rougit, restauration par copie + `cmp`.
- **Une question de design à la fois** à Alexis, la reco en premier, l'impact concret chiffré.
