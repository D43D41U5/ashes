# Reprise — le chantier de l'eau

*État au 2026-09-12 (soir), écrit pour reprendre dans un contexte neuf. À lire dans cet ordre : ce fichier, `docs/specs/qualite-eau.md`, `docs/specs/piste-de-sang.md`, puis les entrées du 2026-09-12 du volet `docs/decisions/gameplay-systemes.md` (`grep 2026-09-12 docs/decisions.md`).*

*La cartographie complète — l'état de toute l'eau au matin du 12 et quatorze propositions — vit sur une page publiée : https://claude.ai/code/artifact/792fac97-fe51-43a2-9bed-19fe218a269d. Ses propositions sont résumées au §3 pour ne pas en dépendre.*

## 1. Ce qui est livré — le lot SANG, en quatre commits

Trois commits côté `/sim`, trois coupables désignés (`git log --grep "qualité de l'eau"`, `--grep "Q9"`, `--grep "piste de sang"`) : le porteur, puis chacun des deux consommateurs seul, suite et empreinte entre les deux — parce que chaque consommateur **bouge le flux PRNG seedé**, et un test sans rapport qui rougit doit avoir un coupable. La méthode a payé au troisième commit (voir §5). Le quatrième est la teinte client (§2c).

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
- **Le loup ne remonte que le sang de l'HOMME** (avatar ou villageois) — posé en hypothèse à la livraison, **confirmé par Alexis le 2026-09-12** (ma reco ; ligne au volet `gameplay-systemes`). La goutte et la souillure portent `homme?: true`. Pourquoi : la première écriture suivait tout sang, et la suite a rougi sur les deux gardes A26 du quota de prédateurs — MESURÉ en A/B sur le même monde (`tools/__a26-piste.mts`) : quatre loups ambiants pistaient chaque sanglier blessé jusqu'au bout, **9 → 19 sangliers tués en 150 s, le coin vidé de 15 à 5 bêtes, 2 → 4 loups tués par les sangliers**. R18 (« le reste du coin va au gibier ») tombait. Réversible en deux lignes (les deux `homme !== true` de `faune.ts`) ; variante possible pour « le loup vole la prise du chasseur » : suivre aussi la bête blessée PAR un homme. Voir la spec P1 et Réserves.
- Mesuré : 8,4 µs par loup en chasse et par tick au plafond ; empreinte avant/après relevée (voir la ligne du journal).

## 2. Le lot SANG est complet — 2c livré

### 2c. La teinte du sang dans l'eau — client (quatrième commit)

**Deux décisions d'Alexis (2026-09-12, mes recos)** : un régime **distinct de la suie, rouge-brun** ; une teinte qui **pâlit par crans quantifiés à la tuile** (quatre ; le cran 2 commence pile au `SEUIL_SOUILLE`, ce que la pêche refuse se voit).
- **Le transport** : `souillures: Souillure[]` dans le snapshot (`protocol.ts`, `tick-driver.ts`, `sim-worker.ts`, l'Atelier), **sans filtre d'intérêt** (`interest.ts` le laisse passer par l'étalement) — la traînée s'étend à 40 pas de l'origine, ≤ 64 entrées.
- **La voie exacte, côté `/sim`** (`coulee.ts`, critère A11, 8 gardes) : `tableDAttache(map)` (le pas de fil de chaque tuile, ≡ `attacheAuFil` partout), `empreinteDuSang(etat, table, force, touchees)` (≡ `qualiteDeLEau` sans la suie, **au bit près, en double**), `cranDeSang(force)` (0..4, monotone, `cran ≥ 2 ⇔ eauSouillee`). Pures, jamais appelées par la sim — elles vivent à côté de la loi pour que la loi ne bouge pas sans elles.
- **Le rendu** : le canal B du champ d'eau porte **trois chiffres** — centaines = régime (0/100/200, les deux seuils du shader inchangés), dizaines = cran de sang, unités = palier (`canalB`/`decodeCanalB`, `water-field.ts`, 5 gardes ; `SANG_CRAN_MAX = 5` — un cran de plus franchirait le seuil du lac mort sous la suie, la garde l'a attrapé sur un premier jet à 9). Shader (`water-layer.ts`) : `palierTuile = mod(B, 10)`, `cranSang = floor(mod(B, 100) / 10)`, teinte vers `vec3(0,42, 0,17, 0,10)` par marches de 0,16, ciel réfléchi −35 % au cran 4 ; l'eau ne se fige pas. `WaterLayer.recuireSang(etat, now)` : cadence 1 s, table cuite à la première souillure vue, empreinte, comparaison cran peint / cran dû sur les seules tuiles qui portent ou portaient du sang, upload seulement si un cran a bougé ; `recuireSuie` rebâtit le champ AVEC les crans. `WorldScene` garde `souillures` et appelle `recuireSang` juste après `recuireSuie`, avec le tick du dernier snapshot.
- **Mesuré avant (`tools/mesure-recuisson-sang.mts`)** : la recuisson d'hier coûtait 1 156 ms dès une souillure de rivière ; la table 5,5 ms une fois, l'empreinte 3,8 ms au plafond. **Mesuré dans le navigateur** (`pnpm smoke --dev --scenario sangEau`, SwiftShader) : voir la ligne du journal du 2026-09-12 (ms de recuisson et d'upload, pixels rouille avant/après, captures `sang-eau-*.png`).
- Corollaire pour `/sim`, à trancher séparément : la même table d'attache rendrait `qualiteDeLEau` O(1) par lecture au lieu de O(fil) — c'est une donnée cuite de la carte (patron A1, hachée par `carte-immuable`), pas un correctif de session.

## 3. Les autres axes de la cartographie — rien de commencé

Ordre recommandé par la page (§6) : **A1 → A2 → B1 + B3 → D1 → C1**. *(B1 + B3 ont été pris AVANT A1/A2, pendant que l'éclaireur relevait l'état de A1/A2 : ce sont deux correctifs client sans question à poser.)*

- **A1 — Le débit, persisté** (donnée gelée). `map.debit`, un rang 0-7 par tuile, patron `distEau`/`natureEau`, additif, haché par `carte-immuable`. Le « geste zéro » : sans lui, A4, B1, B2 et C2 devinent la taille de l'eau.
- **A2 — Tous les fleuves.** **Défaut latent** : `natureEau` et les coins de pêche ne reçoivent que `map.fil` (le premier des `fils`) — un second fleuve passe pour un lac. Change combien de coins de pêche se posent, donc le PRNG : seul, empreinte sous les yeux.
- **A3 — La source devient un fait.** Les résurgences existent au worldgen puis deviennent un haut-fond anonyme : `FaitDeGeneration.type` n'a pas de `'source'`. Un type d'annale, un lieu découvrable.
- **B1 — La cascade a une voix** (client) — **LIVRÉ le 2026-09-12** (commit B1+B3). Une nappe `cascade` placée (la seule nappe avec un panner), cible recalculée à 5 Hz sur toutes les chutes de la carte (`CliffLayer.toutesLesChutes`, même prédicat que le rendu), colonnes sommées en puissance, `MASSE`, plafond 0,06, tue sous la roche, `taire()` au shutdown. Panneau « L'EAU » au banc (atelier `#son`) : la chute aux curseurs distance/côté, largeur 1-16 colonnes, la sonde en clair. Chiffres : `terrasses.md` T-A9. **À valider à l'oreille** (gains, 900 Hz, la respiration).
- **B2 — Le lit s'entend** (client). Une nappe qui suit la magnitude du champ de flux (déjà cuit côté client).
- **B3 — Spatialiser les deux voix d'eau** — **LIVRÉ le 2026-09-12** (même commit). Le splash d'un AUTRE corps sonne d'où il plonge (`EauEvents.track` → `onSplash(moi, at)`) ; le clapotis se tient sur le point de rive le plus proche (`pointDeRive`, gradient du SDF). Le splash du joueur et le patauge restent sans lieu (byte pour byte). `eau-vivante.md` R8, addendum.
- **C1 — La carte du joueur montre l'eau du jour** (client). Elle peint le terrain immuable : ni mare asséchée, ni gué fermé. Même cadence que la cendre sur la carte, au savoir « vu ».
- **C2 — Le régime du bief généralisé.** Le porteur existe maintenant (§1). Causes suivantes, chacune un geste : la crue turbide, le charnier en amont, le feu de village, **la carcasse dans l'eau** (une source continue, pas une goutte).
- **D1 — Les événements d'eau** : le bief qui prend, le dégel qui replie un corps, la mare qui part, le gué que la crue ferme. Ce sont des bascules de prédicat : observer au bord de cycle, un événement par bascule (piège : le clignotement dans la bande morte de l'hystérésis).
- **D2 — La corvée d'eau des PNJ.** Question pour Alexis : l'eau devient un stock de village, ou seulement un temps de trajet ?
- **D3 — Les roseaux récoltables.** Il faut d'abord savoir à quoi sert un roseau (question d'artisanat) ; semis positionnel contre le décalage du PRNG.
- **E2 — La mare qui meurt vraiment** (état local, patron des souillures). Frontière mince avec le marnage refusé le 26 juillet : à regarder à l'œil avant de coder.
- **E3 — Barrer un bief** : non recommandé (la carte immuable est ce qui rend l'autosave abordable).

## 4. Réserves connues

- **Le sang de l'homme seulement** (§1c) est décidé (Alexis, 2026-09-12). La chronique et la réputation consomment `wolf_on_trail` : si un jour le loup doit aussi voler la prise du chasseur, c'est le tag qu'on déplace (posé par l'attaquant), pas la piste qu'on réécrit.
- **La mémo de la suie est au niveau du module** : deux sims dans un processus (deux rooms) se la voleraient ; et `cendreAge.join(',')` alloue à chaque lecture. Noté, non corrigé.
- **Le disque ignore les paliers** (SUSPECTÉ) : le sang d'une mare basse pourrait teindre une eau en haut d'une falaise. Sonde à écrire sur le monde joué.
- **La lecture lit le terrain statique**, l'émission l'eau du jour : un haut-fond qui s'assèche garde sa teinte jusqu'à 5 min. Mineur.
- **Un rembobinage de jour en debug** laisse vivre des souillures « du futur » (même défaut que les gouttes).
- **La tourbière** n'existe sur aucun monde joué : non tranchée.
- **La recuisson du sang réuploade la texture ENTIÈRE** (`putImageData` + `refresh()` sur 1581×852 RGBA), même pour trois tuiles changées — Phaser n'expose pas de `texSubImage2D`. Elle ne part que si un cran a bougé (au plus quelques fois par minute par souillure). Si l'upload se voit sur un GPU faible, le geste suivant est un sous-rectangle (`gl.texSubImage2D` sur la boîte des tuiles touchées), pas une cadence plus lente.
- **La voix de la cascade lit les chutes UNE FOIS au boot** (`toutesLesChutes`, ~1,35 M tuiles balayées) : la carte est immuable, donc la liste aussi — si un jour une chute naît en jeu (E3 « barrer un bief », non recommandé), c'est cette lecture qu'il faudra rejouer. Et la voix ne sait pas le PALIER de l'auditeur : une chute au pied d'une falaise s'entend depuis le haut de la falaise à la même distance plane (SUSPECTÉ acceptable — le son monte).
- **La recuisson des paliers d'une nappe WebAudio** : une cible reposée à 5 Hz alors qu'on longe une chute est une rampe de 0,5 s qu'on infléchit — aucun clic entendu au banc en SwiftShader n'a pu être vérifié (pas d'oreille ici) : à écouter.
- **La teinte lit les souillures du snapshot, pas la suie du client** : si un bief est à la fois cendré et saigné, le shader empile les deux lavages (le gris passe par-dessus le rouille) ; la loi, elle, dit « max » — le verdict de pêche est le bon, l'image est un peu plus chargée que la loi. Assumé.

## 5. Méthode — ce que ce chantier a appris à ses dépens

- **Une autre session travaille sur le même arbre** (étages : `docs/specs/etages.md`, `npc.ts`, `etages-etancheite.test.ts`, une ligne du 2026-09-11 au volet, un commentaire de `suites.mjs`). Ne jamais commiter ses hunks : indexer par contenu (`git hash-object -w` + `git update-index --cacheinfo`), et régénérer `docs/decisions.md` depuis les volets **indexés**. Trois commits ont été faits ainsi ; l'arbre reste sale, et c'est voulu.
- **Le plancher `sim` de `suites.mjs` (2345)** a été relevé contre un compte qui inclut les 5 gardes non commitées de l'autre session (2363 sur l'arbre, 2358 sur l'arbre commité seul). Il passe dans les deux cas ; quand l'étage sera commité, vérifier que son commit n'écrase pas la ligne `plancher` avec un chiffre plus ancien.
- **Un commit par consommateur a désigné son coupable** : la suite a rougi sur deux gardes A26 sans rapport apparent avec l'eau, et il n'y avait qu'un suspect. Le diagnostic s'est fait par une sonde A/B **sans toucher `/sim`** (`tools/__a26-piste.mts` : muter `PISTE.FLAIR` à 0 au runtime, même monde, même graine — un `as const` ne gèle rien à l'exécution), en relevant l'espèce des morts AVANT leur retrait de l'état (après, on ne voit que des `?`).
- **Un test qui rougit par des chiffres n'est pas un timeout** : sous charge (load 12), onze gardes à horloge murale ont rougi et se sont rejouées vertes seules ; les deux A26 ont rougi à 3 s — ce sont elles qu'il fallait lire.
- **Le relecteur `determinisme-sim` travaille dans un worktree avec son propre cache de cartes** (`node_modules/.cache/ashes-cartes` sous SA racine, clé = empreinte de SON `packages/sim/src`) : éditer `/sim` dans l'arbre principal pendant sa suite ne l'empoisonne pas. La règle « ne jamais éditer `/sim` pendant une suite » vaut pour une suite lancée sur le MÊME arbre.
- **Le HMR de `smoke --dev` écoute aussi `/sim`** : le client importe `@ashes/sim` par le workspace, donc éditer `packages/sim` pendant un run recharge la page autant qu'éditer `packages/client`. Pendant un smoke, ne toucher que `tools/` et `docs/`. Et la première capture d'une vue téléportée bake les pavés : 180 s de délai, la capture plein cadre AVANT tout comptage de pixels (un `regionAt` plein cadre à 90 s a expiré).
- **Le banc de l'eau** : sur `meteoActive: false`, le niveau d'eau vaut −1 à l'Ardeur (le gué est à sec) — travailler aux Pluies, ou dans un marais (il se souille toujours) ; l'eau profonde bloque (saigner sur le bord du lit) ; un avatar qui saigne meurt vers le tick 1 440 ; une piste posée à la main sur un `tick` à 0 a des ticks négatifs, que la piste refuse (`s.tick += 2000` d'abord).
- **Le domaine d'une garde ne dépend jamais de la borne qu'elle éprouve.** Prouver la morsure par mutation : l'ancien code remis, le bon message qui rougit, restauration par copie + `cmp`.
- **Une question de design à la fois** à Alexis, la reco en premier, l'impact concret chiffré.
