use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub enum GitProvider {
    GitHub,
    GitLab,
    Bitbucket,
    Custom(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub enum SyncStrategy {
    PullFastForwardOnly,
    FetchOnly,
    StashAndPull,
    HardResetAndPull,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RepoStatus {
    pub name: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub current_branch: String,
    pub default_branch: String,
    pub ahead_count: u32,
    pub behind_count: u32,
    pub is_dirty: bool,
    pub stashed_count: u32,
    pub remote_url: Option<String>,
    pub provider: GitProvider,
    pub is_detached: bool,
    pub last_commit_title: String,
    pub last_commit_hash: String,
    pub last_commit_timestamp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RepoSyncTarget {
    pub absolute_path: String,
    pub branch: String,
    pub reset_to_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LogPayload {
    pub repo_path: String,
    pub line: String,
    pub is_stderr: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct ChangelogSection {
    pub category: String,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct ChangelogRelease {
    pub version: String,
    pub date: String,
    pub sections: Vec<ChangelogSection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
pub struct AppVersionInfo {
    pub name: String,
    pub version: String,
    pub raw_changelog: String,
    pub releases: Vec<ChangelogRelease>,
}
