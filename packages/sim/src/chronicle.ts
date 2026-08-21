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
import { SEASON, WORLD_EVENTS } from './balance'
import type { SimEvent } from './events'
import { POI_CHARGES } from './poi-discovery'
import { TICKS_PER_SEASON_DAY } from './time'

const ACT_NAMES = ['l’Éclosion', 'le Grand Froid', 'la Cendre'] as const

/** Les trois registres de la chronique (voir en-tête). */
export type ChronicleWeight = 'battement' | 'recit' | 'intime'

/** Une ligne de chronique : le jour (1-based) à part, le texte sans préfixe, le poids. */
export interface ChronicleEntry {
  day: number
  text: string
  weight: ChronicleWeight
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
  'village_archetype_changed',
  'horde_spawned',
  'convoy_spawned',
  'brume_annonce',
  'filon_decouvert',
  'blizzard_annonce',
  'refugees_arrived',
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

  for (const e of events) {
    const d = day(e.tick)
    const push = (text: string, weight: ChronicleWeight): void => {
      entries.push({ day: d, text, weight })
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
        if (e.act > 1) push(`${ACT_NAMES[e.act - 1]} a commencé.`, 'battement')
        break
      case 'village_archetype_changed':
        if (e.archetype === 'foyer') push(`${name(e.villageId)} a viré au bleu : un Foyer.`, 'recit')
        else if (e.archetype === 'meute') push(`${name(e.villageId)} a viré au rouge : une Meute.`, 'recit')
        else push(`Le Feu de « ${name(e.villageId)} » est redevenu neutre.`, 'recit')
        break
      case 'horde_spawned':
        // LA MÉGA-HORDE EST *LA* MÉGA-HORDE — celle du premier crépuscule de la Cendre, et
        // aucune autre (décision d'Alexis, 2026-08-02). Le seuil était `12`, écrit en clair :
        // or 12 est la taille d'une horde d'ACTE III ORDINAIRE (`HORDE_SIZE[2]`), si bien que
        // la chronique annonçait « la méga-horde a déferlé » pour une nuit d'acte III banale —
        // et le mot ne voulait plus rien dire le jour où la vraie tombait. Il se dérive
        // désormais de `SEASON.MEGA_HORDE_SIZE` (16), la taille de celle qu'on nomme.
        //
        // Les deux seuils SE DÉRIVENT, jamais recopiés : un rééquilibrage des hordes ferait
        // sinon raconter « une grande horde » pour une petite, sans que rien ne le signale.
        if (e.size >= SEASON.MEGA_HORDE_SIZE) push(`La méga-horde a déferlé sur ${name(e.targetVillageId)} (${e.size} goules).`, 'battement')
        else if (e.size >= WORLD_EVENTS.HORDE_SIZE[1]!) push(`Une grande horde a marché sur ${name(e.targetVillageId)}.`, 'battement')
        break
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
        if (POI_CHARGES[e.kind]?.devise === 'recit') {
          push(`${e.name} a été atteint pour la première fois.`, 'recit')
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
            push(`On a atteint ${e.name}. Personne n'était revenu.`, 'intime')
          } else if (fondation?.cause !== undefined) {
            // Le toponyme dit la FIN (brûlée, pillée) ; la chronique dit le COMMENCEMENT.
            // Deux témoins qui ne se concertent pas — c'est voulu.
            push(`On a atteint ${e.name}. Quelqu'un vivait là, pour ${fondation.cause === 'eau' ? "l'eau" : 'la route'}.`, 'recit')
          } else if (guet?.cause !== undefined) {
            // « Elle regardait le sud » — donc ils SAVAIENT. « Elle » est sûr : le fait guet
            // n'existe que sur la Tour de guet effondrée, féminine par construction.
            push(`On a atteint ${e.name}. Elle regardait ${guet.cause === 'est' ? "l'est" : guet.cause === 'ouest' ? "l'ouest" : `le ${guet.cause}`}.`, 'recit')
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
