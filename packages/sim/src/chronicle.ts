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
import { faitsDuLieu, lieuDuFait, nomDEre, phraseDuFait } from './annales'
import type { FaitDeGeneration, WorldMap } from './map'
import { modificateurDeSaison, NOMS_MODIFICATEUR } from './modificateur'
import { POI_CHARGES } from './poi-discovery'
import { seasonDayAtTick, tourForDay } from './time'

/**
 * LES QUATRE SAISONS, PAR PHASE (spec `saisons.md` S3, décision d'Alexis 2026-08-23).
 * `l'Éclosion` et `le Grand Froid` ne bougent pas ; `l'Ardeur` et `les Pluies` sont neuves et
 * disent leur météo dominante — le bandeau informe au lieu de décorer. **« la Cendre » a quitté
 * cette table** : elle nomme le FRONT, pas une saison.
 */
const ACT_NAMES = ['l’Éclosion', 'l’Ardeur', 'les Pluies', 'le Grand Froid'] as const
const ROMAIN = ['I', 'II', 'III', 'IV'] as const

/**
 * LE NOM D'UNE SAISON, par sa PHASE (1..4) — la seule porte vers cette table.
 *
 * Exportée le 2026-08-24 pour la barre haute : le HUD nomme désormais la saison au lieu
 * d'écrire « ACTE II » en chiffres romains. Quatre noms recopiés côté client auraient dérivé
 * au premier renommage — et le quatrième acte a justement attendu son baptême jusqu'à `S3`.
 * Le repli romain vaut pour tout entier hors domaine : la fonction est TOTALE, comme les lois
 * d'acte qu'elle accompagne.
 */
export function nomDeSaison(phase: number): string {
  return ACT_NAMES[phase - 1] ?? `l’acte ${ROMAIN[phase - 1] ?? phase}`
}

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
  'murmure_recueilli',
  'bucher_rituel',
  'village_archetype_changed',
  'horde_spawned',
  'convoy_spawned',
  'brume_annonce',
  'filon_decouvert',
  'blizzard_annonce',
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
  jourDeDepart: number,
  villageNames: Record<number, string>,
  /**
   * LA CARTE — pour poser la CLEF DE LIEU sur toute ligne dont le fait a eu lieu quelque part
   * (R13). Elle est REQUISE et non optionnelle, exprès : un paramètre facultatif aurait laissé
   * chaque appelant perdre la clef en silence, et la fiche d'un lieu serait redevenue une ligne
   * unique sans que rien ne rougisse. Le compilateur tient la liste des appelants.
   */
  map: WorldMap,
): ChronicleEntry[] {
  // Le `+ jourDeDepart` EST le jour d'ouverture du monde (S2) : recopier `+ 1` en dur datait
  // toute la chronique de cinquante jours trop tôt et scellait les volumes sur la mauvaise année.
  const day = (tick: number): number => seasonDayAtTick(tick, calendarScale, jourDeDepart)
  const name = (villageId: number): string => villageNames[villageId] ?? `le village ${villageId}`
  const entries: ChronicleEntry[] = []
  const giftPairs = new Set<string>()
  // Le PREMIER mors de la Cendre, et la PREMIÈRE entrée chez chaque village : la mémoire du
  // formateur, locale et pure — l'état vit dans la passe, jamais dans la sim.
  let cendreDite = false
  const cendreChez = new Set<number>()
  let murmureEntendu = false

  for (const e of events) {
    const d = day(e.tick)
    // LA CLEF DE LIEU SE POSE ICI, EN UN SEUL POINT (R13) : ou bien l'appelant la connaît
    // (`poi_first_visit` — il PORTE un `poiId`), ou bien on la DÉRIVE de
    // la position du fait. Un événement de chronique qui gagnera demain un (tx, ty) entrera
    // dans les fiches sans qu'on y touche ; un fait sans position n'appartient à aucun lieu,
    // et c'est un fait sur la donnée, pas un oubli.
    const p = e as { tx?: number; ty?: number }
    const push = (text: string, weight: ChronicleWeight, lieu?: number): void => {
      const clef = lieu ?? (p.tx !== undefined && p.ty !== undefined ? lieuDuFait(map, p.tx, p.ty) : undefined)
      entries.push({ day: d, text, weight, ...(clef !== undefined ? { lieu: clef } : {}) })
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
        // est une Éclosion. On nomme donc la PHASE, pas le numéro global ; les quatre sont
        // baptisées depuis le 2026-08-23 (S3). À partir du deuxième tour, l'an se dit : c'est
        // la seule information que le joueur n'a pas sous les yeux.
        // « Ce n'est pas l'acte de NAISSANCE » — et non « ce n'est pas l'acte 1 » : depuis
        // que le monde ouvre au jour 61 (S2), son acte de naissance est le 3, et l'ancienne
        // garde laissait passer une ligne parasite au premier instant du monde.
        if (e.tick > 0) {
          const nom = nomDeSaison(phaseOf(e.act))
          const tour = tourOf(e.act)
          // LE CARACTÈRE DE LA SAISON (S18) se dit ICI et nulle part ailleurs : la chronique le
          // nomme au premier jour, le HUD ne le dit pas. Une saison sur trois n'en a pas — et
          // c'est ce silence-là qui rend les autres remarquables.
          const caractere = modificateurDeSaison(tour, phaseOf(e.act))
          const suffixe = caractere === null ? '' : ` — ${NOMS_MODIFICATEUR[caractere]}.`
          // L'ACCORD SUIT LE NOM : « les Pluies ONT commencé ». Trois des quatre saisons sont
          // au singulier, une au pluriel — et un gabarit unique disait « les Pluies a commencé ».
          const verbe = nom.startsWith('les ') ? 'ont' : 'a'
          push(
            (tour > 1 ? `L’an ${tour} — ${nom} ${verbe} commencé.` : `${nom} ${verbe} commencé.`) + suffixe,
            'battement',
          )
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
      case 'bucher_rituel':
        // R31b — LE SEUL RECUL DU MONDE. Toujours « intime » : ça n'arrive pas deux fois par
        // veillée, et quand ça arrive, c'est l'histoire de la soirée.
        push('Le bûcher a rendu les morts à la fosse — et la Cendre, pour une fois, a reculé.', 'intime')
        break
      case 'murmure_recueilli':
        // R27c — LA CENDRE RACONTE SES MORTS. Le premier murmure CHUCHOTE (on découvre que la
        // vieille cendre parle), les suivants sont des lignes de récit — jamais de compte ni
        // de coordonnées : un murmure est un moment, pas un relevé.
        if (!murmureEntendu) {
          murmureEntendu = true
          push('Dans la vieille cendre, cette nuit-là, quelque chose a murmuré — et s’est laissé écouter.', 'intime')
        } else {
          push('Un autre murmure s’est donné, dans la cendre qui se souvient.', 'recit')
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
function anDe(e: SimEvent, calendarScale: number, jourDeDepart: number): number {
  return tourForDay(seasonDayAtTick(e.tick, calendarScale, jourDeDepart))
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
  jourDeDepart: number,
  villageNames: Record<number, string>,
  map: WorldMap,
): ChronicleVolume[] {
  const parAn = new Map<number, SimEvent[]>()
  for (const e of events) {
    const an = anDe(e, calendarScale, jourDeDepart)
    const liste = parAn.get(an)
    if (liste) liste.push(e)
    else parAn.set(an, [e])
  }
  return [...parAn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([an, liste]) => ({ an, entrees: chronicleFromEvents(liste, calendarScale, jourDeDepart, villageNames, map) }))
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
  jourDeDepart: number,
  villageNames: Record<number, string>,
  tourCourant: number,
  map: WorldMap,
): { volumes: ChronicleVolume[]; courant: SimEvent[] } {
  const revolus = events.filter((e) => anDe(e, calendarScale, jourDeDepart) < tourCourant)
  const courant = events.filter((e) => anDe(e, calendarScale, jourDeDepart) >= tourCourant)
  return { volumes: volumesDeChronique(revolus, calendarScale, jourDeDepart, villageNames, map), courant }
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

/**
 * UNE LIGNE DE LA FICHE — la colonne UNIQUE (décision d'Alexis, 2026-08-25 : « une colonne
 * chronologique »). La strate du monde et la strate du joueur y prennent la MÊME forme : une
 * gouttière, un texte, un registre. On ne distingue plus qui a écrit quoi, et c'est le but —
 * la fiche du docstring de `registreDuLieu` (« … et l'on ne distingue plus qui est la strate
 * de qui »).
 */
export interface LigneDeFiche {
  /** La gouttière : le nom de l'ÈRE pour un fait du pays d'avant, « l'an K · jour N » pour une
   *  ligne de chronique. Écrite ICI et nulle part ailleurs — l'écrivain unique. */
  gouttiere: string
  texte: string
  poids: ChronicleWeight
  /**
   * LE RANG CHRONOLOGIQUE, en donnée — pour qu'une garde affirme l'ordre sans relire le texte,
   * et pour qu'un rendu puisse grouper. Les ères précèdent toutes les années : le pays d'avant
   * est, par définition, avant.
   */
  rang: { ere: number } | { an: number; jour: number }
}

/**
 * LA FICHE D'UN LIEU, PRÊTE À LIRE — `registreDuLieu` rend deux tableaux, celle-ci rend LA
 * colonne : les faits d'annales dans l'ordre des ères, puis les lignes de chronique dans
 * l'ordre des années. C'est le seul endroit où les deux strates se rencontrent.
 *
 * Pure. La SAILLANCE (R4) ne filtre pas ici : MESURÉ sur le monde joué (`tools/diag-fiche.mts`,
 * seeds 2026/7/99), **28 faits sur 28 sont saillants** — la règle est inerte à cette échelle, et
 * un filtre inerte est un filtre qui ment sur son utilité. La LACUNE (R5), elle, ne s'applique
 * jamais au constat d'un visiteur (R5②).
 */
export function ficheDuLieu(map: WorldMap, poiId: number, volumes: ChronicleVolume[]): LigneDeFiche[] {
  const { annales, lignes } = registreDuLieu(map, poiId, volumes)
  const out: LigneDeFiche[] = []
  // Le pays d'avant, ère par ère. `sort` est stable en JS moderne — deux faits d'une même ère
  // gardent l'ordre de la génération, qui est déterministe.
  for (const f of [...annales].sort((a, b) => a.ere - b.ere)) {
    const { texte, poids } = phraseDuFait(f)
    out.push({ gouttiere: nomDEre(f.ere), texte, poids, rang: { ere: f.ere } })
  }
  // Puis le joueur, an par an — et à l'intérieur d'une année, jour par jour.
  const siennes = [...lignes].sort((a, b) => (a.an - b.an) || (a.entree.day - b.entree.day))
  for (const { an, entree } of siennes) {
    out.push({
      gouttiere: `l’an ${an} · jour ${entree.day}`,
      texte: entree.text,
      poids: entree.weight,
      rang: { an, jour: entree.day },
    })
  }
  return out
}
