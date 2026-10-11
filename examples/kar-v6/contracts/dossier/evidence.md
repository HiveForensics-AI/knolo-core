PROPOSITION
What evidence bears on customer cancellation?

STATUS
SATISFIED
Evidence requirements satisfied

SELECTED EVIDENCE
sha256-11d7370d503b329efad8633f8f4e04e30fdd173814af379a3752aab615e0a0ca  source policy.txt  frontiers F_S
The customer may cancel. This sentence is evidence for the plan.
sha256-a1f5e158d8aa2575a255cc30893715875dc676804f31e4ed02bfad1d4fb14e5b  source contract.txt  frontiers F_O
The customer may not cancel after signature. This sentence is evidence for the plan.

SUPPORT
sha256-11d7370d503b329efad8633f8f4e04e30fdd173814af379a3752aab615e0a0ca  source policy.txt  frontiers F_S
The customer may cancel. This sentence is evidence for the plan.

OPPOSITION
sha256-a1f5e158d8aa2575a255cc30893715875dc676804f31e4ed02bfad1d4fb14e5b  source contract.txt  frontiers F_O
The customer may not cancel after signature. This sentence is evidence for the plan.

QUALIFICATIONS
(none)

TEMPORAL/APPLICABILITY
(none)

AUTHORITY
(none)

WHY THESE ITEMS WERE SELECTED
sha256-a1f5e158d8aa2575a255cc30893715875dc676804f31e4ed02bfad1d4fb14e5b F_O required for this set; contributes cancel-barred
sha256-11d7370d503b329efad8633f8f4e04e30fdd173814af379a3752aab615e0a0ca F_S required for this set; contributes cancel-allowed

CERTIFICATE ROOTS
KnowledgeRoot sha256-35e5cd0b1e08472b38bafffd79b7dfd00db508cc129eb426cd6ba932a9a99a27
SemanticRoot sha256-6e14e7639cff187a58b137e3507f65534edf728d0cf133e26e94f472eb322628
PlanRoot sha256-f9237b4e352511a4f22ef3510ac9edbe5e55338f91ab852aa604637d72977948
AnchorRoot sha256-723750047782c15aaa9b18a6fb63abc9e5959cd254a57f2154d42959f1c59dca
FrontierRoot sha256-0b844baffce47029d4e51edfe9e9a8d055c11fa84e66ea02ec0b8ae806968ac5
EvidenceSetRoot sha256-04fc5ec321b96eb00e8c281542582b4d22c892197c6a17abb10616351cd8c150
DecisionRoot sha256-ba643ef0dcb933a375cfd8f7bc3bb47ddad181564c32ed1918cffe0224a14550
KARRoot sha256-73735c412c2b86f8b026a6e0c9408af7afcbfdf035defb8919fa7a285dcf1985
QueryRoot sha256-a8eddf704181902e85e93c8dbb4fdeb9516f74b2bebd3b07268e1a9598de3656
FrontierWitnessRoot sha256-f3de760a736c18494824fda97401ea8db562d8dca89d523b3ada2dbb50e1f90f
V5StateRoot sha256-6db4557125f77322e410bbbd4cb4d10d5ebab5f7b38b96dfc886fef84aeb6a77

HOW TO VERIFY
Recompute the frozen KAR certificate from the Knowledge Image, the Committed Evidence Graph, the plan, and the proposition.
knolo kar dossier verify <dossier-directory>
A change to the certificate, manifest, selected evidence, or this rendering fails closed.
