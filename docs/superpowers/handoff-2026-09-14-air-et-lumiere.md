# Handoff — l'air et la lumière : brouillard volumétrique, diffusion, GI (état au 2026-09-14)

> **STATUT : EN CONCEPTION (au 2026-09-15).** Alexis a tranché question par question (les
> « RÉPONDU » ci-dessous) ; rien n'est construit, aucune ligne au journal encore (voir « Lignes de
> journal dues »).
> Né de deux questions d'Alexis, le 2026-09-14 : *« est-il possible de gérer le volumetric fog et
> le volumetric scattering avec les technos présentes sur le projet ? Ou est-ce qu'il est possible
> d'ajouter une techno pour y arriver ? »*, puis *« et global illumination »*.
> Ce fichier sépare ce qu'on a **LU** (dans le code et dans `node_modules`) de ce qu'on **CROIT**
> (à mesurer) — le contrat `MESURÉ`/`SUSPECTÉ` de `docs/sprint-aaa.md` § L'ÉQUIPE.

## La réponse donnée

**Oui pour les trois, sans ajouter de techno — en 2,5D.** Le rendu n'a ni géométrie 3D ni tampon
de profondeur : le « vrai » volumétrique (froxels, ray marching dans un volume) et la GI voxel/RTX
ne s'appliquent pas. Mais le jeu a un modèle de HAUTEUR (paliers, lift, strates), et c'est assez
pour les versions 2,5D qu'emploient les jeux 2D récents. Le seul ajout est du code : un module de
passes chaînées, qu'il faut éprouver en premier.

## Ce qui est établi (lu le 2026-09-14)

**Le moteur** — Phaser **4.2.0** installé (`packages/client/package.json` demande `^4.1.0`), WebGL.
- **Shaders GLSL maison, déjà trois** : `scenes/world/mist-layer.ts` (`Phaser.GameObjects.Shader`,
  `fragmentSource` + `setupUniforms`), `water-layer.ts`, `meteo-layer.ts`. ⚠ Phaser 4.2 ignore en
  silence `setUniform("x", …)` sur un tableau GLSL : pousser aussi `x[0]` (mémoire « uniforme tableau »).
- **Rendu dans une texture** : `Shader#setRenderToTexture(key)` existe
  (`phaser/src/gameobjects/shader/Shader.js`) — de quoi chaîner des passes. **Jamais employé ici.**
- **Filters** (post-FX par caméra ou par objet) : 23 fournis (`phaser/src/filters` : Blur, Glow,
  Bokeh, Quantize, Pixelate, Displacement, Mask, Shadow, ImageLight…), et une base pour écrire les
  siens (`renderer/webgl/renderNodes/filters/BaseFilterShader.js`). **Le client n'en utilise aucun.**
- **Pas de tampon de profondeur** : tout est sprite, trié par bandes.

**La lumière d'aujourd'hui — quatre étages empilés**
- `dynamic-lighting.ts` — le LightsManager : soleil (un point lointain posé dans `sunDirection(heure)`,
  `render/lighting.ts:213`), lune, un point light par feu (`fireGlow`, `lighting.ts:761`). N'éclaire
  que les objets en `setLighting(true)`.
- `night-veil.ts` — RenderTexture plein écran redessinée par image, trouée par les feux. Son
  étalonnage fait loi : **la brume s'AJOUTE, la lumière se MULTIPLIE** (un mélange NORMAL posait un
  plancher de noir et écrasait le contraste des acteurs — voir son en-tête).
- `cave-veil.ts` — le voile de cave : torche, feu de bivouac, jour par la gueule.
- Les lueurs cosmétiques pixellisées : `fire-ground-glow.ts`, `torche-ground-glow.ts`,
  `firefly-ground-glow.ts`.

**La brume d'aujourd'hui**
- La marée du matin : `morning-mist.ts` + le shader de `mist-layer.ts`, calendrier
  `frontDeBrume(heure)` (`lighting.ts:559`), spec `da-feeling.md` R13-R14 — conditionnelle depuis
  l'amendement du 2026-08-25.
- La Combe, permanente : `combe-mist.ts`.
- Les bancs voyageurs : `mist-banks.ts` — des **sprites triés dans la bande des houppiers**, l'un
  devant un arbre, l'autre derrière. C'est le seul VOLUME réel du jeu, et pour une raison qui vaudra
  pour tout ce chantier : un calque plein écran ne passe jamais ENTRE deux objets triés.
- La brume météo : `meteo-layer.ts` (spec `meteo.md`). La Brume-événement (`brume.md`) ne se lève
  plus depuis le 2026-08-24 (son ancre, le front de Cendre, a été retirée).

**Le modèle de hauteur** — paliers (`Relief`, `palierDuSol`), lift (`Warp.liftAEtage`), strates
(`strateDEtage`) ; bandes dans `render/framing.ts` : `AMBIENT_DEPTH_LIT` = 8,
`SOUTERRAIN_STRATE` = 2 100 000, `OVERLAY_DEPTH` = 10 000 000.

## Les trois effets — la technique envisagée

### 1. Brouillard volumétrique → un brouillard de HAUTEUR
- **Entrées** : une texture de hauteur du sol (1 texel par tuile, bâtie au boot comme le champ de
  distance de la brume, et décalée du lift), un bruit, le vent lissé du monde, un plafond de brume.
- **Calcul** : l'épaisseur traversée ≈ plafond − hauteur du sol → les vallées se remplissent, les
  mesas émergent, la nappe épouse le relief. Une passe.
- **Le volume entre les objets** ne vient pas de là : il vient des sprites triés, à la manière de
  `mist-banks.ts`. Les deux ensemble donnent le volume.

### 2. Diffusion (scattering) → en espace écran
- **Technique** : GPU Gems 3, ch. 13 (Kenny Mitchell, *Volumetric Light Scattering as a
  Post-Process*). Un masque basse résolution de ce qui arrête la lumière (houppiers, falaises, murs,
  paroi), puis chaque pixel marche vers la source en cumulant lumière × densité (16-32 échantillons).
- **Ce que ça donne** : des rais de soleil dans la canopée à l'aube et au couchant (soleil = rayons
  PARALLÈLES : on marche dans une direction fixe, tirée de `sunDirection`), et des halos de feux et
  de torches qui grossissent avec la brume — sous la roche aussi.
- **Entrées** : le masque d'occulteurs, la densité du point 1, la liste des lumières.

### 3. Illumination globale → GI 2D
- **Technique** : champ de distance par *jump flooding* + ray marching, ou *radiance cascades*
  (Alexander Sannikov, 2023 — la GI de Path of Exile 2, très reprise en 2D depuis).
- **Ce que ça donne** : ombres douces, lumière qui rebondit et se teinte (un feu contre une paroi
  ocre), et le jour qui ENTRE vraiment par une gueule de grotte au lieu d'y être peint.
- **Le prix** : 10 à 15 passes plein écran (le jump flooding seul coûte ≈ log₂(largeur) passes), et
  surtout une **refonte** de la pile de lumière (LightsManager + voiles de nuit et de cave + lueurs)
  plutôt qu'un calque de plus. Le plus lourd des trois, à faire en dernier.

## Les briques communes (à construire une fois)
1. **Le module de passes chaînées** (ping-pong de textures) — le seul inconnu technique : prouver
   qu'un Shader peut rendre dans une texture qu'un second Shader lit, image après image, sans copie.
2. **La texture de hauteur** (point 1).
3. **Le masque d'occulteurs** (points 2 et 3) — le vrai chantier : redessiner les occulteurs dans
   une RenderTexture basse résolution, ou le dériver de la carte (nœuds, falaises, bâti).
4. **La liste des lumières** — elle existe, mais éparse : `dynamic-lighting.ts`, `fireGlow`,
   `WorldScene.porteursDeTorche`, les lucioles.

## Ce qu'on croit (SUSPECTÉ — rien de ceci n'est mesuré)
- Le coût est dans le **fill-rate** (fragments par passe plein écran), pas dans le CPU.
- Calculer à la **résolution de la grille de pixels** (¼ de l'écran ou moins) puis quantifier suffit
  à rendre ces passes bon marché sur un vrai GPU — et c'est aussi ce que demande la DA.
- Sur cette VM (SwiftShader, pas de GPU), chaque passe plein écran pèsera lourd : **toute mesure de
  coût faite ici est pessimiste**. La spec `grottes.md` a déjà refusé un second champ d'eau pour
  « une passe plein écran » — l'argument est pris au sérieux dans ce dépôt.
- Brouillard de hauteur + diffusion tiennent en 2 à 3 passes.

## Les contraintes qui s'appliquent (déjà payées ailleurs)
- **`/sim` n'est pas touché** : rendu seul. Les invariants 1-2 (pureté, déterminisme) sont hors jeu.
- **La lumière a un sens de jeu** (`nuit-noire.md` : *« le noir rend le CORPS plus faible ; la
  lumière le lui rend »*). La clarté se CALCULE dans la sim (`clarteSurSoiAt`, `clarteDuCiel`,
  `partDuCiel`) : le rendu ne doit jamais montrer éclairé ce que la sim tient pour noir, ni
  l'inverse. Une GI qui éclaire plus loin que la torche de la sim mentirait au joueur.
- **DA pixel** : quantifier sur la grille, `NEAREST`, vacillement par l'alpha, jamais par la taille
  (mémoire « FX de lumière pixellisés », `fire-ground-glow.ts`).
- **Ce qui quitte la bande du sol quitte le voile de nuit** (strates d'étage) ; sous la roche, le ciel
  ne passe pas (`grottes.md` G-R11) — la torche et le jour par la gueule, si.
- **`OVERLAY_DEPTH` passe au-dessus de TOUT**, strate souterraine comprise : une passe d'air posée là
  traverse la roche. Vu le jour même sur la pastille du bon flanc, qui luisait dans une grotte pour
  un rocher de la terrasse au-dessus.
- **Se juge en pixels, pas à l'œil** : skill `verif-navigateur`, et sur une capture, la boucle
  endormie ne présente pas ce que `game.step` dessine (mémoire « page endormie »).

## Ajouter une techno ? Non — pourquoi
- **three.js / Babylon** pour du vrai volumétrique : il faudrait un monde en 3D (géométrie,
  profondeur), donc réécrire le rendu. Un second canvas superposé ne s'intercale pas dans le tri des
  sprites : il serait devant tout, ou derrière tout.
- **WebGPU** (compute) : sans géométrie 3D, aucun gain décisif, et Phaser 4 rend en WebGL — les
  radiance cascades 2D y tournent.

## Établi à la reprise (2026-09-14, seconde session) — ce que le handoff ignorait
- **Le cadre « zéro post-FX » existait déjà, écrit** : vignette du 2026-07-23 (`rendu-da.md:41`, en DOM
  « un pipeline de post-traitement […] rendre blanc sous swiftshader »), `da-feeling.md` R15 (« Aucun
  post-FX »), `eau-vivante.md:5`, définition de `da-rendu`. Le motif est TECHNIQUE (perte du juge).
- **Ce qui est prouvé** : des quads `Shader` dans la display list qui lisent des masques STATIQUES
  (`addCanvas`/`createCanvas` au boot — brume, Combe, eau). **Jamais tenté** : Filters,
  `setRenderToTexture`, un shader qui lit une texture redessinée à chaque image.
- **Phaser 4.2 rend en WebGL1** (`WebGLRenderer.js:709`, `getContext('webgl')`) et ses cibles sont
  **RGBA8** (`WebGLTextureWrapper.js:416`, `UNSIGNED_BYTE`) ; `antialias: true` (`main.ts:26`) met les
  cibles en **LINEAR** (`DrawingContext.js:284`).
- **L'échelle** : ~20 tuiles de haut à 720 px → zoom 2,25 ; le grain de 4 px monde = 9 px écran ; une
  GI au grain tient dans **~142×80 texels** (coordonnées < 256 : un canal 8 bits suffit à les coder).
- **Le halo d'air du Feu existe** (`fire-fx.ts:51-65`, 5 tuiles, α ≤ 0,3, nuit, livré) — doctrine
  « un halo qu'on remarque est un bug ».
- **Aucun matériel de référence ni budget par image n'est écrit** (seul `client.md` A2 : « ~60 fps »).

## Le spike des passes chaînées — MESURÉ le 2026-09-14 (`tools/__gi-spike/`, jetable)
`PLAYWRIGHT_BROWSERS_PATH=0 node tools/__gi-spike/run.mjs <sortie>` — page Phaser 4.2 AUTONOME à la
config du jeu (WebGL, 1280×720, antialias, roundPixels), dans le Chromium du smoke (SwiftShader).
**11/11 justes au texel** :
- écrire (`setRenderToTexture`) : chaque texel, octets exacts ; `outTexCoord` suit `gl_FragCoord` en RTT ;
- passe → passe (uv = (p+0,5)/taille) : copie à l'identique ; composition display list : à l'endroit,
  zéro blanc ; MULTIPLY (100,75,50 pour 100,4/75,3/50,2 attendus) et ADD exacts ;
- `setFilter(NEAREST)` sur une cible : 0 % → 100 % de pixels purs, et ça tient six images plus tard ;
- jump flooding 9 passes DANS la display list (l'ordre = la depth) : exact à 1 et à 3 graines ;
  FRAÎCHEUR : la chaîne rend l'état de l'image courante (6/6) ; ping-pong de 2 Shaders hors display
  list par `renderImmediate()` dans `update()` : exact aussi ;
- `highp` = float 32 (précision 23) ; cibles half/float DISPONIBLES par extensions WebGL1 (FBO complet)
  — mais Phaser ne crée que du RGBA8 : du flottant passerait par du GL brut ;
- **coût SwiftShader (indicatif, JAMAIS une gate)** : 142×80 = 2,6 ms/passe JFA, 3,6 ms/passe à 32
  lectures ; 1280×720 = 105 / 148 ms → la GI vit au GRAIN (≈ 43 ms/image dans le smoke pour une GI
  SUPPOSÉE de 15 passes — hypothèse, pas un compte). ⚠ `gl.finish()` n'attend RIEN ici (0,03 ms mesuré au plein écran) : synchroniser par un
  `readPixels` d'un texel.
→ **Condition 1 de la réouverture tenue pour le MÉCANISME** ; chaque vraie passe portera sa garde de
pixels, sur le modèle des tests du spike. ⚠ `tools/__gi-spike/` est gitignoré et MEURT avec la
session : la copie durable de ces tests est le banc publié (question 2 ci-dessous).

## Questions ouvertes pour Alexis — une à la fois, dans cet ordre
1. **Quel effet d'abord ?** — **RÉPONDU le 2026-09-14 : (c) la GI 2D d'emblée**, contre la reco (b).
   Posée avec les incohérences de chaque option : (a) dispute la bande des houppiers à la marée
   (R13-R15ter) ; (b) fait des feux un fanal en multi et doit rester dans l'air (`nuit-noire` N1) ;
   (c) rouvre « zéro post-FX », refond la pile de lumière et doit s'aligner sur `clarteSurSoiAt`.
1bis. **Le cadre « zéro post-FX »** — **RÉPONDU le 2026-09-14 : rouvert sous DEUX conditions** —
   chaque passe PROUVÉE juste sous SwiftShader par une garde de pixels (le smoke reste juge), et
   QUANTIFIÉE au grain de 4 px (jamais le look lissé d'un post-FX). Si le spike rend faux, la GI
   s'arrête et revient à Alexis. **Ligne de journal à écrire** (`docs/decisions/rendu-da.md`) au
   premier commit du chantier — le volet est tenu par l'autre session au 2026-09-14.
   **Calendrier signalé** : la refonte vise les fichiers que l'autre session édite (`dynamic-lighting`,
   `cave-veil`, `flank-glow`) → la GI se bâtit À CÔTÉ, derrière un interrupteur ; le remplacement
   attend leur commit.
2. **Le matériel de référence et le budget par image** — **RÉPONDU le 2026-09-14 : A, MESURER
   D'ABORD.** La page du spike est publiée en artefact PRIVÉ « Banc des passes GI »
   (https://claude.ai/code/artifact/dde9ae26-66fd-4af4-9c31-6b5bdd6bf3b5 — sa source se relit par
   `Artifact(action: "read", url)` ; le scratchpad de la session meurt avec elle) : les 11
   vérifications + le chronomètre par lots (synchro `readPixels`, médiane de 3) sur le GPU de qui
   l'ouvre. **C'est la copie DURABLE des tests du spike.** Il affiche aussi une estimation
   HYPOTHÉTIQUE d'une GI de 15 passes contre 16,7 ms — forme SUPPOSÉE (graine + 9 pas de JFA + 5
   cascades de 32 lectures), à remplacer par le vrai compte de passes quand la GI existera. Chaque mesure s'enregistre dans SA base — la relire par
   `Artifact(action: "read_db", url, db_op: "list", collection: "mesures")`. Le budget se fixe sur
   ces chiffres (options posées : B intégré ≤ 2 ms/image, C dédié ≤ 4 ms/image).
   **MESURÉ le 2026-09-14 (20:21 UTC) sur le PC d'Alexis** — RTX 4070 (ANGLE/D3D11), Opera sur
   Chromium 151, 1920×1080, DPR 1 : **11/11 justes** (les mêmes verdicts que sous SwiftShader), flottants
   et demi-flottants rendables, `highp` 23 bits. La GI SUPPOSÉE de 15 passes : **0,049 ms/image au
   grain (142×80)** — 0,3 % d'une image à 60 Hz ; 0,072 ms en 284×160 ; 0,18 ms en 640×360 ;
   0,59 ms en plein 1280×720. Sur ce matériel le budget ne contraint PAS le look ; la question qui
   reste est la machine la plus faible visée (un iGPU n'a pas été mesuré).
2bis. **La GI au sol convainc-elle, et laquelle ?** — **RÉPONDU le 2026-09-14 : G2** — ombres douces,
   lumière chaude, rebond LOCAL (il n'éclaire que le sol face à une surface éclairée ; il n'entre pas
   dans l'ombre d'un mur, qui n'en voit que le dos). Planche « Clairière du feu »
   (https://claude.ai/code/artifact/055c85ec-28e5-4f61-80d1-69a7015215d7) : R0 / G1 / G2 en lisière et
   au coin du feu (trois pans de bois ouverts au sud), composés sur le VRAI rendu. **Méthode** (sondes
   jetables `tools/__gi-planches/`) : chaque pixel est affine en le multiplicateur M du voile, deux
   clichés réels (voile forcé noir, blanc) composent n'importe quel champ, une variante injectée dans
   le vrai voile le prouve — écart moyen 0,11-0,13 niveau, sauf à une tuile du foyer, où le rendu
   ÉCRÊTE à 255 (la composition y sous-estime de 8-10 niveaux). **MESURÉ en chemin** : (a) le voile de
   nuit (MULTIPLY, profondeur 8) n'assombrit que le SOL ; les sprites prennent leur nuit de Light2D,
   sans ombre — une GI peinte dans le voile ne les touche pas ; (b) le sol des paliers ≥ 1 se dessine
   AU-DESSUS du voile (teinte plate `teinteDesHauteurs`) : la GI du voile ne l'atteint pas ; (c) G1
   ombre 62 % du sol éclairé au coin du feu, 6,5 % en lisière (troncs minces) ; le rebond de G2 ajoute
   +0,05 à +0,11 sur 9 % du sol éclairé au coin, rien de visible en lisière. Réglages de G2 : teinte
   (1,15 ; 0,92 ; 0,62), gain 0,9, portée 12 texels, genou doux sous 0,2 par canal.
3. *Si la GI convainc* : remplace-t-elle la pile d'aujourd'hui ? Décision d'architecture de rendu →
   une ligne dans `docs/decisions/rendu-da.md`. — **RÉPONDU le 2026-09-14 : REFONTE COMPLÈTE D'UN
   COUP**, contre la reco (par étages) : un seul modèle de lumière pour le sol, les sprites et les
   grottes, à la place de Light2D + voile de nuit + voile de cave + lueurs. **Conséquences signalées
   avant le choix** : elle touche `dynamic-lighting.ts` et `cave-veil.ts`, que l'autre session édite
   (non commités au 2026-09-14) → bâtir À CÔTÉ, derrière un interrupteur, et basculer après leur
   commit ; et rien de ce qui change hors du sol (sprites, grottes) n'a encore été vu sur planche →
   planches dues avant tout module. **Trois lignes de journal dues** (volet `rendu-da.md`) : la
   réouverture de « zéro post-FX », G2, la refonte.
3bis. **Planche 2 « Corps dans l'ombre »** (https://claude.ai/code/artifact/e6e62f4f-3764-4d1c-8084-0d5a50be4535),
   refaite le 2026-09-14 (runs 12 et 13) — *les corps qui prennent l'ombre : c'est le look voulu ?*,
   posée en « derrière le mur, ton avatar garde 0,13 de sa lumière, le mur 0,98 : ce noir-là ? » avec
   trois réponses (tel quel / un plancher à 0,3, pas rendu / le sol seulement, qui revenait sur Q3).
   → **RÉPONDU le 2026-09-15 : TEL QUEL, « modulo la gestion de l'éclairage de la lune avec ses
   phases »** — la planche est rendue à la NOUVELLE lune (jour 72), la nuit la plus noire des 23.
   Ce que le modèle fait déjà de la lune : le plancher de l'ombre est Mn, le voile qui suit la phase
   (`lighting.ts` `voileDeNuit`, alpha 0,72 à la pleine → 0,998 à la neuve) ; un corps derrière le mur
   prend M(G2)/M(R0), qui remonte avec lui. Ce qu'il ne fait PAS : la lune n'a dans la GI ni direction
   ni ombre — aujourd'hui sa direction vit dans le relief Light2D des sprites (`dynamic-lighting.ts`,
   `moonDirection`), la flaque du socle minéral (`contact-shadow` `deriveX`) et le reflet de l'eau ;
   aucun mur ne porte d'ombre d'astre. Côté sim, la pleine lune met la clarté du ciel à 1 au cœur de
   la nuit (`clarteDuCiel`, `nuit.ts`) : l'ombre d'un mur n'y décide de la parade que les nuits sombres.
   **Les phases, MESURÉES le 2026-09-15** (`tools/__gi-planches/lune-phases.mts` sur le run 12, hors
   navigateur : le trou du voile est un effacement, M = 1 − (1 − Mn)(1 − h), donc les champs L du feu
   ne dépendent pas du ciel — seul Mn change, rejoué par le code du voile). Garde d'abord : le Mn du
   code à 0 h 14, dans la fenêtre du cliché, rend (0,031 ; 0,035 ; 0,059) contre (0,033 ; 0,036 ;
   0,058) mesuré et prédit R0 loin du feu à 0,18 niveau ; les 420 facteurs de la planche sont
   retrouvés à 0,005 près. Au cœur de la nuit, l'avatar derrière le mur garde **0,65 à la pleine
   lune** (lueur 1), 0,44 à ½, 0,28 à ¼, 0,14 à 0,1 ; les murs ≥ 0,98 à toutes les phases ; les corps
   sous la moitié passent de 0 (pleine) à 20 (sans lune). À minuit, nuit par nuit : 61 → 0,66 ·
   63 → 0,61 · 65 → 0,47 · 66 → 0,35 · 68 → 0,15 · 70 à 76 → sans lune (la décroissante se lève après
   minuit, la croissante se couche avant) · 78 → 0,26 · 80 → 0,49 · 82 → 0,62. **G2 suit donc déjà la
   phase** : l'ombre du feu s'adoucit sous la lune. ⚠ Sans lune, le facteur bouge d'une heure à
   l'autre (0,17 à 22 h, 0,03 vers 23 h, 0,10 à minuit, 0,13 sur la planche) : c'est le passage
   `1 − α` du voile d'aujourd'hui (0,002 au creux, 0,03 une heure plus tard), pas la GI. **Reste une
   question de STRUCTURE**, qui bloque la spec GI et que la planche du jour poserait pour le soleil :
   le ciel reste-t-il un PLANCHER uniforme (la lune ne règle que la profondeur de la nuit), ou
   devient-il une SOURCE directionnelle de la GI — des ombres de lune et de soleil qui tournent avec
   l'heure, ce qui demande des HAUTEURS aux occludeurs (la longueur d'une ombre d'astre dépend de la
   hauteur de l'objet et de celle de l'astre) ? Posée à Alexis le 2026-09-15 → **RÉPONDU : VOIR
   D'ABORD** — une planche des ombres d'astre (le coin du feu à la pleine lune et en plein jour, avec et
   sans, sur de vrais clichés), qui tranche une seule fois pour la lune et le soleil ; elle absorbe la
   planche « le jour sous la GI ». La sonde apprend la hauteur des occludeurs. La spec GI attend.
   Les deux scènes de la planche 1 : le coin du feu (`GI_SCENE=murs GI_JOUEUR=ombre
   GI_SPRITES=1`, l'avatar à trois tuiles du feu derrière le pan ouest) et la lisière (`GI_SCENE=lisiere
   GI_SPRITES=1`, des troncs dans la portée). Trois rendus RÉELS au même instant par scène : R0 / G2 au
   sol seul / G2 au sol et sur les sprites. **Le levier** : une teinte MULTIPLY par objet éclairé
   (`lighting === true`), posée au `postupdate`, rendue après le cliché. **La règle** : un corps prend
   M(G2)/M(R0) par canal (borné à 1) au texel sous son PIED (le bas du sprite ; un houppier par sa
   profondeur, `crownDepth` = `CROWN_BASE` + pied·16) ; un OCCLUDEUR (tronc, cime, roche, mur), celui de
   sa face la mieux éclairée — le plus clair de ses texels opaques, que gi-ref pose à la lumière de leur
   voisine libre : il ne s'éteint pas de sa propre ombre, seulement de celle d'un autre (le run 9 lisait
   le texel libre sous le fût, son propre dos). **MESURÉ** : le rendu est AFFINE en la teinte — un rendu
   à teinte 0 isole G, ce qu'elle ne touche pas, et t(0,502) = G + 0,502·(R0bis − G) à 0,28 / 0,27 niveau
   près (0,02 / 0,03 % des canaux au-delà de 2) ; là où se tiennent les corps, le rapport médian vaut
   0,517 / 0,510, dans la porte ±0,02 fixée avant la mesure (élargie à 0,04 au run 9 une fois le nombre
   vu : défait) ; G pèse 1,8 % de la lumière de ces pixels. **Ce qu'on voit** : au coin, 16 corps passent
   sous la moitié de leur lumière (15 touffes d'herbe et l'avatar, à 0,13) ; les 8 pans de mur gardent
   0,98. En lisière, AUCUN : les 7 arbres dans la portée gardent 0,98 — un tronc de 2×2 texels ne masque
   tout un autre tronc qu'aligné sur le feu. **L'ombre sur les corps est une affaire de bâti et de roche
   (village, grottes), pas de forêt claire.** **Pièges de méthode**, chacun a faussé une mesure : (1) le
   PREMIER rendu à T s'écarte d'un niveau (coin : 54 à 90 % des pixels ; lisière : aucun) → juger contre
   R0bis ; (2) un cliché NON injecté pris après une injection du voile en garde une part (run 10 :
   16 715 px au voile G1) → les clichés du levier se prennent avant toute injection ; (3) au coin, entre
   R0bis et les clichés suivants, ~37 000 px à 13-20 tuiles du feu s'éclaircissent de ~11 niveaux — un
   changement du jeu, pas la teinte (t0, t50 et G2 sol l'ont tous), cause NON identifiée, hors cadrage →
   un pixel « touché » se définit par t0 ≠ t50, jamais par R0bis ≠ t50 (35 000 des 38 000 « touchés »
   étaient cette dérive, et la preuve affine rendait 2,8 niveaux au lieu de 0,3). **Limites affichées** :
   le relief de ces images est celui de Light2D, que la refonte retire — seule l'ombre est la question,
   refaire le relief depuis la GI est une autre planche ; une teinte n'éclaircit pas (ni la chaleur ni le
   rebond de G2 n'atteignent les corps) ; un facteur par sprite (pas de dégradé du fût à la cime).
3ter. **Planche 3 « Ombres d'astre »** (https://claude.ai/code/artifact/351988dc-24b2-47d9-90fc-394cce7a21d2,
   2026-09-15, run 14) — *le soleil et la lune doivent-ils porter
   l'ombre des murs ?* Le coin du feu au jour d'ouverture (61, pleine lune), le matin (cadran 10,5 :
   soleil à l'est, force 1, dérive −0,80) puis le soir (cadran 22,9 : pleine lune montante, lueur 0,90,
   force 0,78, dérive −0,68), sans et avec. **Le modèle** (`tools/__gi-planches/astre.mjs`) prend à la
   COULÉE DU SOCLE (`ombre-socle.ts`, 2026-08-27), portées au grain de la GI, sa pointe cisaillée
   (`deriveDOmbre`), sa pénombre et son opacité — mais PAS sa longueur. ⚠ **CORRIGÉ le 2026-09-15, après
   la réponse d'Alexis** (inventaire `eclaireur-etat`, relu dans le code) : la coulée a une longueur
   CONSTANTE — `LONGUEUR` 12 − `REMONTE` 4 = 8 px d'ombre pleine sous le pied, pour tous les blocs (16 à
   24 px de haut) : « `LONGUEUR` est donc une constante » (`ombre-socle.ts` ③). La règle « 0,4 × la
   hauteur » (un mur de 32 → 12,8 px, 3,2 texels) est une EXTRAPOLATION de ma part (8 px ÷ le bloc moyen
   de 20), que la planche présentait à tort comme un réglage de la coulée. Et l'« élévation fixe » de
   21,2° n'est que la simplification de la coulée : c'est l'angle nord-sud (`SUN_Z`/`SUN_NORTH`) ; le
   point de Light2D a aussi un bras est-ouest (`SUN_FAR` 2200) et descend à ~12,8° au lever et au
   coucher. Une longueur par lanceur ; 8/7 px de décalage par
   px de longueur à dérive ±1, pénombre DEHORS de 2 texels à ⅔ puis ⅓ (fronts de Tchebychev à travers
   le sol libre, JAMAIS vers le nord : le haut d'une ombre est son contact — le premier essai mettait un
   ⅔ sur la face du mur tournée vers l'astre), opacité 0,42 × `forceDeLOmbre`. De jour M = 1 − a·S ;
   de nuit l'ombre multiplie le PLANCHER DU CIEL et laisse le feu intact : M = 1 − (1 − Mn·(1 − a·S))(1 − L)
   (la coulée d'aujourd'hui, elle, assombrit aussi la lueur du feu). Les roches gardent leur coulée ;
   aucun tronc dans ce cadre. **Capture** (`planches.mjs` GI_ASTRES=1 → `planche3.mjs`, sous tsx) :
   `debug_set_hour` ne bouge que la phase, donc jour puis nuit dans le même run sans saut de jour ;
   l'heure murale s'obtient en inversant `heureSolaire` ; de jour la RT du voile est cachée, la rustine
   la force visible. Le poste de l'avatar passe à une demi-tuile du pan ouest (`GI_JOUEUR=astre`) : la
   bande d'ombre fait 3,4 texels, le poste de la planche 2 tombait dehors. **MESURÉ** : preuve
   composé/rendu 0,02 niveau le jour, 0,29-0,30 la nuit (l'écrêtage du foyer, comme en planche 1) ;
   dérive et force du jeu contre la réplique du ciel à 0,009 / 0,005 près (le jeu les calcule une image
   plus tôt, et le temps court pendant la capture) ; plancher du ciel mesuré (0,327 ; 0,344 ; 0,533)
   contre code (0,318 ; 0,337 ; 0,529). **Ce qu'on voit** : 13,1 tuiles de sol à l'ombre le jour, 11,9
   la nuit ; l'avatar passe de 1 à 0,58 le jour, de 0,58 à 0,39 sous la pleine lune (G2 → G2 + lune) ; la
   nuit, 13 198 px s'assombrissent sous le masque, 25 ailleurs, aucun ne s'éclaircit. **Constats** :
   (a) qui se tient dans l'ombre d'un mur est à ≤ 2 tuiles de lui, et la découpe de façade
   (`render/pans.ts`, D = 2) rabat ce pan à son empreinte : l'ombre part d'une empreinte (pans N et O
   ici ; le pan E, debout, montre l'autre cas) ; (b) la GI est au grain de 4 px, la coulée à 1 px ; (c) la
   sim ne verrait pas l'ombre de lune (clarté du ciel 1 à la pleine lune) : l'écran y serait plus sombre
   que la sim, le sens que N2bis tolère. Posée à Alexis le 2026-09-15 → **RÉPONDU : OUI, LES DEUX** (la
   reco : dans le même cadre, les roches portaient déjà une ombre d'astre et les murs aucune). Le ciel
   cesse d'être un plancher uniforme : un masque d'astre au grain de la GI, sur la grammaire de la
   coulée, qui multiplie le plancher du ciel et laisse le feu intact ; une hauteur par sorte de lanceur
   (le mur a `MUR_HT` = 32) puisque la longueur suit la hauteur (tranché en 3quater le 2026-09-15) ; de jour, le voile du sol reste affiché pour porter l'ombre (le jeu le
   cache aujourd'hui). La réponse vaut sous les suppositions de la planche : la longueur ne suit pas
   l'heure, les roches gardent leur coulée, un pan tranché garde l'ombre du mur debout, la sim ne voit
   pas l'ombre de lune. **La question de STRUCTURE posée plus haut est tranchée : la spec GI n'attend
   plus le ciel.** Reste ouvert : les arbres (le fût ? la cime ? à côté du pied F4 du 2026-08-22 ; les
   taches de soleil de la canopée sont RETIRÉES depuis le 2026-08-25, `forets-vivantes.md` §5, et le
   voile de canopée depuis 34a4c58) — une autre planche, en lisière : **la suivante** (choix
   d'Alexis le 2026-09-15, avant crans et grain, et avant les grottes, que l'autre session est en train
   de refaire). Elle remet la LONGUEUR en jeu : la règle fixe de la coulée (8 px pour tous) contre
   0,4 × la hauteur (38 px pour un `old_tree` de 96 px) ; les murs (32 px) se tiennent entre les deux
   et cachaient la question, donc sa réponse vaut aussi pour eux. Une ligne de journal de plus
   est due (volet `rendu-da.md`).
3quater. **Planche 4 « Ombres des arbres »** (https://claude.ai/code/artifact/2b3540df-f858-4d4f-a957-fdb9891db40b,
   2026-09-15, run 17) — *la longueur de l'ombre d'astre doit-elle suivre la hauteur de ce qui la
   porte ?* La lisière des planches 1-2 au jour 61 (pleine lune), l'après-midi (cadran 14,7 : soleil à
   l'ouest, force 1, dérive 0,54) puis la nuit (cadran 3,5 : pleine lune passée à l'ouest, lueur 0,89,
   force 0,90, dérive 0,80). Trois variantes : aujourd'hui (la flaque F4 au pied, aucune ombre d'astre
   sur les arbres), FIXE (8 px d'ombre pleine sous le pied pour tout lanceur, la règle de la coulée) et
   PROPORTIONNELLE (0,4 × H, la règle de la planche 3). **Le modèle** (`astre.mjs`, `ombreDesArbres` et
   `REGLES`) : chaque sprite d'arbre est une carte debout sur son pied. Ce sont 212 sprites dans le cadre,
   106 fûts et 106 cimes. Le pied du fût est le bas de son sprite ; celui de la cime est `pyCime`, le bas
   du sprite plus `ancrageHouppierPx`. La silhouette est la réelle (alpha ≥ 128, rotation du vent
   comprise). Un point à la hauteur z tombe à ℓ(H)/H·z au sud du pied, cisaillé comme la coulée.
   H = `hauteurPx` (arbre-art.ts : baliveau 48, la plupart 64, conifères 80, `old_tree` 96). Pénombre et
   opacité sont celles de la planche 3, et les texels d'occludeur ne prennent pas l'ombre.
   **Capture** (`planches.mjs` GI_ARBRES=1 → `planche4.mjs`) : le poste de l'avatar se choisit hors
   navigateur, sur le relevé. C'est un texel que la règle proportionnelle ombre et la fixe non, 3 de large
   sur 2 rangs, où aucun sprite d'arbre ne couvre l'avatar, à ≥ 3 tuiles du feu. Le téléport est ensuite
   lu puis corrigé : le bas du sprite est à position + 3 px, et 3 essais amènent à 0,34 px.
   ⚠ **De jour, viser AVANT 15 h canoniques.** `ambientTint(hs).alpha` vaut 0 jusqu'à 15,00, puis
   +0,01 par quart d'heure, et la sim court pendant la capture : trois téléports ≈ +0,5 h. Au run 15
   (17,3 h), P1 ≠ R0bis. Au run 16 (visée 15,2, lue 16,2), la preuve prop cassait (7,3 % > 3). D'où
   la visée à 14,3, avec l'heure REPOSÉE après le poste : lue 14,73. **MESURÉ** (run 17) :
   - identité du voile de jour : 0,06 niveau en moyenne. 12 % des pixels bougent entre deux clichés :
     le monde vit pendant la capture ;
   - preuve de jour : fixe 0,14 (0,00 % > 3), prop 0,28 (1,40 % > 3). Seuls 0,07 % sont des pixels
     immobiles (R0 = R0bis = P1) : 95 % des fautifs changent déjà entre R0 et R0bis, et presque tous
     d'à peine 4-5 niveaux ;
   - preuve de nuit : 0,31 / 0,38 / 0,43 (0,03-0,10 %, l'écrêtage du foyer) ;
   - plancher du ciel mesuré (0,348 ; 0,365 ; 0,546), contre (0,341 ; 0,357 ; 0,545) au code.
   **Ce qu'on voit** : 163 tuiles d'ombre avec la règle fixe contre 256 avec la proportionnelle, dont
   46 contre 139 d'ombre pleine. L'avatar se tient à 22 px au sud du pied du fût d'un saule (H 64), dans l'ombre de sa CIME :
   repassé sprite par sprite, le modèle ne trouve qu'elle sur le texel lu (son pied `pyCime` est à 18,5 px,
   3,5 px au sud de celui du fût). Il garde 1
   (fixe) contre 0,58 (prop) le jour, 1 contre 0,62 la nuit (G2 : 1) ; sous son pied, l'ombre vaut 0
   (fixe) et 1 (prop). Un arbre ne s'assombrit jamais de l'ombre d'un autre : au plus sombre il garde 1
   le jour, et 0,94 la nuit, du fait de l'ombre du feu. Avec la règle fixe, la cime entière se tasse
   dans 8 px au pied du fût ; avec la proportionnelle (25,6 px pour un arbre de 64), sa silhouette se lit
   au sol. **La réponse vaut aussi pour les murs** (12,8 → 8 px si fixe) **et les roches** (8 → 6,4 à
   9,6 px si proportionnelle). Posée à Alexis le 2026-09-15 → **RÉPONDU : PROPORTIONNELLE** (la reco).
   La longueur de chaque lanceur suit sa hauteur, 0,4 × H pour commencer ; le facteur reste un réglage,
   à caler sur les planches. **Conséquences** :
   - il faut une hauteur par sorte de lanceur, prise au code : `MUR_HT` = 32 pour le mur, `EMERGENCE`
     [16, 20, 24] pour les blocs (`socle-mineral.ts`), `hauteurPx` pour les arbres (arbre-art.ts) ;
   - les murs gardent les 12,8 px de la planche 3 ;
   - la coulée des roches cesse d'être une constante (`ombre-socle.ts` ③) et suit la hauteur de son bloc,
     6,4 à 9,6 px au lieu de 8 : c'est un look livré le 2026-08-27 qui bouge, dans la refonte (Alexis
     l'a choisi en le sachant, l'option le disait) ;
   - la longueur ne suit toujours pas l'heure (supposition de la planche, non rouverte).
   Ligne de journal due (volet `rendu-da.md`).
4. Le degré de « volume » contre la DA pixel : combien de crans, quelle taille de grille — **se
   tranche SUR LES PLANCHES**, pas dans l'abstrait.
   Où vivent les crans aujourd'hui : `ombre-socle.ts` `ALPHA_CRANS` 3 (la coulée, et les masques d'astre des
   planches) ; `compose.mjs` option `crans` (G2 ne s'en sert pas : niveaux continus) ; `pave-layer.ts`
   `CRANS_SOLEIL` 8 ; `mist-layer.ts` `CRANS_MAQUETTE` ; le trou du voile et la flaque du feu : grain 4 px
   NEAREST, alpha continu (smoothstep).
   **Planche 5 « Crans de lumière »** (2026-09-15, run 19)
   https://claude.ai/code/artifact/993fe3fa-d324-43a1-aa06-cb38e137aeeb : le coin du feu (412, 84) sous la
   pleine lune (jour 61) puis la nouvelle (jour 72), G2 continu contre la même lumière taillée en 8, 4 et
   3 crans, au grain de 4 px (la moitié « grain » de la question n'y est pas posée). Le levier étudié
   (`tools/__gi-planches/planche5.mjs`, `cranter`) : on taille L, la lumière ajoutée, jamais M (tailler M
   déplace le plancher du ciel : à la nouvelle lune 0,077 → 0,125 en 8 crans, 0 en 3) ; l'intensité, pas
   chaque canal (canal par canal, le bassin se frange : 44° de teinte sur plus de 40 % du bassin) ;
   rapportée au PIC du feu (un vacillement en force ne déplace aucune bande, `fire-ground-glow.ts:37`) ;
   arrondi au plus proche (`ombre-socle.ts:198`). MESURÉ : la portée tombe de 5,5 à 4,9 / 4,3 / 4,1 tuiles
   (pleine lune ; 5,2 → 4,0 à la nouvelle) ; le bassin garde 0,99 / 0,96 / 0,91-0,95 de sa lumière, et la
   perte vient presque toute des texels tombés sous ½ cran (7,3-7,9 % en 3 crans, l'intérieur s'équilibre
   à ±2,4 %) ; le chiffre d'un corps bascule près d'un bord de palier (avatar 0,98 → 0,77 en 3 crans à la
   nouvelle lune, I·3 = 1,43 ; 1,59 à la pleine, où il monte) — pas une propriété du look.
   → **RÉPONDU le 2026-09-15 : CONTINU, G2 TEL QUEL** (contre ma reco, 3 crans) : chaque texel de 4 px
   garde son propre niveau ; la GI se quantifie en ESPACE (le grain, condition 1bis), pas en valeurs.
   Tombent avec : le seuil de la dernière bande ; la respiration à taille fixe n'est plus exigée par des
   bandes (force seule comme la flaque, ou aussi taille comme le voile d'aujourd'hui, 85-96 px : point de
   spec). La flaque garde son smoothstep. **Non rouvert** : le grain (4 px partout,
   `fire-ground-glow.ts:58`, `fire-fx.ts:64`, `cave-veil.ts:87`) — une planche seulement si Alexis la
   demande. Ligne de journal due (volet `rendu-da.md`).
5. *(ouverte par le choix de la GI)* **La GI et la clarté de la sim** : la GI reste-t-elle cosmétique,
   BORNÉE par ce que `clarteSurSoiAt` accorde (`nuit-noire` N1 : MAX de trois sources, feu 6 tuiles),
   ou la sim apprend-elle le rebond (touche `/sim` et les règles N4-N5) ? Sans réponse, une GI qui
   éclaire plus loin que la sim ment au joueur.
   **Prémisse MESURÉE le 2026-09-14** (`tools/__gi-planches/n2bis.mjs`, runs 4 et 8, contre la loi de
   la sim : `lumiereDuFeu` = `fireBubble`, linéaire sur 6 tuiles, SANS occlusion) :
   (a) la clarté ne décide plus que de la PARADE — le sprint est sorti de la règle le 2026-09-02
   (journal `gameplay-systemes.md`, `sim.ts:907`) ; `nuit-noire.md` N4 et P2 ne le disent pas encore ;
   (b) le rebond ne peut rien franchir : borné sous 0,2, il reste sous `SEUIL_NOIR` = 0,3 — et nulle
   part l'écran G2 n'atteint 0,3 là où la sim est dessous (0 texel sur ~1 800, aux deux runs) ;
   (c) l'enjeu, ce sont les OMBRES : là où la sim accorde la garde, G1/G2 peignent une ombre (moins
   de la moitié du rendu d'aujourd'hui) sur **64 %** du sol au coin du feu, 3,7 % en lisière — le sens
   que N2bis tolère (l'écran plus sombre que la sim, jamais plus clair) ;
   (d) le seul dépassement de N2bis est ANTÉRIEUR à la GI : `fireBubble` centre la bulle sur
   (s.tx, s.ty), le coin NO de la tuile du feu, quand le trou du voile est au centre — l'écran y est
   jusqu'à 0,05 plus clair que la sim sur 9 à 12 % du sol éclairé, R0 compris ; centrée en +0,5,
   zéro texel. Corriger touche la loi de la CHALEUR (bancs, replays) : signalé, pas corrigé.
   → **RÉPONDU le 2026-09-14 : LA SIM APPREND L'OMBRE**, contre la reco (la sim fait la loi, la GI
   s'y borne, `/sim` intact). Dans la sim aussi, la lumière du feu s'arrête aux murs : en nuit
   aveugle, on ne pare plus dans l'ombre d'un mur. **Conséquences, à écrire dans la spec AVANT le
   code** : `/sim` est touché (`nuit.ts`, `lumiereDuFeu`) → revue `determinisme-sim` avant fusion ;
   `nuit-noire.md` N1 s'amende (et N4/P2, périmés depuis le 2026-09-02) ; UN SEUL prédicat
   d'occultation, dans `/sim`, au grain de 4 px (murs sur leurs bords, troncs, blocs), dont le masque
   de la GI se DÉRIVE — le contrat de `cave-veil.ts` (« la loi reste dans /sim, ici on la MONTRE ») ;
   la chaleur ne change pas (même rayon : ce qui chauffe éclaire, la lumière demande en plus une
   ligne de vue) ; la prédiction du client suit d'office (`clarteSurSoiAt` partagée). **Proposé,
   dérivé de N2bis, à confirmer dans la spec** : la pénombre de la sim = la part visible d'une source
   étendue (motif tabulé, pas de `cos` dans `/sim`) — un rayon unique au centre rendrait la sim plus
   sévère que l'écran dans la pénombre ; et la lumière recentrée au milieu de la tuile (défaut (d))
   sans toucher la chaleur. **Restent ouverts** : le jour d'une gueule (`partDuCiel`, Chebyshev, sans
   occultation) apprend-il l'ombre aussi ? — à poser sur la planche des grottes ; la torche d'un autre
   corps (N6 : elle n'éclaire que son porteur) — en multi. **Une quatrième ligne de journal due**
   (volet `gameplay-systemes.md`, lui aussi modifié par l'autre session au 2026-09-14).
   **N2bis après Q5 — MESURÉ le 2026-09-14** (`tools/__gi-planches/n2bis-q5.mjs`, runs 8 et 4) : la sim
   proposée (bulle linéaire sur 6 tuiles, centrée au milieu de la tuile, × la part visible de la source
   étendue de la GI — même grain, même motif) contre l'écran G2 (ombres ET rebond) : **0 texel** où
   l'écran atteint `SEUIL_NOIR` quand la sim reste dessous ; au point près, l'écran ne dépasse jamais la
   sim de plus de 0,01 (coin) / 0,019 (lisière). Le rebond, que la sim n'apprend pas, ne fait franchir le
   seuil nulle part. Avec un rayon UNIQUE (ombre dure) : toujours 0 texel au seuil, mais l'écran dépasse la
   sim de 0,22 / 0,17 dans la pénombre (84 / 43 texels) — **la pénombre de la sim doit être celle de la
   GI** : la proposition ci-dessus devient une exigence de la spec. Le plancher de la nuit (Mn, la lune)
   est commun aux deux lois et hors du champ de N2bis (gardé heure par heure). **Les phases ne rouvrent
   pas cette mesure** : faite à la nouvelle lune (jour 72), le seul régime où le feu décide seul (le ciel
   y vaut ~0 dans les deux lois) ; à la pleine lune, `clarteDuCiel` vaut 1 au cœur de la nuit (`nuit.ts`)
   et l'ombre d'un mur ne décide plus de rien. Entre les deux, le cumul lune + feu de l'écran contre le
   MAX de la sim est la loi d'aujourd'hui (R0 l'a aussi), pas un effet de la GI. ⚠ Piège de sonde : une
   source posée PILE sur un coin de texel fait errer `traverse` (la case d'arrivée n'est jamais
   atteinte) — la première passe rendait 65 franchissements « durs », faux ; décalée de 1e-3, zéro. La
   loi de `/sim` devra écarter ce cas (centre de tuile = coin de texel au grain de 4 px).

## Calage des murs — défaut relevé le 2026-09-15 (vu par Alexis sur les clichés), corrigé dans les outils le même jour
Dans les outils, un mur d'arête occupait le texel de 4 px juste DANS sa tuile (`compose.mjs` `grille`,
`astre.mjs` `lanceurs`). Le jeu le dessine et le bloque À CHEVAL sur l'arête, 2 px de chaque côté
(`bati-art.ts` : « le mur est À CHEVAL sur l'arête », même partage que `WALL_HALF`). D'où un décalage d'un
demi-texel (2 px monde, 4,5 px écran). MESURÉ sur le run 14 : de jour, une bande de 2 px reste hors de
l'ombre le long de la face intérieure des murs ouest et est ; de nuit (G2), une bande de 2 px est ÉCLAIRÉE
derrière le mur nord, du côté opposé au feu (136-141 contre 72-76 juste au-delà). La caméra n'y est pour
rien : les bords de texel tombent sur des pixels entiers.
**Le correctif (outils, 2026-09-15 ; planche 3 refaite, run 18)** : un mur d'arête est une BANDE d'un texel
d'épaisseur centrée sur sa ligne, qui déborde d'un demi-texel à chaque bout (`bande()` de bati-art) ; les
rayons la rencontrent exactement (intervalles ouverts : partir d'une face ou la longer ne bloque pas) ; ses
deux faces renvoient le rebond, chacune depuis un texel derrière le texel qui la borde (la distance
qu'avait l'ancienne face). MESURÉ hors du jeu sur les données du run 14 : l'ombre pleine du jour passe de
90 à 117 texels (elle part de la face du mur, 2 px plus au sud, et gagne un rang) ; la porte est laisse
sortir la lumière du feu par 12 px au lieu de 16 ; au-delà de la portée du rebond (12 texels d'un mur), G2
ne bouge pas (0,0005 au plus), entre 8 et 12 texels il bouge de 0,05 au plus (les faces de rebond ont
bougé). Les sprites de bâti lisent désormais leur lumière sur les texels de sol qui bordent la bande
(`gr.face`), plus sur un texel de mur qui ne prenait jamais d'ombre : de jour, le pan ouest descend à 0,86
à son coin nord, dans la pénombre du pan nord (retirer sa propre bande n'y change rien).
**Règle pour la spec** : une arête est une bande à cheval sur sa ligne ; elle bloque ENTRE deux texels et
n'en occupe aucun ; le sol des deux côtés prend lumière et ombre, décidé au centre de chaque texel (posé
sur une face de la bande), et le sprite en couvre un demi-texel de chaque côté. Une ombre d'astre se
compte depuis la face. **À trancher** : un sprite de bâti prend sa face la mieux éclairée (rustine de
`planches.mjs`), ce qui ne le garde de sa propre ombre que tant qu'une seule lumière le prend. De nuit, la
lune et le feu prennent les pans nord et est de deux côtés opposés : la face extérieure perd la lueur du feu
(ratio ≈ 0,5, G2 la bloque), l'intérieure perd la lune dans l'ombre de son propre pan, et le sprite prend
l'intérieure, à 0,966-0,981 contre 0,993 dans « Sans » (MESURÉ, run 18, rustine rejouée hors du jeu au
millième près ; retirer sa bande rend 0,993). Les planches 1 et 2 portent encore le défaut (pas refaites) ; la planche 4 n'a
aucun mur d'arête dans ses cadres (runs 15-17 : le feu seul), elle n'est pas touchée. `n2bis*`,
`variantes`, `diag` (analyses closes de la planche 2) ne lisent que `occ` : à reprendre si on les relance.

## Planche 8 — le relief refait par la GI (2026-09-15)
Publiée : https://claude.ai/code/artifact/ead0e7ac-2c17-472c-87c2-74d75a44795b (run 28 ; `GI_RELIEF=1`,
`planche8.mjs`, `planche8-page.mjs`). D rend le relief à toutes les familles, de jour autant qu'aujourd'hui ou
presque, la nuit davantage ; trois limites montrées (à midi, tout corps au pied à l'ombre d'un autre reste plat : murs
de côté, branche au pied de l'arbre ; corps plus clairs à 19 h ; feu pâle et marches entre pans la nuit). Légendes
relues sur les feuilles du run 28 (`feuilles28/`) : celles de la branche et des lucioles venaient du run 26 et étaient
fausses — corrigées, planche republiée à la même adresse. La forme
D RETENUE par Alexis le 2026-09-15 (« Retenir D, limites d'abord ») : avant d'écrire D en règle, une planche 9
montre des corrections des limites — E (teintes lues aux deux coins du pied et interpolées par Phaser : plus de
marches entre pans), F (un corps n'est ombré que par plus haut que lui : murs et arbres ne prennent que l'ombre des
arbres). Cause des murs sombres à midi, lue au run 28 : le pied d'un pan est dans l'ombre que son propre mur jette au
sud (S = 1 sur le mur nord, ⅔ et ⅓ sur les côtés). La branche sous l'arbre est à l'ombre de l'arbre : juste. Pièges levés en route : K sur les corps du cadre seulement (run
26 : 11,6 par les corps hors cadre) ; les FLAT_PROPS (cailloux, lichen, sphaigne, poussière) sont SOUS le voile —
les teinter par-dessus le voile compte sa lumière deux fois ; le masque des corps se tire d'une passe `d-masque`
contre la passe nulle (ni « sous le voile », ni « p0 noir » : une couche ajoute ~12 niveaux au-dessus du voile).

## Planche 9 — D, limites d'abord (2026-09-15)
Publiée : https://claude.ai/code/artifact/5f40a37e-d5bd-41e8-81cf-94f3743d9b19 (run 31 ; `planche8.mjs` fait les
passes, `planche9.mjs` la composition par pixel, `recomposer9.mjs` la refait hors jeu depuis les passes du run —
`.rgba` et `p8-<h>-grilles.json` —, `planche9-page.mjs` la page ; `GI_HEURES=midi` limite les rangées). Cinq
corrections de D, seules puis ensemble, en images réelles : E lu sous chaque pixel, F ombré seulement par plus
haut, G g du soleil de midi, H le feu de jour (LG-R5 l'éteint), I le plancher d'un corps = l'ambiante Light2D.
Ce qu'elle montre (détail dans la spec, LG-Q3 (a) « Les limites, sur planche ») : **E efface les marches** (saut à
la jointure ~35 → ~3 niveaux la nuit et le soir, celui d'aujourd'hui) et ramène le mur à la clarté d'aujourd'hui la
nuit (il lit le feu sur la face qui le voit) ; hors des murs, E est D. **Les corps à l'ombre à midi ont trois
causes** — le feu éteint de jour (H, le plus gros levier, trop fort à la force de la nuit), le pied dans l'ombre
de son propre mur (F, +6), le plancher 0,58 sous l'ambiante 0,68 (I, +2). **G ne fait presque rien** : la clarté
des corps au soleil bas vient de la part plate, prise au sol sous le voile, où aujourd'hui Light2D donne son
ambiante (0,41) ; la correction serait I à toute heure, non montrée. **Tranché le 2026-09-16 par Alexis : « Oui, E
devient la règle »** — LG-R7 amendé dans la spec (un corps lit la GI sous chacun de ses pixels ; un occludeur lit
chaque part sur sa face la mieux exposée à SA source, jamais ombré par lui-même ; la vraie passe lit la GI au pixel
dans le shader, pas à la teinte). **Tranché le 2026-09-16 : « Oui, mais plus faible qu'aujourd'hui »** — le feu
compte de jour, à une fraction f < 1 de sa force de nuit, à régler en regardant une planche (LG-R5 amendé). **Répondu le 2026-09-16 à « I à toute heure ? » : « Voir
d'abord »** — la planche 10 montre I à toute heure à côté de D et d'aujourd'hui, avec le feu de jour à plusieurs
fractions f : les deux réglages se jugent sur les mêmes images.
Pièges levés : `setTintFill()` est un no-op en Phaser 4 (passe d'identité en MULTIPLY, un bit du rang par passe,
onze passes + parité — 99,4 % des pixels de corps nommés) ; E composé depuis le masque seul noircissait les bords
des cimes (mêlés au voile noir) → E = D − corps(D) + corps(E) ; la fenêtre « face la plus claire » jugée sur M
prenait, pour un pan de mur ouest, la face au soleil où le feu est bouché → chaque part sur la face la mieux
exposée à SA source ; lu par colonne, une cime large tombait dans sa propre ombre → un occludeur n'est pas ombré
par lui-même ; la lecture du dessus d'un mur bornée à la tuile du pan gardait une marche de 5-10 → 32 px plus bas,
sans borne. Les moyennes par pan ne voient pas les marches (aujourd'hui, en pente continue, fait le même écart) : la
mesure est le saut à la jointure, sur les pixels que la passe d'identité donne à chaque pan.

## Planche 10 — Le feu de jour et le plancher d'un corps (2026-09-16)
Publiée : https://claude.ai/code/artifact/34b1bdf8-746d-405e-9409-71b7fc977e29 (run 32 ; `planche10.mjs` fait les
passes — `GI_RELIEF=1 GI_P10=1`, fractions par `GI_FRACTIONS` —, chaque variante composée au pixel comme E depuis
ses trois passes, le manifeste `passes` dans `p8-<h>-grilles.json` ; `recomposer10.mjs` refait toute variante hors
jeu ; `planche10-page.mjs` la page). Aujourd'hui, E (la règle), I à toute heure (a_I = 1 − ambiante/Mn), le feu de
jour à ⅛, ¼, ½, 1 de sa force de nuit — sur le sol (un champ M par fraction, tamponné dans le voile) comme sur les
corps. Ce qu'elle montre (détail dans la spec, LG-Q3 (a)) : **le feu de jour** — ⅛ invisible, ¼ effleure le pan près
du feu, ½ se lit sur les murs et dans l'ombre au sol, nettement sous aujourd'hui, 1 rend les murs d'aujourd'hui, un
peu plus clairs ; de jour le feu ne remplit que l'ombre. **I** — la nuit I est E (l'ambiante vaut le plancher), à
midi +2, au soir I ne ramène PAS les corps à la clarté d'aujourd'hui : même lumière totale, part du soleil ×3, et au
soleil bas (g ≈ 3,9) le côté au soleil flambe, l'ombre s'assombrit. **La clarté des corps à 19 h vient de LG-R7
lui-même** (un corps a la lumière du sol sous son pied, le voile à 0,80 ; Light2D donne aujourd'hui aux corps
0,41 + un soleil faible) : ni I ni G — question ouverte, non montrée (une planche 11 « un corps a moins que le sol au
soir » se compose hors jeu depuis les passes du run 32, sans rendu). Les marches restent effacées partout.
Piège levé : le tmpfs /tmp (5,7 Go, partagé) plein à 80 % de vieux runs → `UNKNOWN: unknown error, write` à la
rangée de midi ; runs 4-30 supprimés, relancé. **Tranché le 2026-09-16 par Alexis : « La moitié » — f = ½ (LG-R5
amendé) ; puis « Non, E reste » — I écarté, le plancher d'un corps reste 1 − a ; puis « Voir d'abord » pour la
clarté des corps à 19 h.**

## Planche 11 — Un corps, moins que le sol ? (2026-09-16)
Publiée : https://claude.ai/code/artifact/5d209733-48b2-4a01-b9c4-f64fa08d2ecc (run 32, sans nouveau rendu :
`planche11.mjs` refait les parts hors jeu depuis `p8-<h>-releve.json` et les clichés r0/p0/p1 — les mêmes
fonctions, écart 0 contre les grilles de E du run —, ajoute les grilles platJ/astreJ/feuJ et `passes.dJ` (base :
les passes de E, `grillesD` : E) au `p8-<h>-grilles.json` ; `recomposer10.mjs` (qui honore `grillesD`) compose ;
`planche11-page.mjs` la page, ouverte sur 19 h et J). J : la part plate d'un corps est min(Mn(1 − a), ambiante
Light2D de l'heure), par canal à la couleur du voile ; astre et feu de E ; les parts ne rendent plus M. Ce qu'elle
montre : au soir, J rend aux corps la clarté d'aujourd'hui (cimes 59 / E 96 / J 66, roches 46 / 78 / 52, murs
87 / 101 / 83) sans rien perdre de E ; à midi et la nuit, J est E ; le sol ne change jamais. Toute variante qui ne
change que les PARTS des corps se compose ainsi hors jeu, en une minute, depuis les passes d'un run : seules
celles qui changent le sol (le feu de jour) demandent un rendu. **Tranché le 2026-09-16 par Alexis : « J » —
LG-R7 amendé.** LG-Q3 (a) est entièrement tranché : D (planche 8) + E (lu sous chaque pixel) + le feu de jour à
½ + le plancher de la spec + J — et ÉCRIT dans la spec le 2026-09-16 : LG-R7 « en forme finale » (la lecture, les
parts, la normale, le feu de jour, ce qui n'est pas retenu, ce que la planche ne prouve pas), LG-A8 complété de
critères chiffrés (marches, relief, le soir, le feu de jour, la face), le tableau des décisions ; et LG-R5 : la
fraction du feu suit le voile, f = ½ + ½(1 − Mn)/(1 − Mn_nuit) (tranché le 2026-09-16, « Elle suit le voile »).
Suite : LG-Q3 (b) l'engagement, (c) la flaque.

## Planche 12 — L'engagement (2026-09-16)
LG-Q3 (b) posée à Alexis le 2026-09-16 : « Voir d'abord » — une planche : le coin la nuit, feu neutre contre
feu engagé, sous le jeu d'aujourd'hui, sous le champ tel quel (LG-R6 : l'engagement se lit à la flamme seule)
et sous un champ qui prend l'engagement. L'engagement se force CÔTÉ CLIENT, comme la garde `feuNuit` de
`smoke.mjs` (un getter verrouille `view.villages` avec le warmth voulu) : aucune règle de jeu n'est touchée.

**PUBLIÉE le 2026-09-16** : https://claude.ai/code/artifact/67ed5a1b-a8e6-4699-8b4f-602b4c1a5103 (« L'engagement à la
flamme », run 34, 41 images). Outils : `tools/__gi-planches/planche12.mjs` (GI_RELIEF=1 GI_P12=1, dispatch dans
`planches.mjs`) et `planche12-page.mjs` (GI_FEUILLES=<dossier> pour les feuilles de loupe). Recette :
`PLAYWRIGHT_BROWSERS_PATH=0 GI_SCENE=journee GI_JOUEUR=bassin GI_RELIEF=1 GI_P12=1 node --import tsx
tools/__gi-planches/planches.mjs <run>` (~8 min, ~250 Mo sur /tmp — `df -h /tmp` avant), puis
`GI_FEUILLES=<feuilles> node --import tsx tools/__gi-planches/planche12-page.mjs <page.html> <run>`.
Protocole : UNE seule pause de l'hôte pour les deux rangées (T0 relevé puis remis), la rangée engagée
reteinte les sprites `st-fire*` à la main (les snapshots n'arrivent pas hôte figé) — le run 33, qui reprenait
l'hôte entre les rangées, laissait la sim courir deux minutes (lune et bêtes bougées) : remplacé.
Six vues : aujourd'hui neutre / engagé, E neutre, tel quel (LG-R6 : le champ de la rangée neutre, écart de
profil 0,03), K (force ×1,25, portée constante), K2 (portée ×8/3 par `etirer`, force ×1,25).
Ce qu'elle montre : aujourd'hui l'engagé allume la forêt à l'orange, à travers les murs (Light2D ignore les
murs ; rayon 81 → 215 px), le sol ne bouge pas hors de la flaque ; tel quel : seules les bûches (qui pâlissent,
la flamme est saturée) et le reflet sur l'eau (hors refonte) ; K : au pied du feu seulement ; K2 : la clairière
déborde au sud et par la porte jusqu'à sept ou huit tuiles, les murs tiennent — sur le sol, c'est l'inverse de
la décision du 2026-08-03. Les anneaux se calculent DANS LA PAGE (moyenne / p90 par anneau depuis les PNG) : la
médiane par anneau trompe dans un enclos, la moitié de chaque anneau est derrière un mur. Écrit dans la spec
(LG-Q3 (b)). **TRANCHÉ le 2026-09-16 par Alexis : « K : la force seule »** (la recommandation) — la portée reste
constante (2026-08-03 reconduite), la force d'un Feu suit l'engagement par la loi d'aujourd'hui (`intensiteDuFeu`,
× (0,8 + 0,2 e)/0,8), l'engagement se lit au pied du feu et aux bûches. ÉCRIT : LG-R6 amendé (portée non, force
oui ; ce que la planche a écarté), LG-A7 complété du point proche (0–1 tuile +10 niveaux au moins, rien de plus de
3 au-delà de 4 tuiles, portée du champ identique), le tableau des décisions. Suite : LG-Q3 (c) la flaque.

## Planche 13 — La flaque du feu (2026-09-16)
LG-Q3 (c) : « Reste-t-elle une lueur sous le champ, ou le champ la reprend-il ? » **PUBLIÉE le 2026-09-16** :
https://claude.ai/code/artifact/43b5830b-3e2a-4234-92c6-17872706fd89 (« La flaque du feu », 20 images). Composée
HORS JEU sur le run 34 (rangée nuit, village neutre) — aucun rendu de plus : `tools/__gi-planches/planche13.mjs <run>`
(écrit p8-nuit-dF et dC, les colonnes par sprite, `gardes.planche13`), puis `planche13-page.mjs <page> <run>`
(GI_FEUILLES=<dossier> pour les feuilles). Rappel utile : depuis la planche 6, les passes de la GI sont prises
`sansFlaque` — E n'a PAS de flaque, et le run garde la paire p0/p1 AVEC et SANS flaque (p1 − p1sf = l'ajout de la
flaque sous un voile blanc ; p0 = p0sf). dF = E + M × (p1 − p1sf) au texel sous chaque pixel (ce que le voile lui fait
aujourd'hui) ; dC = la rampe STOPS_CHAUD de fire-ground-glow (alpha smoothstep, couleur t², 3 tuiles, gain 1) ajoutée
à la lumière L du feu avant M, sol = C sous M' depuis la paire sans flaque, corps lus sous chaque pixel avec les parts
refaites (écart 0 contre les grilles du run). Ce qu'elle montre : aujourd'hui la flaque cuit le pied en ambre et lave
le sol (part de couleur 44 % contre 58 % au sol) ; le champ seul en fait de l'herbe éclairée, sans braise ; la flaque
sous le champ retrouve le halo, plus doux et moins lavé (57 %) ; le cœur ouvre le voile en plein — vert-jaune de
plein jour, jamais ambre, murs et avatar plus clairs. Un multiplicateur ne fait pas de braise. Écrit dans la spec
(LG-Q3 (c)). **TRANCHÉ le 2026-09-16 par Alexis : « La flaque reste sous le champ »** (la recommandation) — la
flaque d'aujourd'hui, telle quelle (ADD ambre, 3 tuiles, alpha suivant la flamme et l'engagement), peinte SOUS le
champ qui la multiplie ; 2026-08-03 reconduite (le champ porte la portée, la flaque n'est qu'un cœur). ÉCRIT : la
ligne (c), LG-R6 (la flaque reste, sous le champ), LG-A7 (le pied du feu : luminance et part de couleur du sol à
0,5–1 tuile pas sous celles d'aujourd'hui), le tableau. **LG-Q3 est entièrement tranché** (a, b, c).

## Planche 14 — Les paliers (2026-09-16)
LG-Q1 : « Les paliers ≥ 1 … une GI qui n'y entre pas fait une couture à chaque marche. » **PUBLIÉE le 2026-09-16** :
https://claude.ai/code/artifact/6ed775fc-0686-42b2-b5e3-5e96bef8eda8 (« Les paliers », 24 images), run 36 — le run 35
(terrasse à quatre tuiles) ne la touchait qu'à peine, le champ portant à 5,6 tuiles ; l'élection a été resserrée. Recette :
`PLAYWRIGHT_BROWSERS_PATH=0 GI_SCENE=palier GI_JOUEUR=bassin GI_RELIEF=1 GI_P14=1 timeout 3000 node --import tsx
tools/__gi-planches/planches.mjs <dossier>` (~4 min), puis `GI_FEUILLES=<dossier> GI_DEFAUT=dF node --import tsx
tools/__gi-planches/planche14-page.mjs <page> <run>`. **Le harnais a grandi** (planches.mjs) : la scène `palier`
(élection : feu au palier 0, plat sur ±1, tuiles hautes à ±3, RIEN au sud proche dx∈[−3,3] dy∈[1,6] — levée de deux
tuiles, une terrasse au sud couvrirait le feu —, connecteur à ±5 préféré, canyons pénalisés ; le joueur se poste au sud) ;
`cliche(…, {hauteurs: 0xffffff|0x000000})` verrouille par un getter, le temps du pas, la teinte plate des cinq couches
des paliers (etages, paves, gelLayer, water, cliffs — le vrai setter d'abord : pavés et gel re-teintent leurs parts
posées, falaises et chapeau se reposent à chaque image) ; `releve()` rend `connecteurs`, `teinteDesHauteurs`, `liftPx`
(lu sur `yDessineDuCorps`, 32) ; la rustine lit le pied LOGIQUE (`S.pal`, le palier par tuile : `liftDe` remonte du pied
dessiné au palier le plus haut qui se dessine là ; g reste au pied dessiné) et `vus[].lift` ; `composerParPixel`
(planche9.mjs) prend `s.lift` (et `s.liftD`, le lift que la passe a employé) ; dispatch `GI_P14`. **planche14.mjs** : une
rangée (22 h 30), tout AVEC la flaque (plus de `sansFlaque` depuis LG-Q3 (c)) ; la paire p1/p0 et la paire pT1/pT0
(voile blanc, hauteurs blanches puis noires : le sol des hauteurs est affine en sa teinte — écart moyen 0,40, max 25,8,
43 px sur 426 509 contre aujourd'hui) ; les passes E et F (`grilleAvecFalaises` : chaque arête entre deux paliers = une
bande comme un mur, connecteurs exclus) ; dE = E ; dV = E lu à l'écran (corps lift 0) + terrasse à M(dessiné) ; dP = E +
terrasse à M(tuile logique) + faces (sous le voile, sur une tuile haute) à M(pied, première tuile de palier 0 au sud) ;
dF = idem avec MF. 283 corps levés sur 933 ; anneaux sol et terrasse à part (la terrasse à sa tuile logique).
**Ce qu'elle montre** (en mots dans la page, en chiffres dans la spec LG-Q1) : aujourd'hui la lumière s'arrête au haut
de la paroi ; le champ qui s'arrête au pied garde la couture et allume les buissons du bord (lus à leur tuile) ; sous le
voile, une lueur faible au mauvais endroit ; à plat, le disque continue par-dessus la marche ; l'écran rend la marche
d'aujourd'hui et la roche renvoie un peu de lumière au pied. Non montré : un feu SUR la terrasse (l'écran de la planche
bloque dans les deux sens ; une règle ne ferait écran qu'à ce qui monte), une rampe à portée. **QUESTION POSÉE à Alexis
(LG-Q1), recommandation « la falaise fait écran, à sens unique » → réponse « Voir d'abord » (16/09) : la planche 15.**

## Planche 15 — Le feu sur la terrasse (2026-09-16)
Alexis, sur LG-Q1 : « Voir d'abord » = une planche avec le feu SUR la terrasse (la lumière qui descend) et une rampe à
portée. **PUBLIÉE le 2026-09-16** : https://claude.ai/code/artifact/4b9b7095-f658-47d9-9d09-2d73b463b983 (« Le feu sur
la terrasse », 30 images), run 37. Recette : `PLAYWRIGHT_BROWSERS_PATH=0 GI_SCENE=terrasse GI_JOUEUR=bassin GI_RELIEF=1
GI_P15=1 GI_PROFIL=<run36> timeout 3000 node --import tsx tools/__gi-planches/planches.mjs <dossier>` (~4 min 30), puis
`GI_FEUILLES=<dossier> GI_DEFAUT=dF1 node --import tsx tools/__gi-planches/planche15-page.mjs <page> <run>` (la prose
dans `planche15-prose.json`). **Le harnais** : la scène `terrasse` (élection : feu au palier 1, plat sur ±1, sol bas à ±3
(≥ 6 tuiles), de préférence au sud, AUCUN palier ≥ 2 au sud proche, rampe à ±5 préférée ; le joueur se poste au sud) ;
`lireLumieres` cherche la lumière et la flaque du feu là où il se DESSINE (`yDessineDuCorps` — le premier run est mort sur
« sans lumière de feu », la Light2D étant 32 px plus haut) ; dispatch `GI_P15` = planche14.mjs avec `prefixe: 'p15'` et
`profilDe` (le trou d'aujourd'hui se creuse au feu dessiné, sous le sol des hauteurs — le profil radial est EMPRUNTÉ au
run 36 : ici il aurait porté 67 px, pic 0,49, contre 94 px et 0,83). **gi-ref.mjs** : `traverse(…, murs, palSrc)` — une
bande qui porte `haut` (le palier de son côté haut) ne bloque qu'une source d'un palier plus bas ; `giRef` passe
`e.palier` (compose.mjs `lumiere` : `mes.palier`) et `opts.palierTexel` (`gr.palierTexel`, posé par
`grilleAvecFalaises(d, gr, R, { sens: true })`) ; les faces qui renvoient portent le palier de leur texel éclairé. Essai à
sec sur le run 36 : feu au palier 0 → F1 = F au bit près ; feu réputé au palier 1 → F1 passe les marches. **planche14.mjs**
: quatre champs (E, F deux sens, F1 un sens, V = E recentré sur le feu dessiné — au palier 0, V = E sans passe de plus),
six rendus (r0, dE, dV = V lu à l'écran, dP, dF1, dF), `gardes.falaise` par champ (texels hauts et bas touchés, portée,
pic). **Ce qu'elle montre** : aujourd'hui le feu n'éclaire que sa flaque, la plaine au pied garde un reste de trou ; le
champ au pied met la lumière EN BAS (plaine 88, avatar 138, terrasse plate) ; sous le voile, le plateau et pas le pied ;
à plat, le plateau ET la plaine comme sans marche ; à sens unique, pareil plus le rebond de la paroi ; à deux sens, la
plaine reste dans sa nuit sous un feu au bord de la marche. La paroi (roche sombre) se voit peu ; la rampe, à trois
tuiles à l'est et de côté, ne fait presque rien comme porte (65 texels bas touchés à deux sens contre 867). **Avec la
planche 14 : seul l'écran à sens unique est juste dans les deux cas.** L'affinité de la terrasse : 2 029 px hors de 3
niveaux, tous au cœur de la flaque où le cliché blanc sature. **QUESTION REPOSÉE à Alexis (LG-Q1), même
recommandation — PAS ENCORE TRANCHÉE.** Alexis a répondu par une observation (16/09) : « si le feu est en haut de la
falaise, un peu reculé, la falaise ne devrait pas être éclairée et l'ombre de la falaise devrait s'étendre plus loin
jusqu'au sol en bas […] idem sur les murs : la lumière comme si le sprite était à plat sur le sol alors qu'il est en
2.5D […] idem pour les troncs ». → **Décidé (16/09) : « Planche 16 d'abord »**, LG-Q1 se tranche après.

## Planche 16 — Les faces dressées (2026-09-16)

**Le défaut nommé par Alexis, en trois costumes.** Chez E (LG-R7), chaque pixel d'un corps lit le sol SOUS lui : un
mur y est juste par ACCIDENT (sa face se dessine au sud de sa ligne, sur le sol éclairé par un feu devant… et derrière
lui aussi) ; un tronc lit le sol DERRIÈRE lui (feu au sud : sa propre ombre ; feu au nord : le sol éclairé alors qu'il
tourne le dos) ; une paroi de falaise (règle de la planche 14/15 : la face lit son pied) s'allume PAR EN DESSOUS quand
le feu est derrière l'arête, et aucune marche ne porte d'ombre sur le sol bas. **La règle O proposée : les faces ont
un sens et une hauteur** — (1) une marche jugée EN HAUTEUR : un palier = 32 px, la flamme à 10 px au-dessus de son
sol (Light2D z 9,6 MESURÉ ; variante 24 px) ; un rayon est bloqué par une arête s'il la franchit plus bas que son
haut (gi-ref.mjs `traverse(…, palSrc, hz)` avec `hz = { zR, zS, pas }` en texels, `tBande` ; giRef opts `hauteurs`,
`hzDe`) — physique : la plaine derrière une marche de 32 px est dans l'ombre sur s < 3,2·d (flamme à 10 px ; 1,33·d à
24 px), d le recul du feu ; (2) une paroi dont le feu est derrière l'arête perd la part directe du feu (planche14.mjs
`composeTerrasse` mode `orientee`, Px.feu au pied) ; (3) un mur (`/^st-(wall|palissade|door|mur_bas)/`) lit la part
directe du feu à son PIED × max(0, cos), un tronc (`/_trunk/`) × (1 + cos)/2, cos = (feu.y − pied.y)/dist, en tuiles
LOGIQUES (planche9.mjs `composerParPixel({ orient })`, appliqué aux pixels de face seulement — le dessus d'un mur reste
un plat) ; le reste suit E. **Essai à sec sur le run 37** (feu (244,226) palier 1, marche à 228) : terrasse identique à
F1, plaine sous la marche à zéro direct sur les deux hauteurs de flamme (E 32,9 / F1 50,4 / O10 2,6 / O24 3,8 de somme
sur 13 872 texels de plaine — MESURÉ, `tools/__gi-planches/__essai-hauteurs.mjs`). **Trois runs** (planches.mjs) :
A « terrasse » avec `GI_RECUL=2` (terrasse plate sur dx ∈ [−2, 2], dy ∈ [−1, 1], la rangée +2 au sol bas sur cinq
tuiles, ≥ 20 tuiles basses au sud, profil emprunté au run 36) ; B « murs » avec `GI_SUD=1` (trois murs de plus, bord N
à fy+3 — à fy+2 ils masqueraient le feu) ; C « troncs » (scène nouvelle : un arbre à dy ∈ [−4, −2] ET un à dy ∈
[2, 4], dx ∈ [−1, 1], ni eau ±5, ni roche ni relief ±3). `GI_P16=1` → planche14.mjs prefixe p16 + `zFlammes` (défaut
`GI_ZFLAMMES=10,24`) → champs O/O2, rendus dO/dO2. Page : `planche16-page.mjs <html> <runA> <runB> <runC>` +
`planche16-prose.json`.

**PUBLIÉE le 2026-09-16 : [Les faces dressées](https://claude.ai/code/artifact/222a0756-0f1a-48c4-b155-608317ea7057)**
(runs 38 « terrasse » reculée, 41 « murs » avec le mur sud, 40 « troncs » ; recette : `GI_SCENE=terrasse GI_RECUL=2
GI_JOUEUR=bassin GI_RELIEF=1 GI_P16=1 GI_PROFIL=<run36>`, `GI_SCENE=murs GI_SUD=1 GI_RELIEF=1 GI_P16=1`, `GI_SCENE=troncs
GI_RELIEF=1 GI_P16=1` ; page : `GI_FEUILLES=<dir> node --import tsx tools/__gi-planches/planche16-page.mjs <html> <run38>
<run41> <run40>`). **Ce qu'elle montre (MESURÉ)** — falaise : la paroi sous le feu reculé 64 aujourd'hui / 75 à plat /
81 à sens unique / 48 en hauteur ; la plaine derrière la marche à 1–2 tuiles 58 / 80 / 87 / 47, à 3–4 tuiles 65 / 86 /
92 / 62 (flamme haute 63, p90 72) ; le plateau identique (197) ; l'avatar au pied 70 / 101 / 110 / 60 ; texels de sol bas
touchés 772 / 808 / 0 (flamme basse) / 289 (flamme haute). Murs : le mur du sud (feu derrière) 74 aujourd'hui, 50 chez
E, 35 chez O ; le mur du fond (feu devant) 56 / 70 / 68 ; pans nord-sud E = O. Troncs : le tronc au sud (feu derrière)
140 / 112 / 110, le bouleau voisin 150 / 121 / 121, le tronc au nord (feu devant) 54 / 64 / 64 — E et O pareils sur
les troncs (le pied lu du côté visible est dans l'ombre du tronc même). **Deux corrections de harnais** (planche14.mjs) :
le pied d'un pan nord `-e1_` = sa ligne (s.y − 16 : le sprite d'un mur couvre la tuile et deux tuiles au-dessus, son bas est
au bord sud de la tuile — lu là, E s'éteignait par accident, run 39) ; les pans nord-sud (`-e2_`, `-e8_`) gardent E (au
cosinus, leur bout sud s'éteignait — artefact). Le troisième mur sud a été refusé (matériaux : 20 bois = 10 murs, le
coin en prend 8 — donner 22). **TRANCHÉ par Alexis le 2026-09-16 : « ok pour O »** → LG-R7 amendé (« Les faces ont un sens
et une hauteur — O »). Remarque d'Alexis : « regarde le rayon de lumière en bas à gauche de la structure en mur de bois,
il implique un trou entre 2 murs, ce qui ne devrait pas être le cas » — c'est la géométrie de la scène, pas la règle : le
mur sud était DÉTACHÉ d'une tuile (fy+3, pour ne pas masquer le feu) et les deux coins (fx±1, fy+2) restaient ouverts ;
à l'écran, la face du mur sud (32 px de haut) couvre ces deux tuiles, et la lumière qui sort par là semble passer entre
deux murs joints. Scène refaite les coins fermés : pans ouest et est prolongés à fy+2 (`GI_SUD`, 26 bois, 13 murs). Le run 42 a
révélé un troisième défaut de harnais : avec le pied corrigé, le corps de D était retiré à la ligne alors que la
rustine du jeu l'avait rendu au bas du sprite → O retirait un feu que D n'avait pas mis (mur sud au noir, 7 371 pixels
négatifs) ; planche9 `kD` lit maintenant `s.yD` (le pied de D) — run 43 : zéro négatif. **Chiffres finaux (run 43,
MESURÉ)** : le mur du sud 69 aujourd'hui / 70 chez E (allumé par-derrière, autant qu'aujourd'hui) / 33 chez O ; le mur
du fond 70 / 76 / 74 ; le sol hors du coin au sud 76 / 53 / 53. La planche est republiée au même lien.
**LG-Q1 POSÉE (16/09)** : « écran à sens unique, en hauteur » (reco) / sans hauteur / le champ s'arrête au pied / voir
d'abord → **Alexis : « Voir d'abord »**, puis, au choix de quoi voir : **« La rampe de face »** (reco ; les autres :
l'ombre de lune de la marche, deux terrasses face à face, la terrasse de jour).

## Planche 17 — La rampe de face (2026-09-16)

Un feu sur la terrasse deux tuiles derrière la marche, une RAMPE dans la première rangée basse sur sa colonne : toute
rampe descend vers le sud (`rampeQuiMonte`, etages.ts : le plateau est son voisin NORD), elle fait donc face à la
caméra ; celle de la planche 15 était trois tuiles à l'est, de côté. Dessin (etage-layer.ts `poserLaRampe`) : trois
rangées de 16 px, de `ty − lift − 2` (contre la surface levée) à `ty − lift` (le tablier), sous le voile au palier 0.
Dans le champ, la rampe est une OUVERTURE : l'arête terrasse→rampe n'est pas une bande (planche14.mjs
`grilleAvecFalaises`, `ouvertes`), sans condition de hauteur. La rampe se lit là où elle se dessine (en haut le champ du
plateau, en bas celui de sa tuile). Élection : scène « terrasse » + `GI_RECUL=2 GI_RAMPE=1` (un connecteur dans la
première rangée basse à dx ∈ [−1, 1], dans l'axe préféré), `GI_JOUEUR=astre` (l'avatar sur la terrasse, à l'ouest du
feu, hors de la rampe), profil emprunté au run 36, `GI_P16=1` (prefixe p16). Page : `planche17-page.mjs <html> <run>`
(dérivée de la 16, une section « rampe », loupes rampe / plaine / feu) + `planche17-prose.json`.

**Run 44 : aucun feu posé** (0 candidats). Sonde `tools/__gi-planches/__sonde-rampes.mjs` (énumère les rampes autour du
joueur et dit quelle condition de l'élection tombe) : 48 rampes à ±200 tuiles, 18 tuiles 0↔1 (six rampes de trois
tuiles), toutes au coin d'une terrasse ou sur un bord en diagonale — la terrasse plate 5 × 3 exigée n'existe pas là ;
sur la carte entière (1581 × 852) : 333 tuiles de rampe 0↔1, 5 coins stricts, dont 3 ratés par la parité du balayage
(pas 2). Correction dans planches.mjs : avec `GI_RAMPE`, la fenêtre est la carte entière et le balayage au pas 1 ; un
bonus `droit` (la rangée de la marche au palier 1 + la rangée basse au sol bas sur dx ∈ [−5, 5], /22) préfère une
marche droite de part et d'autre de la rampe. Run 45 (`node --import tsx` obligatoire, sinon ERR_UNKNOWN_FILE_EXTENSION
sur balance.ts) : 17 candidats, **feu en (119, 766)**, rampe (117–119, 768), marche droite 19/22, cadre 18.

**Ce que la composition fait de la rampe** (planche14.mjs `composeTerrasse`) : la rampe se dessine sous le voile sur
les rangées 766–767 (les tuiles logiques du plateau) → `R.pied(x, y)` la prend pour une FACE lue à son pied (la tuile de
rampe, palier 0) ; sous O (`facesDosAuFeu`) elle perd la part directe. Deux lectures ajoutées à planche14.mjs, par
suffixe dans `GI_ZFLAMMES` (planches.mjs) : `10p` = la rampe PLEINE (`grilleAvecFalaises(..., { porte: false })` :
les connecteurs ne sont plus des ouvertures) ; `10f` = la rampe PLANCHER (`composeTerrasse(..., { plancher: true })` :
un pixel dont le pied est un connecteur n'est pas une face, il garde la composition C = le champ là où il se dessine).
Run 47 : `GI_ZFLAMMES=10,24,10p,10f` → O, O2, O3 (pleine), O4 (plancher) ; la page montre r0 / dP / dO / dO3 / dO4.

**PUBLIÉE** : https://claude.ai/code/artifact/c725d4b1-7c19-443c-b5c7-44dc7de53f11 (🪜🔥, « Run 47 — rampe face,
pleine, plancher »). Chiffres (boite.mjs sur le run 47, sol sous le voile) — rampe / plaine devant / plaine à l'est /
paroi est : aujourd'hui 96 / 67 / 65 / 70 ; à plat 102 / 93 / 77 / 73 ; O face + porte 59 / 93 / 66 / 49 ; O pleine
64 / 65 / 66 / 49 ; O plancher 112 / 93 / 66 / 49. Reco : **la rampe plancher, la porte ouverte**. LG-Q1 reposée avec
→ « Voir d'abord » → « L'ombre de lune de la marche » (Alexis, 2026-09-16).

## Planche 18 — L'ombre de lune de la marche (2026-09-16)

La même terrasse (le coin de la planche 17), SANS feu, la lune seule à 22 h 30 : la marche porte-t-elle une ombre de
lune sur la plaine, et la rampe la coupe-t-elle ? La lune jugée en hauteur comme le feu. Harnais généralisé pour ça :
- `GI_LUNE=1` (planches.mjs) : l'élection tourne comme d'habitude, le joueur est téléporté sur la tuile élue, mais
  aucun feu n'est posé (`tuile = c; break` avant `debug_grant`/`place_campfire`) — journal « scène SANS feu, centrée
  en (119, 766) ». planche14.mjs tolère `feu = null` : toutes les passes de feu valent `dNul`, `grilles.json`/parPixel
  portent `feu: null`, l'orientation des faces n'est pas calculée.
- Suffixes de `GI_ZFLAMMES` (regex `/[pflm]+$/`) : `p` rampe pleine, `f` rampe plancher, `l` lune seule (`light = null`
  dans `champM`/`parts`), `m` la marche lanceuse. Run 48 : `GI_ZFLAMMES=10l,10lmf,10lmp` → O (sans marche), O2 (marche
  + porte + plancher), O3 (marche pleine).
- `planche14.mjs grilleAvecFalaises(d, gr, R, { sens, hauteurs, porte })` : chaque bande de falaise porte `bas`, `haut`
  et `hauteurPx = (haut − bas) × 16` ; `astre.mjs lanceurs(..., { marches })` prend ces bandes comme lanceurs
  (longueur = 0,4 × hauteurPx / 4 texels) ; `ombreDAstre(..., { marches })` ne fait ombrer une bande de falaise que sur
  les texels dont le palier est < `m.haut`, une bande de falaise non lanceuse est transparente aux rayons (les murs les
  arrêtent comme avant — la première version laissait passer les rayons par TOUT lanceur de longueur 0, corrigé).
  `SO = max(marches.S, arbres.S)`.
- Page : `planche18-page.mjs <html> <run48>` (dérivée de la 17 ; section « lune », vues r0 / dO / dO2 / dO3, loupes
  marche / rampe / terrasse ; gardes « le centre de la scène » sans feu) + `planche18-prose.json`. Feuilles dans
  `feuilles48/`. Mesures : `boite.mjs` (fin de boîte EXCLUSIVE : une rangée = `ty,ty+1`) et un profil vertical par
  rangée d'écran (`profil.mjs <run> p16 <tx0,ty0,tx1,ty1> r0 dO dO2 dO3`, scratch).

**Ce que le run 48 montre** (luminance moyenne du sol sous le voile, aujourd'hui / sans marche / marche + porte /
marche pleine) : le pied de la marche à l'est, 1re rangée 52 / 53 / 42 / 42, 2e rangée 65 / 65 / 61 / 61, 3e 62
partout ; la paroi à l'est 36 / 36 / 28 / 28 ; la rampe 54 / 54 / 54 / 41 ; la plaine devant la rampe 46 / 46 / 45 / 35 ;
la plaine loin 58 partout. Lecture : (1) le champ de la spec telle qu'écrite (la marche n'est pas un lanceur) rend
l'image d'aujourd'hui, à un cheveu près ; (2) l'ombre de marche jugée en hauteur (12,8 px pleine + 8 px de pénombre,
cisaillée −0,77 texel par rang) a la force et la taille de l'ombre de contact que cliff-layer PEINT aujourd'hui (un
sixième de moins sur la 1re rangée ; l'ombre du champ seule : un cinquième, un dixième sur la 2e) — elle penche avec
l'heure et s'arrête aux colonnes de la rampe ; (3) la paroi s'assombrit d'un cinquième avec son pied, dans sa propre
ombre (« une face lit son pied ») ; (4) la rampe pleine ferme la porte. ⚠ La composition part du rendu du jeu : l'ombre
peinte est dans les quatre rendus, elle se superpose à l'ombre du champ sous « marche + porte » ; dans le jeu, le champ
la remplacerait (Q5). Le plateau ne change pas (peint au-dessus du voile).

**PUBLIÉE** : https://claude.ai/code/artifact/759e9169-73da-4783-93c1-d941939127db (🌙🧱, « Run 48 — lune seule,
marche lanceuse »). Reco : **la marche porte son ombre d'astre comme un mur de sa hauteur, la rampe ouverte** — l'ombre
peinte devient une conséquence de la règle. LG-Q1 reposée avec → « Voir d'abord » → « Le feu et la lune ensemble, et la
paroi » (Alexis, 2026-09-16).

## Planche 19 — Le feu et la lune ensemble, et la paroi (2026-09-16)

La scène de la planche 17 (le feu en (119, 766), la rampe en (117–119, 768), `GI_SCENE=terrasse GI_RECUL=2 GI_RAMPE=1
GI_JOUEUR=astre GI_PROFIL=run36 GI_P16=1`), la règle recommandée entière : `GI_ZFLAMMES=10f,10mf,10mfh` → O (rampe
plancher, la lune sans ombre de marche = le rendu recommandé de la planche 17), O2 (+ la marche lanceuse d'ombre d'astre =
la planche 18, la paroi lit son pied dans sa propre ombre), O3 (+ `h` : la paroi lit son pied HORS de l'ombre de marche).
Harnais : suffixe `h` de `GI_ZFLAMMES` (planches.mjs, `paroiHorsOmbre`) ; planche14.mjs calcule pour ce champ `Mpied =
champM({ S sans marches })` et `composeTerrasse(..., { plancher, champPied })` lit le pied d'une face dans `champPied`
quand il est donné (le pixel garde son champ ; stat `piedsHorsOmbre`). Page : `planche19-page.mjs <html> <run49>` (dérivée
de la 18 : section « ensemble », vues r0 / dO / dO2 / dO3, loupes marche / rampe / feu, gardes du feu de la 17) +
`planche19-prose.json`. Feuilles dans `feuilles49/`. Run 49 : 253 s, exit 0.

**Ce que le run 49 montre** (luminance moyenne du sol sous le voile, aujourd'hui / O plancher / O + marche / paroi hors
d'ombre) : la rampe 87 / 105 / 105 / 105 ; la plaine devant la rampe 55 / 77 / 76 / 76 (1re rangée), 64 / 81 / 81 / 81
(2–4 tuiles) ; le pied de la marche à l'est, 1re rangée 55 / 54 / 43 / 43 ; la paroi à l'est 42 / 37 / 29 / 36, à l'ouest
46 / 37 / 29 / 37 ; la plaine à l'est à 2–4 tuiles 66 / 65 / 64 / 64 ; loin 59–60 partout. Lecture : l'ombre de lune de la
marche ne touche que la part de la lune (rampe, éventail, arbre, roches identiques dans les trois O) ; au pied des parois
elle se pose sur l'ombre peinte, penchée, coupée par la rampe ; la paroi perd un huitième sous O (le feu derrière l'arête)
puis un cinquième avec son pied dans l'ombre de la marche — « hors d'ombre » la ramène à O plancher : la réserve de la
planche 18 tient dans ce cinquième.

**PUBLIÉE** : https://claude.ai/code/artifact/829985da-a5b2-4b5a-85e1-dd04c52f8443 (🔥🌙, « Run 49 — feu + lune, marche
lanceuse, paroi »). Reco : **la paroi lit son pied dans sa propre ombre** (O + marche, la règle entière sans exception) ;
avec la rampe plancher (17) et la marche lanceuse (18), LG-Q1 en entier : la falaise fait écran à sens unique, jugée en
hauteur. LG-Q1 reposée avec. Runs gardés sur le tmpfs : 36 (profil), 37, 38, 40, 43, 47, 48, 49 (31, 32, 34 purgés).

**TRANCHÉ le 2026-09-16 par Alexis : « La règle entière, la paroi dans son ombre »** — LG-Q1 fermé. Écrit dans la spec :
LG-R14 (la falaise fait écran à sens unique, jugée en hauteur ; la rampe est un plancher, porte ouverte ; la marche
porte son ombre d'astre comme un mur de sa hauteur, l'ombre peinte de cliff-layer disparaît ; une paroi lit son pied
dans son ombre), LG-A15 (les gardes, seuils posés sur les planches), le renvoi dans LG-R7 (O), la ligne du tableau des
planches, les dépendances (`cliff-layer.ts`, `etage-layer.ts`). Ligne de journal due (rendu-da). LG-Q2 (grottes) reste
bloqué par le commit de l'autre session (toujours non commité au 2026-09-16) : la suite est LG-Q4…Q9.

## Planche 20 — La coulée des roches au grain (2026-09-16)

LG-Q4, « Voir d'abord ». Scène neuve `GI_SCENE=roches` (planches.mjs : un amas de socles au palier 0, plat sur ±12 × ±8,
sans eau ni arbre à ±8 × ±5, sans relief à ±10 × ±6, au moins trois socles au cœur ±6 × ±4, les tailles variées comptées
par le hash de `tailleDeSocle` recopié), sans feu (`GI_LUNE=1`), l'avatar au coin du cadre (`GI_JOUEUR=coin`),
`GI_ROCHES=1` → `planche20.mjs`. Harnais : `releve()` rend `roches` (sprites `nd-<type>-<taille>[_lit[_m]]` + silhouettes) ;
`cliche(nom, gi, spr, { sansCoulee })` cache les images `fx-ombre-socle-*` après l'update (le pool les repose à chaque
image, avant ce postupdate) ; `{ coulee: { tuiles, cles } }` échange chaque coulée contre une texture cuite dans la page
(`cuireCoulees` : la géométrie d'`alphaDOmbre` avec une longueur visible par taille, 6 / 8 / 10 px, course 11, 51
textures). astre.mjs : `ombreDesRoches(d, gr, derive, regle)` (la projection des arbres sur les cartes de socle, H =
`EMERGENCE_SOCLE` 16 / 20 / 24, rend les rangs d'ombre pleine par roche). Heures : 14,3 (jour, avant le voile de jour) et
22,5 (nuit). Page : `planche20-page.mjs <html> <run50>` + `planche20-prose.json` (sections jour / nuit, vues r0 / sans /
masque / pixel, loupes amas / t2 / t0 / t1, la table par roche mesurée sur les images : luminance de la première tuile
sous le pied, profondeur de l'ombre visible). Feuilles dans `feuilles50/`. Run 50 : 138 s, exit 0 (10 socles relevés,
7 dans le cadre, preuve du masque 0,02 / 0,16 niveau, 10 coulées échangées).

**Ce que le run 50 montre** : au grain de 4 px, 0,4 × 16 / 20 / 24 = 6,4 / 8 / 9,6 px tombent pour les trois tailles sur
DEUX rangs (rangs du masque 2 / 2 / 2 pour les dix socles) ; l'ombre visible sous le pied : 9,8 px aujourd'hui pour toutes
(8 + 2), 16 px au masque pour toutes (8 pleins + 8 de pénombre), 8 / 9,8 / 12 px au pixel selon la hauteur. Le masque rend
une tache carrée et floue plus large que la pierre (pénombre 8 px de chaque côté), la pente à peine lisible, sans trapèze
— l'auréole du 2026-08-27. La coulée au pixel à la longueur LG-R9 garde le grain, la pente et la pointe et fait lire les
trois hauteurs (la moyenne identique à aujourd'hui, au pixel près : même luminance 102 / 102, même profondeur).

**PUBLIÉE** : https://claude.ai/code/artifact/444ae14d-8e2e-4540-ae44-4741280a082d (🪨☀️, « La coulée des roches au
grain »). Reco : **la couche au pixel, à la longueur LG-R9 (6 / 8 / 10 px)** — une loi de longueur, deux grains. LG-Q4
reposée avec (spec : sous-puce LG-Q4 + ligne du tableau des planches). Runs gardés sur le tmpfs : 36 (profil), 37, 38,
40, 43, 47, 48, 49, 50.

**TRANCHÉ le 2026-09-16 par Alexis : « Au pixel, longueur LG-R9 »** — LG-Q4 fermé. Écrit dans la spec : **LG-R15** (les
roches gardent leur coulée au pixel, telle quelle ; seule sa longueur suit LG-R9, 0,4 × EMERGENCE arrondi au pixel = 6 /
8 / 10 px, LONGUEUR 10 / 12 / 14 ; la course du cisaillement inchangée, 8/7 px par rang visible, texture élargie ; un
socle n'est pas un lanceur du masque ; la coulée assombrit aussi la lueur du feu, asymétrie héritée non montrée ; ce que
ça touche : ombre-socle.ts, contact-shadow.ts, snapshot-view.ts — indépendant du champ, hors des fichiers de l'autre
session, faisable avant la GI), **LG-A16** (la garde d'aujourd'hui sur 3 tailles × 17 crans, la taille 1 au bit près,
la profondeur 8 / 9,8 / 12 px sur la scène du run 50), la ligne du tableau, LG-R9 (la ligne « bloc »), LG-R8 et LG-A9
(un socle n'est pas un lanceur), le statut (six points restent : LG-Q2, Q5 à Q9). Ligne de journal due (rendu-da).
**LG-Q5 semble déjà couvert par LG-R7 amendé** (« un occludeur lit CHAQUE PART sur sa face la mieux exposée à SA
source », planche 9, run 31 — c'est le défaut du run 18 que LG-Q5 relève) : proposé à Alexis comme fermeture → « Voir
d'abord » → planche 21. Puis LG-Q6 (la respiration), LG-Q9 (la chaleur recentrée), LG-Q7 (le budget, sans iGPU ici),
LG-Q8 (multi).

## Planche 21 — La face sous deux lumières (2026-09-16)

LG-Q5, « Voir d'abord » (la fermeture proposée : couvert par LG-R7 amendé). Pas de scène neuve : **run 43** (planche 16,
`GI_SCENE=murs GI_SUD=1`, gardé sur le tmpfs) fournit aujourd'hui / C (`p16-nuit-c-tout`, la face jugée sur le champ
entier = la règle du run 18, à plat, Light2D éteint) / E (`dE`) / O (`dO`, LG-R7 final) ; **run 51** = la planche 3
rejouée sur la même scène avec le mur sud (`PLAYWRIGHT_BROWSERS_PATH=0 GI_SCENE=murs GI_SUD=1 GI_JOUEUR=astre
GI_ASTRES=1 … planches.mjs run51`, 281 s, exit 0) : `a-nuit-sans-tout` / `a-nuit-avec-tout`, chaque sprite d'aujourd'hui
multiplié par le rapport du champ lu à son pied, les facteurs par sprite dans `a-donnees.json` (`nuit.vus.sans/avec`).
Les deux runs ont LA MÊME caméra (worldView 6315,6 ; 1192, zoom 2,25) : la caméra ne suit pas l'avatar, les loupes sont
identiques. Page : `planche21-page.mjs <html> <run43> <run51>` + `planche21-prose.json` (sections murs / run18, loupes
nord / est / ouest / sud / salle, la table par pan : luminance des sprites du run 43 par rendu, facteur sans/avec du
run 51 + luminance de la boîte). Feuilles dans `feuilles51/`.

**Ce que les runs montrent** : le défaut du run 18 est réel et petit — pans nord 0,993 → 0,981 avec l'ombre de lune,
est 0,993–0,995 → 0,972–0,987, ouest inchangés (leur ombre tombe dehors), sud 0,71 → 0,55 (son sprite est ancré au bas
de sa tuile, UNE TUILE AU SUD de sa ligne : la rustine lit son pied de l'autre côté de la ligne, dans sa propre ombre —
**note pour la construction : le pied d'un mur est sa ligne, pas le bas de sa tuile**). À l'œil, sans et avec sont la
même image sur les pans nord et est (boîte du pan nord à 0,3 niveau près) : la lueur du feu couvre l'ombre de lune à
leur pied. Sous O, les pans nord et est sont éclairés par le feu comme aujourd'hui, un peu plus clairs (nord 78 / 65 /
74 contre 74 / 68 / 72), avec le dégradé ; C rend des pans plats (p10–p90 60–100 contre 34–126) et le mur du sud noir
(24) — la forme plate de la planche 7, pas LG-Q5 ; O contre E ne change que le mur du sud (32–35 contre 64–67) et les
pans de côté au sud du feu (75 / 50 contre 102 / 79) — la règle des faces de la planche 16.

**PUBLIÉE** : https://claude.ai/code/artifact/98350d90-c741-4591-83f7-12a3300e303a (🧱🌕, « La face sous deux
lumières »). Reco : **fermer LG-Q5, couverte par LG-R7 amendé** (chaque part sur sa face la mieux exposée à SA source).
LG-Q5 reposée avec (spec : sous-puce LG-Q5 + ligne du tableau des planches). Runs gardés sur le tmpfs : 36 (profil),
37, 38, 40, 43, 47, 48, 49, 50, 51.

**TRANCHÉ le 2026-09-16 par Alexis : « Fermer, couvert par LG-R7 »** — LG-Q5 fermé sans règle neuve ; la note « le
pied d'un mur est sa ligne » écrite dans LG-A9 ; la ligne du tableau ; le statut (six points restent : LG-Q2, Q6 à
Q10). Ligne de journal due (rendu-da). **En fermant, Alexis remarque : « la partie supérieure des murs correspond à
une bande qui fait face au ciel et ne devrait être éclairée que par la lune, non ? »** → **LG-Q10** écrit dans la spec
(le dessus des corps regarde le ciel). Les faits (bati-art.ts) : un mur est-ouest = une coiffe au ton du dessus (EP px,
à la crête, MUR_HT 32 px au-dessus de sa ligne) + une face de 32 px ; un mur nord-sud = un RUBAN entier au ton du
dessus, sans face (« le haut des murs uni », la tranche éclairée comme le sommet) ; la flamme à 10 px est sous toute
crête. Sous E/O la coiffe lit le sol sous ses pixels (derrière le mur nord : la lune seule, par accident ; dans le coin
pour les rubans : le feu). Reco à poser : « Voir d'abord » — une planche 22 sur la scène du run 43 (O ; O + coiffes sous
la lune seule ; O + coiffes et rubans sous la lune seule), par un calque recadré par sprite dans la rustine (Light2D
éteint, teinte M de la lune seule, forme C). *(La méthode réelle a été autre : voir la planche 22.)*

## Planche 22 — Le dessus sous le ciel (2026-09-16)

LG-Q10, « Voir d'abord ». **Pas de run neuf, pas de calque** : la composition par pixel de la planche 9 connaît déjà le
dessus d'un mur (`pointAuSol`, MUR_HT au-dessus du bas du cadre), donc **`recomposer22.mjs <run43>`** recompose hors jeu,
depuis les passes réelles du run 43 (`d-plat-o` / `d-astre-o` / `d-feu-o` sommées = la base O, les identités `d-id0..9`,
`d-astre-brut` / `d-feu-brut`, les grilles O de `p16-nuit-grilles.json`), le rendu O puis deux variantes par un crochet
neuf de `composerParPixel` (planche9.mjs, paramètre `sansFeu(s, xw, yw)`) : **dOc** = la coiffe des murs est-ouest
(`-e1_`/`-e4_`, le test de `pointAuSol`) perd la part directe du feu (pf = 0) ; **dOr** = la coiffe ET le ruban entier
des murs nord-sud (`-e2_`/`-e8_`). **Garde** : le O recomposé (crochet nul) doit valoir `p16-nuit-dO.rgba` au canal
près — 0 canal différent, le script jette sinon. **Piège corrigé** : un dessus composé en « base − corpsD + corpsE »
tournait au SARCELLE sur les rubans (79 pixels négatifs) : la base du run était écrêtée à 255 là où le feu flambait,
et retirer la part entière du feu passait sous zéro → un dessus (opaque) se refait ENTIER depuis ses parts
(`val = corpsE`), 0 négatif. Le seuil du dessus tombe exactement sur le bord de la coiffe (4 rangs = `EP`, 8 rangs
d'écran) : le rang clair dessous est le premier rang de la face (sonde par rangs, run 43, pan nord du milieu). Sorties :
`run43/p16-nuit-dOc.{png,rgba}`, `p16-nuit-dOr.*`, `run43/p22-donnees.json` (par sprite, et pour les murs `dessus` /
`face` à part par propriétaire du pixel). Page : `planche22-page.mjs <html> <run43>` + `planche22-prose.json` (une
section murs, r0 / dO / dOc / dOr, loupes crete / nord / est / ouest / sud / salle, la table par pan dessus / face /
sprite entier). Feuilles dans `feuilles22/`.

**Ce que la recomposition montre** : sous O la coiffe des murs du fond est plus claire que leur face (108 / 103 / 110
contre 57 / 62 / 56) — Light2D l'allume par le feu dans ses parts ; les rubans lisent le coin (est 121 / 181). dOc : la
crête gris de lune (58), la face inchangée, mais le cadre du coin a un haut sombre et des côtés clairs. dOr : tout le
haut des murs au même gris de lune (rubans est 38 / 37, ouest 62), le coin un cadre sombre autour de la lueur, qui ne
sort plus que par la porte et par le sud ; murs en famille 74 → 70 (dOc) → 42 (dOr). Le mur du sud ne change presque
pas (coiffe 43–48 → 35–36).

**PUBLIÉE** : https://claude.ai/code/artifact/03ef813d-81a8-45f3-91fe-e1b7926f5598 (🧱🌙, « Le dessus sous le
ciel »). Reco : **la coiffe ET les rubans sous le ciel** — le dessus prend la part des astres seule, jamais la part
directe du feu ; si un mur de côté paraît trop éteint, c'est à l'art de lui rendre une tranche (que la règle
éclairerait comme une face), pas à la GI de la deviner ; même règle pour le dessus des meubles et le plat des socles
dès que l'art les distingue. LG-Q10 reposée avec (spec : sous-puce LG-Q10 + ligne du tableau des planches).

**TRANCHÉ le 2026-09-16 par Alexis : « La coiffe et les rubans sous le ciel »** (la recommandation) → **LG-R16** (le
dessus se compose de sa part plate et de sa part des astres seules, la part directe du feu nulle ; la face garde
LG-R7 ; une tranche éteinte est une question d'art) et **LG-A17** (les seuils de la planche 22 : coiffe du fond ≤ 65,
rubans est < 45, murs en famille 42 ± 4, la face à 2 niveaux près, un dessus identique feu allumé / éteint) ; la ligne
du tableau ; le statut (cinq points restent : LG-Q2, Q6 à Q9). Ligne de journal due (rendu-da).

## LG-Q6 — La respiration (2026-09-16)

Posée SANS planche (un mouvement ne se montre pas en image fixe ; « Voir d'abord » était offert, aux deux extrêmes du
battement). Les faits : aujourd'hui trois choses battent au même `flicker`, même graine — la flamme, la flaque (alpha
seulement, « jamais par la taille », `fire-ground-glow.ts`) et le trou du voile (en RAYON : `fireHoleRadius` = 6 tuiles
× l'étalon 0,83–1,18) ; `fireGlow` a deux battements délibérés (l'alpha prend la variante `flickerV`, le rayon garde
l'étalon). Options : la force seule (reco, par cohérence avec LG-R6 « K : la force seule » et la crainte du grain qui
grouille), la force et la portée, pas de respiration dans le champ, voir d'abord. **TRANCHÉ par Alexis : « La force et
la portée »** — le look d'aujourd'hui (la clairière qui respire) reconduit dans le champ, le trou en moins. Écrit :
LG-R6 amendé (la force prend le battement de l'alpha d'aujourd'hui, la portée celui du rayon ; condition : la
décroissance atteint zéro sans marche à la portée, sinon le bord grouille au grain de 4 px), LG-A7 complété (creux /
crête : texels touchés dans le rapport du carré du battement à 10 % près ; ≤ 2 niveaux par image à 60 Hz ; même graine
— seuils de moi), le statut (quatre points restent : LG-Q2, Q7 à Q9). Ligne de journal due (rendu-da).

## LG-Q9 — La chaleur recentrée (2026-09-16)

Posée sans planche (rien à voir : la bulle de chaleur de `fireBubble` part du coin nord-ouest de la tuile du feu, le
trou du voile de son centre ; Q5 recentre la lumière de la sim de toute façon). Options : recentrer la chaleur aussi
(reco : une simulation, un seul centre), la lumière seule, mesurer d'abord (le banc avant/après). **TRANCHÉ par
Alexis : « Recentrer la chaleur aussi »** → **LG-R17** (`fireBubble` depuis (tx + ½, ty + ½), la loi inchangée ;
touche `/sim` seul, avec Q5 dans le même commit ; le banc à rejouer et relire ; les tests lisent la bulle à zéro ou au
centre déjà) et **LG-A18** (symétrie de la bulle autour du centre ; lumière et chaleur nulles aux mêmes points ; le
banc relu, pas gardé) ; le statut (trois points restent : LG-Q2, Q7, Q8). Ligne de journal due (gameplay-systemes).

## LG-Q7 — Le budget par image (2026-09-16)

Posée sans planche. Les faits : la GI supposée (15 passes au grain) coûte 0,049 ms/image sur la RTX 4070 (banc,
MESURÉ) ; aucun GPU intégré mesuré (cette machine n'a pas de GPU) ; le banc publié mesure le GPU de qui l'ouvre.
Options : 2 ms sur GPU intégré (reco), 4 ms sur GPU dédié, les deux seuils, pas de seuil avant une mesure. **TRANCHÉ
par Alexis : « Les deux seuils »** → LG-A14 complété (2 ms intégré, 4 ms dédié, chaque machine sa gate selon sa
classe ; ma lecture : la gate intégrée reste NON MESURÉE tant qu'aucun GPU intégré n'a ouvert le banc) ; le statut
(deux points restent : LG-Q2, Q8). Ligne de journal due (rendu-da).

## LG-Q8 — La torche d'un autre corps (2026-09-16)

Posée sans planche. Les faits : `clarteSurSoiAt` (`nuit.ts`) rend 1 au porteur d'une torche vive et ignore les torches
des autres ; à l'écran, une torche éclaire tout autour (`torche-ground-glow.ts`, Light2D, `TORCHE_MAX` 4) ; en multi,
l'écran serait plus clair que la sim sous la torche d'un autre (N2bis rompu, la parade refusée dans une lumière
visible). Options : la sim voit toutes les torches (reco), l'écran suit la sim, reporter à la phase LAN. **TRANCHÉ par
Alexis : « La sim voit toutes les torches »** → **LG-R18** (le MAX avec le ciel et les feux ; à plein sur le porteur,
une bulle linéaire jusqu'à `TORCHE_LIGHT_TILES` pour les autres, à l'étage du porteur, la part visible de la source
étendue dès que la sim l'a pour les feux ; le périmètre reste les avatars, N6) et **LG-A19** (mondes jumeaux à deux
avatars : la parade rendue à portée, refusée au-delà, au bit près ; un PNJ porteur n'éclaire personne ; la chaleur
inchangée, I3). **La spec est entière, sauf LG-Q2 (les grottes, après le commit de l'autre session).** Ligne de journal
due (gameplay-systemes).

## La sim d'abord — le module `lumiere.ts` (2026-09-16)

La spec entière, une question : par quelle brique commence la construction ? Trois options — la sim d'abord (reco :
c'est la loi dont tout dérive, sans navigateur, testée en unitaire, et la seule qui change le jeu), la GI du client
en worktree, la coulée des roches (LG-R15, indépendante). **Alexis : « La sim d'abord »**. Écrit dans `/sim`, non
commité :

- **`packages/sim/src/lumiere.ts`** (neuf) — la loi d'occultation de LG-R10 à LG-R12, MIROIR de l'oracle des planches
  (`tools/__gi-planches/gi-ref.mjs`, `compose.mjs` `grille`) : grille de 4 texels par tuile (`LUMIERE.TEXELS_PAR_TUILE`,
  centres en +½ — le centre d'une tuile EST un coin de texel), occludeurs = terrain plein (VOID, ROCK, WALL, GLACIER,
  CLIFF, CENDRE_MIN), nœuds à tronc (`tree`, `old_tree` : les 2×2 texels du centre) et pleins (`rock`, `bloc`,
  `iron_vein`, `coal_seam`, `quarry`, `rubble`), bâti plein sans arête (`wall`, `palissade`, `braise_mere`, `door`,
  `house`, `mur_bas` — `fire` n'est PAS opaque), et les murs d'arête en BANDES d'un texel centrées sur l'arête, débord
  d'un demi-texel à chaque bout, coupées à intervalles OUVERTS (`coupeBande`) ; traversée Amanatides–Woo
  (`segmentBloque`, départ et arrivée exclus, égalité → y d'abord, comme l'oracle) ; source = disque de 1,5 texel
  (`LUMIERE.SOURCE_RAYON_TEXELS`) échantillonné par la table `MOTIF_SOURCE` (16 littéraux de la spirale de Vogel, LG-R4 —
  `cos`/`sin` interdits dans `/sim`) ; **`partVisible(monde, niveau, rx, ry, sx, sy)`** = rayons non bloqués / 16.
  Les occludeurs se lisent À L'ÉTAGE DU RÉCEPTEUR (`etage ?? palierDuSol`) : une terrasse voit les tuiles du sol en
  VOID — c'est l'écran à sens unique de LG-R14 vu de la sim (un corps sur la terrasse ne prend plus la lumière d'un feu
  au sol ; la lumière qui descend est l'affaire du client). **`lumiereDesTorches`** (LG-R18) : le MAX, sur les avatars
  vivants (jamais un PNJ ni un monstre, N6) qui tiennent une torche vive au MÊME niveau (`niveauDuCorps`), d'une bulle
  linéaire jusqu'à `LUMIERE.TORCHE_PORTEE_TUILES` (10, = `TORCHE_LIGHT_TILES` du client) × la part visible.
  `MondeEclaire` accepte la façade du client (`EtatGel` : ni `entities`, ni `nodes`, ni `npcs` — alors zéro torche, et
  seuls le terrain et le bâti occultent).
- **`nuit.ts`** — `lumiereDuFeu` = `bulleDuFeu × partVisible` (le plus clair VU l'emporte, pas le plus proche
  caché) ; `clarteSurSoiAt` = max(ciel, feu, torches des autres) ; la signature ne bouge pas (`WorldScene.ts:3055`
  l'appelle tel quel : la prédiction du client suit d'office, N1bis).
- **`temperature.ts`** — **`bulleDuFeu(state, s, x, y)`**, la bulle d'UN feu depuis le CENTRE de sa tuile (LG-R17,
  « Recentrer la chaleur aussi ») ; `fireBubble` la lit. La loi ne change pas, son centre si : un corps à la même
  distance a la même chaleur de tous les côtés (LG-A18, F4).
- **`balance.ts`** — `LUMIERE { TEXELS_PAR_TUILE: 4, SOURCE_RAYON_TEXELS: 1.5, TORCHE_PORTEE_TUILES: 10 }`.
- **`index.ts`** — exporte `MOTIF_SOURCE`, `partVisible`, `lumiereDesTorches`, `bulleDuFeu`, `LUMIERE`, `MondeEclaire`.
- **`lumiere.test.ts`** (neuf, 20 verts) : M1 (le motif), V1–V10 (champ libre, bande ouverte, pénombre en PART et
  monotone, les quatre arêtes, le fût contre la cime, roche et terrain contre l'eau, l'étage du récepteur, la règle du
  coin — une source PILE sur des coins de texels termine et rend toujours pareil, un seizième et non zéro parce qu'un
  point du disque passe sous le débord de la bande —, rien d'écrit dans l'état), F1–F5 (nuit aveugle : on ne pare plus
  derrière un mur, la chaleur au bit près avec et sans mur, la bulle depuis le centre, deux feux), T1–T4 (torche à
  portée / au-delà, arrêtée par un mur et sans chaleur, la torche d'un PNJ n'éclaire personne, autre étage et façade
  sans entités).
- **`tools/eslint-regle-etage.mjs`** — deux sites triés HORS_REGLE avec leur raison (E-A3) : `temperature.bulleDuFeu`
  (géométrie pure, le scellement vit à ses deux appels, qui font `auMemeEtage`) et `lumiere.lumiereDesTorches` (son
  propre filtre `niveauDuCorps(e) === niveau`, LG-R18 ; pas E-R5 — la lumière ne suit pas les rampes, elle suit LG-R14).
- **`grottes.test.ts`** — G-A5 « un bivouac ne change rien à l'air » rougissait par LG-R17 : le test lisait la
  chaleur AU CENTRE de la tuile du feu (14 > 13), là où aucun corps ne se tient (le feu bloque sa tuile). Réaligné sur
  l'arête, au plus près qu'un corps s'en tienne : 14 × (1 − 0,5/6) = 12,8 < 13, la promesse tient. ⚠ Le chiffre
  « 12,3 °C à la demi-tuile » de `grottes.md` G-R5 (fichier de l'autre session) et du commentaire de
  `GROTTE_AMBIANT` (corrigé) est périmé : **12,8 à l'arête** — à porter dans `grottes.md` après son commit.

**Vérifié** : `tsc --noEmit` sim 0, eslint 0 sur les fichiers touchés, `lumiere.test.ts` 20/20, `nuit` 21, `torche`
15, `fire` 27, `meteo` 87, `temperature` 23, `cendreux` 49, `etages-etancheite` 45, `grottes` 72 (après le
réalignement). **Revue `determinisme-sim` (LG-A13), rendue le 2026-09-16 : FUSIONNABLE.** MESURÉ : eslint et tsc à 0,
seuls `floor/min/max/abs/sqrt` dans `lumiere.ts`, aucun `rng`/`Date`/`performance`, itérations sur des tableaux
seulement (les trois `Set` de module sont immuables, servis par `.has()`), `segmentBloque` ne fait que `+ − × ÷`,
`abs`, `floor` et des comparaisons (`Infinity` se propage proprement, la garde majore le nombre de cellules, un NaN
d'entrée ne boucle pas), `coupeBande` ouvert par des stricts et un epsilon en unités de paramètre (tolérance, pas
équilibrage), les littéraux de `MOTIF_SOURCE` (≤ 8 chiffres) s'arrondissent identiquement sur tout moteur (ECMA-262),
`sim.ts` intact (rien dans `SimState`), lectures pures (V10 dit vrai), aucun tirage ajouté — LG-R17 change des VALEURS
(des branches `fireBubble > 0` peuvent basculer sur un enregistrement d'avant), pas un site de tirage. Remarques :
(1) `sim.test.ts`, `replay.test.ts`, `events.test.ts` ne posent ni feu ni torche → `partVisible` n'y passe jamais ; un
test de mondes jumeaux avec feu, mur d'arête et torche portée le couvre (F7, ajouté à `lumiere.test.ts`) ; (2) le tronc
`sx ∈ [1, 2]` figeait T = 4 → dérivé de `T` ; (3) `fireBubble` associe désormais `FIRE_WARMTH × (facteur × (1 − d/R))`
et non `(FIRE_WARMTH × facteur) × (1 − d/R)` — pas bit-identique à l'ancienne valeur pour un facteur non dyadique, sans
importance puisque le centre bouge ; (4) coût SUSPECTÉ : `partVisible` n'est appelé que par `clarteSurSoi` (une fois
par input d'avatar par tick, jamais par PNJ) et par le client (une fois par image), ~0,05–0,2 ms par avatar-tick,
1–4 ms/tick à vingt avatars — mesurable, pas dégradé ; si `perf` rougit, relever la fenêtre `contexte` une fois par
appel plutôt que par source ; (5) **la façade du client (`etat-gel.ts`) n'a ni nœuds ni entités** : la prédiction
ignore fûts, blocs et torches des autres → elle peut être PLUS CLAIRE que l'autorité derrière un fût, le sens interdit
de N2bis — **passer les nœuds dans la façade** est la première chose de la brique client.
**La suite `/sim` entière, jouée le 2026-09-16** : 2 431 verts, 2 ignorés, 7 rouges — cinq timeouts de cache froid
(session, glanage, terrasses ×2, envol), rejoués verts sur le cache chaud (94/94) ; et **deux échecs de
`charniers.test.ts` qui ne sont pas de ce diff** : « la vallée de production porte toujours ses 138 autres lieux »
(172 lieux au lieu de 157) et « le Charnier XLVIII est trop près du centre de la Source » (450,5 < 1 024) — identiques
sur le HEAD propre `eae4d2d` du worktree, avec et sans cache de cartes (`ASHES_SANS_CACHE=1`) : un test périmé par les
grottes de plancher (43-55 Grottes par carte), du ressort de l'autre session. **F6** (LG-A11 sur `step()`, le patron
de P5) et **F7** (LG-A13 : deux mondes à feu, mur d'arête et torche portée rejouent au bit près sur 40 ticks) ajoutés :
`lumiere.test.ts` 22/22, eslint 0, tsc 0 ; `pnpm check` (sim, client, serveur) 0 et `pnpm lint` (tout le dépôt) 0.
**COMMITÉE le 2026-09-17 : `f53a38c`** (Alexis : « Commit /sim, puis la GI du client » ; `git commit --only` sur les
onze fichiers de la brique, l'index de l'autre session intact ; la ligne de journal `gameplay-systemes.md` reste due à
son commit). Le worktree `wt-gi` est déplacé sur `f53a38c` (vite :3140 répond) : la brique client commence là. **LG-A12, la moitié « la loi de /sim
est celle de l'oracle », MESURÉE le 2026-09-16** : `tools/__lumiere-vs-oracle.mts` (jetable) rebâtit le monde de /sim
depuis le relevé du run 43 (`p16-nuit-releve.json` : terrain, nœuds, bâti avec ses arêtes) et compare `partVisible`
à `traverse` de `gi-ref.mjs` sur la grille de `compose.mjs`, texel par texel, à portée du feu — **0 texel différent
sur 1 804** (1 432 dans l'ombre, 108 en pénombre, 264 en pleine vue : la scène occulte pour de bon), avec la source au
centre de la tuile (un coin de texel, le cas que N1bis flaggait), décalée d'un quart, d'un tiers de texel ; et 0
texel différent aussi contre la spirale de Vogel calculée en cos/sin par l'oracle — les littéraux à 7 décimales de
`MOTIF_SOURCE` ne coûtent rien. Le run 34 (la lisière) n'est plus sur le tmpfs ; la seconde scène reste à relever le
jour où l'écran existera (l'autre moitié de LG-A12 — l'ÉCRAN contre la sim — attend la GI du client).

**Ce que ça change, à dire à Alexis si ça se voit** : (1) en nuit aveugle, on ne pare plus dans l'ombre d'un mur ni
d'un fût (Q5 — voulu) ; (2) la chaleur d'un feu s'est décalée d'une demi-tuile vers le sud-est (LG-R17 — voulu ; les
bancs se relisent sans gate, les replays d'avant ne rejouent plus au bit) ; (3) un corps sur une TERRASSE ne prend
plus la lumière d'un feu au sol dans la sim (conséquence de « les occludeurs à l'étage du récepteur », dans le sens de
LG-R14 : rien ne monte) — pas décidé explicitement, à montrer si un playtest le rencontre ; (4) la torche d'un autre
avatar compte (LG-R18). **Pour le client, ensuite** : `render/torche.ts` importe `LUMIERE.TORCHE_PORTEE_TUILES` au lieu
de sa constante `TORCHE_LIGHT_TILES` (doublon aujourd'hui), et la GI dérive son masque de `MOTIF_SOURCE` et des mêmes
occludeurs — « la loi reste dans /sim, ici on la MONTRE ».

## `nuit-noire.md` amendée (2026-09-16)
Fait, AVANT le code de `/sim` (rien n'est écrit dans `/sim`) : un bandeau « amendée deux fois » en tête ; **N1bis** (la
lumière du feu s'arrête aux murs dans la sim aussi : bulle linéaire × part visible de la source étendue de la GI,
table de 16 points, un prédicat d'occultation dans `/sim` dont le masque de l'écran se dérive, chaleur et prédiction
inchangées, ni rebond ni ombre d'astre, la pénombre = celle de la GI, le cas du coin de texel ; renvoie à LG-R11 à
R13 et laisse LG-Q9 ouvert) ; N2bis étendu au feu (LG-R13) ; **N4 barré** (sorti le 2026-09-02, la citation
d'Alexis, le pourquoi du journal), N5 « la seule chose que le noir prend » ; le « pourquoi ces deux capacités »
relu ; P2 à P4 retournées ; les critères à venir (LG-A11 à A13) ; le bandeau de refus tel qu'il est
(`WorldScene.ts:3559`). La revue `determinisme-sim` vient AVEC le code, pas avant : il n'y a rien à relire.

## La brique client — tranche A, la loi lue par le client (2026-09-17)

Alexis : « Commit /sim, puis la GI du client ». Worktree `wt-gi`, **branche `gi-client`** (depuis `f53a38c`, vite
:3140). La brique se coupe en quatre tranches : **A** pure (sans navigateur — ce que l'écran lira, prouvé égal à la
sim avant qu'un shader existe), **B** la chaîne GPU derrière un interrupteur, **C** la composition dans le voile
(LG-R5), **D** les astres, les corps, les paliers, le dessus et la coulée. La tranche A, écrite et vérifiée le
2026-09-17 :

- **`packages/sim/src/lumiere.ts`** — `occlusionAuGrain(monde, niveau, x0, y0, x1, y1)` : le RASTER des sortes
  d'occludeur (`OCCLUDEUR` LIBRE / TERRAIN / TRONC / NOEUD / BATI, un `Uint8Array` de (x1−x0+1)×T par (y1−y0+1)×T,
  origine `ox = x0×T`, `oy = y0×T`) et les bandes des murs d'arête (`Bande` porte désormais son `type`, pour l'albédo),
  lus par la même `sorteDuTexel` que `partVisible` (`texelPlein` en dérive) — la sim dit à l'écran où sont les murs, il
  n'y a pas de seconde lecture. Tests O1–O3 (chaque sorte à sa place — terrain, fût 2×2, nœud plein, bâti, bande —,
  chaque texel plein du raster arrête un rayon qui le vise, l'étage −1 d'une carte plate est VOID partout donc TERRAIN
  partout et le bâti du sol y est masqué) : `lumiere.test.ts` 25/25.
- **`packages/client/src/render/gi/reglages.ts`** — `GI` (grain et taille de source DÉRIVÉS de `LUMIERE`, teinte de
  feu, rebond 0,9, portée 12, plafond 0,2 : les réglages G2 de la planche 3) et `ALBEDO` par sorte (les tables de
  `compose.mjs` : terrain par id, tronc, nœud, bâti par type).
- **`render/gi/champ-ref.ts`** — L'ORACLE du champ, en module durable (l'ex-`gi-ref.mjs` jetable) :
  `champRef(grille, émetteurs, réglages)` → direct (part visible × profil), faces des cellules opaques et des DEUX côtés
  de chaque bande, rebond Lambert plafonné par le genou, `composerM` (LG-R5, exact à l ≤ 0 : le plancher au bit).
  C'est la RÉFÉRENCE de LG-A2 — l'écran se comparera à lui, pas à des captures.
- **`render/gi/grille.ts`** — `grilleDuMonde(monde, niveau, fenêtre)` : le raster de la sim → `occ` / `albedo` / `murs`
  de l'oracle, l'albédo du terrain lu par `terrainAEtage`.
- **`render/gi/champ-ref.test.ts`** 9/9 — **A0 : la part visible de l'oracle vaut `partVisible` de la sim AU BIT PRÈS
  sur tous les texels libres à portée** (prémisses : plus de 1 000 texels, de l'ombre, de la pénombre, de la pleine
  vue), G1 la grille, A4·1–6 (le texel contre la bande reçoit 0 et son jumeau plus de 0,9, pénombre monotone, rebond
  d'un seul côté de la bande, rebond ≤ plafond et teinte préservée, déterminisme, motif de 16), A5 `composerM`.
- **`render/torche.ts`** — `TORCHE_LIGHT_TILES` DÉRIVÉE de `LUMIERE.TORCHE_PORTEE_TUILES` (le doublon annoncé le
  16/09). `torche.test.ts` 12/12.
- **`scenes/world/etat-gel.ts`** — la remarque (5) de la revue : la façade porte `nodes`, `entities`, `npcs`,
  `monsters` (optionnels, `undefined` = absent, exactement comme `MondeEclaire` le lit ; `creerEtatGel` et
  `majEtatGel` les relaient, la mise à jour en place peut les effacer). **`WorldScene.ts`** — worktree seulement,
  QUATRE lignes dans le littéral `source` (`view.nodes`, `lastEntities`, `view.npcs`, `view.monsters`) : à rebaser sur
  le commit de l'autre session, qui édite ce fichier. **`etat-gel-lumiere.test.ts`** (neuf) 5/5 : L1 la prédiction vaut
  l'autorité AU BIT PRÈS sur 1 026 points (un feu, un fût, un avatar et un PNJ porteurs de torche) ; L2 sans les nœuds
  la façade est PLUS CLAIRE que l'autorité derrière le fût — le mensonge de N2bis, mesuré, jamais l'inverse ; L3 sans
  les corps la torche de l'autre avatar manque ; L4 sans les figurants la torche d'un PNJ compte à tort (LG-R18) ; L5
  `majEtatGel` remet et efface.

**Vérifié le 2026-09-17, dans le worktree** : `pnpm check` 0 (sim, serveur, client), `pnpm lint` 0 ; les quatre
suites : sim 2 431 verts, 2 ignorés, 4 rouges — les deux `charniers.test.ts` ANTÉRIEURS (voir « La sim d'abord ») et
deux timeouts de cache froid (`envol` R21 à 30 s, `terrasses` T-A1 graine 4242 à 60 s) rejoués verts sur le cache
chaud (75/75) ; client 1 613 verts (133 fichiers), serveur 36, banc 3. Les planchers de `tools/suites.mjs` tiennent
(les suites ont GROSSI : +3 sim, +14 client — le plancher se relève au commit de l'autre session, c'est son fichier).

**Ce que ça change au jeu** : rien qui se voie — la prédiction du client voit maintenant ce que l'autorité voit (le
bandeau de refus de la parade ne se trompe plus derrière un fût ni sous la torche d'un autre). Rien ne se dessine
encore. **LG-A12, l'autre moitié** (l'écran contre la sim) reste à la tranche B, mais son étalon existe : `champRef`.

**Tranche B, la chaîne GPU (à faire, worktree)** — d'après le spike `tools/__gi-spike/spike.js` (Phaser 4.2 :
`#pragma phaserTemplate`, `setRenderToTexture`, `readPixels` via `glWrapper.updateBindingsFramebuffer`, ping-pong,
NEAREST) : (1) une texture d'occludeurs à la résolution de la grille, écrite depuis `occlusionAuGrain` (et les bandes,
qui ne tiennent pas dans un texel : raster 2× ou test analytique dans le shader — à mesurer, l'oracle tranche) ;
(2) la passe DIRECTE : par texel, les 16 rayons de `MOTIF_SOURCE` vers chaque source, la même marche que
`segmentBloque` ; (3) faces et rebond, puis le genou ; (4) `composerM` dans le voile (tranche C). Derrière une touche
du HUD (`hud-state.ts`, patron `debugLighting`) et un bouton du panneau (`debug-panel.ts`), lue dans `WorldScene`
comme les autres. Gardes : LG-A1/LG-A3 en pixels (le patron du spike), **LG-A2 = l'écran lu par `readPixels` contre
`champRef` sur la même grille**, à la tolérance de la spec. Les regards (planches) AVANT toute règle qui bouge.


## La brique client — tranche B, la chaîne GPU (2026-09-17)

Cinq passes derrière l'interrupteur `debugGi` (`direct`, `faces`, `drapeau`, `rebond`, `somme`),
dans `packages/client/src/render/gi/champ-gpu.ts`, éprouvées contre l'oracle `champRef` de la
tranche A par `verifier()` — c'est LG-A2.

**DEUX DÉFAUTS TROUVÉS ET SOLDÉS, chacun avec son avant/après à lui.**

**1. Le monde à l'envers.** La chaîne lisait le canvas d'occludeurs rangée 0 EN HAUT, alors que
l'upload le retourne : l'occludeur de la rangée `j` était vu en `gh − 1 − j`. Prouvé par une tache
2×2 posée à quatre hauteurs (`tools/__gi-miroir.mjs`), avec la prédiction chiffrée écrite AVANT :

| tache en j | miroir prédit `gh−1−j` | apex fantôme mesuré | déplacement |
|---|---|---|---|
| 60 | 99 | *aucune ombre* (hors du rayon 24) | — |
| 74 | 85 | **84** | +10 |
| 79 | 80 | *recouvre l'ombre vraie* | — |
| 92 | **67** | **67** | **−25** |

+10 à une hauteur et −25 à une autre : aucun décalage constant ne produit ça. Remède : un helper
`uvRaster(c)` dans `COMMUN`, par lequel passent les **trois** lectures de canvas (`code2`,
`albBande`, le `uAlb` de `FRAG_FACES`). Retourner à la LECTURE et non à l'écriture — une
soustraction au lieu d'une addition, K invariant de boucle, et le canvas reste à l'endroit.

**2. La règle d'extrémité.** L'extrémité d'un segment s'épargne au TEXEL ENTIER, pas au sous-texel
du raster 2× : `traverse` (oracle) n'inspecte jamais le texel de départ ni celui d'arrivée, et ce
sont des texels entiers ; le raster 2× n'en épargnerait qu'un quart. Validée à **0 désaccord sur
130 864 segments** (`tools/__gi-traversee.mts`) avant d'être posée.

| LG-A2, passe directe | à l'origine | après le miroir | + règle d'extrémité |
|---|---|---|---|
| moyenne (niveaux) | 19,11 | 5,02 | **0** |
| au-delà de 3 niveaux | 68,6 % | 51,1 % | **0 %** |
| max | 166 | 43 | **0** |

**La passe directe est EXACTE** — 0 sur 1 411 texels, dont 1 274 éclairés. `champ` rend 0,129 de
moyenne, max **1** : c'est de l'ARRONDI, montré et non affirmé (313 trop clairs contre 304 trop
sombres, exclusivement ±1 — un défaut de géométrie aurait un SENS, une symétrie n'en a pas).

**LES BANDES SONT ÉPROUVÉES, ET EXACTES.** La fenêtre du vrai monde n'en contenait AUCUNE
(`verifier().bandes` = 0) et les mondes-tache effacent `g.murs` : le premier zéro ne portait que
sur des occludeurs pleins. Un monde d'UNE bande fabriquée à la main (`g.murs` et `g.albedoMurs`
sont PARALLÈLES — pousser dans les deux) → moyenne 0, max 0 sur 1 547 texels. La prédiction
(« fuite aux pointes ») était FAUSSE : pour une traversée perpendiculaire le GPU saute le
sous-texel de départ mais bloque sur le second, qui n'est ni départ ni arrivée.

⚠ **CE QUE « CLOSE » COUVRE, exactement.** Tout ce qui précède est mesuré à 224 × 160 avec **UNE
source**. `GI.MAX_SOURCES` borne la liste des émetteurs et `uSrc` les empaquette un par un : rien
ici n'éprouve **deux émetteurs qui se recouvrent**, ni la coupure à `MAX_SOURCES`. Ce n'est pas une
accusation — c'est la portée du mot. À éprouver avant de déclarer LG-A2 tenu dans le jeu réel, où
un village porte plusieurs feux.

**CE QUI RESTE EST DE LA PERF, et rien d'autre.** Répartition mesurée à 224 × 160, une source
(`tools/__gi-partage.mjs` : `update(n)` puis un `readPixels` qui purge la file — le cumul au cran n
moins celui du cran n−1 EST le coût de la passe n) : direct 18 ms, faces 22, drapeau 10,
**rebond 429**, somme 150. `FRAG_REBOND` est un GATHER : 35 840 texels × 625 voisins = 22,4 M
itérations, chacune payant une lecture de `uDrapeau` juste pour passer son tour. Remèdes candidats :
une pyramide sur le drapeau (25×25 couvert en ~16 lectures) ou le SCATTER depuis la liste des faces,
comme l'oracle. Restent aussi **C5** (`bloque` marche 192 pas pour tout le monde) et **C6**
(`temps.grille` à 39 ms).

⛔ **CES MILLISECONDES SONT CELLES D'UN RASTERISEUR LOGICIEL, ET NE SE COMPARENT PAS À LG-A14.**
Cette machine n'a pas de GPU (`CLAUDE.local.md`) : Chromium rend en **SwiftShader**, sur le CPU.
L'arithmétique le dit seule, et sur les DEUX passes indépendamment :

| passe | travail élémentaire | temps | par opération |
|---|---|---|---|
| rebond (bras sans `bloque`) | 22,4 M lectures de `uDrapeau` | 193 ms | **8,6 ns** la lecture |
| directe | 573 440 rayons × ~24 pas ≈ 14 M pas | ~20 ms | **1,5 ns** le pas |

8,6 ns pour échantillonner une texture R8 de 35 Ko, c'est la cadence d'un **échantillonneur
logiciel**, pas d'une unité de texture — et c'est la seule dépense qui ne se transporte PAS sur du
vrai matériel : sur un GPU réel, ces 22,4 M lectures tiennent dans des microsecondes. Tout le profil
de la chaîne s'explique uniformément par la rastérisation logicielle.

Donc **629 ms ici n'est ni un échec ni une réussite** face aux 2 ms / 4 ms de LG-A14, qui visent
l'image sur la machine d'un joueur : c'est une grandeur que cette machine **ne peut pas produire**.
⚠ Le message du commit `4605eee` écrit « LG-A14 N'EST PAS TENU » — **c'est surdit, et ceci est la
correction** ; l'interrupteur reste éteint par défaut, mais pour cause de coût NON VÉRIFIÉ et non
de budget dépassé. Le verdict LG-A14 demande du matériel qu'on n'a pas.

**Ce qui reste vrai et portable** : le profil RELATIF (le rebond domine, et de loin) et les
**comptes d'opérations**, qui ne dépendent d'aucune machine. La suite se mesure donc en opérations —
compter les texels marqués dans le drapeau, et les couples (texel, voisin) qui survivent à la
fenêtre 25×25 — et non en millisecondes. C'est ce compte qui départage la pyramide du scatter, et
il peut très bien dire qu'aucun des deux ne suffit seul.

**Pièges payés dans cette tranche** — une épreuve RADIALEMENT SYMÉTRIQUE ne peut pas voir un miroir
vertical (la sonde en champ libre « validait » la formule à 1,000 partout) ; `profil` rend 0 au-delà
du rayon, donc 12 144 occludeurs n'est JAMAIS le bon dénominateur (~600 seulement sont dans le
disque) ; un backtick non échappé dans un commentaire GLSL tue le module en silence (symptôme
headless : `waitForFunction: Timeout`, sans `pageerror` ni console) — `tsc` avant toute sonde
navigateur ; et une liste de DIAGNOSTIC relue comme un reste à faire m'a fait écrire deux fois que
LG-A2 n'était pas déclarable alors que le correctif C2 datait.

## Lignes de journal dues (relevé du 2026-09-15)
`rendu-da.md` : 1bis (réouverture « zéro post-FX »), 2bis (G2), 3 (refonte), 3ter (astres → murs), 3quater
(longueur proportionnelle), 4 (lumière continue, pas de crans), LG-Q3 (a) (le relief des corps refait
DEPUIS LA GI, 2026-09-15, planche 7, contre la recommandation A ; la forme D retenue le 2026-09-15, planche 8,
« limites d'abord » ; puis le 2026-09-16, planche 9, « E devient la règle » : la GI lue sous chaque pixel, LG-R7
amendé ; et « le feu compte de jour, plus faible qu'aujourd'hui », LG-R5 amendé ; puis planche 10, f = ½ et le
plancher d'un corps reste celui de la spec, I écarté ; puis planche 11, J : la part plate d'un corps est le
plancher du ciel ou l'ambiante de l'heure si elle est plus basse — LG-R7 en forme finale), LG-Q3 (b) (2026-09-16,
planche 12, « K : la force seule » : la portée d'un Feu ne prend pas l'engagement, sa force si, comme aujourd'hui —
LG-R6 amendé), LG-Q3 (c) (2026-09-16, planche 13, « la flaque reste sous le champ » : un multiplicateur ne fait pas
de braise, la flaque d'aujourd'hui reste peinte sous le champ), O (2026-09-16, planche 16, « ok pour O » : les faces
ont un sens et une hauteur — LG-R7 amendé), LG-Q1 (2026-09-16, planches 14 à 19, « La règle entière, la paroi dans
son ombre » : la falaise fait écran à sens unique jugée en hauteur, la rampe est un plancher porte ouverte, la marche
porte son ombre d'astre comme un mur de sa hauteur et l'ombre peinte de cliff-layer disparaît, une paroi lit son pied
dans son ombre — LG-R14), LG-Q4 (2026-09-16, planche 20, « Au pixel, longueur LG-R9 » : les roches gardent leur
coulée au pixel, sa longueur seule suit la hauteur, 6 / 8 / 10 px — LG-R15), LG-Q5 (2026-09-16, planche 21, « Fermer,
couvert par LG-R7 » : le défaut du run 18 est réel, petit et invisible, chaque part sur sa face le supprime — pas de
règle neuve), LG-Q10 (2026-09-16, planche 22, « La coiffe et les rubans sous le ciel » : le dessus des corps prend la
part des astres seule, jamais la part directe du feu — LG-R16), LG-Q6 (2026-09-16, sans planche, « La force et la
portée » : la portée et la force du feu respirent toutes deux au battement de la flamme, le look du trou d'aujourd'hui
reconduit — LG-R6 amendé), LG-Q7 (2026-09-16, sans planche, « Les deux seuils » : au plus 2 ms par image sur GPU
intégré, 4 ms sur GPU dédié, chaque machine sa gate — LG-A14), et 3bis (corps tel quel) si Alexis la
veut au journal ; `gameplay-systemes.md` : Q5, LG-Q9 (2026-09-16, « Recentrer la chaleur aussi » : la bulle de
chaleur part du centre de la tuile du feu, comme la lumière — LG-R17), LG-Q8 (2026-09-16, « La sim voit toutes les
torches » : la clarté sur soi prend au max la torche vive de tout avatar à portée, le périmètre reste les avatars —
LG-R18).
Les deux volets sont modifiés par l'autre session : on les écrit à son commit, et les « pourquoi » se prennent
à Alexis, pas à mes suppositions.

## Comment reprendre — état au 2026-09-17

⚠ Le plan en cinq étapes qui tenait ici datait du 2026-09-14 et est ENTIÈREMENT dépassé : son spike,
ses planches et sa spec sont faits, et sa dernière étape (« la GI en dernier, seulement si 1 à 3 ont
convaincu ») contredisait la toute première décision d'Alexis, « la GI 2D d'emblée ». Remplacé.

**FAIT.** Spike 11/11 · 22 planches · spec `docs/specs/lumiere-globale.md` ENTIÈRE sauf LG-Q2 ·
brique `/sim` committée **f53a38c** · brique client tranche A (l'oracle en module, la grille, la
façade) committée **24454aa** sur la branche `gi-client` · tranche B (la chaîne GPU) : **la justesse
est close** — passe directe exacte contre l'oracle, bandes éprouvées et exactes, reliquat de `champ`
à ±1 niveau d'arrondi (section « tranche B » ci-dessus).

**À FAIRE, dans cet ordre — c'est de l'ingénierie contre l'oracle, rien n'y attend Alexis.**
1. **Le rebond** : 429 ms des 629. Trancher d'abord l'hypothèse « le coût est dans le TRI, pas dans
   le calcul » en retirant le `bloque` interne et en re-mesurant par `tools/__gi-partage.mjs` ;
   puis pyramide sur le drapeau, ou scatter depuis la liste des faces. **C5** et **C6**
   (`temps.grille` 39 ms contre 2 ms, LG-A14) ensuite.
2. **Tranche C** — la composition dans le voile : `composerM`, Mn depuis
   `multiplicateurDuVoile(voileDeNuit(...))`, f de jour, critères LG-A5/A6/A7.
3. **Tranche D** — les astres (LG-R8/R9), les corps (LG-R7), les paliers (LG-R14), le dessus
   (LG-R16), la coulée (LG-R15, indépendante du champ et faisable avant).
4. **LG-Q2, les grottes** : APRÈS le commit de l'autre session (elle tient `grottes.md`, où le
   chiffre G-R5 « 12,8 à l'arête » sera à corriger).
5. **Les lignes de journal dues** (relevé ci-dessous), puis `node tools/decisions-index.mjs` —
   jamais éditer `docs/decisions.md` à la main.

**Règles de terrain qui ont coûté cher ici.** Worktree `wt-gi` + vite :3140 ; ne jamais éditer
`packages/client` pendant une sonde navigateur (le HMR recharge la page et tue le run) ni `/sim`
pendant une suite ; les fichiers de l'autre session (`WorldScene`, `dynamic-lighting`, `cave-veil`,
`flank-glow`, `cave-*`, `etage-layer`…) se lisent, ne s'écrivent pas — le merge de `gi-client` se
fait par rebase sur son commit. Et pour Alexis : **les planches avant les règles, des images et pas
des chiffres.**

## Pistes de lecture (avant le spike)
- GPU Gems 3, chapitre 13 — Kenny Mitchell, *Volumetric Light Scattering as a Post-Process*.
- Alexander Sannikov, *Radiance Cascades: A Novel Approach to Calculating Global Illumination* (2023).
- Billets de blog de la communauté 2D : Sam Bigos, *2D Global Illumination in Godot* (jump flooding
  + ray marching) ; Jason McGhee, *Building Real-Time Global Illumination* (radiance cascades en
  WebGL, pas à pas).
