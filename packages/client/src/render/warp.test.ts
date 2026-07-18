import { describe, expect, it } from 'vitest'
import { createWarp } from './warp'

// La carte est PLATE (pivot RimWorld) : le warp est un no-op. Il ne reste qu'à prouver ça —
// lift ≡ 0, unproject ≡ identité — pour que le smoke test puisse s'y appuyer comme source de
// vérité de la conversion écran→monde.
describe('warp — plat, no-op', () => {
  it('lift vaut toujours 0', () => {
    const w = createWarp()
    expect(w.lift(0, 0)).toBe(0)
    expect(w.lift(123.4, 987.6)).toBe(0)
    expect(w.lift(-5, 42)).toBe(0)
  })

  it("unproject est l'identité : l'écran EST le monde", () => {
    const w = createWarp()
    expect(w.unproject(0, 0)).toEqual({ x: 0, y: 0 })
    expect(w.unproject(640, 360)).toEqual({ x: 640, y: 360 })
    expect(w.unproject(1280.5, 720.25)).toEqual({ x: 1280.5, y: 720.25 })
  })
})
