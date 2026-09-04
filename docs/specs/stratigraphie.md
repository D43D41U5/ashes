# La Stratigraphie — le monde comme empilement causal

> **⚑ STATUT au 2026-08-09, fin de la première traversée.** LIVRÉ : couche I complète (`socle.ts` — uplift, érosion Braun-Willett, drainage, flux, mouille ; gardes `socle.test.ts`, revue déterminisme sans violation) ; couche II complète (`solDe` dérivé par quantiles par zone, eaux des zones — mares/lac/rus Tourbière·Lac Mort·Sylve —, lisières entrelacées ; gardes `zonegen-eaux-zones.test.ts`) ; couche III substantielle (le sort des lieux bâtis + toponymes `sort-des-lieux.ts`, réseau de sentes à fusions par Dijkstra de cellules — l'étoile est morte —, prédicat `pres` ferme/charrette, annales S-R16 ; gardes `pays-d-avant.test.ts`, `sort-des-lieux.test.ts`) ; couche IV entamée (stades de succession du Versant Brûlé + baies des pionniers ; garde de rang S-A16). **RESTE À CONSTRUIRE** : S-A7 (rang à l'eau formalisé par zone), le score multi-facteurs des sites (moulin/hameau/poste de guet — types à créer), les routes HORS Racine, la dégradation différentielle des routes sous la cendre (a rougi A6 au premier essai — reprendre avec une garde de connexité préalable), S-R21/S-A18 (graines-mères, self-thinning, espacement d'`old_growth`), S-A19 (coins de chasse en écotone mesuré), les lecteurs d'annales (stèles, rumeurs, chronique — UI). Baselines ré-épinglés avec l'aval de la direction : lieux 138 → 134 (`charniers.test.ts` — cascade de la lame des lacs + prédicat `pres`).*

*Source : décision d'Alexis du 2026-08-09 (`docs/decisions.md`), sur dossier complet (audit du code, cartes rendues et regardées, quatre revues d'état de l'art). Statut : **chantier en cours**. Cette spec GÉNÉRALISE la doctrine de `t0-exploration.md` §2bis (le micro-relief muet de la Racine) à toute la carte et l'empile dans le temps ; elle AMENDE `worldgen.md` sans en rouvrir la structure (graphe de zones, seuils, gardes A1-A24) ni la grammaire (R32 rectiligne, carte plate). Numérotation locale : S-R* (règles), S-A* (critères).*

> **La doctrine, étendue :** « ce qui se lit comme LOGIQUE est DÉRIVÉ, ce qui se lit comme arbitraire est POSÉ » — en ESPACE (les 12 zones, plus seulement la Racine) et en TEMPS (quatre couches : la physique, l'humain d'avant, la Cendre, la reprise). Le critère de recette tient en une question : **chaque tuile peut-elle répondre à « pourquoi es-tu là ? »**

---

## 0. Ce qui ne bouge pas (le treillis)

- Le **graphe de zones** (squelette, priorités, portes, 2-connexité) et toutes les gardes de `zonegraph.test.ts`/`zonegen.test.ts` : la physique habille les rectangles, elle ne déplace **aucune frontière** ni aucun seuil.
- **R32** : tout rendu de carte reste rectiligne, quantifié au bloc de 16 / motif de 8. La Stratigraphie n'a pas besoin de courbes — l'organique vient de la causalité, pas de la géométrie.
- La **carte immuable en jeu** (`carte-immuable.test.ts`) : tout ce que la Stratigraphie fabrique est fabriqué À LA GÉNÉRATION.
- Le **budget A13 < 15 s** à la taille de production, mesuré **par tranches** (leçon : « le tick change de régime »).
- Le **déterminisme au bit près** : uniquement `+ - * /`, `Math.sqrt` et la liste blanche ; hash positionnels **salés par couche** (`'UPLF'`, `'EROD'`, `'SITE'`, `'ROUT'`, `'SORT'`, `'SUCC'`…), jamais un flux partagé ; tout ex æquo (tas, glouton, tri) départagé **par index de cellule/tuile**, jamais par ordre d'insertion.
- Les acquis : **l'eau commande la faune** (renforcé, jamais affaibli) ; **la géographie module, elle n'autorise jamais** (tout avantage géographique est un `combien`, plancher garanti partout) ; **objets de jeu réels** (enrichir = poser des nœuds récoltables/interactifs, pas du décor).

---

## 1. Couche I — le SOCLE : uplift, érosion, drainage, humidité

Le `Creux` de `racine-relief.ts` cesse d'être un privilège de la Racine : **un champ global** à la maille du motif de 8 (≈ 198×297 ≈ 59 000 cellules à la taille de production), local à la génération (Float64Array jetables, jamais dans `SimState`).

- **S-R1 — Le squelette est une carte d'UPLIFT.** Chaque cellule reçoit une altitude de base par tier de sa zone (Racine basse, T1 moyennes, T2 et Névé hauts, bords de carte relevés) + un bruit basse fréquence salé (`fbm2`). Le treillis autorial reste le patron ; la physique fait la chair.
- **S-R2 — Érosion stream-power.** Solveur implicite à la Braun-Willett, `m = 0,5`, `n = 1` — la mise à jour se réduit à `+ * /` et `Math.sqrt(A)`. Itérations bornées (constante de réglage), ordre de parcours strictement séquentiel (amont→aval par la pile du drainage).
- **S-R3 — Drainage honnête.** Directions D8, dépressions résolues par Priority-Flood+ε (les cuvettes retenues deviennent des lacs potentiels, jamais des trous), accumulation de flux par tri topologique. Un plus court chemin n'est toujours pas un cours d'eau : ce qui coule suit la pente réelle du champ érodé.

  > **⚑ AMENDÉE le 2026-08-30 — LE PAYS EST ENDORÉIQUE, ET LA RACINE S'ÉRODE.** Décision d'Alexis sur l'A/B rendu ; journal `docs/decisions.md`, en-tête de `socle.ts`. ① **La Racine n'est plus le niveau de base.** Elle l'était depuis la première traversée, et comme le monde joué EST la Racine, ça revenait à ne rien éroder du tout : **100 % des tuiles marchables reposaient sur une cellule épinglée** (MESURÉ, 3 graines, taille de production) — le solveur de S-R2 tournait sur la roche du pourtour. Son champ de juillet devient l'UPLIFT de S-R1 que `SOCLE.UPLIFT` maintient, et le champ final se recale sur l'ÉTENDUE historique : l'érosion change la forme, jamais l'échelle (les seuils qui le lisent — `CREUX.LAME`, les quantiles — sont en unités de ce champ, et le solveur comprime l'amplitude d'un facteur cinq). ② **Il n'y a plus de niveau de base du tout, ni de Priority-Flood dans l'érosion** : on route sur la surface NUE, et chaque minimum local est un TERMINUS où le flux s'accumule — c'est lui que `zonegen-hydro` inonde en lac. Le remplissage ε n'a pas disparu du projet, il a changé de couche : il vit dans l'hydrologie, là où une cuvette devient une pièce d'eau. *Un pays qui draine vers un bord n'a pas de lac : il a des rivières qui s'en vont.*
- **S-R4 — Humidité composée.** BFS multi-source depuis l'eau peinte (le `mesurerLaDistanceALEau` existant, élargi) + un balayage sous le vent (réservoir qui se décharge sur les montées — l'ombre pluviométrique en une passe linéaire, vent = vecteur constant, zéro angle).
- **S-R5 — Le réglage vit dans un bloc `SOCLE`** à côté des blocs worldgen existants (calibré « en regardant une carte »).

**Critères :**
- **S-A1** — Même seed → champs identiques au bit près (extension de A12) ; le balayage 60 seeds ne produit ni NaN ni cellule sans exutoire hors cuvette retenue.
- **S-A2** — La passe socle seule < 2 s ; le pipeline total reste sous A13, relevé par tranches consigné dans le commit.
- **S-A3** — La variable d'ordre existe PARTOUT : pour chaque zone, les quantiles 20 %/80 % d'altitude et d'humidité sont distincts (aucun champ dégénéré/plat par zone).
- **S-A4** — Le treillis est maître : `zoneGrid`, seuils et frontières sont identiques avant/après la couche (octet pour octet).

## 2. Couche II — l'EAU et le SOL dérivés partout

- **S-R6 — La rivière naît de l'accumulation.** Là où le flux dépasse un seuil : cours d'eau en marches Manhattan (grammaire existante), demi-largeur `∈ {1, 2, 3}` croissante avec `sqrt(flux)` (Leopold-Maddock) — le réseau naît en filets, conflue, grossit. **LA rivière de la Racine est conservée telle quelle** (A2/A2ter/A3 de t0 restent verts) ; tout nouveau cours vit sur un chemin salé neuf.
- **S-R7 — Les lacs sont des cuvettes remplies AU COL.** Niveau = le col de la dépression (Priority-Flood), exutoire vrai d'où repart le cours ; l'invariant R45 (jamais de profond sans anneau de haut-fond marchable) tenu par `creuserLeCoeur`, qui marche sur toute forme.
- **S-R8 — Les marais sont des fonds mal drainés.** Indice `accumulation / (pente + ε)` seuillé par quantile (le TWI sans logarithme — monotone-équivalent), quantifié au motif.
- **S-R9 — Les accents d'eau POSÉS meurent.** `accent: TERRAIN_*_WATER` disparaît des palettes (Tourbière, Lac Mort) : leurs eaux sont dérivées. Le Lac Mort reçoit **son lac** (le contenu fantastique de la zone reste la case réservée d'Alexis — la couche ne pose que l'eau).
- **S-R10 — `solDe` lit les champs.** Les deux `fbm2` indépendants sont remplacés par une lecture alt/humidité/distance-à-l'eau, seuillée par **quantiles par histogramme PAR ZONE** (patron `seuilParQuantile`) : chaque zone garde sa palette-thème (l'identité en 3 s) mais compose selon la variable d'ordre — le bois côté humide, la lande côté sec, l'éboulis au pied des murs et aux débouchés de seuil.
- **S-R11 — Les écotones existent.** Partout où pré et bois se touchent sans mur : bande de lisière (terrain mixte). Partout où l'eau touche la berge : roselière. Les frontières de ZONES restent des murs de roche — l'écotone est INTERNE aux zones (la lisière sud de la Cendrière reste l'exception inter-zones actée, R15 de t0).
- **S-R12 — Contraintes d'eau conservées** : A16 (aucune eau dans l'emprise d'un seuil — `masqueDesSeuils` s'applique à toute eau nouvelle), l'eau ne traverse jamais une frontière de zone, l'eau profonde reste un mur (R5).

**Critères :**
- **S-A5** — Sur 60 seeds : le Lac Mort porte ≥ 1 lac (≥ 20 cellules) ; la Tourbière porte ≥ 3 mares-cuvettes à rive ; zéro tuile d'eau « confetti » (toute tuile d'eau appartient à un plan d'eau ≥ 4 tuiles ou à un cours).
- **S-A6** — R45 tient sur toute eau nouvelle ; A16 tient ; les seuils/frontières sont sans eau.
- **S-A7** — Le rang à l'eau se généralise : dans toute zone à eau, `distance moyenne à l'eau : marais/roselière < bois humide < sol sec de la palette` (extension du contrat t0-A11, garde exhaustive par rang, pas par valeur).
- **S-A8** — Composition contractuelle : la part de chaque terrain par zone reste dans sa fourchette déclarée sur 60 seeds (les quantiles la garantissent par construction — la garde le PROUVE).
- **S-A9** — La faune suit : `placeHuntingGrounds` repassé ; toute zone qui gagne de l'eau et possède pré/bois obtient ≥ 1 coin de chasse ; le banc scénario reste dans ses seuils (famine jugée sur échantillons).

## 3. Couche III — le PAYS D'AVANT et la Cendre qui trie

- **S-R13 — Deux familles de POI, deux lois.** Les POI **naturels** (cairns, tarns, blocs erratiques, arches, sources…) restent au semis de Poisson + réservations + filet (A19 intact, garde de neutralité spatiale conservée TELLE QUELLE sur eux). Les POI **humains** (ferme, hameau, poste de guet, bergerie, moulin…) passent au **placement par SCORE** de terrain. La garde de neutralité est SCINDÉE en conséquence (décision actée) : neutres les naturels, causaux les humains — chaque famille a sa garde.
- **S-R14 — Le score d'aptitude lit les champs** : eau douce proche mais hors inondable, proximité d'un gué/d'une confluence, débouché de seuil, pente faible, abri. Placement glouton par score décroissant sous espacement minimal, départage par index. Réglage dans un bloc `IMPLANTATION` à côté de `POI_PLACEMENT`. Chaque fondation écrit sa CAUSE dans les annales.
- **S-R15 — Les routes ont poussé.** L'étoile de `zonegen-sentes.ts` est remplacée (décision actée) : Dijkstra à **coûts entiers scalés** (pente au carré, eau très chère sauf hauts-fonds, **rabais massif sur toute tuile déjà en route**), liaisons tracées **séquentiellement** — grand-routes d'abord (sites majeurs ↔ seuils), sentes ensuite (site → réseau le plus proche). La fusion en tronçons communs, les carrefours en Y et les gués aux étranglements ÉMERGENT du rabais (généralisation du « gué naît du croisement »). Routage grossier sur `zoneGrid` puis raffinement en corridor borné (leçon des 1 593 ms) ; `forcerLesGues` conservé en filet ; tout reste Manhattan largeur 3 (R32).
- **S-R16 — Les annales.** `WorldMap.annales` : des FAITS typés `{ere, type, pos, refs, cause}` émis par chaque passe (fondation, route, brûlé, pillé, abandon, effondrement), JSON-sérialisables, sur hash salé par ère. Méthode Caves of Qud : des faits estampillés, **jamais d'agents simulés** (interdit de périmètre).
- **S-R17 — La Cendre trie.** Le champ de distance à la Cendrière (`cendre.ts`) devient un gradient d'exposition HISTORIQUE : le sort de chaque site en dérive — **brûlé** (proche du front : charpentes calcinées, sol brûlé dans l'enceinte), **pillé** (proche d'une route vivante : brèches, contenants vides), **abandonné intact** (isolé : murs entiers, contenu riche). Les tronçons de route entre sites morts régressent en sente à demi reprise (dither, patron de la lisière sud) ; les tronçons utiles restent battus.
- **S-R18 — La richesse dérive de l'isolement, AVEC PLANCHER.** L'isolement historique porte le `combien` d'une fouille, jamais le `si` — aucune ruine à zéro.
- **S-R19 — Les toponymes lisent les annales.** « la Ferme Brûlée », « le Hameau Muet » — la table de noms existante prend les faits comme source.

**Critères :**
- **S-A10** — Sur 60 seeds, chaque site humain satisfait le prédicat de sa cause (toute ferme à portée d'eau douce hors inondable ; tout poste de guet sur un maximum local d'altitude ; tout moulin sur un cours) ; zéro site sur tuile inondable.
- **S-A11** — Le réseau est connexe et hiérarchique : toute sente atteint une grand-route ; ≥ 1 fusion constatée (carrefour en Y) par seed ; **l'étoile est morte** — aucun carrefour ne concentre plus de 3 tronçons incidents hors agglomération.
- **S-A12** — t0-A6 (les sentes relient les seuils) et t0-A7 (rien ne spawne sur les routes) restent verts.
- **S-A13** — Les trois sorts existent sur toute seed (≥ 1 brûlé, ≥ 1 pillé, ≥ 1 intact) ; les intacts sont EN RANG plus loin des routes vivantes que les pillés.
- **S-A14** — Toute référence d'un fait d'annales se résout (aucun id orphelin) ; chaque site/route/sort a son fait.
- **S-A15** — Le plancher : la fouille la plus pauvre de la carte reste > 0 sur 60 seeds.

## 4. Couche IV — la REPRISE : le monde qui repousse

- **S-R20 — La distance au front date la perturbation.** Le Versant Brûlé et la lisière sud se composent PAR STADES de succession : cendre fraîche stérile → mousses/épilobes → pionniers (bouleaux à baies, gibier abondant) → jeune futaie serrée. Chaque stade a sa palette ET sa table de nœuds RÉELS (récoltables — jamais du décor).
- **S-R21 — Les arbres ont poussé.** Pour les LIGNEUX seulement : graines-mères (Poisson lâche par essence, chemin salé `'GERM'`) + dispersion en taches mono-essence à bords diffus + 3-5 générations de compétition/self-thinning (distances au carré, grille spatiale). Le reste de `placeZoneNodes` (minéraux, plantes, champignons) est inchangé.
- **S-R22 — `old_growth` tient enfin sa promesse.** Au cœur de la Vieille Sylve : futaie clairsemée à GROS nœuds ; en bordure : taillis dense. La canopée se mesure en espacement (leçon : mesurer l'espacement avant de juger une silhouette).
- **S-R23 — Les coins de chasse vivent en lisière.** `placeHuntingGrounds` préfère les écotones (lisière pré/bois, berge) côté eau — l'éthologie qui rend la règle « l'eau commande la faune » LISIBLE.

**Critères :**
- **S-A16** — Le gradient de reprise est ORDONNÉ : en s'éloignant du front, les stades apparaissent dans l'ordre (garde par rang, balayée sur tout le domaine — garde exhaustive, pas des cas choisis).
- **S-A17** — Chaque stade déclaré trouve ses tuiles et porte ses nœuds sur toute seed (extension d'A19).
- **S-A18** — `old_growth` : espacement moyen des ligneux au cœur > en bordure, sur 60 seeds.
- **S-A19** — ≥ 60 % des coins de chasse sont en écotone ; « zone sèche = 0 gibier » reste vrai ; le banc scénario reste dans ses seuils.

---

## 5. Méthode de recette (transverse, chaque couche)

1. **On regarde la carte** : PNG avant/après (`tools/apercu-carte.mts`) sur ≥ 3 seeds, ET capture à hauteur de joueur (smoke) pour ce qui se voit au sol. L'œil d'Alexis tranche contre le tableur.
2. **Test de destination** (critère Failbetter) à chaque revue de zone : un individu mémorable, une raison d'y aller, une chose à en rapporter. Une zone qui n'a que du tileset est du remplissage.
3. **Revue déterminisme** (`determinisme-sim`) avant fusion de toute couche ; `pnpm check`/`test`/`lint` verts ; le banc scénario jugé sur ses échantillons, recalibré couche par couche, jamais en bloc.
4. **RNG** : aucun tirage nouveau dans un flux existant ; tout décompte modifié s'isole sur son chemin salé.
