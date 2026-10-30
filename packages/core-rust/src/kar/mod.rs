//! Native evaluate and verify for public KAR V5 conformance vectors.
//! Authoring, coverage reports, Cortex, and composition stay in TypeScript.

mod closure;
mod cover;
mod evaluate;
mod json;
mod model;
mod session;

pub use session::{
    create_kar_dossier_v5, evaluate_kar_v5, render_kar_dossier, verify_kar_dossier_v5,
    verify_kar_v5, KarDossier, KarEvaluation, KarRunError, KarVerification,
};
