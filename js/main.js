(function () {
  'use strict';

  const form = document.getElementById('rechner-form');
  const fehlerEl = document.getElementById('form-fehler');
  const wrapper = document.getElementById('ergebnis-wrapper');
  const empfehlungBtn = document.getElementById('empfehlung-btn');
  const empfehlungHinweis = document.getElementById('empfehlung-hinweis');
  const zinssatzInput = document.getElementById('zinssatz');

  const eur = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const eurFein = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
  const proz = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const zahl = new Intl.NumberFormat('de-DE');

  function formatDatum(iso) {
    if (!iso) return null;
    const teile = iso.split('-');
    if (teile.length !== 3) return iso;
    return `${teile[2]}.${teile[1]}.${teile[0]}`;
  }

  // ---- Live-Zinsempfehlung -------------------------------------------
  empfehlungBtn.addEventListener('click', async () => {
    empfehlungBtn.disabled = true;
    empfehlungHinweis.textContent = 'Lade Systemempfehlung …';
    try {
      const res = await fetch('/api/zinssatz-empfehlung');
      if (!res.ok) throw new Error('Antwort nicht ok');
      const daten = await res.json();
      zinssatzInput.value = daten.empfehlung;
      const standTxt = daten.stand ? `, Stand ${formatDatum(daten.stand)}` : '';
      empfehlungHinweis.textContent =
        `Übernommen: ${proz.format(daten.empfehlung)} % (${daten.quelle} ${proz.format(daten.basiszins)} % + ${proz.format(daten.aufschlag)} % Risikoaufschlag${standTxt})`;
    } catch (err) {
      empfehlungHinweis.textContent = 'Systemempfehlung gerade nicht erreichbar — bitte Zinssatz von Hand eintragen.';
    } finally {
      empfehlungBtn.disabled = false;
    }
  });

  // ---- Berechnungsmodell -----------------------------------------------
  function berechne(eingabe) {
    const {
      investition, renditePct, zinsPct, laufzeitJahre, betriebskosten, steuersatzPct,
    } = eingabe;

    const jahresBrutto = investition * (renditePct / 100);
    const jahresVorSteuer = jahresBrutto - betriebskosten;
    const jahresSteuer = Math.max(0, jahresVorSteuer) * (steuersatzPct / 100);
    const jahresCashflow = jahresVorSteuer - jahresSteuer;
    const monatsCashflow = jahresCashflow / 12;
    const monatsZins = zinsPct / 100 / 12;

    const gesamtMonate = laufzeitJahre * 12;
    let kumuliert = 0;
    let kumuliertAbgezinst = 0;
    let paybackMonat = null;
    const monatsListe = [];

    for (let m = 1; m <= gesamtMonate; m++) {
      const vorherAbgezinst = kumuliertAbgezinst;
      kumuliert += monatsCashflow;
      const abgezinsterMonat = monatsCashflow / Math.pow(1 + monatsZins, m);
      kumuliertAbgezinst += abgezinsterMonat;

      if (paybackMonat === null && kumuliertAbgezinst >= investition) {
        const differenz = kumuliertAbgezinst - vorherAbgezinst;
        const anteil = differenz !== 0 ? (investition - vorherAbgezinst) / differenz : 1;
        paybackMonat = (m - 1) + Math.max(0, Math.min(1, anteil));
      }

      if (m <= 12) {
        monatsListe.push({ monat: m, cashflow: monatsCashflow, kumuliert, fortschritt: Math.min(1, kumuliert / investition) });
      }
    }

    const jahresListe = [];
    let jKumuliert = 0;
    let jKumuliertAbgezinst = 0;
    for (let j = 1; j <= laufzeitJahre; j++) {
      jKumuliert += jahresCashflow;
      let jAbgezinstSumme = 0;
      for (let m = (j - 1) * 12 + 1; m <= j * 12; m++) {
        jAbgezinstSumme += monatsCashflow / Math.pow(1 + monatsZins, m);
      }
      jKumuliertAbgezinst += jAbgezinstSumme;
      jahresListe.push({
        jahr: j,
        brutto: jahresBrutto,
        betrieb: betriebskosten,
        steuer: jahresSteuer,
        cashflow: jahresCashflow,
        kumuliert: jKumuliert,
        kumuliertAbgezinst: jKumuliertAbgezinst,
      });
    }

    return {
      paybackMonat,
      gesamtMonate,
      cashflowGesamt: jahresCashflow * laufzeitJahre,
      steuerProJahr: jahresSteuer,
      steuerGesamt: jahresSteuer * laufzeitJahre,
      monatsListe,
      jahresListe,
    };
  }

  // ---- Rendern ----------------------------------------------------------
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function animiereZahl(zielJahre, zielMonate, callback) {
    const zielGesamt = zielJahre + zielMonate / 12;
    if (reduceMotion || zielGesamt <= 0) {
      callback(zielGesamt);
      return;
    }
    const start = performance.now();
    const dauer = 600;
    function schritt(jetzt) {
      const t = Math.min(1, (jetzt - start) / dauer);
      const ease = 1 - Math.pow(1 - t, 3);
      callback(zielGesamt * ease);
      if (t < 1) requestAnimationFrame(schritt);
    }
    requestAnimationFrame(schritt);
  }

  function formatJahreMonate(gesamtJahreDezimal) {
    const gesamtMonateGerundet = Math.round(gesamtJahreDezimal * 12);
    const jahre = Math.floor(gesamtMonateGerundet / 12);
    const monate = gesamtMonateGerundet % 12;
    if (jahre === 0) return `${monate} Mon.`;
    if (monate === 0) return `${jahre} J.`;
    return `${jahre} J. ${monate} Mon.`;
  }

  function renderMonatstabelle(liste) {
    const tbody = document.getElementById('monatstabelle-body');
    tbody.innerHTML = '';
    liste.forEach((zeile) => {
      const tr = document.createElement('tr');
      const cfKlass = zeile.cashflow < 0 ? ' class="negativ"' : '';
      tr.innerHTML = `
        <td>${zeile.monat}</td>
        <td${cfKlass}>${eurFein.format(zeile.cashflow)}</td>
        <td>${eur.format(zeile.kumuliert)}</td>
        <td class="chart-col"><span class="balken-spur"><span class="balken-fuellung" style="width:${Math.round(zeile.fortschritt * 80)}px"></span></span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderJahrestabelle(liste) {
    const tbody = document.getElementById('jahrestabelle-body');
    const tfoot = document.getElementById('jahrestabelle-foot');
    tbody.innerHTML = '';
    let sBrutto = 0, sBetrieb = 0, sSteuer = 0, sCashflow = 0;
    liste.forEach((z) => {
      sBrutto += z.brutto; sBetrieb += z.betrieb; sSteuer += z.steuer; sCashflow += z.cashflow;
      const tr = document.createElement('tr');
      const cfKlass = z.cashflow < 0 ? ' class="negativ"' : '';
      tr.innerHTML = `
        <td>${z.jahr}</td>
        <td>${eur.format(z.brutto)}</td>
        <td>${eur.format(z.betrieb)}</td>
        <td>${eur.format(z.steuer)}</td>
        <td${cfKlass}>${eur.format(z.cashflow)}</td>
        <td>${eur.format(z.kumuliert)}</td>
        <td>${eur.format(z.kumuliertAbgezinst)}</td>
      `;
      tbody.appendChild(tr);
    });
    const letztes = liste[liste.length - 1];
    tfoot.innerHTML = `
      <tr>
        <td>Summe</td>
        <td>${eur.format(sBrutto)}</td>
        <td>${eur.format(sBetrieb)}</td>
        <td>${eur.format(sSteuer)}</td>
        <td>${eur.format(sCashflow)}</td>
        <td>${eur.format(letztes.kumuliert)}</td>
        <td>${eur.format(letztes.kumuliertAbgezinst)}</td>
      </tr>
    `;
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    fehlerEl.textContent = '';

    const investition = parseFloat(document.getElementById('investition').value);
    const renditePct = parseFloat(document.getElementById('rendite').value);
    const zinsPct = parseFloat(document.getElementById('zinssatz').value);
    const laufzeitJahre = Math.max(1, Math.min(30, parseInt(document.getElementById('laufzeit').value, 10) || 10));
    const betriebskosten = parseFloat(document.getElementById('betriebskosten').value) || 0;
    const steuersatzPct = parseFloat(document.getElementById('steuersatz').value) || 0;

    if (!(investition > 0) || Number.isNaN(renditePct) || Number.isNaN(zinsPct)) {
      fehlerEl.textContent = 'Bitte Anfangsinvestition, erwartete Rendite und Zinssatz ausfüllen.';
      return;
    }

    const ergebnis = berechne({ investition, renditePct, zinsPct, laufzeitJahre, betriebskosten, steuersatzPct });

    const kzAmortisation = document.getElementById('kz-amortisation');
    if (ergebnis.paybackMonat === null) {
      kzAmortisation.textContent = `> ${laufzeitJahre} J.`;
    } else {
      const zielJahre = Math.floor(ergebnis.paybackMonat / 12);
      const zielMonate = ergebnis.paybackMonat % 12;
      animiereZahl(zielJahre, zielMonate, (aktuellerWert) => {
        kzAmortisation.textContent = formatJahreMonate(aktuellerWert);
      });
    }

    document.getElementById('kz-cashflow').textContent = eur.format(ergebnis.cashflowGesamt);

    const steuerZeile = document.getElementById('steuer-zeile');
    if (steuersatzPct > 0) {
      steuerZeile.textContent = `Steuersatz ${proz.format(steuersatzPct)} % → Steuerlast pro Jahr ${eur.format(ergebnis.steuerProJahr)}, über die Laufzeit gesamt ${eur.format(ergebnis.steuerGesamt)}.`;
    } else {
      steuerZeile.textContent = 'Kein Steuersatz angesetzt (0 %) — Cashflow entspricht dem Ergebnis vor Steuern.';
    }

    renderMonatstabelle(ergebnis.monatsListe);
    renderJahrestabelle(ergebnis.jahresListe);

    wrapper.classList.add('offen');
    document.getElementById('ergebnis').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  });
})();
