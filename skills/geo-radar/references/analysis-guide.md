# Analysis Guide

## Metric definitions

GEO Radar uses the same server-side definitions everywhere:

- **Brand mention question rate** = questions with at least one confirmed brand evidence ÷ valid completed questions.
- **Question coverage** = questions with at least one result ÷ valid completed questions.
- **Official site coverage** = questions with at least one official-domain result ÷ valid completed questions.
- **Third-party page coverage** = questions with at least one brand-matched third-party evidence ÷ valid completed questions.
- **Competitor mention rate** = questions with that competitor detected ÷ the same valid question denominator.

Failed, cancelled and pending questions are not valid samples. Empty results are different from failures.

## Tools

```text
geo_analyze_brand({ brandId, days })
geo_analyze_domain({ brandId })
geo_compare_competitors({ brandId, days })
geo_analyze_citations({ brandId })
```

## Reporting a rate

Always state numerator, denominator and valid sample size. Example:

```text
6 / 10 valid questions = 60%; 2 failed questions excluded.
```

Never turn a percentage into a “score” without a defined methodology.

## Trend and volatility

- A trend needs at least two valid dates.
- One round is not a trend.
- Min/max across rounds is an observed range, not a confidence interval.
- Do not claim that a change was caused by an optimization; describe it as concurrent observation.
