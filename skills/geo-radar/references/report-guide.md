# Report Guide

## When to generate

Generate a report only after the task is completed and the evidence has been stored. Do not generate a “report” from model memory.

```text
geo_generate_report({ taskId, compareTaskId?, title? })
geo_get_report({ reportId, includeMarkdown? })
```

## Required report metadata

- report title and generation time
- brand and competitors
- question set/version
- task status and valid sample size
- data time range
- metric definitions
- representative evidence URLs
- limitations

## Evidence references

Every important claim should include at least one of:

- question ID/text
- task ID
- evidence ID
- URL
- RequestId
- collection time

## Formats

GEO Radar supports HTML, Markdown, metrics CSV, questions CSV and evidence CSV, plus browser print/PDF.

## Causal language

Use:

- “observed change”
- “concurrent with the optimization”
- “not sufficient to prove causality”

Do not use “improved 300%” or similar marketing claims from a two-round sample.
