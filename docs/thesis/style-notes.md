# Thesis style notes

Setup reference for this UET thesis template. Generated 2026-04-24.

## Build

- **Engine:** pdflatex (NOT xelatex/lualatex — `\usepackage[utf8]{vietnam}` is pdflatex-only)
- **Bibliography:** bibtex + natbib, style `unsrt`
- **Main file:** `thesis.tex`
- **Output:** `build/` (created by latexmk)
- **MacTeX path:** `/Library/TeX/texbin/` (TeX Live 2026) — not on default zsh PATH
- **Quick build:** from `docs/thesis/`:
  ```sh
  PATH=/Library/TeX/texbin:$PATH latexmk
  ```
- **Clean aux:** `latexmk -c`
- **Clean all (incl. build/ + PDF):** `latexmk -C`

## Citations (natbib)

- `\cite{key}` — numeric/standard
- `\citet{key}` — textual (Author, 2020)
- `\citep{key}` — parenthetical ((Author, 2020))
- Add entries to `references.bib`.

## Cross-references

- Figures: `\label{fig:xxx}` (after `\caption{}`), `\ref{fig:xxx}`
- Tables: `\label{tab:xxx}`, `\ref{tab:xxx}`
- Chapters: `\label{chap:xxx}` (e.g. `chap:experiment` exists in c4_chapter.tex)
- Sections: `\label{sec:xxx}` / `\label{subsec:xxx}`

## Figures

- Put images in `figures/`
- `\begin{figure}[H]` for strict placement (`float` package preloaded)
- Caption **below** figure (after `\includegraphics`)
- Caption **above** table (before `\begin{tabular}`)

## Vietnamese quirks

- `\usepackage[utf8]{vietnam}` + `\usepackage[utf8]{inputenc}` — pdflatex only
- UTF-8 source compiles Vietnamese diacritics directly
- Algorithm label localized: `Thuật toán` (via `\renewcommand*{\ALG@name}{...}`)

## Metadata to fill in

| Field | Location |
|---|---|
| Title command | `thesis.tex:65` (`\title{}`) |
| Author command | `thesis.tex:66` (`\author{}`) |
| Cover name (VI) | `cover.tex:23`, `cover.tex:55` |
| Cover name (EN) | `cover.tex:92` |
| Cover title (VI) | `cover.tex:26`, `cover.tex:58` |
| Cover title (EN) | `cover.tex:95` |
| Supervisor | `cover.tex:65` |
| Co-supervisor | `cover.tex:66` |
| Year | `cover.tex:33`, `cover.tex:69`, `cover.tex:106` |
| Class ID / assurance text | `chapters/assurance.tex` |
| Abstract (VI) | `chapters/abtract_vi.tex` (note: "abtract" — misspelled in upstream template) |
| Abstract (EN) | `chapters/abtract_en.tex` |
| Acknowledgement | `chapters/acknowledgement.tex` |

## Chapter ordering (thesis.tex body)

Front matter → chapters → back matter. Order is load-bearing; don't reorder:

1. cover
2. acknowledgement
3. assurance
4. abtract_vi
5. abtract_en
6. Table of Contents (auto)
7. List of Figures (auto)
8. List of Tables (auto)
9. glossary
10. `\pagenumbering{arabic}` switch
11. Chapters (c1 → c5)
12. conclusion
13. bibliography

## Files to leave alone

- `thesis.tex` preamble (lines 1–124): packages, geometry, fonts, TOC style, listings config
- `cover.tex` layout (tikz border boxes, `\vspace`/`\vfill` scaffolding) — edit only the metadata strings
- `empty.tex` (zero bytes, never `\input`'d, purpose unknown)

## Quirks of upstream template

1. **Typo'd filenames:** `abtract_vi.tex` / `abtract_en.tex` (should be "abstract"). `\input` calls match, so leave alone.
2. **Duplicate `\bibliographystyle`:** line 43 sets `unsrt`; line 167 sets `plain` *after* `\bibliography{}` — dead code. Only `unsrt` applies.
3. **Leftover malware example content** in `chapters/c5/c5_detection.tex` and `chapters/c5/c5_classification.tex` references `figures/c5/*` images that don't exist. Not `\input`'d from the active `c5_chapter.tex`. Do not wire in.
4. **`thesis.lof` / `thesis.lot` in source tree:** these are build artifacts the upstream shipped by mistake. They'll be regenerated each compile. Left in place per "preserve template files" rule; gitignore excludes the regenerated versions.
