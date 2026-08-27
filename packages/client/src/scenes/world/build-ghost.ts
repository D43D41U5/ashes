/**
 * LE FANTÔME DE CONSTRUCTION — le mode armé se VOIT (spec recolte.md G3, construction R21).
 *
 * Tant que `placing === null` (l'état de départ), il n'existe pas : poser n'est pas
 * le comportement par défaut du clic. Il s'arme de trois façons — une PIÈCE choisie
 * au menu du marteau, un FEU DE CAMP tenu, ou un COMPOSANT tenu (enclume, four…).
 * Armé, une silhouette translucide suit la tuile visée, ROUGE là où la pose est
 * perdue d'avance (hors portée, occupée).
 *
 * LA COUCHE QUE RUST N'A PAS (spec construction R22) : quand on tient un COMPOSANT,
 * le fantôme PRÉDIT la fonction — « → Forge N2 » AVANT la pose, en simulant la
 * reconnaissance d'amas avec la structure ajoutée. C'est ce qui rend l'émergence
 * lisible : on voit ce qu'on va faire naître.
 *
 * Il ne DÉCIDE rien : la sim revalide la pose (carré, navigabilité, matériaux —
 * invariant §3). Un fantôme vert n'est PAS une promesse — c'est « rien ici ne
 * l'interdit *de ce que le client peut voir* ».
 */
import { COMPONENT_TYPES, doorPairs, EDGE_N, edgeBarrierAt, floorAt, fullTileAt, piece, recognizeFunctions, roofAt, WALL_MATERIAL_ORDER, type RecognizedFunction, type Structure } from '@ashes/sim'
import { tileFeetAnchor } from '../../render/framing'
import { TILE_PX } from '../../render/framing'
import { EDGE_ORIGIN_Y, MUR_HT } from '../../render/bati-art'
import type { Placeable } from '../../hud-state'
import type Phaser from 'phaser'
import type { Warp } from '../../render/warp'
import { FONT } from '../ui/typography'

/**
 * LE VERT ET LE ROUGE DE LA POSE. EXPORTÉS (2026-08-04) parce qu'ils ont un second
 * lecteur : le TAPIS de constructibilité (`carre-village.ts`) dit la même chose que le
 * fantôme, une tuile plus loin. Deux verts différents pour un seul « ça passe », et
 * l'œil chercherait une distinction qui n'existe pas.
 *
 * Ils ne vivent pas dans `ui/palette.ts` par un choix de grammaire : la palette du jeu
 * est ENCRE + 2 ACCENTS (braise, alerte) et n'a pas de vert. Le vert de la pose est un
 * code de FANTÔME, pas une couleur d'interface.
 */
/** Le nom que le joueur lit — la table du menu du marteau dit la même chose. */
const MATERIAU_LABEL: Record<string, string> = { wood: 'bois', stone: 'pierre', metal: 'métal' }

/**
 * LE PALIER QU'UNE AMÉLIORATION DONNERA — ou `undefined` si le mur est déjà au maximum.
 *
 * Miroir EXACT de la sim (`upgrade_structure` : « palier de matériau suivant », R8) : même
 * table, même pas de un, même défaut à `wood` quand le matériau n'est pas écrit. Il est ici
 * pour que le fantôme dise la vérité en DEUX endroits à la fois — la couleur (améliorable
 * n'est pas « occupé ») et l'étiquette (ce qu'on obtiendra, qui n'est PAS l'onglet armé).
 * Extrait de la classe pour être prouvé sur tout son domaine, y compris ses bords.
 */
export function prochainPalier(material: string | undefined): string | undefined {
  const i = WALL_MATERIAL_ORDER.indexOf((material ?? 'wood') as (typeof WALL_MATERIAL_ORDER)[number])
  if (i < 0) return undefined // un matériau inconnu : on ne promet rien
  return WALL_MATERIAL_ORDER[i + 1]
}

export const OK_TINT = 0x9adf7a
export const BAD_TINT = 0xd9614f
/**
 * DEUX OPACITÉS, PARCE QUE LA COULEUR SEULE NE SUFFIT PAS.
 *
 * Le fantôme disait oui/non par la TEINTE seule — un vert et un rouge. Mesuré par simulation
 * Viénot–Brettel–Mollon puis ΔE2000 : l'écart tombe de **60,7 en vision normale à 17,0 en
 * deutéranopie (−72 %)**, et à 30,4 en protanopie. Les deux teintes deviennent `#cece7d` et
 * `#929248` : deux olives. C'était le seul point du jeu où le joueur reçoit un refus SANS
 * second canal — et aucun des 235 constats de l'audit précédent n'avait regardé la couleur
 * sous cet angle. (Audit UX 2026-08-20, D10-11.)
 *
 * On ajoute donc un canal que le daltonisme n'atteint pas : l'OPACITÉ. Le refus s'efface, la
 * pose possible s'affirme — « ce n'est pas vraiment là » se lit sans nommer une couleur. Le
 * garde (`build-ghost.test`) mesure l'écart APRÈS simulation, pour qu'il ne puisse pas
 * redevenir une affaire de teinte.
 */
export const GHOST_ALPHA_OK = 0.68
export const GHOST_ALPHA_BAD = 0.26
/** L'opacité de départ (avant qu'on sache si la pose passe) : celle du refus, la plus sobre. */
const GHOST_ALPHA = GHOST_ALPHA_BAD

/**
 * LE FANTÔME NE SE TRIE PAS DANS LE MONDE — il se pose PAR-DESSUS (R23/R25).
 *
 * Il triait avec le bâti (`barriereDepth`/`structureDepth`), ce qui semble juste : on voulait le
 * voir « se glisser » derrière ce qui le dépasse. Avec la pose sur ARÊTE, ça se retourne — on
 * bâtit presque toujours **contre un mur déjà là**.
 *
 * LE RAISONNEMENT (géométrie, pas mesure — il suffit de lire `barriereDepth`) : un mur monte à
 * DEUX tuiles, et il se dessine après tout ce dont les pieds sont plus au nord. Un fantôme visé
 * une tuile au nord d'un mur existant a donc des pieds plus petits, et le mur — deux fois plus
 * haut que sa tuile — le RECOUVRE. C'est le même piège que `barriereAvale` règle pour les
 * acteurs. Or un fantôme qu'on ne voit pas ne peut pas être tourné.
 *
 * Il reste POSITIONNÉ comme le mur qu'il annonce (même ancre, même arête, `EDGE_ORIGIN_Y`) : sa
 * géométrie ne ment pas. Seule sa PROFONDEUR quitte le monde — c'est une pièce d'interface, au
 * même titre que l'étiquette prédictive juste au-dessus (1 450 000).
 */
const GHOST_DEPTH = 1_440_000

/** Le nom affiché d'une fonction prédite (spec construction R22). Étendu par tranche. */
const FUNCTION_LABEL: Record<string, string> = { forge: 'Forge', atelier: 'Atelier', grenier: 'Grenier', ferme: 'Ferme' }

/** Les types de composants (source unique : la sim) — distingue un composant d'une barrière. */
const COMPONENT_SET = new Set<string>(COMPONENT_TYPES)

export class BuildGhost {
  private readonly sprite: Phaser.GameObjects.Image
  /** L'étiquette prédictive « → Forge N2 » (spec construction R22). */
  private readonly predict: Phaser.GameObjects.Text

  constructor(scene: Phaser.Scene) {
    this.sprite = scene.add.image(0, 0, 'st-wall').setOrigin(0.5, 1).setAlpha(GHOST_ALPHA).setVisible(false)
    this.predict = scene.add
      .text(0, 0, '', { fontFamily: FONT, fontSize: '13px', color: '#e8c66a', stroke: '#14141a', strokeThickness: 3 })
      .setOrigin(0.5, 1)
      .setDepth(1_450_000)
      .setVisible(false)
  }

  update(
    placing: Placeable | null,
    tx: number,
    ty: number,
    inRange: boolean,
    structures: readonly Structure[],
    warp: Warp | undefined,
    /** L'ARÊTE ARMÉE (R23) — le bit que `A`/`E` ont choisi. Mur et porte seuls la portent. */
    edge: number = EDGE_N,
  ): void {
    if (placing === null) {
      this.sprite.setVisible(false)
      this.predict.setVisible(false)
      return
    }
    // ═══ LE FANTÔME D'ARÊTE (spec construction R23) ═══
    //
    // Un mur et une porte ne prennent plus la tuile : ils se posent sur une de ses ARÊTES. Le
    // fantôme doit donc tomber sur les MÊMES PIXELS que la barrière posée — même texture
    // `st-<fam>-e<bit>`, même ancrage `EDGE_ORIGIN_Y` (le sprite déborde sous sa tuile, le mur
    // étant à cheval). Les deux formules ne sont pas recopiées de `snapshot-view` : elles sont
    // lues là où elles vivent. Seule la PROFONDEUR diffère, et exprès (`GHOST_DEPTH`).
    const surArete = placing === 'wall' || placing === 'door' || placing === 'palissade'
    // ET L'OCCUPATION SE LIT SUR L'ARÊTE. « Une structure sur la tuile » rougissait le coin
    // d'une pièce dès son premier mur — or c'est exactement là qu'il faut poser le second.
    // SUR UNE TUILE, ELLE SE LIT PAR COUCHE (R14, comme `evaluateBuild`) : seul un doublon de
    // la MÊME couche occupe. « N'importe quelle structure » rougissait le fantôme de toit sur
    // chaque case dallée ou meublée — couvrir une pièce est pourtant le geste normal du toit
    // (relevé à la revue du calage des toits, 2026-08-10). Trois lectures de couche, toutes
    // importées de /sim — jamais recopiées.
    const couche = piece(placing).occupe
    /**
     * UNE ARÊTE DÉJÀ MURÉE N'EST PAS « OCCUPÉE » — ELLE EST AMÉLIORABLE (audit UX, D5-R1).
     *
     * Le fantôme rougissait dès qu'une barrière existait sur l'arête visée. Mais le résolveur
     * de clic, lui, fait de cette même barrière un `upgrade_structure` — une action LÉGALE, et
     * qui COÛTE. Le joueur voyait donc rouge, cliquait, et son inventaire se vidait : le
     * fantôme annonçait l'impossible et le clic faisait le contraire. C'est exactement le
     * défaut du carré de village (« le fantôme restait VERT là où la sim refusait »), pris à
     * l'envers — et il est pire dans ce sens-là, parce qu'il fait PAYER une surprise.
     *
     * Sauf au dernier palier : là, la sim refuse pour de bon (« palier maximal »), et le rouge
     * redevient la vérité.
     */
    const barriere = surArete ? edgeBarrierAt(structures, tx, ty, edge) : undefined
    const monte = barriere !== undefined ? prochainPalier(barriere.material) : undefined
    const ameliorable = monte !== undefined
    const occupied = surArete
      ? barriere !== undefined && !ameliorable
      : couche === 'toit'
        ? roofAt(structures, tx, ty) !== undefined
        : couche === 'sol'
          ? floorAt(structures, tx, ty) !== undefined
          // PLEIN-TUILE : `fullTileAt`, comme `evaluateBuild` — pas `solidAt`, qui compte
          // aussi les barrières d'ARÊTE déclarées sur la tuile : le fantôme rougirait le
          // geste normal d'ADOSSER un four à son propre mur, que la sim accepte.
          : fullTileAt(structures, tx, ty) !== undefined
    const a = tileFeetAnchor(tx, ty, TILE_PX)
    const lift = warp?.lift(tx + 0.5, ty + 1) ?? 0
    // LA PORTE DOUBLE SE PRÉDIT (R27) : si l'arête armée complète une paire colinéaire avec une
    // porte déjà là, le fantôme montre la MOITIÉ de cadre qui sera vraiment dessinée. C'est
    // l'affordance qui APPREND la règle au joueur — deux portes mitoyennes fusionnent — avant
    // qu'il ne paie la seconde, et par le même moteur que la sim (`doorPairs`, R22 : il ne ment pas).
    const fam = placing === 'door' && !occupied ? famillePorte(structures, tx, ty, edge) : placing
    // LE TOIT SE POSE À LA CRÊTE, ET SON FANTÔME AUSSI (calage du 2026-08-10) : même levage
    // que la pièce posée (`snapshot-view`) — un fantôme au sol mentirait de deux tuiles.
    const leve = placing === 'roof' ? MUR_HT : 0
    this.sprite
      // LA PORTE PORTE SA FRAME (R26) : sa famille est indexée, `st-door-e<bit>` n'existe plus.
      // Le fantôme montre la frame 0 — CLOSE, ce qu'on va effectivement poser. Sans ce suffixe,
      // armer « Porte » affichait un damier magenta : une texture manquante ne lève pas.
      .setTexture(surArete ? `st-${fam}-e${edge}${placing === 'door' ? '-f0' : ''}` : `st-${placing}`)
      .setOrigin(0.5, surArete ? EDGE_ORIGIN_Y[fam] ?? 1 : 1)
      .setPosition(a.px, a.py - lift - leve)
      .setDepth(GHOST_DEPTH)
      .setTint(inRange && !occupied ? OK_TINT : BAD_TINT)
      // Le SECOND canal, celui qui survit au daltonisme : le refus est plus effacé.
      .setAlpha(inRange && !occupied ? GHOST_ALPHA_OK : GHOST_ALPHA_BAD)
      .setVisible(true)

    // R22 — la PRÉDICTION d'émergence : ce que ce composant ferait naître ou monter.
    const pred = COMPONENT_SET.has(placing) && !occupied ? predictFunction(structures, placing, tx, ty) : null
    /**
     * ET CE QU'UNE AMÉLIORATION DONNERA VRAIMENT (audit UX, D5-R1, seconde moitié).
     *
     * Le menu du marteau a des onglets de matériau, et le joueur en déduit qu'il CHOISIT la
     * cible. La sim, elle, monte d'UN palier — c'est sa spec (R8, « palier de matériau
     * SUIVANT : bois→pierre→métal »), et c'est une progression, pas un bug. Onglet MÉTAL sur
     * un mur de bois : on obtient de la PIERRE, et rien ne le disait.
     *
     * On le dit donc là où le joueur regarde déjà — au-dessus du fantôme, dans le canal qui
     * annonce déjà ce qu'une pose fera naître. On ne touche pas à la règle : on cesse de
     * laisser croire autre chose.
     */
    if (pred) {
      this.predict.setText(`→ ${FUNCTION_LABEL[pred.functionId] ?? pred.functionId} N${pred.tier}`)
        .setPosition(a.px, a.py - lift - TILE_PX)
        .setVisible(true)
    } else if (monte !== undefined) {
      this.predict.setText(`→ ${MATERIAU_LABEL[monte] ?? monte}`)
        .setPosition(a.px, a.py - lift - TILE_PX)
        .setVisible(true)
    } else {
      this.predict.setVisible(false)
    }
  }
}

/**
 * La FAMILLE que prendrait une porte posée là (R27) : `door2a`/`door2b` si l'arête armée
 * complète une paire colinéaire — la même dérivation que la sim et que `snapshot-view`
 * (`doorPairs`), rejouée avec la porte hypothétique — `door` sinon.
 */
function famillePorte(structures: readonly Structure[], tx: number, ty: number, edge: number): string {
  const hypo = [...structures, { id: -1, type: 'door', tx, ty, villageId: 0, edges: edge } as Structure]
  const paire = doorPairs(hypo).get(-1)
  return paire === undefined ? 'door' : paire.premiere ? 'door2a' : 'door2b'
}

/**
 * Ce que la pose ferait ÉMERGER ou MONTER (spec construction R22) : on rejoue la
 * reconnaissance d'amas AVEC la structure hypothétique, et on retourne la fonction
 * qui apparaît ou grimpe d'un palier. Pur (même moteur que la sim) : le fantôme ne
 * ment pas. `null` = rien de neuf (le composant est isolé, ou n'ajoute aucun palier).
 */
const cleFonction = (f: RecognizedFunction): string => `${f.functionId}@${f.tx},${f.ty}`

/**
 * L'ÉTAT D'AVANT NE DÉPEND PAS DE LA POSE — il se mémoïse sur le TABLEAU (PERF, audit du
 * 2026-08-20). `predictFunction` reconnaissait les amas DEUX fois par image, marteau en
 * main : une fois le monde tel quel, une fois avec la pièce hypothétique. Or la première
 * ne bouge qu'au snapshot.
 *
 * La clé est l'IDENTITÉ du tableau, et c'est ce qui rend le cache exact : `syncStructures`
 * REMPLACE `view.structures` à chaque snapshot (snapshot-view.ts:1495), il ne le mute pas.
 * Un tableau neuf = une entrée neuve ; l'ancienne s'en va avec lui (WeakMap). Il n'y a donc
 * aucun front à guetter — pas de tuile qui changerait sous un cache resté valide.
 */
const AVANT_PAR_TABLEAU = new WeakMap<readonly Structure[], Map<string, number>>()
function fonctionsAvant(structures: readonly Structure[]): Map<string, number> {
  let avant = AVANT_PAR_TABLEAU.get(structures)
  if (avant === undefined) {
    avant = new Map(recognizeFunctions(structures).map((f) => [cleFonction(f), f.tier]))
    AVANT_PAR_TABLEAU.set(structures, avant)
  }
  return avant
}

function predictFunction(
  structures: readonly Structure[],
  comp: Placeable,
  tx: number,
  ty: number,
): RecognizedFunction | null {
  const key = cleFonction
  const before = fonctionsAvant(structures)
  const hypo = [...structures, { id: -1, type: comp, tx, ty, villageId: 0 } as Structure]
  const after = recognizeFunctions(hypo)
  // La fonction NOUVELLE ou montée d'un palier grâce à la pose.
  let best: RecognizedFunction | null = null
  for (const f of after) {
    const prev = before.get(key(f)) ?? 0
    if (f.tier > prev && (best === null || f.tier > best.tier)) best = f
  }
  return best
}
