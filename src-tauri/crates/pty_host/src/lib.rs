#![deny(dead_code)]

pub mod error;
pub mod host;

pub use crate::error::PtyHostError;
pub use crate::host::{
    AckRequest, EventSink, KillRequest, PtyHost, ResizeRequest, SpawnOptions, SpawnRequest,
    SpawnResponse, SubscribeRequest, SubscribeResponse, TerminalSnapshot, WriteRequest,
};
