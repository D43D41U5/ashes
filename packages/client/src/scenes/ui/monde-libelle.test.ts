import { describe, expect, it } from 'vitest'
import type { SlotMeta } from '../../worker/persistence-store'
import { depuisQuand, etatDeMonde, nomDeCase } from './monde-libelle'

const meta = (p: Partial<SlotMeta> = {}): SlotMeta => ({ seed: 2026, seasonDay: 14, savedAt: 1000, createdAt: 0, ...p })

describe('ce qu’une ligne de l’écran des vallées annonce', () => {
  it('nomme la case par sa POSITION, à partir de 1 — pas par son index', () => {
    // Le joueur compte ses vallées de 1 à 5 ; l'index 0 est une affaire de clé de disque.
    expect(nomDeCase(0)).toBe('VALLÉE 1')
    expect(nomDeCase(4)).toBe('VALLÉE 5')
  })

  it('dit le jour atteint ET la seed — les deux choses qui distinguent deux vallées', () => {
    expect(etatDeMonde(meta())).toBe('jour 14 · seed 2026')
  })

  it('dit « jour ? » plutôt qu’un jour 1 inventé quand la sauvegarde n’a pas su s’ouvrir', () => {
    // Une case illisible reste occupée (donc effaçable) : elle ne doit surtout pas se lire
    // comme une partie fraîche, sinon c'est CELLE-LÀ qu'on efface pour faire de la place.
    // Les deux inconnus sont INDÉPENDANTS : une enveloppe sans échelle de calendrier garde
    // sa seed lisible, et on la dit — c'est ce qui permet de reconnaître SA vallée.
    expect(etatDeMonde(meta({ seasonDay: 0 }))).toBe('jour ? · seed 2026')
    expect(etatDeMonde(meta({ seed: 0 }))).toBe('jour 14')
    expect(etatDeMonde(meta({ seed: 0, seasonDay: 0 }))).toBe('jour ?')
  })
})

describe('depuis quand cette vallée dort', () => {
  const T = 1_700_000_000_000
  const ilYA = (ms: number): string => depuisQuand(T - ms, T)

  it('rend une durée courte, jamais une date', () => {
    expect(ilYA(5_000)).toBe("à l'instant")
    expect(ilYA(3 * 60_000)).toBe('il y a 3 min')
    expect(ilYA(2 * 3_600_000)).toBe('il y a 2 h')
    expect(ilYA(30 * 3_600_000)).toBe('hier')
    expect(ilYA(3 * 86_400_000)).toBe('il y a 3 jours')
  })

  it('tient sur les bornes exactes — pas de « il y a 60 min » ni de « il y a 24 h »', () => {
    expect(ilYA(59_999)).toBe("à l'instant")
    expect(ilYA(60_000)).toBe('il y a 1 min')
    expect(ilYA(3_599_999)).toBe('il y a 59 min')
    expect(ilYA(3_600_000)).toBe('il y a 1 h')
    expect(ilYA(86_399_999)).toBe('il y a 23 h')
    expect(ilYA(86_400_000)).toBe('hier')
  })

  it('SE TAIT quand l’horodatage est absent ou dans le futur', () => {
    // Le futur arrive pour de vrai : une sauvegarde faite avant un recalage d'horloge système.
    // « il y a -3 h » ferait douter de tout le reste de la ligne — mieux vaut ne rien dire.
    expect(depuisQuand(0, T)).toBe('')
    expect(depuisQuand(T + 60_000, T)).toBe('')
  })
})
