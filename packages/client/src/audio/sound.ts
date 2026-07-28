/**
 * LE SON — le premier échafaudage audio (l'audit : 0 son, « fatal au chef-d'œuvre »).
 *
 * WebAudio PROCÉDURAL, zéro asset externe (CSP : rien à charger). On sépare deux choses :
 *  - le CÂBLAGE (quel événement → quel son) : une table PURE, testable — `soundForEvent`.
 *  - la SYNTHÈSE (comment un son sonne) : `buildSound`, qui monte un petit graphe WebAudio.
 *
 * ⚠ ESTHÉTIQUE À VALIDER — je ne peux pas ENTENDRE le résultat. Les sons sont volontairement
 * SOBRES et BAS (gains ~0,04-0,12), coupables au besoin (mute) : un pis-aller qui ne doit pas
 * gêner le playtest, pas un design sonore final. À régler à l'oreille par Alexis (l'audit le
 * classe « oreilles »). Le SYSTÈME, lui, est vérifiable (routage + niveaux/durées des buffers).
 */
import type { SimEvent } from '@braises/sim'

export type Waveform = 'sine' | 'triangle' | 'square' | 'sawtooth' | 'noise'

/** Un son procédural : une forme, une enveloppe, un glissando optionnel, un filtre optionnel. */
export interface SoundSpec {
  wave: Waveform
  /** Fréquence de départ (Hz) ; ignorée pour `noise`. */
  freq: number
  /** Glissando vers cette fréquence sur la durée (Hz). Absent = tenue. */
  freqEnd?: number
  /** Durée totale (s). */
  dur: number
  /** Gain crête (0..1) — GARDÉ BAS : le monde n'est pas un jeu d'arcade. */
  gain: number
  /** Coupe-bas (Hz) — surtout pour le bruit (impacts feutrés). */
  lowpass?: number
}

/**
 * LA TABLE DE ROUTAGE (pure) : un événement de domaine → un son, ou `null` (silencieux).
 * `onMe` distingue « ça m'arrive » de « ça arrive à un autre ».
 *
 * ── LA GRAMMAIRE ────────────────────────────────────────────────────────────────────────
 * Elle n'a pas été inventée : elle se LISAIT déjà dans les dix sons de l'échafaudage, et les
 * vingt-quatre voix ajoutées le 2026-07-28 s'y rangent. L'écrire, c'est ce qui empêche le
 * prochain son d'être un son de plus au lieu d'un mot de la même langue.
 *
 *  LE SENS — une hauteur qui MONTE ouvre (arrivée, don, palier, découverte) ; une hauteur qui
 *  DESCEND ferme (mort, chute, feu à sec, acte qui serre). C'est la règle la plus forte : le
 *  joueur apprend le sens d'un son avant d'en apprendre le mot.
 *
 *  LA MATIÈRE — `sine` : le monde et la cérémonie (la nuit, la saison, un village qui tombe).
 *  `triangle` : un fait sur un corps ou une chose. `square` : un signal, une confirmation
 *  d'interface (l'alarme, la récolte, l'objet fini). `noise` : la matière et la chair (le
 *  choc, la plaie, la cendre, ce qui s'effondre). `sawtooth` était INEMPLOYÉ : il devient
 *  la voix du PRÉDATEUR — dépouiller, bannir, la horde qui marche. Le verbe froid a son
 *  timbre, et l'axe d'alignement s'entend.
 *
 *  LE POIDS — gain et durée disent l'échelle, jamais le volume seul : 0,05 / 0,1 s pour un
 *  geste, 0,08 / 0,5 s pour un fait de village, 0,11 / 1,4 s pour ce qui ne revient pas.
 *  Plafond 0,15 tenu par test — le son reste un DÉCOR (`MASTER_GAIN` le repasse à 0,6).
 *
 * ⚠ ESTHÉTIQUE : ces valeurs sont des PROPOSITIONS posées sans les entendre (voir l'en-tête
 * du fichier). Elles se rejugent et se retouchent au banc d'écoute (`banc-son.html`), qui
 * rend la ligne à coller ici. Ce qui est arrêté, c'est QUI a une voix ; pas encore laquelle.
 */
export function soundForEvent(event: SimEvent, onMe: boolean): SoundSpec | null {
  switch (event.type) {
    // ── LE CORPS ET LA BÊTE ──────────────────────────────────────────────────────────────
    case 'entity_damaged':
      // Encaisser (sur moi) : un choc mat et grave. Toucher (un autre) : un « tac » plus clair.
      return onMe
        ? { wave: 'noise', freq: 0, dur: 0.16, gain: 0.12, lowpass: 700 }
        : { wave: 'triangle', freq: 320, freqEnd: 220, dur: 0.08, gain: 0.06 }
    case 'entity_died':
      return { wave: 'sine', freq: 160, freqEnd: 70, dur: 1.1, gain: 0.11 }
    case 'monster_slain':
      return { wave: 'triangle', freq: 180, freqEnd: 90, dur: 0.22, gain: 0.1 }
    case 'wolf_howl':
      return { wave: 'sine', freq: 520, freqEnd: 240, dur: 0.7, gain: 0.09 }

    // ── LA PLAIE ─────────────────────────────────────────────────────────────────────────
    case 'entity_bandaged':
      return { wave: 'noise', freq: 0, dur: 0.14, gain: 0.05, lowpass: 1400 }
    // Une plaie qui s'OUVRE. Elle sonne aussi pour les autres, et c'est tout son objet :
    // rien à l'écran ne dit qu'un PNJ saigne, or on peut désormais le panser. Plus claire
    // (coupe à 1100) et plus longue que le choc d'`entity_damaged` : une déchirure, pas un coup.
    case 'wound_inflicted':
      return { wave: 'noise', freq: 0, dur: 0.22, gain: 0.085, lowpass: 1100 }

    // ── LE FEU — l'organe vital ──────────────────────────────────────────────────────────
    // À SEC : le fait qui condamne les murs, et qui se produisait sans un bruit. Grave,
    // étouffé (coupe 900), long : quelque chose s'affaisse vers l'intérieur.
    case 'fire_starved':
      return { wave: 'triangle', freq: 190, freqEnd: 96, dur: 0.8, gain: 0.1, lowpass: 900 }
    case 'fire_extinguished':
      return { wave: 'noise', freq: 0, dur: 0.34, gain: 0.055, lowpass: 620 } // le souffle qui meurt
    case 'fire_relit':
      return { wave: 'triangle', freq: 220, freqEnd: 330, dur: 0.26, gain: 0.07, lowpass: 1800 } // ça reprend
    case 'fire_upgraded':
      return { wave: 'sine', freq: 262, freqEnd: 392, dur: 0.55, gain: 0.085 } // une quinte : le village grandit
    // `fire_fed` reste MUET : geste répété bûche après bûche, et la flamme qui monte le dit déjà.

    // ── LE SOCIAL — l'axe d'alignement, rendu audible ────────────────────────────────────
    // Les verbes CHAUDS montent (triangle/sine), les verbes FROIDS descendent (sawtooth).
    case 'gift_given':
      return { wave: 'triangle', freq: 330, freqEnd: 494, dur: 0.28, gain: 0.065 }
    case 'refugees_arrived':
      return { wave: 'triangle', freq: 392, freqEnd: 523, dur: 0.3, gain: 0.06 }
    case 'refugees_fed':
      return { wave: 'triangle', freq: 294, freqEnd: 392, dur: 0.26, gain: 0.06 }
    case 'refugees_recruited':
      return { wave: 'sine', freq: 262, freqEnd: 440, dur: 0.5, gain: 0.075 } // le plus large des chauds : ils entrent
    case 'refugees_robbed':
      return { wave: 'sawtooth', freq: 330, freqEnd: 165, dur: 0.34, gain: 0.075, lowpass: 1600 }
    case 'member_banished':
      return { wave: 'sawtooth', freq: 262, freqEnd: 131, dur: 0.4, gain: 0.07, lowpass: 1200 }
    // LA CHUTE D'UN VILLAGE : plus lourde et plus longue qu'une mort d'homme — c'est plus
    // qu'une personne qui s'éteint, et le son doit le dire sans qu'on l'explique.
    case 'village_fell':
      return { wave: 'sine', freq: 130, freqEnd: 58, dur: 1.4, gain: 0.12 }
    // UN FEU VIRE (Foyer/Meute) : ni gain ni perte — une bascule. La hauteur fléchit à peine.
    case 'village_archetype_changed':
      return { wave: 'sine', freq: 330, freqEnd: 294, dur: 0.7, gain: 0.07 }
    // MUETS ici, et par décision : `village_founded` (la fondation a déjà sa cérémonie à
    // l'écran), `member_joined` (discret par nature), `refugees_left` (il ne s'est RIEN passé
    // — c'est l'absence de geste, et une absence ne se sonne pas).

    // ── LES BATTEMENTS DE LA SAISON ──────────────────────────────────────────────────────
    case 'night_started':
      return { wave: 'sine', freq: 130, freqEnd: 98, dur: 0.9, gain: 0.07 }
    // L'ACTE : plus bas et plus long que la nuit — la nuit revient, l'acte jamais.
    case 'act_started':
      return { wave: 'sine', freq: 98, freqEnd: 65, dur: 1.6, gain: 0.1 }
    case 'cendre_avance':
      return { wave: 'noise', freq: 0, dur: 0.6, gain: 0.05, lowpass: 420 } // la cendre est du bruit sourd
    // UN CENDREUX SE LÈVE. Gain et durée BAS À DESSEIN : il s'émet par cadavre, et après une
    // bataille plusieurs mûrissent ensemble — c'est le seul son de la table qui risque le mur.
    case 'cendreux_risen':
      return { wave: 'triangle', freq: 98, freqEnd: 147, dur: 0.3, gain: 0.05, lowpass: 800 }
    case 'horde_spawned':
      return { wave: 'sawtooth', freq: 147, freqEnd: 110, dur: 0.8, gain: 0.085, lowpass: 900 }
    case 'alarm_raised':
      return { wave: 'square', freq: 660, freqEnd: 660, dur: 0.18, gain: 0.1, lowpass: 2600 }
    case 'evacuation_opened':
      return { wave: 'sine', freq: 294, freqEnd: 440, dur: 0.5, gain: 0.08 }
    case 'ark_departed':
      return { wave: 'sine', freq: 196, freqEnd: 294, dur: 1.5, gain: 0.095 } // le seul vrai départ
    case 'season_ended':
      return { wave: 'sine', freq: 147, freqEnd: 49, dur: 2.2, gain: 0.11 } // la plus longue descente du jeu
    // MUETS : `day_started` et `season_day_started` (c'est chaque jour, et le HUD le dit),
    // `horde_dispersed` et `convoy_spawned` (une menace qui s'en va n'est pas un fait sonore).

    // ── BÂTIR, CRAFTER, MANGER ───────────────────────────────────────────────────────────
    case 'resource_harvested':
      return onMe ? { wave: 'square', freq: 440, freqEnd: 520, dur: 0.06, gain: 0.05, lowpass: 2200 } : null
    case 'structure_built':
      return { wave: 'noise', freq: 0, dur: 0.12, gain: 0.06, lowpass: 800 } // ça se pose
    case 'structure_destroyed':
      return { wave: 'noise', freq: 0, dur: 0.42, gain: 0.1, lowpass: 520 } // ça s'effondre
    case 'item_crafted':
      return { wave: 'square', freq: 523, freqEnd: 659, dur: 0.1, gain: 0.05, lowpass: 2600 }
    case 'meat_cooked':
      return { wave: 'triangle', freq: 392, freqEnd: 466, dur: 0.16, gain: 0.05 }
    // MUETS : monter/réparer/démonter un mur, manger, semer, récolter le potager — le geste
    // est déjà sous la main et sous les yeux. On garde le budget d'attention de l'oreille.

    // ── PROGRESSION ET DÉCOUVERTE ────────────────────────────────────────────────────────
    case 'skill_level_up':
      return { wave: 'triangle', freq: 440, freqEnd: 659, dur: 0.42, gain: 0.08 }
    case 'poi_first_visit':
      return { wave: 'sine', freq: 392, freqEnd: 587, dur: 0.9, gain: 0.075 } // le monde s'ouvre
    // `poi_discovered` reste muet : redondant avec la première visite, qui, elle, se mérite.

    // ── ET LE SILENCE DÉCIDÉ ─────────────────────────────────────────────────────────────
    // Tout le reste se tait par CHOIX, pas par omission : haute fréquence (spawns, nœud vidé,
    // objet jeté), ou pure plomberie d'interface (refus — il a déjà son toast, accès d'un
    // coffre, file d'artisanat, fonction émergente). L'inventaire complet, avec ce que chaque
    // fait raconte, vit dans `inventaire.ts` et se réécoute au banc.
    default:
      return null
  }
}

/**
 * Monte le graphe WebAudio d'un `SoundSpec` sur `dest`, démarré à `when` (s). Enveloppe
 * attack-court / release-linéaire vers 0 (pas de clic). Réutilisable en OfflineAudioContext
 * (test) comme en live. `noise` : un buffer de bruit blanc court, filtré. Retourne les nœuds
 * pour test/cleanup ; ils s'arrêtent seuls à `when + dur`.
 */
export function buildSound(ctx: BaseAudioContext, dest: AudioNode, spec: SoundSpec, when = 0): void {
  const g = ctx.createGain()
  const atk = Math.min(0.01, spec.dur * 0.2)
  g.gain.setValueAtTime(0, when)
  g.gain.linearRampToValueAtTime(spec.gain, when + atk)
  g.gain.linearRampToValueAtTime(0, when + spec.dur)

  let src: AudioScheduledSourceNode
  if (spec.wave === 'noise') {
    const frames = Math.max(1, Math.floor(ctx.sampleRate * spec.dur))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    // Bruit blanc déterministe (LCG) — pas de Math.random : reproductible, testable.
    let s = 0x2545f491
    for (let i = 0; i < frames; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff
      data[i] = (s / 0x40000000 - 1) * 0.9
    }
    const node = ctx.createBufferSource()
    node.buffer = buffer
    src = node
  } else {
    const osc = ctx.createOscillator()
    osc.type = spec.wave
    osc.frequency.setValueAtTime(spec.freq, when)
    if (spec.freqEnd !== undefined) osc.frequency.linearRampToValueAtTime(spec.freqEnd, when + spec.dur)
    src = osc
  }

  const tail: AudioNode = g
  if (spec.lowpass !== undefined) {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = spec.lowpass
    src.connect(filter)
    filter.connect(g)
  } else {
    src.connect(g)
  }
  tail.connect(dest)
  src.start(when)
  src.stop(when + spec.dur)
}
