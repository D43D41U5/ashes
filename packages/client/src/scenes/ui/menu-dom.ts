/**
 * L'ÉCRAN PRINCIPAL, EN DOM — rendu ISO à la maquette « Ashes UI » Turn 9A.
 *
 * POURQUOI DU DOM, ET PAS DU PHASER. La maquette EST du HTML/CSS : un titre en
 * `text-shadow` doux, un anneau en `conic-gradient`, une police `JetBrains Mono`,
 * des fonds en `radial-gradient` à 7 % d'ambre. Rejoués dans le canvas Phaser —
 * en 1280×720 puis upscalé (`image-rendering: pixelated`) à la fenêtre — le texte
 * se crénelle, la police tombe en `monospace` générique, et un Glow FX shader
 * force le halo. On chassait un écart qui ne se refermait jamais. Ici on ne
 * REPRODUIT plus la maquette : on la REJOUE, au pixel de teinte et de métrique
 * près, en réutilisant sa grammaire CSS. Le canvas Phaser reste derrière (le jeu) ;
 * ce voile ne vit que le temps du menu et se retire au lancement d'une partie.
 *
 * La planche est calée à 1920×1080 (la résolution de la maquette) et mise à
 * l'échelle pour TENIR dans la fenêtre (letterbox), exactement comme le canvas du
 * jeu en `Scale.FIT` — d'où l'identité des proportions à toute taille d'écran.
 */
import { SERVERS, type ServerEntry } from '../../servers'
import { ensureGameFont, GAME_FONT } from './game-font'

export interface MenuHandle {
  destroy(): void
}

export interface MenuCallbacks {
  onSolo(): void
  onServer(server: ServerEntry): void
}

const DESIGN_W = 1920
const DESIGN_H = 1080

/** Monte le voile du menu sur `document.body` et rend de quoi le retirer. */
export function mountMenu(cb: MenuCallbacks): MenuHandle {
  ensureGameFont()
  const root = document.createElement('div')
  root.className = 'bm-overlay'
  root.innerHTML = style() + board()
  document.body.appendChild(root)

  const boardEl = root.querySelector<HTMLElement>('.bm')!

  // ── MISE À L'ÉCHELLE « FIT » — la planche 1920×1080 tient dans la fenêtre ──
  const fit = (): void => {
    const k = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H)
    boardEl.style.transform = `translate(-50%, -50%) scale(${k})`
  }
  fit()
  window.addEventListener('resize', fit)

  // ── LES GESTES : JOUER SEUL, et une ligne par vallée ──
  root.querySelector<HTMLElement>('[data-act="solo"]')!.addEventListener('click', () => cb.onSolo())
  root.querySelectorAll<HTMLElement>('[data-act="server"]').forEach((el) => {
    const server = SERVERS[Number(el.dataset.idx)]
    if (server) el.addEventListener('click', () => cb.onServer(server))
  })

  // ── ANTI-FOUT : on révèle une fois la police chargée, pour que le PREMIER
  //    rendu du titre soit déjà en JetBrains Mono (sinon un flash en fallback). ──
  const reveal = (): void => root.classList.add('bm-ready')
  const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts
  if (fonts?.load) {
    Promise.all([fonts.load('700 88px "JetBrains Mono"'), fonts.load('400 16px "JetBrains Mono"')])
      .then(reveal)
      .catch(reveal)
    window.setTimeout(reveal, 400) // garde-fou : jamais bloqué sur un chargement lent
  } else {
    reveal()
  }

  return {
    destroy(): void {
      window.removeEventListener('resize', fit)
      root.remove()
    },
  }
}

/** La feuille de style du voile : police, images clés, survols, échelle. */
function style(): string {
  return `<style>
  .bm-overlay{position:fixed;inset:0;z-index:50;background:#0f0b08;overflow:hidden;
    opacity:0;transition:opacity .18s ease;}
  .bm-overlay.bm-ready{opacity:1;}
  .bm{position:absolute;left:50%;top:50%;width:${DESIGN_W}px;height:${DESIGN_H}px;overflow:hidden;
    background:#0f0b08;color:#e4ebef;transform-origin:center center;transform:translate(-50%,-50%);
    font-family:${GAME_FONT};}
  .bm *{box-sizing:border-box;}
  .bm .card-solo,.bm .row-server{cursor:pointer;transition:background .12s ease,border-color .12s ease,box-shadow .12s ease,color .12s ease;}
  .bm .card-solo:hover{background:rgba(201,139,58,.1)!important;border-color:#c98b3a!important;box-shadow:0 0 24px rgba(201,139,58,.25);}
  .bm .card-solo:hover .cs-title{color:#f2ead0;}
  .bm .card-solo:hover .cs-sub{color:#e8e0c8;}
  .bm .row-server:hover{background:rgba(201,139,58,.08)!important;border-color:#c98b3a!important;box-shadow:0 0 24px rgba(201,139,58,.2);}
  @keyframes bmFlamePulse{0%,100%{transform:translateY(0) scale(1);opacity:.9}50%{transform:translateY(-4px) scale(1.08);opacity:1}}
  @keyframes bmRingSpin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
  </style>`
}

/** La planche 9A, au pixel de la maquette. Une ligne par vallée de `SERVERS`. */
function board(): string {
  const rows = SERVERS.map(
    (s, i) => `
    <div class="row-server" data-act="server" data-idx="${i}" style="margin-top:16px;background:rgba(27,27,34,.55);border:2px solid #2a2a34;padding:20px 28px;display:flex;justify-content:space-between;align-items:center;">
      <span style="font-size:22px;font-weight:700;color:#f2ead0;letter-spacing:1px;">${esc(s.name)}</span>
      <div style="text-align:right;">
        <div style="font-size:12px;color:#9a8f78;letter-spacing:1px;">seed ${s.seed}</div>
        <div style="font-size:12px;color:#c98b3a;letter-spacing:1px;margin-top:4px;">max ${s.maxClients} joueurs</div>
      </div>
    </div>`,
  ).join('')

  return `<div class="bm">
    <div style="position:absolute;inset:0;background:radial-gradient(90% 60% at 50% 18%,rgba(201,139,58,.07),transparent 55%),radial-gradient(120% 100% at 50% 120%,rgba(201,139,58,.05),transparent 55%);"></div>

    <div style="position:absolute;left:50%;top:96px;transform:translateX(-50%);width:700px;text-align:center;">
      <div style="position:relative;width:150px;height:150px;margin:0 auto 34px;border-radius:50%;background:conic-gradient(#c98b3a 100%,#241a10 0);">
        <div style="position:absolute;inset:8px;border-radius:50%;background:#0f0b08;display:grid;place-items:center;">
          <div style="font-size:52px;line-height:1;animation:bmFlamePulse 1.3s ease-in-out infinite;filter:drop-shadow(0 0 16px rgba(201,139,58,.7));">🔥</div>
        </div>
        <div style="position:absolute;inset:0;animation:bmRingSpin 3.4s linear infinite;"><div style="position:absolute;left:50%;top:-3px;transform:translateX(-50%);width:7px;height:7px;border-radius:50%;background:#e8c66a;box-shadow:0 0 10px #e8c66a;"></div></div>
      </div>

      <div style="font-size:88px;font-weight:700;color:#e8763a;letter-spacing:8px;text-shadow:0 0 46px rgba(201,139,58,.5),0 0 18px rgba(201,139,58,.4);">BRAISES</div>
      <div style="font-size:16px;color:#c9a24a;letter-spacing:2px;margin-top:14px;">Survie · une vallée de 60 jours · l'alignement émerge</div>

      <div class="card-solo" data-act="solo" style="margin-top:96px;background:rgba(27,27,34,.55);border:2px solid #2a2a34;border-top:2px solid #6b5a3a;padding:24px 28px;text-align:center;">
        <div class="cs-title" style="font-size:22px;font-weight:700;color:#e8c66a;letter-spacing:3px;">JOUER SEUL</div>
        <div class="cs-sub" style="font-size:13px;color:#9a8f78;letter-spacing:1px;margin-top:10px;">La Veillée — la vallée pour vous seul, hors ligne</div>
      </div>

      <div style="font-size:13px;color:#6f6a60;letter-spacing:2px;margin-top:58px;">— ou rejoindre une vallée partagée —</div>
      ${rows}
    </div>

    <div style="position:absolute;left:0;right:0;bottom:26px;text-align:center;font-size:12px;color:#6f6a60;letter-spacing:2px;">Phase LAN</div>
    <div style="position:absolute;bottom:24px;right:28px;font-size:11px;color:#3a3a44;letter-spacing:1px;">v0.1.0 · ALPHA</div>
  </div>`
}

/** Un nom de vallée vient d'une config de confiance, mais on n'injecte jamais de
 *  HTML brut dans `innerHTML` sans échapper — la règle, pas l'exception. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
