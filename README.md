# wyerd-squad

**Pathfinder — Veteran Navigation Frontend**  
Live at [squad.wyerd.org](https://squad.wyerd.org)

Part of the [SQUAD BAT](https://github.com/Auernyx-com/SQUAD) system — a veteran navigation platform built by and for veterans.

---

## What this repo is

This is the public-facing side of Pathfinder: the landing page and intake tool.

| Path | What it is |
|------|-----------|
| `index.html` | Landing page — what Pathfinder is, beta access request |
| `tool/index.html` | The intake tool — guided questions, resource routing, results |

The frontend is a single-file HTML/JS app. No build step. No framework. Deployed via Cloudflare Pages.

## What Pathfinder does

Veterans tell Pathfinder their situation — branch, discharge status, housing, disability, what they're dealing with. Pathfinder routes them to the specific programs, offices, and contacts that apply.

It doesn't give legal or medical advice. It doesn't store veteran data on any server. It tells you where to go and who to call.

## Architecture

The frontend connects to a Cloudflare Worker backend ([pathfinder-worker](https://github.com/Auernyx-com/pathfinder-worker)):

```
veteran → squad.wyerd.org/tool (this repo)
            ↓
        Cloudflare Worker (AI binding + KV)
            ↓
        SQUAD coordinator logic
            ↓
        Resource shards (DATA/US/<STATE>.json)
            ↓
        Results + immediate contacts routed back
```

The resource data — 50-state coverage, regional shards — lives in the [SQUAD repo](https://github.com/Auernyx-com/SQUAD).

## Coverage areas

- VA Benefits & Claims (disability ratings, PACT Act, appeals, TDIU, SMC)
- Housing (HUD-VASH, SSVF, VA home loan, eviction defense)
- Healthcare & Mental Health (VA enrollment, Vet Centers, MST care, Crisis Line)
- Legal (discharge upgrade, VA appeals, civilian legal aid)
- Business & Employment (SDVOSB, Voc Rehab Ch. 31, SBA, transition)
- Transportation, Women Veterans, Toxic Exposure (BTSSS, Agent Orange, PFAS, Camp Lejeune)

## Beta status

Western Slope Colorado pilot. Testing with veterans across different branches, discharge statuses, and situations before expanding. National scale is the goal.

## Coverage honesty

The tool tells veterans exactly what kind of local data it has for their area:

- **Deep regional data** — confirmed local contacts, nothing shown
- **Statewide data only** — notice shown, routes to state-level resources
- **No confirmed local data** — notice shown, routes through national lines

No veteran gets sent toward a program they don't qualify for and called complete.

## Design decisions

- No framework — one HTML file, vanilla JS. Deployable anywhere, readable by anyone.
- No server-side veteran data storage — intake processed in real time, discarded after response.
- Phone numbers are never LLM-generated — if a number is unverified it is marked and not surfaced.
- Feedback loop — veterans can flag missing resources directly from the results screen.

## Deployment

```bash
wrangler pages deploy . --project-name wyerd-squad
```

Deploys to Cloudflare Pages. Custom domain `squad.wyerd.org` configured in the CF dashboard.

---

**SQUAD BAT — Veteran Navigation**  
Western Slope Colorado pilot → national expansion  
[squad.wyerd.org](https://squad.wyerd.org) · [admin@wyerd.org](mailto:admin@wyerd.org)
