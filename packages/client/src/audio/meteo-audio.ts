/**
 * LES SONS DU CIEL (spec `meteo.md` R8/R9 — « on les entend avant de les voir ») — le
 * chantier audio météo, lancé par Alexis le 2026-08-28. Quatre voix :
 *
 *   1. LES DEUX LITS (`SoundEngine.nappe`) — la PLUIE (crépitement passe-bas) et le VENT
 *      (plainte passe-bande ondulée), croisés sur l'ASPECT au joueur : une pluie crépite,
 *      une neige souffle bas, un blizzard hurle, un vent de cendre siffle sec, le
 *      brouillard se tait. Le niveau suit `meteoIntensity` — la rampe bord → cœur de la
 *      bande EST le fondu, aucune enveloppe ad hoc.
 *   2. L'AVANCE DE L'OREILLE — l'intensité se relit AUSSI à `AVANCE_S` secondes dans le
 *      futur (la bande est une fonction pure du tick : lire demain est gratuit) : le mur
 *      qui approche murmure avant d'être visible. C'est le contrat R9, tenu au sens propre.
 *   3. LE TONNERRE — un impact de foudre gronde, spatialisé au point de frappe (portée
 *      `CRI` : l'orage s'entend d'un bout à l'autre du cadre et au-delà). Déclenché par
 *      `FoudreFx.onFrappe` : c'est LUI l'écrivain de la loi d'abri côté client, on ne la
 *      recopie pas.
 *   4. LE GRÉSILLEMENT du télégraphe (R8 : « lueur au sol, grésillement ») — des grains
 *      cadencés au point visé, qui montent avec la rampe de l'annonce : sous l'orage, on
 *      lit le sol à l'oreille aussi.
 *
 * ⚠ ESTHÉTIQUE À VALIDER À L'OREILLE (doctrine de tout l'audio du dépôt) : gains BAS, le
 * son reste un décor. Les niveaux se rejugent au banc d'écoute — panneau « LA MÉTÉO »
 * (`banc-son.html` / atelier `#son`), qui joue ces mêmes cibles sur le vrai moteur.
 * Le hasard des grains est client (xorshift local, patron `SonsDeLEau`) : rien de la sim.
 */
import type { MeteoAspect } from '@ashes/sim'
import type { Nappe } from './engine'
import { PORTEE } from './spatial'
import type { SoundSpec } from './sound'

/** L'avance de l'oreille sur l'œil, en secondes de JEU — l'intensité se relit à ce tick
 *  futur. Une minute : le front parcourt ~6 % de sa fenêtre, assez pour que le murmure
 *  précède nettement le mur sans annoncer la demi-journée entière. */
export const AVANCE_S = 60
/** La part du murmure d'avance dans le niveau entendu — le futur s'entend, il ne domine pas. */
export const PART_AVANCE = 0.4
/** Le fondu des nappes (s) — les cibles se reposent chaque image, la rampe infléchit. */
export const FONDU_NAPPE_S = 1.2

export interface CibleNappe {
  gain: number
  hz: number
}
export interface CiblesDuCiel {
  pluie: CibleNappe
  vent: CibleNappe
}

/** Les hertz de repos — le timbre vers lequel une nappe muette rampe (inaudible à gain 0,
 *  mais une coupe qui resterait au dernier ciel colorerait la première seconde du suivant). */
const REPOS: CiblesDuCiel = { pluie: { gain: 0, hz: 1600 }, vent: { gain: 0, hz: 450 } }

/**
 * UN LIT PAR ASPECT, exhaustif PAR LE COMPILATEUR (`Record<MeteoAspect, …>`) : un aspect
 * ajouté à la sim ne peut pas naître muet en silence — ce fichier rougit. Les gains sont à
 * intensité PLEINE (le cœur de la bande) ; tout est ordre de grandeur, à caler au banc.
 */
export const LITS: Record<MeteoAspect, CiblesDuCiel> = {
  /** Le crépitement clair — la coupe haute laisse les gouttes piquer. */
  pluie: { pluie: { gain: 0.034, hz: 2000 }, vent: { gain: 0, hz: 450 } },
  /** Plus dense et plus sombre que la pluie, et un fond qui gronde sous elle. */
  orage: { pluie: { gain: 0.05, hz: 1400 }, vent: { gain: 0.012, hz: 260 } },
  /** La neige ne crépite pas : un souffle bas, presque rien — le silence qui se voit. */
  neige: { pluie: { gain: 0, hz: 1600 }, vent: { gain: 0.014, hz: 360 } },
  /** La plainte pleine — le seul lit qui domine, parce que le blizzard domine tout. */
  blizzard: { pluie: { gain: 0, hz: 1600 }, vent: { gain: 0.055, hz: 520 } },
  /** Le brouillard est un DÉNI de perception : il n'ajoute rien, il éteint. */
  brouillard: { pluie: { gain: 0, hz: 1600 }, vent: { gain: 0, hz: 450 } },
  /** Plus haut et plus sec que le blizzard : ça racle, ça ne hurle pas. */
  vent_de_cendre: { pluie: { gain: 0, hz: 1600 }, vent: { gain: 0.042, hz: 780 } },
}

/** R9 — LE NIVEAU ENTENDU : le présent plein, ou le murmure du futur proche. */
export function intensiteEntendue(maintenant: number, dansUneMinute: number): number {
  return Math.max(maintenant, PART_AVANCE * dansUneMinute)
}

/** Les cibles des deux nappes pour cet aspect à cette intensité — `REPOS` par ciel clair. */
export function cibleDuCiel(aspect: MeteoAspect | null, intensite: number): CiblesDuCiel {
  if (aspect === null || intensite <= 0) return REPOS
  const lit = LITS[aspect]
  return {
    pluie: { gain: lit.pluie.gain * intensite, hz: lit.pluie.hz },
    vent: { gain: lit.vent.gain * intensite, hz: lit.vent.hz },
  }
}

/**
 * LE TONNERRE — le roulement grave, puis la claque qui le date. Portée `CRI` (~80 t) : un
 * impact est AUTO-LOCALISANT (le client l'élit des fonctions pures), le plafond des 64
 * tuiles du snapshot ne le concerne pas — et un orage doit s'entendre avant de se voir.
 */
export const TONNERRE: SoundSpec = { wave: 'noise', freq: 0, dur: 1.8, gain: 0.11, lowpass: 220, portee: PORTEE.CRI }
export const TONNERRE_CLAQUE: SoundSpec = { wave: 'noise', freq: 0, dur: 0.22, gain: 0.07, lowpass: 1100, portee: PORTEE.CRI }

/** Un grain de grésillement (R8) — court, haut, à peine là ; c'est la CADENCE qui parle. */
export const GRESIL: SoundSpec = { wave: 'noise', freq: 0, dur: 0.045, gain: 0.02, lowpass: 5200, portee: PORTEE.FAIT }
const GRESIL_MS_MIN = 70
const GRESIL_MS_JITTER = 70

type Jouer = (spec: SoundSpec, delayS?: number, at?: { x: number; y: number }) => void

export class SonsDuCiel {
  /** Les sondes du smoke et des tests : ce que la couche a réellement demandé. */
  readonly sonde = { gainPluie: 0, gainVent: 0, tonnerres: 0, grains: 0 }
  private nappePluie: Nappe | null = null
  private nappeVent: Nappe | null = null
  private derniere: CiblesDuCiel | null = null
  private prochainGrain = 0
  private graine = 0x9e3779b9

  private bruit(): number {
    // xorshift léger — le son n'est pas de la simulation, mais on reste sans Math.random.
    this.graine ^= this.graine << 13
    this.graine ^= this.graine >>> 17
    this.graine ^= this.graine << 5
    return ((this.graine >>> 0) % 1000) / 1000
  }

  /**
   * Chaque image : les nappes suivent le ciel. `aspect` est celui du FRONT DU JOUR au point
   * du joueur (`aspectAuPoint`, SANS test d'empreinte — le mur qui approche a déjà son
   * timbre) ; `intensite` est le niveau ENTENDU (`intensiteEntendue`). `ouvre` rend une
   * nappe ou `null` tant que l'audio dort — la machine à états retente, patron du thème.
   */
  update(ouvre: (forme: 'pluie' | 'vent') => Nappe | null, aspect: MeteoAspect | null, intensite: number): void {
    this.nappePluie ??= ouvre('pluie')
    this.nappeVent ??= ouvre('vent')
    const c = cibleDuCiel(aspect, intensite)
    this.sonde.gainPluie = c.pluie.gain
    this.sonde.gainVent = c.vent.gain
    // Tant que l'audio dort, AUCUNE cible n'est « posée » : la mémoriser ferait sauter la
    // pose au réveil (attrapé par la garde de la machine à états, pas par une oreille).
    if (this.nappePluie === null && this.nappeVent === null) {
      this.derniere = null
      return
    }
    // On ne repose la cible que si elle a bougé : re-ramper à l'identique chaque image ne
    // change rien au son mais remplit l'automation WebAudio pour rien.
    const d = this.derniere
    if (
      d &&
      Math.abs(d.pluie.gain - c.pluie.gain) < 0.0005 && d.pluie.hz === c.pluie.hz &&
      Math.abs(d.vent.gain - c.vent.gain) < 0.0005 && d.vent.hz === c.vent.hz
    )
      return
    this.derniere = c
    this.nappePluie?.regler(c.pluie.gain, c.pluie.hz, FONDU_NAPPE_S)
    this.nappeVent?.regler(c.vent.gain, c.vent.hz, FONDU_NAPPE_S)
  }

  /** LA FRAPPE — appelée par `FoudreFx.onFrappe` (l'écrivain de la loi d'abri). Un impact
   *  supprimé par l'abri garde son tonnerre : l'éclair a déchiré le ciel, il n'a juste rien
   *  touché — et c'est le ciel qu'on entend. */
  tonnerre(x: number, y: number, play: Jouer): void {
    this.sonde.tonnerres += 1
    play(TONNERRE, 0, { x, y })
    play(TONNERRE_CLAQUE, 0.02, { x, y })
  }

  /** LE GRÉSILLEMENT (R8) — des grains cadencés au point visé, `u` = la rampe du télégraphe
   *  (0 → 1 vers la frappe) : ça crépite de plus en plus serré. */
  gresille(nowMs: number, x: number, y: number, u: number, play: Jouer): void {
    if (u <= 0 || nowMs < this.prochainGrain) return
    this.prochainGrain = nowMs + GRESIL_MS_MIN + this.bruit() * GRESIL_MS_JITTER * (1.6 - u)
    this.sonde.grains += 1
    const v = this.bruit()
    play({ ...GRESIL, gain: GRESIL.gain * (0.4 + 0.6 * u), lowpass: 4200 + v * 2000 }, 0, { x, y })
  }
}
