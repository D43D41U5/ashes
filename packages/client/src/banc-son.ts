/**
 * LE BANC D'ÉCOUTE — l'instrument qui rend les 51 silences tranchables en une passe.
 *
 * POURQUOI IL EXISTE. `sound.ts` porte en en-tête « ESTHÉTIQUE À VALIDER — je ne peux pas
 * ENTENDRE le résultat », et l'audit de GATE 1 classe le son « oreilles d'Alexis ». Le seul
 * moyen d'entendre `village_fell` dans le jeu est de perdre un village : quarante minutes pour
 * une demi-seconde de son. Trancher 61 faits à ce prix est impossible — d'où ce banc, qui les
 * joue tous à la demande, côte à côte, hors de la partie.
 *
 * CE QU'IL EST, ET CE QU'IL N'EST PAS. Il ne SIMULE rien : il appelle le VRAI routage
 * (`soundForEvent`) et le VRAI moteur (`SoundEngine`), sur l'inventaire qui sert aussi de garde
 * au test. Ce qu'on entend ici est exactement ce que le jeu joue — même code, même gain maître,
 * même plafond. Il ne décide rien non plus : les `reco` affichées sont des propositions.
 *
 * TROIS MOMENTS, dans cet ordre :
 *   1. CALER L'OREILLE — le registre actuel (les 10 qui sonnent), en série.
 *   2. TRANCHER — famille par famille, chaque fait dit ce qu'il raconte ; VOIX ou MUET.
 *      Les verdicts tiennent dans le navigateur (une passe interrompue se retrouve) et
 *      s'exportent en un bloc de texte.
 *   3. FAÇONNER — l'atelier : une forme, une hauteur, une durée, un gain. Le son se joue à
 *      chaque réglage et la ligne de `sound.ts` s'écrit toute seule, prête à coller.
 *
 * Page de DEV, hors du jeu et hors du build de prod (Vite ne bâtit que `index.html`) : elle ne
 * touche ni la sim, ni le client, ni le protocole. Servie par `pnpm dev` → /banc-son.html
 */
import type { SimEvent } from '@braises/sim'
import { SoundEngine } from './audio/engine'
import { FAMILLES, INVENTAIRE, SONORES, faitsDeFamille, type Voix } from './audio/inventaire'
import { soundForEvent, type SoundSpec, type Waveform } from './audio/sound'
import { ensureGameFont, GAME_FONT } from './scenes/ui/game-font'
import { HEX } from './scenes/ui/palette'

const VERDICTS_KEY = 'braises.banc.verdicts'
/** Le gain plafond que `sound.test.ts` impose au jeu — l'atelier ne laisse pas le dépasser. */
const GAIN_MAX = 0.15
/** Le silence entre deux sons d'une série : assez pour les distinguer, pas pour les délier. */
const ENTRE_DEUX_S = 0.28

// JETABLE, à dessein : le banc et le jeu tournent sur la même origine, donc sur le même
// `localStorage`. Un moteur persistant ici ferait écrire au curseur de l'atelier les réglages
// de la Veillée — on cale un son à 10 %, et le jeu se retrouve muet au prochain lancement.
const moteur = new SoundEngine({ persist: false })

/** Fabrique un événement synthétique — le routage ignore les champs superflus (cf. sound.test). */
const ev = (type: string, onMe: boolean): SimEvent =>
  ({ type, tick: 0, entityId: onMe ? 1 : 2, byEntityId: 9, targetEntityId: onMe ? 1 : 2 }) as unknown as SimEvent

/** Les deux points de vue d'un fait : plusieurs sons ne se déclenchent que « sur moi ». */
function pointsDeVue(type: string): { moi: SoundSpec | null; autre: SoundSpec | null; differents: boolean } {
  const moi = soundForEvent(ev(type, true), true)
  const autre = soundForEvent(ev(type, false), false)
  return { moi, autre, differents: JSON.stringify(moi) !== JSON.stringify(autre) }
}

/** Le son d'un fait, quel que soit le point de vue qui le porte (`null` s'il est muet). */
function unSon(type: string): SoundSpec | null {
  const vue = pointsDeVue(type)
  return vue.moi ?? vue.autre
}

/** Joue un son par le VRAI moteur, en réveillant l'audio dans le geste même (règle navigateur). */
function jouer(spec: SoundSpec | null, delai = 0): void {
  if (!spec) return
  moteur.resume()
  moteur.play(spec, delai)
  dernier = spec
  peindreEtat()
}

/** Le dernier son joué — ESPACE le rejoue (on compare en tapotant, pas en visant une souris). */
let dernier: SoundSpec | null = null

/** Joue une suite de sons espacés de leur propre durée : une famille s'écoute d'un bloc. */
function jouerSerie(specs: (SoundSpec | null)[]): void {
  let t = 0
  for (const s of specs) {
    if (!s) continue
    jouer(s, t)
    t += s.dur + ENTRE_DEUX_S
  }
}

// ── LES VERDICTS ────────────────────────────────────────────────────────────────────────────
// Ce que le banc PRODUIT : pour chaque fait, ce qu'Alexis décide. Initialisés à l'état actuel
// (on part du réel), retenus dans le navigateur pour qu'une passe interrompue se retrouve.

const verdicts = new Map<string, Voix>()

/**
 * L'EMPREINTE DE L'ÉTAT SUR LEQUEL UNE PASSE A ÉTÉ FAITE. Sans elle, une passe retenue hier
 * se recollerait sur un routage qui a changé depuis — et le banc afficherait « 24 verdicts
 * changés » en pointant VERS L'ARRIÈRE, proposant d'annuler ce qu'on vient de livrer. Une
 * sauvegarde se vérifie sur sa FORME, pas sur sa seule présence (même leçon que `deserializeSim`).
 */
const empreinte = (): string =>
  Object.entries(INVENTAIRE)
    .map(([t, f]) => `${t}:${f.voix}`)
    .join('|')

function chargerVerdicts(): void {
  for (const [type, fait] of Object.entries(INVENTAIRE)) verdicts.set(type, fait.voix)
  try {
    const brut = localStorage.getItem(VERDICTS_KEY)
    if (!brut) return
    const lu = JSON.parse(brut) as { base?: string; verdicts?: Record<string, Voix> }
    // Le code a bougé sous la passe : on la LAISSE tomber plutôt que de la recoller de
    // travers. Perdre une passe en cours est un désagrément ; en rejouer une périmée
    // proposerait de défaire le travail livré, ce qui est bien pire.
    if (lu.base !== empreinte()) {
      localStorage.removeItem(VERDICTS_KEY)
      return
    }
    for (const [type, v] of Object.entries(lu.verdicts ?? {})) {
      if (verdicts.has(type) && (v === 'voix' || v === 'muet')) verdicts.set(type, v)
    }
  } catch {
    /* stockage refusé ou JSON abîmé : on repart de l'état actuel, ce n'est pas une perte */
  }
}

function retenirVerdicts(): void {
  try {
    localStorage.setItem(VERDICTS_KEY, JSON.stringify({ base: empreinte(), verdicts: Object.fromEntries(verdicts) }))
  } catch {
    /* la passe vaut pour la session */
  }
}

const change = (type: string): boolean => verdicts.get(type) !== INVENTAIRE[type as SimEvent['type']].voix

/** Le rapport à me rendre : seulement ce qui CHANGE, groupé par famille, en clair. */
function rapport(): string {
  const lignes: string[] = []
  let versVoix = 0
  let versMuet = 0
  for (const famille of FAMILLES) {
    const bouges = faitsDeFamille(famille.id).filter((f) => change(f.type))
    if (!bouges.length) continue
    lignes.push('', famille.titre)
    for (const { type, fait } of bouges) {
      const v = verdicts.get(type)!
      if (v === 'voix') versVoix++
      else versMuet++
      lignes.push(`  ${type.padEnd(28)} ${fait.voix.toUpperCase()} → ${v.toUpperCase()}   (${fait.quoi})`)
    }
  }
  if (!lignes.length) return 'Aucun changement : l’inventaire reste tel quel (61 faits, 10 voix).'
  const p = (n: number, un: string, plusieurs: string): string => `${n} ${n > 1 ? plusieurs : un}`
  const tete = `${p(versVoix, 'fait prend', 'faits prennent')} une voix, ${p(versMuet, 'retourne', 'retournent')} au silence.`
  return `${tete}\n${lignes.join('\n')}`
}

// ── L'ATELIER ───────────────────────────────────────────────────────────────────────────────
// Façonner un son à l'oreille sans rebâtir : les réglages de `SoundSpec`, et la ligne de
// `sound.ts` qui en découle, prête à coller. Le candidat par défaut d'un fait MUET est
// délibérément neutre — c'est un point de départ à déformer, pas une proposition.

const CANDIDAT: SoundSpec = { wave: 'triangle', freq: 330, freqEnd: 420, dur: 0.24, gain: 0.07 }

let atelierType = 'gift_given'
let atelierSpec: SoundSpec = { ...CANDIDAT }

/** La ligne à coller dans `soundForEvent` — l'atelier rend du CODE, pas des nombres à recopier. */
function codeAtelier(): string {
  const s = atelierSpec
  const champs = [
    `wave: '${s.wave}'`,
    `freq: ${s.freq}`,
    ...(s.freqEnd !== undefined ? [`freqEnd: ${s.freqEnd}`] : []),
    `dur: ${round2(s.dur)}`,
    `gain: ${round3(s.gain)}`,
    ...(s.lowpass !== undefined ? [`lowpass: ${s.lowpass}`] : []),
  ]
  return `case '${atelierType}':\n  return { ${champs.join(', ')} }`
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const round3 = (n: number): number => Math.round(n * 1000) / 1000

// ── LE RENDU ────────────────────────────────────────────────────────────────────────────────

ensureGameFont()
chargerVerdicts()

const racine = document.createElement('div')
racine.className = 'banc'
document.body.appendChild(racine)

const nbVoix = SONORES.length
const nbTotal = Object.keys(INVENTAIRE).length
/**
 * L'ÉTALON — les quatre sons du corps et de la bête, ceux d'avant le chantier. Le bouton de
 * tête jouait AUTREFOIS tout le registre : il valait 10 sons, il en vaudrait 34 aujourd'hui,
 * soit une demi-minute programmée sur l'horloge WebAudio SANS moyen de l'interrompre (et un
 * second clic en empilerait autant). Il retrouve son intention d'origine — caler l'oreille sur
 * la référence en quatre secondes. Pour tout entendre, il y a les boutons de famille.
 */
const ETALON = faitsDeFamille('registre').map((f) => f.type)
const nbEtalon = ETALON.length

racine.innerHTML = `
<style>
  /* La grammaire des voiles DOM du jeu : fond chaud, sourcil braise, titre espacé, filet.
     Un instrument qui ressemble au jeu se lit avec les mêmes yeux que lui. */
  *{box-sizing:border-box;}
  body{background:${HEX.bg};color:${HEX.body};font-family:${GAME_FONT};font-size:13.5px;line-height:1.55;}
  .banc{max-width:1180px;margin:0 auto;padding:34px 26px 90px;}
  .b-eyebrow{font-size:11.5px;color:${HEX.ember};letter-spacing:4px;}
  .b-title{font-size:25px;font-weight:700;color:${HEX.ember};letter-spacing:6px;margin:12px 0 0;
    text-shadow:0 2px 0 ${HEX.ink},0 0 18px rgba(201,139,58,.25);}
  .b-sub{color:${HEX.dim};max-width:62rem;margin-top:14px;}
  .b-div{width:80px;height:1px;background:${HEX.borderWarm};margin:22px 0;}
  .b-count{color:${HEX.bodyBright};}
  .b-count b{color:${HEX.emberBright};font-weight:700;}

  /* La barre de tête COLLE : le volume, l'état du son et le rejeu restent sous la main
     pendant qu'on descend les huit familles. */
  .b-bar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;align-items:center;gap:16px;
    padding:12px 0;margin-bottom:18px;background:${HEX.bg};border-bottom:1px solid ${HEX.borderDim};}
  .b-vol{-webkit-appearance:none;appearance:none;width:170px;height:4px;background:#3a3225;border-radius:2px;outline:none;}
  .b-vol::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border-radius:50%;
    background:${HEX.ember};cursor:pointer;border:2px solid ${HEX.bg};}
  .b-vol::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:${HEX.ember};cursor:pointer;border:2px solid ${HEX.bg};}
  .b-etat{font-size:12px;color:${HEX.faint};}
  .b-etat.b-on{color:${HEX.emberBright};}

  .b-btn{background:rgba(201,139,58,.14);border:2px solid ${HEX.ember};color:${HEX.emberBright};
    font-family:inherit;font-size:12.5px;letter-spacing:1.5px;padding:7px 14px;cursor:pointer;
    transition:background .12s ease,color .12s ease;}
  .b-btn:hover{background:rgba(232,198,106,.24);color:${HEX.title};}
  .b-btn.b-ghost{background:transparent;border-color:${HEX.borderWarm};color:${HEX.dim};letter-spacing:1px;}
  .b-btn.b-ghost:hover{color:${HEX.body};border-color:${HEX.borderWarmHover};}
  .b-btn:disabled{opacity:.34;cursor:default;background:transparent;border-color:${HEX.borderDim};color:${HEX.faint};}
  .b-btn:disabled:hover{background:transparent;color:${HEX.faint};}

  /* scroll-margin : la barre de tête est collante, et sans cette marge tout défilement
     amené sur une famille glissait son TITRE dessous — on arrivait sur des lignes sans
     savoir quelle question elles répondent. */
  .b-fam{margin:38px 0 0;padding-top:22px;border-top:1px solid ${HEX.borderDim};scroll-margin-top:118px;}
  .b-fam-t{font-size:14px;font-weight:700;color:${HEX.ember};letter-spacing:4px;}
  .b-fam-p{color:${HEX.body};max-width:62rem;margin-top:9px;}
  .b-fam-r{color:${HEX.dim};max-width:62rem;margin-top:7px;}
  .b-fam-r b{color:${HEX.emberBright};font-weight:400;letter-spacing:1px;}
  .b-fam-actions{margin-top:13px;display:flex;gap:10px;flex-wrap:wrap;}

  /* Une ligne = un fait. La PHRASE d'abord (on tranche des faits de jeu), l'identifiant
     dessous en retrait : il ne sert qu'à moi, au moment de coder. */
  .b-row{display:grid;grid-template-columns:1fr auto auto;gap:14px;align-items:center;
    padding:10px 12px;border-left:2px solid transparent;border-bottom:1px solid #1c1712;}
  .b-row:hover{background:${HEX.panelWarm};}
  .b-row.b-chg{border-left-color:${HEX.ember};background:rgba(201,139,58,.06);}
  .b-quoi{color:${HEX.body};}
  .b-type{display:block;font-size:11px;color:${HEX.faint};letter-spacing:.5px;margin-top:2px;}
  .b-actions{display:flex;gap:7px;align-items:center;}

  /* Le verdict : deux moitiés d'un même interrupteur, jamais deux boutons libres — l'état
     courant se lit sans chercher lequel est allumé. */
  .b-verdict{display:flex;border:1px solid ${HEX.borderDim};}
  .b-v{background:transparent;border:0;font-family:inherit;font-size:11px;letter-spacing:1.5px;
    padding:5px 11px;color:${HEX.faint};cursor:pointer;}
  .b-v.b-sel{background:rgba(201,139,58,.2);color:${HEX.emberBright};}
  .b-v.b-sel.b-silence{background:rgba(122,116,104,.16);color:${HEX.dim};}

  /* L'ATELIER colle en bas : on façonne en gardant la liste à l'œil. Il est REPLIÉ par
     défaut — déployé, il mangeait la moitié de la fenêtre et il ne restait qu'une ligne de
     liste au-dessus. La liste est le sujet, l'atelier est l'outil : il se déploie quand on
     lui envoie un fait, et se referme d'un clic sur son titre. */
  .b-atelier{position:sticky;bottom:0;z-index:6;margin-top:40px;padding:14px 18px;
    background:${HEX.bgWarm};border:1px solid ${HEX.borderWarm};}
  .b-at-t{display:flex;align-items:center;gap:10px;width:100%;background:transparent;border:0;
    font-family:inherit;font-size:12px;color:${HEX.ember};letter-spacing:4px;margin-bottom:12px;
    padding:0;cursor:pointer;text-align:left;}
  .b-at-t:hover{color:${HEX.emberBright};}
  .b-at-t .b-at-chev{margin-left:auto;letter-spacing:0;color:${HEX.dim};font-size:11px;}
  .b-atelier.b-plie{padding:10px 18px;}
  .b-atelier.b-plie .b-at-t{margin-bottom:0;}
  .b-atelier.b-plie .b-at-grid,
  .b-atelier.b-plie .b-code,
  .b-atelier.b-plie .b-at-row{display:none;}
  .b-at-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px 20px;align-items:center;}
  .b-at-l{display:flex;align-items:center;gap:10px;font-size:12px;color:${HEX.dim};}
  .b-at-l input[type=range]{flex:1;min-width:90px;}
  .b-at-l span{color:${HEX.bodyBright};min-width:56px;text-align:right;}
  .b-at-wave{display:flex;gap:5px;flex-wrap:wrap;}
  .b-at-w{background:transparent;border:1px solid ${HEX.borderDim};color:${HEX.dim};font-family:inherit;
    font-size:11px;padding:4px 9px;cursor:pointer;}
  .b-at-w.b-sel{border-color:${HEX.ember};color:${HEX.emberBright};background:rgba(201,139,58,.16);}
  .b-code{margin-top:13px;padding:11px 13px;background:${HEX.ink};color:${HEX.bodyBright};
    font-size:12px;white-space:pre;overflow-x:auto;border-left:2px solid ${HEX.ember};}
  .b-at-row{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap;}
  .b-at-cible{color:${HEX.dim};font-size:12px;}
  .b-at-cible b{color:${HEX.emberBright};font-weight:400;}
</style>

<div class="b-eyebrow">BRAISES — OUTIL DE DEV</div>
<h1 class="b-title">LE BANC D’ÉCOUTE</h1>
<p class="b-sub">
  Le monde émet <span class="b-count"><b>${nbTotal}</b> faits de domaine</span> :
  <span class="b-count"><b>${nbVoix}</b> ont une voix</span>, ${nbTotal - nbVoix} un silence <em>décidé</em>.
  Plus aucun ne se tait par omission — et c’était toute la question : un silence choisi est un design, un silence
  par oubli est un trou. Ce qui est arrêté, c’est <b>qui parle</b>. Le TIMBRE de chacun, lui, a été posé sans être
  entendu : c’est ici qu’il se rejuge. Écoutez l’étalon, puis une famille ; ce qui sonne faux part à l’atelier, qui
  rend la ligne à coller dans <code>sound.ts</code>. Le banc appelle le vrai routage et le vrai moteur du jeu —
  ce qu’on entend est ce que le jeu joue.
</p>
<div class="b-div"></div>

<div class="b-bar">
  <button class="b-btn b-registre">▶ L’ÉTALON (${nbEtalon})</button>
  <button class="b-btn b-ghost b-rejouer">↻ rejouer (ESPACE)</button>
  <label class="b-at-l" style="max-width:290px">volume
    <input type="range" class="b-vol" min="0" max="100" step="1" aria-label="Volume">
    <span class="b-vol-val"></span>
  </label>
  <span class="b-etat"></span>
  <span style="flex:1"></span>
  <span class="b-solde b-etat"></span>
  <button class="b-btn b-ghost b-copier">COPIER LES VERDICTS</button>
  <button class="b-btn b-ghost b-reset">repartir de l’état actuel</button>
</div>

<div class="b-familles"></div>

<div class="b-atelier b-plie">
  <button class="b-at-t">L’ATELIER — FAÇONNER UNE VOIX<span class="b-at-chev">déployer ▾</span></button>
  <div class="b-at-grid">
    <div class="b-at-l">forme
      <div class="b-at-wave"></div>
    </div>
    <label class="b-at-l">hauteur
      <input type="range" class="b-freq" min="60" max="1400" step="10"><span class="b-freq-v"></span>
    </label>
    <label class="b-at-l"><input type="checkbox" class="b-gl-on"> glissando
      <input type="range" class="b-gl" min="60" max="1400" step="10"><span class="b-gl-v"></span>
    </label>
    <label class="b-at-l">durée
      <input type="range" class="b-dur" min="3" max="150" step="1"><span class="b-dur-v"></span>
    </label>
    <label class="b-at-l">gain
      <input type="range" class="b-gain" min="1" max="${GAIN_MAX * 1000}" step="1"><span class="b-gain-v"></span>
    </label>
    <label class="b-at-l"><input type="checkbox" class="b-lp-on"> coupe-bas
      <input type="range" class="b-lp" min="200" max="6000" step="50"><span class="b-lp-v"></span>
    </label>
  </div>
  <div class="b-code"></div>
  <div class="b-at-row">
    <button class="b-btn b-at-play">▶ JOUER</button>
    <button class="b-btn b-ghost b-at-copy">copier la ligne</button>
    <span class="b-at-cible">cible : <b class="b-at-nom"></b></span>
  </div>
</div>`

// ── Les familles et leurs lignes ────────────────────────────────────────────────────────────

const q = <T extends HTMLElement>(sel: string, dans: ParentNode = racine): T => dans.querySelector<T>(sel)!

const hote = q('.b-familles')
for (const famille of FAMILLES) {
  const faits = faitsDeFamille(famille.id)
  const bloc = document.createElement('section')
  bloc.className = 'b-fam'
  bloc.innerHTML = `
    <div class="b-fam-t">${famille.titre} — ${faits.length} faits</div>
    <p class="b-fam-p">${famille.propos}</p>
    <p class="b-fam-r"><b>MA RECO :</b> ${famille.reco}</p>
    <div class="b-fam-actions">
      <button class="b-btn b-ghost b-fam-play">▶ écouter ce qui sonne dans cette famille</button>
    </div>
    <div class="b-fam-rows"></div>`

  const sonores = faits.map((f) => unSon(f.type)).filter(Boolean)
  const btnFam = q<HTMLButtonElement>('.b-fam-play', bloc)
  if (!sonores.length) {
    btnFam.disabled = true
    btnFam.textContent = 'rien ne sonne encore dans cette famille'
  } else {
    btnFam.addEventListener('click', () => jouerSerie(sonores))
  }

  const rows = q('.b-fam-rows', bloc)
  for (const { type, fait } of faits) {
    const vue = pointsDeVue(type)
    const ligne = document.createElement('div')
    ligne.className = 'b-row'
    ligne.dataset.type = type
    ligne.innerHTML = `
      <div>
        <span class="b-quoi">${fait.quoi}</span>
        <code class="b-type">${type}</code>
      </div>
      <div class="b-actions"></div>
      <div class="b-verdict">
        <button class="b-v b-v-voix" data-v="voix">VOIX</button>
        <button class="b-v b-v-muet b-silence" data-v="muet">MUET</button>
      </div>`

    // LES BOUTONS D'ÉCOUTE. Un fait qui sonne DIFFÉREMMENT « sur moi » et « sur un autre » en
    // offre deux : c'est une distinction de design (encaisser n'est pas toucher), elle doit
    // s'entendre séparément. Mais un fait qui ne sonne QUE pour moi (la récolte) n'en offre
    // qu'un — un second bouton silencieux ferait douter de ses oreilles, or c'est tout ce que
    // ce banc doit éviter. Un fait muet n'a rien à jouer : son bouton mène à l'atelier, parce
    // que sa question n'est pas « comment ça sonne » mais « et si ça sonnait ».
    const actions = q('.b-actions', ligne)
    if (vue.moi && vue.autre && vue.differents) {
      actions.innerHTML = `<button class="b-btn b-p1">▶ sur moi</button><button class="b-btn b-p2">▶ sur un autre</button>`
      q<HTMLButtonElement>('.b-p1', actions).addEventListener('click', () => jouer(vue.moi))
      q<HTMLButtonElement>('.b-p2', actions).addEventListener('click', () => jouer(vue.autre))
    } else if (vue.moi ?? vue.autre) {
      const seul = vue.moi ?? vue.autre
      const libelle = !vue.autre ? '▶ écouter (moi seul)' : !vue.moi ? '▶ écouter (les autres)' : '▶ écouter'
      actions.innerHTML = `<button class="b-btn b-p1">${libelle}</button>`
      q<HTMLButtonElement>('.b-p1', actions).addEventListener('click', () => jouer(seul))
    } else {
      actions.innerHTML = `<button class="b-btn b-ghost b-essai">essayer une voix →</button>`
      q<HTMLButtonElement>('.b-essai', actions).addEventListener('click', () => viserAtelier(type, { ...CANDIDAT }))
    }

    for (const bouton of ligne.querySelectorAll<HTMLButtonElement>('.b-v')) {
      bouton.addEventListener('click', () => {
        verdicts.set(type, bouton.dataset.v as Voix)
        retenirVerdicts()
        peindreLigne(ligne, type)
        peindreSolde()
      })
    }

    peindreLigne(ligne, type)
    rows.appendChild(ligne)
  }
  hote.appendChild(bloc)
}

function peindreLigne(ligne: HTMLElement, type: string): void {
  const v = verdicts.get(type)
  ligne.classList.toggle('b-chg', change(type))
  for (const bouton of ligne.querySelectorAll<HTMLButtonElement>('.b-v')) {
    bouton.classList.toggle('b-sel', bouton.dataset.v === v)
  }
}

// ── La barre de tête ────────────────────────────────────────────────────────────────────────

const etat = q('.b-etat')
const solde = q('.b-solde')

/** L'audio est-il vraiment ouvert ? Un banc qui laisse croire à un son raté ne sert à rien. */
function peindreEtat(): void {
  const pret = moteur.isReady()
  etat.textContent = moteur.isMuted() ? 'son COUPÉ' : pret ? 'son actif' : 'un clic réveille le son'
  etat.classList.toggle('b-on', pret && !moteur.isMuted())
}

function peindreSolde(): void {
  const n = Object.keys(INVENTAIRE).filter(change).length
  solde.textContent = n ? `${n} verdict(s) changé(s)` : 'aucun changement'
}

q<HTMLButtonElement>('.b-registre').addEventListener('click', () => jouerSerie(ETALON.map(unSon)))
q<HTMLButtonElement>('.b-rejouer').addEventListener('click', () => jouer(dernier))

const vol = q<HTMLInputElement>('.b-vol')
const volVal = q('.b-vol-val')
vol.value = String(Math.round(moteur.getVolume() * 100))
volVal.textContent = `${vol.value} %`
vol.addEventListener('input', () => {
  moteur.setVolume(Number(vol.value) / 100)
  volVal.textContent = `${vol.value} %`
})

q<HTMLButtonElement>('.b-copier').addEventListener('click', () => {
  void navigator.clipboard.writeText(rapport()).then(
    () => flash('.b-copier', 'COPIÉ ✓'),
    () => window.prompt('Copie refusée par le navigateur — le rapport, à prendre à la main :', rapport()),
  )
})

q<HTMLButtonElement>('.b-reset').addEventListener('click', () => {
  for (const [type, fait] of Object.entries(INVENTAIRE)) verdicts.set(type, fait.voix)
  retenirVerdicts()
  for (const ligne of racine.querySelectorAll<HTMLElement>('.b-row')) peindreLigne(ligne, ligne.dataset.type!)
  peindreSolde()
})

function flash(sel: string, texte: string): void {
  const b = q<HTMLButtonElement>(sel)
  const avant = b.textContent
  b.textContent = texte
  window.setTimeout(() => (b.textContent = avant), 1100)
}

// ── L'atelier ───────────────────────────────────────────────────────────────────────────────

const WAVES: Waveform[] = ['sine', 'triangle', 'square', 'sawtooth', 'noise']
const atelier = q('.b-atelier')
q<HTMLButtonElement>('.b-at-t').addEventListener('click', () => plierAtelier(!atelier.classList.contains('b-plie')))
const zoneWave = q('.b-at-wave')
zoneWave.innerHTML = WAVES.map((w) => `<button class="b-at-w" data-w="${w}">${w}</button>`).join('')
for (const b of zoneWave.querySelectorAll<HTMLButtonElement>('.b-at-w')) {
  b.addEventListener('click', () => {
    atelierSpec.wave = b.dataset.w as Waveform
    peindreAtelier()
    jouer(atelierSpec)
  })
}

const freq = q<HTMLInputElement>('.b-freq')
const gl = q<HTMLInputElement>('.b-gl')
const glOn = q<HTMLInputElement>('.b-gl-on')
const dur = q<HTMLInputElement>('.b-dur')
const gain = q<HTMLInputElement>('.b-gain')
const lp = q<HTMLInputElement>('.b-lp')
const lpOn = q<HTMLInputElement>('.b-lp-on')

/** Relit les réglages vers la spec. `change` et non `input` : un curseur qu'on traîne ne doit
 *  pas mitrailler cinquante sons — on entend le résultat quand on lâche. */
function lireAtelier(): void {
  atelierSpec = {
    wave: atelierSpec.wave,
    freq: Number(freq.value),
    ...(glOn.checked ? { freqEnd: Number(gl.value) } : {}),
    dur: Number(dur.value) / 100,
    gain: Number(gain.value) / 1000,
    ...(lpOn.checked ? { lowpass: Number(lp.value) } : {}),
  }
  peindreAtelier()
}

for (const ctrl of [freq, gl, dur, gain, lp]) {
  ctrl.addEventListener('input', lireAtelier) // les chiffres suivent le doigt…
  ctrl.addEventListener('change', () => jouer(atelierSpec)) // …le son vient au relâché
}
for (const ctrl of [glOn, lpOn]) {
  ctrl.addEventListener('change', () => {
    lireAtelier()
    jouer(atelierSpec)
  })
}

/** Pose un fait (et un candidat) sur l'établi, le déploie, et le fait entendre aussitôt. */
function viserAtelier(type: string, spec: SoundSpec): void {
  atelierType = type
  atelierSpec = { ...spec }
  poserCurseurs()
  plierAtelier(false)
  peindreAtelier()
  jouer(atelierSpec)
}

/** Replie ou déploie l'établi. Replié, il ne prend qu'une ligne — la liste garde l'écran. */
function plierAtelier(plie: boolean): void {
  atelier.classList.toggle('b-plie', plie)
  q('.b-at-chev').textContent = plie ? 'déployer ▾' : 'replier ▴'
}

function poserCurseurs(): void {
  freq.value = String(atelierSpec.freq)
  glOn.checked = atelierSpec.freqEnd !== undefined
  gl.value = String(atelierSpec.freqEnd ?? atelierSpec.freq)
  dur.value = String(Math.round(atelierSpec.dur * 100))
  gain.value = String(Math.round(atelierSpec.gain * 1000))
  lpOn.checked = atelierSpec.lowpass !== undefined
  lp.value = String(atelierSpec.lowpass ?? 2000)
}

function peindreAtelier(): void {
  q('.b-freq-v').textContent = `${atelierSpec.freq} Hz`
  q('.b-gl-v').textContent = glOn.checked ? `${atelierSpec.freqEnd} Hz` : '—'
  q('.b-dur-v').textContent = `${round2(atelierSpec.dur)} s`
  q('.b-gain-v').textContent = String(round3(atelierSpec.gain))
  q('.b-lp-v').textContent = lpOn.checked ? `${atelierSpec.lowpass} Hz` : '—'
  q('.b-at-nom').textContent = `${atelierType} — ${INVENTAIRE[atelierType as SimEvent['type']].quoi}`
  q('.b-code').textContent = codeAtelier()
  for (const b of zoneWave.querySelectorAll<HTMLButtonElement>('.b-at-w')) {
    b.classList.toggle('b-sel', b.dataset.w === atelierSpec.wave)
  }
}

q<HTMLButtonElement>('.b-at-play').addEventListener('click', () => jouer(atelierSpec))
q<HTMLButtonElement>('.b-at-copy').addEventListener('click', () => {
  void navigator.clipboard.writeText(codeAtelier()).then(
    () => flash('.b-at-copy', 'copié ✓'),
    () => window.prompt('Copie refusée — la ligne, à prendre à la main :', codeAtelier()),
  )
})

// ESPACE rejoue : on compare deux candidats en tapotant, sans repartir chercher un bouton.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.target instanceof HTMLInputElement) return
  e.preventDefault()
  jouer(dernier ?? atelierSpec)
})
// Le tout premier geste ouvre l'audio, même s'il ne visait pas un bouton de lecture.
window.addEventListener('pointerdown', () => {
  moteur.resume()
  peindreEtat()
})

// Le banc s'interroge de l'extérieur, comme le jeu par `__BRAISES__` : on LIT son état, on ne
// le fabrique pas. C'est ce qui rend l'outil vérifiable — sinon son rapport ne se prouve
// qu'en le lisant à l'œil dans un presse-papier.
;(window as unknown as { __BANC__: unknown }).__BANC__ = {
  rapport,
  verdicts,
  jouer,
  specDe: unSon,
}

poserCurseurs()
peindreAtelier()
peindreSolde()
peindreEtat()
