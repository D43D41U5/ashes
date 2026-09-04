/**
 * ═══ LA NUIT — LE CADRAN DE LA LUNE, ET LA CLARTÉ SUR SOI ═══
 *
 * Jusqu'ici la lune était un fait de RENDU : `client/render/lighting.ts` en tirait le voile,
 * et `/sim` ne savait pas qu'elle existait. Le monde était donc aussi dangereux sous la pleine
 * lune que sous la neuve — alors que le joueur, lui, VOIT la différence à l'écran. Un cadran
 * qu'on regarde et qui ne commande rien est un décor ; celui-ci commande, maintenant.
 *
 * Ce module ne fait qu'une chose : dire **combien il fait clair, ici, à ce tick**. Les règles
 * qui s'en servent vivent ailleurs (le corps dans `sim.ts`, la chasse dans `nighthunt.ts`) —
 * lui ne juge de rien.
 *
 * ═══ TROIS SOURCES, UNE SEULE LECTURE ═══
 *
 * La clarté sur soi est le MAX de trois choses, et jamais leur somme (deux torches n'éclairent
 * pas deux fois) :
 *   · **le ciel** — le jour à plein, la nuit ce que la lune en laisse ;
 *   · **le feu** — sa bulle, celle-là même qui réchauffe (`fireBubble`, rayon `T.FIRE_RANGE`) :
 *     ce qui chauffe éclaire, un seul rayon à calibrer, et il vaut déjà 6 tuiles côté client
 *     (le trou du voile d'un Feu) ;
 *   · **la torche en main** — à bout de bras, donc à plein sur son porteur.
 *
 * ⚠ CE N'EST PAS UN WARD (bible `I3`, et les trois interdits de `torche.md`). La torche ne
 * repousse RIEN et ne chauffe RIEN : les monstres se comportent à l'identique qu'on la porte
 * ou non. Ce que le noir prend, c'est une capacité de BASE du corps ; la lumière la rend. Le
 * jour, la pleine lune et le coin du feu sont au même niveau — c'est le noir qui est l'écart.
 *
 * ═══ PUR, ET SANS UNE FONCTION MATH APPROXIMÉE (invariant §2) ═══
 *
 * `Math.cos` est interdit ici. La part éclairée du disque — la vraie formule est
 * `(1 − cos 2πφ) / 2` — est donc TABULÉE sur une demi-lunaison et interpolée linéairement,
 * le patron des `COS_*` de `balance.ts`. Écart maximal mesuré contre le cosinus exact :
 * **0,0042** (0,42 %), atteint au voisinage de la pleine lune — et les deux bouts qui portent
 * le sens du cadran sont EXACTS : 0 à la nouvelle lune, 1 à la pleine.
 *
 * ⚠ IL Y A DONC DEUX COURBES, ET C'EST DÉLIBÉRÉ : le client garde son cosinus EXACT pour
 * PEINDRE (`render/lighting.ts`) — on ne glisse pas une approximation sous un voile de nuit
 * calibré à l'œil la veille. Ce qu'il importe d'ici, ce sont la PÉRIODE, l'ANCRAGE et la
 * PHASE : deux ancrages qui dériveraient feraient mordre la règle sur une lune peinte pleine.
 *
 * Ce qui tient les deux courbes ensemble n'est pas leur égalité, c'est un ORDRE, et il a été
 * mesuré heure par heure : **la règle est toujours la plus GÉNÉREUSE des deux.** Elle ignore
 * l'altitude de l'astre (une lune couchée éclaire quand même, pour elle), donc
 * `clarté_sim ≥ lueur_écran` à toute heure — **le noir ne mord jamais sur un écran clair.**
 * C'est CET invariant qu'un changement de l'une ou l'autre courbe doit préserver ; leur écart
 * numérique (0,0042 au pire) n'en est qu'une conséquence.
 */
import { TEMPERATURE } from './balance'
import { fireBubble, isSheltered } from './temperature'
import { connecteurAt, niveauDuCorps, palierDuSol } from './etages'
import { heldSlot } from './inventory-actions'
import { estTorcheVive } from './torche'
import { dayTicksAt, gameTimeAt, NIGHT_RAMP_TICKS, partDeNuit, TICKS_PER_CYCLE } from './time'
import type { Entity, SimState } from './sim'

/**
 * LA LUNAISON SE COMPTE EN JOURS DE SAISON — 23, un nombre PREMIER (choix d'Alexis,
 * 2026-08-25), donc premier avec la saison comme avec l'année : la pleine lune glisse de sept
 * jours par saison et le calendrier ne se resynchronise avec elle qu'au bout de 690 jours.
 */
export const LUNAISON_JOURS = 23

/**
 * Le jour de saison où la lune est PLEINE — et c'est LE JOUR D'OUVERTURE du monde
 * (`saisons.md` S2, `BALANCE.JOUR_DE_DEPART`). L'ancrage est un choix, pas une dérivation :
 * la première nuit est la plus clémente des vingt-trois, et le noir n'arrive qu'une fois
 * qu'on est installé — vers le jour 72.
 */
export const LUNE_PLEINE_JOUR = 61

/**
 * La part éclairée du disque, tabulée sur une DEMI-lunaison (la courbe est symétrique autour
 * de la pleine lune) : 13 nombres au lieu de 25, et la symétrie devient une propriété de la
 * lecture au lieu d'un vœu.
 */
const CLARTE_DEMI: readonly number[] = [
  0, 0.017037, 0.066987, 0.146447, 0.25, 0.37059, 0.5, 0.62941, 0.75, 0.853553, 0.933013,
  0.982963, 1,
]

/** Le nombre d'intervalles de la lunaison ENTIÈRE dans la table (le double de sa demie). */
const PAS_TABLE = (CLARTE_DEMI.length - 1) * 2

/**
 * La phase, dans [0, 1) : 0 = nouvelle lune, ½ = pleine lune. `jour` porte ses décimales
 * (`seasonDay + jourFrac`) pour que la lune COULE au lieu de sauter une fois par jour.
 * Exacte — que des `+ − × ÷` et un modulo.
 */
export function phaseDeLune(jour: number): number {
  const t = (jour - LUNE_PLEINE_JOUR) / LUNAISON_JOURS + 0.5 // +½ : l'ancrage est la PLEINE lune
  return ((t % 1) + 1) % 1
}

/** La part du disque éclairée, dans [0, 1] — 0 à la nouvelle lune, 1 à la pleine. */
export function clarteDeLune(jour: number): number {
  let p = phaseDeLune(jour)
  if (p > 0.5) p = 1 - p // la symétrie, lue plutôt que tabulée deux fois
  const x = p * PAS_TABLE
  const i = Math.floor(x)
  const a = CLARTE_DEMI[i] ?? 1
  const b = CLARTE_DEMI[i + 1] ?? a
  return a + (b - a) * (x - i)
}

/**
 * LA NUIT POUR L'ŒIL — la rampe de `partDeNuit`, RECENTRÉE sur l'horizon.
 *
 * `partDeNuit` est la rampe du FROID : elle vaut 1 à l'aube pile et ne relâche qu'ensuite,
 * parce que le fond du froid est à l'aube (c'est écrit dans `time.ts`, et c'est juste). La
 * LUMIÈRE, elle, ne traîne pas : le ciel pâlit AVANT que le soleil ne perce. La même rampe
 * suffit donc, décalée d'une demi-largeur — un seul réglage (`NIGHT_RAMP_HOURS`), deux
 * lectures, et pas une seconde courbe à calibrer.
 *
 * ⚠ CE DÉCALAGE N'EST PAS COSMÉTIQUE, il a été MESURÉ contre l'écran (le voile du client,
 * `render/lighting.ts`, nuit du jour 72) : sans lui, à 6 h — l'heure de l'aube —, la règle
 * lisait **0,009** (nuit noire) quand l'écran, lui, était déjà à **0,556** (une aube claire).
 * Une heure entière où le jeu aurait refusé de courir à un joueur qui VOIT le jour se lever.
 * Avec, la sim rend 0,505 contre 0,556 à l'écran, et les vingt-trois autres heures ne bougent
 * pas d'un cheveu (mesuré heure par heure, pleine lune ET nouvelle).
 */
function nuitPourLOeil(state: SimState, tick: number): number {
  const cycleTick = (tick + state.cycleOffset) % TICKS_PER_CYCLE
  const decale = (cycleTick + NIGHT_RAMP_TICKS / 2) % TICKS_PER_CYCLE
  return partDeNuit(decale, dayTicksAt(state, tick))
}

/**
 * LA CLARTÉ DU CIEL À UN TICK — 1 en plein jour, `clarteDeLune` au cœur de la nuit, et la
 * pente du crépuscule entre les deux.
 *
 * Elle se lit sur une RAMPE et NON sur `isNight` : le noir doit TOMBER, pas claquer. Un
 * joueur surpris par un mur à la seconde près n'a rien vu venir — « annoncés, pas surprises »
 * (GDD §9bis) —, alors qu'une pente lui laisse le crépuscule entier pour rentrer ou allumer.
 */
export function clarteDuCiel(state: SimState, tick: number = state.tick): number {
  const t = gameTimeAt(state, tick)
  const lune = clarteDeLune(t.seasonDay + t.jourFrac)
  return 1 - nuitPourLOeil(state, tick) * (1 - lune)
}

/**
 * LA LUMIÈRE D'UN FEU, dans [0, 1] — sa bulle de chaleur, relue en lumière. Un feu éteint
 * n'éclaire pas, des braises éclairent atténué : `fireBubble` porte déjà exactement cette
 * loi (facteur d'état × décroissance linéaire jusqu'à `TEMPERATURE.FIRE_RANGE`), et son rayon de 6
 * tuiles est celui du trou que le client perce dans le voile.
 */
export function lumiereDuFeu(state: SimState, x: number, y: number): number {
  return fireBubble(state, x, y) / TEMPERATURE.FIRE_WARMTH
}

/**
 * ═══ E-R13 — LA PART DU CIEL QUI ATTEINT CE POINT, dans [0, 1] ═══
 *
 * *Décision d'Alexis du 2026-09-02 (`etages.md` §10, branche **B1**).* C'est LA loi que ce choix
 * engage, et le préalable de tout ce qui est souterrain : ni cave, ni galerie, ni gueule de
 * grotte ne se bâtit avant elle.
 *
 * **1 à l'air libre** — donc partout dans le jeu d'aujourd'hui, et le monde d'avant est inchangé
 * au bit près. Sous un couvert, elle DÉCROÎT avec la distance à la première tuile ouverte : à la
 * gueule on y voit presque comme dehors, quatre tuiles plus loin il fait noir à midi.
 *
 * ⚠ **UNE DISTANCE, PAS UN BOOLÉEN — et c'est tout B1.** `isSheltered` répond oui/non (il a été
 * écrit pour le FROID, où c'est la bonne question : on est à l'abri ou on ne l'est pas). La
 * lumière, elle, n'a jamais de front : *la profondeur se gagne*. Un couvert binaire donnerait un
 * mur noir dès le pas de la porte — exactement la branche B3, qu'Alexis a écartée.
 *
 * ⚠ **ELLE NE CONNAÎT NI LE SOLEIL NI L'HEURE**, et c'est ce qui la rend composable : elle dit
 * quelle PART du ciel arrive, `clarteDuCiel` dit ce que le ciel vaut à cette heure-là. La nuit,
 * une gueule est noire sans qu'on ait à l'écrire — le produit s'en charge.
 *
 * ⚠ **CHEBYSHEV, pas la distance euclidienne** : on cherche le premier anneau ouvert autour du
 * point, et un anneau de Chebyshev est un carré — c'est la forme que le balayage parcourt, donc
 * la seule qui ne mente pas sur ce qu'il a vu. Et le balayage est BORNÉ par `TEMPERATURE.CIEL_PENETRATION` :
 * au-delà, il fait noir, il n'y a plus rien à mesurer.
 *
 * COÛT : sortie immédiate à l'air libre (un `isSheltered`, ce que l'appelant paierait de toute
 * façon). Sous un couvert seulement, jusqu'à `(2·P+1)²` sondes — 81 à P = 4 — et un intérieur est
 * par nature petit. Aucun appelant par PNJ ni par monstre : le même périmètre que `clarteSurSoi`.
 */
export function partDuCiel(state: SimState, tx: number, ty: number, etage?: number): number {
  const P = TEMPERATURE.CIEL_PENETRATION
  // ═══ UN ÉTAGE SOUS LA ROCHE : LE JOUR N'ENTRE QUE PAR LA GUEULE ═══
  //
  // C'est la MÊME loi, lue sur l'autre ouverture. Au-dessus du sol on cherche la première tuile
  // que rien ne couvre ; sous la roche il n'y en a aucune — ce qui ouvre, c'est le connecteur.
  // *La profondeur se gagne*, ici littéralement : quatre tuiles après le seuil, il fait noir, et
  // c'est ce qui fait de la torche un outil au lieu d'un décor.
  //
  // ⚠ **UN ÉTAGE AU-DESSUS DU SOL REÇOIT LE CIEL ENTIER** : un dessus de mesa est à l'air libre,
  // rien ne le couvre. Sans cette ligne, `isSheltered` — qui ne lit que le sol — répondrait
  // pour le sol SOUS le plateau, c'est-à-dire pour une autre tuile que celle où l'on se tient.
  //
  // ⚠ « AU-DESSUS » ET « SOUS » SE COMPTENT DEPUIS LE PALIER DU SOL (spec `terrasses.md` T-R2),
  // pas depuis 0 : la cave d'une mesa posée au palier 2 vit au niveau 1, sous deux crans de
  // roche — et le niveau 1 est le sol, à l'air libre, une terrasse plus loin.
  const sol = palierDuSol(state.map, tx, ty)
  if (etage === undefined) etage = sol
  if (etage > sol) return 1
  if (etage < sol) {
    for (let d = 0; d <= P; d++) {
      for (let oy = -d; oy <= d; oy++) {
        for (let ox = -d; ox <= d; ox++) {
          if (d > 0 && !(ox === -d || ox === d || oy === -d || oy === d)) continue
          const c = connecteurAt(state.map, tx + ox, ty + oy)
          if (c === undefined) continue
          // Une porte de CET étage, qui ouvre vers le HAUT — le jour vient d'en haut. La rampe
          // de terrasse 0→1 qui passe à trois tuiles d'une cave au niveau 1 n'éclaire rien.
          const autre = c.de === etage ? c.vers : c.vers === etage ? c.de : undefined
          if (autre === undefined || autre <= etage) continue
          // Sur la gueule même (`d` = 0) on voit comme dehors ; au fond, plus rien.
          return d === 0 ? 1 : 1 - d / (P + 1)
        }
      }
    }
    return 0
  }
  if (!isSheltered(state, tx, ty)) return 1
  for (let d = 1; d <= P; d++) {
    // L'ANNEAU de rayon `d`, et lui seul : les couronnes intérieures ont déjà répondu non.
    for (let oy = -d; oy <= d; oy++) {
      for (let ox = -d; ox <= d; ox++) {
        // Le bord du carré : l'un des deux écarts vaut exactement `d`.
        const bord = ox === -d || ox === d || oy === -d || oy === d
        if (!bord) continue
        if (!isSheltered(state, tx + ox, ty + oy)) {
          // À la distance `d` du ciel : plein à la gueule (`d` = 1 → presque 1), nul au-delà.
          return 1 - d / (P + 1)
        }
      }
    }
  }
  return 0
}

/**
 * LA CLARTÉ EN UN POINT, dans [0, 1] — LA fonction, et celle que LA PRÉDICTION DU CLIENT
 * APPELLE (le patron de `meteoSpeedFactorAt`, spec `meteo.md` R7).
 *
 * Le client ne recopie rien : il la rappelle sur la façade d'état qu'il reconstitue du
 * snapshot (`etat-gel.ts` — tick, heure, structures, calendrier : tout y est déjà). Sans
 * elle, il prédirait un sprint que l'autorité refuse, et l'avatar ferait de l'élastique à
 * chaque réconciliation, la nuit, exactement quand on ne peut pas se le permettre.
 */
export function clarteSurSoiAt(
  state: SimState,
  tick: number,
  x: number,
  y: number,
  /** Ce corps tient-il une torche ALLUMÉE ? Le porteur est au centre de sa propre flamme. */
  torche: boolean,
  /** LE PLANCHER DU CORPS (spec `etages.md`). Absent ≡ le sol de la tuile (T-R3), donc tout
   *  l'existant. Sous la roche, le jour n'entre que par la gueule ; au-dessus, le ciel entier. */
  etage?: number,
): number {
  if (torche) return 1 // à bout de bras : rien n'éclaire plus près
  // ═══ LE CIEL N'ENTRE PAS SOUS UN TOIT (E-R13, branche B1 — Alexis, 2026-09-02) ═══
  //
  // C'est le seul endroit où la loi s'applique, et c'est voulu : `clarteDuCiel` reste ce que le
  // CIEL vaut à cette heure — une grandeur du monde —, `partDuCiel` dit quelle PART en arrive
  // ici. Le produit se lit tout seul : dehors on multiplie par 1 (le monde d'avant, au bit
  // près) ; au fond d'un couvert, midi ne vaut pas mieux que minuit ; et la nuit, une gueule est
  // noire sans qu'on ait rien à écrire de plus.
  //
  // ⚠ **CE QUE ÇA CHANGE AU JEU, ET C'EST TOUT** : depuis qu'Alexis a coupé le sprint de la règle
  // du noir (même jour), la clarté ne commande plus AUCUNE vitesse — elle ne décide plus que de
  // la PARADE. Un intérieur sombre et sans feu refuse donc la garde en plein midi. C'est la
  // conséquence voulue de B1 (*la profondeur se gagne*), et elle se répare du geste qu'on a déjà :
  // une flamme. Un feu dans la pièce y suffit — `lumiereDuFeu` est prise au max juste en dessous.
  const ciel = clarteDuCiel(state, tick) * partDuCiel(state, Math.floor(x), Math.floor(y), etage)
  const feu = lumiereDuFeu(state, x, y)
  return feu > ciel ? feu : ciel
}

/**
 * LA CLARTÉ SUR SOI, dans [0, 1] — ce que ce corps-là voit, là où il est.
 *
 * ⚠ Le coût : `fireBubble` balaie les structures. Cette fonction se lit sur les AVATARS
 * (boucle d'inputs, une poignée par tick), jamais par PNJ ni par monstre — le même périmètre
 * que la chasse nocturne, et pour la même raison (`nighthunt.preys`).
 */
export function clarteSurSoi(state: SimState, entity: Entity): number {
  return clarteSurSoiAt(state, state.tick, entity.x, entity.y, estTorcheVive(heldSlot(entity)), niveauDuCorps(state.map, entity))
}
