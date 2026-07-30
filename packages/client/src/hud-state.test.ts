/**
 * LE REGISTRY EST LA SEULE MÉMOIRE QUI TRAVERSE UNE PARTIE.
 *
 * Depuis que « retour au menu principal » ne recharge plus la page (2026-07-29), le registry — qui
 * appartient au JEU et non à la scène — est ce qui reste debout entre deux Veillées. Les
 * instances de scène, elles, sont jetées (`MenuScene.rafraichirScenesDeJeu`). Si `resetHud`
 * laisse fuiter une seule clé, la vallée neuve hérite du savoir de l'ancienne : `worldReady`
 * déjà vrai, la carte, le brouillard, la chronique.
 *
 * On balaie donc TOUT l'espace des clés, pas trois cas choisis — et l'exhaustivité de ce
 * balayage est celle du compilateur : `CLES_HUD` est typée `Record<keyof HudState, true>`,
 * donc un champ ajouté à `HudState` sans l'être ici ne compile pas.
 */
import { describe, expect, it } from 'vitest'
import type Phaser from 'phaser'
import { CLES_HUD, getHud, resetHud, setHud, type HudState } from './hud-state'

/** Le strict nécessaire du `DataManager` de Phaser : ce que `setHud`/`getHud`/`resetHud` touchent. */
function registryFactice(): Phaser.Data.DataManager & { taille(): number } {
  const store = new Map<string, unknown>()
  return {
    set: (key: string, value: unknown) => store.set(key, value),
    get: (key: string) => store.get(key),
    remove: (key: string) => store.delete(key),
    taille: () => store.size,
  } as unknown as Phaser.Data.DataManager & { taille(): number }
}

const CLES = Object.keys(CLES_HUD) as (keyof HudState)[]

describe('ce qui survit à un retour au menu', () => {
  it('n’oublie AUCUNE clé du HUD — pas une seule ne traverse', () => {
    const reg = registryFactice()
    // Une marque reconnaissable dans chaque clé. Le type de la valeur n'a pas d'importance :
    // on teste l'effacement, pas le contenu — d'où l'unique coercition de ce fichier.
    for (const cle of CLES) setHud(reg, cle, 'la partie d’avant' as never)
    expect(reg.taille()).toBe(CLES.length)

    resetHud(reg)

    expect(reg.taille()).toBe(0)
    for (const cle of CLES) expect(getHud(reg, cle)).toBeUndefined()
  })

  it('efface, il ne repose pas une valeur vide — `undefined` EST l’état d’une page fraîche', () => {
    // La nuance compte : `getHud` documente `undefined` comme « WorldScene n'a pas encore
    // écrit ». Poser une valeur de repos à la place inventerait un second état, et `mapData`
    // n'en a de toute façon aucun qui soit vide.
    const reg = registryFactice()
    setHud(reg, 'worldReady', true)
    resetHud(reg)
    expect(reg.taille()).toBe(0)
  })

  it('sur un registry déjà vide, ne fait rien (le boot passe par là)', () => {
    const reg = registryFactice()
    resetHud(reg)
    expect(reg.taille()).toBe(0)
  })
})
