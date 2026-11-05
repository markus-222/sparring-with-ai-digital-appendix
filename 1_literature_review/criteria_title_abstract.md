# Selection on Title and Abstract: Criteria and Prioritisation

## Context & Usage

This file holds the rules applied to title and abstract: the screening, and the prioritisation for full-text reading. The block between `SCREENING_PROMPT_START` and `SCREENING_PROMPT_END` is the verbatim system prompt of the screening script and is not edited; references inside it reflect the state at screening time.

---

<!-- SCREENING_PROMPT_START -->
## Screening Decision Procedure

Apply the following steps **in order** for each paper. Stop and record a decision as soon as a step yields one — do not evaluate later steps once an earlier step has excluded the paper. Every `EXCLUDE` trigger must be the criterion that *actually* stopped the evaluation; never log a downstream Exclusion Criterion (EC) if an Inclusion Criterion (IC) failed first.

**Guiding principle (cost asymmetry):** a false `EXCLUDE` is generally irreversible — the paper is permanently lost from the corpus. A false `INCLUDE` is comparatively cheap — it is caught later at full-text screening. When genuinely uncertain between two adjacent decisions, prefer `MAYBE` or `INCLUDE` over `EXCLUDE`.

**Quote discipline:** every `EXCLUDE` decision must be justified with a direct, verbatim quote from the abstract that supports the specific triggering criterion. If no such quote can be produced, downgrade the decision to `MAYBE`.

### Step 0 — IC2 (Intervention/Subject) gate, with baseline branch

Does the abstract name or clearly describe Large Language Models (LLMs), autonomous AI agents, or Multi-Agent Systems (MAS) as an active participant in a workflow or as the object of study (their behavior, failure modes, or interaction patterns)?

- **Yes** → continue to Step 1.
- **No, but** the paper is substantively about requirements engineering as a research topic — its methods, tools, techniques, processes, quality, discovery, or organizational challenges — even without any LLM/AI agent as subject (this covers both the human cognitive-bias/limitations literature Query D was designed to retrieve, and the broader pre-LLM/non-agentic NLP4RE and ML4RE technique literature, e.g. classical NLP pipelines, deep-learning classifiers, or BERT-based models applied to RE tasks) → classify as `IC2-b`, `Study Type = foundational-baseline`, and continue to Step 1 evaluating **only IC1-a** (IC1-b does not apply — there is no AI-related mechanism to be transferable to). Skip EC2 (moot — no AI architecture to be off-topic about). Foundational-baseline papers are retained as conceptual background; they are not pooled with primary AI-era evidence in synthesis.
- **Otherwise** → `EXCLUDE`, trigger = `IC2`, PRISMA code `EX-SCOPE`. Stop.

### Step 1 — IC1 (Domain / Scope): relevance via either route

A paper satisfies IC1 if it meets **at least one** of:

*   **IC1-a (Direct domain):** The study explicitly focuses on early-phase software engineering — requirements engineering, requirements elicitation, requirements analysis/validation, intent articulation, problem discovery, product discovery, or upstream system/problem-space analysis.
*   **IC1-b (Transferable mechanism — not available to `IC2-b` papers):** The study investigates a generic LLM/agent phenomenon whose relevance to the early-phase inquiry process is explicitly stated or directly transferable, even if set in a non-SE domain. The following mechanisms **qualify by default** (do not require the study itself to discuss software engineering): sycophancy, problem/topic drift, multi-agent debate dynamics, grounding failures, automation bias, and human-AI cognitive interaction patterns more broadly. The one-sentence transferability rationale (required, logged in `Inclusion Route`) only needs to name *which* early-phase-inquiry behavior the mechanism plausibly affects (e.g., "sycophancy → uncritical acceptance of elicited requirements without challenge").

If IC1 fails (neither route applies, or `IC2-b` and IC1-a fails): `EXCLUDE`, trigger = `IC1`, PRISMA code `EX-SCOPE`. Stop.

### Step 2 — IC3 (Phenomenon — domain-independent)

The study must address at least one of: human cognitive limitations, sensemaking, problem-space exploration, bias dynamics (e.g., sycophancy, anchoring, confirmation bias, automation bias), or multi-agent interaction quality. IC1 and IC3 answer different questions: IC1 = scope/relevance ("why is this paper in scope?"), IC3 = substance ("which target phenomenon does it actually address?"). A paper admitted via IC1-b or IC2-b still must name a concrete IC3 phenomenon.

If IC3 fails: `EXCLUDE`, trigger = `IC3`, PRISMA code `EX-CTX`. Stop.

### Step 3 — IC4 (Methodology / Substance)

The study must present at least one of: empirical findings (qualitative or quantitative), a proposed architectural framework, a design/ADR/DSR artifact, or a systematic conceptual contribution (structured taxonomy or literature synthesis). Purely anecdotal opinion pieces without a structured contribution do not qualify. Reviews/surveys/taxonomies are admitted but flagged `Study Type = secondary` (not pooled with primary evidence; feed Step 3b snowballing instead).

If IC4 fails: `EXCLUDE`, trigger = `IC4`, PRISMA code `EX-EVID`. Stop.

### Step 4 — All IC passed: evaluate Exclusion Criteria (EC1–EC6)

EC is evaluated **only now, having passed all applicable IC**. Before applying **any** EC1 or EC3 exclusion, run the mandatory IC5 pre-check below.

**Mandatory IC5 pre-check (before finalizing any EC1 or EC3 exclusion):** does this paper report disconfirming evidence — no benefit, marginal benefit, or prohibitive overhead of multi-agent/iterative approaches relative to a well-prompted single-agent baseline? If yes → `INCLUDE`, `Inclusion Route = IC5`. This overrides EC1 and EC3. (Rationale: implements the disconfirming-evidence requirement of Query G; prevents systematically filtering out counter-evidence.)

*   **EC1 (Downstream Focus):** Exclude papers focused on downstream SE tasks (code generation, syntax debugging, unit testing, deployment) with no connection to upstream requirements or intent articulation. **Applicability test (mandatory):** before applying EC1, confirm the paper is actually about a software-engineering task at all — do **not** apply EC1 to a non-SE human-AI interaction study admitted via IC1-b (e.g., a general sycophancy-in-conversation study is not "downstream SE focus" merely because it involves an LLM). Tie-breaker: a study spanning both upstream and downstream phases is included if the upstream dimension is substantively treated, not merely mentioned.
*   **EC2 (Model Architecture Focus):** Exclude papers focused purely on internal/mathematical LLM architecture (weight optimization, training-loss reduction, hardware acceleration, tokenizer design) with no link to application/behavior in a workflow. Tie-breaker: a paper touching training/optimization (RLHF, preference optimization, reward modeling) is included when it explains an observable model behavior relevant to the thesis (sycophancy, drift) and excluded when optimization is treated as an end in itself.
*   **EC3 (Pure Benchmarking):** Exclude papers that solely evaluate AI models against quantitative benchmark datasets without analyzing human-AI interaction, practitioner workflow integration, or comparative dynamics relevant to this thesis. Overridden by IC5 (see mandatory pre-check above).
*   **EC4 (Publication Type):** Exclude non-peer-reviewed editorials, opinion pieces, presentation slides, short extended abstracts. Length gate (< 4 pages double-column / ~6 pages single-column) is waived for short/late-breaking/workshop contributions in venues on the Source Quality Hierarchy (`01_role_slr.md` §2), which proceed to full-text instead of auto-exclusion. **Note:** Extended Abstracts and Workshop papers from Tier-1 venues are not auto-excluded at Title/Abstract screening but are subject to stricter scrutiny in the Light Full-Text Sanity Check (see below).
*   **EC5 (Language) — safety net only:** Exclude papers not in English or German. Programmatically enforced upstream where possible; here only as a catch for stray records.
*   **EC6 (Time window) — safety net only:** 2022+ for AI/LLM queries (A, B, C, F, G, H); 2015+ for RE/cognitive-bias queries D and E. Enforced programmatically by the venue filter; here only as a catch for records with malformed year metadata.

If no EC triggers: `INCLUDE`. If exactly one EC triggers (and IC5 does not override it): `EXCLUDE`, trigger = that EC code, PRISMA code per the mapping table (outside this block).

### Confidence field and auto-downgrade

Every decision includes `confidence: high | medium | low`, reflecting how directly the abstract text supports the decision. **If decision = `EXCLUDE` and confidence = `low`, auto-downgrade the decision to `MAYBE`.**

### MAYBE handling

Assign `MAYBE` whenever the abstract is ambiguous on any single criterion, whenever the quote-discipline rule above cannot be satisfied, or via the confidence auto-downgrade. `MAYBE` is not a final verdict: it is carried into the existing Full-Text Tiering step (`scripts/prioritize_fulltext.py`) exactly like an `INCLUDE`. Only `MAYBE`s that clear tiering into `FULL_TEXT` receive an individual manual read; `MAYBE`s that land in `BACKGROUND_ONLY` remain in the corpus as background without separate per-paper review, same as any other `BACKGROUND_ONLY` paper.

### Required output per paper

`ID, decision (INCLUDE|EXCLUDE|MAYBE), trigger (criterion code), inclusion_route (empty unless IC1-b/IC2-b/IC5), confidence (high|medium|low), evidence (verbatim quote)`
<!-- SCREENING_PROMPT_END -->

---

## Screening Process

*   **LLM screening:** all records of the database search and of snowballing were screened by a script with the procedure above (`claude-sonnet-5`; for Queries E and H `claude-sonnet-5-5`). Every exclusion needs a verbatim quote from the abstract; uncertain cases become `MAYBE` and stay in the process.
*   **Limitation:** there is no second coder and no agreement statistic.

---

## Prioritisation for Full-Text Reading

### Main search: relevance tiering (deterministic)

Every `INCLUDE` and `MAYBE` of the main search and of snowballing was prioritised by a script with the rules below. The rule does not re-decide eligibility; it decides which records are read in full text.

| Tier | Population | Rule | Outcome |
|------|-----------|------|---------|
| **Tier 1** | IC1-a papers (direct early-phase-SE domain) | Title/abstract matches a core-relevance keyword set (multi-agent/debate, LLM/agent, cognitive bias in RE, elicitation/problem-space & sensemaking) | `FULL_TEXT` (automatic) |
| **Tier 1b** | IC1-a papers | Matches neither the core-relevance nor the peripheral-domain keyword set | `FULL_TEXT` (benefit of the doubt) |
| **Tier 2 (scored)** | All non-IC1-a INCLUDEs/MAYBEs, plus IC1-a papers matching a peripheral-domain set (e.g. privacy/security-RE, healthcare, IoT, embedded — unless paired with bias/AI/elicitation terms) | Keyword-weighted relevance score 1–5: core thesis topics (sycophancy, drift, debate dynamics, grounding, requirements+LLM, human-AI collab, cognitive bias+AI, problem exploration) = 2 pts each; medium/adjacent topics (general multi-agent, trust, decision-making+AI, feedback quality, elicitation, hallucination, agent roles) = 1 pt each | Score ≥ 4 → `tier2_included`/`FULL_TEXT`; score < 4 → `tier3`/`BACKGROUND_ONLY` |

*   **Records not prioritised** (`BACKGROUND_ONLY`) were not read in full text and are not part of the corpus.
*   **Manual inspection:** the researcher looked at the full texts of the 235 records from relevance tiering and kept 110 for the detailed assessment; the other 125 were excluded at this step without a recorded reason per record. The thesis counts them among the exclusions after full-text reading.

### Queries E and H: challenge-focused full-text selection

For the records of Queries E and H, a narrower selection rule replaces the relevance tiering.

**Rule (applied to every `INCLUDE` and `MAYBE`, on title and abstract):** a record is selected for full-text assessment only if both conditions hold.

1. **Study type:** the paper is a primary empirical study (own data from an experiment, case study, interview study, survey, observation, protocol analysis or real project data; studies with students count), or an artifact paper (tool, system, technique, framework, model) whose abstract reports an own empirical evaluation. Not selected: artifacts without evaluation, secondary studies, position/vision/education papers.
2. **Challenge focus:** one of the challenges C1–C8 is the main subject of the paper, i.e. its central research question or its main finding. A challenge that is only one finding among several ("side") or only named as motivation ("mention") does not suffice. The direction of the finding is irrelevant: a study showing that the phenomenon does not occur is selected as well.

**Implementation:** a script with `claude-sonnet-5-5` at temperature 0. The script receives the definition of each challenge; C9 is not a target of Queries E and H. Every assignment requires a verbatim quote from the abstract, and the script verifies that the quote occurs in the abstract. Records without an abstract are decided manually by the researcher on the title.

**Reserve for C1 and C3:** after the full-text assessment of the selected records, C1 and C3 were each supported by fewer papers than any other challenge. For these two challenges only, condition 2 was therefore relaxed from "main subject" to "main subject or one finding among several (side)"; condition 1 (study type) stayed unchanged. This added 20 records (C1: 5, C3: 15). No new search was run and no other challenge was affected. The relaxation was decided after seeing the distribution of evidence and is reported as such; the full-text assessment of these records followed the same criteria and procedure as for all other papers.
