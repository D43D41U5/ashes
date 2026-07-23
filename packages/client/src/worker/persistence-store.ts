/**
 * LE COFFRE DE LA VEILLÉE (persistance P1-6) — le disque de l'hôte.
 *
 * IndexedDB, côté Worker : /sim ne connaît ni le disque ni l'horloge (invariant §2),
 * c'est donc l'HÔTE qui écrit et relit. Le contenu jouable est la chaîne `serializeSim`
 * (versionnée dans /sim) ; on l'enveloppe ici avec le peu de métadonnées d'hôte qu'une
 * reprise exige — QUI est l'avatar (`playerId`), le récit déjà vécu (`chronicle`), et
 * quand la partie a été quittée (horloge murale, pour un futur écran de slots).
 *
 * GATE 1 = un seul monde, une seule case (`slot0`) : on retrouve SA Veillée d'une session
 * à l'autre. Le multi-slot viendra avec son écran ; la forme du store le permet déjà (une
 * clé par case), on ne l'expose simplement pas encore.
 */
import type { SimEvent } from '@braises/sim'

const DB_NAME = 'braises'
const STORE = 'veillee'
/** L'unique case pour l'instant (GATE 1 : un monde, une reprise). */
const SLOT0 = 'slot0'

/** Ce que l'hôte écrit sur le disque — la sim sérialisée + ce que /sim ne sait pas. */
export interface SaveRecord {
  /** L'état de jeu, chaîne `serializeSim` (enveloppe versionnée de /sim). */
  sim: string
  /** QUELLE entité est l'avatar — sans elle, on reprendrait le monde sans savoir qui l'on est. */
  playerId: number
  /** Le récit déjà vécu (log borné des faits chronique-dignes) : la chronique survit à la reprise. */
  chronicle: SimEvent[]
  /** Horloge MURALE de la dernière sauvegarde (métadonnée d'hôte, pas de /sim). */
  savedAt: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB indisponible'))
  })
}

/** Relit la Veillée sauvée (case 0), ou `null` s'il n'y en a pas. */
export async function loadSlot(): Promise<SaveRecord | null> {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(SLOT0)
      req.onsuccess = () => resolve((req.result as SaveRecord | undefined) ?? null)
      req.onerror = () => reject(req.error ?? new Error('lecture du slot échouée'))
    })
  } finally {
    db.close()
  }
}

/**
 * EFFACE la Veillée sauvée (case 0) — « nouvelle partie ». Utile aussi après un changement
 * de calibration (`VEILLEE_SEASON_CYCLES`) : une sauvegarde fige son `calendarScale`, donc
 * le nouveau rythme ne s'applique qu'à une partie NEUVE. Ne jette pas si la case est vide.
 */
export async function clearSlot(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(SLOT0)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('effacement du slot échoué'))
    })
  } finally {
    db.close()
  }
}

/** Écrit (remplace) la Veillée dans la case 0. */
export async function saveSlot(record: SaveRecord): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(record, SLOT0)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('écriture du slot échouée'))
    })
  } finally {
    db.close()
  }
}
