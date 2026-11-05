# Scoring of the Work Products in Round 2

Scoring of the work products 01–03 against the [rubric](../rubric.md) (Sections 4–5). The scoring sheets are the German working originals; they call the artifact condition *Treatment*.

| File | Content |
| --- | --- |
| `P1.md`–`P14.md` | One scoring sheet per participant, named by participant ID; condition (Baseline, Treatment) in the header |
| `key_figures.md` | Key figures per participant and condition, computed from the sheets |

## Procedure

1. **First pass:** Claude subagents (Claude Opus 5.5) scored each condition, one subagent per dimension across all sheets of the condition, and for R4 one per participant; a further subagent aligned R4 across the sheets, in the artifact condition also against the baseline.
2. **Second pass:** Fresh subagents checked every row against the work products. The author decided deviations and borderline cases according to the interpretations of the rubric (Section 5) and the interpretations below. In the baseline, 86 of 2,730 values changed compared with the first pass (3.2 %), mostly in R4; in the artifact condition, two values changed (P1 S4, P10 AN-02), and two duplicate rows were removed in P4. The working material of the subagents (instructions, tasks, raw output) was not kept; location, quote, and rationale of each value are in the sheets.
3. **R7 Requirements smells:** one subagent per sheet, and in the second pass one fresh subagent per sheet (6 changes to 141 findings: 3 added, 3 removed). The work products carried the neutral labels X01–X10 during this step, and the conditions were assigned only after the decision; the artifact-condition work products remain recognizable by their source links and `? UNCLEAR` markers, however. The rule on marked reproductions of the documents (rubric, R7) is applied mechanically; the author decided two cases by hand. It affects 49 findings, 48 of them in the artifact condition.
4. **Aggregation:** key figures per participant and condition computed from the sheets (`key_figures.md`).

## Scope

- **Quality of questions:** R4 Q1–Q4 only for questions on critical clarification needs (K-01, K-03, K-07, K-10, K-12, K-17). Noise is a row type of its own, `R`, and covers all questions.
- **Factual accuracy:** R6 targets the typical sources of error named in the rubric; the count is a lower bound.
- **Quotes** only for 0/1/2 judgments and borderline cases; otherwise the location suffices.
- **Image content** counts under the measurement rule "location does not matter". The transcriptions are stored as `*-transcription.md` next to the images (only P13: context map, stakeholder map).

## Interpretations the Rubric Leaves Open

Applied when computing the key figures:

- Levels: WI = L2, UK = L1, inferred from the level counts in Section 2 of the rubric.
- PR-RA: check P0 ("time, orientation, or competence steering named as a cause") as the threshold for score 1.
- Internal consistency with n/a: 2 = all applicable checks met, 0 = at most one, otherwise 1.
- Noise = share of rows of type `R` among all questions (`F` and `R`). R = a question without a concrete reference to the project that could be asked in any project; if it names particulars of the case, it is F.

Decided during scoring:

- The core interest "co-determination" counts as "participation"; questions of the same kind are treated alike for R and K.
- `? UNCLEAR` and `⚠ CONFLICT` rows without a question are type P in R4 (precedent P13 No. 74/75) and count as "marked open" in R2 and R3 (ambiguities). R3 "addressed" still requires a question or a way to clarify; a conflict marker alone does not suffice there.
- New P rows in R4 only for clarification needs that no other row of the sheet hits (as P14 No. 80/81, P12 No. 33).
- A K that comes from the block of a question counts if the question aims to clarify exactly the point of the block; if the K appears only in the block text, it does not count. A question whose only reference to the case is its heading and that could otherwise be asked in any project remains R (P7 No. 33, P8 No. 41; as P11 No. 9/13, P13 No. 56).
- PR-RA: a clarifying question addressed to the management counts as a unit of context, relevance, and question within the same question block; several blocks are not read together, and questions are not combined with the core statement in 01. With this rule, P8 (03:8–14) is the only sheet that reaches score 2; P7 stays at 1.
- Working assumptions "until clarified" next to a conflict with a source do not count as "resolved without evidence" (as marked assumptions in P11/P14).

## Sensitivity of R7

Findings per 1,000 words, mean and range per condition:

| | Baseline | Artifact | Baseline without list terms | Artifact without list terms |
| --- | --- | --- | --- | --- |
| with the DOC rule | 6.6 (4.7–8.2) | 1.1 (0.3–1.8) | 5.6 (3.5–7.7) | 1.1 (0.3–1.8) |
| without the DOC rule | 6.7 (4.7–8.7) | 4.1 (1.6–6.1) | 5.6 (3.5–7.7) | 4.0 (1.6–5.5) |
