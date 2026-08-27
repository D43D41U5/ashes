// CONFIG JETABLE — le même serveur de dev, mais SANS HMR ni rechargement.
// Une autre session édite `packages/client` en même temps que moi : chacune de ses écritures
// rechargeait ma page en plein scénario (« Cannot read properties of undefined »). On gèle donc
// la prise. À supprimer après la mesure.
import base from './vite.config'
export default { ...base, server: { ...(base as { server?: object }).server, hmr: false, watch: null } }
