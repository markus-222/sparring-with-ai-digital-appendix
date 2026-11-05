# Bewertungsrubrik Lernoffensive Nordwerk

## 1 Grundlagen der Bewertung

Die Rubrik prüft, ob sich die in den Interviews berichtete Unterstützung in den Artefakten der Teilnehmenden zeigt. Die Interviews sind die Hauptdatenquelle; ein Befund gilt als gestützt, wenn Interviewaussage und Artefakt in dieselbe Richtung zeigen. Die drei Kundendokumente gehen als einzige an die Teilnehmenden.

Treatment (MAS-Prototyp) und Baseline (Single-LLM-Chatbot) erhalten dieselben Kundendokumente und dieselbe Aufgabe und haben 30 Minuten. Bezeichnungen: Kundendokumente **DOC1–DOC3**, Bewertungsdimensionen **R1–R8**, Artefakte der Teilnehmenden **01–03**.

| Dokument | Inhalt | Datei |
| --- | --- | --- |
| DOC1 | Projektauftrag „Lernoffensive 2027“ | `client_documents/project_mandate.pdf` |
| DOC2 | Protokoll der BL-Runde mit Controlling-Mail | `client_documents/minutes_division_heads_meeting.pdf` |
| DOC3 | Mitarbeiterbefragung 2026 (Auszug) | `client_documents/employee_survey_excerpt.pdf` |

**Kalibrierung:** Sonnet 5.5 bearbeitete die Aufgabe zweimal ohne Mensch (neuer Chat ohne Projekt und Memory, Aufgabenblatt und DOC1–DOC3, Prompt „Bearbeite die Aufgabe.“) und fand je 30/34 gestufte Elemente; PR-RA erhielt in beiden Läufen Wertung 1, PR-U3 wurde nicht gefunden (Deckeneffekt).

**Festlegungen zur Bewertung:**

- R7 misst die Sprachqualität nach den Smell-Definitionen von Femmer et al. (2017) und weist Funde mit Begriffen aus den Vorgaben des Prototyps getrennt aus, weil der Analyst des Prototyps seinen eigenen Text deterministisch auf Requirements Smells prüft (Abschnitt 5, R7).
- Bildinhalte zählen (Messregel „Bildinhalte“ in Abschnitt 4).
- Bewertung in Bögen je Person unter `scoring/`, Kennzahlen in `scoring/key_figures.md`; in `scoring/README.md` auch die Auslegungen, die diese Rubrik offenlässt.
- **Bewertung per LLM:** Die Artefakte bewertet Claude, nicht der Autor. Claude-Subagents (Claude Opus 5.5) erstellen einen ersten Durchgang mit wörtlichem Zitat je Treffer; frische Subagents prüfen jede Zeile in einem zweiten Durchgang gegen die Artefakte; Abweichungen und Grenzfälle entscheidet der Autor nach den Auslegungen in Abschnitt 5. Der Autor legt Rubrik und Auslegungen fest. Die Arbeitsunterlagen der Subagents wurden nach Abschluss nicht aufbewahrt; Fundstellen, Zitate und Begründungen stehen in den Bewertungsbögen.

**Umfang der Bewertung:** Die Artefakte sind Prüfquelle hinter den Interviews; der Aufwand folgt dieser Rolle. Die Fragenqualität (R4) wird nur für Fragen zu kritischen Klärungsbedarfen bewertet, die Faktentreue (R6) gezielt an den typischen Fehlerquellen geprüft. Beides bleibt erhalten, weil Gruppenunterschiede gerade dort erwartet werden (Deckeneffekt).

**Kein Abgleich Interview gegen Artefakt je Person:** N0 wird nicht mit der Kernaussage des Artefakts abgeglichen und nicht in den Bewertungsbögen eingeordnet. Die Ausgaben von Sonnet 5.5 allein werden nicht als Referenz bewertet; für den Deckeneffekt genügen die Kalibrierungszahlen oben.

## 2 Szenario und Grundwahrheit

Die Geschäftsführung rahmt ein Tool-Problem; das eigentliche Problem (Zeit, Anreize, Kompetenzsteuerung) steht leise in DOC2 und DOC3. Wer nur zusammenfassen lässt, übernimmt die Sicht des Auftraggebers; wer die Dokumente gegeneinander liest, findet das Kernproblem.

**Rahmenhandlung:** Die Teilnehmenden sind Requirements Engineer eines externen Dienstleisters, den Nordwerk (fiktiver Ingenieurdienstleister, 1.150 Mitarbeitende, 5 Standorte in Norddeutschland) für die „Lernoffensive 2027“ beauftragt hat. Vor dem ersten Workshop hat die Personalentwicklung drei Unterlagen geschickt.

### Kernproblem (Referenz für R5 und R6)

> Nordwerk fehlt es nicht in erster Linie an einer Lernplattform, sondern an **Zeit und Orientierung** für Weiterbildung. Die Steuerung über Auslastung lässt kaum Lernzeit zu. Außerdem ist unklar, welche Kompetenzen gebraucht werden, weil die Kompetenzmatrix veraltet und nicht mit Staffing und Vertrieb verknüpft ist. Deshalb fehlen Qualifikationen, die für Ausschreibungen nötig sind.

### Ursachenkette (von der tiefsten Ursache zur Wirkung)

1. **PR-U3 · Ursache 3 (L4):** Steuerung über Auslastung verdrängt Entwicklung. Ziel 85 %, Ist 87 %, BL berichten monatlich an GF, BL-Zielvereinbarungen (nur indirekt, AB-04).
2. **PR-U2 · Ursache 2 (L2):** Kompetenzmatrix Stand 2019, nicht mit Staffing und Vertrieb verknüpft („Wer BIM kann, wissen wir meist erst, wenn wir … rumfragen“).
3. **PR-U1 · Ursache 1 (L1):** keine Zeit im Projekt (64 %), unklar, was relevant ist (47 %).
4. **PR-S · Symptom (Sicht GF, nicht bewertet):** CampusOne zu 18 % aktiv genutzt, Angebote auf CampusOne, Wiki und SharePoint verstreut.
5. **PR-AW1–3 · Auswirkungen:** 7 von 19 öffentlichen Verfahren 2025 verloren oder abgewertet · Freelancer ca. 1,9 Mio. € · Fluktuation 14 %, Top-Austrittsgrund Entwicklungsperspektive (41 %).

### Was die Geschäftsführung richtig sieht

Der Plattformbedarf ist teilweise echt: Die Lizenz läuft aus, die Angebote sind verstreut, 58 % würden eine zentrale Plattform nutzen. Die Ausschreibungsverluste sind ein echtes, dringendes Problem. Eine gute Analyse erklärt das LMS deshalb nicht für falsch, sondern fragt, ob es **ausreicht**. Pauschale Ablehnung des LMS gilt nicht als Erkennen des Kernproblems.

### Schwierigkeitsstufen und Schichten

| Stufe | Leitfrage | Beispiel | Elemente |
| --- | --- | --- | --- |
| L1 offensichtlich | Was steht da? | verlorene Ausschreibungen | 12 (35 %) |
| L2 dokumentübergreifend | Was passt zwischen zwei Dokumenten nicht? | 5 Lerntage vs. „Bank-Zeiten“ | 14 (41 %) |
| L3 indirekt | Was folgt mit Fachwissen daraus? | Dashboard pro Person → Betriebsrat, Datenschutz | 6 (18 %) |
| L4 Rahmung | Ist das das richtige Problem? | Zeit, Anreize, Kompetenzsteuerung statt Tool | 2 (6 %) |

Die Stufen gehen nicht in die Rubrik ein; sie dienen der Kalibrierung (Boden- und Deckeneffekte) und einer ergänzenden Auswertung. Jedes Dokument hat eine **Überflieg-Schicht** (Titel, Zusammenfassung, Zielbox: Sicht der GF) und eine **Tiefenschicht** (Fließtext, Tabellenzeilen, Fußnoten, Freitexte, Mail), in der alle Hinweise auf L2–L4 liegen.

## 3 Aufgabe der Teilnehmenden (Sitzungsziel)

Die Teilnehmenden geben nach 30 Minuten drei Artefakte ab; bewertet wird dieser Stand.

| Ziel | Der RE hat am Ende … | Artefakt | Bewertet in |
| --- | --- | --- | --- |
| 1 Problemraum verstanden | Kernproblem lösungsneutral beschrieben · Ursachen über das erste Symptom hinaus und Auswirkungen benannt · Annahmen ausdrücklich gemacht und als geprüft oder offen gekennzeichnet · Widersprüche, Unklarheiten, Abhängigkeiten sichtbar gemacht, ohne sie aufzulösen · Scope festgelegt (in/out, offene Abgrenzungsfragen, ggf. Randbedingungen) | 01 Problem- und Scope-Definition | R2, R3, R5, R6, R8 |
| 2 Stakeholder bekannt | relevante Stakeholder identifiziert, auch indirekt und negativ betroffene · Interessen benannt · Lücken erkannt | 02 Stakeholder-Analyse | R1 |
| 3 Klärungsbedarf für den Workshop festgehalten | offene und unklare Punkte gesammelt, die der RE im Workshop klären muss: zu prüfende Annahmen, zu klärende Widersprüche und Unklarheiten, offene Abgrenzungsfragen · je Punkt eine Frage an den Stakeholder, der ihn klären kann · auf Ursachen und Bedürfnisse statt Features gerichtet | 03 Offene Punkte und Workshop-Fragen | R4 |

R7 (Sprachqualität) gilt für alle drei Artefakte (Abschnitt 5, R7). Die Tabelle beschreibt, woran die Artefakte gemessen werden, nicht wie sie aufzubauen sind: Form und Gliederung bestimmen die Teilnehmenden selbst (vgl. Messregel „Ort egal“). Angaben, die nicht bewertet werden (z. B. Einfluss, Quellenangaben), werden weder erwartet noch abgezogen.

## 4 Prüfung über die Artefakte: Messregeln

Gezählt wird der Inhalt der Artefakte 01–03 zum Stand Minute 30 gegen die Referenzelemente in Abschnitt 5. Diese Regeln gelten für alle Dimensionen.

| Regel | Festlegung |
| --- | --- |
| Ort egal | Inhalt zählt unabhängig von Artefakt oder Abschnitt; ein fehlender Abschnitt führt nicht zu Abzug. **Ausnahme:** PR-RA und PR-U3 werden nur an der Kernaussage zum Problem bzw. an der Ursachenkette geprüft (Abschnitt 5, R5) |
| Bildinhalte | Inhalt von Bildern (z. B. Karten) zählt wie Text; er wird vor der Bewertung abgeschrieben, die Abschrift liegt als `*-transcription.md` neben dem Bild |
| Treffer | inhaltlich gleichwertig genügt, der Wortlaut ist nicht nötig; Begriffe, die in den Dokumenten bewusst fehlen („Bonus“, „Datenschutz“), zählen normal |
| Zählung | jedes Element höchstens einmal je Dimension; eine Aussage kann mehrere Elemente treffen; dasselbe Element darf in mehreren Dimensionen zählen (z. B. Budget in R3 und R8) |
| 0/1/2-Urteile | 0 = nicht · 1 = teilweise · 2 = erfüllt; vergeben über die Ja/Nein-Prüfungen der Dimension, begründet mit einer Textstelle; berichtet werden Stufe und erfüllte Prüfungen |
| Nicht bewertete Inhalte | zählen weder im Score noch als zusätzliche Funde (Liste am Ende von Abschnitt 5). Leitet jemand daraus ein bewertetes Element ab, zählt dieses normal |
| Zusätzliche valide Funde | gesondert gezählt, wenn (a) nicht in Abschnitt 5, auch nicht unter „nicht bewertet“, und (b) in DOC1–DOC3 belegt oder mit Fachwissen zwingend daraus folgend |
| Verblindung | keine Verblindung, Begründung: Autor ist zugleich Entwickler und Interviewer |
| Kalibrierung | Element gilt als gefunden, wenn sein Trefferkriterium erfüllt ist; bei PR-RA erst Wertung 2 (Wertung 1 = teilweise) |
| Ankerbeispiele | je 0/1/2-Urteil ein Beispiel aus der Baseline, siehe „Ankerbeispiele“ unten |

### Ankerbeispiele

Aus den bewerteten Baseline-Bögen (Kennung des Bogens, Fundstelle im Artefakt). Stufen, die in der Baseline nicht vorkommen, sind vermerkt.

| Urteil | Stufe | Beispiel | Warum diese Stufe |
| --- | --- | --- | --- |
| PR-RA | 2 | kein Fall in der Baseline; Anker ist die Klärungsfrage an die GF in R5 | P1–P3 in der Kernaussage |
| PR-RA | 1 (P0–P2) | P13 01 §A1: „Das LMS ist ein Baustein in einer unterstützenden Domäne, nicht die Lösung des Kernproblems.“ Lernzeit „ist laut Daten aber der größte Engpass“ | Plattform begründet als nicht ausreichend, Zeit gewichtet; Ursachen nicht kausal verknüpft (P3 fehlt) |
| PR-RA | 1 (nur P0) | P11 01: „im Projektalltag fehlt die Zeit, vielen ist unklar, welche Kompetenzen für ihre Entwicklung relevant sind“ | Ursachen außerhalb des Tools genannt, aber weder Plattform als nicht ausreichend begründet noch gewichtet |
| PR-RA | 0 | kein Fall in der Baseline | nur Symptom oder Sicht der GF in der Kernaussage |
| R4 Qualität | 2 | P11 03:45: „Gelten 250 T€ (AUF) oder nur 120 T€ für 2027 (MAIL)?“, Adressat CTRL, GF | Q1–Q4 erfüllt |
| R4 Qualität | 1 | P13 01:53: „Auftrag: alle 1.150; IT: Lizenzbedarf 900 / Wer ist Zielgruppe?“ | Q4 fehlt: kein Adressat in Zeile, Spalte oder Überschrift |
| R4 Qualität | 0 | kein Fall in der Baseline | höchstens eine Prüfung erfüllt |
| R3 AB Folge | 2 | P11 03:126: „Sind Ranking, Einzel-Dashboards und Lernhistorie mitbestimmungspflichtig, und braucht es eine Betriebsvereinbarung?“; Spannung in 01 §6 als „möglicher Konflikt mit Mitbestimmung“ | Spannung benannt (F1) und Klärung festgehalten (F2) |
| R3 AB Folge | 1 | P12 03:14: „Berührt das Dashboard mit Personendaten (Auftrag 3.4) das Gremium, und wann wird es informiert?“ | Klärung festgehalten (F2), Folge für Funktion oder Zeitplan nicht benannt (F1 fehlt) |
| R6 Scope | 2 | P3 01 §6: „Organisatorische Maßnahmen (Lernzeit, Freistellung, Zertifikatsförderung): im Projekt oder außerhalb?“ neben benanntem In- und Out-of-Scope | SP1, SP2 und mindestens zwei offene Abgrenzungsfragen; Stufen 0 und 1 kommen in der Baseline nicht vor |
| R6 Innere Konsistenz | 2 | P11: alle vier Prüfungen erfüllt | – |
| R6 Innere Konsistenz | 1 | P14: „Azubis“ (03:115) und „Personen ohne regelmäßigen Rechnerzugang“ (03:118) fehlen in 02 | S3 verletzt, übrige erfüllt |

## 5 Dimensionen und Referenzelemente

Jede Dimension nennt zuerst ihre Kennzahlen, dann die Referenzelemente mit Trefferkriterium. Die 34 gestuften Elemente sind SH, AN, WI, UK, AB, PR-U, PR-AW und PR-RA.

### Freitexte aus DOC3 (Kennungen)

DOC3 nummeriert die Freitexte nicht; die Kennungen gelten nur für die Bewertung. Position = Reihenfolge in DOC3.

| ID | Position | Wortlaut | Bewertet über |
| --- | --- | --- | --- |
| FT-01 | 2 | „mein TL sagt immer, lernen machen wir wenn das projekt durch ist. das projekt ist nie durch“ | SH-07, PR-U3 |
| FT-02 | 10 | „Und wir in der Verwaltung? Uns fragt eh keiner.“ | SH-09 |
| FT-03 | 4 | „als werkstudi hab ich bei campusone nichtmal nen zugang“ | SH-09 |
| FT-04 | 8 | „ranking?? dann sieht mein BL ja genau wer nix macht“ | AN-02, WI-05 |
| FT-05 | 6 | „was man für die L-Stufe 3 eigentlich können muss weiß eh keiner, im PD-gespräch kommt das nie vor“ | AN-03, PR-U2, UK-03 |
| FT-06 | 11 | „wenn sich da nix tut bin ich nächstes jahr weg“ | PR-AW3 |
| FT-07 | 5 | „bitte nicht noch ein tool. wiki, sharepoint, campusone … keiner findet was“ | nicht bewertet (Symptom) |
| FT-08 | 1 | „Eine zentrale Plattform fände ich super, dann muss man nicht ewig suchen.“ | nicht bewertet (stützt die GF) |
| FT-09 | 9 | „lieber 20 min häppchen als ganze tage, die krieg ich eh nicht genehmigt“ | nicht bewertet (stützt PR-U1) |
| FT-10 | 7 | „Teilzeit und Präsenzschulung am Freitag passt halt nicht zusammen“ | SH-09 |
| FT-11 | 3 | „BIM-zertifikat würde ich sofort machen, wenn das jemand bezahlt“ | nicht bewertet (gibt Meiners teilweise recht) |

### R1 Stakeholder (SWEBOK 2.1)

**Erkennbarkeit:** *explizit* = tritt in DOC1–DOC3 als Akteur auf (Absender, Teilnehmende, Befragte) · *indirekt* = wird nur erwähnt oder ist nur erschließbar.

**Kennzahlen:** Anteil explizit (/4: SH-01–04) · Anteil indirekt (/4: SH-07, -09, -10, -11; deckt „Lücken erkannt“ ab) · negativ Betroffene mit benanntem Nachteil (/3: SH-03, -07, -09) · Anteil identifizierter Stakeholder mit zutreffendem Kerninteresse · mindestens eine nicht-personelle Quelle (ja/nein).

| ID | Stakeholder | Stufe | Erkennbar | Nachteil (negativ betroffen) | Kerninteresse (eines genügt) | Fundstelle | Treffer, wenn … |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SH-01 | Geschäftsführung | L1 | explizit | – | schnelle, vorzeigbare Lösung · Ausschreibungen gewinnen · Quote steigern | DOC1 Absender | genannt |
| SH-02 | Personalentwicklung | L1 | explizit | – | Lernkultur · KoMa aktualisieren · Fluktuation senken | DOC2, DOC3 | genannt |
| SH-03 | Projektmitarbeitende | L1 | explizit | keine Lernzeit, Druck durch Ranking | Zeit · Orientierung · keine Bewertung über Ranglisten | DOC1 1, DOC3 | genannt |
| SH-04 | Bereichsleitungen | L1 | explizit | – | Auslastung halten · Zertifikate · Lernen soll Projekte nicht belasten | DOC2 | genannt |
| SH-07 | Teamleitungen (genehmigen Lernzeit) | L2 | indirekt | Zielkonflikt Leitlinie vs. Projekt | termingerecht liefern · Lernzeit ohne Projektrisiko | DOC1 3.4, 4.1 · DOC3 FT-01 | als eigene Gruppe genannt, nicht nur „Führungskräfte“ |
| SH-09 | Verwaltung, Teilzeit, Werkstudierende | L2 | indirekt | nicht in Lizenz- und Zielgruppenplanung | Zugang · passende Formate | DOC2 IT-Tabelle (900) · DOC3 FT-02, -03, -10 | mindestens eine Gruppe als eigener Stakeholder |
| SH-10 | Betriebsrat | L3 | indirekt | – | Schutz vor Leistungs-/Verhaltenskontrolle · Beteiligung | DOC3 Fußnote | genannt |
| SH-11 | Datenschutzbeauftragte/r | L3 | indirekt | – | rechtmäßige, zweckgebundene Verarbeitung von Lerndaten | nur erschließbar (DOC1 3.4 Dashboard pro Person) | Datenschutz oder DSB als Stakeholder |

**Nicht bewertet** (zu offensichtlich): IT-Services, Bid-Management/Vertrieb, Controlling, Anbieter CampusOne, VR-Partner, öffentliche Auftraggeber. **Nicht-personelle Quellen:** Kompetenzmatrix · Mitarbeiterbefragung · Nutzungsdaten CampusOne · HRflow, PersoNet · PlanBoard · HR-Leitlinie Lernzeit · Exit-Gespräche · Ausschreibungsunterlagen.

**Kerninteresse:** zählt, wenn es inhaltlich einem Kerninteresse der Tabelle entspricht, gleich in welcher Spalte des Artefakts (z. B. „Mitbestimmung“ beim Betriebsrat = „Beteiligung“). Reine Tätigkeiten oder Zuständigkeiten (z. B. „Befragung, KoMa“ bei der PE, „Prüfung der Lerndaten“ beim DSB) zählen nicht.

### R2 Annahmen (SWEBOK 3.1)

Eine Annahme ist **identifiziert**, wenn sie als unbelegt, fraglich oder zu prüfen dargestellt wird; wer sie als Tatsache übernimmt, hat sie nicht identifiziert. **Offen**, wenn als offen markiert oder mit Frage versehen. **Kennzahlen:** Anteil identifiziert (/5) · davon Anteil offen.

| ID | Behauptung in DOC1 | Stufe | Gegenbeleg | Treffer, wenn … |
| --- | --- | --- | --- | --- |
| AN-01 | Angebot ist der Engpass („Das Problem ist bekannt … Die Anforderungen sind klar“) | L3 | DOC3: unübersichtlich 39 % < Zeit 64 %, Relevanz 47 % | infrage gestellt, ob das Angebot die Hauptursache ist |
| AN-02 | spielerisches Lernen und Ranking motivieren | L2 | DOC3: Badges 41 %, Ranglisten 17 % (52 % Ablehnung), FT-04 | als unbelegt erkannt oder mit DOC3 infrage gestellt |
| AN-03 | Lernpfade je L-Stufe auf Basis der Kompetenzmatrix | L2 | DOC2: KoMa Stand 2019 · DOC3: 29 %, FT-05 | veraltete Matrix als Voraussetzung infrage gestellt |
| AN-04 | Zertifikatspfade schließen die Ausschreibungslücke | L3 | DOC2: Zertifizierungsbudget „kein Konsens“ + Fachwissen (Prüfungskosten, Praxisnachweise) | hinterfragt, ob eine Plattform die Nachweise liefert |
| AN-05 | mit „5 Lerntage sind Arbeitszeit“ sind die zeitlichen Rahmenbedingungen geschaffen | L2 | DOC3: Ø 1,8 Lerntage, 21 % „ausreichend Zeit“ | Leitlinie und Nutzung gegenübergestellt oder Behauptung infrage gestellt |

Abgrenzung: AN-05 stellt die Leitlinie den **Daten** gegenüber, WI-04 der **Vorgabe des Controllings**.

### R3 Widersprüche, Unklarheiten, Abhängigkeiten (SWEBOK 3.4)

**Kennzahlen Widersprüche:** identifiziert zwischen Dokumenten (/3) und zwischen Interessen (/3) · Anteil adressiert (offene Frage oder Klärungsweg) · ohne Beleg aufgelöst (Anzahl, negativ: eine Variante gewählt, gemittelt, als vereinbar dargestellt).

**Ohne Beleg aufgelöst** heißt: Eine Seite des Widerspruchs wird als Tatsache übernommen, gemittelt oder als vereinbar dargestellt. Ein Punkt, der als Spannung oder Widerspruch mit Quelle geführt wird, zählt nicht.

| ID | Art | Gegenstand | Seite A | Seite B | Identifiziert, wenn … | Ohne Beleg aufgelöst, z. B. |
| --- | --- | --- | --- | --- | --- | --- |
| WI-01 | Dokumente | Zielgruppe | DOC1 Zielbox: alle 1.150 | DOC2 IT-Tabelle: 900 Projektpersonal | beide Größen als abweichend benannt | „Zielgruppe sind die 900“ |
| WI-02 | Dokumente | Quelle Rollen/L-Stufen | DOC1 3.5: PersoNet | DOC2: HRflow führend, PersoNet nur Lohn | Konflikt zwischen den Systemen benannt | „Schnittstelle zu HRflow“ ohne Hinweis auf DOC1 |
| WI-03 | Dokumente | Budget | DOC1 4.2: 250 T€ | DOC2 Mail: 120 T€, Rest nach Business Case | Differenz benannt | „Phase 1 120 T€, Phase 2 130 T€“ |
| WI-04 | Interessen | Lernzeit vs. Auslastung (semantisch) | DOC1 4.1: 5 Lerntage Arbeitszeit | DOC2 Mail: „vorrangig in Bank-Zeiten“ | Zielkonflikt zwischen Lernzeit und Projekteinsatz benannt | „Lernen in Leerlaufphasen“ als vereinbar |
| WI-05 | Interessen | Transparenz vs. Angst vor Kontrolle | DOC1 3.2/3.4: Ranking, Dashboard pro Person | DOC3: Ranglisten 17 %/52 %, FT-04 | Interessenkonflikt zwischen GF und Mitarbeitenden benannt | „Ranking anonymisieren, dann passt es“ ohne Klärungsbedarf |
| WI-06 | Interessen | Stellvertreter-Aussage | DOC2 TOP 3, Meiners: „Leute wollen vor allem Zertifikate“ | DOC3: Zertifikatsförderung 22 % vs. Zeit 64 % | Abweichung zwischen Aussage der BL und Befragung benannt | „Mitarbeitende wünschen Zertifikate“ als Tatsache |

**Unklarheiten** (Begriff, Ziel oder Verweis ohne Bedeutung, Maßstab oder Inhalt). **Kennzahlen:** identifiziert (/4) · davon Anteil offen. Wer eine Bedeutung erfindet und als Tatsache nutzt, hat die Unklarheit nicht identifiziert; zusätzlich Fehler in R6.

| ID | Unklarheit | Fundstelle | Treffer, wenn … |
| --- | --- | --- | --- |
| UK-01 | „Weiterbildungsquote“ 34 % → 70 % ohne Definition | DOC1 Zielbox | fehlende Definition oder Messweise benannt |
| UK-02 | vage Ziele: „deutlich mehr Weiterbildung“, „moderne Plattform“, „Go-live Q3 2027“ | DOC1 Zielbox | mindestens eine als unbestimmt benannt |
| UK-03 | interne Begriffe: L-Stufe, KoMa, JF, PD-Gespräch, Bank | DOC1–DOC3 | mindestens einer als klärungsbedürftig markiert |
| UK-04 | Verweise ohne Inhalt: „Zertifizierungsbudget: siehe JF, kein Konsens“ · „Priorisierung wie im letzten JF“ | DOC2 TOP 5 | als Wissenslücke benannt |

TL, BL und BM zählen nicht für UK-03 und nicht als Zusatzfund.

**Abhängigkeiten.** Identifiziert, wenn beide Seiten genannt sind. **Kennzahlen:** identifiziert (/4) · Folge erkannt je Abhängigkeit (F1 Spannung benannt, F2 Klärungsbedarf oder -weg festgehalten; 0 = keine, 1 = eine, 2 = beide).

| ID | Abhängigkeit | Stufe | Beide Seiten | Spannung (F1) |
| --- | --- | --- | --- | --- |
| AB-01 | Dashboard/Ranking pro Person braucht Betriebsrat (§ 87 Abs. 1 Nr. 6 BetrVG) und Datenschutz | L3 | Dashboard/Ranking + Betriebsrat/Mitbestimmung | Funktion ggf. nicht umsetzbar, Zeitplan gefährdet |
| AB-02 | Single Sign-on vs. Go-live | L2 | DOC1: Go-live Q3 2027 mit SSO + DOC2: IdP nicht vor Q4/2027 | Go-live ohne SSO oder Verschiebung |
| AB-03 | Lizenzende vs. Go-live | L2 | Lizenzende **mit Termin** (30.06.2027) oder ausdrücklich vor dem Go-live + Go-live Q3 2027 | Lücke ohne Plattform oder Verlängerung |
| AB-04 | BL-Zielvereinbarungen an Auslastung gekoppelt | L3 | Zielvereinbarung/Messung der BL + Auslastung (H-A: DOC2 TOP 2 „Zielwert 85 % bleibt“; H-B: Mail „BL-Zielvereinbarungen … unberührt“) | BL haben keinen Anreiz, Lernzeit zu genehmigen |

AB-03 ist nicht getroffen mit „CampusOne läuft aus, neues LMS kommt Q3 2027“ ohne erkannte zeitliche Lücke. AB-04 ist keine Voraussetzung für L4.

### R4 Offene Punkte und Fragen (SWEBOK 2, 5)

**Kennzahlen:** Abdeckung je Priorität (6 kritisch, 9 wichtig, 3 nebensächlich); abgedeckt, wenn mindestens eine Frage oder ein offener Punkt denselben Klärungsbedarf trifft · Qualität je Frage 0/1/2, nur für Fragen zu kritischen Klärungsbedarfen · Rauschen (Anteil ohne Projektbezug an allen Fragen, z. B. „Welche Ziele hat das Projekt?“) · Ablenker-Fragen (Zusatzkennzahl, kein Rauschen).

**Rauschen:** eine Frage ohne konkreten Projektbezug, die in jedem Projekt gestellt werden könnte (z. B. „Welche Ziele hat das Projekt?“, „Wer ist Projektleitung?“, „Wer entscheidet die Anbieterauswahl?“). Nennt sie Besonderheiten des Falls (Rollen, Zahlen, Dokumente, Systeme, Daten von Nordwerk), ist sie projektbezogen.

**Qualität je Frage:** Q1 projektbezogen · Q2 nicht suggestiv · Q3 auf Ursachen oder Bedürfnisse statt Features gerichtet: nicht erfüllt nur, wenn die Frage auf Funktionen oder die Ausgestaltung einer Lösung zielt (welche Funktion; wie LMS, Ranking, Dashboard oder Gamification aussehen oder arbeiten sollen); Fragen zu Budget, Zielgruppe, Zeitplan, Verfahren, Zuständigkeit oder Recht erfüllen Q3 · Q4 einem Stakeholder zugeordnet (Adressat in der Frage, einer Spalte, einem Kürzel oder der Gruppenüberschrift; ein Stakeholder nur als Gegenstand der Frage zählt nicht). 0 = höchstens eine erfüllt · 1 = zwei bis drei · 2 = alle vier.

| Nr. | Klärungsbedarf | Elemente | Priorität | Adressat |
| --- | --- | --- | --- | --- |
| K-01 | Zielgruppe: alle 1.150 inkl. Verwaltung, Teilzeit, Werkstudierende? | WI-01, SH-09 | kritisch | GF, PE |
| K-03 | Welches Budget gilt, was muss der Business Case zeigen? | WI-03 | kritisch | GF, Controlling |
| K-07 | Wie passen 5 Lerntage zur Auslastung und zu „Bank-Zeiten“? | WI-04, AN-05 | kritisch | GF, BL, Controlling |
| K-10 | Betriebsrat eingebunden? Dashboard/Ranking pro Person zulässig? | SH-10, SH-11, AB-01 | kritisch | GF, BR, DSB |
| K-12 | Wann und durch wen wird die KoMa aktualisiert? Lernpfade ohne aktuelle Matrix? | AN-03 | kritisch | PE, GF |
| K-17 | Würde ein LMS die Hindernisse Zeit und Relevanz beseitigen? Was muss sich außer dem Tool ändern? | PR-RA, AN-01 | kritisch | GF |
| K-02 | Was zählt zur Weiterbildungsquote, wie wird sie gemessen? | UK-01 | wichtig | GF, PE |
| K-04 | Welches System liefert Rollen und L-Stufen? | WI-02 | wichtig | IT, PE |
| K-05 | Wie wird die Zeit zwischen Lizenzende 30.06. und Go-live überbrückt? | AB-03 | wichtig | IT, GF |
| K-06 | Go-live ohne SSO akzeptabel oder Verschiebung? | AB-02 | wichtig | IT, GF |
| K-08 | Wer genehmigt Lernzeit, nach welchen Kriterien? | SH-07 | wichtig | PE, TL |
| K-09 | Woran werden die BL gemessen, welche Rolle spielt Auslastung? | AB-04 | wichtig | GF |
| K-11 | Worauf stützt sich „wünschen sich spielerisches Lernen“? | AN-02, WI-05 | wichtig | GF, PE |
| K-13 | Wie erfahren Vertrieb und Staffing, welche Kompetenzen vorhanden sind? | PR-U2 | wichtig | BM, BL |
| K-16 | Worauf beruht „Die Leute wollen Zertifikate“, deckt es sich mit der Befragung? | WI-06 | wichtig | BL, PE |
| K-14 | Welche Nachweise verlangen Ausschreibungen konkret, wer trägt Prüfungskosten? | AN-04 | nebensächlich | BM, Controlling |
| K-15 | Was wurde im JF zu Zertifizierungsbudget und Priorisierung besprochen? | UK-04 | nebensächlich | BL, GF |
| K-18 | Was bedeuten Bank, L-Stufe, PD-Gespräch, KoMa, JF? | UK-03 | nebensächlich | PE |

Ablenker-Fragen zielen auf die Ausgestaltung von AL-1 (VR-Leuchtturm) oder AL-2 (Funktions-Wunschliste), z. B. „Soll die App offline funktionieren?“. Die Frage, *ob* AL-1 zum Scope gehört, ist keine Ablenker-Frage (SC-5).

**Lesart der Klärungsbedarfe:** K-10 trifft auch Fragen, die Betriebsrat oder DSB als Adressat einer Frage zu personenbezogenen Lerndaten, Ranking oder Dashboard nennen oder ihre Teilnahme am Workshop klären. K-11 trifft Fragen, die Gamification oder Ranking des Auftrags mit DOC3 infrage stellen. K-17 trifft Fragen nach den Gründen der geringen Nutzung oder danach, was ein LMS an Zeit und Relevanz ändert. K-07 trifft nicht die bloße Frage nach der Bedeutung von „Bank-Zeiten“ (das ist K-18).

### R5 Problemtiefe (SWEBOK 3.1, 3.2)

Referenz sind Kernproblem und Ursachenkette in Abschnitt 2.

**PR-RA Kernproblem getroffen (L4, 0/1/2):**

**Ort der Prüfung (Ausnahme von „Ort egal“):** PR-RA wird nur an der **Kernaussage zum Problem** geprüft: Problemstatement, Kurzfassung oder Zusammenfassung des Problems, oder eine an die GF gerichtete Klärungsfrage zur Problemsicht. Aussagen, die nur in Tabellen zu Annahmen, Widersprüchen, Risiken, Konflikten oder im Scope stehen, zählen für PR-RA nicht (sie zählen normal in R2, R3, R6). **Als Kernaussage gilt** der Abschnitt, den das Artefakt selbst als Problemstatement, Problemdefinition, Kurzfassung oder Fazit ausweist; Befund- und Datentabellen zählen nicht dazu, auch wenn sie unter einer Überschrift „Problem“ stehen. Gibt es keinen solchen Abschnitt, gilt der erste zusammenfassende Fließtext zum Problem.

- **P1 Plattform als nicht ausreichend begründet:** Die Kernaussage stellt dar, dass ein LMS das Problem nicht (allein) löst, **und begründet das mit mindestens einer konkreten Ursache**. Eine allgemeine Formel ohne Begründung („notwendig, aber nicht hinreichend“, „Technik allein reicht nicht“) erfüllt P1 nicht.
- **P2 Ursache außerhalb des Tools vorrangig:** Die Kernaussage verortet die Hauptursache bei Zeit, Auslastung bzw. Anreizen oder Kompetenzsteuerung **und gewichtet sie erkennbar vor dem verstreuten Angebot** (z. B. Rangfolge, „vor allem“, „eigentlich“, „Hauptbarriere“). Eine gleichrangige Aufzählung („nicht nur …, sondern ebenso …“, Liste ohne Gewichtung) erfüllt P2 nicht.
- **P3 Ursachen kausal verknüpft:** mindestens zwei Ursachen sind als Ursache-Wirkung verbunden (z. B. „Auslastungsziel → keine Lernzeit“, „veraltete Matrix → unklar, was zählt“). Bloßes Nebeneinander in einer Liste erfüllt P3 nicht.
- 2 = P1–P3 · 1 = Zeit, Orientierung bzw. Kompetenzsteuerung in der Kernaussage als Ursache genannt, aber nicht alle drei Prüfungen erfüllt · 0 = keine Ursache außerhalb des Tools in der Kernaussage (nur Symptom, Sicht der GF übernommen oder pauschale Ablehnung ohne Ursache)

Eine gezielte Klärungsfrage an die GF genügt, wenn sie P1–P3 enthält, z. B. „Die Befragung nennt Zeit (64 %) vor Unübersichtlichkeit (39 %): Wie verträgt sich das Auslastungsziel mit 5 Lerntagen, und was würde ein LMS daran ändern?“. Die BL-Zielvereinbarungen müssen nicht genannt werden; werden sie genannt, zählt das als AB-04.

**Tiefe der Ursachenkette (0–3):** dokumentierte Stufen, nur wenn erkennbar als Ursache dargestellt, nicht nur als Fakt.

| ID | Kettenglied | Stufe | Dokumentiert, wenn … |
| --- | --- | --- | --- |
| PR-U1 | keine Zeit, fehlende Orientierung | L1 | mindestens eines als Ursache der geringen Nutzung genannt |
| PR-U2 | KoMa veraltet, nicht mit Staffing/Vertrieb verknüpft | L2 | fehlende Verknüpfung von Kompetenzwissen mit Staffing oder Vertrieb als Ursache für U1 oder die Auswirkungen genannt |
| PR-U3 | Steuerung über Auslastung | L4 | Die **Steuerung** (Auslastungsziel, Berichtspflicht an die GF, Zielvereinbarungen bzw. fehlende Anreize der BL/TL) ist **als Ursache des Zeitmangels in der Ursachenkette bzw. im Problemstatement** genannt. Nicht ausreichend: hohe Auslastung nur als Fakt oder Last („87 %, wenig Spielraum“) · Nennung nur in Tabellen zu Annahmen, Widersprüchen, Risiken, Konflikten oder im Scope |

**Lösungsneutralität:** Anzahl der Aussagen über Problem, Ursachen oder Ziele, die eine Lösung vorschreiben, egal wo. Zählt: „Nordwerk braucht ein LMS mit Gamification.“ Zählt nicht: „Laut GF soll ein LMS eingeführt werden.“ (Position) · „Mitarbeitende finden passende Angebote nicht.“ (Bedürfnis).

**Auswirkungen (/3):** PR-AW1 verlorene Ausschreibungen · PR-AW2 Freelancer-Kosten · PR-AW3 Fluktuation (L1, jeweils „genannt“).

### R6 Kohärenz und Faktentreue (SWEBOK 5)

**Scope (0/1/2):** SP1 In-Scope benannt · SP2 Out-of-Scope benannt · SP3 mindestens zwei offene Abgrenzungsfragen aus SC-1 bis SC-5. 0 = keine · 1 = eine bis zwei · 2 = alle drei.

| ID | Offene Abgrenzungsfrage | Bezug |
| --- | --- | --- |
| SC-1 | Gehören Verwaltung, Teilzeit, Werkstudierende zur Zielgruppe? | WI-01, SH-09 |
| SC-2 | Nur Plattform oder auch Kompetenz- und Staffingmanagement (KoMa, Lernzeit)? | PR-RA |
| SC-3 | Gehören Zertifizierungsbudget und externe Prüfungen dazu? | AN-04, UK-04 |
| SC-4 | Gehören Ablösung CampusOne und Übernahme der Wiki-/SharePoint-Inhalte dazu? | AB-03 |
| SC-5 | Gehört der VR-Leuchtturm dazu? | AL-1 |

**Faktentreue:** Anzahl der Aussagen, die DOC1–DOC3 widersprechen oder dort nicht vorkommen, ohne als Vermutung gekennzeichnet zu sein („vermutlich“, „unklar, ob“ gelten als gekennzeichnet). Geprüft werden gezielt die typischen Fehlerquellen unten und Aussagen, die beim Lesen auffallen; nicht jede Aussage wird gegen DOC1–DOC3 geprüft, die Zahl ist daher eine Untergrenze. Befragungswerte, die als Beleg für Interessen der Hauptzielgruppe dienen, gelten als zulässige Näherung, nicht als Fehler (538 von 612 Befragten gehören nicht zu Verwaltung und Zentralen Diensten). Typische Fehlerquellen:

- erfundene Bedeutung von Bank, L-Stufe, KoMa, PD-Gespräch, JF oder eigene Definition der Weiterbildungsquote
- erfundene Begründung für 900 Lizenzen oder die Budgetdifferenz; erfundener Go-live-Tag, Namen oder Rollen
- Behauptung, der Betriebsrat habe dem LMS zugestimmt, oder Mitarbeitende hätten sich zum Dashboard geäußert (die Befragung liegt vor dem Projektauftrag)
- verwechselte Zahlen: 58 % als Zustimmung zu Ranglisten · 18 % CampusOne-Nutzung vs. Offline-Modus · 41 % Austrittsgrund vs. Badges

**Innere Konsistenz (0/1/2):** S1 jede Ursache bezieht sich auf das Kernproblem · S2 jede Auswirkung folgt aus dem Kernproblem · S3 keine unmarkierten Widersprüche zwischen den Artefakten, jeder in 01 oder 03 genannte Stakeholder steht in 02 · S4 Kernproblem im Scope, nichts im Scope ohne Bezug dazu. 0 = höchstens eine · 1 = zwei bis drei · 2 = alle vier; nicht anwendbare Prüfungen als n/a herausrechnen. S1, S2, S4 werden gegen das **von der Person formulierte** Kernproblem geprüft (R6 misst Kohärenz, R5 Richtigkeit).

### R7 Sprachqualität: Requirements Smells nach Femmer et al. (2017)

Der Prototyp prüft den eigenen Text des Analysten auf Requirements Smells; R7 würde das Treatment so teilweise mit seinem eigenen Instrument messen. Die Zirkularität hängt vor allem an den Begriffen, die der Prototyp ausdrücklich vorgibt. R7 misst deshalb nach den Smell-Definitionen, nicht nach diesen Begriffen, und weist Funde mit Listenbegriffen getrennt aus.

**Grundlage:** Femmer, H., Méndez Fernández, D., Wagner, S., Eder, S. (2017): Rapid quality assurance with Requirements Smells. *Journal of Systems and Software* 123, 190–213. Ein Requirements Smell ist ein Hinweis auf einen Qualitätsmangel mit konkreter Textstelle und konkretem Erkennungsverfahren, abgeleitet aus den Sprachkriterien der ISO/IEC/IEEE 29148. Ob ein Fund ein Mangel ist, entscheidet der Kontext.

**Einheit:** Fund mit konkreter Textstelle (Wort oder Wortfolge) im eigenen Text der Artefakte 01–03 (einschließlich Bildabschriften). Nicht bewertet: Überschriften, wörtliche Zitate aus DOC1–DOC3 (insbesondere UK-02 und „spielerisches Lernen“), als Position eines Stakeholders wiedergegebene Aussagen („Laut GF soll …“), Fragen, ausdrücklich offene Punkte (auch `? UNCLEAR`-Marker).

| Smell | Textstelle | Erklärung | Beispiel (Szenario) | Präzision bei Femmer et al. |
| --- | --- | --- | --- | --- |
| Subjective Language | Wort | Bedeutung nicht objektiv bestimmt (benutzerfreundlich, einfach, effizient) | „Die Plattform soll einfach zu bedienen sein.“ | 0,96 |
| Ambiguous Adverbs and Adjectives | Adverb, Adjektiv | von Natur aus unbestimmt (fast immer, deutlich, minimal) | „Die Nutzung ist deutlich zu gering.“ | 0,81 |
| Loopholes | Wort, Phrase | Erfüllung nur in unbestimmtem Umfang (soweit möglich; „soll“ statt „muss“) | „Lernzeit wird soweit möglich genehmigt.“ | 0,72 |
| Open-ended, Non-verifiable Terms | Wort | offen, nicht prüfbar (ausreichend, angemessen) | „Mitarbeitende brauchen ausreichend Zeit.“ | 0,70 |
| Superlatives | Adverb, Adjektiv | Bezug auf alle anderen (höchste, beste) | „Die Plattform braucht die beste Suche.“ | 0,49 |
| Comparatives | Adverb, Adjektiv | Bezug auf andere Systeme oder frühere Lage ohne Maßstab (mehr, besser) | „Mitarbeitende sollen mehr lernen.“ | 0,48 |
| Negative Statements | Wort | Aussage darüber, was nicht sein soll | „Lernen darf Projekte nicht belasten.“ | 0,33 |
| Vague Pronouns | Pronomen | unklarer Bezug | „Die BL stimmen sich mit den TL ab, weil sie an der Auslastung gemessen werden.“ | 0,26 |

Der neunte Smell bei Femmer et al., Incomplete References, wird wie dort nicht verwendet. Kürzel im Bewertungsbogen: SL, AA, LH, NV, SUP, CMP, NEG, VP (Reihenfolge der Tabelle).

**Zählregeln (aus den Fehlerquellen bei Femmer et al.):** Komparative und Verneinungen in Bedingungen zählen nicht („wenn die Auslastung über 85 % liegt …“). Dasselbe Wort in derselben Aussage zählt einmal. Je Fund ein Smell, der am besten passende. Die vier mehrdeutigkeitsbezogenen Smells (SL, AA, LH, NV) waren dort schwer zu trennen; sie werden zusätzlich als eine Gruppe berichtet.

**Auslegungen für Problemanalysen:** Die Artefakte sind keine Anforderungen; ein Fund zählt nur, wenn eine eigene Aussage (Bewertung, Ursache, Ziel, Empfehlung, Scope) dadurch unprüfbar oder mehrdeutig wird.
- Zeilen mit Fragezeichen zählen nicht (wie im Nenner).
- SL, AA, NV, CMP zählen nicht, wenn dieselbe Aussage einen Wert, eine Schwelle oder einen Maßstab nennt („geringe Nutzung (18 %)“, „mehr als 2025“).
- Stufen einer festen Skala in Tabellen (Priorität, Einfluss, Betroffenheit „hoch/mittel/niedrig“) und feste Begriffe oder Namen zählen nicht.
- NEG zählt nur in normativen Aussagen (Ziel, Anforderung, Empfehlung: „darf nicht“, „soll keine“). Feststellungen eines Fehlens („keine Definition der Quote“, „nicht belegt“) und Out-of-Scope-Angaben zählen nicht.
- VP zählt nur, wenn mindestens zwei Bezüge im selben oder vorigen Satz infrage kommen.
- Textstelle = nur das Smell-Wort bzw. die kürzeste Wortfolge.
- Gekennzeichnete Wiedergaben aus DOC1–DOC3 zählen wie Zitate nicht, auch ohne Anführungszeichen: Die Aussage übernimmt eine Wendung aus den Kundendokumenten und weist sie im selben Punkt als Wiedergabe aus (Quellenverweis wie `[[doc:…]]`, Quellenkürzel wie [P] oder (AUF), Zuschreibung wie „laut Protokoll“). Übernommen ist eine Wendung, wenn das Smell-Wort mit seinen Nachbarwörtern als Folge von mindestens drei Wörtern in DOC1–DOC3 steht oder in einer Zeile von DOC1–DOC3, mit der die Aussage mindestens zwei weitere Inhaltswörter teilt. Eine Übernahme ohne Kennzeichnung gibt der Text als eigene Aussage aus; sie zählt. Die Regel betrifft 49 Funde, davon 48 im Treatment; 44 dieser 48 tragen einen Quellenverweis, keiner war als unklar markiert (`? UNCLEAR`).

**Listenbegriffe:** Ein Fund mit Listenbegriff ist einer, dessen Textstelle ein Wort enthält, das der Prototyp ausdrücklich vorgibt, auch flektiert: die Begriffe der deterministischen Prüfung (`3_artifact/source/backend/app/services/format_check.py`: fast, quick, quickly, easy, easily, user-friendly, scalable, efficient, seamless, high-performance; schnell, zügig, einfach, benutzerfreundlich, bedienerfreundlich, intuitiv, robust, skalierbar, effizient, nahtlos, modern, performant, leistungsfähig, flexibel) und die Vermeidungsliste der Analyst-Anweisung (`3_artifact/agent_instructions/analyst_draft.md`, „Strict Smell-Free Writing“: ausreichend, sollte, könnte, idealerweise, normalerweise, möglichst, besser, schneller, einfacher, höchste, es, dies, das). Beide Listen zusammen, damit der Teil ohne Listenbegriffe nichts enthält, was der Prototyp vorgibt. Das Skript bestimmt das aus der Textstelle; niemand markiert es von Hand.

**Messung:** wie die übrigen Dimensionen (Abschnitt 1): Claude-Subagents tragen jeden Fund mit Fundstelle, Textstelle, Smell und wörtlichem Zitat ein; frische Subagents prüfen jeden Fund gegen das Artefakt und suchen nach übersehenen; Grenzfälle entscheidet der Autor. Ohne Fund wird eine Zeile mit Smell `keine` eingetragen.

**Kennzahl:** Funde je 1.000 Wörter je Person, (a) alle Funde, (b) ohne Listenbegriffe, dazu die Mehrdeutigkeitsgruppe; im Gruppenvergleich Mittel und Spannweite der Personenwerte. Nenner sind die Wörter des eigenen Texts, mechanisch gezählt: ohne Überschriften, Zeilen mit Fragezeichen, Text in Anführungszeichen und Quellenverweise `[[…]]`. Das Ergebnis wird deskriptiv berichtet, ohne Test; maßgeblich für eine Aussage über das Treatment ist (b).

### R8 Randbedingungen (Kontrolle, SWEBOK 3.1)

**Kennzahl:** Anteil genannter Restriktionen (/8), nur gesamt. Keine Auswertung je Kategorie, weil sich RS-1 und RS-4 bis RS-8 überschneiden mit WI-03, AB-03, AB-02, WI-02, SH-10/AB-01 und SH-11. R8 dient als Kontrolle für einen Vorlageneffekt.

| ID | Kategorie | Restriktion | Genannt, wenn … |
| --- | --- | --- | --- |
| RS-1 | Budget | 120 T€ freigegeben, Rest nach Business Case (bzw. 250 T€) | eine der Zahlen als Rahmen genannt |
| RS-2 | Zeit | Go-live Q3 2027 | genannt |
| RS-3 | Zeit | Anbieterauswahl in sechs Wochen | genannt |
| RS-4 | Zeit | CampusOne-Vertrag endet 30.06.2027 | genannt |
| RS-5 | Technik | SSO nicht vor Q4 2027 | genannt |
| RS-6 | Technik | Rollen und L-Stufen aus einem HR-System | eines der Systeme als Abhängigkeit genannt |
| RS-7 | Regulatorik | Betriebsrat bzw. Mitbestimmung bei Leistungsauswertungen | genannt |
| RS-8 | Regulatorik | Datenschutz bei Lerndaten pro Person | genannt |

### Nicht bewertete Inhalte

Diese Inhalte stehen in DOC1–DOC3, zählen aber weder im Score noch als Zusatzfund. Leitet jemand daraus ein bewertetes Element ab, zählt dieses normal.

| Inhalt | Kennung (alt) | Ableitung, die normal zählt |
| --- | --- | --- |
| Ablenker VR-Leuchtturm (DOC1 5) und Funktions-Wunschliste (DOC3) | AL-1, AL-2 | Scope-Frage zum VR-Leuchtturm → SC-5 |
| Verteiler ohne TL und BR, Status „beschlossen“, „Grundsatzfragen sind geklärt“, Termindruck | WD-1, -2, -11, -19 | – |
| „Der Vertrag läuft ohnehin aus.“ (ohne Datum) | WD-4 | mit erkannter zeitlicher Lücke → AB-03 |
| persönliche Lernhistorie, Auswertungen je Standort | WD-6, -8 | Datenschutz → SH-11, RS-8 |
| Bericht zur Quote, „mehr als eine Kennzahl“ | WD-9, -15 | fehlende Definition → UK-01 |
| „aus vielen Gesprächen“, Standortwettbewerb, „Wenn das Angebot stimmt …“, Alltagsbeispiel, „Entwicklung planbar“ | WD-5, -7, -13, -17, -18 | als unbelegt erkannt → AN-01, AN-02, AN-03 |
| übrige Rahmung und Kontext in DOC1 (70 % öffentlich, Katalog, Bedienung, GF lebt vor) | WD-3, -10, -12, -14, -16, -20 | – |
| Schlüsselpersonal-Nachweise | WP-1 | – (stützt AN-04, PR-AW1) |
| „Rückmeldungen kommen oft spät, Leute stecken in Projekten“ | WP-2 | als Beleg für Zeitmangel → PR-U1/PR-U3 |
| PE-Kapazität gebunden | WP-3 | als Grund für veraltete KoMa → AN-03, K-12 |
| Exit-Gespräche nicht nach Bereichen, Leitfaden PD-Gespräch, Präsenzschulungen nur in HH | WP-4, -5, -6 | – |
| Wiki-Suche „derzeit nicht eingeplant“ | WP-7 | Frage nach Übernahme der Wiki-Inhalte → SC-4 |
| Workshop: je Bereich eine Person, benannt durch BL | WP-8 | Mitarbeitende/TL nicht direkt beteiligt → SH-03, SH-07 |
| kein Ausweis nach Gruppen, Selbstauskunft, vorgegebene Antworten, erstmals erhoben | WB-1 bis WB-4 | Verwaltung/Teilzeit nicht gesondert betrachtet → SH-09 |
| Freitexte zu Suche, Plattform-Wunsch, Häppchen, BIM bezahlt (FT-07, -08, -09, -11) sowie TL/BL/BM als Begriffe | – | – |

Übrige Inhalte von DOC2 (Organisatorisches in TOP 5, Kommentare zu Auslastung und Freelancern, ToDos) sind Kontext; ein daraus abgeleiteter Fund wird nach der Regel für zusätzliche valide Funde geprüft.
