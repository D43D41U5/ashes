import { describe, expect, it } from 'vitest'
import { BALANCE, NPC_AI } from './balance'
import type { MoveWorld } from './collision'
import { pathToward } from './pathfinding'
import { construireMondeDuBanc } from './scenario'

// Le tsconfig de /sim est ES2022 pur (pas de lib Node) — le test, lui, tourne
// sur Node : on déclare le strict nécessaire.

/**
 * Le banc de test (V10).
 *
 * DÉFAUT À 1 JOUR, et ce n'est pas un choix de confort mais le compte-rendu de DEUX coûts réels
 * que la migration sur la carte de PRODUCTION a rendus visibles — aucun des deux n'existe sur
 * l'ancienne carte plate.
 *
 * ① LA HORDE, ×36. Au jour de saison 5, le coût par tick saute de 0,97 à 35,01 ms (mesuré par
 *    tranches, `tools/profil-banc.mts`), à l'apparition de quatre monstres : vingt entités
 *    consomment 70 % du budget d'un tick à 20 Hz. C'est la classe de bug déjà corrigée pour l'IA
 *    des villages — viser à vol d'oiseau, se cogner aux falaises — restée entière pour les hordes.
 *
 * ② LE TREK INTER-ZONES. Depuis que les villageois SURVIVENT (correctif de famine du 2026-07-24),
 *    ils vont chercher hors de leur zone les ressources qu'elle ne porte pas — un vrai chemin à
 *    travers 450 k tuiles. Un monde qui VIT coûte cher à simuler : 2 jours de banc dépassent
 *    8 minutes, quand le profil du premier jour prédisait ~2. Ce n'est PAS de l'overhead vitest
 *    (mesuré : ~1,3× seulement) — c'est le prix que le serveur paiera aussi. À optimiser (cache de
 *    chemins inter-zones, ou une corvée qui préfère sa zone tant qu'elle y a de quoi faire).
 *
 * ⚠ **ET CE QUI PRÉCÈDE DÉCRIT UN BANC QUI NE TOURNE PLUS.** Il gardait la non-régression de
 * FAMINE (mesurée à ce défaut : trois villages, dix habitants, zéro affamé, contre 177 et deux
 * villages anéantis avant les correctifs), et cette garde jouait des dizaines de milliers de
 * ticks. Depuis le 2026-09-26 elle était GELÉE par `FEATURES.VILLAGES_PNJ` ; depuis le
 * 2026-09-29 elle est SUPPRIMÉE avec `SimState.npcs`. **Plus aucun test de ce fichier n'appelle
 * `runScenario`** : ce qui reste ici ne joue pas un tick, il éprouve le MONDE CONSTRUIT
 * (`construireMondeDuBanc`).
 *
 * ⚠ Donc `SCENARIO_DAYS` et `pnpm scenario` ne commandent plus rien, et les deux coûts ci-dessus
 * ne se paient plus. MESURÉ le 2026-09-29, pour le jour où on voudra rallumer : `runScenario`
 * à **1 jour = 132 s** (0 front, 1 ligne de chronique), à **2 jours = 315 s de plus** (1 front,
 * 0 horde, 3 lignes). Le banc n'a PAS d'avatar — il n'en a jamais joué —, donc rendre la garde
 * de famine demande d'abord de lui donner un corps. Question ouverte, posée à Alexis.
 */

/*
 * ⚠ ═══ `FAMINE_PAR_JOUR` A VÉCU ICI, ET SON ENQUÊTE MÉRITE DE SURVIVRE AU CHIFFRE ═══
 *
 * Le seuil valait **10 par jour** (ligne de design du 2026-07-24), et il a fallu deux corrections
 * pour le rendre honnête. ① Il était un COMPTE et non un TAUX : `starvationSamples` prenait un
 * point par PNJ affamé et par relevé, à cadence FIXE (833 ticks), donc un banc de N jours prenait
 * N fois plus de relevés et la garde rougissait à mesure qu'on allongeait l'horizon, sans aucune
 * régression — corrigé en `10 × report.days` le 25/09. ② Et la forme en taux ne réglait pas tout :
 * A/B sur cinq graines, banc A8 à 2 jours, `0 · 0 · 0 · 0 · 20` — **la graine 42 tenait à zéro
 * marge**, et le compteur était BIMODAL (zéro, ou quinze à vingt) : il ne dérivait pas, il
 * basculait. La contre-enquête à mener restait « ce n'est pas la ressource » : un village RASÉ
 * rendait 69 affamés, et la cause se lisait dans la chronique (`village_fell`), jamais dans
 * l'économie.
 *
 * Le seuil part le 2026-09-29 avec `report.starvationSamples` et les deux gardes gelées qui le
 * lisaient (tranche 3 du retrait des villages PNJ) : plus un corps à affamer sur ce banc.
 * ⚠ Le jour où le banc joue un AVATAR, c'est cette forme-là qu'il faut reprendre — un TAUX, et
 * une lecture de la chronique avant de soupçonner la nourriture.
 */

describe('le banc de test', () => {
  /**
   * LE GARDE-FOU DU MONDE — rapide, sans simulation, et c'est LUI qui aurait attrapé la dérive.
   *
   * Le banc a calibré la faim des mois durant sur une carte legacy sans un seul coin de chasse.
   * Aucun test ne l'a vu, parce qu'aucun test ne regardait le MONDE — ils regardaient tous le
   * résultat. Ce banc-ci ne joue rien : il bâtit le monde et vérifie que c'est bien celui du jeu.
   * Il coûte deux secondes et il tient l'invariant que la longue partie ne peut pas tenir.
   */
  it('mesure le monde qu’on JOUE — coins de chasse, nœuds, villages', { timeout: 120_000 }, () => {
    const { sim, monde } = construireMondeDuBanc(2026)
    // Sans gibier, tout chiffre sur la faim est un artefact. C'est LE défaut d'origine.
    expect(monde.huntingGrounds, 'aucun coin de chasse : le banc mesurerait la faim sans gibier').toBeGreaterThan(0)
    expect(monde.nodes, 'une vallée sans nœuds est une carte dégénérée').toBeGreaterThan(1000)
    // LA PARITÉ D'AMORCE (spec lieux-batis A5) : la Veillée bâtit ses lieux (`buildPoiStructures`),
    // le banc doit jouer les mêmes murs. Sans cette garde, le banc a mesuré des PNJ qui traversent
    // la Ferme ruinée comme un pré — la même classe de dérive que la carte sans gibier.
    expect(monde.structuresBaties, 'aucun lieu bâti : le banc jouerait un monde sans murs de POI').toBeGreaterThan(0)
    // L'IA de raid de la Meute vise le village le plus proche À VOL D'OISEAU : à quasi-égalité,
    // elle raide le même chaque nuit jusqu'à destruction mutuelle, et le banc mesure une guerre
    // au lieu d'une économie. C'est arrivé (marge de 0,4 % sur l'ancienne carte, corrigée à la
    // main). Ici on ne touche à aucune coordonnée — on maximise l'écart et on VÉRIFIE la marge.
    expect(
      monde.margeDeCible,
      'cibles de la Meute à quasi-égalité — le banc mesurerait une guerre',
    ).toBeGreaterThan(BALANCE.MARGE_DE_CIBLE_MIN)

    /**
     * ═══ LE BANC PEUPLE COMME LE JEU (`peuplerLesVoisins`, 2026-09-22) ═══
     *
     * Il avait sa règle propre : trois villages écartés au maximum, un Foyer de QUATRE posé
     * EXACTEMENT sur le point de naissance. Il joue désormais la loi des trois hôtes. Ces deux
     * gardes disent ce que la loi PROMET là où la marge ci-dessus ne dit rien, et chacune
     * attraperait un retour en arrière DIFFÉRENT : le compte, et le site laissé libre.
     *
     * ⚠ Le seuil de marge n'est plus un 5 écrit ici : c'est `BALANCE.MARGE_DE_CIBLE_MIN`, que la
     * loi GARANTIT pour les trois hôtes. Cette assertion cesse donc d'être un privilège du banc —
     * elle vérifie une promesse tenue ailleurs, au lieu d'espérer une géométrie favorable.
     *
     * ⚠ Le COMPTE, lui, est celui du BANC (`VILLAGES_DU_BANC`) et NON celui de la Veillée : la LOI
     * est commune aux trois hôtes, le NOMBRE ne l'est pas — ce monde-ci est 7,8× plus petit que
     * celui du solo. La justification chiffrée vit sur la constante, dans `scenario.ts`.
     */
    // ⚠ CE BLOC ÉTAIT GELÉ derrière `FEATURES.VILLAGES_PNJ` (2026-09-26) et il est RÉDUIT à sa
    //    branche survivante le 2026-09-29 (tranche 4 du retrait des villages PNJ). Ce qui est
    //    parti : « le banc peuple comme le jeu » (trois villages) et « aucun Feu n'est posé SUR
    //    le point de naissance ». Tout ce qui PRÉCÈDE reste, délibérément — c'est du WORLDGEN
    //    (le gibier, les nœuds, les murs des lieux) et de l'ÉLECTION DE SITES (la marge du
    //    raideur), et l'élection tourne toujours : elle dessine les routes.
    //    L'assertion qui reste est celle qui peut ENCORE échouer, et elle garde la promesse du
    //    pivot : plus un seul village ne naît, quelle que soit la porte.
    expect(sim.villages.length, 'un village est né alors que la fondation a quitté le code').toBe(0)
  })

  /*
   * ⚠ DEUX GARDES ONT VÉCU ICI, ET ELLES SONT PARTIES LE 2026-09-29 (tranche 3 du retrait des
   * villages PNJ, `SimState.npcs` supprimé). Elles étaient déjà GELÉES par
   * `it.skipIf(!FEATURES.VILLAGES_PNJ)` depuis le 26/09, et `braise.md` § 3 étape 11 tranche le
   * sort de ces gelées : **on les supprime au lieu de les faire repartir.**
   *
   *   ① « l'écosystème tient N jours : personne n'affame, les Feux gardent leur caractère »
   *   ② « A8 — la météo armée ne tue aucun PNJ (2 jours, seed 2026) »
   *
   * Les deux lisaient `report.starvationSamples`, qui comptait un point par PNJ affamé et par
   * relevé. Ce compteur part avec le champ : **le banc n'a PAS d'avatar** (il ne joue que des
   * PNJ), donc il ne reste plus un seul corps à affamer — le garder aurait rendu 0 à vie, et un
   * zéro sans population est le pire des verts.
   *
   * ⚠ CE QUE ÇA COÛTE, et il faut le lire avant de croire le vert de cette suite : **la famine
   * n'est plus mesurée par personne**, et la promesse « la météo ne tue pas un corps abrité »
   * non plus (le repli à l'abri avait déjà perdu son mesureur en tranche 2b, R8 PNJ de
   * `meteo.test.ts`). Les deux reviennent avec un banc qui joue un AVATAR — et c'est le vrai
   * chantier : `braise.md` § 3 étape 10 remet la faim sur la table, la braise § 1 le froid.
   */



  /**
   * ═══ V-A9 — LE RETOUR TIENT DANS LE BUDGET (spec `ascension.md`, V-R11) ═══
   *
   * LE BOGUE QU'IL REPRODUIT, et il a coûté une session entière. Sur la graine 2026, les trois
   * habitants du « Feu du Gué » se sont figés à DIX-NEUF tuiles de leur Feu, du tick ~2500 au
   * tick 61500. Le chemin du retour EXISTAIT — 189 pas, par un détour de cinquante tuiles vers
   * le sud et les deux seules rampes à portée — mais l'A* du villageois abandonnait à 4 096
   * nœuds, le défaut de signature de `findPath` : un budget calibré POUR LA FAUNE, que personne
   * n'avait choisi pour un habitant. Plus personne ne rentrait, les dix bois du coffre n'ont
   * jamais bougé d'un seul, le Feu est tombé à sec et la horde a rasé le village. Les 69
   * échantillons d'affamés du banc étaient le DERNIER maillon, jamais le premier.
   *
   * LE CONTRÔLE POSITIF EST LA MOITIÉ DU TEST. On vérifie d'ABORD que le piège existe encore
   * (`null` à 4 096). Sans lui, un worldgen qui déplacerait la tranchée rendrait ce test vert
   * sans rien prouver — une garde qui ne peut pas échouer ne garde rien.
   *
   * Il ne joue AUCUN tick : il bâtit le monde et interroge la primitive que `setPathTo` appelle.
   */
  // ⚠ RECUEILLIE LE 2026-09-29, PAS SUPPRIMÉE (tranche 4 du retrait des villages PNJ). Elle
  // était gelée par `FEATURES.VILLAGES_PNJ` parce qu'elle CHERCHAIT le « Feu du Gué » dans
  // `sim.villages` — or le piège qu'elle garde est un fait de PATHFINDING et de GÉOGRAPHIE, et
  // le terrain du banc n'a pas bougé d'une tuile. On vise donc la TUILE (96,360), qui reste un
  // site élu, au lieu d'un Feu qui n'est plus fondé ; `moverVillageId` passe à `null` (aucune
  // porte sur ce trajet, puisqu'aucun village n'y est bâti). Les trois assertions sont les mêmes.
  it('V-A9 — le retour tient dans le budget, et le piège de 4096 est toujours là', { timeout: 120_000 }, () => {
    const { sim } = construireMondeDuBanc(2026)
    /** Le site du « Feu du Gué », MESURÉ le 2026-09-22 — une tuile, plus un Feu. */
    const BUT = { tx: 96, ty: 360 }
    // ⚠ J'AI ESSAYÉ D'AJOUTER ICI UNE PRÉMISSE « la tuile est marchable », ET ELLE ÉTAIT FAUSSE
    // (2026-09-29, attrapée par le rouge) : `marchableAEtage(map, x, y, palierDuSol(map, x, y))`
    // rend `false` sur les DEUX bouts du trajet — le but comme le départ — alors que
    // `pathToward` les relie en 192 pas. Ce n'est pas le prédicat que le pathfinder consulte :
    // un corps qui SUIT UN CHEMIN ne se juge pas comme une paroi. La vraie prémisse de ce test
    // est le `null` à 4 096 juste dessous — le contrôle positif EST la moitié du test.
    const world: MoveWorld = {
      map: sim.map,
      structures: sim.structures,
      nodes: sim.nodes,
      moverVillageId: null,
      opensDoors: true,
      etat: sim,
    }
    /** Le corps figé, MESURÉ le 2026-09-22 : (115, 362). */
    const auBut = (budget: number): unknown =>
      pathToward(world, 115.5, 362.5, BUT.tx, BUT.ty, budget)

    expect(
      auBut(4096),
      'le piège de 4096 a disparu : plus aucun détour ne le dépasse ici, ce test ne garde plus rien',
    ).toBeNull()
    const chemin = auBut(NPC_AI.PATH_EXPLORE) as { tx: number; ty: number }[] | null
    expect(chemin, 'on ne sait plus rejoindre (96,360) — V-R11 est rompue').not.toBeNull()
    // Le détour est LONG, et c'est tout l'enjeu : un chemin court voudrait dire que la
    // géographie a changé et que le test mesure autre chose.
    expect(chemin!.length, 'le retour est devenu court : ce n’est plus le même monde').toBeGreaterThan(100)
  })

})
