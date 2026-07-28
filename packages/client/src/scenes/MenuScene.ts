/**
 * L'ÉCRAN PRINCIPAL — le premier choix : jouer SEUL (la Veillée, /sim dans un Worker)
 * ou REJOINDRE une vallée partagée (un serveur, /sim sur Node). C'est le seul aiguillage
 * solo/multi ; WorldScene reçoit le choix par les `data` de scène et n'instancie pas
 * l'hôte lui-même (« seul le transport change »).
 *
 * CINQ VALLÉES depuis le 2026-07-28 : l'écran ne propose plus une porte unique qui reprenait
 * en silence la sauvegarde, mais l'ÉTAT DU DISQUE — cinq cases, chacune vide (à fonder, avec
 * sa seed) ou occupée (à reprendre, à effacer). Le menu est le seul endroit d'où l'on efface
 * un monde : `clearSlot` exige qu'aucun Worker ne vive (voir `persistence-store.ts`), ce qui
 * est vrai ici et nulle part ailleurs.
 *
 * DEEP-LINK : `?solo` démarre droit en Veillée, `?server=ws://…` droit sur un serveur —
 * on saute le menu. Le smoke test s'en sert (`?solo`) pour piloter le jeu sans cliquer ;
 * un humain sans query voit le menu. `?solo` seul vise la CASE 0 et la seed canonique,
 * exactement comme avant l'écran des mondes : les scénarios de smoke ne bougent pas.
 * `?slot=N` et `?seed=S` le précisent, `?fresh` efface la case visée avant de démarrer.
 *
 * RENDU : la planche est en DOM (voir `ui/menu-dom.ts`), rendue ISO à la maquette
 * « Ashes UI » Turn 9A — le canvas Phaser ne saurait égaler un titre en `text-shadow`,
 * un anneau en `conic-gradient` et la police `JetBrains Mono` sans se créneler à
 * l'upscale. Cette scène ne fait donc que MONTER le voile, brancher les gestes, et le
 * RETIRER au lancement d'une partie (ou à l'arrêt de la scène).
 */
import Phaser from 'phaser'
import { mountMenu, type MenuHandle } from './ui/menu-dom'
import { clearSlot, listSlots, type SlotMeta } from '../worker/persistence-store'
import { SLOT_COUNT, seedValide, slotValide, VEILLEE_SEED } from '../worker/mondes'
import { clearFog } from '../render/fog'
import { lireDerniereMulti } from '../derniere-partie'
import type { WorldSceneData } from './WorldScene'

export class MenuScene extends Phaser.Scene {
  private menu: MenuHandle | undefined
  /** La scène s'est-elle arrêtée avant que le disque ne réponde ? (le montage est asynchrone) */
  private parti = false

  constructor() {
    super('menu')
  }

  create(): void {
    this.parti = false
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.parti = true
      this.dismiss()
    })

    // DEEP-LINK : on saute le menu si l'intention est explicite dans l'URL.
    const params = new URLSearchParams(window.location.search)
    if (params.has('solo')) {
      const slot = lireEntier(params.get('slot'), 0, slotValide)
      const seed = lireEntier(params.get('seed'), VEILLEE_SEED, seedValide)
      // `?fresh` — NOUVELLE VEILLÉE : on efface la sauvegarde AVANT de démarrer, pour repartir
      // de zéro. Indispensable au playtest de calibration : une sauvegarde fige son
      // `calendarScale`, donc un nouveau `VEILLEE_SEASON_CYCLES` n'entre en jeu qu'à neuf.
      if (params.has('fresh')) {
        // Une Veillée NEUVE oublie aussi la CARTE : le brouillard vit hors de la sauvegarde de
        // sim (localStorage), donc `clearSlot` ne l'emporte pas. Sans ça, on rouvrirait une
        // vallée vierge avec le savoir géographique de la précédente — plus rien à découvrir.
        clearFog(slot)
        void clearSlot(slot).finally(() => this.launch({ mode: 'solo', slot, seed }))
        return
      }
      return this.launch({ mode: 'solo', slot, seed })
    }
    const server = params.get('server')
    if (server) return this.launch({ mode: 'multi', url: server })

    // L'ÉTAT DU DISQUE D'ABORD : l'écran ne se monte qu'une fois qu'il sait quoi montrer —
    // afficher cinq cases vides puis les remplir ferait clignoter le seuil du jeu. Un disque
    // refusé (navigation privée) ne bloque pas : cinq cases vides, et le jeu reste jouable
    // (le HUD dit déjà quand une sauvegarde échoue).
    void listSlots()
      .catch(() => new Array<SlotMeta | null>(SLOT_COUNT).fill(null))
      .then((slots) => {
        if (this.parti) return
        this.menu = mountMenu(slots, lireDerniereMulti(), {
          // LA SEED VOYAGE AVEC LA REPRISE, alors qu'une sauvegarde lisible porte la sienne.
          // Elle sert au SEUL cas où la case ne se relit pas : format de sauvegarde incompatible
          // (une bosse de `SAVE_FORMAT_VERSION`) ou enregistrement corrompu. `boot()` régénère
          // alors un monde neuf — et sans ça il le régénérait avec la seed canonique, donc les
          // cinq cases deviendraient LA MÊME vallée, chacune ayant annoncé la sienne juste avant.
          // `||` et non `??` : la seed 0 est l'inconnu de `metaDepuisSauvegarde`, pas une seed.
          onContinue: (slot) => this.launch({ mode: 'solo', slot, seed: slots[slot]?.seed || VEILLEE_SEED }),
          onCreate: (slot, seed, nom) => this.launch({ mode: 'solo', slot, seed, nom }),
          // Effacer un monde emporte AUSSI son brouillard : refonder une vallée dans cette case
          // doit être une vraie découverte, pas une carte déjà dépliée sur un terrain inconnu.
          onDelete: (slot) => clearSlot(slot).then(() => clearFog(slot)),
          onServer: (s) => this.launch({ mode: 'multi', url: s.url }),
        })
      })
  }

  private dismiss(): void {
    this.menu?.destroy()
    this.menu = undefined
  }

  private launch(data: WorldSceneData): void {
    this.dismiss() // retirer le voile AVANT de révéler le monde
    this.scene.start('world', data)
  }
}

/** Un entier d'URL, ou le défaut — jamais une valeur hors bornes (elle écrirait une clé fantôme). */
function lireEntier(brut: string | null, defaut: number, valide: (n: number) => boolean): number {
  if (brut === null) return defaut
  const n = Number(brut)
  return valide(n) ? n : defaut
}
