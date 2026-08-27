/**
 * LE CHAMP DES MORTS — « combien de morts dorment ici » (spec `cendreux.md` R14-R19).
 *
 * ═══ POURQUOI UN CHAMP, ET PAS DES LIEUX ═══
 *
 * *Décision d'Alexis, 2026-07-31 : le Cendreux ne naît pas, il se RÉVEILLE — le sol en est déjà
 * plein.* La nuit qui chasse téléportait un mort à un offset ; un loup qui arrive du noir est
 * juste, un cadavre qui se matérialise dans un pré ne l'est pas.
 *
 * On a d'abord cherché à le faire sortir d'une TRACE du monde — cendre, sol brûlé, Repaire.
 * MESURÉ sur la carte de production (seed 2026), autour de là où le joueur vit réellement :
 * **zéro** tuile brûlée dans la couronne de naissance (la plus proche à 74 tuiles), **zéro**
 * cendre avant le **jour 60**, Repaire le plus proche à 110 tuiles. Une naissance conditionnée
 * à une trace aurait supprimé le Cendreux de la nuit jusqu'au jour ~55.
 *
 * D'où la forme retenue : un CHAMP CONTINU, qui a un plancher partout et du relief là où le
 * monde est mort. La trace est une couleur, jamais une condition (R16).
 *
 * ═══ DÉRIVÉ, JAMAIS RANGÉ ═══
 *
 * Le champ n'ajoute **aucun octet au `SimState`** et **aucun tableau à la carte**. Il se lit en
 * O(1) de deux choses déjà présentes — `zoneTierAt` (le tier de la zone, au bloc) et
 * `estCendre` (le front, dérivé du tick). C'est le modèle de `cendre.ts`, et il vient d'un
 * invariant : *« le tick est la seule horloge ; toute notion dérivée est une fonction pure du
 * numéro de tick. Aucun état temporel redondant »* (`monde.md` R1).
 *
 * Pur et déterministe : `+ - * /`, `min`, `max`, `floor`, `sqrt` (invariant n°2).
 */
import { CENDREUX, MORTS, NIGHT_HUNT } from './balance'
import {
  cadranDeFoyer, caracteresDeLaCarte, foyerDuSol, foyersDeLaCarte, profondeurNueDeCendre,
  rampeDeSuccession,
} from './cendre'
import { isBlockedAt } from './collision'
import { emitEvent } from './events'
import { effetsDuJour } from './modificateur'
import { fireActive, fireState } from './fire'
import { distSq } from './geometry'
import { zoneTierAt, type WorldMap } from './map'
import { placeSousPlafondGlobal, spawnMonster } from './monsters'
import { hash2 } from './noise'
import { pathToward, solidesEternels } from './pathfinding'
import type { SimState } from './sim'
import { getGameTime, TICKS_PER_SEASON_DAY, jourDeSaison } from './time'

/**
 * UN SOL QUI TRAVAILLE — le Cendreux n'est pas encore là, mais il arrive.
 *
 * C'est le seul état neuf du chantier, et il est minimal à dessein : quatre nombres, aucun
 * objet, JSON-sérialisable — l'invariant de `SimState` l'exige (snapshot, transport Worker,
 * persistance). On a écarté de le porter par `Corpse`, dont la forme collait pourtant
 * (`risesAt` existe déjà) : un cadavre est MANGÉ par les prédateurs (`faune.ts`), FOUILLÉ par
 * les PNJ (`npc-errands.ts`), ouvrable au conteneur et expédié en entier à chaque client. Un
 * faux cadavre aurait fait venir les loups renifler un réveil.
 */
export interface Reveil {
  x: number
  y: number
  /** Le tick où il sort. */
  at: number
  /** Pour QUI le sol s'est réveillé — recopié sur `huntTargetId` à l'émergence. */
  preyId: number
}

/**
 * COMBIEN DE MORTS DORMENT SOUS CETTE TUILE — de `MORTS.PLANCHER` à 1.
 *
 * Ne rend JAMAIS zéro, et c'est la règle centrale (R16) : le champ possède l'intensité de la
 * nuit, pas son existence. `NIGHT_HUNT.UNDEAD_SHARE` possède déjà le « si », par acte, et il
 * marche. Trois fois aujourd'hui, une règle qui laissait la géographie *autoriser* la nuit l'a
 * rendue muette autour de chez le joueur ; le plancher est ce qui rend ce quatrième échec
 * impossible par construction plutôt que par vigilance.
 *
 * Sur une carte sans zones — un banc headless — `zoneTierAt` rend 0 et `estCendre` rend faux :
 * le champ y vaut son plancher, uniformément, et le tirage pondéré qui s'appuie dessus
 * redevient exactement uniforme. Le comportement d'un banc est donc préservé au bit près (R17).
 */
/** Le sel de l'élection du rampant — distinct du tirage de site déplacé, qui hache le même réveil. */
const RAMPANT_SEL = 0x6a09e667

/**
 * LA PART DES RÉVEILS QUI SORTENT RAMPANTS (spec R26) : une pente du champ des morts, de
 * `PART_MIN` (le pré) à `PART_MAX` (le cœur d'un charnier). La géographie décide, jamais le
 * calendrier — et le marcheur reste la règle partout (la part est toujours sous 1/2).
 */
export function partRampante(densite: number): number {
  const d = densite < 0 ? 0 : densite > 1 ? 1 : densite
  return CENDREUX.RAMPANT.PART_MIN + (CENDREUX.RAMPANT.PART_MAX - CENDREUX.RAMPANT.PART_MIN) * d
}

export function densiteDesMorts(state: SimState, tx: number, ty: number): number {
  let d = densiteDeBase(state.map, tx, ty)
  // ON A BRÛLÉ ICI (décision ⑧, 2026-08-21) : autour d'un charnier ou d'un repaire assaini,
  // le sol rend moins de morts — pour un temps. La liste est minuscule (quelques lieux au
  // plus), la lecture reste O(petit) sur un chemin chaud.
  if (state.lieuxBrules.length > 0) {
    const r2 = MORTS.BRULE_SUPPRESSION_RAYON * MORTS.BRULE_SUPPRESSION_RAYON
    for (const lb of state.lieuxBrules) {
      if (state.tick >= lb.until) continue
      const z = state.map.zones[lb.zone]
      if (!z) continue
      const cx = z.x + z.w / 2
      const cy = z.y + z.h / 2
      if (distSq(cx, cy, tx + 0.5, ty + 0.5) <= r2) {
        d *= MORTS.BRULE_FACTEUR
        break
      }
    }
  }
  // ═══ LA HANTISE, RÉ-ARMÉE SUR LA SUCCESSION (spec `cendre.md` R23, 2026-08-27) ═══
  //
  // Elle avait été démontée le 2026-08-24 avec le front qui la datait, et ses trois constantes
  // sont restées orphelines avec la note « à reprendre avec la nouvelle mécanique ». La voici :
  // même loi, même plafond, nouvel axe. L'ancien était « la part de la course du front » —
  // c'est-à-dire une PROFONDEUR, exactement ce que R20 compte désormais en tuiles. Le plateau
  // s'ancre donc à `CENDRE.CROUTE_TUILES` (l'entrée de la bande vieille) et `HANTISE_PART`,
  // qui l'exprimait en part d'une course de 74 tuiles qui n'existe plus, est retirée.
  //
  // MESURÉ avant de le brancher (`tools/diag-cendre-eveil.mts`, monde joué, seed 2026) : sans
  // elle, la cendre n'était PAS plus habitée que le pré — 0,2526 au cœur contre 0,2501 dehors,
  // soit ±1 %. La piste ⑥ (« le cœur est déjà le territoire des morts ») était donc fausse.
  const prof = profondeurNueDeCendre(state, tx, ty)
  if (prof >= 0) d += MORTS.PART_CENDRE + (MORTS.HANTISE_MAX - MORTS.PART_CENDRE) * rampeDeSuccession(prof)
  // LE CARACTÈRE DE LA FOSSE QUI TIENT CE SOL (spec `cendre.md` R21) — la Gueule en rend 60 % de
  // plus, la Muette moitié moins. Deux lectures de tableau : `foyerDuSol` lit le coût NU (sans le
  // grain, qui coûterait quatre `fbm2` sur un chemin lu par tuile de couronne — une densité n'a
  // pas de lisière). Hors cendre, il rend -1 et le cadran vaut 1.
  const k = foyerDuSol(state, tx, ty)
  if (k >= 0) d *= cadranDeFoyer(caracteresDeLaCarte(state.map, state.seed), k, 'morts')
  return d > 1 ? 1 : d
}

/**
 * LE BRÛLAGE DES LIEUX (décision ⑧) — un feu LIBRE allumé de JOUR dans l'empreinte d'un
 * charnier ou d'un repaire le marque brûlé. Cadencé (une lecture toutes les 20 ticks, pure
 * du tick) : le geste dure des minutes, la détection n'a pas besoin du tick près.
 */
export function advanceLieuxBrules(state: SimState): void {
  // Purge des échus — d'abord, pour que la relecture du champ ne paie jamais un mort.
  if (state.lieuxBrules.length > 0 && state.lieuxBrules.some((lb) => state.tick >= lb.until)) {
    state.lieuxBrules = state.lieuxBrules.filter((lb) => state.tick < lb.until)
  }
  if (state.tick % 20 !== 0) return
  if (getGameTime(state).isNight) return // le brûlage est un geste de JOUR (décision ⑧)
  const zones = state.map.zones
  if (zones.length === 0) return
  const r2 = MORTS.BRULE_RAYON * MORTS.BRULE_RAYON
  // Les fosses et leurs caractères, UNE fois : la boucle qui suit les relit par zone touchée.
  const foyers = foyersDeLaCarte(state.map)
  const caracteres = caracteresDeLaCarte(state.map, state.seed)
  for (const s of state.structures) {
    if (s.type !== 'fire' || s.villageId !== 0) continue
    if (fireState(state, s) !== 'lit') continue // il faut des FLAMMES — les braises ne brûlent pas un lieu
    for (let zi = 0; zi < zones.length; zi++) {
      const z = zones[zi]!
      if (z.kind !== 'charnier' && z.kind !== 'repaire') continue
      const cx = z.x + z.w / 2
      const cy = z.y + z.h / 2
      if (distSq(cx, cy, s.tx + 0.5, s.ty + 0.5) > r2) continue
      if (state.lieuxBrules.some((lb) => lb.zone === zi && state.tick < lb.until)) continue
      // LA DURÉE SUIT LE CARACTÈRE DE LA SAISON (spec `cendre.md` R18) : `orages_secs` la double
      // (le feu prend partout — la saison des expéditions d'assainissement), `deluge` la divise
      // par deux (on n'allume pas un feu sous quatre jours de pluie).
      // …ET LE CARACTÈRE DE LA FOSSE (R21) : la Docile se tient trente jours au lieu de quinze.
      // C'est elle qui rend le verbe de R16 gagnant quelque part — avec dix fosses, on ne peut
      // pas toutes les tenir, mais il en existe une qui coûte deux fois moins cher.
      const k = foyers.findIndex((f) => f.zone === zi)
      const jours = MORTS.BRULE_DUREE_JOURS
        * (effetsDuJour(jourDeSaison(state)).cendreGel ?? 1)
        * cadranDeFoyer(caracteres, k, 'gel')
      const duree = Math.round((jours * TICKS_PER_SEASON_DAY) / state.calendarScale)
      state.lieuxBrules.push({ zone: zi, until: state.tick + duree })
      emitEvent(state, { type: 'charnier_brule', tick: state.tick, zone: zi, x: cx, y: cy })
    }
  }
}

/**
 * ⚠ LA HANTISE DE CENDRE, RETIRÉE LE 2026-08-24, EST REVENUE LE 2026-08-27 (R23).
 *
 * Elle avait disparu avec le front qui la datait : sans front, aucune tuile n'avait d'âge de
 * brûlure, et le champ des morts ne connaissait plus que son plancher et le tier de sa zone.
 * `PART_CENDRE` / `HANTISE_MAX` / `HANTISE_PART` étaient restées sans lecteur, avec la note « à
 * reprendre avec la nouvelle mécanique ».
 *
 * C'est fait, et l'axe n'a même pas changé de nature : l'ancien était « la part de la course du
 * front », le nouveau est la PROFONDEUR en tuiles que R20 compte déjà. Voir le terme dans
 * `densiteDesMorts` ; `HANTISE_PART` est la seule des trois à ne pas avoir survécu (son
 * dénominateur, la course totale d'un front, n'existe plus).
 */

/**
 * LA PART DU CHAMP QUI NE DÉPEND PAS DU TEMPS — plancher + tier, sans la cendre.
 *
 * Elle existe parce que les CHARNIERS se posent à la GÉNÉRATION (`placeCharniers`), quand il n'y
 * a ni tick ni `SimState` : le front n'a pas encore bougé, et il n'a rien à dire sur où la vallée
 * a enterré ses morts. Le terme de cendre reste donc à `densiteDesMorts` — c'est le seul des deux
 * qui soit une fonction du tick, et il doit le rester (R15).
 *
 * Un seul calcul pour les deux lectures : le semis des charniers et l'intensité de la nuit
 * penchent du même côté par construction, et non parce que deux formules se ressemblent.
 */
export function densiteDeBase(map: WorldMap, tx: number, ty: number): number {
  const tier = zoneTierAt(map, tx, ty)
  // Hors table, on retombe sur le DERNIER palier, pas sur le premier : un tier qu'on ajouterait
  // demain serait plus dur que ceux d'aujourd'hui, jamais plus doux. Le repli doit se tromper
  // du côté où le monde va.
  const part = MORTS.PART_TIER[tier] ?? MORTS.PART_TIER[MORTS.PART_TIER.length - 1]!
  return MORTS.PLANCHER + part
}

/**
 * COMBIEN DE RÔDEURS CE SOL PEUT PORTER, sur un plafond d'acte donné.
 *
 * Le plafond de `NIGHT_HUNT.UNDEAD_MAX_ALIVE` reste le TOIT ; la densité dit quelle part on en
 * atteint. À l'acte III (plafond 5) : deux rôdeurs sur le pré de son village, cinq aux marges
 * sous la cendre. Le joueur ne lit pas un nombre, il lit un LIEU.
 *
 * Le plancher à `MIN_RODEURS` est la même règle que celle du champ, vue d'un cran plus haut :
 * la densité MODULE, elle n'interdit pas. Sans lui, un plafond de 3 sur un sol à 0,25 rendrait
 * `ceil(0.75)` = 1 — ça tient encore — mais tout futur plafond bas retomberait à zéro, et on
 * aurait rebâti l'interrupteur qu'on vient de démonter.
 */
export function rodeursPortes(state: SimState, tx: number, ty: number, plafond: number): number {
  if (plafond <= 0) return 0
  const n = Math.ceil(plafond * densiteDesMorts(state, tx, ty))
  return n < MORTS.MIN_RODEURS ? MORTS.MIN_RODEURS : n
}

/**
 * OÙ LE SOL SE RÉVEILLE, autour d'une proie — ou `undefined` si vraiment rien ne convient.
 *
 * ═══ UNE COURONNE, PAS QUATRE DIAGONALES ═══
 *
 * L'ancien placement posait `ox` ET `oy` à ±`SPAWN_DIST` : quatre points, tous en diagonale, à
 * 21,2 tuiles — jamais 15, jamais de côté. On balaie désormais l'anneau
 * [`SPAWN_DIST` − `SPAWN_RING`, `SPAWN_DIST` + `SPAWN_RING`], soit ~200 tuiles : le danger peut
 * venir de partout, et le champ a enfin de la matière à pondérer.
 *
 * ═══ ET SON SOL MÈNE À LA PROIE ═══
 *
 * L'ancien point n'était que CLAMPÉ aux bords de carte — aucune marchabilité, aucune
 * joignabilité. C'est le bug exact que R12 vient de corriger pour la horde, et il coûtait ici
 * MESURÉ, sur 1 600 points : **14,0 % de naissances dans la roche ou un mur** et 4,2 % sur un
 * sol libre sans aucun chemin vers la proie — **18,2 % de nuits perdues**, en silence.
 *
 * ═══ UN SEUL TIRAGE (R19) ═══
 *
 * Le choix pondéré se fait sur la SOMME CUMULÉE des densités de l'anneau : un tirage, et il
 * tombe dans la tuile qui le contient. L'ancien en consommait deux (`ox`, `oy`).
 *
 * Le repli — la tuile élue est bloquée, ou injoignable — parcourt l'ordre cumulé à partir de
 * l'élue, sans jamais retirer. Une boucle de rejet aurait fait dépendre le flux du PRNG de la
 * FORME DU TERRAIN : le déterminisme serait resté vrai (même seed, même carte, même flux) mais
 * illisible, et toute retouche de worldgen aurait décalé des tests sans rapport.
 *
 * ═══ ET IL EST BORNÉ ═══
 *
 * L'A\* n'est payé qu'une fois en cas normal — seule la tuile élue est vérifiée. Mais un A\* qui
 * ÉCHOUE coûte son budget entier (4 096 tuiles explorées), et un repli non borné les enchaîne :
 * MESURÉ sur une proie ceinte de roche, **1 593 ms pour un seul réveil**, trente-deux fois le
 * budget d'un tick à 20 Hz. D'où `MORTS.ESSAIS_MAX` — les tuiles bloquées, elles, continuent de
 * défiler gratuitement.
 */
export function siteDansLaCouronne(
  state: SimState,
  px: number,
  py: number,
  tirage: number,
  /**
   * Le poids d'une tuile. Absent → uniforme, et c'est le cas du LOUP : il vient du bois, pas du
   * sol. Le champ des morts ne doit pondérer que ce qui se réveille — pondérer aussi la bête
   * aurait été gratuit à écrire et faux à lire. Ce qu'ils partagent, c'est la couronne et
   * l'exigence d'un sol qui mène à la proie ; le bug de placement n'avait pas d'espèce.
   */
  poids?: (tx: number, ty: number) => number,
  /**
   * La couronne, par espèce (R22). Absente → celle du LOUP, qui garde ses 15 tuiles parce
   * qu'il les couvre en trois secondes. Le mort naît bien plus près, et c'est le réveil qui
   * le paie en préavis — on ne rapproche que ce qui est lent.
   */
  couronne?: { dist: number; ring: number },
  /** Vrai quand cette élection EST déjà la couronne repoussée — une seule poussée, pas une fuite. */
  repoussee = false,
): { x: number; y: number } | undefined {
  const world = { map: state.map, structures: state.structures, nodes: state.nodes, moverVillageId: null, etat: state }
  // Le monde tel que la ROCHE le voit : ni murs ni portes — MAIS les SOLIDES ÉTERNELS
  // (le massif d'un antre, 2026-08-11) y sont : ils SONT de la roche. « La roche
  // disqualifie, le mur non » — un mort né derrière un massif ne serait pas une menace,
  // ce serait un décor, très exactement comme derrière une falaise.
  const terrainSeul = { map: state.map, nodes: state.nodes, structures: solidesEternels(state.structures), moverVillageId: null, etat: state }
  const dist = couronne?.dist ?? NIGHT_HUNT.SPAWN_DIST
  const ring = couronne?.ring ?? NIGHT_HUNT.SPAWN_RING
  const dMin = dist - ring
  const dMax = dist + ring
  const ptx = Math.floor(px)
  const pty = Math.floor(py)

  // ═══ LE FEU REPOUSSE, IL N'ANNULE PLUS (décision d'Alexis ⑦, 2026-08-21) ═══
  //
  // Une tuile dans le ward d'un feu actif (braises comprises — `fireActive`, la même garde
  // que la veillée des cadavres) est INÉLIGIBLE : le sol ne s'y lève pas. Mais l'écarter ne
  // ferme pas la nuit — si le feu couvre la couronne ENTIÈRE (le camp du joueur), on élit
  // dans une couronne REPOUSSÉE au bord de la bulle : le feu achète ~5 tuiles de distance et
  // les secondes de marche qui vont avec, jamais l'immunité. A27 est renversée sciemment ;
  // c'est aussi la ligne de la bible (L1bis : le Feu n'a aucune vertu propre, il OCCUPE).
  const ward = CENDREUX.HEARTH_WARD_RADIUS
  const feux: { x: number; y: number }[] = []
  const portee = (dMax + ward + 1) * (dMax + ward + 1)
  for (const s of state.structures) {
    if (s.type !== 'fire' || !fireActive(state, s)) continue
    if (distSq(s.tx + 0.5, s.ty + 0.5, px, py) <= portee) feux.push({ x: s.tx + 0.5, y: s.ty + 0.5 })
  }
  const dansUnWard = (x: number, y: number): boolean => {
    for (const f of feux) if (distSq(f.x, f.y, x + 0.5, y + 0.5) <= ward * ward) return true
    return false
  }

  // L'anneau, balayé dans un ordre FIXE (row-major) : c'est lui qui rend le repli reproductible.
  const tuiles: { x: number; y: number; poids: number }[] = []
  let somme = 0
  const r = Math.floor(dMax) + 1
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dy * dy
      if (d2 < dMin * dMin || d2 > dMax * dMax) continue
      const x = ptx + dx
      const y = pty + dy
      if (x < 1 || y < 1 || x >= state.map.width - 1 || y >= state.map.height - 1) continue
      if (feux.length > 0 && dansUnWard(x, y)) continue // sous le ward : le feu repousse (⑦)
      const p = poids ? poids(x, y) : 1
      somme += p
      tuiles.push({ x, y, poids: p })
    }
  }
  if (tuiles.length === 0) {
    // La couronne entière est sous un ward : on élit AU BORD de la bulle — une seule
    // poussée, le même tirage (aucun pas de PRNG de plus, A23/A28 tiennent).
    if (repoussee) return undefined
    return siteDansLaCouronne(state, px, py, tirage, poids, { dist: ward + 1 + ring, ring }, true)
  }

  // Le tirage tombe dans la somme cumulée — la tuile la plus dense a la plus grosse part.
  let cible = tirage * somme
  // Défaut à la DERNIÈRE tuile, pas à la première : un tirage qui frôle 1 laisse un résidu
  // flottant positif et sortirait de la boucle sans avoir rien élu. Retomber sur l'index 0
  // aurait donné à la première tuile de l'anneau une part qu'elle n'a pas.
  let debut = tuiles.length - 1
  for (let i = 0; i < tuiles.length; i++) {
    cible -= tuiles[i]!.poids
    if (cible <= 0) {
      debut = i
      break
    }
  }

  // Le repli : à partir de l'élue, on avance dans l'ordre cumulé. Aucun tirage supplémentaire.
  let essais = 0
  for (let k = 0; k < tuiles.length && essais < MORTS.ESSAIS_MAX; k++) {
    const t = tuiles[(debut + k) % tuiles.length]!
    // Naître DANS un mur, non : la tuile elle-même se juge avec ses structures.
    if (isBlockedAt(world, t.x, t.y)) continue
    essais += 1
    // JOIGNABLE — MAIS PAR LE TERRAIN SEUL, et c'est la subtilité de toute la fonction.
    //
    // Un mort qui naît de l'autre côté d'une falaise n'est pas une menace, c'est un décor : la
    // roche doit le disqualifier. Un mur, NON — R3 dit précisément qu'un Cendreux qui ne peut
    // pas atteindre sa cible **frappe le franchissement qui le bloque**, et c'est ce qui donne
    // leur raison d'être aux murs, au toit et à la porte. Exiger un chemin à travers les
    // structures aurait donc supprimé le SIÈGE du canal de la nuit, en silence : le joueur qui
    // s'enclot serait redevenu intouchable — l'exact bug qu'A4 vient de fermer.
    //
    // On interroge donc un monde SANS structures — et ce n'est pas une invention : c'est
    // exactement ce que fait déjà `computeFlowField` pour la horde, pour la même raison écrite
    // dans les mêmes termes (*« les STRUCTURES sont ignorées : le gradient traverse les murs, et
    // le zombie qui bute dessus les frappe — c'est le siège naturel »*). La convergence de masse
    // et le rôdeur solitaire jugent enfin le terrain de la même façon.
    //
    // C'est aussi le chemin le moins cher : pas d'index d'occupation à bâtir, et le mur ne fait
    // plus échouer un A* jusqu'à épuiser son budget.
    const chemin = pathToward(terrainSeul, t.x + 0.5, t.y + 0.5, ptx, pty)
    if (!chemin || chemin.length === 0) continue
    return { x: t.x + 0.5, y: t.y + 0.5 }
  }
  return undefined
}

/**
 * LE SOL TRAVAILLE, PUIS IL REND SON MORT — ou le feu l'en empêche (spec `cendreux.md` R21).
 *
 * ═══ LA PARADE, GÉNÉRALISÉE ═══
 *
 * S4 disait déjà : *« un cadavre près d'un feu allumé ou en braises ne se relève pas »*, et R9
 * le maintient mot pour mot. Mais cette règle ne servait qu'un canal — la levée d'un cadavre —
 * et la mesure a montré qu'il ne se déclenchait qu'**une fois par saison**. Autant dire jamais.
 *
 * Le réveil lui donne enfin sa fréquence. Le sol se soulève à sept tuiles, ça s'annonce, et le
 * joueur a `MORTS.REVEIL_TICKS` pour rallumer son feu : *on veille ses morts au feu, ou ils
 * reviennent* devient le geste de chaque nuit au lieu d'une ligne de lore. La garde est la
 * MÊME (`CENDREUX.HEARTH_WARD_RADIUS`, `fireActive` — donc braises comprises) : on ne lui
 * apprend pas une deuxième règle, on lui donne enfin des occasions de servir.
 *
 * ═══ AUCUN TIRAGE ═══
 *
 * Ni ici ni à l'émergence : le site et l'instant ont été décidés à la plantation. Le flux du
 * PRNG ne dépend donc pas de la durée du réveil, ni du fait qu'un feu l'ait annulé — sans quoi
 * allumer un feu aurait décalé le monde entier (invariant n°2).
 */
export function advanceReveils(state: SimState): void {
  if (state.reveils.length === 0) return
  const ward = CENDREUX.HEARTH_WARD_RADIUS
  const restants: Reveil[] = []
  for (const r of state.reveils) {
    // LE FEU DÉPLACE — et il surveille pendant TOUT le réveil, pas seulement l'instant de
    // sortir. C'est toujours une parade qu'on peut JOUER : on voit le sol travailler, on
    // rallume — mais depuis la décision ⑦ (2026-08-21, A27 renversée sciemment), rallumer
    // n'ANNULE plus : le tertre s'effondre ici (`reveil_etouffe`, le même geste à l'écran)
    // et le sol REPREND SON TRAVAIL hors de la bulle, timer remis à neuf. Le feu achète de
    // la distance et du temps — chaque bulle de plus se paie en bois — jamais l'immunité.
    //
    // AUCUN TIRAGE : le site déplacé s'élit sur un pseudo-tirage `hash2` du réveil lui-même
    // (site + heure de terme) — allumer un feu ne déplace pas le flux seedé du monde (A28).
    const veille = state.structures.some(
      (s) => s.type === 'fire' && fireActive(state, s) && distSq(s.tx + 0.5, s.ty + 0.5, r.x, r.y) <= ward * ward,
    )
    if (veille) {
      emitEvent(state, { type: 'reveil_etouffe', tick: state.tick, x: r.x, y: r.y })
      const prey = state.entities.find((e) => e.id === r.preyId && e.hp > 0)
      if (prey) {
        const site = siteDansLaCouronne(
          state, prey.x, prey.y, hash2(Math.floor(r.x), Math.floor(r.y), r.at),
          (tx, ty) => densiteDesMorts(state, tx, ty),
          { dist: NIGHT_HUNT.SPAWN_DIST_UNDEAD, ring: NIGHT_HUNT.SPAWN_RING_UNDEAD },
        )
        if (site) restants.push({ x: site.x, y: site.y, at: state.tick + MORTS.REVEIL_TICKS, preyId: r.preyId })
      }
      continue
    }
    if (state.tick < r.at) {
      restants.push(r)
      continue
    }
    // LE MUR DUR DU PLAFOND GLOBAL (2026-08-21) : plein, le réveil meurt sans bruit — il ne
    // fait PAS la queue (le mot exact de R8bis : une file qui se vide rendrait le plafond à
    // son inutilité). La salve du cri et la nuit sont déjà gatées en amont ; ceci est la
    // garantie de dernier ressort, celle qui tient quel que soit le chemin d'entrée.
    if (!placeSousPlafondGlobal(state)) continue
    // IL SORT. Le sac reste à ZÉRO : celui-là n'hérite d'aucun cadavre (A11) — seule la levée
    // demande ses 40 cases, et douze inventaires vides par snapshot coûtaient cher (voir la
    // note de `spawnMonster`).
    const id = spawnMonster(state, 'cendreux', r.x, r.y)
    const monster = state.monsters.find((m) => m.entityId === id)
    if (monster) {
      monster.ambient = true // il se dissipera comme la faune : pas d'accumulation
      monster.nightHunter = true // il MORD : exempté d'un courage qu'il ne pourrait satisfaire
      monster.huntTargetId = r.preyId // pour QUI il est venu — stable, contrairement à `targetId`
      monster.targetId = r.preyId
      // CE QUE LE SOL REND N'A PAS TOUJOURS SES JAMBES (spec R26, décisions d'Alexis
      // 2026-08-21) : une part des réveils — et d'eux seuls — sort RAMPANTE, à vie. La part se
      // lit dans le champ des morts au site même (plus le sol est mort, plus les corps sont
      // brisés) ; l'élection est un pseudo-tirage du réveil, salé pour ne pas recopier celui
      // du site déplacé — aucun pas de PRNG, même réveil → même corps (le patron A28).
      if (hash2(Math.floor(r.x), Math.floor(r.y), r.at ^ RAMPANT_SEL) < partRampante(densiteDesMorts(state, Math.floor(r.x), Math.floor(r.y)))) {
        monster.rampant = true
      }
    }
    // On RÉUTILISE `cendreux_risen` : « un cendreux se relève » est exactement le fait qui
    // vient de se produire, et il a déjà sa voix à l'inventaire. Un second événement pour la
    // même chose aurait forcé chaque consommateur (chronique, son, alignement) à connaître
    // deux noms pour un fait.
    emitEvent(state, { type: 'cendreux_risen', tick: state.tick, entityId: id, x: r.x, y: r.y })
  }
  state.reveils = restants
}
