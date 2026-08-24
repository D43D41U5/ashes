/**
 * ═══ LE CONTRAT DE REJEU, SUR LE MONDE QU'ON JOUE ═══
 *
 * L'invariant n°2 du projet — « même seed + mêmes inputs = même état ET même flux
 * d'événements » — est la fondation du replay-log, de la persistance et du futur multi.
 * Il était prouvé sur des PRAIRIES VIDES de 24 à 160 tuiles.
 *
 * Les treize sites de `runReplay` du dépôt construisent tous leur monde avec
 * `createEmptyMap` : aucun ne passe `faunaCap`, `grounds`, `home` ni `meteoActive`. Ce qui
 * n'était donc JAMAIS rejoué, alors que le jeu l'arme :
 *
 *   • le tirage AMBIANT de la faune (`faune.ts`) — l'un des cinq seuls consommateurs du
 *     PRNG partagé, donc celui qui décale tout le flux s'il diverge ;
 *   • la CENDRE — le seul système qui change la composition de `state.nodes` en cours de
 *     partie ; sans `map.cendre`, `avancerLaCendre` sort à sa première ligne ;
 *   • la MÉTÉO et la FOUDRE, qui sortent immédiatement sans `meteoActive` ;
 *   • le terrain ZONÉ lui-même, ses nœuds par zone, ses coins de chasse, ses lieux bâtis
 *     et ses monstres de POI — c'est-à-dire tout ce que l'hôte pose avant le premier tick.
 *
 * On joue donc ICI le monde de production : le VRAI générateur, sur le VRAI plan
 * (`MONDE_JOUE`), armé comme `worker/veillee.ts` et `server/scenario.ts` l'arment.
 *
 * LA TAILLE EST RÉDUITE, ET C'EST ASSUMÉ. Ce qui fait diverger un rejeu n'est pas le nombre
 * de tuiles, c'est la VARIÉTÉ des systèmes qui tirent et mutent — et elle est intégralement
 * présente à huit joueurs : mêmes passes de génération, même plan, mêmes zones, même faune,
 * même météo. La taille de production, elle, est déjà gardée ailleurs (`zonegen.test.ts`
 * A12, `monde-reduit.test.ts` A-MR3) : ces deux gardes-là prouvent que la CARTE est
 * déterministe, jamais que le MONDE VIVANT au-dessus l'est. C'est ce trou-ci qu'on ferme.
 */
import { describe, expect, it } from 'vitest'
import { BALANCE, FAUNA } from './balance'
import { drainEvents, type SimEvent } from './events'
import { placeHuntingGrounds } from './faune'
import { buildPoiStructures } from './poi-batis'
import { spawnPoiMonsters } from './poi'
import { createReplayLog, recordAndStep, runReplay } from './replay'
import { createSim, snapshot, spawnEntity, step, type MoveInput, type SimOptions, type SimState } from './sim'
import { cycleOffsetForStartHour, jourDeSaison, TICKS_PER_SEASON_DAY } from './time'
import { MONDE_JOUE } from './zonegraph'
import { generateZonedTerrain } from './zonegen'
import { placeZoneNodes } from './zone-content'

const SEED = 2026
const JOUEURS = 8
const TICKS = 400

/** Le monde tel que les trois hôtes le bâtissent — même ordre, mêmes graines. */
function mondeJoue(): { options: SimOptions; peupler: (s: SimState) => void } {
  const carte = generateZonedTerrain(SEED, JOUEURS, MONDE_JOUE)
  const nodes = placeZoneNodes(carte)
  const grounds = placeHuntingGrounds(carte.map, SEED)
  // Le foyer : les trois cercles de danger s'y adossent (`predatorBias` lit `state.home`).
  const home = { x: Math.floor(carte.map.width / 2) + 0.5, y: Math.floor(carte.map.height / 2) + 0.5 }
  const options: SimOptions = {
    map: carte.map,
    nodes,
    grounds,
    home,
    faunaCap: FAUNA.CAP,
    meteoActive: true,
    worldEvents: true,
    cycleOffset: cycleOffsetForStartHour(9),
    // ⚠ CALENDRIER ACCÉLÉRÉ, ET C'EST LE SUJET. La Cendre ne fait quelque chose qu'au
    // BASCULEMENT d'un jour de saison (`sim.ts` ne l'appelle qu'à cette condition) : au
    // calendrier par défaut, quatre cents ticks n'en franchissent aucun, et le seul système
    // qui change la composition de `state.nodes` en cours de partie ne serait JAMAIS rejoué.
    // Le test aurait couvert moins qu'il ne le prétend — le défaut exact qu'on ferme ici.
    //
    // Le chiffre se dérive, il ne se devine pas : `seasonDayAtTick` franchit un jour tous les
    // `TICKS_PER_SEASON_DAY / calendarScale` ticks, soit 1 728 000 / échelle. Pour que TICKS
    // en franchisse au moins trois, il faut une échelle ≥ 3 × 1 728 000 / TICKS. (Premier
    // essai à 720 : aucun jour franchi, et c'est la garde de prémisse de T3bis qui l'a dit —
    // pas moi.)
    calendarScale: Math.ceil((3 * TICKS_PER_SEASON_DAY) / TICKS),
    // ⚠ ET LE MONDE OUVRE AU GRAND FROID, POUR LA MÊME RAISON. La Cendre ne s'ébranle que
    // pendant la quatrième saison (`CENDRE.ACTE_DEPART`, spec `saisons.md` S11 : « il mord
    // l'hiver, tient l'été ») : ouvert au jour 1 comme le fait `createSim` par défaut, le
    // front reste à zéro, `avancerLaCendre` sort à sa deuxième ligne, et le seul système qui
    // change la composition de `state.nodes` ne serait toujours pas rejoué. Le jour se dérive
    // de la cadence des saisons, jamais écrit : premier jour de la quatrième.
    jourDeDepart: 3 * BALANCE.ACT_DAYS + 1,
  }
  // CE QUE L'HÔTE POSE APRÈS `createSim` doit vivre dans le `setup` du rejeu : ces deux
  // passes MUTENT l'état et lisent la graine. Les oublier ferait diverger le rejeu pour une
  // raison qui n'a rien à voir avec le tick — et on croirait avoir prouvé le contraire.
  const peupler = (s: SimState): void => {
    spawnPoiMonsters(s, SEED)
    buildPoiStructures(s, SEED)
    spawnEntity(s, home.x, home.y)
  }
  return { options, peupler }
}

describe('le rejeu sur le monde de production', () => {
  it('T3 — même seed + mêmes inputs = même état, faune, météo, cendre et lieux compris', () => {
    const { options, peupler } = mondeJoue()

    const live = createSim(SEED, options)
    const log = createReplayLog(SEED, options)
    peupler(live)
    for (let t = 0; t < TICKS; t++) {
      const inputs: MoveInput[] = [{ entityId: 1, dx: t % 3 === 0 ? 1 : 0, dy: t % 5 === 0 ? 1 : 0 }]
      recordAndStep(live, log, inputs)
    }

    const rejoue = runReplay(log, peupler)
    expect(snapshot(rejoue)).toBe(snapshot(live))
  }, 300_000)

  it('T3bis — la garde VOIT ce qu’elle garde : le monde rejoué est bien VIVANT', () => {
    // Une garde de déterminisme passe trivialement sur un monde inerte. On affirme donc
    // d'abord que les systèmes qu'on prétend rejouer ONT tourné — sinon on prouverait que
    // deux prairies vides se ressemblent. (C'est le défaut exact que l'audit a trouvé dans
    // `carte-immuable.test.ts`, dont le commentaire annonce « pendant que la faune fait son
    // travail » alors qu'il ne passe ni `faunaCap` ni `grounds`.)
    const { options, peupler } = mondeJoue()
    const s = createSim(SEED, options)
    peupler(s)
    drainEvents(s)
    const vecu: SimEvent[] = []
    for (let t = 0; t < TICKS; t++) {
      step(s, [{ entityId: 1, dx: 1, dy: 0 }])
      vecu.push(...drainEvents(s))
    }

    expect(s.map.cendre?.length ?? 0, 'la carte porte le champ de cendre').toBeGreaterThan(0)
    expect(jourDeSaison(s), 'des JOURS DE SAISON ont basculé (sinon la Cendre dort)')
      .toBeGreaterThan(jourDeSaison(s, 0))
    // …ET LE FRONT A MORDU. Porter le champ de cendre ne prouve que sa PRÉSENCE : tant que le
    // monde ouvrait à l'Éclosion, le front valait zéro et `avancerLaCendre` ressortait aussitôt.
    // La garde ne voyait donc pas ce qu'elle annonce en tête de fichier ; elle le voit ici.
    expect(vecu.filter((e) => e.type === 'cendre_avance').length, 'la Cendre a mangé des nœuds')
      .toBeGreaterThan(0)
    expect(s.nodes.length, 'des nœuds par zone').toBeGreaterThan(1000)
    expect(s.structures.length, 'des lieux BÂTIS').toBeGreaterThan(50)
    expect(s.monsters.length, 'de la faune vivante').toBeGreaterThan(0)
    expect(vecu.length, 'et le monde a produit des événements').toBeGreaterThan(0)
  }, 300_000)
})
