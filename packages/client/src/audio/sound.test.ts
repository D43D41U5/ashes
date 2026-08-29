import { describe, expect, it } from 'vitest'
import type { SimEvent } from '@ashes/sim'
import { filtreDeDoublons, soundForEvent, VOIX_UNIQUE_PAR_TICK, type SoundSpec } from './sound'
import { MATIERES, SONORES, VOIX, variantesDe } from './inventaire'

/** Fabrique un événement synthétique (les champs superflus sont ignorés par le routage). */
const ev = (type: string, extra: Record<string, unknown> = {}): SimEvent =>
  ({ type, tick: 0, ...extra }) as unknown as SimEvent

/**
 * QUI A UNE VOIX, ET QUI N'EN A PAS — la table exhaustive vit dans `inventaire.ts`.
 *
 * Elle y a MONTÉ (elle était ici) le jour où le banc d'écoute est né : le banc doit lire au
 * runtime ce que le test vérifie, et une seconde copie aurait divergé au premier arbitrage.
 * La garantie n'a pas bougé — `Record<SimEvent['type'], …>` rend le fichier ROUGE tant que
 * personne n'a dit ce qu'une nouvelle variante fait entendre.
 *
 * Le monde émet **63 faits de domaine** ; **12 sonnent** (la porte depuis R26). Les autres étaient muets parce
 * que personne ne les avait regardés — pas parce qu'on avait décidé qu'ils se taisent. La
 * nuance compte : `sound.ts` dit lui-même en en-tête « ESTHÉTIQUE À VALIDER — je ne peux pas
 * ENTENDRE le résultat », et l'audit de GATE 1 classe le son « oreilles d'Alexis ». Un
 * silence choisi est un choix de design ; un silence par omission est un trou.
 *
 * Ce qui suit ne tranche donc RIEN d'esthétique — ça rend l'inventaire exact et impossible à
 * laisser dériver. La liste des `muet` est ce sur quoi Alexis a à se prononcer, au banc.
 */

describe('la table de routage audio (soundForEvent)', () => {
  it('sonne les faits qui comptent (récolte, coup, mort, hurlement, nuit)', () => {
    expect(soundForEvent(ev('resource_harvested', { entityId: 1 }), true)).not.toBeNull()
    expect(soundForEvent(ev('monster_slain'), false)).not.toBeNull()
    expect(soundForEvent(ev('wolf_howl', { targetEntityId: 1 }), true)).not.toBeNull()
    expect(soundForEvent(ev('night_started'), false)).not.toBeNull()
    expect(soundForEvent(ev('entity_died', { entityId: 1 }), true)).not.toBeNull()
  })

  it('reste MUET sur les faits non sonores (haute fréquence ou hors registre)', () => {
    expect(soundForEvent(ev('action_rejected', { entityId: 1 }), true)).toBeNull()
    expect(soundForEvent(ev('meal_eaten', { entityId: 1 }), true)).toBeNull()
    expect(soundForEvent(ev('season_day_started', { day: 3 }), false)).toBeNull()
  })

  it('« sur moi » vs « sur un autre » : encaisser diffère de toucher', () => {
    const onMe = soundForEvent(ev('entity_damaged', { entityId: 1 }), true)!
    const onOther = soundForEvent(ev('entity_damaged', { entityId: 2 }), false)!
    expect(onMe.wave).not.toBe(onOther.wave) // choc mat (bruit filtré) ≠ « tac » clair
  })

  it('la récolte ne sonne QUE pour moi (pas les PNJ, sinon un vacarme de fond)', () => {
    expect(soundForEvent(ev('resource_harvested', { entityId: 1 }), false)).toBeNull()
  })

  it("CHAQUE fait de domaine a une voix ou un silence DÉCIDÉ — aucun par omission", () => {
    // La table est exhaustive par le compilateur ; ce test vérifie qu'elle dit la VÉRITÉ sur
    // le routage réel. Les deux moitiés comptent : un `voix` qui ne sonne pas est une promesse
    // non tenue, un `muet` qui sonne est un son que personne n'a voulu.
    const desaccords: string[] = []
    for (const [type, attendu] of Object.entries(VOIX)) {
      // On essaie les deux points de vue : plusieurs sons ne se déclenchent que « sur moi ».
      const sonne =
        soundForEvent(ev(type, { entityId: 1 }), true) !== null ||
        soundForEvent(ev(type, { entityId: 2 }), false) !== null
      const vu = sonne ? 'voix' : 'muet'
      if (vu !== attendu) desaccords.push(`${type} : table dit « ${attendu} », routage fait « ${vu} »`)
    }
    expect(desaccords).toEqual([])
  })

  it("l'inventaire tranché de GATE 1 : 94 faits, 57 voix", () => {
    // Un compte, pas un jugement. S'il bouge, c'est qu'un fait de domaine est né ou qu'une
    // voix a changé — dans les deux cas, quelqu'un doit le savoir.
    const total = Object.keys(VOIX).length
    const voix = SONORES.length
    // 63 → 64 faits et 37 → 38 voix le 2026-07-31 : `reveil_etouffe` naît (spec cendreux R21) —
    // le feu qui étouffe un réveil est LA PARADE, et une parade muette ne s'apprend pas. Il se
    // joue comme `cendreux_risen` à l'ENVERS (147→98 au lieu de 98→147) : même timbre, chemin
    // inverse — le joueur n'a pas un second son à apprendre, il entend le même fait annulé.
    // 64 → 66 faits et 38 → 39 voix le 2026-07-31 : `village_stage_up` (une voix — le fait
    // saillant du chantier villages-PNJ, le jumeau grave de `fire_upgraded`) et
    // `settler_arrived` (muet, comme le `member_joined` qu'il accompagne toujours).
    // 66 → 67 le 2026-08-01 : `recipe_revealed` (D2), muet par décision — voir `inventaire.ts`.
    // 67 → 68 faits et 39 → 40 voix le 2026-08-16 : `bird_flush` (forêts-vivantes §3) — l'envol
    // de la lisière, un signal square qui MONTE : la forêt vous a dénoncé.
    // 68 → 73 faits et 40 → 43 voix le 2026-08-18 : LA BRUME naît (spec brume.md) — l'annonce
    // (sine qui descend : le froid qui vient), la levée (noise sourd : la matière de la nappe)
    // et le filon (triangle qui monte : l'ouverture). Le retrait de la nappe et `filon_retire`
    // restent muets, par le principe des menaces qui s'en vont (`horde_dispersed`).
    // 73 → 76 le 2026-08-19 : le blizzard (météo R9) naît MUET trois fois (`blizzard_annonce`/
    // `_entre`/`_passe`) — le vent est une nappe du chantier audio météo, pas un one-shot.
    // 76 → 77 faits et 43 → 44 voix le 2026-08-19 : `crop_frozen` naît SONORE (spec
    // `flore-froid.md` F5) — c'est la seule PERTE que le froid inflige, et une perte
    // silencieuse ne s'apprend pas : un joueur qui ne l'entend pas ne comprend pas
    // pourquoi sa parcelle est vide au matin. Triangle qui descend, bref et bas (une
    // rangée de parcelles gèle d'un coup).
    // 77 → 80 le 2026-08-21 : la pression croissante des Cendreux (cri, présage, brûlage).
    // 80 → 81 le 2026-08-21 : `refugee_rumeur` (annales.md R12), silence DÉCIDÉ — le geste
    // (refugees_fed) parle déjà ; deux sons sur une action seraient un doublé.
    // 81 → 82 le 2026-08-21 : `cendre_prend` (P5a), silence décidé — souvent lointain.
    // 82 → 85 le 2026-08-22 : LA PÊCHE (spec peche.md) — `fish_bite` SONNE (triangle qui
    // DESCEND, 70 ms : le flotteur plonge — le télégraphe d'une fenêtre de 250-600 ms, l'oreille
    // devance l'œil), `fish_escaped` SONNE (un plouf mou, plus bas et plus long : « trop tard »),
    // `fish_caught` MUET — il tombe sur `resource_harvested`, qui parle déjà au même tick.
    // 85 → 86 le 2026-08-22 : `carcass_cut` (spec depecage.md) SONNE — la sœur du coup de récolte,
    // plus basse et plus mate (une lame dans la chair) ; le seul retour du maintien, sans jauge.
    // 86 → 90 le 2026-08-24 : la refonte de la pêche (peche.md D9-D12) — `fish_nibble` SONNE
    // (un clapotis minuscule qui monte : « il y a quelque chose, mais ce n'est pas ça » — sans
    // lui, D11 n'a aucun retour d'information), `fishing_cancelled` SONNE (la ligne rentre
    // faute d'eau, et une ligne qui disparaît sans un mot est un bug aux yeux du joueur),
    // `fish_record` SONNE et s'entend de LOIN (la plus grosse prise d'une vie est un fait de
    // village), `fishing_junk` MUET (il tombe sur `resource_harvested`, comme `fish_caught`).
    // 90 → 92 le 2026-08-26 : la TORCHE (spec `torche.md`) — `torche_allumee` naît MUETTE (geste
    // répété, et la lumière qui naît le dit déjà), `torche_eteinte` PARLE : c'est l'instant où la
    // nuit se referme, et le joueur ne regarde pas sa ceinture à ce moment-là. Donc +2 faits, +1 voix.
    expect(total).toBe(94)
    // 34 → 35 le 2026-07-29 : `node_depleted` a gagné sa voix (trois, selon la matière).
    // 61 → 62 faits et 35 → 36 voix le 2026-07-30 : `door_toggled` naît (spec construction R26).
    // 62 → 63 faits et 36 → 37 voix le 2026-07-31 : `cendreux_prowl` naît (spec cendreux R11bis) —
    // le pendant du hurlement pour les morts, quand la nuit bascule d'espèce avec les actes.
    // 44 → 47 le 2026-08-21 : `cendreux_cri`, `presage_horde`, `charnier_brule` — trois voix.
    // 47 → 49 le 2026-08-22 : `fish_bite`, `fish_escaped` — deux voix (voir ci-dessus).
    // 49 → 50 le 2026-08-22 : `carcass_cut` — une voix (voir ci-dessus).
    // 50 → 53 le 2026-08-24 : `fish_nibble`, `fishing_cancelled`, `fish_record` (voir ci-dessus).
    // 90 → 92 le 2026-08-26 : la TORCHE (spec `torche.md`) — `torche_allumee` naît MUETTE (geste
    // répété, et la lumière qui naît le dit déjà), `torche_eteinte` PARLE : c'est l'instant où la
    // nuit se referme, et le joueur ne regarde pas sa ceinture à ce moment-là. Donc +2 faits, +1 voix.
    // 56 → 57 le 2026-08-28 : `blizzard_annonce` sort du silence (chantier audio météo) —
    // le jumeau grave du préavis de Brume ; `entre`/`passe` restent à la nappe du vent.
    expect(voix).toBe(57)
  })

  it('L’AXE D’ALIGNEMENT S’ENTEND : les verbes chauds montent, les froids tombent', () => {
    // Le principe qui a décidé la famille SOCIAL, et la seule chose qui la rende lisible à
    // l'oreille avant qu'on en ait appris les mots. Une retouche de timbre qui inverserait
    // une pente casserait le sens sans casser aucun autre test — celui-ci la rattrape.
    const spec = (t: string): SoundSpec => soundForEvent(ev(t, { entityId: 2 }), false)!
    for (const chaud of ['gift_given', 'refugees_fed', 'refugees_recruited', 'refugees_arrived']) {
      const s = spec(chaud)
      expect(s.freqEnd, `${chaud} doit MONTER`).toBeGreaterThan(s.freq)
    }
    for (const froid of ['refugees_robbed', 'member_banished']) {
      const s = spec(froid)
      expect(s.freqEnd, `${froid} doit TOMBER`).toBeLessThan(s.freq)
      // Le timbre du prédateur, réservé aux verbes froids et à la horde qui marche.
      expect(s.wave, `${froid} est un verbe froid`).toBe('sawtooth')
    }
  })

  it('la CHUTE D’UN VILLAGE pèse plus lourd qu’une mort d’homme', () => {
    // Une hiérarchie qu'on ne peut pas expliquer au joueur : elle doit s'entendre. Un village
    // qui tombe est plus qu'une personne qui s'éteint — c'est plus long, et plus grave.
    const village = soundForEvent(ev('village_fell', { villageId: 3 }), false)!
    const homme = soundForEvent(ev('entity_died', { entityId: 2 }), false)!
    expect(village.dur).toBeGreaterThan(homme.dur)
    expect(village.freqEnd!).toBeLessThan(homme.freqEnd!)
  })

  it('tous les gains restent BAS et les durées positives (décor sonore, pas arcade)', () => {
    // ⚠ TOUTES LES VARIANTES, pas seulement la branche par défaut. Trois faits se dédoublent
    // sur un champ de leur charge utile (`variantesDe`) : sans les poser, `ev()` ne joue que
    // le `default` — les treize voix de matière du coup de récolte et les trois du nœud qui meurt
    // passaient le plafond sur le dos d'UNE voix que le jeu n'emprunte presque jamais. Une
    // garde qui n'atteint pas tout son domaine donne le bon verdict par accident.
    for (const type of SONORES) {
      for (const champs of [{}, ...variantesDe(type).map((v) => v.champs)]) {
        const s = soundForEvent(ev(type, { entityId: 1, ...champs }), true)
        expect(s, type).not.toBeNull()
        expect(s!.gain, type).toBeGreaterThan(0)
        expect(s!.gain, type).toBeLessThanOrEqual(0.15)
        expect(s!.dur, type).toBeGreaterThan(0)
      }
    }
  })

  /**
   * ═══ LE COUP DE RÉCOLTE — TREIZE VOIX, ET UNE ENVELOPPE QUI LES BORNE ═══
   * (demande d'Alexis, 2026-08-27 : « bruit de pioche pour la pierre, hache pour le bois ».)
   *
   * Ce que ces tests gardent n'est PAS le timbre — il est posé sans l'entendre et se rejuge au
   * banc. C'est ce qui rend le timbre libre : la CADENCE (un coup par seconde) et le
   * CONTRASTE qui rend les deux gestes reconnaissables sans qu'on les explique.
   */
  describe('la récolte parle la matière', () => {
    const coup = (nodeType?: string): SoundSpec =>
      soundForEvent(ev('resource_harvested', { entityId: 1, ...(nodeType ? { nodeType } : {}) }), true)!

    it('CHAQUE matière du monde a une voix — aucune ne tombe dans le trou du défaut', () => {
      // La vraie garde du chantier : `MATIERES` est exhaustif sur `NodeType` par le compilateur,
      // donc une matière neuve arrive ICI. Si personne ne lui a écrit de `case`, elle rend le
      // `square` d'interface — le bip d'avant, exactement ce qu'on est en train de retirer — et
      // la panne serait MUETTE : un son sort, il est juste faux.
      const sansMatiere = JSON.stringify(coup())
      const orphelines = Object.keys(MATIERES).filter((m) => JSON.stringify(coup(m)) === sansMatiere)
      expect(orphelines).toEqual([])
    })

    it('un geste qu’on répète à la seconde reste COURT — sauf ce qui n’arrive jamais en rafale', () => {
      // `GATHER_COOLDOWN_TICKS` = une seconde. Une hache « épaisse » de 200 ms est
      // insupportable au troisième coup, et rien d'autre ne l'attraperait. Les deux
      // dérogations se justifient par la cadence : une prise par cycle de touche, un
      // glanage par nœud (`stock: 1`) — jamais dix d'affilée.
      const CADENCE_LIBRE = new Set(['fishing_spot_river', 'fishing_spot_lake', 'branche_au_sol', 'pierre_au_sol'])
      for (const m of Object.keys(MATIERES)) {
        if (CADENCE_LIBRE.has(m)) continue
        expect(coup(m).dur, m).toBeLessThanOrEqual(0.08)
        expect(coup(m).gain, m).toBeLessThanOrEqual(0.06)
      }
    })

    it('LA HACHE est basse et pleine, LA PIOCHE haute et sèche — le contraste est le message', () => {
      // Le seul axe que le bruit offre (`buildSound` ignore la hauteur du `noise`), donc le
      // seul par lequel un joueur peut apprendre les deux gestes les yeux fermés. Une retouche
      // au banc qui les rapprocherait casserait la lisibilité sans casser rien d'autre.
      for (const bois of ['tree', 'old_tree']) {
        for (const pierre of ['rock', 'quarry']) {
          expect(coup(bois).lowpass!, `${bois} < ${pierre}`).toBeLessThan(coup(pierre).lowpass!)
          expect(coup(bois).dur, `${bois} > ${pierre}`).toBeGreaterThan(coup(pierre).dur)
        }
      }
    })

    it('LA MAIN ne se fait pas remarquer : plus discrète que tout ce qui se frappe', () => {
      // On cueille des dizaines de fois par jour. Le jour où le froissement du buisson pèse
      // autant qu'un coup de hache, la cueillette devient fatigante — et personne ne saura dire
      // pourquoi. `ash_heap` compris : la matière qui n'oppose rien.
      const MAIN = ['fiber_plant', 'berry_bush', 'champignon', 'leaf_pile', 'fumerolle', 'ash_heap']
      const OUTIL = ['tree', 'old_tree', 'rock', 'quarry', 'iron_vein', 'coal_seam']
      const plusFort = Math.max(...MAIN.map((m) => coup(m).gain))
      const plusFaible = Math.min(...OUTIL.map((m) => coup(m).gain))
      expect(plusFort).toBeLessThan(plusFaible)
    })

    it('LE GLANAGE ne sonne pas comme l’outil — c’est toute la raison de `nodeType`', () => {
      // `branche_au_sol` rend `wood` comme le tronc et `pierre_au_sol` rend `stone` comme le
      // rocher : un routage sur l'OBJET ferait sonner la hache et la pioche quand on se baisse,
      // pendant les dix minutes de glanage qui amorcent la rampe d'outils. Ce test est la
      // preuve que le champ ajouté au fait de domaine sert bien à ça.
      expect(coup('branche_au_sol')).not.toEqual(coup('tree'))
      expect(coup('branche_au_sol').gain).toBeLessThan(coup('tree').gain)
      expect(coup('pierre_au_sol').gain).toBeLessThan(coup('rock').gain + 0.0001)
    })

    it('sans matière, on ne fait pas semblant d’en avoir une', () => {
      // La trouvaille ferrée (`nodeId: -1`) : la confirmation d'interface garde ici sa place,
      // et seulement ici. `square` est, dans la grammaire de la maison, « un signal » — pas
      // de la matière. Lui donner un timbre de matière serait mentir sur ce qu'on sait.
      expect(coup().wave).toBe('square')
      // …et la récolte reste MUETTE pour les autres, matière ou pas : sinon un village qui
      // bûcheronne ferait un vacarme de fond. La garde vaut pour toutes les branches neuves.
      for (const m of [undefined, ...Object.keys(MATIERES)]) {
        expect(soundForEvent(ev('resource_harvested', { entityId: 2, ...(m ? { nodeType: m } : {}) }), false), m).toBeNull()
      }
    })
  })

  /**
   * ═══ UNE SEULE VOIX PAR TICK — ET LE MUET NE PREND PAS LE TOUR DU SONORE ═══
   *
   * La règle existait déjà pour les deux battants d'une porte double, en dur au milieu de la
   * boucle d'événements de `WorldScene`. Elle en SORT le jour où la récolte en a besoin (le
   * butin de maîtrise émet DEUX `resource_harvested` au même tick) — parce qu'elle est devenue
   * piégeuse, et qu'une règle piégeuse écrite dans une boucle de rendu n'a aucun test possible.
   */
  describe('une seule voix par tick', () => {
    it('le second fait du MÊME type au MÊME tick se tait ; le tick suivant reparle', () => {
      const garder = filtreDeDoublons()
      expect(garder('resource_harvested', 40, true)).toBe(true) // la poignée
      expect(garder('resource_harvested', 40, true)).toBe(false) // la graine, au même tick
      expect(garder('resource_harvested', 41, true)).toBe(true) // le coup suivant
    })

    it('LA RÉCOLTE MUETTE D’UN PNJ N’AVALE PAS MON COUP DE HACHE', () => {
      // LE défaut pour lequel cette règle est sortie de `WorldScene`. Les PNJ émettent
      // `resource_harvested` sans arrêt, le snapshot verse TOUS les faits sans les filtrer, et
      // leur récolte est muette (`onMe`). Une écriture qui réserve le tick AVANT de savoir s'il
      // y a un son laisse le bûcheron du village manger mon coup — par intermittence, et sous
      // forme de SILENCE, c'est-à-dire la panne qu'on ne peut pas repérer en jouant.
      const garder = filtreDeDoublons()
      expect(garder('resource_harvested', 40, false)).toBe(false) // un PNJ : rien à jouer…
      expect(garder('resource_harvested', 40, false)).toBe(false) // …et ils sont plusieurs…
      expect(garder('resource_harvested', 40, true)).toBe(true) // …MON coup passe quand même
    })

    it('les faits ordinaires ne sont JAMAIS dédoublonnés — deux loups hurlent deux fois', () => {
      // La règle ne vaut que pour les deux faits que la sim dédouble VRAIMENT. L'étendre à tout
      // ferait taire deux morts au même tick, ce qui est un fait de jeu et pas un doublon.
      const garder = filtreDeDoublons()
      expect(garder('wolf_howl', 40, true)).toBe(true)
      expect(garder('wolf_howl', 40, true)).toBe(true)
      expect(VOIX_UNIQUE_PAR_TICK.has('entity_died')).toBe(false)
    })

    it('et ce sont bien CES deux faits-là, pas d’autres', () => {
      expect([...VOIX_UNIQUE_PAR_TICK].sort()).toEqual(['door_toggled', 'resource_harvested'])
    })
  })
})
