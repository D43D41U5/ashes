/**
 * LE MOTEUR AUDIO — possède l'AudioContext, un gain maître, le mute. Client SEUL (pas /sim :
 * le son n'est pas de la simulation). Créé PARESSEUSEMENT au premier geste (les navigateurs
 * bloquent l'audio sans interaction), et le mute se retient d'une session à l'autre.
 */
import { buildSound, type SoundSpec } from './sound'
import type { Piste } from './musique'
import { placer, type Placement } from './spatial'

const MUTE_KEY = 'braises.audio.muted'
const VOLUME_KEY = 'braises.audio.volume'
const MASTER_GAIN = 0.6 // le plafond global : le son reste un DÉCOR, jamais au premier plan

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

export class SoundEngine {
  private ctx: AudioContext | undefined
  private master: GainNode | undefined
  private muted: boolean
  /** Le curseur MAÎTRE, 0..1 (persisté) — multiplie le plafond `MASTER_GAIN`. */
  private volume: number

  /** Faux = moteur JETABLE : ni lecture ni écriture des réglages du joueur (voir plus bas). */
  private readonly persist: boolean

  /**
   * `persist: false` pour tout moteur qui n'est PAS celui de la partie — le banc d'écoute,
   * un test, un aperçu. Sans ça, un instrument de dev écrit dans les réglages du JEU : le
   * curseur du banc et celui du menu pause partagent `braises.audio.volume` sur la même
   * origine (localhost:3000 sert les deux pages), donc baisser le volume en calant un son
   * baissait le volume de la Veillée — et le silence survivait au rechargement, sans que
   * rien à l'écran du jeu ne dise pourquoi.
   */
  constructor({ persist = true }: { persist?: boolean } = {}) {
    this.persist = persist
    this.muted = persist && readStorage(MUTE_KEY) === '1'
    const raw = persist ? readStorage(VOLUME_KEY) : null
    const v = Number(raw)
    this.volume = raw !== null && Number.isFinite(v) ? clamp01(v) : 1
  }

  /** Le gain effectif = 0 si muet, sinon le plafond × le curseur. Une seule source. */
  private applyGain(): void {
    if (this.master) this.master.gain.value = this.muted ? 0 : MASTER_GAIN * this.volume
  }

  /** À appeler au premier geste utilisateur (clic/touche) : crée/réveille le contexte. */
  resume(): void {
    if (!this.ctx) {
      const Ctor =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return // navigateur sans WebAudio : le jeu tourne muet, sans planter
      this.ctx = new Ctor()
      this.master = this.ctx.createGain()
      this.applyGain()
      this.master.connect(this.ctx.destination)
    }
    void this.ctx.resume()
  }

  /**
   * OÙ SE TIENT L'AUDITEUR, en tuiles. C'est l'AVATAR, pas la caméra : `startFollow` est
   * lissée (0,16) et garde un décalage volontaire à la visée — panoramiquer sur elle ferait
   * trembler le côté d'un son à chaque pas. Posé par `WorldScene` ; `null` tant qu'aucune
   * partie ne tourne (le banc d'écoute, le menu), et alors rien ne se spatialise.
   */
  private ecoute: { x: number; y: number } | null = null

  setEcoute(x: number, y: number): void {
    this.ecoute = { x, y }
  }

  /**
   * Joue un son (ou rien si muet / contexte pas encore réveillé).
   *
   * `at` : le LIEU du fait, en tuiles. Fourni, le son se panoramique et s'atténue par
   * `placer` — et **ne se joue pas du tout** au-delà de la portée : c'est là le vrai
   * correctif, un fait à trente tuiles n'a rien à dire. Omis, le son sonne au centre et
   * plein, comme avant : c'est le régime des ANNONCES (la nuit, la saison, l'acte).
   */
  play(spec: SoundSpec | null, delayS = 0, at?: { x: number; y: number }): void {
    if (!spec || this.muted || !this.ctx || !this.master || this.ctx.state !== 'running') return
    let place: Placement | undefined
    if (at) {
      // Pas d'auditeur alors qu'on nous donne un lieu : on se TAIT. Jouer au centre et plein
      // serait précisément la dégradation muette que ce chantier corrige — et un jeu qui
      // devient silencieux se remarque, là où un jeu subtilement mal placé ne se remarque pas.
      if (!this.ecoute) return
      // La PUISSANCE du son commande jusqu'où il porte (`SoundSpec.portee`) : c'est le son
      // qui la connaît, pas l'auditeur.
      const p = placer(at.x - this.ecoute.x, at.y - this.ecoute.y, spec.portee)
      if (!p) return // hors de portée : le silence est la bonne réponse
      place = p
    }
    // `delayS` se planifie sur l'horloge WebAudio (la seule juste pour le son) — jamais un
    // setTimeout : les notes d'un pépiement restent serrées même si le thread principal souffle.
    buildSound(this.ctx, this.master, spec, this.ctx.currentTime + delayS, place)
  }

  /**
   * OUVRE UNE BANDE SONORE LONGUE (la musique) sous le gain maître — voir `musique.ts`.
   *
   * ⚠ ELLE SE STREAME, ELLE NE SE DÉCODE PAS. `decodeAudioData` rendrait ~50 Mo de PCM f32
   * pour les 2 min 16 s du thème, et calerait le fil pendant le décodage. Un `<audio>` branché
   * par `createMediaElementSource` lit au fil de l'eau : mémoire constante, zéro pause.
   *
   * Rend `null` tant que l'audio dort (pas encore de geste utilisateur, ou navigateur sans
   * WebAudio) — l'appelant repassera. Même discipline que `play()` : on se tait, on ne plante pas.
   *
   * LE MUTE ET LE CURSEUR N'ONT RIEN À FAIRE ICI : la piste passe par `master`, qui les porte
   * déjà. Une seule source pour le gain effectif (voir `applyGain`).
   */
  piste(url: string): Piste | null {
    const ctx = this.ctx
    const master = this.master
    if (!ctx || !master || ctx.state !== 'running') return null
    const el = new Audio(url)
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    const gain = ctx.createGain()
    gain.gain.value = 0
    ctx.createMediaElementSource(el).connect(gain)
    gain.connect(master)
    /** Le JETON du geste courant. Toute demande postérieure (coupure, arrêt) l'incrémente, et
     *  la rampe d'entrée différée renonce alors : sans lui, une coupure arrivée pendant la mise
     *  en route de la bande serait DÉFAITE par le fondu d'entrée qui la suivrait. */
    let jeton = 0
    const rampeVers = (v: number, secondes: number): void => {
      const t = ctx.currentTime
      // On REPART DE LA VALEUR COURANTE : sans ce `setValueAtTime`, une rampe qui en
      // interrompt une autre repartirait du dernier point PLANIFIÉ, et une coupure lancée
      // en plein fondu d'entrée sauterait d'abord au niveau plein.
      gain.gain.cancelScheduledValues(t)
      gain.gain.setValueAtTime(gain.gain.value, t)
      gain.gain.linearRampToValueAtTime(v, t + secondes)
    }
    return {
      jouer(niveau: number, fonduS: number): void {
        const mien = ++jeton
        el.currentTime = 0
        gain.gain.cancelScheduledValues(ctx.currentTime)
        gain.gain.value = 0
        // ⚠ LA RAMPE ATTEND QUE ÇA ROULE. La promesse de `play()` se résout quand la lecture a
        // RÉELLEMENT commencé — mesuré au navigateur, deux à trois secondes au premier passage,
        // le temps que la bande se mette en route. Rampée à côté, l'entrée se jouait sur du
        // silence et la musique arrivait d'un bloc. Voir `Piste.jouer`.
        void el
          .play()
          ?.then(() => {
            if (jeton === mien) rampeVers(niveau, fonduS)
          })
          .catch(() => {
            /* lecture refusée (geste pas encore accordé) : le thème repassera */
          })
      },
      arreter(): void {
        jeton += 1
        el.pause()
        el.currentTime = 0
        gain.gain.cancelScheduledValues(ctx.currentTime)
        gain.gain.value = 0
      },
      rampe(v: number, secondes: number): void {
        jeton += 1
        rampeVers(v, secondes)
      },
      resteS(): number {
        return Number.isFinite(el.duration) ? el.duration - el.currentTime : Infinity
      },
    }
  }

  /** Bascule le mute (persisté). Rend le nouvel état. */
  toggleMute(): boolean {
    this.muted = !this.muted
    this.applyGain()
    if (this.persist) writeStorage(MUTE_KEY, this.muted ? '1' : '0')
    return this.muted
  }

  /** Règle le curseur maître (0..1, persisté). Rend la valeur clampée. */
  setVolume(v: number): number {
    this.volume = clamp01(v)
    this.applyGain()
    if (this.persist) writeStorage(VOLUME_KEY, String(this.volume))
    return this.volume
  }

  getVolume(): number {
    return this.volume
  }

  isMuted(): boolean {
    return this.muted
  }

  /**
   * Le contexte est-il RÉELLEMENT en train de jouer ? `play()` abandonne en silence tant que
   * le navigateur n'a pas accordé l'audio (pas encore de geste utilisateur) — un silence
   * qu'on ne peut distinguer d'un son raté. Le banc d'écoute l'affiche : on ne fait pas
   * douter quelqu'un de ses oreilles.
   */
  isReady(): boolean {
    return this.ctx?.state === 'running'
  }
}

/**
 * LES RÉGLAGES DE SON, HORS PARTIE — l'écran des Options du menu principal doit pouvoir les
 * lire et les écrire alors qu'aucun `SoundEngine` ne vit (rien ne joue encore). Les mêmes clés,
 * donc : le curseur du menu et celui de la partie règlent la MÊME chose, et un moteur créé plus
 * tard relit exactement ce qui a été posé ici (voir le constructeur).
 */
export function lireReglagesSon(): { volume: number; muted: boolean } {
  const brut = readStorage(VOLUME_KEY)
  const v = Number(brut)
  return {
    volume: brut !== null && Number.isFinite(v) ? clamp01(v) : 1,
    muted: readStorage(MUTE_KEY) === '1',
  }
}

/** Pose le volume persisté (0..1). Sans effet sur un moteur en vol : celui-là passe par le registre. */
export function ecrireVolume(v: number): void {
  writeStorage(VOLUME_KEY, String(clamp01(v)))
}

/** Pose la sourdine persistée. */
export function ecrireMute(muted: boolean): void {
  writeStorage(MUTE_KEY, muted ? '1' : '0')
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* stockage refusé : le réglage vaut pour la session */
  }
}
