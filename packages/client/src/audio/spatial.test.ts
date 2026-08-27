import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { INTEREST_RADIUS_TILES } from '@ashes/sim'
import { VISIBLE_TILES_TALL } from '../render/framing'
import { INVENTAIRE, SONORES, variantesDe } from './inventaire'
import { buildSound, soundForEvent, type SoundSpec } from './sound'
import {
  COMPENSATION_PAN,
  DEMI_CADRE_TUILES,
  GAIN_BORD,
  PAN_MAX,
  PLEIN_TUILES,
  PORTEE,
  PORTEE_TUILES,
  placer,
  VOILE_PORTEE_HZ,
} from './spatial'

/**
 * CE QUE CE FICHIER GARDE.
 *
 * 1. Que le rayon audible est calibré sur LE CADRE — le vrai, celui que `main.ts` déclare, lu
 *    ici à la source. Une garde écrite avec la constante qu'elle teste ne garde rien ; celle-ci
 *    rougit le jour où le jeu passe en 21:9 sans que le son suive.
 * 2. Qu'à écart NUL le son est EXACTEMENT celui d'avant la spatialisation — c'est la promesse
 *    qui rend inutile tout cas particulier « sur moi ».
 * 3. Que les trois courbes (gain, pan, voile) sont MONOTONES sur tout le domaine, balayé en
 *    grille — pas sur trois points choisis, qui sont toujours ceux qui passent.
 * 4. Que le graphe WebAudio se câble comme annoncé (pan posé, gain multiplié, coupure la plus
 *    basse retenue). ⚠ Node n'a pas de WebAudio : c'est un contexte de PAPIER, il prouve le
 *    CÂBLAGE et rien de l'audible. Ce qui s'entend se juge au banc (`banc-son.html`).
 */

const AU_CENTRE = placer(0, 0)!

describe('la portée du son se dérive du cadre', () => {
  it('le demi-cadre en tuiles est celui du VRAI jeu (lu dans main.ts, pas recopié)', () => {
    // La source d'autorité, lue à la source : si quelqu'un change la résolution du jeu sans
    // toucher au son, c'est ICI que ça se voit.
    const main = readFileSync(new URL('../main.ts', import.meta.url), 'utf8')
    const largeur = Number(/^\s*width:\s*(\d+),/m.exec(main)?.[1])
    const hauteur = Number(/^\s*height:\s*(\d+),/m.exec(main)?.[1])
    expect(Number.isFinite(largeur) && Number.isFinite(hauteur)).toBe(true)

    const attendu = (VISIBLE_TILES_TALL * (largeur / hauteur)) / 2
    expect(DEMI_CADRE_TUILES).toBeCloseTo(attendu, 6)
  })

  it('les trois bornes s’ordonnent : « ici » ⊂ le cadre ⊂ la portée', () => {
    expect(PLEIN_TUILES).toBeLessThan(DEMI_CADRE_TUILES)
    expect(DEMI_CADRE_TUILES).toBeLessThan(PORTEE_TUILES)
    // Le son PORTE au-delà du cadre (décision d'Alexis) — mais pas à travers la vallée.
    expect(PORTEE_TUILES).toBeLessThan(DEMI_CADRE_TUILES * 2)
  })

  it('la portée tient DANS le rayon d’intérêt — c’est ce qui rend « introuvable » = « inaudible »', () => {
    // `WorldScene.lieuDeLEvenement` conclut au silence quand le sujet d'un fait n'est pas dans
    // le snapshot. Ce raisonnement n'est valide QUE tant que la portée du son est plus courte
    // que le rayon auquel le snapshot rogne ses collections : sinon un fait parfaitement
    // audible deviendrait muet parce que le réseau ne l'a pas transporté. La prémisse est ici.
    expect(PORTEE_TUILES).toBeLessThan(INTEREST_RADIUS_TILES)
  })

  it('un fait hors de portée ne se joue PAS — c’est là tout le correctif', () => {
    expect(placer(PORTEE_TUILES + 0.01, 0)).toBeNull()
    expect(placer(0, PORTEE_TUILES + 0.01)).toBeNull()
    // 200 tuiles : le hurlement de loup qui, aujourd’hui, arrive plein pot dans l’oreille.
    expect(placer(200, 0)).toBeNull()
    expect(placer(PORTEE_TUILES - 0.01, 0)).not.toBeNull()
  })

  it('au BORD du cadre, il reste de quoi entendre un avertissement', () => {
    const bord = placer(DEMI_CADRE_TUILES, 0)!
    expect(bord.gain / AU_CENTRE.gain).toBeCloseTo(GAIN_BORD, 6)
    expect(bord.gain / AU_CENTRE.gain).toBeGreaterThan(0.3)
  })
})

describe('à écart nul, le son est celui d’avant', () => {
  it('centre, plein, sans voile — et la compensation d’énergie rétablit le niveau d’avant', () => {
    expect(AU_CENTRE.pan).toBe(0)
    expect(AU_CENTRE.lowpass).toBeUndefined()
    // `StereoPannerNode` sort une source mono centrée à cos(π/4) dans chaque canal. Le produit
    // des deux doit valoir 1 : sans ça, spatialiser aurait baissé TOUT le jeu de 3 dB.
    expect(AU_CENTRE.gain * Math.cos(Math.PI / 4)).toBeCloseTo(1, 12)
    expect(AU_CENTRE.gain).toBeCloseTo(COMPENSATION_PAN, 12)
  })

  it('« sur moi » n’a pas besoin d’un cas particulier : tout le disque « ici » sonne plein', () => {
    for (let d = 0; d <= PLEIN_TUILES; d += 0.1) {
      const points: [number, number][] = [
        [d, 0],
        [0, d],
        [d / Math.SQRT2, d / Math.SQRT2],
      ]
      for (const [dx, dy] of points) {
        const p = placer(dx, dy)!
        expect(p.gain, `à ${dx.toFixed(2)},${dy.toFixed(2)}`).toBeCloseTo(COMPENSATION_PAN, 12)
        expect(p.lowpass).toBeUndefined()
      }
    }
  })
})

/** Le domaine entier, balayé en grille — une propriété se démontre partout ou nulle part. */
const GRILLE: { dx: number; dy: number; d: number }[] = []
for (let dx = -PORTEE_TUILES; dx <= PORTEE_TUILES; dx += 0.25) {
  for (let dy = -PORTEE_TUILES; dy <= PORTEE_TUILES; dy += 0.25) {
    const d = Math.sqrt(dx * dx + dy * dy)
    if (d <= PORTEE_TUILES) GRILLE.push({ dx, dy, d })
  }
}

describe('les trois courbes, sur tout le domaine', () => {
  it('la grille couvre bien les trois régimes (sinon la garde ne garderait rien)', () => {
    expect(GRILLE.some((p) => p.d < PLEIN_TUILES)).toBe(true)
    expect(GRILLE.some((p) => p.d > PLEIN_TUILES && p.d < DEMI_CADRE_TUILES)).toBe(true)
    expect(GRILLE.some((p) => p.d > DEMI_CADRE_TUILES)).toBe(true)
    expect(GRILLE.length).toBeGreaterThan(10000)
  })

  // UNE SEULE PROPRIÉTÉ AFFIRMÉE PAR BALAYAGE : on collecte les manquements et on les montre
  // tous d'un coup. Trente-cinq mille `expect()` coûtent sept secondes et ne disent rien de plus.
  it('le gain ne dépend que de la DISTANCE, et ne remonte jamais', () => {
    const parDistance = [...GRILLE].sort((a, b) => a.d - b.d)
    const fautes: string[] = []
    let precedent = Infinity
    for (const { dx, dy, d } of parDistance) {
      const g = placer(dx, dy)!.gain
      if (g > precedent + 1e-9) fautes.push(`d=${d.toFixed(2)} remonte à ${g.toFixed(4)}`)
      if (g < 0) fautes.push(`d=${d.toFixed(2)} négatif`)
      precedent = g
    }
    expect(fautes.slice(0, 8)).toEqual([])
    // Et il tombe bien à zéro au bout : une portée qui coupe sur un son encore fort claquerait.
    expect(placer(PORTEE_TUILES, 0)!.gain).toBeCloseTo(0, 9)
  })

  it('le pan suit l’ÉCRAN (dx) et ignore la PROFONDEUR (dy), sans jamais coller à une oreille', () => {
    const fautes: string[] = []
    for (const { dx, dy } of GRILLE) {
      const p = placer(dx, dy)!
      if (Math.abs(p.pan) > PAN_MAX + 1e-12) fautes.push(`${dx},${dy} : pan ${p.pan}`)
      if (Math.sign(p.pan) !== Math.sign(dx)) fautes.push(`${dx},${dy} : mauvais côté`)
      // La profondeur ne déplace pas le son : à dx donné, le pan est le même quel que soit dy.
      if (Math.abs(p.pan - placer(dx, 0)!.pan) > 1e-12) fautes.push(`${dx},${dy} : dy déplace le pan`)
    }
    expect(fautes.slice(0, 8)).toEqual([])
    // Un son droit devant ou droit derrière reste au centre — en vue 3/4, il n’a pas de côté.
    for (let dy = -PORTEE_TUILES; dy <= PORTEE_TUILES; dy += 0.5) expect(placer(0, dy)!.pan).toBe(0)
  })

  it('le voile se ferme avec la distance : transparent « ici », sourd au bout', () => {
    const parDistance = [...GRILLE].filter((p) => p.d > PLEIN_TUILES).sort((a, b) => a.d - b.d)
    const fautes: string[] = []
    let precedent = Infinity
    for (const { dx, dy, d } of parDistance) {
      const hz = placer(dx, dy)!.lowpass!
      if (hz > precedent + 1e-6) fautes.push(`d=${d.toFixed(2)} rouvre à ${Math.round(hz)} Hz`)
      if (hz < VOILE_PORTEE_HZ - 1e-6) fautes.push(`d=${d.toFixed(2)} sous le plancher`)
      precedent = hz
    }
    expect(fautes.slice(0, 8)).toEqual([])
    expect(placer(PORTEE_TUILES, 0)!.lowpass).toBeCloseTo(VOILE_PORTEE_HZ, 6)
  })
})

// ── LE CÂBLAGE ──────────────────────────────────────────────────────────────────────────────

interface NœudPapier {
  type: string
  vers: NœudPapier[]
  [k: string]: unknown
}

/** Un AudioContext de papier : Node n'a pas de WebAudio, et un rendu MONO ne prouverait
 *  de toute façon aucun panoramique. Il enregistre le graphe, rien d'autre. */
function contextePapier(): { ctx: BaseAudioContext; sortie: NœudPapier; nœuds: NœudPapier[] } {
  const nœuds: NœudPapier[] = []
  const faire = (type: string, extra: Record<string, unknown> = {}): NœudPapier => {
    const n: NœudPapier = { type, vers: [], connect: (d: NœudPapier) => n.vers.push(d), ...extra }
    nœuds.push(n)
    return n
  }
  const param = (): { value: number; setValueAtTime: () => void; linearRampToValueAtTime: (v: number) => void } => {
    const rampes: number[] = []
    return {
      value: 0,
      setValueAtTime: () => {},
      linearRampToValueAtTime: (v: number) => rampes.push(v),
      get rampes() {
        return rampes
      },
    } as never
  }
  const sortie = faire('destination')
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    createGain: () => faire('gain', { gain: param() }),
    createOscillator: () => faire('osc', { frequency: param(), start: () => {}, stop: () => {} }),
    createBufferSource: () => faire('buffer', { buffer: null, start: () => {}, stop: () => {} }),
    createBuffer: (_c: number, frames: number) => ({ getChannelData: () => new Float32Array(frames) }),
    createBiquadFilter: () => faire('lowpass', { type: '', frequency: { value: 0 } }),
    createStereoPanner: () => faire('panner', { pan: { value: 0 } }),
  } as unknown as BaseAudioContext
  return { ctx, sortie, nœuds }
}

const SPEC: SoundSpec = { wave: 'triangle', freq: 300, dur: 0.2, gain: 0.1, lowpass: 2000 }

/** Le nœud de papier, vu comme un `AudioNode` — `buildSound` n'en touche que `connect`. */
const branche = (n: NœudPapier): AudioNode => n as unknown as AudioNode

describe('le graphe WebAudio', () => {
  it('sans lieu, il est EXACTEMENT celui d’avant : aucun panoramique inséré', () => {
    const { ctx, sortie, nœuds } = contextePapier()
    buildSound(ctx, branche(sortie), SPEC, 0)
    expect(nœuds.some((n) => n.type === 'panner')).toBe(false)
    expect(nœuds.find((n) => n.type === 'lowpass')!.frequency).toEqual({ value: 2000 })
  })

  it('avec un lieu : le pan est posé, et le panoramique est le DERNIER nœud avant la sortie', () => {
    const { ctx, sortie, nœuds } = contextePapier()
    buildSound(ctx, branche(sortie), SPEC, 0, { pan: -0.4, gain: 0.5 })
    const panner = nœuds.find((n) => n.type === 'panner')!
    expect(panner.pan).toEqual({ value: -0.4 })
    expect(panner.vers).toContain(sortie)
    // …et le gain ne va PLUS directement à la destination : il passe par lui.
    const gain = nœuds.find((n) => n.type === 'gain')!
    expect(gain.vers).toEqual([panner])
  })

  it('la coupure retenue est la PLUS BASSE des deux, dans UN seul filtre', () => {
    const cas: [number, number][] = [
      [900, 900],
      [9000, 2000],
    ]
    for (const [voile, attendu] of cas) {
      const { ctx, sortie, nœuds } = contextePapier()
      buildSound(ctx, branche(sortie), SPEC, 0, { pan: 0, gain: 1, lowpass: voile })
      const filtres = nœuds.filter((n) => n.type === 'lowpass')
      expect(filtres).toHaveLength(1)
      expect(filtres[0]!.frequency).toEqual({ value: attendu })
    }
  })

  it('un son SANS coupure propre en gagne une quand il s’éloigne, et n’en a aucune de près', () => {
    const nu: SoundSpec = { wave: 'sine', freq: 400, dur: 0.1, gain: 0.05 }
    const loin = contextePapier()
    buildSound(loin.ctx, branche(loin.sortie), nu, 0, { pan: 0, gain: 0.4, lowpass: 1200 })
    expect(loin.nœuds.filter((n) => n.type === 'lowpass')).toHaveLength(1)

    const pres = contextePapier()
    buildSound(pres.ctx, branche(pres.sortie), nu, 0, { pan: 0, gain: 1 })
    expect(pres.nœuds.filter((n) => n.type === 'lowpass')).toHaveLength(0)
  })
})

// ── LA PUISSANCE ────────────────────────────────────────────────────────────────────────────

/** Un fait synthétique — le routage ignore les champs superflus (même patron que `sound.test`). */
const ev = (type: string, extra: Record<string, unknown> = {}): import('@ashes/sim').SimEvent =>
  ({ type, tick: 0, ...extra }) as never

/** Les ancrages qui ne dépendent PAS des collections rognées du snapshot. */
const AUTONOMES = new Set(['xy', 'tuile', 'noeud', 'monde'])

/**
 * Toutes les voix d'un fait — les deux points de vue, et TOUTES ses variantes.
 *
 * La liste était écrite ici à la main (trois nœuds), et c'était la deuxième copie du même
 * savoir. Elle vient désormais de `variantesDe` : le jour où une matière naît, elle entre dans
 * ce relevé de portée sans que personne y pense. Une garde dont le domaine se tient à la main
 * finit toujours par rater ce qui est arrivé après elle.
 */
function voixDe(type: string): SoundSpec[] {
  const variantes = [{}, ...variantesDe(type as import('@ashes/sim').SimEvent['type']).map((v) => v.champs)]
  const out: SoundSpec[] = []
  for (const v of variantes) {
    for (const onMe of [true, false]) {
      const spec = soundForEvent(ev(type, { entityId: 1, byEntityId: 2, targetEntityId: 1, ...v }), onMe)
      if (spec) out.push(spec)
    }
  }
  return out
}

describe('la puissance d’un son', () => {
  it('étire les trois bornes : un CRI porte là où un FAIT s’est déjà tu', () => {
    expect(placer(40, 0, PORTEE.FAIT)).toBeNull()
    expect(placer(40, 0, PORTEE.CRI)).not.toBeNull()
    expect(placer(15, 0, PORTEE.GESTE)).toBeNull() // …et un geste se tait DANS le cadre
    expect(placer(15, 0, PORTEE.FAIT)).not.toBeNull()
    // Le disque « plein » s’étire lui aussi : un hurlement est à plein volume jusqu’à 9 t.
    expect(placer(8, 0, PORTEE.CRI)!.lowpass).toBeUndefined()
    expect(placer(8, 0, PORTEE.FAIT)!.lowpass).toBeDefined()
  })

  it('à distance égale, plus de puissance ne rend JAMAIS un son plus faible', () => {
    const crans = [PORTEE.GESTE, PORTEE.FAIT, PORTEE.MASSE, PORTEE.LOIN, PORTEE.CRI]
    const fautes: string[] = []
    for (let d = 0; d <= PORTEE_TUILES * PORTEE.CRI; d += 0.5) {
      let precedent = -1
      for (const p of crans) {
        const g = placer(d, 0, p)?.gain ?? 0
        if (g < precedent - 1e-9) fautes.push(`d=${d} : ×${p} plus faible que le cran d’en dessous`)
        precedent = g
      }
    }
    expect(fautes.slice(0, 8)).toEqual([])
  })

  it('le PAN, lui, ne s’étire pas : l’écran ne s’élargit pas parce qu’un son est fort', () => {
    const fautes: string[] = []
    for (let dx = -DEMI_CADRE_TUILES; dx <= DEMI_CADRE_TUILES; dx += 0.25) {
      const ref = placer(dx, 0, PORTEE.FAIT)!.pan
      for (const p of [PORTEE.GESTE, PORTEE.MASSE, PORTEE.LOIN, PORTEE.CRI]) {
        const q = placer(dx, 0, p)
        if (q && Math.abs(q.pan - ref) > 1e-12) fautes.push(`dx=${dx} ×${p} : ${q.pan} ≠ ${ref}`)
      }
    }
    expect(fautes.slice(0, 8)).toEqual([])
  })
})

describe('la puissance et le rayon d’intérêt', () => {
  /**
   * ═══ L'INVARIANT QUI TIENT LE PLAFOND ═══
   *
   * `WorldScene` situe un fait ancré sur une entité / structure / village en le cherchant dans
   * le snapshot, RONGÉ au rayon d'intérêt (64 tuiles). Un son qui porte au-delà doit donc se
   * poser sur un fait AUTO-LOCALISANT — sinon il serait audible en droit et muet en fait, et
   * personne ne le saurait : le fait n'arriverait tout simplement jamais assez près.
   */
  const portees = SONORES.map((type) => ({
    type,
    ou: INVENTAIRE[type].ou,
    tuiles: Math.max(...voixDe(type).map((s) => (s.portee ?? PORTEE.FAIT) * PORTEE_TUILES), 0),
  }))

  it('la garde n’est pas vide : des sons portent VRAIMENT au-delà du rayon d’intérêt', () => {
    const loin = portees.filter((p) => p.tuiles > INTEREST_RADIUS_TILES)
    expect(loin.length).toBeGreaterThan(0)
    // Et chacun a bien une voix (sinon on garderait une table de sons qui n’existent pas).
    expect(portees.every((p) => p.tuiles > 0)).toBe(true)
  })

  it('un son qui porte au-delà de 64 tuiles est posé sur un fait AUTO-LOCALISANT', () => {
    const fautes = portees
      .filter((p) => p.tuiles > INTEREST_RADIUS_TILES && !AUTONOMES.has(p.ou ?? 'monde'))
      .map((p) => `${p.type} porte à ${p.tuiles.toFixed(0)} t mais s’ancre sur « ${p.ou} » (rogné à 64)`)
    expect(fautes).toEqual([])
  })
})
