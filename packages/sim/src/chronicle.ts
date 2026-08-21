/**
 * La chronique — la Mémoire v1 (GDD §2, spec saison R6).
 *
 * Fonction PURE : le flux d'événements de domaine (posé en V0 précisément
 * pour cela) devient un récit daté. L'hôte accumule les événements drainés
 * et appelle ce formateur — la sim ne raconte pas, elle témoigne.
 *
 * La sortie porte TROIS POIDS (décision d'Alexis, 2026-07-19) : le *battement*
 * du monde frappe fort (le Grand Froid, les hordes, la fin), le *récit* est le
 * corps courant (fondations, dons, virages d'alignement), l'*intime* chuchote
 * (« Quelqu'un est tombé. » — sa sobriété EST son poids). Le poids est du SENS,
 * pas de la déco : le rendu (maquette Turn 6A) s'appuie dessus. On expose donc
 * une entrée structurée `{ jour, texte, poids }` — le jour est SÉPARÉ du texte
 * (gouttière de dates de la maquette), et le mapping type→poids vit ici, pur.
 */
import { WORLD_EVENTS, phaseOf, tourOf } from './balance'
import type { SimEvent } from './events'
import { faitsDuLieu } from './annales'
import type { FaitDeGeneration, WorldMap } from './map'
import { POI_CHARGES } from './poi-discovery'
import { TICKS_PER_SEASON_DAY, tourForDay } from './time'

const ACT_NAMES = ['l’Éclosion', 'le Grand Froid', 'la Cendre'] as const
const ROMAIN = ['I', 'II', 'III', 'IV'] as const

/** Les trois registres de la chronique (voir en-tête). */
export type ChronicleWeight = 'battement' | 'recit' | 'intime'

/** Une ligne de chronique : le jour (1-based) à part, le texte sans préfixe, le poids. */
export interface ChronicleEntry {
  day: number
  text: string
  weight: ChronicleWeight
  /** LE LIEU dont la ligne parle (un `poiId`), quand elle en a un — la clef de jointure de la
   *  fiche par lieu (T5) : la chronique et les annales s'y interfeuillent sans jamais
   *  fusionner en données. */
  lieu?: number
}

/**
 * UN VOLUME — la chronique d'UNE année (saison-sans-fin T5, décision d'Alexis 2026-08-21 :
 * « la chronique se scelle au tour de l'année »). Relisible à jamais, plus jamais augmentée :
 * la seule borne propre à une mémoire sans fin.
 */
export interface ChronicleVolume {
  an: number
  entrees: ChronicleEntry[]
}

/** Rendu plat « Jour N — texte » (journal simple, en attendant le rendu à 3 poids). */
export function formatChronicleLine(e: ChronicleEntry): string {
  return `Jour ${e.day} — ${e.text}`
}

/**
 * LES TYPES QUI NOURRISSENT LA CHRONIQUE — exactement ceux que le `switch` de
 * `chronicleFromEvents` sait raconter. Exporté pour que les DEUX accumulateurs filtrent
 * sur la MÊME vérité : l'hôte, qui retient un log borné à PERSISTER (une Veillée reprise
 * doit retrouver sa chronique), et le client, qui alimente son `eventLog` d'affichage. Un
 * type ajouté au récit ci-dessus s'ajoute ICI — et entre alors d'un coup dans la
 * persistance ET l'affichage, sans qu'une liste dupliquée dérive en silence (c'est
 * exactement ce qui privait `poi_first_visit` de chronique côté client). */
export const CHRONICLE_EVENT_TYPES: ReadonlySet<SimEvent['type']> = new Set([
  'village_founded',
  'village_stage_up',
  'settler_arrived',
  'village_fell',
  'act_started',
  'cendre_avance',
  'cendre_prend',
  'village_archetype_changed',
  'horde_spawned',
  'convoy_spawned',
  'brume_annonce',
  'filon_decouvert',
  'blizzard_annonce',
  'refugees_arrived',
  'refugee_rumeur',
  'refugees_recruited',
  'gift_given',
  'entity_died',
  'evacuation_opened',
  'ark_departed',
  'poi_first_visit',
  'season_ended',
])

export function chronicleFromEvents(
  events: SimEvent[],
  calendarScale: number,
  villageNames: Record<number, string>,
): ChronicleEntry[] {
  const day = (tick: number): number => Math.floor((tick * calendarScale) / TICKS_PER_SEASON_DAY) + 1
  const name = (villageId: number): string => villageNames[villageId] ?? `le village ${villageId}`
  const entries: ChronicleEntry[] = []
  const giftPairs = new Set<string>()
  // Le PREMIER mors de la Cendre, et la PREMIÈRE entrée chez chaque village : la mémoire du
  // formateur, locale et pure — l'état vit dans la passe, jamais dans la sim.
  let cendreDite = false
  const cendreChez = new Set<number>()

  for (const e of events) {
    const d = day(e.tick)
    const push = (text: string, weight: ChronicleWeight, lieu?: number): void => {
      entries.push({ day: d, text, weight, ...(lieu !== undefined ? { lieu } : {}) })
    }
    switch (e.type) {
      case 'village_founded':
        push(`Un Feu s'est allumé : ${name(e.villageId)}.`, 'recit')
        break
      // L'ÉVOLUTION DES VILLAGES PNJ (spec village-pnj-evolution R6/R9) : la montée
      // d'un palier de bâti est un grand fait de saison — le paysage change.
      case 'village_stage_up':
        if (e.stage >= 3) push(`${name(e.villageId)} s'est fait bourg : la pierre remplace le bois.`, 'battement')
        else push(`${name(e.villageId)} s'est fait hameau : les logis montent, l'enceinte suit.`, 'battement')
        break
      case 'settler_arrived':
        push(`Un colon, attiré par la prospérité, s'est installé à ${name(e.villageId)}.`, 'recit')
        break
      case 'village_fell':
        // Le village a quitté l'état : on lit le nom PORTÉ par l'événement, pas la
        // table (il n'y est plus). La chute d'un foyer est un grand fait de saison.
        push(`${e.name} est tombé : son Feu s'est éteint, il n'en reste que des cendres.`, 'battement')
        break
      case 'act_started':
        // L'ARC OSCILLE (T2) : les saisons REVIENNENT, et avec leur nom — l'Éclosion de l'an 2
        // est une Éclosion. On nomme donc la PHASE, pas le numéro global ; le quatrième acte
        // (le cœur de l'hiver) attend son baptême — décision ouverte, bible §5 — et se dit
        // « l'acte IV » en attendant. À partir du deuxième tour, l'an se dit : c'est la seule
        // information que le joueur n'a pas sous les yeux.
        if (e.act > 1) {
          const nom = ACT_NAMES[phaseOf(e.act) - 1] ?? `l’acte ${ROMAIN[phaseOf(e.act) - 1] ?? phaseOf(e.act)}`
          const tour = tourOf(e.act)
          push(tour > 1 ? `L’an ${tour} — ${nom} a commencé.` : `${nom} a commencé.`, 'battement')
        }
        break
      case 'village_archetype_changed':
        if (e.archetype === 'foyer') push(`${name(e.villageId)} a viré au bleu : un Foyer.`, 'recit')
        else if (e.archetype === 'meute') push(`${name(e.villageId)} a viré au rouge : une Meute.`, 'recit')
        else push(`Le Feu de « ${name(e.villageId)} » est redevenu neutre.`, 'recit')
        break
      case 'horde_spawned': {
        // LA HORDE EST UNE PENTE, PLUS UN SCRIPT (décisions ⑭⑲, 2026-08-21) : la méga-horde
        // nommée n'existe plus — la dernière nuit est naturellement la pire. Les seuils du
        // récit SE DÉRIVENT de la rampe (jamais recopiés) : « déferlé » au sommet de la
        // table (`HORDE_TAILLE.FIN`, à un cran près), « grande » à mi-pente. Et la cible
        // peut être un simple feu de camp (décision ⑬) : on nomme le village s'il y en a
        // un, sinon c'est le feu d'un homme seul que la nuit a choisi.
        const cible = e.villageId !== undefined ? name(e.villageId) : 'un feu isolé'
        const grande = (WORLD_EVENTS.HORDE_TAILLE.DEBUT + WORLD_EVENTS.HORDE_TAILLE.FIN) / 2
        // Ni « goules » (le Cendreux a absorbé le zombie — canon R1, un seul mort-vivant),
        // ni compteur entre parenthèses (bible T4 : un nombre entre parenthèses, c'est la
        // simulation qui parle en costume). La taille a déjà choisi le VERBE — ça suffit.
        if (e.size >= WORLD_EVENTS.HORDE_TAILLE.FIN - 1) push(`La horde a déferlé sur ${cible}.`, 'battement')
        else if (e.size >= grande) push(`Une grande horde a marché sur ${cible}.`, 'battement')
        break
      }
      case 'convoy_spawned':
        push(`Une carcasse de convoi a été signalée sur la route.`, 'recit')
        break
      // LA BRUME (spec brume.md) : l'annonce est LE télégraphiage (§9bis) — la chronique
      // prévient la veille ; le retrait, lui, ne se raconte que par ce qu'il PAIE.
      case 'brume_annonce':
        push(`Le gibier s'est tu : une brume de cendre froide descendra sur la vallée à l'aube.`, 'recit')
        break
      case 'filon_decouvert':
        push(
          e.nodeType === 'coal_seam'
            ? `La Brume s'est retirée sur une veine de charbon affleurante — pour qui ose.`
            : `La Brume s'est retirée sur un filon de fer affleurant — pour qui ose.`,
          'recit',
        )
        break
      // LA MÉTÉO (spec meteo.md R9) : seul le blizzard est un fait mémorable — la pluie de
      // mardi n'entre pas dans la chronique. Son annonce de la veille est L'entrée (patron
      // Brume : le télégraphiage se raconte ; `blizzard_entre`/`blizzard_passe`, comme la
      // levée et le retrait de la nappe, non). Un BATTEMENT, pas un récit : c'est le monde
      // qui va serrer la vallée entière, l'étage du Grand Froid et des hordes.
      case 'blizzard_annonce':
        push(`Le vent du nord se lève — un blizzard couvrira la vallée demain. Rentrez le bois.`, 'battement')
        break
      case 'refugees_arrived':
        push(`Des réfugiés (${e.count}) sont apparus sur une route.`, 'recit')
        break
      case 'refugees_recruited':
        push(`${name(e.villageId)} a recueilli des réfugiés — la communauté grandit.`, 'recit')
        break
      case 'gift_given': {
        const key = `${e.byEntityId}:${e.toVillageId}`
        if (!giftPairs.has(key) && e.toVillageId !== 0) {
          giftPairs.add(key)
          push(`Des vivres ont été offerts à ${name(e.toVillageId)}.`, 'recit')
        }
        break
      }
      case 'entity_died':
        // L'intime : discret et grave. Sa sobriété est son poids.
        if (!e.wasMonster) push(`Quelqu'un est tombé.`, 'intime')
        break
      case 'evacuation_opened':
        push(`Une arche s'est ouverte sur la route. Embarquez avant qu'elle ne parte.`, 'battement')
        break
      case 'ark_departed':
        push(
          e.saved > 0 ? `L'arche a levé l'ancre — ${e.saved} à bord, sauvés.` : `L'arche est partie à vide.`,
          'battement',
        )
        break
      case 'refugee_rumeur':
        // Le prix est dit (un repas), le reste est un constat — jamais un conseil.
        push(`Pour un repas, des réfugiés ont dit où trouver ${e.name}.`, 'recit', e.poiId)
        break
      case 'cendre_avance':
        // LE PREMIER MORS SEULEMENT. Le front avance ensuite chaque jour — quarante lignes
        // identiques ne raconteraient rien (le « rare se dit » des annales, appliqué au monde
        // lui-même). La perte continue se LIT sur la carte, par le cortège ; la chronique ne
        // retient que le basculement : le jour où la vallée a commencé à rétrécir.
        if (!cendreDite && e.noeudsBrules > 0) {
          cendreDite = true
          push('La Cendre s’est mise en marche : le sud brûle.', 'battement')
        }
        break
      case 'cendre_prend':
        // P5a — LE PASSÉ DU JOUEUR ENTRE DANS LE MÊME REGISTRE : ses ouvrages pris par le
        // front deviennent des lignes, comme ceux du pays d'avant sont devenus des annales.
        // La première fois chez chacun CHUCHOTE — la Cendre entre chez quelqu'un — puis le
        // constat courant. Jamais de compte : la perte se mesure sur place.
        if (!cendreChez.has(e.villageId)) {
          cendreChez.add(e.villageId)
          push(`La Cendre est entrée chez « ${name(e.villageId)} ».`, 'intime')
        } else {
          push(`La Cendre a pris d’autres ouvrages à « ${name(e.villageId)} ».`, 'recit')
        }
        break
      case 'poi_first_visit':
        // Le bus porte TOUTES les premières visites : c'est le FORMATEUR qui choisit,
        // jamais la logique qui filtre. Deux familles y trouvent leur ligne :
        // — les lieux de devise `recit` (le Sanctuaire, le Cercle…), comme avant ;
        // — les lieux HUMAINS, qui portent leurs faits d'annales (premier LECTEUR du
        //   pays d'avant — décision 2026-08-21, tranche 1). AU PLUS UNE proposition
        //   (règle de l'écrivain), à l'IMPARFAIT : l'imparfait appartient au pays
        //   d'avant, le passé composé au joueur. Et « On a atteint X » plutôt que
        //   « X a été atteint » : la forme active est INSENSIBLE À L'ACCORD par
        //   construction — « la Ferme brûlée a été atteint » est la faute exacte de
        //   « le seuil de le Karst », on ne la réintroduit pas.
        if (e.stele !== undefined) {
          // LA STÈLE SE CITE — le seul « nous » du jeu, entre guillemets : ce n'est pas le
          // chroniqueur qui parle, c'est la pierre. Une brisée se cite pareil : son fragment
          // EST son texte.
          push(`On a lu ${e.name}. « ${e.stele.lignes.join(' ')} »`, 'recit', e.poiId)
        } else if (POI_CHARGES[e.kind]?.devise === 'recit') {
          push(`${e.name} a été atteint pour la première fois.`, 'recit', e.poiId)
        } else {
          // Précédence R7 (spec `annales.md`) : intact > fondation > guet — AU PLUS UNE
          // proposition, et SEULEMENT ces trois-là. La fosse, la gravure, la porte, la
          // croisée attendent les stèles : 80 charniers au fil de l'eau feraient 80 lignes,
          // l'exact contraire du « rare se dit » (R4).
          // ET SEULEMENT S'ILS SONT SAILLANTS (R4 — le rare se dit, le commun se tait) :
          // hors des routes l'intact est partout ; sans ce filtre, MESURÉ, 40 lieux de la
          // carte parlaient — le registre intime noyé sous son propre chuchotement.
          const faits = (e.faits ?? []).filter((f) => f.saillant)
          const sort = faits.find((f) => f.type === 'sort')
          const fondation = faits.find((f) => f.type === 'fondation')
          const guet = faits.find((f) => f.type === 'guet')
          // ⚠ `fondation?.cause`, pas `fondation` : TOUT lieu bâti porte un fait de
          // fondation — c'est la CAUSE (eau, route) qui dit « installé pour une raison ».
          if (sort?.cause === 'intact' && fondation?.cause !== undefined) {
            // L'intact chuchote : personne n'était revenu — et sa sobriété EST son poids.
            // MAIS SEULEMENT LÀ OÙ QUELQU'UN S'ÉTAIT INSTALLÉ POUR UNE RAISON (la ferme de
            // l'eau, la charrette de la route) : MESURÉ, l'intact est l'état NORMAL de
            // l'arrière-pays — 22 lignes intimes sur la carte du harnais, le registre qui
            // chuchote noyé sous son propre chuchotement. La doctrine « loin des routes =
            // intact = riche » fait de l'intact un décor ; le décor appartient aux stèles.
            push(`On a atteint ${e.name}. Personne n'était revenu.`, 'intime', e.poiId)
          } else if (fondation?.cause !== undefined) {
            // Le toponyme dit la FIN (brûlée, pillée) ; la chronique dit le COMMENCEMENT.
            // Deux témoins qui ne se concertent pas — c'est voulu.
            push(`On a atteint ${e.name}. Quelqu'un vivait là, pour ${fondation.cause === 'eau' ? "l'eau" : 'la route'}.`, 'recit', e.poiId)
          } else if (guet?.cause !== undefined) {
            // « Elle regardait le sud » — donc ils SAVAIENT. « Elle » est sûr : le fait guet
            // n'existe que sur la Tour de guet effondrée, féminine par construction.
            push(`On a atteint ${e.name}. Elle regardait ${guet.cause === 'est' ? "l'est" : guet.cause === 'ouest' ? "l'ouest" : `le ${guet.cause}`}.`, 'recit', e.poiId)
          }
        }
        break
      case 'season_ended':
        // La finale : un battement, suivi des verdicts (le corps de la stèle).
        push(`Le monde s'est éteint. Ce qu'on retiendra :`, 'battement')
        for (const v of e.verdicts) push(`${v.name} ${v.outcome}.`, 'recit')
        break
    }
  }
  return entries
}


// ═══════════════════════════════════════════════════════════════════════════════════════════
// LES VOLUMES — la mémoire des hivers (saison-sans-fin T5)
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** L'année d'un événement, depuis son tick — la même horloge que le reste. */
function anDe(e: SimEvent, calendarScale: number): number {
  return tourForDay(Math.floor((e.tick * calendarScale) / TICKS_PER_SEASON_DAY) + 1)
}

/**
 * LA CHRONIQUE EN VOLUMES — un par année présente dans le flux, dans l'ordre des ans.
 *
 * Chaque année se FORMATE SÉPARÉMENT : la mémoire du formateur (le premier mors de la Cendre,
 * la première fois chez chaque village, les paires de dons) repart à neuf au tour de l'année —
 * et c'est voulu : l'hiver REVIENT, donc « la Cendre s'est mise en marche » se redit chaque
 * hiver, et « la Cendre est entrée chez X » chuchote de nouveau. L'an neuf a ses premières fois.
 *
 * Pur, sans état : la même fonction sert au client (l'affichage) et à l'hôte (le scellement) —
 * l'écrivain unique, sinon les deux finiraient par raconter deux années différentes.
 */
export function volumesDeChronique(
  events: SimEvent[],
  calendarScale: number,
  villageNames: Record<number, string>,
): ChronicleVolume[] {
  const parAn = new Map<number, SimEvent[]>()
  for (const e of events) {
    const an = anDe(e, calendarScale)
    const liste = parAn.get(an)
    if (liste) liste.push(e)
    else parAn.set(an, [e])
  }
  return [...parAn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([an, liste]) => ({ an, entrees: chronicleFromEvents(liste, calendarScale, villageNames) }))
}

/**
 * LE SCELLEMENT — ce que l'hôte fait au tour de l'année : les années RÉVOLUES (strictement
 * avant `tourCourant`) deviennent des volumes FORMATÉS, relisibles à jamais, plus jamais
 * augmentés ; l'année courante reste un flux brut (le formateur a besoin de ses événements
 * pour ses premières fois). La sauvegarde porte donc des textes pour le passé et des faits
 * pour le présent — et ne grossit plus sans borne.
 */
export function scellerLaChronique(
  events: SimEvent[],
  calendarScale: number,
  villageNames: Record<number, string>,
  tourCourant: number,
): { volumes: ChronicleVolume[]; courant: SimEvent[] } {
  const revolus = events.filter((e) => anDe(e, calendarScale) < tourCourant)
  const courant = events.filter((e) => anDe(e, calendarScale) >= tourCourant)
  return { volumes: volumesDeChronique(revolus, calendarScale, villageNames), courant }
}

/**
 * LA FICHE D'UN LIEU (T5, reco du scénariste) — les annales et la chronique INTERFEUILLÉES par
 * la clef de LIEU, jamais fusionnées en données : la vallée écrit les premières lignes (les
 * faits d'annales, ère par ère), le joueur écrit les suivantes (ses lignes de chronique, an
 * par an) — « fondée pour l'eau · brûlée avant · atteinte par toi l'an 1 · … » — et l'on ne
 * distingue plus qui est la strate de qui. Pur ; l'UI qui la montre est un chantier à part.
 */
export function registreDuLieu(
  map: WorldMap,
  poiId: number,
  volumes: ChronicleVolume[],
): { annales: FaitDeGeneration[]; lignes: { an: number; entree: ChronicleEntry }[] } {
  const zone = map.zones[poiId]
  const annales = zone ? faitsDuLieu(map, zone) : []
  const lignes: { an: number; entree: ChronicleEntry }[] = []
  for (const v of volumes) for (const entree of v.entrees) if (entree.lieu === poiId) lignes.push({ an: v.an, entree })
  return { annales, lignes }
}
