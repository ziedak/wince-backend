# Revenue Attribution and A/B Testing

Shared business logic for discount codes, conversion attribution, and experimentation.

## Discount flow

- Generate discount codes when the decision engine chooses a discount intervention.
- Store generated codes and expiry in PostgreSQL.
- Validate redemption against the stored code and intervention mapping.
- Use a code format like `CR-{store_id}-{random_alphanumeric(8)}` and expire codes after one hour unless policy says otherwise.
- Merchant validation should happen through an explicit admin-facing validation endpoint before applying the discount.

## Attribution

- Match purchase events back to discount codes where possible.
- Use session-based attribution for non-discount interventions.
- Treat discount attribution as code-based when a matching coupon is used before expiry.
- For non-discount interventions, treat a purchase within 24 hours of the intervention as attributable unless policy says otherwise.

## A/B testing

- Assign variants from a store-level experiment configuration stored in PostgreSQL `experiments`.
- Bucket deterministically: `bucket = hash(distinct_id) % 100`.
- Map bucket to variant using cumulative ranges from the experiment config (e.g., `control: 0–0`, `rule_based: 1–50`, `ai_v1: 51–100`).
- Load active experiment from Redis cache (source: PostgreSQL).
- Record `experiment_id` and `variant` on the intervention record in `intervention.log` and PostgreSQL `interventions`.
- Support control (no intervention), rule-based, AI-v1, and AI-v2 routing.
- Keep experiment configuration data-driven so routing stays reproducible.

## Notes

- Keep the rules explicit and reproducible.
- Treat the experiment definition as data, not code.
- Analysis results should be derived from ClickHouse, not from operational tables.
