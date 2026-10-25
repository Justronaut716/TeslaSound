# TeslaSound

## Vier Motor-Presets

Unter **Dein Sound → Motor-Preset** stehen vier eigenständige Syntheseprofile zur Auswahl:

| Preset | Charakter | Drehzahlbereich |
| --- | --- | --- |
| V8 Muscle | Tiefes, ungleichmäßiges Grollen und kräftiger Auspuffbass | 850–6800 RPM |
| Reihensechser Turbo | Weicher Sechszylinderlauf, Turbopfeifen und dezentes Ablasszischen | 780–7200 RPM |
| V10 Supercar | Heller, metallischer Hochdrehzahlklang | 1000–9000 RPM |
| V12 GT | Dichter, gleichmäßiger und sonorer Zwölfzylinderklang | 900–8200 RPM |

Die Presets verändern Zylinderzahl/Zündfrequenz, Impulscharakter, Resonanzen,
Ansauggeräusch und die virtuelle Drehzahlabstimmung. Sie funktionieren im
Tesla-Browser und im Handy-/Bluetooth-Modus sowie im nativen Audio-Rückfall.
Die Auswahl bleibt lokal gespeichert. Umschalten überblendet den Klang kurz,
ohne AudioContext, Geschwindigkeit, GPS-Empfang oder Gang zurückzusetzen.
Bei schnellen Änderungen gewinnt die letzte Auswahl; die Anzahl paralleler
Synthesizer bleibt begrenzt. Das sind fiktive synthetische Motorcharaktere,
keine Aufnahmen bestimmter Automodelle. Bitte nur im Stand auswählen.

Lokaler Motorsound-Simulator für den Tesla-Browser oder das Handy mit Bluetooth-Ausgabe auf GitHub Pages. Keine Installation, kein Backend, keine Tesla-Zugangsdaten und keine Übertragung der GPS-Positionen.

## Benutzen

Die HTTPS-Adresse von GitHub Pages öffnen, im Stand **Motor starten** antippen und Standortzugriff erlauben. Die Lautstärke zunächst niedrig einstellen. Für eine Probefahrt ohne Bewegung den **Testmodus** aktivieren: Gas, Bremse und **Tempo halten** demonstrieren die verschiedenen Fahrzustände. Der Testmodus deaktiviert die GPS-Abfrage vollständig; ein Moduswechsel setzt alte Messwerte zurück.

### GPS-Verbindung prüfen

GPS wird direkt beim Start angefragt, während Audio noch laden oder auf Freigabe
warten kann. Der GPS-Status steht zusätzlich direkt bei den Motorsteuerungen.
**GPS neu verbinden** ersetzt die Standortabfrage und verwirft alte Messwerte,
ohne die Audio-Engine neu zu starten. Bei verweigertem Standortzugriff muss die
Freigabe in den Browser-Einstellungen geändert werden.

**GPS empfangen / verarbeitet** zählt pro Verbindung die eingegangenen und
brauchbaren Messwerte. Bei **0 / 0** sind noch keine Standortdaten vom Browser
eingetroffen. Steigt nur die erste Zahl, meldet der GPS-Status den Grund für
fehlende Verarbeitung (beispielsweise ungenaue/alte Daten oder noch fehlende
Geschwindigkeit). **Letzte GPS-Lieferung** zeigt Alter und Positionsgenauigkeit
auch für verworfene Daten. Im Testmodus ist GPS ausgeschaltet. Standortdaten bleiben lokal.

Die Verarbeitung verwendet kein `Array.prototype.at`, damit weitere Messwerte
auch auf älteren eingebetteten Chromium-Versionen verarbeitet werden können.
Der GPS-Browsertest schaltet diese API gezielt ab und prüft mehrere Messungen.

GPS-Zeitstempel in Unix-Sekunden nahe der Browser-Uhr werden vor der Altersprüfung
in Millisekunden umgerechnet. Die diagnostische Angabe „GPS-Zeit in Sekunden
normalisiert“ macht das sichtbar. Ein Test bildet den fotografierten Fehler von
`1752186186.7 s` exakt nach; korrekt beträgt das Messwertalter dort 826 ms.
Relative Zeitstempel mit unbekanntem Ursprung werden nicht von `Date.now()`
abgezogen: Die Anzeige kennzeichnet unbekanntes Alter und nutzt die Empfangszeit,
ohne Vorhersage. Positive Rohzeitstempel bleiben für Reihenfolge- und
Duplikatprüfung erhalten; wiederholte relative Werte erneuern die Engine nicht.
Ein Sekundenwert wird nur bei plausibler zeitlicher Nähe (24 h) zur Browser-Uhr
als Unix-Zeit erkannt; andere kleine Werte bleiben ausdrücklich unbekannte
Zeitbasen. Die normale Fünf-Sekunden-Grenze bleibt für erkennbare Messzeiten aktiv.

## Was die Reaktion beschleunigt

### Handy → Bluetooth im Tesla

Unter **Gerät & Ausgabe** den Modus **Handy → Bluetooth im Tesla** wählen (auf üblichen Handys automatisch vorbelegt; die Auswahl wird lokal gespeichert). Handy und Tesla über die Systemeinstellungen koppeln, im Tesla die Bluetooth-Medienquelle und im Handy den Tesla als Audioausgabe wählen. Dann diese Website **auf dem Handy** öffnen und Motor/Standort starten. Die Website nutzt nun die GPS-Daten des Handys. Der Lautsprechertest hilft, die tatsächlich gewählte Ausgabe zu prüfen.

Der Browser kann Bluetooth-Lautsprecher nicht über die Web-Bluetooth-API koppeln oder deren Verbindung zuverlässig feststellen. Er gibt Audio über die vom Betriebssystem gewählte Route aus. Der Modus zeigt deshalb keine erfundene „Verbunden“-Anzeige an. Ohne gewählte Bluetooth-Ausgabe spielt der Ton über das Handy. Bluetooth puffert zusätzlich; diese Transportlatenz ist durch die Website nicht beseitigbar und wird von `baseLatency`/`outputLatency` nicht auf jedem Gerät vollständig erfasst.

Während der Wiedergabe fordert der Handy-Modus optional eine **Screen Wake Lock** an. Ist sie nicht verfügbar oder wird sie verweigert, funktioniert Audio weiter; der Bildschirm muss dann manuell aktiv bleiben. Beim Stoppen wird die Sperre freigegeben, bei Rückkehr in die sichtbare Seite nach Möglichkeit erneut angefordert. Auf unterstützten Safari-Versionen wird `navigator.audioSession.type = 'playback'` gesetzt und beim Stoppen wiederhergestellt. Nach Anrufen, App-Wechsel oder Wechsel der Audioausgabe kann **Audio fortsetzen** nötig sein. Browser im Vordergrund lassen; Hintergrund- und Sperrbildschirmwiedergabe werden nicht garantiert.

### Verarbeitung

- `AudioContext({latencyHint: 'interactive'})` fordert eine kleine Audiopufferung an; die tatsächliche Puffergröße bestimmt der Browser.
- Ein `AudioWorklet` erzeugt den Klang kontinuierlich im Audio-Thread. Ein 20-ms-Regeltakt und sofortige Updates bei GPS-Ereignissen ersetzen die bisherige Kopplung an `requestAnimationFrame`. Die Anzeige wird nur mit etwa 10 Hz aktualisiert.
- Die Motorlast reagiert auf neue Beschleunigungswerte, bevor die Fahrzustandsanzeige ihre 120-ms-Bestätigung beendet. Audioparameter werden ohne wachsende Scheduling-Warteschlange aktualisiert. Kurze Rampen vermeiden Klicks.
- Geschwindigkeit und Beschleunigung werden anhand der **Messzeitstempel** berechnet. Eine Vorhersage von höchstens **350 ms** überbrückt einen Teil des Abstands zwischen Messungen. Es gibt keine zusätzliche Geschwindigkeitsglättung pro Bildschirmframe.
- Fehlende GPS-Geschwindigkeit kann durch ausreichend genaue Positionsänderungen ersetzt werden. Diese Schätzung ist träger und ungenauer als eine vom Browser gemeldete Geschwindigkeit und wird als solche angezeigt.
- Eine vom Browser gelieferte Geschwindigkeit wird getrennt von der horizontalen **Positionsgenauigkeit** geprüft: Eine grobe Position allein verwirft die Geschwindigkeit nicht mehr. Negative/ungültige Geschwindigkeiten, mehr als 5 s alte, falsch sortierte Messungen und unplausible Sprünge werden weiter verworfen; der Status nennt den genauen Grund und die Werte.
- Fehlt eine Geschwindigkeit, darf die Positionsberechnung bis 250 m Unsicherheit arbeiten. Sie verwendet das kürzeste auflösbare Fenster von höchstens 10 s. Eine Bewegung muss die gemeinsame Positionsunsicherheit übersteigen; bei groben Positionen kann das länger dauern. Bleibt sie darunter, wird keine Beschleunigung erfunden.
- Nach 1,8–3 s ohne neue verwertbare Daten (abhängig vom Messintervall) geht die Engine in den Leerlauf. Eine schon bei Ankunft bestehende Verzögerung bleibt als tatsächliches Messwertalter sichtbar und wird nicht nochmals als Empfangsausfall gewertet. Fehlende/ungültige Zeitstempel werden ausdrücklich als **Messzeit unbekannt** markiert; dann wird die Empfangszeit genutzt und die Vorhersage deaktiviert. Zeitquellen werden nicht miteinander differenziert. Hysterese verhindert ständige Wechsel bei GPS-Rauschen und an Ganggrenzen.

**GPS bleibt die Latenzgrenze.** Bei beispielsweise einem GPS-Fix pro Sekunde kann eine gerade beginnende Beschleunigung erst beim nächsten Fix beobachtet werden. Eine Website kann weder die GPS-Rate erzwingen noch Pedalbewegungen vorhersagen. Niedrige Audio-Latenz ist keine Garantie für eine ebenso niedrige Verzögerung vom Pedal bis zum Ton. Die Diagnose zeigt deshalb GPS-Intervall, Datenalter, `baseLatency` und `outputLatency` getrennt. Nicht vom Browser gelieferte Latenzwerte bleiben als „Nicht gemeldet“ gekennzeichnet.

Für wesentlich frühere Reaktion wäre eine zusätzliche lokale Datenquelle mit hoher Aktualisierungsrate nötig, z. B. geeignete Fahrzeugtelemetrie über eine lokale Bridge. Tesla-Cloud-Polling fügt Netzwerklatenz hinzu und ersetzt keinen direkten Pedalzugriff. Diese Version benötigt keine solche Hardware und implementiert keine Verbindung zu CAN oder Tesla-APIs.

## Fahrzustände und Klang

Erkannt werden **Stand**, **Beschleunigen**, **konstante Fahrt**, **Verzögern/Ausrollen** und **keine aktuellen Fahrdaten**. GPS zeigt Geschwindigkeitsänderungen, aber keine Brems- oder Gaspedalstellung: Reibungsbremse, Rekuperation, Steigung und Ausrollen lassen sich damit nicht sicher unterscheiden. Die angezeigte Beschleunigung und Motorlast sind Schätzungen.

Der V8-Synthesizer modelliert acht Zündereignisse je 720° mit ungleichmäßigen Impulsabständen in zwei Zylinderbänken, kleinen Zylinderabweichungen, Auspuffresonanzen, lastabhängigem Ansauggeräusch und zurückhaltender Schubtextur. Ein virtuelles Sechsganggetriebe besitzt Hysterese und kurze Lastunterbrechungen beim Schalten. Der Bassregler beeinflusst die Resonanzbalance. DC-Filter, Soft-Limiter sowie Ein-/Ausblendung begrenzen Pegel und vermeiden harte Übergänge.

Falls der Tesla-Browser kein funktionierendes AudioWorklet bereitstellt, startet automatisch ein nativer Web-Audio-Rückfall mit zwei Zylinderbank-Wellenformen, Rauschanteil und Filtern. Dieser klingt anders als die vollständige Synthese; die aktive Engine erscheint in der Diagnose. Es gibt keinen `ScriptProcessor`-Rückfall mit großem JavaScript-Audiopuffer. Pausiert der Browser die Audiowiedergabe, erscheint **Audio fortsetzen**. Hintergrundwiedergabe ist vom Tesla-Browser abhängig und nicht garantiert.

## Entwicklung und Tests

Alle Pfade sind relativ; der Inhalt kann unverändert im Repository-Unterpfad von GitHub Pages ausgeliefert werden. Kein Build und kein `npm install` nötig.

```sh
# Node.js 24+
npm test

# Lokalen HTTP-Server starten und im Browser öffnen
python3 -m http.server 8000
```

Die deterministischen Tests prüfen Fahrszenarien, Rauschen, GPS-Ausfälle und Zeitstempel, Positions-Fallback, Ganghysterese, frühe Lastreaktion sowie Audiostabilität, Gleichanteil, Last- und Basswirkung bei 44,1/48 kHz.

Der Integrationstest verwendet echtes Chromium und Python Playwright (nur als Entwicklungswerkzeug):

```sh
python3 -m pip install playwright
python3 -m playwright install chromium
npm run test:browser
```

Ein bereits installiertes `chromium` wird automatisch verwendet. Alternativ `CHROMIUM_PATH` auf eine Browser-Binärdatei setzen. Ohne System-Chromium nutzt Playwright seinen installierten Browser. Der Test prüft beide Audio-Engines, simulierte und GPS-basierte Fahrzustände, Datenverlust, Berechtigungsfehler, Pause/Fortsetzen, Neustart und Ressourcenfreigabe. Screenshots landen im ignorierten Verzeichnis `artifacts/`.

### Prüfung im Fahrzeug

Chromium-Tests sind keine Messung im Tesla. Vor der Verwendung im Tesla im Stand den Lautsprechertest und die simulierte Probefahrt prüfen. Bei einer anschließenden Überprüfung als Beifahrer GPS-Intervall, Datenalter, den gewählten Audio-Modus und hörbare Verzögerung beobachten. Ob der konkrete Tesla-Browser GPS-Geschwindigkeit oder nur Positionen bereitstellt und wie schnell seine Audioausgabe reagiert, kann nur dort festgestellt werden.

## Dateien

| Datei | Aufgabe |
| --- | --- |
| `js/driving-model.js` | GPS-Prüfung, Geschwindigkeitsschätzung, Fahrzustände |
| `js/gps-input.js` | GPS-Eingabe, getrennte Qualitätsprüfung und Rohdaten-Diagnose |
| `js/drivetrain.js` | Last, Drehzahl, virtuelle Schaltvorgänge |
| `js/v8-synth.js` | Deterministischer V8-Signalprozessor |
| `js/engine-worklet.js` | Audio-Thread und AudioParams |
| `js/audio-engine.js` | Audiograph, nativer Rückfall, Diagnose, Lebenszyklus |
| `js/app.js` | GPS, Testmodus, Regeltakt und Bedienoberfläche |
| `js/phone-playback.js` | Handy-Audiokategorie und optionaler Bildschirmschutz |
| `js/engine-presets.js` | Gemeinsame Klang-, Zylinder- und Drehzahleinstellungen |
| `js/engine-synth.js` | Begrenzte Überblendung zwischen Motorcharakteren |
