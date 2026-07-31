# Chapter N: Title

## The question

State the one architectural question the learner should answer by the end.

## Why this chapter comes now

Name the prerequisite established by the previous chapter and the later design
decision this chapter unlocks.

## Outcomes

After this chapter, the learner can:

- predict one relevant behavior
- trace one public API into the implementation
- explain one guarantee
- explain one non-guarantee
- reproduce one failure boundary

## Vocabulary

Define terms at the layer that owns them. Do not use Actor-Web-specific names
for platform concepts or product-specific names for runtime concepts.

## Mental model

Present the smallest model that predicts the behavior being studied. Label
deliberate simplifications.

## Platform mechanism

Explain the relevant JavaScript, Node.js, browser, operating-system, network,
storage, or security mechanism.

## Actor-Web mapping

Trace the model through:

1. public API
2. runtime implementation
3. focused test or conformance fixture

## Failure boundary

Describe what stops working, becomes uncertain, or remains the application's
responsibility when the abstraction reaches its limit.

## Similar systems

Compare only the guarantees that illuminate Actor-Web. State important runtime
differences explicitly.

## Maturity ledger

| Claim | Maturity | Evidence |
| --- | --- | --- |
| Example guarantee | Current, accepted target, candidate, or deferred | Source, test, fixture, or ADR |

## Summary

Answer the chapter question in no more than three paragraphs.

## Continue in the workbook

Link to predictions, experiments, source traces, failure injection, and the
exit assessment.
