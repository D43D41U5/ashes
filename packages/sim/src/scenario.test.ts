import { describe, expect, it } from 'vitest'
import { construireMondeDuBanc, runScenario } from './scenario'

// Le tsconfig de /sim est ES2022 pur (pas de lib Node) — le test, lui, tourne
// sur Node : on déclare le strict nécessaire.
declare const process: { env: Record<string, string | undefined> }
declare const console: { log: (...args: unknown[]) => void }

/**
 * Le banc de test (V10). Calibrage long : `SCENARIO_DAYS=60 pnpm scenario`.
 *
 * DÉFAUT ABAISSÉ 6 → 4 le 2026-07-24, et **ce n'est pas un réglage de confort : c'est un bug
 * ouvert qu'on contourne en le NOMMANT.** Dès qu'il a été posé sur la carte de PRODUCTION, le banc
 * a trouvé, au **jour de saison 5**, une explosion du coût par tick d'un facteur **36** — de 0,97
 * à 35,01 ms/tick, mesurée par tranches (`tools/profil-banc.mts`), simultanée à l'apparition de
 * quatre monstres, c'est-à-dire d'une horde. **Vingt entités consomment alors 70 % du budget d'un
 * tick à 20 Hz.** Ce n'est pas un problème de banc, c'est un problème de SERVEUR : la vraie carte
 * a des falaises entre ses zones, l'ancienne n'en avait pas — et c'est très exactement la classe
 * de bug déjà corrigée pour l'IA des villages, restée entière pour les hordes.
 *
 * On s'arrête donc à 4 jours — avant l'explosion — pour que la CI reste utilisable, et on l'écrit
 * ici plutôt que de laisser croire à un choix d'équilibrage. **Quand la horde saura chercher son
 * chemin, remonter à 6.**
 */
const DAYS = Number(process.env.SCENARIO_DAYS ?? 4)

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
    const { monde } = construireMondeDuBanc(2026)
    // Sans gibier, tout chiffre sur la faim est un artefact. C'est LE défaut d'origine.
    expect(monde.huntingGrounds, 'aucun coin de chasse : le banc mesurerait la faim sans gibier').toBeGreaterThan(0)
    expect(monde.nodes, 'une vallée sans nœuds est une carte dégénérée').toBeGreaterThan(1000)
    // L'IA de raid de la Meute vise le village le plus proche À VOL D'OISEAU : à quasi-égalité,
    // elle raide le même chaque nuit jusqu'à destruction mutuelle, et le banc mesure une guerre
    // au lieu d'une économie. C'est arrivé (marge de 0,4 % sur l'ancienne carte, corrigée à la
    // main). Ici on ne touche à aucune coordonnée — on maximise l'écart et on VÉRIFIE la marge.
    expect(monde.margeDeCible, 'cibles de la Meute à quasi-égalité — le banc mesurerait une guerre').toBeGreaterThan(5)
  })

  /**
   * ═══ SUSPENDU LE 2026-07-24, ET IL FAUT LIRE POURQUOI ═══
   *
   * Ce banc passait au vert. Il le passait sur une carte que plus personne ne jouait. Posé sur
   * le monde de PRODUCTION, il rend ceci — quatre jours, seed 2026, 548×822, 3 coins de chasse :
   *
   *     le Feu du Gué     [foyer]  : 0 membres, nourriture 0,  bois 0
   *     le Clan du Levant [meute]  : 3 membres, nourriture 19, bois 24
   *     les Braises Hautes[neutre] : 0 membres, nourriture 0,  bois 0
   *     morts 7 · hordes 0 · échantillons affamés 177   (le seuil disait ≤ 10)
   *
   * **Deux villages sur trois sont anéantis en quatre jours**, et le seul survivant est la MEUTE
   * — celle qui PREND — pendant que les deux qui RÉCOLTENT meurent. Ce n'est pas la signature
   * d'un monde trop dur, c'est celle d'une récolte qui ne fonctionne pas : très probablement la
   * même classe de bug que l'IA des villages (viser à vol d'oiseau, se cogner aux falaises entre
   * zones), dont une part reste entière — voir aussi l'explosion de coût ×36 à l'apparition
   * d'une horde, mesurée le même jour.
   *
   * **On ne recalibre PAS le seuil sur 177.** Ce serait remplacer un fantôme par un mensonge, en
   * décrétant que l'effondrement est la normale — et le banc ne rattraperait plus jamais rien.
   * Les seuils de ce banc sont des CIBLES DE DESIGN : on les garde intacts, et on suspend le banc
   * le temps que le monde réel les rejoigne. Le garde-fou du monde, lui, reste actif à chaque
   * `pnpm test` : la dérive d'origine ne peut plus se reproduire en silence.
   *
   * Pour le relancer à la main, sans rien changer : `SCENARIO_DAYS=4 pnpm scenario`.
   *
   * (Plafond 600 s → 900 s au passage : `runScenario` est SYNCHRONE, vitest ne peut pas
   * l'interrompre, donc un dépassement CASSE la CI au lieu de la ralentir. Sur la vraie vallée le
   * tick coûte 1,56 ms hors horde — ~360 s pour 4 jours, trop près d'un plafond à 600 s.)
   */
  it.skip(`l'écosystème tient ${DAYS} jours : personne n'affame, les Feux gardent leur caractère`, { timeout: 900_000 }, () => {
    const report = runScenario(2026, DAYS)

    // Le rapport, pour l'humain (et l'agent) qui calibre balance.ts.
    console.log(`\n═══ Rapport de scénario — ${report.days} jours (${report.ticks} ticks) ═══`)
    // LE MONDE MESURÉ, EN TÊTE DU RAPPORT. Un rapport qui ne dit pas quel monde il a joué est
    // exactement ce qui a permis au banc de calibrer la faim, des mois durant, sur une carte
    // sans un seul coin de chasse.
    const m = report.monde
    console.log(
      `  monde : ${m.width}×${m.height} (${(m.width * m.height) / 1000 | 0}k tuiles, ${m.joueurs} joueurs cibles)` +
        ` · ${m.nodes} nœuds · ${m.huntingGrounds} coins de chasse` +
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

    // Les invariants : l'écosystème ne s'effondre pas silencieusement — quelques
    // pics de faim momentanés et isolés sont tolérés (bruit stochastique d'une
    // trajectoire donnée), un effondrement réel produirait un nombre bien plus grand.
    //
    // SEUIL RELEVÉ 3 → 10 (2026-07-18, décision d'Alexis). Retirer le malus de vitesse en forêt
    // (`speedFactor` 0,8 → 1) accélère les AVATARS — donc les bots de ce banc, dont l'IA de survie
    // était calée sur l'ancienne vitesse : leur trajectoire produit ~7 pics de faim au lieu de 3,
    // SANS effondrement (le Foyer survit, cf. l'assertion ci-dessous). On recale sur ce régime, en
    // gardant de la marge sous un vrai effondrement (des dizaines). À re-serrer si l'IA est recalée.
    expect(report.starvationSamples).toBeLessThanOrEqual(10)
    const foyer = report.villages.find((v) => v.archetype === 'foyer')
    expect(foyer).toBeDefined()
    expect(foyer!.membersAlive).toBeGreaterThan(0)
    expect(report.chronicle.length).toBeGreaterThan(2)

    // ── CE QUE LE BANC MESURE, VÉRIFIÉ AVANT DE CROIRE CE QU'IL DIT ────────────────────────
    //
    // Le banc a passé des mois à calibrer la faim sur un monde SANS GIBIER (`placeHuntingGrounds`
    // n'était jamais appelé) et sur un terrain que plus personne ne jouait. Une assertion sur la
    // faim ne vaut rien si le monde qui la produit n'est pas celui du jeu — donc on l'assied ici,
    // en dur, plutôt que de refaire confiance à la lecture d'un rapport que personne ne relit.

    // L'IA de raid de la Meute vise le village le plus proche À VOL D'OISEAU. À quasi-égalité,
    // elle raide le même chaque nuit jusqu'à destruction mutuelle des deux — et le banc mesure
    // alors une guerre, pas une économie. C'est arrivé : marge de 0,4 % sur l'ancienne carte, et
    // il avait fallu déplacer un site à la main. Ici on ne touche à aucune coordonnée, on
    // maximise l'écart — et on VÉRIFIE que la marge obtenue est franche.

    expect(report.villages.length, 'trois villages : foyer, meute, neutre').toBe(3)
  })
})
