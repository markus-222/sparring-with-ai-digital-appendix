## 1. Executive Summary
- **Ausgangslage:** Das Lernangebot von Nordwerk ist auf CampusOne, Wiki und SharePoint verstreut und wird wenig genutzt [[doc:Projektauftrag Lernoffensive 2027.md]]. CampusOne ist bei 18 % der 650 Lizenzen aktiv, der Vertrag endet am 30.06.2027 [[doc:Protokoll BL-Runde.md]]. Geschäftlicher Auslöser: 2025 gingen 7 von 19 öffentlichen Verfahren verloren oder wurden abgewertet, weil Nachweise (BIM, PM) fehlten [[doc:Protokoll BL-Runde.md]].
- **Ziel:** Die Geschäftsführung will die Weiterbildungsquote von 34 % auf 70 % steigern, für alle 1.150 Mitarbeitenden. Die Anbieterauswahl soll in sechs Wochen abgeschlossen sein, der Go-live ist für Q3 2027 geplant [[doc:Projektauftrag Lernoffensive 2027.md]].
- **Geplante Lösung:** Ein zentrales LMS mit Katalog und Suche, Gamification (Punkte, Abzeichen, Ranking), Lernpfaden je L-Stufe, Zertifikatspfaden und Dashboards für Führungskräfte [[doc:Projektauftrag Lernoffensive 2027.md]].
- **Kernbefund (Einschätzung auf Basis der Befragung):** Das größte Hindernis ist fehlende Zeit („keine Zeit im Projekt“: 64 %). Dazu kommen unklare Relevanz (47 %), ein unübersichtliches Angebot (39 %) und fehlende Zertifikatsförderung (22 %) [[doc:Mitarbeiterbefragung 2026.md]]. Das LMS adressiert vor allem die Unübersichtlichkeit, Zeitmangel und Zertifikatsförderung bleiben offen. Das Ranking stößt auf Ablehnung (17 % Zustimmung, 52 % Ablehnung) [[doc:Mitarbeiterbefragung 2026.md]].
- **Widersprüche zwischen den Dokumenten:** Budget 250 T€ im Projektauftrag, laut Controlling für 2027 aber nur 120 T€ freigegeben. Zielgruppe 1.150 Mitarbeitende, Lizenzbedarf laut IT dagegen 900. Als führendes System für Rollen und L-Stufen nennen die Dokumente PersoNet beziehungsweise HRflow [[doc:Projektauftrag Lernoffensive 2027.md]] [[doc:Protokoll BL-Runde.md]]. Details in Abschnitt 6.
- **Zeitliches Risiko:** Single Sign-on ist zum Go-live Q3 2027 vorgesehen, die IdP-Migration ist laut IT aber nicht vor Q4/2027 möglich [[doc:Projektauftrag Lernoffensive 2027.md]] [[doc:Protokoll BL-Runde.md]].
- **Lücke bei den Zielen:** Die „Weiterbildungsquote“ ist in keinem Dokument definiert (Bezugsgröße, Zeitraum, Messmethode) [[doc:Projektauftrag Lernoffensive 2027.md]].

## 2. Kontext & Stakeholder
- **Initiale Ausgangslage:** Das Lernangebot liegt verteilt auf CampusOne, Nordwerk-Wiki und SharePoint, ohne gemeinsame Übersicht oder einheitliche Suche [[doc:Projektauftrag Lernoffensive 2027.md]]. CampusOne wird laut IT von 18 % der 650 Lizenzen aktiv genutzt (letzte 90 Tage); der Vertrag endet am 30.06.2027 [[doc:Protokoll BL-Runde.md]]. Die Auftraggeber prüfen Qualifikationen und Nachweise in Ausschreibungen genauer [[doc:Projektauftrag Lernoffensive 2027.md]].
- **Beteiligte Stakeholder-Klassen:**
  - Geschäftsführung (Dr. Henrike Albers, Jens Kröger) [[doc:Projektauftrag Lernoffensive 2027.md]]
  - Bereichsleitungen (BL), Teamleitungen (TL) [[doc:Projektauftrag Lernoffensive 2027.md]] [[doc:Protokoll BL-Runde.md]]
  - Personalentwicklung (J. Petersen) [[doc:Protokoll BL-Runde.md]]
  - IT-Services (T. Reimers) [[doc:Protokoll BL-Runde.md]]
  - Controlling (M. Brandt) [[doc:Protokoll BL-Runde.md]]
  - Betriebsrat (Befragung in Abstimmung durchgeführt) [[doc:Mitarbeiterbefragung 2026.md]]
  - Mitarbeitende, darunter Verwaltung / Zentrale Dienste, Teilzeitkräfte und Werkstudierende [[doc:Mitarbeiterbefragung 2026.md]]
  - Externer Projektpartner [[doc:Projektauftrag Lernoffensive 2027.md]]
  - Auftraggeber (öffentlich, rund 70 % der Projekte) [[doc:Projektauftrag Lernoffensive 2027.md]]

## 3. Problem Space

### 3.1 Beobachtete Symptome und Ursachen
- **Symptom:** Nachweise fehlen in Ausschreibungen: 7 von 19 öffentlichen Verfahren 2025 verloren oder abgewertet (BIM, PM); Freelancer-Kosten 2025 ca. 1,9 Mio. €, überwiegend BIM [[doc:Protokoll BL-Runde.md]]
  - Ursache: Nachweise werden zunehmend für benanntes Schlüsselpersonal gefordert [[doc:Protokoll BL-Runde.md]]. Wer BIM kann, ist erst bei der Angebotserstellung durch Rundfragen bekannt [[doc:Protokoll BL-Runde.md]].
    - Hypothese: Die Nachweise fehlen, weil der Erwerb von Zertifikaten nicht finanziert ist (Zertifizierungsbudget „kein Konsens“, Freitext „BIM-zertifikat würde ich sofort machen, wenn das jemand bezahlt“). BIM-Leistungen werden stattdessen extern eingekauft (Freelancer 2025 ca. 1,9 Mio. €, überwiegend BIM); zu prüfen. [[doc:Protokoll BL-Runde.md]] [[doc:Mitarbeiterbefragung 2026.md]]
- **Symptom:** Weiterbildungsquote 34 %, durchschnittlich 1,8 genutzte Lerntage 2025 (Selbstauskunft) bei fünf Lerntagen laut HR-Leitlinie [[doc:Projektauftrag Lernoffensive 2027.md]] [[doc:Mitarbeiterbefragung 2026.md]]
  - Ursache (stärkste Evidenz): keine Zeit im Projekt, 64 % Nennungen; Auslastung Jan–Okt 87 % bei Zielwert 85 % [[doc:Mitarbeiterbefragung 2026.md]] [[doc:Protokoll BL-Runde.md]]. Freitext: „mein TL sagt immer, lernen machen wir wenn das projekt durch ist. das projekt ist nie durch“ [[doc:Mitarbeiterbefragung 2026.md]]
    - Hypothese: Die Auslastungssteuerung (Zielwert 85 %, monatlicher Bericht der BL an die GF, BL-Zielvereinbarungen 2027 „unberührt“) und die Vorgabe „Qualifizierung bitte vorrangig in Bank-Zeiten“ lassen bei 87 % Auslastung praktisch keine Lernzeit zu. Die Leitlinie „5 Lerntage sind Arbeitszeit (nach Abstimmung mit der Teamleitung)“ läuft damit ins Leere; zu prüfen. [[doc:Protokoll BL-Runde.md]] [[doc:Projektauftrag Lernoffensive 2027.md]] [[doc:Mitarbeiterbefragung 2026.md]]
  - Ursache: unklar, was relevant ist, 47 %; nur 29 % wissen, welche Kompetenzen wichtig sind; Kompetenzmatrix Stand 2019 [[doc:Mitarbeiterbefragung 2026.md]] [[doc:Protokoll BL-Runde.md]]
  - Ursache: Angebot unübersichtlich, 39 % [[doc:Mitarbeiterbefragung 2026.md]]; Inhalte in Wiki und SharePoint ohne einheitliche Verschlagwortung [[doc:Protokoll BL-Runde.md]]
  - Ursache: fehlende Förderung von Zertifikaten, 22 % [[doc:Mitarbeiterbefragung 2026.md]]
- **Symptom:** CampusOne wird kaum genutzt [[doc:Projektauftrag Lernoffensive 2027.md]]
  - Ursache: Nicht in den Dokumenten spezifiziert. Einzelne Freitexte nennen fehlenden Zugang für Werkstudierende und unübersichtliche Systemlandschaft [[doc:Mitarbeiterbefragung 2026.md]].
- **Symptom:** Fluktuation 14 %, Top-Grund in Exit-Gesprächen Entwicklungsperspektive (41 %) [[doc:Protokoll BL-Runde.md]]
  - Ursache: Nicht in den Dokumenten spezifiziert.

### 3.2 Assumptions vs. Evidence
- **Annahme:** „Wenn das Angebot stimmt, kommt die Nutzung.“ [[doc:Projektauftrag Lernoffensive 2027.md]]
  - Evidenz: 58 % würden eine zentrale Lernplattform nutzen, aber 64 % nennen fehlende Zeit als Hindernis und 21 % haben ausreichend Zeit [[doc:Mitarbeiterbefragung 2026.md]]. Der Projektauftrag nennt die Lerntage-Leitlinie als bereits geschaffenen Zeitrahmen, genutzt wurden Ø 1,8 Tage [[doc:Projektauftrag Lernoffensive 2027.md]] [[doc:Mitarbeiterbefragung 2026.md]].
  - Konsequenz: Eine Plattform adressiert Auffindbarkeit; die Zeitbarriere bleibt ohne weitere Maßnahme bestehen.
- **Annahme:** Mitarbeitende wünschen sich spielerisches Lernen, Ranking sorge für Ansporn [[doc:Projektauftrag Lernoffensive 2027.md]]
  - Evidenz: Abzeichen motivieren 41 %, Ranglisten 17 % bei 52 % Ablehnung; Badges als gewünschte Funktion 15 % [[doc:Mitarbeiterbefragung 2026.md]]. Freitext: „ranking?? dann sieht mein BL ja genau wer nix macht“ [[doc:Mitarbeiterbefragung 2026.md]].
  - Konsequenz: Das Ranking steht gegen die Befragungswerte; Abzeichen haben geteilte Zustimmung.
- **Annahme:** Die Plattform kann die in Abschnitt 3.5 des Projektauftrags genannte Bedienung ohne gesonderte Schulung bieten und Rollen und L-Stufen aus PersoNet übernehmen [[doc:Projektauftrag Lernoffensive 2027.md]]
  - Evidenz: Laut IT ist HRflow seit 01/2026 führend für Stammdaten, Rollen und L-Stufen; PersoNet nur noch Lohnabrechnung [[doc:Protokoll BL-Runde.md]].
  - Konsequenz: Die Datenquelle für Rollen und L-Stufen ist zu klären (siehe CONFLICT in 6).
- **Annahme:** Die Zertifikatspfade schließen die Lücke bei Ausschreibungen [[doc:Projektauftrag Lernoffensive 2027.md]]
  - Evidenz: Fehlende Nachweise betreffen BIM und PM [[doc:Protokoll BL-Runde.md]]. Zertifikatsförderung nennen 22 % als Hindernis; das Zertifizierungsbudget ist ohne Konsens [[doc:Mitarbeiterbefragung 2026.md]] [[doc:Protokoll BL-Runde.md]].
  - Konsequenz: Der Erwerb der Nachweise hängt an der Finanzierung, die das LMS nicht regelt.

### 3.3 Problem Statement
Nordwerk erreicht bei der Weiterbildung 34 % Quote und verliert Ausschreibungen wegen fehlender Nachweise für Schlüsselpersonal (7 von 19 Verfahren 2025). Bei der Weiterbildung ist die fehlende Zeit im Projekt am stärksten belegt (64 % Nennungen, 87 % Auslastung bei Zielwert 85 %). Es folgen unklare Relevanz und Kompetenzanforderungen (47 %; Kompetenzmatrix Stand 2019, Aktualisierung mangels PE-Kapazität offen), ein unübersichtliches Angebot (39 %) und fehlende Zertifikatsförderung (22 %). Bei den Ausschreibungen kommen hinzu: Qualifikationen sind erst durch Rundfragen bei der Angebotserstellung bekannt, und das Zertifizierungsbudget ist ohne Konsens, während BIM extern eingekauft wird (ca. 1,9 Mio. €). Die geplante Lernplattform adressiert die Unübersichtlichkeit sowie über Lernpfade teilweise die Relevanz. Zeitmangel, Zertifikatsfinanzierung und die Qualifikationsübersicht für Angebote adressiert sie nicht oder nur teilweise. Zu den Ursachen der geringen CampusOne-Nutzung und der Fluktuation liegt keine gesicherte Ursachenangabe vor.

## 4. Ziele & Erfolgskriterien
- **Wirkungsziele (Outcome):** Weiterbildungsquote von 34 % auf 70 % [[doc:Projektauftrag Lernoffensive 2027.md]]
- ? UNCLEAR: „deutlich mehr Weiterbildung“ sowie die Zielformulierungen zu Plattformqualität und Bedienung in Abschnitt 2 und 3.5 [[doc:Projektauftrag Lernoffensive 2027.md]]. Kein Messwert in einem Dokument.
- ? UNCLEAR: Definition der „Weiterbildungsquote“ (Bezugsgröße, Zeitraum, Messmethode) fehlt in allen Dokumenten [[doc:Projektauftrag Lernoffensive 2027.md]].
- **Abgleich:** Teilweise. Die Plattform adressiert Unübersichtlichkeit (39 %), nicht aber Zeitmangel (64 %) und fehlende Zertifikatsförderung (22 %).

## 5. Scope Definition

### 5.1 In Scope
- Zentrales LMS für E-Learnings, Präsenzschulungen, Fachvorträge, Webinare und interne Unterlagen mit Suche, Katalog, Anmeldung und Lernhistorie [[doc:Projektauftrag Lernoffensive 2027.md]]
- Gamification: Punkte, Abzeichen, standortübergreifendes Ranking [[doc:Projektauftrag Lernoffensive 2027.md]]
- Lernpfade je L-Stufe auf Basis der Kompetenzmatrix und Zertifikatspfade [[doc:Projektauftrag Lernoffensive 2027.md]]
- Dashboard und Auswertungen für TL, BL und Geschäftsführung sowie Bericht zur Weiterbildungsquote [[doc:Projektauftrag Lernoffensive 2027.md]]
- Single Sign-on [[doc:Projektauftrag Lernoffensive 2027.md]]
- Anbieterauswahl mit technischen Kriterien der IT [[doc:Protokoll BL-Runde.md]]

### 5.2 Zu klären
- Zeitmangel im Projekt (64 %): Der Projektauftrag enthält keine Maßnahme dazu [[doc:Mitarbeiterbefragung 2026.md]]
- Unklare Relevanz der Kompetenzen (47 %) und veraltete Kompetenzmatrix Stand 2019 als Grundlage der Lernpfade [[doc:Protokoll BL-Runde.md]]
- Fehlende Zertifikatsförderung (22 %) und Zertifizierungsbudget ohne Konsens [[doc:Protokoll BL-Runde.md]]
- Zugang für Zielgruppen ohne CampusOne-Zugang (Werkstudierende), Verwaltung, Teilzeitkräfte und Standorte außerhalb Hamburgs [[doc:Mitarbeiterbefragung 2026.md]] [[doc:Protokoll BL-Runde.md]]
- Ursachen der Fluktuation (Entwicklungsperspektive 41 %) [[doc:Protokoll BL-Runde.md]]
- Umgang mit Wiki und SharePoint, die bestehen bleiben [[doc:Protokoll BL-Runde.md]]
- Wunschfunktionen der Befragung (App fürs Handy 46 %, KI-Empfehlungen 33 %, Teams-Integration 31 %) sind im Projektauftrag nicht aufgegriffen [[doc:Mitarbeiterbefragung 2026.md]]
- VR-Training zur Baustellensicherheit als „Leuchtturm“: Zugehörigkeit zum Projekt nicht festgelegt [[doc:Projektauftrag Lernoffensive 2027.md]]

### 5.3 Out of Scope
- Nicht in den Dokumenten spezifiziert.

## 6. Project Requirements & Constraints
- **Technologische Constraints:**
  - ⚠ CONFLICT: Führendes System für Rollen und L-Stufen: PersoNet [[doc:Projektauftrag Lernoffensive 2027.md]] vs. HRflow (PersoNet nur noch Lohnabrechnung) [[doc:Protokoll BL-Runde.md]]
  - Wiki und SharePoint bleiben bestehen [[doc:Protokoll BL-Runde.md]]
  - Migration IdP nicht vor Q4/2027, Kapazität IT-Services gebunden; Single Sign-on zum Go-live Q3 2027 [[doc:Protokoll BL-Runde.md]] [[doc:Projektauftrag Lernoffensive 2027.md]]
  - Keine doppelte Datenpflege [[doc:Projektauftrag Lernoffensive 2027.md]]
- **Projekt-Rahmenbedingungen:**
  - ⚠ CONFLICT: Budget: 250 T€ (Lizenzen, Einführung, Content) [[doc:Projektauftrag Lernoffensive 2027.md]] vs. 2027 freigegeben 120 T€, Rest erst nach Business Case [[doc:Protokoll BL-Runde.md]]
  - ⚠ CONFLICT: Lizenzbedarf: 1.150 Mitarbeitende als Zielgruppe [[doc:Projektauftrag Lernoffensive 2027.md]] vs. 900 Lizenzen (Projektpersonal lt. PlanBoard) [[doc:Protokoll BL-Runde.md]]
  - Anbieterauswahl in sechs Wochen ab 04.11.2026, Go-live Q3 2027 [[doc:Projektauftrag Lernoffensive 2027.md]]
  - CampusOne-Vertrag endet 30.06.2027 [[doc:Protokoll BL-Runde.md]]
  - Qualifizierung vorrangig in Bank-Zeiten [[doc:Protokoll BL-Runde.md]]; HR-Leitlinie mit fünf Lerntagen als Arbeitszeit nach Abstimmung mit der Teamleitung [[doc:Projektauftrag Lernoffensive 2027.md]]
  - Mittel über Kostenstelle PE; BL-Zielvereinbarungen 2027 unberührt [[doc:Protokoll BL-Runde.md]]
  - Workshop-Teilnahme: je Bereich eine Person, Benennung durch BL [[doc:Protokoll BL-Runde.md]]
- **Risiken:**
  - PE-Kapazität derzeit gebunden (Onboarding, Befragung) [[doc:Protokoll BL-Runde.md]]
  - Zeitpunkt Go-live Q3 2027 gegenüber IdP-Migration nicht vor Q4/2027 [[doc:Protokoll BL-Runde.md]]
  - Abwanderung: „wenn sich da nix tut bin ich nächstes jahr weg“ (einzelne Freitextaussage) [[doc:Mitarbeiterbefragung 2026.md]]
  - Ranking: Ablehnung 52 % [[doc:Mitarbeiterbefragung 2026.md]]
  - Befragung mit Rücklauf 53 %, freiwillig, Selbstauskunft ohne Abgleich [[doc:Mitarbeiterbefragung 2026.md]]
  - ? UNCLEAR: „nahtlos in unsere bestehende IT-Landschaft einfügen“ [[doc:Projektauftrag Lernoffensive 2027.md]]. Kein messbares Kriterium genannt.