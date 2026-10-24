# TeslaSound: geringe Latenz und V8-Sound

## Ziel und Kontext
Die bestehende GitHub-Pages-Seite spielt im Tesla-Browser synthetischen V8-Sound zur GPS-Geschwindigkeit ab. Gewünscht sind schnellere Reaktionen, die Erkennung von Beschleunigen, Verzögern, konstanter Fahrt und Stand sowie ein deutlich organischerer Klang. Es gibt keinen Zugriff auf CAN, Pedale oder Tesla-Fahrzeugtelemetrie. GPS bleibt die physische Grenze der Reaktionszeit; Vorhersage ist eine Schätzung.

## Ansatz
Eine reine Optimierung der bisherigen Oszillatoren beseitigt weder die Abhängigkeit vom Rendering noch deren gleichförmigen Klang. Fahrzeugtelemetrie würde die Eingabeverzögerung stärker reduzieren, setzt aber zusätzliche Hardware/Server voraus und ist für diese statische Website kein verfügbarer Eingang. Gewählt wird deshalb eine vollständig lokale Web-Audio-Engine mit AudioWorklet, zeitgestempelter GPS-Schätzung und begrenzter Vorhersage. Native Web-Audio-Knoten dienen als Rückfall, falls Worklets nicht verfügbar sind.

## Verhalten und Grenzen
- Keine Build-Schritte oder Laufzeitabhängigkeiten, relative Module für GitHub Pages.
- GPS: echte Messzeit statt Callback-Zeit, Qualität prüfen, Ausreißer und falsche Reihenfolge abweisen, Positionsdifferenzen nur bei ausreichender Genauigkeit nutzen. Beschleunigung mit zeitabhängiger Filterung und kurzer Vorhersage, keine unbegrenzte Extrapolation.
- Fahrzustände: Stand, Beschleunigen, konstant, Verzögern und unbekannt. Hysterese und kurze Bestätigung verhindern Flattern. Bremsen und Rekuperation sind anhand von GPS nicht unterscheidbar.
- Veraltete/fehlende Daten nehmen Last zurück. Testmodus ist strikt von GPS isoliert, besitzt Gas und Bremse und setzt beim Wechsel die Schätzung zurück.
- Audio: interaktive Latenz anfordern; Zündimpulse eines Viertakt-V8 mit zwei ungleichmäßig pulsierenden Bänken, Ansaugrauschen, Auspuffresonanzen, dezente Lastwechsel und Schaltpausen. Gleichanteil entfernen, Pegel begrenzen, Start/Stop ausblenden. Bass verändert Klang statt nur Gesamtlautstärke.
- Audio-Parameter laufen unabhängig vom UI-Rendering in einem 20-ms-Regeltakt. Der Worklet rendert kontinuierlich im Audio-Thread. Native Fallback-Knoten haben keinen ScriptProcessor-Puffer.
- Diagnose unterscheidet GPS-Intervall, Messwertalter, Audio-Ausgabelatenz und 20-ms-Regeltakt; keine erfundene Gesamt-Latenz. Keine Tesla-Hardwaremessung möglich.

## Überprüfung
Deterministische Tests für Fahrszenarien, GPS-Rauschen, fehlende Geschwindigkeit, schlechte Genauigkeit, Ausreißer, Zeitstempel, Ausfälle, Wiederanlauf, Ganghysterese sowie Signalstabilität und Lastabhängigkeit der Synthese. Echter Chromium-Smoke-Test für Start/Stop, Testmodus, Worklet, Fallback und GPS-Verarbeitung. Tests verwenden Node-Bordmittel; kein npm-Install nötig.

## Ergänzung: Handy mit Bluetooth-Ausgabe
Der Nutzer hat zusätzlich einen Handy-Modus angefordert. Ein gespeichertes Ausgabeprofil erklärt OS-Kopplung und Bluetooth-Medienroute, nutzt dieselbe lokale Engine mit Handy-GPS und fordert während der Wiedergabe optional Screen Wake Lock an. Unterstütztes Safari erhält die Playback-Audiokategorie. Stoppen, Aktivierungsfehler und verspätet erteilte Wake Locks müssen Ressourcen freigeben; die vorherige Audiokategorie wird wiederhergestellt. Kein Web-Bluetooth-Pairing, keine Behauptung einer geprüften Verbindung und keine Garantie über Bluetooth-Transportlatenz oder Hintergrundwiedergabe. Mobile Browser werden automatisch vorgeschlagen; die Auswahl bleibt manuell änderbar.
