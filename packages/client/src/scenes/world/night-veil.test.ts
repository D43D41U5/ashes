/**
 * LE VOILE DE NUIT — CHAQUE TROU GARDE SA TAILLE JUSQU'AU `render()`.
 *
 * *« La nuit la lumière du feu est étouffée lorsque je sors une torche »* (Alexis, 2026-08-26).
 *
 * La cause n'était pas dans le feu : elle est dans la façon dont Phaser 4 diffère ses dessins.
 * `DynamicTexture.erase(obj, x, y)` n'exécute rien — il empile `(DRAW, obj, x, y)`, une
 * RÉFÉRENCE à l'objet plus les seuls x/y par valeur, et le lot ne part qu'au `render()` final.
 * Le gestionnaire de la commande DRAW relit alors l'objet VIVANT. Une brosse unique, mutée à
 * chaque tour de boucle, livre donc à TOUS les trous la taille et l'alpha du DERNIER.
 *
 * Les torches étant empilées après les Feux, sortir une torche donnait à chaque foyer le rayon
 * de la torche. C'est ce que ce test interdit — et il interdit aussi le cas qui dormait là
 * depuis toujours, sans torche : deux Feux, et les deux prenaient déjà le rayon du dernier.
 *
 * LE LEURRE REPRODUIT LE DIFFÉRÉ, c'est tout l'intérêt : `erase` ne fait que retenir la
 * référence, et c'est `render()` qui RELIT taille et alpha — exactement la sémantique de
 * Phaser 4 (`commandBuffer`). Un leurre qui lirait à l'`erase` ne pourrait pas échouer, donc
 * ne garderait rien.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Les brosses fabriquées par le module, retenues pour les compter et vérifier leur destruction. */
const brosses: BrosseLeurre[] = []

class BrosseLeurre {
  x = 0
  y = 0
  displayWidth = 0
  displayHeight = 0
  alpha = 1
  detruite = false
  constructor() {
    brosses.push(this)
  }
  setOrigin(): this {
    return this
  }
  setDisplaySize(w: number, h: number): this {
    this.displayWidth = w
    this.displayHeight = h
    return this
  }
  setAlpha(a: number): this {
    this.alpha = a
    return this
  }
  destroy(): void {
    this.detruite = true
  }
}

vi.mock('phaser', () => ({
  default: {
    BlendModes: { MULTIPLY: 1, ADD: 2 },
    Textures: { FilterMode: { NEAREST: 0 } },
    GameObjects: { Image: BrosseLeurre },
  },
}))

const { NightVeil } = await import('./night-veil')
const { TILE_PX } = await import('../../render/framing')

/** Un trou tel qu'il part VRAIMENT au GPU : lu au `render()`, pas à l'`erase()`. */
interface TrouRendu {
  x: number
  y: number
  dia: number
  alpha: number
}

/** La DynamicTexture de leurre — elle DIFFÈRE, comme la vraie. */
class DtLeurre {
  private file: { obj: BrosseLeurre; x: number; y: number }[] = []
  rendus: TrouRendu[] = []
  setSize(): void {}
  clear(): void {
    this.file = []
  }
  fill(): void {}
  erase(obj: BrosseLeurre, x: number, y: number): void {
    this.file.push({ obj, x, y })
  }
  render(): void {
    // ⚠ ICI est le piège : on relit l'objet, à l'instant du flush.
    this.rendus = this.file.map((e) => ({ x: e.x, y: e.y, dia: e.obj.displayWidth, alpha: e.obj.alpha }))
    this.file = []
  }
}

/** Objet chaînable : toute méthode inconnue se rend elle-même (setDepth, setFillStyle…). */
function chainable(base: Record<string, unknown>): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy(base, {
    get(c, prop) {
      if (prop in c) return Reflect.get(c, prop)
      return () => proxy
    },
  })
  return proxy
}

const W = 800
const H = 640

function monterVoile(): { veil: InstanceType<typeof NightVeil>; dt: DtLeurre } {
  const dt = new DtLeurre()
  const scene = {
    textures: { exists: () => true, get: () => ({ setFilter: () => {} }) },
    scale: { width: W, height: H },
    add: {
      renderTexture: () => chainable({ texture: dt }),
      rectangle: () => chainable({}),
    },
  } as unknown as Phaser.Scene
  return { veil: new NightVeil(scene), dt }
}

const ZOOM = 2
function camera(): Phaser.Cameras.Scene2D.Camera {
  return {
    zoom: ZOOM,
    width: W,
    height: H,
    originX: 0.5,
    originY: 0.5,
    worldView: { x: 0, y: 0, width: W / ZOOM, height: H / ZOOM },
  } as unknown as Phaser.Cameras.Scene2D.Camera
}

/** Une nuit franche : sans opacité, le voile n'est même pas rendu (et rien n'est creusé). */
const NUIT = { color: 0x0a1030, alpha: 0.7 }
const RIEN = { color: 0x000000, alpha: 0 }

/** Le diamètre écran qu'un rayon en tuiles DOIT produire. */
function dia(tuiles: number): number {
  return tuiles * 2 * TILE_PX * ZOOM
}

/** Une position monde qui retombe bien dans le cadre (le voile écarte le hors-champ). */
function auCentre(dx = 0): { worldX: number; worldY: number } {
  return { worldX: W / ZOOM / 2 + dx, worldY: H / ZOOM / 2 }
}

describe('le voile de nuit — un trou, une brosse', () => {
  beforeEach(() => {
    brosses.length = 0
  })

  it('rend à CHAQUE trou son propre rayon, y compris après une torche (le défaut d’Alexis)', () => {
    const { veil, dt } = monterVoile()
    veil.update(
      NUIT,
      RIEN,
      RIEN,
      [
        { ...auCentre(-60), radiusTiles: 6, force: 1 }, // un Feu
        { ...auCentre(20), radiusTiles: 2, force: 1 }, // la torche, empilée APRÈS
      ],
      camera(),
      8,
      true,
    )
    expect(dt.rendus.map((t) => t.dia)).toEqual([dia(6), dia(2)])
  })

  it('rend à chaque trou son propre alpha (la clairière respire, la torche non)', () => {
    const { veil, dt } = monterVoile()
    veil.update(
      NUIT,
      RIEN,
      RIEN,
      [
        { ...auCentre(-60), radiusTiles: 6, force: 0.5 },
        { ...auCentre(20), radiusTiles: 2, force: 1 },
      ],
      camera(),
      8,
      true,
    )
    expect(dt.rendus).toHaveLength(2)
    expect(dt.rendus[0]!.alpha).toBeCloseTo(dt.rendus[1]!.alpha * 0.5, 6)
  })

  it('vaut aussi SANS torche : deux Feux gardent chacun son rayon', () => {
    const { veil, dt } = monterVoile()
    veil.update(
      NUIT,
      RIEN,
      RIEN,
      [
        { ...auCentre(-80), radiusTiles: 6, force: 1 },
        { ...auCentre(80), radiusTiles: 3, force: 1 },
      ],
      camera(),
      8,
      true,
    )
    expect(dt.rendus.map((t) => t.dia)).toEqual([dia(6), dia(3)])
  })

  it('un foyer ÉTEINT ou hors cadre ne décale pas les rangs des autres', () => {
    const { veil, dt } = monterVoile()
    veil.update(
      NUIT,
      RIEN,
      RIEN,
      [
        { ...auCentre(0), radiusTiles: 0, force: 1 }, // éteint : aucun trou
        { worldX: -5000, worldY: -5000, radiusTiles: 6, force: 1 }, // hors cadre
        { ...auCentre(-60), radiusTiles: 6, force: 1 },
        { ...auCentre(20), radiusTiles: 2, force: 1 },
      ],
      camera(),
      8,
      true,
    )
    expect(dt.rendus.map((t) => t.dia)).toEqual([dia(6), dia(2)])
  })

  it('réemploie ses brosses d’une image à l’autre, et les détruit TOUTES', () => {
    const { veil } = monterVoile()
    const trous = [
      { ...auCentre(-60), radiusTiles: 6, force: 1 },
      { ...auCentre(20), radiusTiles: 2, force: 1 },
    ]
    veil.update(NUIT, RIEN, RIEN, trous, camera(), 8, true)
    expect(brosses).toHaveLength(2)
    veil.update(NUIT, RIEN, RIEN, trous, camera(), 8, true)
    expect(brosses).toHaveLength(2) // aucune fuite par image
    veil.destroy()
    expect(brosses.every((b) => b.detruite)).toBe(true)
  })
})
