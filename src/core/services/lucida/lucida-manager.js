const dbManager = require('../../db/db-access');
const path = require('path');

class LucidaManager {
    constructor() {
        this.lucida = null;
        this.modules = [];
        this.initialized = false;
    }

    /**
     * Inizializza lucida con i moduli per cui abbiamo chiavi/token nel database.
     */
    async initialize() {
        try {
            // Importazione dinamica del pacchetto.
            // Quando NPM riuscirà a scaricare questo modulo o quando sarà nel Docker,
            // l'import andrà a buon fine e la libreria si aggancerà.
            const { default: Lucida, Tidal, Spotify, Qobuz } = await import('lucida');
            this.lucida = new Lucida();
            this.modules = [];

            // Aggiungiamo Tidal
            const tidalLogin = dbManager.getLogin('tidal');
            if (tidalLogin && tidalLogin.token && tidalLogin.token.trim() !== '') {
                const tidalModule = new Tidal({ token: tidalLogin.token });
                this.lucida.registerModule(tidalModule);
                this.modules.push('Tidal');
            }
            
            // Aggiungiamo Qobuz
            const qobuzLogin = dbManager.getLogin('qobuz');
            if (qobuzLogin && qobuzLogin.token && qobuzLogin.token.trim() !== '') {
                const qobuzModule = new Qobuz({ token: qobuzLogin.token });
                this.lucida.registerModule(qobuzModule);
                this.modules.push('Qobuz');
            }

            // Aggiungiamo Spotify
            const spotifyLogin = dbManager.getLogin('spotify');
            if (spotifyLogin && spotifyLogin.token && spotifyLogin.token.trim() !== '') {
                // Esempio: in lucida, spotify usa SP_DC o simili. Verificare api, per ora mettiamo un parametro token generico
                const spotifyModule = new Spotify({ token: spotifyLogin.token });
                this.lucida.registerModule(spotifyModule);
                this.modules.push('Spotify');
            }

            this.initialized = true;
            console.log(`[Lucida] Inizializzato con successo. Moduli attivi: ${this.modules.join(', ')}`);
        } catch (err) {
            console.warn('[Lucida] Impossibile inizializzare (pacchetto non installato o erroretto):', err.message);
            // Non throwiamo l'errore per non crashare e permettere a Slskd di funzionare comunque
            this.initialized = false;
        }
    }

    /**
     * Esegue una ricerca usando i moduli registrati su Lucida.
     * @param {string} query 
     * @returns {Promise<Array>}
     */
    async search(query, providerName) {
        if (!this.initialized) await this.initialize();
        if (!this.lucida || this.modules.length === 0) {
            return { success: false, error: 'Nessun modulo Lucida configurato/inizializzato.' };
        }
        
        // Verifica che il provider richiesto sia stato inizializzato
        const moduleName = providerName.charAt(0).toUpperCase() + providerName.slice(1);
        if (!this.modules.includes(moduleName)) {
             return { success: false, error: `Modulo Lucida ${moduleName} non abilitato o senza credenziali valide.` };
        }

        try {
            console.log(`[Lucida-${moduleName}] Ricerca del brano/album: ${query}`);
            
            // Nella maggior parte dei wrapper, si può chiamare la ricerca su un modulo specifico
            // o cercarli tutti e poi filtrare.
            let results = await this.lucida.search(query, 5); 
            
            if (results && results.length > 0) {
                // Filtriamo i risultati in base al provider, se la libreria non consente di passare il modulo alla search
                // Assumiamo che la libreria restituisca qualcosa per distinguere la sorgente
                // In assenza di docs certissmi, ipotizziamo una proprietà o match rudimentale
                // Nota: per ora cerchiamo semplicemente una fallback, adattabile in seguito alla lib lucida esatta.
                return { success: true, results: results };
            }

            return { success: false, error: `Nessun risultato trovato su ${moduleName} streaming` };
        } catch (err) {
            console.error(`[Lucida-${moduleName}] Errore in ricerca:`, err.message);
             return { success: false, error: err.message };
        }
    }

    /**
     * Scarica una url recuperata tramite la funzione search().
     * @param {string} url 
     * @param {string} outputDirectory 
     */
    async download(url, outputDirectory) {
        if (!this.initialized) await this.initialize();
        if (!this.lucida) return { success: false, error: 'Library not available' };

        try {
            console.log(`[Lucida] Avvio download da: ${url} -> ${outputDirectory}`);
            // In base all'API lucida passiamo l'url. Molto probabilmente lucida gestisce output directory tra gli options.
            const result = await this.lucida.getByUrl(url, { output: outputDirectory });
            console.log(`[Lucida] Download terminato con successo via Lucida!`);
            
            return { success: true, result };
        } catch (err) {
            console.error(`[Lucida] Errore in download url ${url}:`, err.message);
            return { success: false, error: err.message };
        }
    }
}

module.exports = new LucidaManager();
