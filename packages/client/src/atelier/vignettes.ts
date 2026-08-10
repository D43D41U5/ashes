/**
 * LA PLANCHE DE VARIANTES (spec `atelier-plans.md` P-C) — rotations, sorts, nuit, en
 * vignettes VIVANTES : rendues par le VRAI pipeline (un second `Phaser.Game`, hors écran,
 * qui rejoue BootScene + AtelierScene), SÉQUENTIELLEMENT — jamais six vues simultanées.
 *
 * LE COÛT SE MESURE (la règle du dépôt : pas d'engagement avant le chiffre) : chaque passe
 * affiche sa durée, et au-delà du BUDGET l'auto-rafraîchissement se coupe — la planche
 * passe en manuel et le DIT. Le premier rendu paie le boot du mini-jeu (génération des
 * textures) ; il est mesuré à part pour ne pas incriminer les passes suivantes.
 */
import Phaser from 'phaser'
import type { SimState, SortDuLieu } from '@ashes/sim'
import { BootScene } from '../scenes/BootScene'
import { AtelierScene } from './scene'

export interface Variante {
  etiquette: string
  sort: SortDuLieu
  quart: number
  heure: number
}

export const VARIANTES: readonly Variante[] = [
  { etiquette: '⟲ 90°', sort: 'intact', quart: 1, heure: 12 },
  { etiquette: '⟲ 180°', sort: 'intact', quart: 2, heure: 12 },
  { etiquette: '⟲ 270°', sort: 'intact', quart: 3, heure: 12 },
  { etiquette: 'pillé', sort: 'pille', quart: 0, heure: 12 },
  { etiquette: 'brûlé', sort: 'brule', quart: 0, heure: 12 },
  { etiquette: 'nuit', sort: 'intact', quart: 0, heure: 2 },
]

/** Au-delà de ce budget par PASSE COMPLÈTE, l'auto-rafraîchissement se coupe (mesuré). */
const BUDGET_MS = 1500

let mini: Phaser.Game | null = null
let derniereMesure = 0
let autoCoupe = false

function assurerMini(): Promise<AtelierScene> {
  if (!mini) {
    const conteneur = document.createElement('div')
    conteneur.style.cssText = 'position:fixed;left:-9999px;top:0;width:240px;height:240px'
    document.body.appendChild(conteneur)
    mini = new Phaser.Game({
      type: Phaser.AUTO,
      width: 240,
      height: 240,
      parent: conteneur,
      backgroundColor: '#181d15',
      antialias: true,
      roundPixels: true,
      render: { maxLights: 40 },
      scale: { mode: Phaser.Scale.NONE },
      scene: [BootScene, AtelierScene],
    })
  }
  return new Promise((resoudre) => {
    const attendre = (): void => {
      const sc = mini!.scene.getScene('menu') as AtelierScene | null
      if (sc?.pret) resoudre(sc)
      else window.setTimeout(attendre, 120) //  attente de boot seulement
    }
    attendre()
  })
}

const pause = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms))

function capturer(): Promise<string> {
  return new Promise((resoudre) => {
    mini!.renderer.snapshot((img) => resoudre((img as HTMLImageElement).src))
  })
}

/** L'auto-rafraîchissement est-il encore permis ? (coupé quand la mesure dépasse le budget) */
export function autoPermis(): boolean {
  return !autoCoupe
}

/** Les dernières vignettes rendues (dataURL par étiquette) — l'export PNG les recompose. */
export const dernieresVignettes = new Map<string, string>()

/**
 * RENDRE LA PLANCHE : chaque variante bâtie par l'appelant (le vrai moteur), montrée au
 * mini-jeu, capturée, posée dans `conteneur`. Rend la durée MESURÉE de la passe (ms).
 */
/** LE VERROU DE PASSE (revue du 2026-08-10) : deux passes sur le MÊME mini-renderer
 *  s'entrelaçaient (vignettes sous la mauvaise étiquette, snapshot écrasé → passe pendue).
 *  Une seule passe à la fois ; une demande pendant la passe se REJOUE à la fin. */
let passeEnCours = false
let repasse: (() => void) | null = null

export async function rendrePlanche(
  conteneur: HTMLElement,
  bati: (sort: SortDuLieu, quart: number) => { sim: SimState; playerId: number },
  surPromouvoir: (v: Variante) => void,
  afficherCout: (texte: string) => void,
): Promise<number> {
  if (passeEnCours) {
    repasse = () => { void rendrePlanche(conteneur, bati, surPromouvoir, afficherCout) }
    return 0
  }
  passeEnCours = true
  const boot = mini === null
  const sc = await assurerMini()
  mini!.loop.wake() //  le mini-jeu dort entre deux passes — pas de RAF permanente hors écran
  const t0 = performance.now()
  conteneur.innerHTML = ''
  dernieresVignettes.clear()
  for (const v of VARIANTES) {
    sc.heure = v.heure
    sc.calques = { toits: true, aretes: false, regions: false, grille: false }
    const { sim, playerId } = bati(v.sort, v.quart)
    sc.montrer(sim, playerId, [], [], false)
    await pause(120) //  deux battements de rendu — SwiftShader compris
    const url = await capturer()
    dernieresVignettes.set(v.etiquette, url)
    const fig = document.createElement('figure')
    const img = document.createElement('img')
    img.src = url
    img.alt = v.etiquette
    const legende = document.createElement('figcaption')
    legende.textContent = v.etiquette
    fig.appendChild(img)
    fig.appendChild(legende)
    fig.addEventListener('click', () => surPromouvoir(v))
    conteneur.appendChild(fig)
  }
  const duree = Math.round(performance.now() - t0)
  derniereMesure = duree
  if (!boot && duree > BUDGET_MS && !autoCoupe) {
    autoCoupe = true
    afficherCout(`${duree} ms — LENT : l'auto-rafraîchissement se coupe, bouton « rafraîchir »`)
  } else {
    afficherCout(`${duree} ms${boot ? ' (boot du mini-jeu compris)' : ''}${autoCoupe ? ' · auto coupé' : ''}`)
  }
  mini!.loop.sleep()
  passeEnCours = false
  if (repasse) {
    const relance = repasse
    repasse = null
    relance() //  la dernière demande arrivée pendant la passe gagne
  }
  return duree
}

/** EXPORT PNG : la vue principale + les six vignettes, composées sur un canvas — un fichier
 *  qu'on poste dans une discussion, pas une capture d'écran à recadrer. */
export async function exporterPlanche(kind: string, jeuPrincipal: Phaser.Game): Promise<void> {
  const principale = await new Promise<HTMLImageElement>((resoudre) => {
    jeuPrincipal.renderer.snapshot((img) => resoudre(img as HTMLImageElement))
  })
  const VIGNETTE = 220
  const canvas = document.createElement('canvas')
  const hautPrincipal = 480
  const largPrincipal = Math.round((principale.width / principale.height) * hautPrincipal)
  canvas.width = largPrincipal + 2 * (VIGNETTE + 8) + 24
  canvas.height = Math.max(hautPrincipal, 3 * (VIGNETTE + 26)) + 16
  const g = canvas.getContext('2d')!
  g.fillStyle = '#14110d'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.imageSmoothingEnabled = false
  g.drawImage(principale, 8, 8, largPrincipal, hautPrincipal)
  g.font = '12px monospace'
  g.textAlign = 'center'
  let i = 0
  for (const [etiquette, url] of dernieresVignettes) {
    const img = new Image()
    await new Promise<void>((r) => { img.onload = (): void => r(); img.src = url })
    const x = largPrincipal + 16 + (i % 2) * (VIGNETTE + 8)
    const y = 8 + Math.floor(i / 2) * (VIGNETTE + 26)
    g.drawImage(img, x, y, VIGNETTE, VIGNETTE)
    g.fillStyle = '#d8d2c6'
    g.fillText(etiquette, x + VIGNETTE / 2, y + VIGNETTE + 14)
    i += 1
  }
  const lien = document.createElement('a')
  lien.download = `plan-${kind}.png`
  lien.href = canvas.toDataURL('image/png')
  lien.click()
}

export function mesurePlanche(): number {
  return derniereMesure
}
