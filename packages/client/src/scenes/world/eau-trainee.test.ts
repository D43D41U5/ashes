/**
 * CE QU'UN CORPS QUI RAMPE LAISSE AU SOL — une TRAÎNÉE, pas des pas.
 *
 * *« Ça trace au sol, dans les terrains en générant (ex : cendre, neige…), sera toujours une
 * traînée et pas des pas comme ses congénères debout. »* (Alexis, 2026-08-25.)*
 *
 * `poseTrainee` (testée dans `render/empreintes.test.ts`) dit la FORME d'une marque ; ce qui fait
 * la traînée, c'est le reste : la CADENCE (trois fois plus serrée que la foulée, donc des marques
 * qui se recouvrent) et l'absence d'alternance gauche/droite. Les deux vivent dans `eau-events`,
 * et c'est donc là qu'on les mesure.
 *
 * La scène est un LEURRE : `EauEvents` ne fait que poser des images, et tout ce qu'on veut savoir
 * est OÙ elles se posent. Aucun Phaser réel, aucun canvas — le test tourne en Node.
 */
import { describe, expect, it } from 'vitest'
import { EauEvents } from './eau-events'
import { ecartLateral } from '../../render/empreintes'

/** Une image de leurre : toute méthode se rend LE PROXY (le vrai objet Phaser est chaînable, et
 *  rendre la cible nue casserait `.setOrigin(...).setAlpha(...)`), et elle retient sa position. */
function imageLeurre(x: number, y: number): Record<string, unknown> {
  const cible: Record<string, unknown> = { x, y, visible: true }
  const proxy: Record<string, unknown> = new Proxy(cible, {
    get(c, prop) {
      if (prop in c) return Reflect.get(c, prop)
      return () => proxy // setOrigin, setAlpha, setDepth, setLighting, destroy…
    },
  })
  return proxy
}

interface Marque { cle: string; x: number; y: number }

function scene(marques: Marque[]): Phaser.Scene {
  return {
    add: {
      image: (x: number, y: number, cle: string) => {
        marques.push({ cle, x, y })
        return imageLeurre(x, y)
      },
    },
  } as unknown as Phaser.Scene
}

/** Fait avancer un corps en ligne droite sur de la neige, et rend les marques laissées. */
function marcher(rampe: boolean, cap: { x: number; y: number }, pas = 60): Marque[] {
  const marques: Marque[] = []
  const eau = new EauEvents(scene(marques))
  eau.neigeAt = () => true
  const sprite = imageLeurre(0, 0) as unknown as Phaser.GameObjects.Image
  // Le premier appel POSE l'état (jamais de trace au spawn) : on part donc de l'origine.
  let x = 200
  let y = 200
  eau.track(sprite, x, y, 0, -1, 0, 16, rampe)
  for (let i = 1; i <= pas; i++) {
    x += cap.x
    y += cap.y
    eau.track(sprite, x, y, 0, -1, i * 16, 16, rampe)
  }
  return marques
}

/** L'écart entre marques consécutives (px). */
function ecarts(m: Marque[]): number[] {
  const out: number[] = []
  for (let i = 1; i < m.length; i++) {
    const dx = m[i]!.x - m[i - 1]!.x
    const dy = m[i]!.y - m[i - 1]!.y
    out.push(Math.sqrt(dx * dx + dy * dy))
  }
  return out
}

describe('la traînée du rampant (cendreux.md R26ter)', () => {
  it('① elle est TROIS FOIS plus serrée que la foulée — les marques se recouvrent', () => {
    const pas = marcher(false, { x: 2, y: 0 })
    const trainee = marcher(true, { x: 2, y: 0 })
    // La prémisse : les deux ont bien laissé quelque chose (sans elle, deux zéros seraient verts).
    expect(pas.length).toBeGreaterThan(4)
    expect(trainee.length).toBeGreaterThan(pas.length * 2)
    // La marque fait 6 px de long (`PAS_DEMI_V`×2) : au-delà de 6 px d'écart, la piste est une
    // FILE d'empreintes ; en deçà, un sillon continu. C'est toute la différence demandée.
    const eTrainee = ecarts(trainee)
    for (const e of eTrainee) expect(e).toBeLessThan(6)
    for (const e of ecarts(pas)) expect(e).toBeGreaterThan(6)
  })

  it('② elle n’alterne pas les pieds : tout reste sur la ligne de marche', () => {
    for (const cap of [{ x: 2, y: 0 }, { x: 0, y: 2 }, { x: 1.5, y: 1.5 }, { x: -2, y: 1 }]) {
      const trainee = marcher(true, cap)
      const pas = marcher(false, cap)
      // L'écart LATÉRAL à la ligne réellement marchée — droite passant par (200,200) et dirigée
      // par `cap`. C'est la seule référence exacte : le point de foulée d'une marque n'est pas
      // relevé, et le prendre pour « la marque précédente » mesurerait le pas, pas l'écart.
      const lat = (m: Marque[], i: number): number =>
        ecartLateral({ orient: 0, angle: 0, px: m[i]!.x, py: m[i]!.y }, 200, 200, cap.x, cap.y)
      // Le marcheur enjambe la ligne : ses écarts changent de SIGNE d'une marque à l'autre.
      const signesPas = new Set(pas.map((_, i) => Math.sign(lat(pas, i))).filter((s) => s !== 0))
      expect(signesPas.size, `le marcheur devrait alterner (cap ${cap.x},${cap.y})`).toBe(2)
      // Le rampant, lui, traîne : jamais plus que le grain (JITTER_PX/2 = 0,35 px).
      for (let i = 0; i < trainee.length; i++) {
        expect(Math.abs(lat(trainee, i)), `cap ${cap.x},${cap.y}, marque ${i}`).toBeLessThan(1)
      }
    }
  })

  it('③ elle prend la matière du sol — et la cendre comme la neige', () => {
    const marques: Marque[] = []
    const eau = new EauEvents(scene(marques))
    eau.cendreAt = () => true
    const sprite = imageLeurre(0, 0) as unknown as Phaser.GameObjects.Image
    eau.track(sprite, 200, 200, 0, -1, 0, 16, true)
    for (let i = 1; i <= 20; i++) eau.track(sprite, 200 + i * 2, 200, 0, -1, i * 16, 16, true)
    expect(marques.length).toBeGreaterThan(4)
    for (const m of marques) expect(m.cle.startsWith('fx-pas-cendre-')).toBe(true)
  })

  it('④ sur un sol qui ne garde rien, un rampant ne laisse RIEN (la traînée n’invente pas de matière)', () => {
    const marques: Marque[] = []
    const eau = new EauEvents(scene(marques))
    eau.neigeAt = () => false
    eau.cendreAt = () => false
    const sprite = imageLeurre(0, 0) as unknown as Phaser.GameObjects.Image
    eau.track(sprite, 200, 200, 0, -1, 0, 16, true)
    for (let i = 1; i <= 40; i++) eau.track(sprite, 200 + i * 2, 200, 0, -1, i * 16, 16, true)
    expect(marques.length).toBe(0)
  })
})
