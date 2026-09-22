import { describe, expect, it } from 'vitest'
import { BALANCE, NPC_AI } from './balance'
import type { MoveWorld } from './collision'
import { pathToward } from './pathfinding'
import { VILLAGES_DU_BANC, construireMondeDuBanc, runScenario } from './scenario'

// Le tsconfig de /sim est ES2022 pur (pas de lib Node) — le test, lui, tourne
// sur Node : on déclare le strict nécessaire.
declare const process: { env: Record<string, string | undefined> }
declare const console: { log: (...args: unknown[]) => void }

/**
 * Le banc de test (V10). Calibrage long : `SCENARIO_DAYS=60 pnpm scenario`.
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
 * Un jour SUFFIT à ce que la CI doit garder : la non-régression de FAMINE. Mesuré à ce défaut —
 * trois villages, dix habitants, **zéro affamé** (contre 177 et deux villages anéantis avant les
 * correctifs). Les longues saisons, elles, restent l'affaire du calibrage manuel via
 * `SCENARIO_DAYS`, là où les deux coûts ci-dessus se paient — et se mesurent.
 */
const DAYS = Number(process.env.SCENARIO_DAYS ?? 1)

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
    expect(sim.villages.length, 'le banc ne peuple plus comme le jeu').toBe(VILLAGES_DU_BANC)
    const home = sim.home
    expect(home, 'un banc sans point de naissance ne prouve rien de ce qui suit').not.toBeNull()
    for (const v of sim.villages) {
      const dx = v.fireTx - home!.x
      const dy = v.fireTy - home!.y
      expect(
        Math.sqrt(dx * dx + dy * dy),
        `le Feu du village ${v.id} est posé SUR le point de naissance — le joueur naîtrait dans un village`,
      ).toBeGreaterThan(1)
    }
  })

  /**
   * ═══ L'EFFONDREMENT QU'IL A TROUVÉ, ET LE CORRECTIF ═══
   *
   * Posé sur le monde de PRODUCTION, ce banc a immédiatement trouvé ce que la carte plate cachait —
   * quatre jours, deux villages sur trois ANÉANTIS, 177 relevés d'affamés, le seul survivant étant
   * la MEUTE (celle qui pille) pendant que les deux qui RÉCOLTENT mouraient. Trois bugs, corrigés
   * le 2026-07-24 (voir `nearestAliveNode` et `dropTask` dans npc.ts, `SLEEP_YIELD_HUNGER` dans
   * npc-needs.ts) :
   *   ① une corvée à cible introuvable/inatteignable retournait au tableau LIBRE → reprise en
   *      boucle à 20 Hz, sans jamais laisser la place à la corvée suivante. Elle QUITTE le tableau.
   *   ② le filtre de zone (ajouté pour la perf) INTERDISAIT toute cible hors zone → un village dans
   *      une zone sans buissons ne mangeait jamais. Devenu une PRÉFÉRENCE avec repli.
   *   ③ `handleSleep` passait avant `handleHunger` sans garde de faim → un dormeur ne mangeait
   *      JAMAIS, et franchissait son seuil de repas chaque nuit. La faim le RÉVEILLE désormais.
   *
   * Depuis, à 1 jour (le défaut) : trois villages, dix habitants, **zéro affamé**. Le seuil reste
   * une CIBLE DE DESIGN — on ne l'a jamais relâché vers 177, on a rendu le monde digne de lui.
   */
  it(`l'écosystème tient ${DAYS} jours : personne n'affame, les Feux gardent leur caractère`, { timeout: 900_000 }, () => {
    const report = runScenario(2026, DAYS)

    // Le rapport, pour l'humain (et l'agent) qui calibre balance.ts.
    console.log(`\n═══ Rapport de scénario — ${report.days} jours (${report.ticks} ticks) ═══`)
    // LE MONDE MESURÉ, EN TÊTE DU RAPPORT. Un rapport qui ne dit pas quel monde il a joué est
    // exactement ce qui a permis au banc de calibrer la faim, des mois durant, sur une carte
    // sans un seul coin de chasse.
    const m = report.monde
    console.log(
      `  monde : ${m.width}×${m.height} (${(m.width * m.height) / 1000 | 0}k tuiles, ${m.joueurs} joueurs cibles)` +
        ` · ${m.nodes} nœuds · ${m.huntingGrounds} coins de chasse · ${m.structuresBaties} structures de lieux` +
        ` · villages écartés de ${m.ecartMinVillages} tuiles, marge de ciblage ${m.margeDeCible} %`,
    )
    for (const v of report.villages) {
      console.log(
        `  ${v.name} [${v.archetype}] : ${v.membersAlive} membres, nourriture ${v.granaryFood}, bois ${v.granaryWood}`,
      )
    }
    console.log(`  morts d'avatars : ${report.deaths} · hordes : ${report.hordesSpawned} · échantillons affamés : ${report.starvationSamples}`)
    console.log(`\n─── Chronique (${report.chronicle.length} entrées) ───`)
    for (const line of report.chronicle.slice(0, 30)) console.log(`  ${line}`)

    // LA NON-RÉGRESSION DE FAMINE, l'invariant que ce banc garde. Seuil à 10 : quelques pics
    // isolés sont du bruit stochastique, un effondrement en produirait des dizaines — 177 avant
    // les correctifs du 2026-07-24, ZÉRO après (mesuré au défaut d'1 jour). Le seuil n'a jamais
    // été relâché vers 177 : c'est le MONDE qu'on a rendu digne de lui.
    expect(report.starvationSamples).toBeLessThanOrEqual(10)
    const foyer = report.villages.find((v) => v.archetype === 'foyer')
    expect(foyer).toBeDefined()
    expect(foyer!.membersAlive).toBeGreaterThan(0)
    expect(report.chronicle.length).toBeGreaterThan(2)
    // Le monde MESURÉ (coins de chasse, nœuds, marge de ciblage) est déjà tenu par le banc rapide
    // ci-dessus — ici on ne vérifie que ce qu'on y VIT. Depuis le 2026-09-22 le banc peuple par la
    // loi commune (`peuplerLesVoisins`) avec son propre compte, et l'assertion garde AUTRE CHOSE
    // que le banc rapide : elle dit qu'aucun village n'a DISPARU en cours de route, là-haut on ne
    // comptait que ceux qu'on venait de fonder.
    expect(report.villages.length, 'le banc a perdu un village en route').toBe(VILLAGES_DU_BANC)
  })

  /**
   * A8 (spec `meteo.md`), la tranche automatisée — le critère complet (6 cycles × 3 graines)
   * vit dans `tools/diag-meteo.mts`, resté manuel parce qu'il coûte dix-huit cycles ; ici on
   * garde CHAQUE exécution de suite contre la régression qui tuerait des PNJ sous la météo :
   * `pnpm test` n'armait `meteoActive` nulle part, donc une foudre qui se mettrait à frapper
   * les abrités, ou un front qui gèlerait les villageois, ne faisait rougir AUCUNE suite.
   */
  // Deux jours MINIMUM : le cycle 0 du calendrier du banc est une accalmie (mesuré — le
  // premier front est la pluie du cycle 1), et la prémisse `frontsVus > 0` doit pouvoir tenir.
  it(`A8 — la météo armée ne tue aucun PNJ (${Math.max(DAYS, 2)} jours, seed 2026)`, { timeout: 900_000 }, () => {
    const report = runScenario(2026, Math.max(DAYS, 2), undefined, { meteoActive: true })
    console.log(`  A8 : ${report.frontsVus} front(s) vus · morts foudre ${report.mortsFoudre} · morts froid ${report.mortsFroid}`)
    // La PRÉMISSE d'abord : sans front traversé, les deux zéros ne prouveraient rien.
    expect(report.frontsVus, 'aucun front n’a couvert le banc — la garde est vide').toBeGreaterThan(0)
    expect(report.mortsFoudre, 'la foudre a tué un PNJ (l’abri doit immuniser, R8)').toBe(0)
    // Le froid compte TOUTES ses morts (front ou nuit) : au banc court, le socle sans front
    // n'en cause aucune — le zéro est donc net, et un compte non nul accuse quoi qu'il en soit.
    expect(report.mortsFroid, 'le froid a tué un PNJ (les villageois doivent s’abriter)').toBe(0)
    // Et la famine ne doit pas se dégrader PARCE QUE la météo est là (le silence du gibier,
    // la conso des feux) : même seuil absolu que le banc par défaut.
    expect(report.starvationSamples).toBeLessThanOrEqual(10)
  })

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
  it('V-A9 — un villageois sait rentrer à son Feu, et le piège de 4096 est toujours là', { timeout: 120_000 }, () => {
    const { sim } = construireMondeDuBanc(2026)
    const village = sim.villages.find((v) => v.fireTx === 96 && v.fireTy === 360)
    expect(
      village,
      'le « Feu du Gué » n’est plus en (96,360) : le monde a bougé et ce test ne prouve plus rien',
    ).toBeDefined()
    const world: MoveWorld = {
      map: sim.map,
      structures: sim.structures,
      nodes: sim.nodes,
      moverVillageId: village!.id,
      opensDoors: true,
      etat: sim,
    }
    /** Le villageois figé, MESURÉ le 2026-09-22 : (115, 362). */
    const auFeu = (budget: number): unknown =>
      pathToward(world, 115.5, 362.5, village!.fireTx, village!.fireTy, budget)

    expect(
      auFeu(4096),
      'le piège de 4096 a disparu : plus aucun détour ne le dépasse ici, ce test ne garde plus rien',
    ).toBeNull()
    const chemin = auFeu(NPC_AI.PATH_EXPLORE) as { tx: number; ty: number }[] | null
    expect(chemin, 'un villageois ne sait plus rentrer à son Feu — V-R11 est rompue').not.toBeNull()
    // Le détour est LONG, et c'est tout l'enjeu : un chemin court voudrait dire que la
    // géographie a changé et que le test mesure autre chose.
    expect(chemin!.length, 'le retour est devenu court : ce n’est plus le même monde').toBeGreaterThan(100)
  })

})
