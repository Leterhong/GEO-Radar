# Evidence Guide

## What counts as evidence

A page-level evidence row links:

- task / question
- title, original URL, normalized URL, domain
- snippet, page type, source role
- brand match basis, competitor matches
- collection time, RequestId
- human review state

## Query evidence

```text
geo_list_evidence({ brandId, domain?, taskId?, pageType?, mentionStatus?, pageSize })
geo_search_evidence({ search, brandId?, domain?, since? })
geo_get_evidence({ evidenceId })
```

Use `geo_get_evidence` before making a specific claim. Return:

- URL
- title
- collectedAt
- RequestId when present
- pageType/sourceRole
- review status

## Review states

`PENDING_REVIEW` is not a confirmed brand mention. Do not count it as confirmed.

## Provenance rules

- Keep the original URL; normalized URLs are only for comparison.
- Do not infer “AI answer citation” from a search result. GEO Radar measures search-result pages.
- If a page is ambiguous, mark it for human review instead of forcing a classification.
