/**
 * LE BATTANT QUI PIVOTE — quelle frame de porte montrer, à cet instant (spec construction R26).
 *
 * ═══ POURQUOI C'EST UN MODULE PUR, ET PAS TROIS LIGNES DANS `snapshot-view` ═══
 *
 * Parce que la seule chose difficile ici est la DIVERGENCE, et qu'elle ne se voit qu'en la
 * testant. Une porte a deux sources de vérité qui n'arrivent pas ensemble :
 *   • le FAIT (`door_toggled`), qui dit « elle vient de bouger, montre-la bouger » ;
 *   • l'ÉTAT du snapshot (`open`), qui dit « voilà où elle en est », y compris quand on n'a rien
 *     vu passer — à la connexion, après un rechargement, ou si l'événement s'est perdu.
 *
 * La règle est donc : **on anime sur le FAIT, on se CALE sur l'ÉTAT**. Si l'état contredit
 * l'animation en cours, on abandonne l'animation et on saute — sinon une porte rejouerait son
 * geste à chaque reconnexion, et une base entière s'ouvrirait en fanfare devant un joueur qui
 * vient seulement de charger sa partie.
 *
 * ═══ LE TEMPS EST UN NIVEAU, PAS UN FRONT ═══
 *
 * On ne programme aucun réveil : on demande « quelle frame maintenant ? » à chaque image, et la
 * réponse se DÉDUIT de l'horloge. C'est ce qui rend l'animation increvable quand l'horloge saute
 * (le rendu headless avale des secondes entières) : au pire on rate des frames intermédiaires,
 * jamais l'état final. Un `delayedCall` sur le front, lui, se serait fait enjamber.
 *
 * ═══ ET LA COLLISION, ELLE, BASCULE D'UN COUP ═══
 *
 * L'animation est PUREMENT visuelle : /sim retourne `open` au tick, donc pendant ~300 ms on peut
 * franchir une porte dont le battant finit de s'écarter. C'est le compromis habituel et il est
 * court ; l'inverse — attendre la fin du dessin pour ouvrir le passage — mettrait le rendu aux
 * commandes de la simulation, ce que l'invariant n°3 interdit.
 */

/**
 * LA DURÉE D'UN BATTANT, en millisecondes.
 *
 * Elle est ici et pas ailleurs parce que **le son la lit aussi** (`soundForEvent`) : un grincement
 * qui durerait plus ou moins que le geste se remarquerait immédiatement, et deux constantes
 * jumelles finissent toujours par se désaccorder à la première retouche.
 */
export const PORTE_ANIM_MS = 300

/** Le nombre de positions du battant — l'échantillonnage vit dans `bati-art` (`PORTE_FRAMES`). */
export const PORTE_NB_FRAMES = 5

/** Le temps que chaque frame tient à l'écran : la durée répartie sur les pas, pas sur les images. */
const PAS_MS = PORTE_ANIM_MS / (PORTE_NB_FRAMES - 1)

interface Battant {
  /** Vers quoi on va : `true` = ouverte (frame haute), `false` = close (frame 0). */
  cible: boolean
  /** La frame d'où l'on part — pas forcément une extrémité (voir le double appui). */
  depart: number
  debutMs: number
}

export interface PortesAnimees {
  /** Un fait `door_toggled` est arrivé : on lance le geste. */
  pousse(id: number, open: boolean, nowMs: number): void
  /** La frame à montrer pour cette porte, maintenant. `open` est l'état du snapshot. */
  frame(id: number, open: boolean, nowMs: number): number
  /** Combien de battants sont en train de bouger — pour les gardes, et pour rien d'autre. */
  enCours(nowMs: number): number
  /** Oublie tout (retour au menu, changement de monde). */
  vide(): void
}

const OUVERTE = PORTE_NB_FRAMES - 1

export function creerPortesAnimees(): PortesAnimees {
  const battants = new Map<number, Battant>()

  /** La frame atteinte par ce battant à cet instant, bornée à la cible. */
  const avance = (b: Battant, nowMs: number): number => {
    const pas = Math.floor(Math.max(0, nowMs - b.debutMs) / PAS_MS)
    const fin = b.cible ? OUVERTE : 0
    const f = b.cible ? b.depart + pas : b.depart - pas
    return b.cible ? Math.min(fin, f) : Math.max(fin, f)
  }

  return {
    pousse(id, open, nowMs) {
      // ON REPART D'OÙ LE BATTANT EN EST, jamais du début : deux appuis rapides sur la touche
      // doivent le faire REVENIR sur ses pas, pas le téléporter à l'autre bout de sa course.
      const encours = battants.get(id)
      const depart = encours ? avance(encours, nowMs) : open ? 0 : OUVERTE
      battants.set(id, { cible: open, depart, debutMs: nowMs })
    },

    frame(id, open, nowMs) {
      const b = battants.get(id)
      const repos = open ? OUVERTE : 0
      if (b === undefined) return repos
      // L'ÉTAT CONTREDIT LE GESTE : on jette l'animation et on saute. C'est le cas de la
      // reconnexion et de l'événement perdu — animer là-dessus ferait rejouer tout un village.
      if (b.cible !== open) {
        battants.delete(id)
        return repos
      }
      const f = avance(b, nowMs)
      if (f === repos) battants.delete(id) //  arrivé : on ne garde pas d'entrée morte
      return f
    },

    enCours(nowMs) {
      let n = 0
      for (const b of battants.values()) {
        const fin = b.cible ? OUVERTE : 0
        if (avance(b, nowMs) !== fin) n += 1
      }
      return n
    },

    vide() {
      battants.clear()
    },
  }
}
