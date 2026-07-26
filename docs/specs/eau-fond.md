# eau-fond — le fond de l'eau, dix gestes proposés, huit vivants

*Source : artefact « Le fond de l'eau — dix gestes » (2026-07-26, état des lieux complet + 10 propositions), direction d'Alexis « on lerp case à case comme les transitions de biomes sur terre » sur la frontière, puis « fais tout », puis la revue d'œil du même soir — deux gestes RETIRÉS (l'eau morte du marais, le marnage), quatre REPRIS (transition fondue, stries cassées, herbiers en tuiles, nénuphars cubiques). Statut : **livré le 2026-07-26**. Prolonge `eau-vivante.md` — même cadre acté : grain 4 px NEAREST, paliers francs pour les FX, un seul soleil, zéro post-FX, R45, gué ≥ 1,4:1 (R10 da-feeling), le profond est un mur, `/sim` intact (tout ce chantier est client seul — pas un octet de sim touché).*

## Le champ, réorganisé

`uField` (1 px/tuile, NEAREST) change deux canaux — l'ancien état est consigné dans l'en-tête de `render/water-field.ts` :

- **R** — le masque binaire, INCHANGÉ (le trait de rive au pixel près).
- **G** — LA PROFONDEUR par tuile (geste 01). L'élévation qui y vivait est morte avec la carte plate (R35 caduque).
- **B** — LE RÉGIME (geste 10) : 0 eau normale · 200 Lac Mort. Le profond binaire qui y vivait est redondant depuis que G porte la profondeur. (Le régime 120 — l'eau morte du marais — a existé un soir : regardé, refusé.)
- **A** — 255, toujours (prémultiplication à l'upload).

Une **4ᵉ texture** `uFond` (geste 03) porte le lit, uploadée EN BRUT depuis le tableau typé (`addUint8Array` — ni canvas ni putImageData, A = 255 partout donc prémultiplication identité) ; le bake `uSeabed` reste la vérité de la couleur de rive — il est aussi la carte-overlay du joueur (UIScene), on n'y cuit PAS le fond : les rivières doivent rester bleues sur la carte.

## Les gestes vivants

- **R1 — LA PROFONDEUR FONDUE** (geste 01, repris deux fois). Côté CPU, **CINQ ANNEAUX** autour de l'arête shallow|deep (4-voisinage : un coin n'est pas une couture) — profil `[S2 0,10 · S1 0,28 · D1 0,55 · D2 0,80 · D3 0,93]`, ondulé ±0,05 par hash de tuile (« lerp encore plus », 2ᵉ demande d'Alexis — la version à une seule tuile frontière 0,70 était encore trop franche). Côté shader, la profondeur est **LERPÉE SOUS LA TUILE** (`depthBilin`, bilinéaire manuel du canal G — même patron que `riveFlow`) : la transition s'étale sur ~5 tuiles en **iso-lignes courbes**. Contre-intuition MESURÉE : élargir la rampe a MONTÉ le contraste du gué (1,44 → 1,47:1) — baisser la profondeur du cœur réduit sa part de ciel, qui domine la luminance du profond. Le voisinage s'inline (une closure par tuile d'eau triplait la passe — 106 → 327 → 192 ms au banc).
- **R3 — LA MÉMOIRE DU FOND** (geste 03, variante client seul actée). Le lit inféré : **sable** sur tout le haut-fond (marchable = clair — la matière suit le TERRAIN, pas la distance : une première écriture posait la vase à 1,6 t de la rive, en plein gué mesuré, −10 % de luminance, A4 à 1,38 — corrigé), **galets** là où le courant porte (> 0,3), **vase** au profond qui fonce avec la distance au bord, **algues** (voir R9) ; moucheté ±8 % par hash SOUS L'EAU SEULEMENT — la terre se remplit en bloc (u32 constant sable : la version qui hachait 3,75 M de tuiles coûtait ~290 ms au banc pour 95 % de tuiles jamais échantillonnées ; 288 → 87 ms). La réfraction et le lit visible lisent `uFond` — plus jamais la couleur d'eau bakée.
- **R4 — LE LIT STRIÉ** (geste 04, repris). Plus des zébrures moitié-moitié (« trop rectilignes, trop franches ») : des **CRÊTES étroites** (~15 % du cycle), ROMPUES par cellule, phase CHAHUTÉE par blocs d'1,5 tuile — des rides de sable brisées, un demi-cran clair. Statiques (le courant les a faites, il ne les anime pas), éteintes en profond et sous 0,12 de courant ; les lacs restent lisses.
- **R5 — LES CAUSTIQUES POSTERISÉES** (geste 05). Filet d'interférence DEUX TONS, crans francs, par cellule de 4 px, sur le lit du haut-fond seul ; gaté uDay × hauteur du soleil, mort en profond, près de la berge et en eau trouble. Vitesses lentes (ω ≤ 0,33 rad/s — mesurable à la sonde optique, R12).
- **R7 — LA TURBIDITÉ** (geste 07). Les pas soulèvent la vase : nuage brun en DEUX crans francs derrière chaque marcheur (le fenêtrage arrière du sillage réutilisé), qui meurt avec la force du wader (~0,7 s après l'arrêt) — plusieurs marcheurs au même gué gardent l'eau trouble ENSEMBLE. L'eau trouble cache son fond : caustiques et lit visible s'éteignent localement. *Approximation assumée : pas de mémoire d'accumulation (il faudrait une render texture) — la persistance d'un gué fréquenté vient du recouvrement des nuages.*
- **R9 — HERBIERS ET NÉNUPHARS** (geste 09, repris). Les herbiers vivent dans le **LANGAGE DU SOL** : des TUILES d'algues dans `uFond` (le premier jet en blobs shader était hors DA — retiré) — massifs ouverts par un hash de région (blocs de 8 tuiles), semés par un hash fin, haut-fond CALME seulement (courant < 0,1), à plus de 1,3 t de la rive (le bord reste sable). Les nénuphars (`world/nenuphars.ts`) : ≤ 6 coussins ANCRÉS semés par hash autour de la caméra (patron des feuilles, sans dérive), espacés ≥ 2,5 t, hors bande d'écume, jamais dans le courant — et à la **DA CUBIQUE**, recette des dalles de gué : silhouette **ELLIPSE PLATE** (la forme de son ombre de contact — retour d'Alexis), chunky par la taille (8-10 px), deux matériaux (coussin, plat qui prend le jour), encoche franche, variante `_lit` + normale `passes:1`/`k:3.5`, `setLighting(true)`, toggle debug branché au panneau P avec les dalles, JAMAIS de flipX en mode lit. Ombre de contact séparée sur le lit (+2 px, elle ne bobbe pas), bob d'1 px par crans. DÉCOR ASSUMÉ, frontière écrite : le jour où ça se récolte, ce sont de vrais nœuds /sim.
- **R10 — LE LAC MORT** (geste 10). La case fantastique réservée (worldgen.md : « une eau parfaitement immobile, trop claire, sans un poisson ») devient un régime de ZONE (`zoneSlugAt === 'lac_mort'`, eau seulement) : clapot ×0,05, transparence ANORMALE (le fond net partout — la réfraction ne meurt plus en profond, galets pâles au lit, ciel à 0,06, alpha 0,90), teinte froide irréelle, zéro écume, reflets durs +60 %, chemin de l'astre +80 % — le seul éclat du lieu. Le malaise vient de l'EXCÈS de clarté, jamais d'un filtre sombre. **Rendu seul : le lore reste une décision d'Alexis.**

## Les gestes retirés (regardés, refusés — 2026-07-26)

- **Le tombant** (geste 02) : liseré sombre + écume qui casse sur la tuile frontière — il durcissait un bord qu'Alexis voulait fondu ; la rampe de `depthBilin` porte seule la lecture du profond.
- **L'eau morte du marais** (geste 06) : plaques mates, bulles de tourbe, régime 120 — retiré entier ; le marais reste hors du pipeline de l'eau (aplat + roseaux + brume, comme avant).
- **Le marnage** (geste 08) : la ligne d'eau qui respirait par crans (film de marée haute, lit découvert, mémoire de 2 s) — la ligne d'eau est fixe, comme avant.

## Critères d'acceptation

- **A1** — GUÉ : ≥ 1,4:1 (R10 da-feeling) re-mesuré après CHAQUE retouche de couleur. **Mesuré 1,47:1** au scénario `feeling` avec la rampe à cinq anneaux (1,44-1,45 avec la tuile frontière seule ; 1,38-1,39 pendant le calibrage, corrigé par frontière 4-voisinage + sable au terrain + sable 150/128/86).
- **A2** — Les gardes existantes restent vertes : `feeling` A5 (remous ✓), `eau-vivante` (immersion, vie, aval, sillage, événements ✓). Le shader COMPILE — un `t` lu avant sa déclaration a cassé tout le quad un moment : vu par le smoke t0, PAS par tsc (le GLSL ne passe pas au type-checker, seul un run navigateur le prouve).
- **A3** — BOOT (A10 eau-vivante, budget 1 200 ms) : la 3ᵉ texture plein-cadre l'avait fait déborder (1 382-1 489 ms) ; **re-mesuré 952 ms** après le remplissage u32 + l'upload brut, puis **1 162 ms** avec les cinq anneaux — sous le budget, marge mince : la prochaine passe plein-cadre devra payer sa place.
- **A4** — Client 293/293, sim 793 + banc scénario, check/lint verts ; captures REGARDÉES (gué, rivière, transition).

## Consignés pour Alexis (décisions d'œil ou de design, valeurs prêtes)

- Le **lore du Lac Mort** (la case reste réservée — le rendu est prêt à l'accueillir), et un **vrai lac cohérent** en zone T2 : chantier worldgen, avec le risque RNG consigné (isoler sur un nouveau chemin de tirages).
- **Nénuphars/roseaux récoltables** : de vrais nœuds /sim, chantier séparé (règle « objets de jeu réels »).
- Les molettes d'œil : poids de la frontière (0,70 ± 0,08), seuil/densité des crêtes de sable (0,72 / blocs 1,5 t), couverture des algues (région 0,55 · tuile 0,5), l'ampleur des caustiques (0,55).
- Les **reflets du monde au Lac Mort** (« reflets parfaits ») : le shader y durcit glints et astre, mais `reflets.ts` (acteurs/fûts) n'a pas de boost de zone — à trancher si l'œil le demande.
