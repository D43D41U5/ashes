/**
 * ═══ LE VOL DES OISEAUX — les lois PURES du décor ailé (Alexis, 2026-09-08 : « fais tout ») ═══
 *
 * Tout ce qui, dans un vol, se CALCULE plutôt que se dessine : à quelle heure le ciel en
 * porte, de quelle teinte le moment les habille, quelle espèce un endroit appelle, où en est
 * le battement d'aile, et de combien la nuée a quitté le sol. Aucun import Phaser — même
 * patron que `couvre-feu-lucioles.ts` et `fondu-essaim.ts` : ce qui est pur est prouvé.
 *
 * ⚠ **CE MODULE NE COMMANDE PAS L'ENVOL DE LISIÈRE.** `densiteDeVol` ne borne que les vols de
 * TRAVERSÉE (le décor qui passe). La nuée de `AmbientLife.envol()` naît d'un fait de la sim
 * (`bird_flush`, émis sur un pas bruyant à n'importe quelle heure) et le son part avec lui :
 * la faire taire la nuit rendrait le défaut qu'on corrige, retourné — on entendrait la nuée
 * sans la voir. Ce que l'heure lui accorde, c'est sa TEINTE, jamais son existence.
 */
import {
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_BOULDERS,
  TERRAIN_BURNT_FOREST,
  TERRAIN_CENDRE_MIN,
  TERRAIN_CENDRE_PRE,
  TERRAIN_CLAIRIERE,
  TERRAIN_CLIFF,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_GRASS,
  TERRAIN_HEATH,
  TERRAIN_JUNIPER_HEATH,
  TERRAIN_ROAD,
  TERRAIN_ROCK,
  TERRAIN_SCREE,
  TERRAIN_WET_MEADOW,
} from '@ashes/sim'

/* ══ ① L'HEURE — combien le ciel en porte ═══════════════════════════════════════════════ */

/**
 * ═══ LES BORNES SONT CELLES DE L'AUDIO, ET C'EST TOUT LE POINT ═══
 *
 * `audio/aube.ts` avait déjà tranché la loi des oiseaux : `chantsDensite` vaut zéro hors de
 * **4 h 48 – 8 h 45**, plein chœur de 6 h à 7 h 30. Le VOL, lui, ne connaissait rien : les vols
 * traversaient le ciel toutes les 9 à 26 s, à midi comme à trois heures du matin. On entendait
 * donc les oiseaux à l'aube et on les voyait passer en pleine nuit — la seule chose ambiante du
 * jeu qui ignorât l'heure, quand la luciole d'à côté en consomme DEUX horloges.
 *
 * Les trois bornes de l'aube sont donc reprises À L'IDENTIQUE (4,8 / 6 / 7,5 / 8,75), et
 * l'horloge est la MÊME : l'heure MURALE du cycle, jamais le lever saisonnier. Ancrer l'image
 * sur `lever` pendant que le son reste sur des heures fixes ferait dériver les deux d'une
 * saison à l'autre — on aurait acheté une incohérence neuve pour en payer une ancienne.
 * *(Le jour où l'audio passera au lever, ce fichier suivra : c'est le sens de cette note.)*
 *
 * LA FORME — quatre régimes, une seule pente entre chacun (bornes exactes, règle maison) :
 *   · **la nuit** : zéro, franchement. Un ciel vide est ce qui fait exister le passage.
 *   · **l'aube** : montée de 4,8 à 6, plein de 6 à 7,5 — le chœur qu'on entend, on le voit.
 *   · **le jour** : retombée jusqu'à `VOL_JOUR` — le ciel n'est pas vide, il est calme.
 *   · **le soir** : regain jusqu'à `VOL_SOIR` (le retour au dortoir), puis zéro à la nuit.
 *
 * Le rendu est un FACTEUR : l'appelant en tire l'intervalle entre deux vols (il le DIVISE par
 * la densité) — un ciel à 0,4 espace les passages deux fois et demie plus qu'à l'aube.
 */
export const VOL_AUBE_DE = 4.8
export const VOL_AUBE_PLEIN = 6
export const VOL_AUBE_FIN = 7.5
export const VOL_JOUR_DE = 8.75
export const VOL_SOIR_DE = 17
export const VOL_SOIR_PLEIN = 19
export const VOL_NUIT_A = 20.75
/** Le régime de croisière du plein jour. **Le bouton du « ciel vide »** : à 0 le jour n'a plus
 *  un oiseau et le passage redevient un événement de l'aube et du soir, rien d'autre. */
export const VOL_JOUR = 0.4
/** Le retour au dortoir — plus dense que le plein jour, moins que le chœur de l'aube. */
export const VOL_SOIR = 0.8

/**
 * Ramène une heure dans [0, 24) — **sans toucher à celle qui y est déjà**.
 *
 * ⚠ LE `((h % 24) + 24) % 24` NAÏF SALIT LES BORNES, et la garde l'a attrapé : `4,8` en
 * ressort à `4,800000000000001`, donc `densiteDeVol(VOL_AUBE_DE)` rendait un epsilon POSITIF
 * là où l'audio rend zéro — l'accord des deux horloges cassait sur la borne même qu'il
 * promet. Un cycle du jeu ne sort jamais de [0, 24) : le repli est un filet, pas un passage
 * obligé, et il n'a aucune raison de coûter un aller-retour en virgule flottante.
 */
function heureRepliee(h: number): number {
  if (h >= 0 && h < 24) return h
  const m = h % 24
  return m < 0 ? m + 24 : m
}

/**
 * La part de vols que l'HEURE accorde au ciel, dans [0, 1].
 *
 * @param hourOfCycle heure murale du cycle (`GameTime.hourOfCycle`), dans [0, 24).
 */
export function densiteDeVol(hourOfCycle: number): number {
  const h = heureRepliee(hourOfCycle)
  if (h <= VOL_AUBE_DE || h >= VOL_NUIT_A) return 0
  if (h < VOL_AUBE_PLEIN) return (h - VOL_AUBE_DE) / (VOL_AUBE_PLEIN - VOL_AUBE_DE)
  if (h <= VOL_AUBE_FIN) return 1
  if (h < VOL_JOUR_DE) return 1 - (1 - VOL_JOUR) * ((h - VOL_AUBE_FIN) / (VOL_JOUR_DE - VOL_AUBE_FIN))
  if (h <= VOL_SOIR_DE) return VOL_JOUR
  if (h < VOL_SOIR_PLEIN) return VOL_JOUR + (VOL_SOIR - VOL_JOUR) * ((h - VOL_SOIR_DE) / (VOL_SOIR_PLEIN - VOL_SOIR_DE))
  return VOL_SOIR * (1 - (h - VOL_SOIR_PLEIN) / (VOL_NUIT_A - VOL_SOIR_PLEIN))
}

/* ══ ② LA TEINTE — de quel moment l'oiseau est habillé ══════════════════════════════════ */

/**
 * ═══ CE QUE L'HEURE FAIT À UN OISEAU, ET SUR QUOI ÇA SE VOIT ═══
 *
 * La teinte MULTIPLIE : sur le corps, presque noir par construction (c'est une silhouette vue
 * de dessous-dessus), elle ne peut rien. C'est **l'arête claire du dos** (`OISEAU_DOS`) qui la
 * porte — le seul pixel clair du sprite, et la raison pour laquelle la règle ② du tétras
 * (« il faut une arête claire sur le dos ») paie deux fois : elle sauve la silhouette ET elle
 * donne à l'heure une prise.
 *
 * Trois ancres, deux fondus : le gris-bleu froid de l'aube, le neutre du plein jour, l'ambre
 * du couchant. Rien la nuit — `densiteDeVol` y vaut zéro, et la teinte n'y sert qu'à la nuée
 * de lisière, qui garde donc l'ambre du soir jusqu'à l'aube (un envol nocturne est éclairé par
 * ce qui reste du couchant, pas par un projecteur).
 */
export const TEINTE_AUBE = 0xb9c4d8
export const TEINTE_JOUR = 0xffffff
export const TEINTE_SOIR = 0xf0b98a
const TEINTE_AUBE_FIN = 9
const TEINTE_SOIR_DE = 16

/** Mélange deux couleurs 0xRRGGBB canal par canal. `t` est borné dans [0, 1]. */
function melerCouleur(a: number, b: number, t: number): number {
  const k = t < 0 ? 0 : t > 1 ? 1 : t
  const r = Math.round(((a >> 16) & 0xff) + (((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * k)
  const g = Math.round(((a >> 8) & 0xff) + (((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * k)
  const bl = Math.round((a & 0xff) + ((b & 0xff) - (a & 0xff)) * k)
  return (r << 16) | (g << 8) | bl
}

/** La teinte que l'heure murale donne à un oiseau (0xRRGGBB, à passer à `setTint`). */
export function teinteDuVol(hourOfCycle: number): number {
  const h = heureRepliee(hourOfCycle)
  if (h <= VOL_AUBE_PLEIN) return TEINTE_AUBE
  if (h < TEINTE_AUBE_FIN) return melerCouleur(TEINTE_AUBE, TEINTE_JOUR, (h - VOL_AUBE_PLEIN) / (TEINTE_AUBE_FIN - VOL_AUBE_PLEIN))
  if (h <= TEINTE_SOIR_DE) return TEINTE_JOUR
  if (h < VOL_SOIR_PLEIN) return melerCouleur(TEINTE_JOUR, TEINTE_SOIR, (h - TEINTE_SOIR_DE) / (VOL_SOIR_PLEIN - TEINTE_SOIR_DE))
  return TEINTE_SOIR
}

/* ══ ③ L'ESPÈCE — ce qu'un endroit appelle ══════════════════════════════════════════════ */

export type EspeceOiseau = 'passereau' | 'corbeau' | 'rapace'

/**
 * ═══ TROIS OISEAUX, ET LE LIEU LES CHOISIT — une règle, pas une liste ═══
 *
 * Le patron de `firefly-biomes.ts` : la garde balaie les 31 terrains et affirme la règle sur
 * chacun, plutôt que d'inspecter les ids qu'on a écrits.
 *
 * - **Le RAPACE** plane au-dessus du **haut pays nu et de la pierre** — landes, prés d'altitude,
 *   éboulis, roche, falaise, chaos de blocs. Seul, haut, lent, en cercles : il ne traverse pas,
 *   il TIENT. Aux heures chaudes seulement (les ascendances), et c'est ce qui en fait un
 *   événement plutôt qu'un motif.
 * - **Le CORVIDÉ** tient le **découvert ouvert et la cendre** — prés, clairières, chemins, et
 *   la Cendrière où il est chez lui. Par deux ou trois, grand, lent, sombre. Le jour installé.
 * - **Le PASSEREAU** est le reste, et il est le DÉFAUT : le bois, l'eau, la neige, tout ce
 *   qu'aucun des deux autres ne réclame — et **toute l'aube**, quel que soit le sol. C'est lui
 *   la nuée de la lisière (`envol()` ne demande jamais l'espèce : elle est passereau par
 *   définition, ce sont les petits oiseaux du sous-bois qui giclent d'un bois).
 *
 * ⚠ **L'HEURE PASSE AVANT LE SOL.** À l'aube, un pré appelle le passereau, pas le corbeau :
 * sans cette priorité, le chœur du matin serait un vol de corvidés. Le sol ne décide que
 * lorsque l'aube est finie.
 */
const TERRAINS_RAPACE: ReadonlySet<number> = new Set([
  TERRAIN_HEATH,
  TERRAIN_JUNIPER_HEATH,
  TERRAIN_ALPINE_MEADOW,
  TERRAIN_ALPINE_FLOWERS,
  TERRAIN_SCREE,
  TERRAIN_BOULDERS,
  TERRAIN_ROCK,
  TERRAIN_CLIFF,
])
const TERRAINS_CORBEAU: ReadonlySet<number> = new Set([
  TERRAIN_GRASS,
  TERRAIN_FLOWER_MEADOW,
  TERRAIN_WET_MEADOW,
  TERRAIN_CLAIRIERE,
  TERRAIN_ROAD,
  TERRAIN_CENDRE_PRE,
  TERRAIN_CENDRE_MIN,
  TERRAIN_BURNT_FOREST,
])
/** Les ascendances : le rapace ne plane qu'aux heures où l'air porte. */
export const RAPACE_DE = 10
export const RAPACE_A = 16.5
/** La part des vols que le lieu concède à l'espèce qu'il appelle — le reste reste passereau.
 *  Un ciel qui ne montrerait QUE des corbeaux au-dessus d'un pré serait un motif, pas un lieu. */
export const PART_CORBEAU = 0.55
export const PART_RAPACE = 0.7

/**
 * L'espèce d'un vol qui s'ouvre.
 *
 * @param terrain terrain VU sous le point d'entrée (`PaveLayer.terrainAffiche`), -1 hors carte.
 * @param hourOfCycle heure murale du cycle.
 * @param tirage un tirage dans [0, 1) — l'appelant possède son hasard (le décor n'est pas de
 *   la sim : rien à rejouer, et `ambient-life` tire déjà au `Math.random` partout).
 */
export function especeDuVol(terrain: number, hourOfCycle: number, tirage: number): EspeceOiseau {
  const h = heureRepliee(hourOfCycle)
  // L'AUBE PASSE AVANT LE SOL : le chœur du matin est un chœur de passereaux.
  if (h < VOL_JOUR_DE) return 'passereau'
  if (h >= RAPACE_DE && h <= RAPACE_A && TERRAINS_RAPACE.has(terrain)) {
    return tirage < PART_RAPACE ? 'rapace' : 'passereau'
  }
  if (TERRAINS_CORBEAU.has(terrain)) return tirage < PART_CORBEAU ? 'corbeau' : 'passereau'
  return 'passereau'
}

/* ══ ④ LE BATTEMENT — l'image d'aile du moment ══════════════════════════════════════════ */

/**
 * ═══ UNE AILE BAT EN CHANGEANT D'ENVERGURE, PAS EN S'APLATISSANT ═══
 *
 * Le battement était `setScale(1, 0.55 + 0.45|sin|)` : tout l'oiseau se comprimait. Ça ne lit
 * pas comme une aile — ça lit comme un décalque qui pulse, et la règle maison (`feel = pente
 * continue sur la GÉOMÉTRIE`) dit pourquoi : on déformait l'élément, pas la chose qui bouge.
 *
 * Vu de dessus, un battement se lit à l'ENVERGURE : ailes tendues à la descente (pleine
 * envergure), ramenées et fléchies à la remontée (envergure courte, ailes en arrière). Trois
 * images suffisent — et elles se parcourent en ALLER-RETOUR (0-1-2-1), jamais en boucle : une
 * boucle 0-1-2-0 rend un saut de la position repliée à la position tendue, c'est-à-dire un
 * claquement. Le cycle fait donc quatre pas pour trois images.
 */
export const IMAGES_AILE = 3
const CYCLE = [0, 1, 2, 1] as const

/**
 * L'index d'image d'aile, dans [0, IMAGES_AILE).
 *
 * @param nowS   horloge de la scène, en secondes.
 * @param cadence battements par seconde de l'espèce.
 * @param phase  déphasage propre à l'oiseau — un vol n'est pas un métronome.
 */
export function imageDAile(nowS: number, cadence: number, phase: number): number {
  const pas = Math.floor((nowS * cadence + phase) * CYCLE.length) % CYCLE.length
  return CYCLE[(pas + CYCLE.length) % CYCLE.length]!
}

/* ══ ⑤ L'ALTITUDE — ce qui pose l'oiseau DANS le monde ══════════════════════════════════ */

/**
 * ═══ L'OMBRE EST LE SEUL INDICE D'ALTITUDE QU'ON AIT ═══
 *
 * Vue de dessus, rien ne distingue un oiseau qui rase le sol d'un oiseau à trente mètres : même
 * sprite, même vitesse apparente. C'est l'ÉCART entre l'oiseau et son ombre qui dit la hauteur
 * — et c'est ce qui fait de l'envol de lisière une chose qui QUITTE le sol au lieu d'un sprite
 * qui apparaît. Une nuée qui gicle part avec son ombre collée sous elle, et l'ombre se décroche
 * pendant qu'elle monte.
 *
 * `altitudeDeMontee` est la rampe, adoucie aux deux bouts (même smoothstep que `adoucir` des
 * essaims : ce sont les CASSURES de pente que l'œil attrape). Un vol de traversée entre en
 * scène à son altitude de croisière (il vient de loin) ; une nuée levée part de ZÉRO.
 */
export const MONTEE_S = 1.6

/** La part d'altitude atteinte après `ageS` secondes de montée, dans [0, 1]. */
export function altitudeDeMontee(ageS: number): number {
  if (ageS <= 0) return 0
  if (ageS >= MONTEE_S) return 1
  const t = ageS / MONTEE_S
  return t * t * (3 - 2 * t)
}
