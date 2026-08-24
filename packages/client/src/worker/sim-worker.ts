/**
 * L'hôte Worker du mode Veillée (spec client R9).
 *
 * Rôle d'HÔTE uniquement : posséder l'instance de /sim, cadencer les ticks,
 * relayer inputs et snapshots. Aucune logique de jeu ici — elle vit dans
 * /sim, et ce fichier sera remplacé par le serveur en Phase LAN sans que
 * la simulation change.
 */
import {
  BALANCE,
  CHRONICLE_EVENT_TYPES,
  scellerLaChronique,
  jourDeSaison,
  tourForDay,
  type ChronicleVolume,
  collectNodeDeltas,
  createNodeShadow,
  deserializeCarte,
  deserializePartie,
  deserializeSim,
  drainEvents,
  filtreParInteret,
  getGameTime,
  seedNodeShadow,
  baseDepuisNoeuds,
  creerCoffre,
  type Coffre,
  step,
  type MoveInput,
  type PlayerAction,
  type SimEvent,
  type SimState,
  PROTOCOL_VERSION,
  type ClientToHost,
  type HostToClient,
  type NodeShadow,
} from '@ashes/sim'
import { createVeillee, LOAD_PHASES } from './veillee'
import { loadCarte, loadMeta, loadSlot, saveCarteEtSlot, saveSlot, type SlotMeta } from './persistence-store'
import { nettoieNom, seedValide, slotValide, type VeilleeInit } from './mondes'

const post = (message: HostToClient): void => {
  ;(self as unknown as { postMessage(m: unknown): void }).postMessage(message)
}

let sim: SimState | undefined
let playerId = 0
/**
 * QUEL MONDE CE WORKER OUVRE — posé par `veillee_init`, avant tout `join` (voir `mondes.ts`).
 *
 * Un Worker n'ouvre qu'un monde dans sa vie, et le sait avant de naître : la case dit où il
 * écrit, la seed dit quelle vallée il sème. Changer de monde veut donc dire un AUTRE Worker —
 * celui-ci est tué à l'arrêt de `WorldScene` (`host.terminate()`), ce qui est aussi ce qui tient
 * l'invariant de `clearSlot` depuis que revenir au menu ne recharge plus la page (2026-07-29).
 */
let monde: { slot: number; seed: number; nom: string } | undefined
/** Horloge murale de la FONDATION du monde — conservée d'une session à l'autre par la méta. */
let mondeCreeA = 0
/** LE NOM de la vallée : celui de la fondation, ou celui relu au disque à la reprise. */
let mondeNom = ''
/**
 * LA SONDE DE COÛT (dev seulement — voir `PerfMessage`). Le budget d'un tick est de 50 ms
 * (20 Hz) ; ce que le projet en sait vient de Node sous `tsx`, pas de ce moteur-ci. On relève
 * ici, dans le Worker qui joue vraiment la Veillée, et on rend un échantillon par seconde de
 * jeu — moyenne ET pic, parce qu'un gel d'une seconde toutes les six cents ne bouge pas une
 * moyenne mais arrête le monde.
 *
 * Armée sur `import.meta.env.DEV` comme le reste de l'outillage de dev : un build de prod ne
 * mesure rien et n'émet rien.
 */
const SONDE_PERF = import.meta.env.DEV
/** Ticks par échantillon — 20 Hz, donc une seconde de jeu. */
const PERF_FENETRE = 20
let perfN = 0
let perfSomme = 0
let perfPic = 0
let perfPicStep = 0
let perfPicTick = 0
/** Départ du tick précédent — l'écart avec le suivant mesure TOUT ce qui a occupé le Worker. */
let perfDernierDepart = -1
let perfPicEcart = 0
/** Dernière sérialisation d'autosave : le temps pendant lequel le Worker n'a pas tiqué. */
let perfSerialisationMs = -1
let perfOctets = -1
/**
 * LE RÉCIT RETENU PAR L'HÔTE (persistance P1-6) : le log borné des faits chronique-dignes,
 * accumulé au fil des ticks pour être SAUVÉ — une Veillée reprise doit retrouver sa
 * chronique. Le client tient sa propre copie d'affichage ; celle-ci n'existe que pour le
 * disque. Borné : la persistance ne grossit pas sans fin sur une longue saison.
 */
let chronicleLog: SimEvent[] = []
/** Le plafond de l'ANNÉE COURANTE seulement — une sécurité, plus une mémoire : les années
 *  révolues sont SCELLÉES en volumes (T5), elles ne comptent plus ici. */
const CHRONICLE_CAP = 400
/** LES ANNÉES RÉVOLUES, scellées (saison-sans-fin T5) — des textes, plus des faits. */
let volumes: ChronicleVolume[] = []
/** L'année dont `chronicleLog` porte les faits ; quand le monde la dépasse, on scelle. */
let tourOuvert = 1

/** Les noms des villages vivants — pour formater un volume au moment où on le scelle. */
function nomsDesVillages(state: SimState): Record<number, string> {
  return Object.fromEntries(state.villages.map((v) => [v.id, v.name]))
}

/**
 * LE SCELLEMENT — au tour de l'année (décision d'Alexis 2026-08-21 : la chronique de l'hiver
 * écoulé se scelle). Les faits des années strictement avant `tour` deviennent des volumes
 * formatés, relisibles à jamais ; `chronicleLog` ne garde que l'année courante. Idempotent :
 * rappelé sans nouvelle année, il ne scelle rien. Même fonction pure que l'affichage client
 * (`volumesDeChronique`) — l'écrivain unique : l'hôte et l'écran ne peuvent pas raconter deux
 * années différentes.
 */
function scellerLesAnneesRevolues(state: SimState, tour: number): void {
  if (tour <= tourOuvert && volumes.length > 0) return
  const r = scellerLaChronique(chronicleLog, state.calendarScale, state.jourDeDepart, nomsDesVillages(state), tour)
  if (r.volumes.length > 0) volumes.push(...r.volumes)
  chronicleLog = r.courant
  tourOuvert = tour
}
/** Garde anti-double-boot : le chargement du disque est ASYNCHRONE (IndexedDB). */
let booting = false
/** Une écriture disque à la fois — les sérialisations lourdes ne se chevauchent pas. */
let saving = false
/**
 * CE QUE LE DISQUE PORTE — un seul objet, parce que c'est un seul fait.
 *
 * L'hôte tenait ça en DEUX variables (`carteEcrite` et la base des nœuds) qui devaient bouger
 * ensemble et ne le faisaient pas : une première écriture refusée puis une seconde acceptée
 * mettait au disque une carte et un diff irrecollables, et la Veillée se rouvrait NEUVE sans
 * un mot. La politique vit maintenant dans `/sim` (`creerCoffre`), où elle est testée pour de
 * vrai — `persistence.test.ts` l'éprouvait jusqu'ici sur un sosie écrit à la main.
 */
let coffre: Coffre = creerCoffre()
/** Une sauvegarde a été demandée pendant qu'une autre était en vol : on la rejoue à la fin,
 *  avec l'état le plus frais. Sans ça, la SORTIE (`pause`) qui tombe pile sur un autosave était
 *  silencieusement perdue — le trou du garde `saving` tombait exactement sur le cas à protéger. */
let pendingPersist = false
/**
 * LE TICK DÉJÀ SUR LE DISQUE, et QUAND il y est allé. Réécrire ce tick-là ne pose pas un
 * octet de neuf : le monde n'a pas bougé depuis.
 *
 * Ce n'est pas un cas de bord, c'est le chemin de SORTIE. Le menu pause envoie `pause` en
 * s'ouvrant — donc une écriture — ET arrête le ticker ; le clic « retour au menu principal » en
 * renvoie un second sur un monde figé depuis. On sérialisait ~60k nœuds pour reposer les mêmes
 * octets, et le joueur qui sort attendait ça (MESURÉ le 2026-07-29 : ~0,9 s sur trois tirs,
 * l'essentiel de son attente avant que l'écran bouge).
 */
let tickEcrit = -1
let dernierSaveAt = 0
/** Cadence de l'autosave de sécurité (ms d'horloge murale, concern d'hôte). */
const AUTOSAVE_MS = 30_000
let autosaveTimer: ReturnType<typeof setInterval> | undefined
let playerInput: Pick<MoveInput, 'dx' | 'dy' | 'sprint' | 'sneak' | 'block'> = { dx: 0, dy: 0 }
/** `seq` du dernier input reçu — l'hôte l'applique chaque tick et l'acquitte dans le snapshot. */
let lastProcessedInput = 0
/** Une action au plus par tick (spec village R1) — la dernière reçue gagne. */
let pendingAction: PlayerAction | undefined
/**
 * Ombre du stock par nœud (dernier envoyé) — état du TRANSPORT, pas du /sim : elle permet
 * de ne transmettre que les nœuds dont le stock a changé, sans cloner les ~125 000 nœuds à
 * chaque tick. Amorcée à l'envoi de la liste complète (`ready`).
 *
 * Le DIFF lui-même vient de `/sim` (`node-shadow.ts`). Il vivait ici en COPIE de celui du
 * serveur — identiques à un bloc près, et ce bloc-là faisait déjà diverger le solo du multi
 * (le serveur réconciliait les nœuds détruits par la Cendre, pas nous). Une seule
 * implémentation, testée, pour les deux hôtes.
 *
 * Ce que ça coûtait ICI, dans le mode réellement joué — MESURÉ sur le monde de la Veillée
 * (125 661 nœuds) : **9,6 ms de CPU par tick, 19 % du budget de 50 ms et TROIS FOIS le prix
 * de `step()` lui-même**, vingt fois par seconde, pour émettre zéro delta. Le tableau typé
 * ramène ça à ~1,0 ms (×9) et l'empreinte de 3,6 Mio à 0,5 Mio.
 */
let nodeStockShadow: NodeShadow = createNodeShadow([])

function tick(): void {
  if (!sim) return
  const t0 = SONDE_PERF ? performance.now() : 0
  const inputs: MoveInput[] = [
    { entityId: playerId, ...playerInput, ...(pendingAction ? { action: pendingAction } : {}) },
  ]
  pendingAction = undefined
  step(sim, inputs)
  // Le partage step/hôte se prend ICI : après `step` (donc /sim), avant la construction du
  // snapshot et le postMessage (donc nous). Un pic qui vient du filtrage ou du clone
  // structuré n'est pas le même chantier qu'un pic qui vient de la simulation.
  const tStep = SONDE_PERF ? performance.now() : 0
  const events = drainEvents(sim)
  // On RETIENT au passage les faits chronique-dignes, pour la sauvegarde : c'est ici
  // qu'ils transitent, une seule fois. Le client, lui, les reçoit dans le snapshot et
  // tient sa propre copie d'affichage — les deux filtrent sur la MÊME liste (/sim).
  for (const e of events) if (CHRONICLE_EVENT_TYPES.has(e.type)) chronicleLog.push(e)
  if (chronicleLog.length > CHRONICLE_CAP) chronicleLog.splice(0, chronicleLog.length - CHRONICLE_CAP)
  // AU TOUR DE L'ANNÉE, on scelle (T5) : une division par tick, et un formatage par an.
  const tour = tourForDay(jourDeSaison(sim))
  if (tour > tourOuvert) scellerLesAnneesRevolues(sim, tour)
  // LA ZONE D'INTÉRÊT — le même filtre qu'en multi (voir `/sim/interest.ts`). En solo il n'y a
  // qu'un client, mais il est AU BOUT D'UN postMessage : tout ce qu'on n'envoie pas est un
  // clone structuré qu'on ne paie pas. Et surtout, l'appliquer des deux côtés garde
  // l'invariant n°7 — une simulation, pas deux jeux : le solo et le multi voient la même chose.
  const moi = sim.entities.find((e) => e.id === playerId)
  const corps = {
    type: 'snapshot' as const,
    tick: sim.tick,
    lastProcessedInput,
    time: getGameTime(sim),
    entities: sim.entities,
    structures: sim.structures,
    villages: sim.villages,
    functions: sim.functions,
    nodeDeltas: collectNodeDeltas(sim.nodes, nodeStockShadow),
    npcs: sim.npcs,
    monsters: sim.monsters,
    corpses: sim.corpses,
    reveils: sim.reveils,
    refugeeGroups: sim.refugeeGroups,
    // LE SANG, LE VENT, LES PILES (spec chasse C9/C17/C18). Trois listes bornées
    // (BLOOD_CAP, un vecteur, des piles qui périssent) : le snapshot ne grossit pas.
    blood: sim.blood,
    wind: sim.wind,
    groundItems: sim.groundItems,
    // LE FRONT MÉTÉO (spec meteo.md) : le record d'élection, cinq champs — le client en
    // recalcule la bande, le gradient et jusqu'aux éclairs. Rien d'autre ne transite.
    meteo: sim.meteo ?? null,
    events,
  }
  post(moi ? filtreParInteret(corps, moi) : corps)
  if (SONDE_PERF) releverPerf(sim.tick, t0, tStep)
}

/**
 * UN ÉCHANTILLON PAR SECONDE DE JEU (sonde de dev). On accumule la somme pour la moyenne et
 * on RETIENT le pire tick de la fenêtre avec sa part de `step` — puis on remet à zéro. Le
 * coût de la sonde elle-même est de deux `performance.now()` par tick, et rien en prod.
 */
function releverPerf(tickNo: number, t0: number, tStep: number): void {
  const fin = performance.now()
  const total = fin - t0
  perfN += 1
  perfSomme += total
  if (total > perfPic) {
    perfPic = total
    perfPicStep = tStep - t0
    perfPicTick = tickNo
  }
  // LE TROU. On le prend entre DÉPARTS de tick : ce qui s'est glissé entre les deux (autosave,
  // GC, n'importe quoi d'autre) est compté, alors que le coût du tick seul le manquerait.
  if (perfDernierDepart >= 0) {
    const ecart = t0 - perfDernierDepart
    if (ecart > perfPicEcart) perfPicEcart = ecart
  }
  perfDernierDepart = t0
  if (perfN < PERF_FENETRE) return
  post({
    type: 'perf',
    ticks: perfN,
    moyenneMs: perfSomme / perfN,
    picMs: perfPic,
    picStepMs: perfPicStep,
    picTick: perfPicTick,
    picEcartMs: perfPicEcart,
    serialisationMs: perfSerialisationMs,
    sauvegardeOctets: perfOctets,
  })
  perfN = 0
  perfSomme = 0
  perfPic = 0
  perfPicStep = 0
  perfPicTick = 0
  perfPicEcart = 0
}

/**
 * ÉCRIT la Veillée sur le disque (autosave + sortie). Sérialiser tout l'état (dont ~60k
 * nœuds) est lourd : on n'en lance jamais deux à la fois (`saving`), et jamais avant que le
 * monde existe. C'est une opération d'HÔTE — horloge murale comprise (interdite à /sim).
 */
async function persist(): Promise<void> {
  // `monde` est posé avant le boot (voir `veillee_init`) : pas de sim sans lui. On l'exige
  // quand même — écrire une partie dans la case d'un autre monde ne se rattrape pas.
  if (!sim || !monde) return
  // DÉJÀ ÉCRIT, à ce tick près : rien à sérialiser. Mais on RÉPOND quand même — c'est ce `saved`
  // que `WorldScene` attend pour quitter, et se taire ici le condamnerait aux 3 s de son
  // garde-fou. On rend la date de l'écriture RÉELLE, pas l'instant présent : l'indicateur du HUD
  // date la sauvegarde, il ne doit pas prétendre qu'on vient d'écrire.
  if (sim.tick === tickEcrit) {
    post({ type: 'saved', at: dernierSaveAt, ok: true })
    return
  }
  // Une écriture est déjà en vol : on ne la double pas, mais on RETIENT la demande — sinon un
  // `pause` (la vraie prise de sortie) qui coïncide avec un autosave serait perdu, alors même
  // que le joueur a quitté proprement. On rejouera avec l'état frais dès la fin de l'écriture.
  if (saving) {
    pendingPersist = true
    return
  }
  saving = true
  try {
    // LA SÉRIALISATION EST SYNCHRONE, ET ELLE EST LE SUJET. Tant qu'elle tourne, ce Worker ne
    // tique pas : le monde s'arrête. On la chronomètre à part de l'écriture disque (qui, elle,
    // rend la main) pour savoir lequel des deux gèle la Veillée. Sonde de dev, coût nul sinon.
    const s0 = SONDE_PERF ? performance.now() : 0
    // LE TICK QU'ON EMPORTE, relevé AVANT l'attente disque : le ticker peut repartir pendant
    // qu'IndexedDB écrit, et créditer le disque d'un tick qu'il ne porte pas rendrait la garde
    // ci-dessus menteuse — elle sauterait une vraie sauvegarde.
    const tickSerialise = sim.tick
    // TOUT CE QUI SE SÉRIALISE PASSE PAR ICI — carte comprise. La sonde n'encadrait que la
    // partie, si bien qu'une naissance (~60 Mo, le vrai gel) se mesurait à côté de la plaque.
    const ecriture = coffre.prochaine(sim)
    const texte = ecriture.partie
    if (SONDE_PERF) {
      perfSerialisationMs = performance.now() - s0
      // `length` compte des unités UTF-16, pas des octets : on rend des OCTETS, sinon la
      // sonde mentirait dès qu'un nom de village porte un accent.
      const enc = new TextEncoder()
      perfOctets = enc.encode(texte).length + (ecriture.quoi === 'naissance' ? enc.encode(ecriture.carte).length : 0)
    }
    const record = { sim: texte, playerId, chronicle: chronicleLog, volumes, savedAt: Date.now() }
    // LA MÉTA DE L'ÉCRAN DES MONDES — écrite dans la MÊME transaction que la partie (voir
    // `persistence-store.ts`) : le jour annoncé au menu est toujours celui de la sauvegarde
    // qu'on rouvrira, jamais celui d'avant. Elle se calcule ici parce qu'elle demande le
    // `SimState` vivant, que le menu, lui, n'ouvrira pas.
    const meta: SlotMeta = {
      nom: mondeNom,
      seed: sim.seed,
      seasonDay: getGameTime(sim).seasonDay,
      savedAt: record.savedAt,
      // Une fondation ne se réécrit pas : à la reprise, `boot()` a relu celle du disque.
      createdAt: mondeCreeA || record.savedAt,
    }
    // LA CARTE, UNE SEULE FOIS — et ATOMIQUEMENT avec la partie. Elle pèse 86,9 % de la
    // sauvegarde et ne change jamais (garde : `carte-immuable.test.ts`) : la réécrire deux fois
    // par minute était le gel. Mais la poser dans SA transaction ouvrait une fenêtre où le
    // disque portait la carte d'un monde et la partie d'un autre — les deux clés partent donc
    // ensemble ou pas du tout. Si l'écriture échoue, le coffre ne s'engage pas et le prochain
    // autosave redemandera une naissance : une partie sans sa carte ne se reprend pas.
    if (ecriture.quoi === 'partie') {
      await saveSlot(monde.slot, record, meta)
    } else {
      await saveCarteEtSlot(monde.slot, ecriture.carte, record, meta)
    }
    // ENGAGÉ SEULEMENT MAINTENANT : tant que l'`await` n'a pas rendu la main, le disque ne
    // porte rien, et la base ne doit rien prétendre.
    coffre.reussi()
    // ON LE DIT. Une sauvegarde muette laisse le joueur dans le doute — et ce doute coûte
    // cher dans un jeu où l'on peut perdre une heure de veillée.
    tickEcrit = tickSerialise
    dernierSaveAt = Date.now()
    post({ type: 'saved', at: dernierSaveAt, ok: true })
  } catch {
    // Un disque plein ou refusé ne doit pas tuer la partie : on perd la sauvegarde, pas la
    // session. (Le prochain autosave retentera.) Mais on ne le TAIT PAS : un échec silencieux
    // laisse croire au salut, ce qui est bien pire que pas d'indicateur du tout.
    //
    // ET ON REND LA BASE AVEC : rien n'est parti au disque, donc rien n'est engagé. Sans ça,
    // le prochain essai diffait contre un état que le disque ne portait pas.
    coffre.echoue()
    post({ type: 'saved', at: Date.now(), ok: false })
  } finally {
    saving = false
    // Une demande est tombée pendant l'écriture (typiquement la sortie) : on la rejoue MAINTENANT
    // avec l'état le plus récent. Tant que l'onglet vit, la sortie est ainsi sauvée sans attendre
    // les 30 s de l'autosave. (Sur une vraie fermeture d'onglet, IndexedDB reste best-effort.)
    if (pendingPersist) {
      pendingPersist = false
      void persist()
    }
  }
}

/**
 * NAÎTRE OU REPRENDRE (persistance P1-6). On tente d'abord de RELIRE la Veillée sauvée : si
 * une case existe et se relit, on reprend CE monde (la reprise est la promesse de GATE 1 —
 * « le même monde, 5 sessions »). Sinon — première partie, ou sauvegarde d'une version
 * incompatible/corrompue — on en GÉNÈRE une neuve. Une sauvegarde illisible ne bloque
 * jamais : on repart à neuf plutôt que d'échouer au seuil.
 *
 * Le scénario appartient à l'hôte (veillee.ts) : le client ne choisit rien. Chaque passe de
 * génération est annoncée au fil de l'eau (barre de chargement) ; une reprise, elle, est
 * quasi instantanée — on annonce alors une barre pleine d'un coup.
 */
async function boot(slot: number, seed: number, nom: string): Promise<void> {
  let spawn: { x: number; y: number } | undefined
  let resumed = false
  try {
    const rec = await loadSlot(slot)
    if (rec) {
      // LA CARTE VIENT DE SA PROPRE CASE (elle ne bouge pas, on ne la réécrit pas — voir
      // `persistence-store.ts`), et on RETOMBE sur l'ancien format si le recollage échoue.
      //
      // Ce repli n'est pas de la prudence de principe, il ferme une PERTE DE PARTIE réelle :
      // `persist()` écrit en DEUX transactions (la carte, puis la partie). Entre les deux, le
      // disque porte une carte neuve et une partie d'AVANT la coupe. Fermer l'onglet pile là —
      // c'est-à-dire pendant les ~790 ms de la toute première sauvegarde au format neuf —
      // laissait `deserializePartie` jeter, et le joueur repartait sur un monde neuf alors que
      // sa Veillée était parfaitement lisible par `deserializeSim`. La promesse est « une
      // reprise ne se perd pas pour un changement de rangement » : elle se tient ici.
      let carteEnMain = false
      let state: SimState | undefined
      const carteTexte = await loadCarte(slot)
      if (carteTexte) {
        try {
          const naissance = deserializeCarte(carteTexte)
          state = deserializePartie(rec.sim, naissance)
          // LA BASE RESTE CELLE DE LA NAISSANCE, pas celle qu'on vient de relire : les
          // prochains diffs se comparent au même point de départ que ceux d'avant la reprise.
          // LA BASE RESTE CELLE DE LA NAISSANCE relue : les prochains diffs se comparent au
          // même point de départ que ceux d'avant la reprise.
          coffre = creerCoffre(baseDepuisNoeuds(naissance.nodes))
          carteEnMain = true
        } catch {
          state = undefined // on tente l'ancien format avant d'abandonner le monde
        }
      }
      if (!state) {
        state = deserializeSim(rec.sim) // JETTE pour de bon → on tombe dans le catch
        coffre = creerCoffre() // pas d'enregistrement de naissance : le prochain `persist` en pose un
      }
      sim = state
      if (!carteEnMain) coffre = creerCoffre()
      playerId = rec.playerId
      chronicleLog = rec.chronicle ?? []
      volumes = rec.volumes ?? []
      // Une sauvegarde d'AVANT le scellement porte tout son passé à plat dans `chronicle` : on
      // scelle au boot ce qui est révolu — la migration est le mécanisme lui-même.
      tourOuvert = 1
      scellerLesAnneesRevolues(state, tourForDay(jourDeSaison(state)))
      const me = state.entities.find((e) => e.id === playerId)
      if (me) spawn = { x: me.x, y: me.y }
      // LA DATE DE FONDATION SURVIT À LA REPRISE : sans ça, chaque sauvegarde ferait naître le
      // monde à l'instant — et l'écran des mondes dirait « commencée à l'instant » d'une vallée
      // vieille de trois jours. Sauvegarde d'avant les métas : sa date de sauvegarde fait foi.
      const metaDisque = await loadMeta(slot)
      // `|| Date.now()` en dernier recours : la fondation doit être un nombre STABLE et non nul,
      // parce qu'elle part au client comme identité de monde (voir `createdAt` dans `ready`) ET
      // en méta au prochain `persist()`. Une sauvegarde si vieille qu'elle n'a ni méta ni date
      // de sauvegarde naît donc aujourd'hui — plutôt que de porter deux dates différentes.
      mondeCreeA = metaDisque?.createdAt || rec.savedAt || Date.now()
      // LE NOM AUSSI SURVIT, et il vient du DISQUE, pas de la configuration d'hôte : rouvrir
      // une vallée nommée ne doit pas pouvoir la rebaptiser (ni l'effacer si le menu se tait).
      mondeNom = metaDisque?.nom ?? ''
      // LA SEED SEMÉE PERD FACE À CELLE DU MONDE SAUVÉ : on rouvre CETTE vallée-là, telle
      // qu'elle est au disque. `seed` ne sert qu'à en FONDER une (plus bas).
      resumed = true
    }
  } catch {
    // Sauvegarde absente, illisible ou d'une version incompatible : on repart à neuf.
    sim = undefined
    resumed = false
    coffre = creerCoffre()
  }

  if (!sim) {
    const world = createVeillee(seed, (phase) => {
      post({ type: 'progress', phase, done: LOAD_PHASES.indexOf(phase), total: LOAD_PHASES.length })
    })
    mondeCreeA = Date.now() // la fondation, horloge murale d'hôte — /sim n'en sait rien
    mondeNom = nom // le nom n'a de sens qu'ici : une vallée se nomme quand on la fonde
    sim = world.sim
    playerId = world.playerId
    spawn = world.spawn
    chronicleLog = []
    volumes = []
    tourOuvert = 1
    coffre = creerCoffre()
  } else if (resumed) {
    // Reprise : aucune passe de génération n'a tourné — on remplit la barre d'un coup pour
    // que le seuil de chargement se lève (il attend `worldReady`, posé au `ready`).
    post({ type: 'progress', phase: LOAD_PHASES[LOAD_PHASES.length - 1]!, done: LOAD_PHASES.length, total: LOAD_PHASES.length })
  }

  // Liste complète des nœuds envoyée UNE fois ; on amorce l'ombre pour que le premier tick
  // n'émette pas 125k deltas redondants.
  nodeStockShadow = createNodeShadow(sim.nodes)
  seedNodeShadow(nodeStockShadow, sim.nodes)
  post({
    type: 'ready',
    protocolVersion: PROTOCOL_VERSION,
    playerId,
    map: sim.map,
    seed: sim.seed,
    nodes: sim.nodes,
    grounds: sim.grounds,
    // L'échelle du MONDE, pas la constante : à la reprise d'une sauvegarde faite avec un autre
    // `VEILLEE_SEASON_CYCLES`, la sim garde son échelle figée — le client doit recevoir CELLE-LÀ
    // (sinon la chronique daterait ses lignes avec la mauvaise échelle). Neuf = les deux égales.
    calendarScale: sim.calendarScale,
    jourDeDepart: sim.jourDeDepart,
    // Le spawn EST la position de l'avatar : à la reprise, on relit celle du /sim sauvé
    // (là où l'on s'est arrêté), pas le point de fondation. Repli sur (0,0)-évité : un
    // monde neuf a toujours son `world.spawn` ; une reprise a toujours son entité.
    playerSpawn: spawn ?? { x: sim.map.width / 2, y: sim.map.height / 2 },
    // LA DATE DE FONDATION — avec la seed, elle NOMME cette vallée-ci. Le client en estampille
    // son brouillard : sans elle, un monde régénéré (sauvegarde illisible) ou refondé dans la
    // même case rouvrait avec le savoir géographique du précédent. C'est la MÊME valeur que
    // celle qui part en méta au prochain `persist()` — sinon l'estampille ne se reconnaîtrait
    // pas à la reprise, et la carte se redécouvrirait pour rien.
    createdAt: mondeCreeA,
    // La chronique n'accompagne QUE la reprise (sur un monde neuf, le récit démarre vide).
    ...(resumed ? { chronicle: chronicleLog, ...(volumes.length > 0 ? { volumes } : {}) } : {}),
  })
  booting = false
  // L'autosave de sécurité tourne dès qu'un monde existe (la sortie, elle, sauve sur `pause`).
  if (autosaveTimer === undefined) autosaveTimer = setInterval(() => void persist(), AUTOSAVE_MS)
  // ON NE TIQUE PAS ENCORE : le client a ~3 s de montage (bake terrain, maillages, décor).
  // Tiquer maintenant ferait vivre le monde sans témoin, et ses snapshots — porteurs de flux
  // À USAGE UNIQUE (`drainEvents`, `collectNodeDeltas`) — tomberaient dans le vide. Le client
  // dit `resume` quand il est debout. (Un serveur LAN ignorera ce silence : son monde n'attend
  // personne, et le client jette de toute façon les snapshots reçus avant d'être monté.)
}

/** Handle de la boucle de tick — pause/reprise (et garde anti-double-init). */
let ticker: ReturnType<typeof setInterval> | undefined
/** DEV : accélération de la CADENCE (le tick reste fixe — on en joue plus par seconde). */
let speedFactor = 1

function startTicker(): void {
  if (ticker === undefined) ticker = setInterval(tick, 1000 / (BALANCE.TICK_RATE_HZ * speedFactor))
}

function stopTicker(): void {
  if (ticker !== undefined) {
    clearInterval(ticker)
    ticker = undefined
  }
}

// `VeilleeInit` n'est PAS du protocole de jeu (voir `mondes.ts`) : c'est la configuration
// d'hôte, l'équivalent de l'URL passée à `createColyseusHost`. On élargit donc le type du
// canal ici, à la frontière, plutôt que d'ajouter un champ solo au protocole partagé avec
// le serveur LAN — « une simulation, pas deux jeux » vaut aussi pour le protocole.
self.addEventListener('message', (event: MessageEvent<ClientToHost | VeilleeInit>) => {
  const msg = event.data
  if (msg.type === 'veillee_init') {
    // La configuration arrive AVANT le `join` (ordre garanti vers un même Worker), et une
    // seule fois : un Worker n'ouvre qu'un monde. On refuse net une case ou une seed hors
    // bornes — écrire dans une clé fantôme se découvrirait à la reprise, trop tard.
    if (!slotValide(msg.slot) || !seedValide(msg.seed)) {
      throw new Error(`sim-worker: monde impossible (case ${msg.slot}, seed ${msg.seed})`)
    }
    monde = { slot: msg.slot, seed: msg.seed, nom: nettoieNom(msg.nom ?? '') }
  } else if (msg.type === 'join') {
    if (sim || booting) return // déjà en jeu (ou en cours de boot async) : pas de second monde
    // ON JETTE ICI, PAS DANS `boot()` : `void boot()` avale sa rejection (le `onerror` du Worker
    // n'écoute que le synchrone), et le joueur resterait sur un écran de chargement muet. Levée
    // dans le handler, l'erreur remonte au client, qui a un écran fatal pour ça.
    if (!monde) throw new Error('sim-worker: « join » sans configuration d’hôte (« veillee_init »)')
    booting = true
    // …ET ON RATTRAPE L'ASYNCHRONE, qui n'était pas gardé. Le `try/catch` de `boot()` se
    // referme AVANT `createVeillee()` — laquelle jette pour de vrai sur une carte dégénérée
    // (« la vallée ne porte aucun emplacement viable ») — et avant le `post('ready')`. Un
    // `void` avale cette rejection : `booting` restait à `true`, tout second `join` était
    // ignoré, et le joueur restait devant la barre de chargement SANS AUCUN BOUTON (le menu
    // pause n'est même pas atteignable : `UIScene.update` sort tant que `worldReady` manque).
    // On la rend SYNCHRONE dans un tour de boucle vide : le `onerror` du Worker la voit
    // alors, et le client a un écran fatal pour ça (`host-connection.ts`).
    boot(monde.slot, monde.seed, monde.nom).catch((e: unknown) => {
      booting = false
      setTimeout(() => {
        throw e instanceof Error ? e : new Error(`sim-worker: boot impossible (${String(e)})`)
      }, 0)
    })
  } else if (msg.type === 'input') {
    playerInput = { dx: msg.dx, dy: msg.dy, sprint: msg.sprint, sneak: msg.sneak, block: msg.block }
    lastProcessedInput = msg.seq
  } else if (msg.type === 'action') {
    pendingAction = msg.action
  } else if (msg.type === 'chat') {
    // SOLO : personne d'autre à portée. L'émetteur voit son propre message par ÉCHO
    // LOCAL (WorldScene, à l'envoi) — le worker n'a donc rien à renvoyer.
  } else if (msg.type === 'pause') {
    stopTicker()
    // LA SORTIE (onglet caché) est LE moment de sauver : c'est là qu'on quitte, et le
    // navigateur peut ne plus jamais nous rendre la main. L'autosave périodique n'est que
    // le filet ; ceci est la vraie prise.
    void persist()
  } else if (msg.type === 'resume') {
    if (sim) startTicker()
  } else if (msg.type === 'debug_speed') {
    // Hors dev, la sim n'est pas armée en debug : accélérer la cadence resterait
    // sans effet de triche, mais on refuse quand même — l'hôte de prod n'a pas
    // à obéir à un client sur son horloge.
    if (!import.meta.env.DEV) return
    speedFactor = Math.min(16, Math.max(1, msg.factor))
    if (ticker !== undefined) {
      stopTicker() // relancer l'intervalle : c'est sa PÉRIODE qui change
      startTicker()
    }
  }
})
