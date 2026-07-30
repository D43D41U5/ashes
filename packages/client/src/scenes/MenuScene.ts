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
import { resetHud } from '../hud-state'
import { UIScene } from './UIScene'
import { WorldScene, type WorldSceneData } from './WorldScene'

/**
 * L'INTENTION PORTÉE PAR L'URL, LUE UNE SEULE FOIS — et c'est le fond de l'affaire : un
 * deep-link dit comment ENTRER DANS LA PAGE, pas ce que doit faire `MenuScene` chaque fois
 * qu'elle démarre.
 *
 * La nuance était invisible tant que quitter rechargeait : `MenuScene.create()` ne tournait
 * qu'une fois par page. Depuis le retour sans rechargement (2026-07-29), `?solo` était encore
 * dans la barre d'adresse au retour au menu — et l'écran relançait aussitôt la partie qu'on
 * venait de quitter, en boucle, sans jamais se montrer.
 */
let deepLink: URLSearchParams | null = new URLSearchParams(window.location.search)

export class MenuScene extends Phaser.Scene {
  private menu: MenuHandle | undefined
  /** La scène s'est-elle arrêtée avant que le disque ne réponde ? (le montage est asynchrone) */
  private parti = false

  constructor() {
    super('menu')
  }

  create(): void {
    this.parti = false
    // ON EFFACE LA PARTIE PRÉCÉDENTE DU REGISTRY. Il appartient au JEU, pas à la scène : rien
    // ne le vide quand WorldScene s'arrête. Tant que quitter rechargeait la page, personne
    // n'avait à s'en soucier ; depuis qu'on revient ici SANS rechargement, c'est la seule
    // mémoire qui traverse (voir `resetHud`). Au boot, il est déjà vide : coût nul.
    resetHud(this.registry)
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.parti = true
      this.dismiss()
    })

    // DEEP-LINK : on saute le menu si l'intention est explicite dans l'URL. CONSOMMÉ ICI —
    // il ne vaut que pour l'entrée dans la page (voir `deepLink`).
    const params = deepLink
    deepLink = null
    if (params?.has('solo')) {
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
    const server = params?.get('server')
    if (server) return this.launch({ mode: 'multi', url: server })

    // L'ÉTAT DU DISQUE D'ABORD : l'écran ne se monte qu'une fois qu'il sait quoi montrer —
    // afficher cinq cases vides puis les remplir ferait clignoter le seuil du jeu. Un disque
    // refusé (navigation privée) ne bloque pas : cinq cases vides, et le jeu reste jouable
    // (le HUD dit déjà quand une sauvegarde échoue).
    void listSlots()
      .catch(() => new Array<SlotMeta | null>(SLOT_COUNT).fill(null))
      .then((slots) => {
        if (this.parti) return
        this.rafraichirScenesDeJeu()
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

  /**
   * REMET À NEUF LES INSTANCES DE `world` ET `ui` — la moitié invisible du retour sans
   * rechargement.
   *
   * Phaser RÉUTILISE l'objet Scene : `scene.start('world')` rejoue `create()` sur la MÊME
   * instance. Or `WorldScene` porte 72 champs initialisés à la déclaration que `create()` ne
   * réassigne pas (`UIScene`, 13) — dont `worldReady`, qui n'est jamais remis à `false` et
   * ferait franchir à `update()` sa garde de montage, contre des objets que le shutdown vient
   * de détruire. On ne les énumère pas : on jette l'instance. Une classe neuve est exhaustive
   * par construction, et le champ ajouté demain est couvert d'office.
   *
   * ⚠ L'ORDRE DE RÉ-AJOUT EST L'ORDRE DE RENDU. `add` empile en fin de liste, et `main.ts`
   * déclare `[Boot, Menu, World, UI]` : `ui` doit repasser APRÈS `world`, sinon le monde se
   * dessine par-dessus le HUD à la deuxième partie.
   *
   * On ne le fait QUE si une partie a déjà tourné (au boot les instances sont neuves) et
   * DEPUIS le callback de `listSlots` — donc hors de la passe du gestionnaire de scènes, qui
   * mettrait `remove`/`add` en file d'attente. Le chemin deep-link (`?solo`) part, lui, avant
   * cette ligne : il ne voit jamais une scène en cours de ré-inscription.
   */
  private rafraichirScenesDeJeu(): void {
    if (!this.scene.get('world')?.sys.settings.isBooted) return // jamais jouée : rien à jeter
    this.scene.remove('world')
    this.scene.remove('ui')
    this.scene.add('world', WorldScene, false)
    this.scene.add('ui', UIScene, false)
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
