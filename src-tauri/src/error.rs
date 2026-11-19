use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, thiserror::Error, Serialize, Deserialize, Type)]
#[serde(tag = "type", content = "details")]
pub enum AppError {
    #[error("Filesystem I/O Error: {0}")]
    Io(String),
    #[error("Git execution failed [{code}]: {message}")]
    GitExecution { code: i32, message: String },
    #[error("Failed to parse Git CLI output: {0}")]
    ParseError(String),
    #[error("Path error: {0}")]
    InvalidPath(String),
}
